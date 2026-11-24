import { busyFromIcal } from './ical.js';
import { fakeBusy } from './fake.js';
import { googleReady, googleBusy } from './google.js';

export const BOOK_SCHEMA = 'openwiz.book.v1';
export const DEFAULT_STORE_TIMEOUT = 5_000;
export const DEFAULT_ICAL_TIMEOUT = 10_000;
export const MAX_BODY_BYTES = 4_096;
export const MAX_ICAL_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder('utf-8', { fatal: true });

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

export function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

export function errorResponse(status, code, message, extraHeaders = {}) {
  return jsonResponse({ error: code, message }, status, extraHeaders);
}

export function methodNotAllowed(allowed) {
  return errorResponse(405, 'method_not_allowed', 'Method not allowed.', { Allow: allowed });
}

export function resolveNow(now) {
  if (typeof now === 'function') {
    const v = now();
    return v instanceof Date ? v.getTime() : Number(v);
  }
  if (now instanceof Date) return now.getTime();
  if (typeof now === 'number' && Number.isFinite(now)) return now;
  return Date.now();
}

export function toIsoUtc(ms) {
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

export function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function utcHour(ms) {
  return new Date(ms).toISOString().slice(11, 13);
}

export function untilHourEnds(ms) {
  return Math.max(1, Math.ceil((3_600_000 - (ms % 3_600_000)) / 1000));
}

export function untilDayEnds(ms, day = utcDay(ms)) {
  return Math.max(1, Math.ceil((Date.parse(`${day}T00:00:00Z`) + 86_400_000 - ms) / 1000));
}

export function randomBase64Url(numBytes) {
  const bytes = new Uint8Array(numBytes);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomHex(numBytes) {
  const bytes = new Uint8Array(numBytes);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

export async function sha256Hex(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', ENCODER.encode(text)));
  let hex = '';
  for (let i = 0; i < digest.length; i++) hex += digest[i].toString(16).padStart(2, '0');
  return hex;
}

export async function visitorHash(salt, ip) {
  return (await sha256Hex(`${salt}:${ip}`)).slice(0, 32);
}

export async function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', ENCODER.encode(a)),
    crypto.subtle.digest('SHA-256', ENCODER.encode(b)),
  ]);
  const ba = new Uint8Array(da);
  const bb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

export async function readLimited(stream, maxBytes) {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export async function readJsonBody(request, expectedKeys) {
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return null;
  if (request.headers.get('Origin') !== new URL(request.url).origin) return null;
  const raw = await readLimited(request.body, MAX_BODY_BYTES);
  if (raw === null || raw.byteLength === 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(DECODER.decode(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const keys = Object.keys(parsed).sort().join(',');
  if (keys !== expectedKeys) return null;
  for (const value of Object.values(parsed)) {
    if (typeof value !== 'string') return null;
  }
  return parsed;
}

export function hasControlChars(text) {
  return /[\u0000-\u001f\u007f]/.test(text);
}

export function codePointLength(text) {
  return [...text].length;
}

export function isPlausibleEmail(value) {
  return typeof value === 'string' && value.length <= 254 &&
    !hasControlChars(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseIsoTimestamp(value) {
  if (typeof value !== 'string' || !ISO_TIMESTAMP_PATTERN.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function getDb(env) {
  const db = env?.BOOK_DB ?? env?.ASK_A_WIZ_COUNTERS;
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') return null;
  return db;
}

function unavailableError() {
  const err = new Error('unavailable');
  err.code = 'unavailable';
  return err;
}

async function fetchIcal(rawUrl, fetchFn, timeoutMs) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) throw unavailableError();
  let currentUrl;
  try {
    currentUrl = new URL(rawUrl.trim());
  } catch {
    throw unavailableError();
  }
  if (currentUrl.protocol !== 'https:') throw unavailableError();

  const signal = AbortSignal.timeout(timeoutMs);
  let response;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      response = await fetchFn(currentUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal,
      });
    } catch {
      throw unavailableError();
    }
    if (response.status >= 300 && response.status < 400) {
      response.body?.cancel?.().catch(() => {});
      if (hop === MAX_REDIRECTS) throw unavailableError();
      const loc = response.headers.get('Location');
      if (!loc) throw unavailableError();
      let nextUrl;
      try {
        nextUrl = new URL(loc, currentUrl);
      } catch {
        throw unavailableError();
      }
      if (nextUrl.protocol !== 'https:') throw unavailableError();
      currentUrl = nextUrl;
      continue;
    }
    break;
  }

  if (!response || !response.ok) {
    response?.body?.cancel?.().catch(() => {});
    throw unavailableError();
  }

  let bytes;
  try {
    if (response.body) {
      bytes = await readLimited(response.body, MAX_ICAL_BYTES);
    } else {
      const buf = new Uint8Array(await response.arrayBuffer());
      bytes = buf.byteLength <= MAX_ICAL_BYTES ? buf : null;
    }
  } catch {
    throw unavailableError();
  }
  if (bytes === null) throw unavailableError();

  try {
    return DECODER.decode(bytes);
  } catch {
    throw unavailableError();
  }
}

export async function readBusy(cfg, env, fromMs, toMs, { fetch = globalThis.fetch, icalTimeout = DEFAULT_ICAL_TIMEOUT } = {}) {
  if (cfg.mode === 'fake') return fakeBusy(cfg, fromMs, toMs);
  if (cfg.mode !== 'live') throw unavailableError();
  if (googleReady(env)) {
    try {
      return await googleBusy(env, fromMs, toMs, { fetch });
    } catch {
      throw unavailableError();
    }
  }
  const text = await fetchIcal(env?.BOOK_ICAL_URL, fetch, icalTimeout);
  try {
    return busyFromIcal(text, fromMs, toMs);
  } catch {
    throw unavailableError();
  }
}

const DAILY_LIMIT_COUNT = 'COALESCE((SELECT count FROM book_limits WHERE day = ? AND key = ?), 0)';
const UPCOMING_EMAIL_COUNT = `(SELECT COUNT(*) FROM book_bookings
  WHERE lower(email) = lower(?) AND status = 'booked' AND start > ?)`;

function changedOne(result) {
  const changes = result?.meta?.changes;
  if (changes !== 0 && changes !== 1) throw new Error('store: invalid write result');
  return changes === 1;
}

export function openStore(db, timeoutMs = DEFAULT_STORE_TIMEOUT) {
  let initialized = false;

  const runBatch = async statements => {
    let timer;
    const late = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('store timeout')), timeoutMs);
    });
    const results = await Promise.race([db.batch(statements), late]).finally(() => clearTimeout(timer));
    if (!Array.isArray(results) || results.length !== statements.length) {
      throw new Error('store: invalid batch result');
    }
    return results;
  };

  const ensureSchema = async () => {
    if (initialized) return;
    await runBatch([
      db.prepare(
        'CREATE TABLE IF NOT EXISTS book_bookings (' +
        'id TEXT PRIMARY KEY, start INTEGER NOT NULL, end INTEGER NOT NULL, ' +
        'name TEXT NOT NULL, email TEXT NOT NULL, team TEXT NOT NULL, tz TEXT NOT NULL, ' +
        'status TEXT NOT NULL, cancel_hash TEXT NOT NULL, google_event TEXT, created INTEGER NOT NULL)',
      ),
      db.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS book_bookings_booked_start ON book_bookings (start) WHERE status = 'booked'",
      ),
      db.prepare(
        'CREATE TABLE IF NOT EXISTS book_limits (day TEXT NOT NULL, key TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (day, key))',
      ),
      db.prepare(
        'CREATE TABLE IF NOT EXISTS book_salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL)',
      ),
    ]);
    initialized = true;
  };

  return {
    async salt(day) {
      await ensureSchema();
      const fresh = randomHex(32);
      const results = await runBatch([
        db.prepare('DELETE FROM book_limits WHERE day < ?').bind(day),
        db.prepare('DELETE FROM book_salts WHERE day < ?').bind(day),
        db.prepare('INSERT INTO book_salts (day, salt) VALUES (?, ?) ON CONFLICT (day) DO NOTHING').bind(day, fresh),
        db.prepare('SELECT salt FROM book_salts WHERE day = ?').bind(day),
      ]);
      const value = results[3]?.results?.[0]?.salt;
      if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
        throw new Error('store: missing salt');
      }
      return value;
    },

    async bumpLimit(day, key, limit) {
      await ensureSchema();
      const results = await runBatch([
        db.prepare('INSERT INTO book_limits (day, key, count) VALUES (?, ?, 0) ON CONFLICT (day, key) DO NOTHING').bind(day, key),
        db.prepare('UPDATE book_limits SET count = count + 1 WHERE day = ? AND key = ? AND count < ? RETURNING count').bind(day, key, limit),
      ]);
      const rows = results[1]?.results;
      if (!Array.isArray(rows)) throw new Error('store: invalid counter result');
      return rows.length > 0;
    },

    async bookingCounts(day, visitorKey, email, nowMs) {
      await ensureSchema();
      const [result] = await runBatch([
        db.prepare(`SELECT ${DAILY_LIMIT_COUNT} AS visitor, ${DAILY_LIMIT_COUNT} AS global,
          ${UPCOMING_EMAIL_COUNT} AS email`).bind(day, visitorKey, day, 'global', email, nowMs),
      ]);
      const counts = result?.results?.[0];
      if (!counts) throw new Error('store: missing booking counts');
      return counts;
    },

    async listBookedInRange(fromMs, toMs) {
      await ensureSchema();
      const results = await runBatch([
        db.prepare("SELECT start, end FROM book_bookings WHERE status = 'booked' AND end > ? AND start < ? ORDER BY start ASC").bind(fromMs, toMs),
      ]);
      return (results[0]?.results ?? []).map(r => ({ start: Number(r.start), end: Number(r.end) }));
    },

    async insertBooking(row, limits) {
      await ensureSchema();
      const { day, visitorKey, visitorMax, globalMax, emailMax, dayStart, dayEnd, dayMax, bufferMs } = limits;
      try {
        const [insert] = await runBatch([
          db.prepare(`
            INSERT INTO book_bookings (id, start, end, name, email, team, tz, status, cancel_hash, google_event, created)
            SELECT ?, ?, ?, ?, ?, ?, ?, 'booked', ?, NULL, ?
            WHERE (SELECT COUNT(*) FROM book_bookings WHERE status = 'booked' AND start >= ? AND start < ?) < ?
              AND ${UPCOMING_EMAIL_COUNT} < ?
              AND ${DAILY_LIMIT_COUNT} < ?
              AND ${DAILY_LIMIT_COUNT} < ?
              AND NOT EXISTS (
                SELECT 1 FROM book_bookings WHERE status = 'booked' AND start < ? AND end > ?
              )
          `).bind(
            row.id, row.start, row.end, row.name, row.email, row.team, row.tz, row.cancelHash, row.created,
            dayStart, dayEnd, dayMax,
            row.email, row.created, emailMax,
            day, visitorKey, visitorMax,
            day, 'global', globalMax,
            row.end + bufferMs, row.start - bufferMs,
          ),
          db.prepare(`
            INSERT INTO book_limits (day, key, count)
            SELECT ?, key, 1 FROM (SELECT ? AS key UNION ALL SELECT 'global')
            WHERE changes() = 1
            ON CONFLICT (day, key) DO UPDATE SET count = count + 1
          `).bind(day, visitorKey),
        ]);
        return changedOne(insert);
      } catch (err) {
        if (/unique constraint failed: book_bookings\.start/i.test(String(err?.message ?? ''))) {
          return false;
        }
        throw err;
      }
    },

    async setGoogleEvent(id, eventId) {
      await ensureSchema();
      await runBatch([
        db.prepare('UPDATE book_bookings SET google_event = ? WHERE id = ?').bind(eventId, id),
      ]);
    },

    async getBooking(id) {
      await ensureSchema();
      const results = await runBatch([
        db.prepare('SELECT id, start, end, name, email, team, tz, status, cancel_hash, google_event, created FROM book_bookings WHERE id = ?').bind(id),
      ]);
      const row = results[0]?.results?.[0];
      if (!row) return null;
      return {
        id: String(row.id),
        start: Number(row.start),
        end: Number(row.end),
        name: String(row.name),
        email: String(row.email),
        team: String(row.team),
        tz: String(row.tz),
        status: String(row.status),
        cancel_hash: String(row.cancel_hash),
        google_event: row.google_event ? String(row.google_event) : null,
        created: Number(row.created),
      };
    },

    async cancelBooking(id) {
      await ensureSchema();
      const [update] = await runBatch([
        db.prepare("UPDATE book_bookings SET status = 'cancelled' WHERE id = ? AND status = 'booked'").bind(id),
      ]);
      return changedOne(update);
    },

    async listFeed(fromMs, toMs) {
      await ensureSchema();
      const results = await runBatch([
        db.prepare(
          'SELECT id, start, end, name, email, team, status, created ' +
          'FROM book_bookings WHERE start >= ? AND start <= ? ORDER BY start ASC, created ASC',
        ).bind(fromMs, toMs),
      ]);
      return (results[0]?.results ?? []).map(r => ({
        id: String(r.id),
        start: Number(r.start),
        end: Number(r.end),
        name: String(r.name),
        email: String(r.email),
        team: String(r.team),
        status: String(r.status),
        created: Number(r.created),
      }));
    },
  };
}
