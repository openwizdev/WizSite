const MAX_EVENTS = 5000;
const MAX_OCCURRENCES = 20000;
const MAX_EMPTY_PERIODS = 500;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const ALLOWED_FREQS = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
const ALLOWED_RRULE_KEYS = new Set([
  'FREQ',
  'INTERVAL',
  'COUNT',
  'UNTIL',
  'BYDAY',
  'BYMONTHDAY',
  'BYMONTH',
  'WKST',
]);

const formatterCache = new Map();

function unreadable(reason) {
  const err = new Error(reason);
  err.code = 'calendar_unreadable';
  return err;
}

export function getZoneFormatter(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length === 0) {
    throw unreadable('missing timezone');
  }
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      });
    } catch {
      throw unreadable('unknown timezone');
    }
    if (formatterCache.size > 200) formatterCache.clear();
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

export function epochToWall(ms, timeZone) {
  const parts = getZoneFormatter(timeZone).formatToParts(new Date(ms));
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let second = 0;
  for (const part of parts) {
    if (part.type === 'year') year = Number(part.value);
    else if (part.type === 'month') month = Number(part.value);
    else if (part.type === 'day') day = Number(part.value);
    else if (part.type === 'hour') hour = Number(part.value) % 24;
    else if (part.type === 'minute') minute = Number(part.value);
    else if (part.type === 'second') second = Number(part.value);
  }
  return { year, month, day, hour, minute, second };
}

function zoneOffsetMs(ms, timeZone) {
  const w = epochToWall(ms, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - ms;
}

function sameWall(a, b) {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

export function wallToEpochMs(wall, timeZone) {
  const targetUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  if (timeZone === 'UTC' || timeZone === 'Etc/UTC' || timeZone === 'GMT') {
    return targetUtc;
  }
  const off1 = zoneOffsetMs(targetUtc, timeZone);
  const t1 = targetUtc - off1;
  const off2 = zoneOffsetMs(t1, timeZone);
  const t2 = targetUtc - off2;
  if (sameWall(epochToWall(t2, timeZone), wall)) {
    const earlierOff = zoneOffsetMs(t2 - HOUR_MS, timeZone);
    const tEarlier = targetUtc - earlierOff;
    if (tEarlier < t2 && sameWall(epochToWall(tEarlier, timeZone), wall)) {
      return tEarlier;
    }
    return t2;
  }
  if (sameWall(epochToWall(t1, timeZone), wall)) {
    return t1;
  }
  return Math.max(t1, t2);
}

function isValidYmd(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dateNum(year, month, day) {
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function fromDateNum(num) {
  const d = new Date(num * DAY_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    dow: d.getUTCDay(),
  };
}

function dateKey(year, month, day) {
  return `${year}-${month}-${day}`;
}

function unfoldLines(text) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized.replace(/\n[ \t]/g, '').split('\n');
}

function parseContentLine(line) {
  let inQuotes = false;
  let colonIdx = -1;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ':' && !inQuotes) {
      colonIdx = i;
      break;
    }
  }
  if (colonIdx <= 0 || inQuotes) {
    throw unreadable('malformed calendar line');
  }
  const head = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const parts = [];
  let start = 0;
  let q = false;
  for (let i = 0; i < head.length; i += 1) {
    const ch = head[i];
    if (ch === '"') q = !q;
    else if (ch === ';' && !q) {
      parts.push(head.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(head.slice(start));
  const name = parts[0].trim().toUpperCase();
  if (!name) throw unreadable('missing property name');
  const params = {};
  for (let i = 1; i < parts.length; i += 1) {
    const seg = parts[i];
    const eq = seg.indexOf('=');
    if (eq <= 0) throw unreadable('malformed property parameter');
    const pName = seg.slice(0, eq).trim().toUpperCase();
    let pVal = seg.slice(eq + 1).trim();
    if (pVal.length >= 2 && pVal.startsWith('"') && pVal.endsWith('"')) {
      pVal = pVal.slice(1, -1);
    }
    params[pName] = pVal;
  }
  return { name, params, value };
}

function parseDateValue(raw, params, defaultTz) {
  const valType = params.VALUE ? params.VALUE.toUpperCase() : null;
  if (valType && valType !== 'DATE' && valType !== 'DATE-TIME') {
    throw unreadable('unsupported date value type');
  }
  const dateOnlyMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (dateOnlyMatch) {
    if (valType && valType !== 'DATE') {
      throw unreadable('invalid date-time value');
    }
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    if (!isValidYmd(year, month, day)) {
      throw unreadable('invalid calendar date');
    }
    const tz = params.TZID || defaultTz;
    getZoneFormatter(tz);
    return {
      isDateOnly: true,
      year,
      month,
      day,
      hour: 0,
      minute: 0,
      second: 0,
      tz,
      ms: wallToEpochMs({ year, month, day, hour: 0, minute: 0, second: 0 }, tz),
      key: dateKey(year, month, day),
    };
  }
  const dtMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(raw);
  if (!dtMatch) {
    throw unreadable('invalid date-time value');
  }
  if (valType === 'DATE') {
    throw unreadable('invalid date value');
  }
  const year = Number(dtMatch[1]);
  const month = Number(dtMatch[2]);
  const day = Number(dtMatch[3]);
  const hour = Number(dtMatch[4]);
  const minute = Number(dtMatch[5]);
  const second = Number(dtMatch[6]);
  const isUtc = dtMatch[7] === 'Z';
  if (!isValidYmd(year, month, day) || hour > 23 || minute > 59 || second > 60) {
    throw unreadable('invalid date-time value');
  }
  if (isUtc && params.TZID) {
    throw unreadable('conflicting UTC and TZID');
  }
  const tz = isUtc ? 'UTC' : params.TZID || defaultTz;
  getZoneFormatter(tz);
  const clampedSec = Math.min(second, 59);
  const ms = wallToEpochMs(
    { year, month, day, hour, minute, second: clampedSec },
    tz,
  );
  return {
    isDateOnly: false,
    year,
    month,
    day,
    hour,
    minute,
    second: clampedSec,
    tz,
    ms,
    key: dateKey(year, month, day),
  };
}

function parseDuration(raw) {
  const m = /^([+-])?P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$/.exec(raw);
  if (!m) throw unreadable('invalid duration');
  if (m[1] === '-') throw unreadable('negative duration');
  if (raw.includes('T') && !m[4] && !m[5] && !m[6]) {
    throw unreadable('invalid duration');
  }
  if (!m[2] && !m[3] && !m[4] && !m[5] && !m[6]) {
    throw unreadable('invalid duration');
  }
  const weeks = Number(m[2] || 0);
  const days = Number(m[3] || 0);
  const hours = Number(m[4] || 0);
  const minutes = Number(m[5] || 0);
  const seconds = Number(m[6] || 0);
  return (((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60 * 1000 + seconds * 1000;
}

function parseRrule(raw, dtstart) {
  if (!raw) throw unreadable('empty RRULE');
  const tokens = raw.split(';');
  const map = new Map();
  for (const tok of tokens) {
    if (!tok) throw unreadable('malformed RRULE');
    const eq = tok.indexOf('=');
    if (eq <= 0 || eq === tok.length - 1) throw unreadable('malformed RRULE');
    const key = tok.slice(0, eq).toUpperCase();
    const val = tok.slice(eq + 1).toUpperCase();
    if (!ALLOWED_RRULE_KEYS.has(key)) {
      throw unreadable('unsupported RRULE part');
    }
    if (map.has(key)) throw unreadable('duplicate RRULE part');
    map.set(key, val);
  }
  const freq = map.get('FREQ');
  if (!freq || !ALLOWED_FREQS.has(freq)) {
    throw unreadable('unsupported RRULE frequency');
  }
  if (map.has('COUNT') && map.has('UNTIL')) {
    throw unreadable('RRULE cannot have both COUNT and UNTIL');
  }
  let interval = 1;
  if (map.has('INTERVAL')) {
    const rawInt = map.get('INTERVAL');
    if (!/^[1-9]\d*$/.test(rawInt)) throw unreadable('invalid RRULE INTERVAL');
    interval = Number(rawInt);
  }
  let count = null;
  if (map.has('COUNT')) {
    const rawCount = map.get('COUNT');
    if (!/^[1-9]\d*$/.test(rawCount)) throw unreadable('invalid RRULE COUNT');
    count = Number(rawCount);
  }
  let untilMs = null;
  if (map.has('UNTIL')) {
    const rawUntil = map.get('UNTIL');
    const parsed = parseDateValue(rawUntil, {}, dtstart.tz);
    if (parsed.isDateOnly) {
      untilMs = wallToEpochMs(
        {
          year: parsed.year,
          month: parsed.month,
          day: parsed.day,
          hour: 23,
          minute: 59,
          second: 59,
        },
        dtstart.tz,
      ) + 999;
    } else {
      untilMs = parsed.ms;
    }
  }
  let byMonth = null;
  if (map.has('BYMONTH')) {
    const vals = map.get('BYMONTH').split(',');
    const set = new Set();
    for (const v of vals) {
      if (!/^\d+$/.test(v)) throw unreadable('invalid RRULE BYMONTH');
      const n = Number(v);
      if (n < 1 || n > 12) throw unreadable('invalid RRULE BYMONTH');
      set.add(n);
    }
    byMonth = Array.from(set).sort((a, b) => a - b);
  }
  let byMonthDay = null;
  if (map.has('BYMONTHDAY')) {
    const vals = map.get('BYMONTHDAY').split(',');
    const arr = [];
    for (const v of vals) {
      if (!/^[+-]?\d+$/.test(v)) throw unreadable('invalid RRULE BYMONTHDAY');
      const n = Number(v);
      if (n === 0 || n < -31 || n > 31) throw unreadable('invalid RRULE BYMONTHDAY');
      arr.push(n);
    }
    byMonthDay = arr;
  }
  let byDay = null;
  if (map.has('BYDAY')) {
    const vals = map.get('BYDAY').split(',');
    const arr = [];
    for (const v of vals) {
      const dm = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(v);
      if (!dm) throw unreadable('invalid RRULE BYDAY');
      let ord = null;
      if (dm[1] !== undefined) {
        ord = Number(dm[1]);
        if (ord === 0 || ord < -53 || ord > 53) throw unreadable('invalid RRULE BYDAY ordinal');
        if (freq !== 'MONTHLY' && freq !== 'YEARLY') {
          throw unreadable('invalid RRULE BYDAY ordinal');
        }
      }
      arr.push({ ord, dow: DAYS[dm[2]] });
    }
    byDay = arr;
  }
  let wkst = DAYS.MO;
  if (map.has('WKST')) {
    const rawWkst = map.get('WKST');
    if (!(rawWkst in DAYS)) throw unreadable('invalid RRULE WKST');
    wkst = DAYS[rawWkst];
  }
  return { freq, interval, count, untilMs, byMonth, byMonthDay, byDay, wkst };
}

function resolveMonthDays(year, month, byMonthDay) {
  const dim = daysInMonth(year, month);
  const set = new Set();
  for (const md of byMonthDay) {
    const d = md > 0 ? md : dim + 1 + md;
    if (d >= 1 && d <= dim) set.add(d);
  }
  return set;
}

function resolveByDayInMonth(year, month, byDay) {
  const dim = daysInMonth(year, month);
  const byDow = [[], [], [], [], [], [], []];
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  for (let d = 1; d <= dim; d += 1) {
    byDow[(firstDow + d - 1) % 7].push(d);
  }
  const set = new Set();
  for (const spec of byDay) {
    const list = byDow[spec.dow];
    if (spec.ord === null) {
      for (const d of list) set.add(d);
    } else if (spec.ord > 0) {
      if (spec.ord <= list.length) set.add(list[spec.ord - 1]);
    } else {
      const idx = list.length + spec.ord;
      if (idx >= 0) set.add(list[idx]);
    }
  }
  return set;
}

function resolveByDayInYear(year, byDay) {
  const startNum = dateNum(year, 1, 1);
  const endNum = dateNum(year + 1, 1, 1);
  const byDow = [[], [], [], [], [], [], []];
  for (let n = startNum; n < endNum; n += 1) {
    const info = fromDateNum(n);
    byDow[info.dow].push(n);
  }
  const set = new Set();
  for (const spec of byDay) {
    const list = byDow[spec.dow];
    if (spec.ord === null) {
      for (const n of list) set.add(n);
    } else if (spec.ord > 0) {
      if (spec.ord <= list.length) set.add(list[spec.ord - 1]);
    } else {
      const idx = list.length + spec.ord;
      if (idx >= 0) set.add(list[idx]);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

function candidateDaysForMonth(year, month, dtstartDay, byDay, byMonthDay) {
  const dim = daysInMonth(year, month);
  if (byDay && byMonthDay) {
    const a = resolveByDayInMonth(year, month, byDay);
    const b = resolveMonthDays(year, month, byMonthDay);
    const both = [];
    for (const d of a) {
      if (b.has(d)) both.push(d);
    }
    return both.sort((x, y) => x - y);
  }
  if (byDay) {
    return Array.from(resolveByDayInMonth(year, month, byDay)).sort((x, y) => x - y);
  }
  if (byMonthDay) {
    return Array.from(resolveMonthDays(year, month, byMonthDay)).sort((x, y) => x - y);
  }
  return dtstartDay <= dim ? [dtstartDay] : [];
}

function expandEvent(event, fromMs, toMs, overrides, state, out) {
  const { dtstart, durationMs, rrule, exdateMs, exdateKeys } = event;
  const startNum = dateNum(dtstart.year, dtstart.month, dtstart.day);
  const startDow = fromDateNum(startNum).dow;
  const wallTime = {
    hour: dtstart.hour,
    minute: dtstart.minute,
    second: dtstart.second,
  };
  const byMonthSet = rrule.byMonth ? new Set(rrule.byMonth) : null;
  const byDayDows = rrule.byDay ? new Set(rrule.byDay.map((b) => b.dow)) : null;

  let emitted = 0;
  let emptyPeriods = 0;

  function emitDate(year, month, day) {
    const num = dateNum(year, month, day);
    if (num < startNum) return 'continue';
    const occMs = wallToEpochMs({ year, month, day, ...wallTime }, dtstart.tz);
    if (occMs < dtstart.ms) return 'continue';
    if (rrule.untilMs !== null && occMs > rrule.untilMs) return 'stop';
    if (occMs >= toMs) return 'stop';
    state.generated += 1;
    if (state.generated > MAX_OCCURRENCES) {
      throw unreadable('too many generated occurrences');
    }
    emitted += 1;
    const key = dateKey(year, month, day);
    const isExcluded =
      exdateMs.has(occMs) ||
      exdateKeys.has(key) ||
      (overrides && (overrides.ms.has(occMs) || overrides.keys.has(key)));
    if (!isExcluded && durationMs > 0) {
      const occEnd = occMs + durationMs;
      if (occEnd > fromMs && occMs < toMs) {
        out.push({ start: occMs, end: occEnd });
      }
    }
    if (rrule.count !== null && emitted >= rrule.count) return 'stop';
    return 'continue';
  }

  const targetWall = epochToWall(Math.max(0, fromMs - durationMs - DAY_MS), dtstart.tz);
  const targetNum = dateNum(targetWall.year, targetWall.month, targetWall.day);

  if (rrule.freq === 'DAILY') {
    let curNum = startNum;
    if (rrule.count === null && targetNum > startNum) {
      const steps = Math.floor((targetNum - startNum) / rrule.interval);
      if (steps > 0) curNum = startNum + steps * rrule.interval;
    }
    while (emptyPeriods < MAX_EMPTY_PERIODS) {
      const d = fromDateNum(curNum);
      if (d.year > 9999) break;
      let matched = true;
      if (byMonthSet && !byMonthSet.has(d.month)) matched = false;
      if (matched && byDayDows && !byDayDows.has(d.dow)) matched = false;
      if (matched && rrule.byMonthDay) {
        const md = resolveMonthDays(d.year, d.month, rrule.byMonthDay);
        if (!md.has(d.day)) matched = false;
      }
      if (matched) {
        emptyPeriods = 0;
        if (emitDate(d.year, d.month, d.day) === 'stop') break;
      } else {
        emptyPeriods += 1;
        const probeMs = wallToEpochMs({ year: d.year, month: d.month, day: d.day, ...wallTime }, dtstart.tz);
        if (probeMs >= toMs || (rrule.untilMs !== null && probeMs > rrule.untilMs)) break;
      }
      curNum += rrule.interval;
    }
    return;
  }

  if (rrule.freq === 'WEEKLY') {
    const startOffsetFromWkst = (startDow - rrule.wkst + 7) % 7;
    let weekStart = startNum - startOffsetFromWkst;
    if (rrule.count === null && targetNum > weekStart) {
      const steps = Math.floor((targetNum - weekStart) / (7 * rrule.interval));
      if (steps > 0) weekStart += steps * 7 * rrule.interval;
    }
    const targetDows = byDayDows || new Set([startDow]);
    while (emptyPeriods < MAX_EMPTY_PERIODS) {
      let periodHadMatch = false;
      let stopped = false;
      for (let i = 0; i < 7; i += 1) {
        const d = fromDateNum(weekStart + i);
        if (d.year > 9999) {
          stopped = true;
          break;
        }
        if (!targetDows.has(d.dow)) continue;
        if (byMonthSet && !byMonthSet.has(d.month)) continue;
        if (rrule.byMonthDay) {
          const md = resolveMonthDays(d.year, d.month, rrule.byMonthDay);
          if (!md.has(d.day)) continue;
        }
        if (weekStart + i < startNum) continue;
        periodHadMatch = true;
        if (emitDate(d.year, d.month, d.day) === 'stop') {
          stopped = true;
          break;
        }
      }
      if (stopped) break;
      if (periodHadMatch) {
        emptyPeriods = 0;
      } else {
        emptyPeriods += 1;
        const d = fromDateNum(weekStart);
        const probeMs = wallToEpochMs({ year: d.year, month: d.month, day: d.day, ...wallTime }, dtstart.tz);
        if (probeMs >= toMs || (rrule.untilMs !== null && probeMs > rrule.untilMs)) break;
      }
      weekStart += 7 * rrule.interval;
    }
    return;
  }

  if (rrule.freq === 'MONTHLY') {
    let monthIdx = dtstart.year * 12 + (dtstart.month - 1);
    const targetMonthIdx = targetWall.year * 12 + (targetWall.month - 1);
    if (rrule.count === null && targetMonthIdx > monthIdx) {
      const steps = Math.floor((targetMonthIdx - monthIdx) / rrule.interval);
      if (steps > 0) monthIdx += steps * rrule.interval;
    }
    while (emptyPeriods < MAX_EMPTY_PERIODS) {
      const year = Math.floor(monthIdx / 12);
      const month = (monthIdx % 12) + 1;
      if (year > 9999) break;
      let periodHadMatch = false;
      let stopped = false;
      if (!byMonthSet || byMonthSet.has(month)) {
        const days = candidateDaysForMonth(year, month, dtstart.day, rrule.byDay, rrule.byMonthDay);
        for (const day of days) {
          if (dateNum(year, month, day) < startNum) continue;
          periodHadMatch = true;
          if (emitDate(year, month, day) === 'stop') {
            stopped = true;
            break;
          }
        }
      }
      if (stopped) break;
      if (periodHadMatch) {
        emptyPeriods = 0;
      } else {
        emptyPeriods += 1;
        const probeMs = wallToEpochMs({ year, month, day: 1, ...wallTime }, dtstart.tz);
        if (probeMs >= toMs || (rrule.untilMs !== null && probeMs > rrule.untilMs)) break;
      }
      monthIdx += rrule.interval;
    }
    return;
  }

  if (rrule.freq === 'YEARLY') {
    let year = dtstart.year;
    if (rrule.count === null && targetWall.year > year) {
      const steps = Math.floor((targetWall.year - year) / rrule.interval);
      if (steps > 0) year += steps * rrule.interval;
    }
    while (emptyPeriods < MAX_EMPTY_PERIODS) {
      if (year > 9999) break;
      let periodHadMatch = false;
      let stopped = false;
      if (!rrule.byMonth && rrule.byDay) {
        const nums = resolveByDayInYear(year, rrule.byDay);
        for (const n of nums) {
          if (n < startNum) continue;
          const d = fromDateNum(n);
          if (rrule.byMonthDay) {
            const md = resolveMonthDays(d.year, d.month, rrule.byMonthDay);
            if (!md.has(d.day)) continue;
          }
          periodHadMatch = true;
          if (emitDate(d.year, d.month, d.day) === 'stop') {
            stopped = true;
            break;
          }
        }
      } else {
        const months = rrule.byMonth || [dtstart.month];
        for (const month of months) {
          const days = candidateDaysForMonth(year, month, dtstart.day, rrule.byDay, rrule.byMonthDay);
          for (const day of days) {
            if (dateNum(year, month, day) < startNum) continue;
            periodHadMatch = true;
            if (emitDate(year, month, day) === 'stop') {
              stopped = true;
              break;
            }
          }
          if (stopped) break;
        }
      }
      if (stopped) break;
      if (periodHadMatch) {
        emptyPeriods = 0;
      } else {
        emptyPeriods += 1;
        const probeMs = wallToEpochMs({ year, month: 1, day: 1, ...wallTime }, dtstart.tz);
        if (probeMs >= toMs || (rrule.untilMs !== null && probeMs > rrule.untilMs)) break;
      }
      year += rrule.interval;
    }
  }
}

function mergeIntervals(intervals) {
  if (intervals.length === 0) return [];
  intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [{ start: intervals[0].start, end: intervals[0].end }];
  for (let i = 1; i < intervals.length; i += 1) {
    const cur = intervals[i];
    const last = merged[merged.length - 1];
    if (cur.start <= last.end) {
      if (cur.end > last.end) last.end = cur.end;
    } else {
      merged.push({ start: cur.start, end: cur.end });
    }
  }
  return merged;
}

export function busyFromIcal(text, fromMs, toMs) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw unreadable('not a calendar');
  }
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    throw unreadable('invalid query window');
  }

  const lines = unfoldLines(text);
  const stack = [];
  let sawCalendar = false;
  let calTz = 'UTC';
  const rawEvents = [];
  let current = null;

  for (const rawLine of lines) {
    if (rawLine.length === 0) continue;
    const prop = parseContentLine(rawLine);
    if (prop.name === 'BEGIN') {
      const comp = prop.value.trim().toUpperCase();
      if (!comp) throw unreadable('malformed component');
      if (comp === 'VCALENDAR') {
        if (stack.length > 0) throw unreadable('nested VCALENDAR');
        sawCalendar = true;
      } else if (stack.length === 0) {
        throw unreadable('not a calendar');
      }
      if (comp === 'VEVENT') {
        if (stack[stack.length - 1] !== 'VCALENDAR') {
          throw unreadable('misplaced VEVENT');
        }
        if (rawEvents.length >= MAX_EVENTS) {
          throw unreadable('too many events');
        }
        current = {
          uid: null,
          dtstart: null,
          dtend: null,
          duration: null,
          transp: 'OPAQUE',
          status: 'CONFIRMED',
          rrule: null,
          recurrenceId: null,
          exdates: [],
        };
      }
      stack.push(comp);
      continue;
    }
    if (prop.name === 'END') {
      const comp = prop.value.trim().toUpperCase();
      if (stack.length === 0 || stack[stack.length - 1] !== comp) {
        throw unreadable('mismatched component end');
      }
      stack.pop();
      if (comp === 'VEVENT') {
        rawEvents.push(current);
        current = null;
      }
      continue;
    }
    if (stack.length === 0) {
      throw unreadable('not a calendar');
    }
    const top = stack[stack.length - 1];
    if (top === 'VCALENDAR') {
      if (prop.name === 'X-WR-TIMEZONE') {
        const tz = prop.value.trim();
        if (tz) {
          getZoneFormatter(tz);
          calTz = tz;
        }
      }
      continue;
    }
    if (top !== 'VEVENT' || !current) continue;

    if (prop.name === 'UID') current.uid = prop.value;
    else if (prop.name === 'DTSTART') current.dtstart = prop;
    else if (prop.name === 'DTEND') current.dtend = prop;
    else if (prop.name === 'DURATION') current.duration = prop.value.trim();
    else if (prop.name === 'TRANSP') current.transp = prop.value.trim().toUpperCase();
    else if (prop.name === 'STATUS') current.status = prop.value.trim().toUpperCase();
    else if (prop.name === 'RRULE') {
      if (current.rrule !== null) throw unreadable('multiple RRULE properties');
      current.rrule = prop.value.trim();
    } else if (prop.name === 'RECURRENCE-ID') current.recurrenceId = prop;
    else if (prop.name === 'EXDATE') current.exdates.push(prop);
    else if (prop.name === 'RDATE') throw unreadable('unsupported property: RDATE');
  }

  if (!sawCalendar || stack.length !== 0) {
    throw unreadable('incomplete calendar');
  }

  const parsedEvents = [];
  const overridesByUid = new Map();

  for (const raw of rawEvents) {
    if (!raw.dtstart) throw unreadable('event missing DTSTART');
    if (raw.dtend && raw.duration !== null) {
      throw unreadable('event has both DTEND and DURATION');
    }
    const dtstart = parseDateValue(raw.dtstart.value.trim(), raw.dtstart.params, calTz);
    let durationMs = 0;
    if (raw.dtend) {
      const dtend = parseDateValue(raw.dtend.value.trim(), raw.dtend.params, calTz);
      durationMs = dtend.ms - dtstart.ms;
      if (durationMs < 0) throw unreadable('event ends before start');
    } else if (raw.duration !== null) {
      durationMs = parseDuration(raw.duration);
    }
    const rrule = raw.rrule !== null ? parseRrule(raw.rrule, dtstart) : null;
    const exdateMs = new Set();
    const exdateKeys = new Set();
    for (const exProp of raw.exdates) {
      const items = exProp.value.split(',');
      for (const item of items) {
        const parsed = parseDateValue(item.trim(), exProp.params, calTz);
        if (parsed.isDateOnly) exdateKeys.add(parsed.key);
        else exdateMs.add(parsed.ms);
      }
    }
    let recurrenceId = null;
    if (raw.recurrenceId) {
      recurrenceId = parseDateValue(
        raw.recurrenceId.value.trim(),
        raw.recurrenceId.params,
        calTz,
      );
      if (raw.uid) {
        let entry = overridesByUid.get(raw.uid);
        if (!entry) {
          entry = { ms: new Set(), keys: new Set() };
          overridesByUid.set(raw.uid, entry);
        }
        if (recurrenceId.isDateOnly) entry.keys.add(recurrenceId.key);
        else entry.ms.add(recurrenceId.ms);
      }
    }
    parsedEvents.push({
      uid: raw.uid,
      dtstart,
      durationMs,
      transp: raw.transp,
      status: raw.status,
      rrule,
      recurrenceId,
      exdateMs,
      exdateKeys,
    });
  }

  if (fromMs >= toMs) return [];

  const intervals = [];
  const state = { generated: 0 };

  for (const event of parsedEvents) {
    const notBusy =
      event.dtstart.isDateOnly ||
      event.transp === 'TRANSPARENT' ||
      event.status === 'CANCELLED';
    if (notBusy) continue;

    if (event.rrule && !event.recurrenceId) {
      const overrides = event.uid ? overridesByUid.get(event.uid) : null;
      expandEvent(event, fromMs, toMs, overrides, state, intervals);
    } else if (event.durationMs > 0) {
      const start = event.dtstart.ms;
      const end = start + event.durationMs;
      if (end > fromMs && start < toMs) {
        intervals.push({ start, end });
      }
    }
  }

  return mergeIntervals(intervals);
}
