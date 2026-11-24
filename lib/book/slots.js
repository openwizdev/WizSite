import { epochToWall, getZoneFormatter, wallToEpochMs } from './ical.js';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const SLOT_MIN = 30;
const VALID_MODES = new Set(['off', 'fake', 'live']);

function badSettings(reason) {
  const err = new Error(reason);
  err.code = 'bad_settings';
  return err;
}

function readEnv(env, key) {
  if (!env || env[key] === undefined || env[key] === null) return null;
  const s = String(env[key]).trim();
  return s.length === 0 ? null : s;
}

function parseClock(raw, allow24) {
  const m = /^(\d{2}):(\d{2})$/.exec(raw);
  if (!m) throw badSettings('invalid clock time');
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) throw badSettings('invalid clock time');
  if (h === 24 && min === 0 && allow24) return 1440;
  if (h > 23) throw badSettings('invalid clock time');
  return h * 60 + min;
}

function parseIntSetting(raw, min, max, label) {
  if (!/^\d+$/.test(raw)) throw badSettings(`invalid ${label}`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw badSettings(`invalid ${label}`);
  }
  return n;
}

function parseDays(raw) {
  const parts = raw.split(',');
  const set = new Set();
  for (const part of parts) {
    const trimmed = part.trim();
    if (!/^[0-6]$/.test(trimmed)) throw badSettings('invalid BOOK_DAYS');
    set.add(Number(trimmed));
  }
  if (set.size === 0) throw badSettings('invalid BOOK_DAYS');
  return Array.from(set).sort((a, b) => a - b);
}

export function settings(env = {}) {
  const rawMode = readEnv(env, 'BOOK_MODE');
  const mode = rawMode && VALID_MODES.has(rawMode) ? rawMode : 'off';

  const timezone = readEnv(env, 'BOOK_TIMEZONE') ?? 'America/Los_Angeles';
  try {
    getZoneFormatter(timezone);
  } catch {
    throw badSettings('invalid BOOK_TIMEZONE');
  }

  const rawDays = readEnv(env, 'BOOK_DAYS') ?? '1,2,3,4,5';
  const days = parseDays(rawDays);

  const startMin = parseClock(readEnv(env, 'BOOK_START') ?? '11:00', false);
  const endMin = parseClock(readEnv(env, 'BOOK_END') ?? '18:00', true);
  if (endMin <= startMin) throw badSettings('BOOK_END must be after BOOK_START');

  const bufferMin = parseIntSetting(
    readEnv(env, 'BOOK_BUFFER_MIN') ?? '15',
    0,
    720,
    'BOOK_BUFFER_MIN',
  );

  const rawNotice = readEnv(env, 'BOOK_NOTICE_HOURS') ?? '4';
  if (!/^\d+(?:\.\d+)?$/.test(rawNotice)) throw badSettings('invalid BOOK_NOTICE_HOURS');
  const noticeHours = Number(rawNotice);
  if (!Number.isFinite(noticeHours) || noticeHours < 0 || noticeHours > 720) {
    throw badSettings('invalid BOOK_NOTICE_HOURS');
  }
  const noticeMin = Math.round(noticeHours * 60);

  const horizonDays = parseIntSetting(
    readEnv(env, 'BOOK_HORIZON_DAYS') ?? '14',
    1,
    365,
    'BOOK_HORIZON_DAYS',
  );

  const maxPerDay = parseIntSetting(
    readEnv(env, 'BOOK_MAX_PER_DAY') ?? '4',
    1,
    48,
    'BOOK_MAX_PER_DAY',
  );

  return {
    mode,
    timezone,
    days,
    startMin,
    endMin,
    slotMin: SLOT_MIN,
    bufferMin,
    noticeMin,
    horizonDays,
    maxPerDay,
  };
}

export function window(cfg, nowMs) {
  const fromMs = nowMs - cfg.bufferMin * MINUTE_MS;
  const toMs = nowMs + cfg.horizonDays * DAY_MS + (cfg.slotMin + cfg.bufferMin) * MINUTE_MS;
  return { fromMs, toMs };
}

function dayKey(w) {
  return `${w.year}-${w.month}-${w.day}`;
}

export function openSlots(cfg, busy = [], bookings = [], nowMs) {
  const daySet = new Set(cfg.days);
  const slotMs = cfg.slotMin * MINUTE_MS;
  const bufferMs = cfg.bufferMin * MINUTE_MS;
  const minStart = nowMs + cfg.noticeMin * MINUTE_MS;
  const maxStart = nowMs + cfg.horizonDays * DAY_MS;

  const bookingsPerDay = new Map();
  const blockers = [];

  for (const iv of busy) {
    if (iv && Number.isFinite(iv.start) && Number.isFinite(iv.end) && iv.end > iv.start) {
      blockers.push({ start: iv.start - bufferMs, end: iv.end + bufferMs });
    }
  }
  for (const b of bookings) {
    if (b && Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start) {
      blockers.push({ start: b.start - bufferMs, end: b.end + bufferMs });
      const key = dayKey(epochToWall(b.start, cfg.timezone));
      bookingsPerDay.set(key, (bookingsPerDay.get(key) || 0) + 1);
    }
  }

  const nowWall = epochToWall(nowMs, cfg.timezone);
  const baseDateUtc = Date.UTC(nowWall.year, nowWall.month - 1, nowWall.day);
  const firstMin = Math.ceil(cfg.startMin / SLOT_MIN) * SLOT_MIN;
  const result = [];
  const seen = new Set();

  for (let offset = -1; offset <= cfg.horizonDays + 1; offset += 1) {
    const d = new Date(baseDateUtc + offset * DAY_MS);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const dow = d.getUTCDay();
    if (!daySet.has(dow)) continue;
    const key = `${year}-${month}-${day}`;
    if ((bookingsPerDay.get(key) || 0) >= cfg.maxPerDay) continue;

    for (let min = firstMin; min + cfg.slotMin <= cfg.endMin; min += SLOT_MIN) {
      const hour = Math.floor(min / 60);
      const minute = min % 60;
      const slotStart = wallToEpochMs(
        { year, month, day, hour, minute, second: 0 },
        cfg.timezone,
      );
      if (slotStart < minStart || slotStart > maxStart) continue;
      const actual = epochToWall(slotStart, cfg.timezone);
      if (
        actual.year !== year ||
        actual.month !== month ||
        actual.day !== day ||
        actual.hour !== hour ||
        actual.minute !== minute
      ) {
        continue;
      }
      const slotEnd = slotStart + slotMs;
      let blocked = false;
      for (const blk of blockers) {
        if (slotStart < blk.end && slotEnd > blk.start) {
          blocked = true;
          break;
        }
      }
      if (!blocked && !seen.has(slotStart)) {
        seen.add(slotStart);
        result.push(slotStart);
      }
    }
  }

  result.sort((a, b) => a - b);
  return result;
}
