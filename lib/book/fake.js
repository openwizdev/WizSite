import { epochToWall, wallToEpochMs } from './ical.js';

const DAY_MS = 86_400_000;

const PATTERNS = [
  [
    [11, 0, 12, 0],
    [14, 0, 14, 45],
    [16, 0, 16, 30],
  ],
  [
    [11, 30, 12, 15],
    [13, 30, 14, 30],
    [16, 30, 17, 0],
  ],
  [
    [10, 30, 11, 30],
    [13, 0, 13, 30],
    [15, 0, 16, 0],
  ],
  [
    [12, 0, 13, 0],
    [15, 0, 15, 30],
    [17, 0, 17, 45],
  ],
  [
    [11, 0, 11, 30],
    [13, 30, 14, 15],
    [15, 30, 16, 30],
  ],
  [
    [12, 30, 13, 30],
    [14, 30, 15, 15],
  ],
];

function dateHash(year, month, day) {
  let h = (year * 10000 + month * 100 + day) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function fakeBusy(cfg, fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
    return [];
  }
  const timeZone = (cfg && cfg.timezone) || 'America/Los_Angeles';
  const startWall = epochToWall(fromMs, timeZone);
  const endWall = epochToWall(toMs, timeZone);
  const startDayUtc = Date.UTC(startWall.year, startWall.month - 1, startWall.day) - DAY_MS;
  const endDayUtc = Date.UTC(endWall.year, endWall.month - 1, endWall.day) + DAY_MS;

  const intervals = [];
  for (let dayUtc = startDayUtc; dayUtc <= endDayUtc; dayUtc += DAY_MS) {
    const d = new Date(dayUtc);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const pattern = PATTERNS[dateHash(year, month, day) % PATTERNS.length];
    for (const [sh, sm, eh, em] of pattern) {
      const start = wallToEpochMs({ year, month, day, hour: sh, minute: sm, second: 0 }, timeZone);
      const end = wallToEpochMs({ year, month, day, hour: eh, minute: em, second: 0 }, timeZone);
      if (end > start && end > fromMs && start < toMs) {
        intervals.push({ start, end });
      }
    }
  }

  intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      if (iv.end > last.end) last.end = iv.end;
    } else {
      merged.push({ start: iv.start, end: iv.end });
    }
  }
  return merged;
}
