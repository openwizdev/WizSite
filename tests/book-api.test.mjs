import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handle as slotsHandle, onRequest as slotsOnRequest } from '../functions/api/book/slots.js';
import { handle as bookHandle, onRequest as bookOnRequest } from '../functions/api/book/index.js';
import { handle as cancelHandle, onRequest as cancelOnRequest } from '../functions/api/book/cancel.js';
import { handle as feedHandle, onRequest as feedOnRequest } from '../functions/api/book/feed.js';

const ORIGIN = 'https://openwiz.dev';
const NOW = Date.parse('2026-11-24T12:00:00Z');
const ICAL_SECRET_URL = 'https://calendar.example.invalid/private-ical-secret-9999/basic.ics';
const FEED_SECRET = 'feed-secret-token-abcdef0123456789';
const RESEND_SECRET = 're_fake_secret_key_0123456789';
const GOOGLE_CLIENT_ID = 'fake-client-id.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = 'fake-client-secret-xyz987';
const GOOGLE_REFRESH_TOKEN = '1//fake-refresh-token-abc123';
const VISITOR_IP = '198.51.100.42';

const SAMPLE_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//EN',
  'BEGIN:VEVENT',
  'UID:ev-1@example.invalid',
  'DTSTART:20261125T193000Z',
  'DTEND:20261125T203000Z',
  'SUMMARY:Busy meeting',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

function fakeD1({ fails = false, hang = false, failWhen = null } = {}) {
  const db = new DatabaseSync(':memory:');
  const exec = (sql, values) => {
    if (failWhen?.(sql)) throw new Error('synthetic D1 failure');
    const stmt = db.prepare(sql);
    return stmt.columns().length ? stmt.all(...values).map(row => ({ ...row })) : (stmt.run(...values), []);
  };
  const gate = async () => {
    if (hang) return new Promise(() => {});
    if (fails) throw new Error('synthetic D1 failure');
  };
  const statement = (sql, values = []) => ({
    sql,
    values,
    bind: (...more) => statement(sql, more),
    all: async () => { await gate(); return { success: true, results: exec(sql, values), meta: {} }; },
    first: async column => { await gate(); const row = exec(sql, values)[0] ?? null; return column && row ? row[column] : row; },
    run: async () => { await gate(); return { success: true, results: exec(sql, values), meta: {} }; },
  });
  return {
    db,
    binding: {
      prepare: sql => statement(sql),
      batch: async statements => {
        await gate();
        db.exec('BEGIN');
        try {
          const out = statements.map(s => ({ success: true, results: exec(s.sql, s.values), meta: {} }));
          db.exec('COMMIT');
          return out;
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      },
      exec: async sql => { await gate(); db.exec(sql); return { count: 1 }; },
    },
    bookings() {
      try {
        return db.prepare('SELECT * FROM book_bookings ORDER BY start ASC').all().map(r => ({ ...r }));
      } catch {
        return [];
      }
    },
    limits() {
      try {
        return db.prepare('SELECT * FROM book_limits ORDER BY day, key').all().map(r => ({ ...r }));
      } catch {
        return [];
      }
    },
    dumpText() {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
      const out = {};
      for (const name of tables) out[name] = db.prepare(`SELECT * FROM "${name}"`).all();
      return JSON.stringify(out);
    },
  };
}

function makeEnv(store, extra = {}) {
  return {
    BOOK_MODE: 'fake',
    BOOK_DB: store.binding,
    ...extra,
  };
}

function getReq(path, { headers = {}, ip = VISITOR_IP, method = 'GET' } = {}) {
  const h = new Headers(headers);
  if (ip !== null) h.set('CF-Connecting-IP', ip);
  return new Request(`${ORIGIN}${path}`, { method, headers: h });
}

function postJson(path, body, { headers = {}, ip = VISITOR_IP, origin = ORIGIN, contentType = 'application/json', rawBody = null, method = 'POST' } = {}) {
  const h = new Headers(headers);
  if (ip !== null) h.set('CF-Connecting-IP', ip);
  if (origin !== null) h.set('Origin', origin);
  if (contentType !== null) h.set('Content-Type', contentType);
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: h,
    body: rawBody !== null ? rawBody : JSON.stringify(body),
  });
}

function bookingPayload(start, overrides = {}) {
  return {
    start,
    name: 'Alex Rivera',
    email: 'alex@example.com',
    team: 'Ten-person platform team',
    website: '',
    tz: 'America/New_York',
    ...overrides,
  };
}

async function readJson(response) {
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, json: JSON.parse(text) };
}

function assertNoSecrets(text, extra = []) {
  for (const secret of [ICAL_SECRET_URL, FEED_SECRET, RESEND_SECRET, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, VISITOR_IP, ...extra]) {
    if (secret) assert.ok(!text.includes(secret), `leaked secret: ${secret}`);
  }
}

let logs;
const realConsole = {};

beforeEach(() => {
  logs = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    realConsole[level] = console[level];
    console[level] = (...args) => logs.push(args.map(String).join(' '));
  }
});

afterEach(() => {
  Object.assign(console, realConsole);
  assert.deepEqual(logs, []);
});

test('GET /api/book/slots returns open slots in fake mode with no-store header', async () => {
  const store = fakeD1();
  const res = await readJson(await slotsHandle(getReq('/api/book/slots'), makeEnv(store), { now: NOW }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('content-type'), /^application\/json/);
  assert.equal(res.json.schema, 'openwiz.book.v1');
  assert.equal(res.json.mode, 'fake');
  assert.equal(res.json.timezone, 'America/Los_Angeles');
  assert.equal(res.json.minutes, 30);
  assert.ok(Array.isArray(res.json.slots) && res.json.slots.length > 0);
  for (let i = 1; i < res.json.slots.length; i++) {
    assert.ok(Date.parse(res.json.slots[i]) > Date.parse(res.json.slots[i - 1]));
  }
  assert.match(res.json.slots[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assertNoSecrets(res.text);
  assertNoSecrets(store.dumpText());
});

test('GET /api/book/slots rejects non-GET with 405 and falls back to ASK_A_WIZ_COUNTERS', async () => {
  const store = fakeD1();
  const env = { BOOK_MODE: 'fake', ASK_A_WIZ_COUNTERS: store.binding };
  const bad = await readJson(await slotsHandle(getReq('/api/book/slots', { method: 'POST' }), env, { now: NOW }));
  assert.equal(bad.status, 405);
  assert.equal(bad.headers.get('cache-control'), 'no-store');
  const ok = await readJson(await slotsHandle(getReq('/api/book/slots'), env, { now: NOW }));
  assert.equal(ok.status, 200);
});

test('GET /api/book/slots returns 503 unavailable when off, misconfigured, or missing DB', async () => {
  const store = fakeD1();
  for (const env of [
    {},
    { BOOK_MODE: 'off', BOOK_DB: store.binding },
    { BOOK_MODE: 'bogus', BOOK_DB: store.binding },
    { BOOK_MODE: 'fake' },
    { BOOK_MODE: 'fake', BOOK_DB: store.binding, BOOK_START: '99:99' },
    { BOOK_MODE: 'live', BOOK_DB: store.binding },
    { BOOK_MODE: 'live', BOOK_DB: store.binding, BOOK_ICAL_URL: 'http://insecure.example.invalid/cal.ics' },
  ]) {
    const res = await readJson(await slotsHandle(getReq('/api/book/slots'), env, { now: NOW }));
    assert.equal(res.status, 503);
    assert.equal(res.json.error, 'unavailable');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
});

test('GET /api/book/slots in live mode reads iCal over HTTPS and fails closed without leaking URL', async () => {
  const store = fakeD1();
  const env = makeEnv(store, { BOOK_MODE: 'live', BOOK_ICAL_URL: ICAL_SECRET_URL });
  const okFetch = async url => {
    assert.equal(url, ICAL_SECRET_URL);
    return new Response(SAMPLE_ICS, { status: 200 });
  };
  const ok = await readJson(await slotsHandle(getReq('/api/book/slots'), env, { now: NOW, fetch: okFetch }));
  assert.equal(ok.status, 200);
  assert.equal(ok.json.mode, 'live');
  assert.ok(!ok.json.slots.includes('2026-11-25T19:30:00Z'));
  assert.ok(!ok.json.slots.includes('2026-11-25T19:00:00Z'));
  assert.ok(!ok.json.slots.includes('2026-11-25T20:30:00Z'));
  assert.ok(ok.json.slots.includes('2026-11-25T21:00:00Z'));

  const failures = [
    async () => { throw new Error(`network fail ${ICAL_SECRET_URL}`); },
    async () => new Response(`bad ${ICAL_SECRET_URL}`, { status: 500 }),
    async () => new Response('not a calendar', { status: 200 }),
    async () => new Response(null, { status: 302, headers: { Location: 'http://downgrade.example.invalid/cal.ics' } }),
    async () => new Response('x'.repeat(2 * 1024 * 1024 + 1), { status: 200 }),
  ];
  for (const failFetch of failures) {
    const res = await readJson(await slotsHandle(getReq('/api/book/slots'), env, { now: NOW, fetch: failFetch }));
    assert.equal(res.status, 503);
    assert.equal(res.json.error, 'unavailable');
    assertNoSecrets(res.text);
  }
});

test('GET /api/book/slots in live mode prefers googleBusy when Google credentials are set', async () => {
  const store = fakeD1();
  const env = makeEnv(store, {
    BOOK_MODE: 'live',
    BOOK_ICAL_URL: ICAL_SECRET_URL,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REFRESH_TOKEN,
  });
  const seen = [];
  const gFetch = async url => {
    seen.push(String(url));
    if (String(url).includes('oauth2.googleapis.com')) {
      return Response.json({ access_token: 'fake-access-token' });
    }
    return Response.json({
      calendars: {
        primary: {
          busy: [{ start: '2026-11-25T19:30:00Z', end: '2026-11-25T20:30:00Z' }],
        },
      },
    });
  };
  const ok = await readJson(await slotsHandle(getReq('/api/book/slots'), env, { now: NOW, fetch: gFetch }));
  assert.equal(ok.status, 200);
  assert.ok(!seen.includes(ICAL_SECRET_URL));
  assert.ok(!ok.json.slots.includes('2026-11-25T19:30:00Z'));

  const fail = await readJson(await slotsHandle(getReq('/api/book/slots'), env, {
    now: NOW,
    fetch: async () => new Response('nope', { status: 500 }),
  }));
  assert.equal(fail.status, 503);
  assert.equal(fail.json.error, 'unavailable');
  assertNoSecrets(fail.text);
});

test('GET /api/book/slots enforces 120 requests/hour per visitor', async () => {
  const store = fakeD1();
  const env = makeEnv(store);
  for (let i = 0; i < 120; i++) {
    const res = await slotsHandle(getReq('/api/book/slots'), env, { now: NOW });
    assert.equal(res.status, 200);
  }
  const over = await readJson(await slotsHandle(getReq('/api/book/slots'), env, { now: NOW }));
  assert.equal(over.status, 429);
  assert.equal(over.json.error, 'rate_limited');
  assert.ok(Number(over.headers.get('retry-after')) > 0);
  const other = await slotsHandle(getReq('/api/book/slots', { ip: '198.51.100.99' }), env, { now: NOW });
  assert.equal(other.status, 200);
});

test('POST /api/book creates a booking, writes Google event, sends email with cancel link, and hides tokens', async () => {
  const store = fakeD1();
  const env = makeEnv(store, {
    RESEND_API_KEY: RESEND_SECRET,
    BOOK_OWNER_EMAIL: 'owner@example.com',
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REFRESH_TOKEN,
  });
  const slotsRes = await readJson(await slotsHandle(getReq('/api/book/slots'), env, { now: NOW }));
  const chosen = slotsRes.json.slots[0];

  const outbound = [];
  const mockFetch = async (url, init = {}) => {
    outbound.push({ url: String(url), method: init.method, body: init.body ? String(init.body) : '' });
    if (String(url).includes('oauth2.googleapis.com')) {
      return Response.json({ access_token: 'fake-access-token' });
    }
    if (String(url).includes('googleapis.com/calendar/v3/calendars')) {
      return Response.json({ id: 'gev-12345' }, { status: 200 });
    }
    if (String(url).includes('api.resend.com')) {
      return Response.json({ id: 'email-123' }, { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const res = await readJson(await bookHandle(postJson('/api/book', bookingPayload(chosen)), env, { now: NOW, fetch: mockFetch }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.json.ok, true);
  assert.equal(res.json.email, 'sent');
  assert.equal(res.json.booking.start, chosen);
  assert.equal(Date.parse(res.json.booking.end), Date.parse(chosen) + 30 * 60_000);
  assert.match(res.json.booking.id, /^[A-Za-z0-9_-]{22}$/);

  const rows = store.bookings();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, res.json.booking.id);
  assert.equal(rows[0].status, 'booked');
  assert.equal(rows[0].google_event, 'gev-12345');
  assert.match(rows[0].cancel_hash, /^[0-9a-f]{64}$/);

  const visitorMail = outbound.find(c => c.url.includes('api.resend.com'));
  const mailBody = JSON.parse(visitorMail.body);
  const cancelMatch = mailBody.text.match(/https:\/\/openwiz\.dev\/book\/\?cancel=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/);
  assert.ok(cancelMatch, 'cancel link in visitor email');
  assert.equal(cancelMatch[1], res.json.booking.id);
  const rawToken = cancelMatch[2];
  assert.ok(!store.dumpText().includes(rawToken), 'raw cancel token is never stored');
  assertNoSecrets(res.text, [rawToken]);
  assertNoSecrets(store.dumpText(), [rawToken]);
});

test('POST /api/book validates method, origin, content-type, size, exact keys, and field limits', async () => {
  const store = fakeD1();
  const env = makeEnv(store);
  const slotsRes = await readJson(await slotsHandle(getReq('/api/book/slots'), env, { now: NOW }));
  const chosen = slotsRes.json.slots[0];

  assert.equal((await bookHandle(getReq('/api/book', { method: 'GET' }), env, { now: NOW })).status, 405);

  const badRequests = [
    postJson('/api/book', bookingPayload(chosen), { origin: 'https://evil.example.invalid' }),
    postJson('/api/book', bookingPayload(chosen), { origin: null }),
    postJson('/api/book', bookingPayload(chosen), { contentType: 'text/plain' }),
    postJson('/api/book', bookingPayload(chosen), { rawBody: '{not json' }),
    postJson('/api/book', bookingPayload(chosen), { rawBody: JSON.stringify(bookingPayload(chosen)).padEnd(4097, ' ') }),
    postJson('/api/book', { ...bookingPayload(chosen), extra: 'nope' }),
    postJson('/api/book', (({ tz, ...rest }) => rest)(bookingPayload(chosen))),
    postJson('/api/book', bookingPayload(chosen, { name: '' })),
    postJson('/api/book', bookingPayload(chosen, { name: 'a'.repeat(81) })),
    postJson('/api/book', bookingPayload(chosen, { name: 'Bad\nName' })),
    postJson('/api/book', bookingPayload(chosen, { email: 'not-an-email' })),
    postJson('/api/book', bookingPayload(chosen, { email: 'a@example.com, b@example.com' })),
    postJson('/api/book', bookingPayload(chosen, { email: `${'a'.repeat(60)}@${'b'.repeat(200)}.com` })),
    postJson('/api/book', bookingPayload(chosen, { team: '' })),
    postJson('/api/book', bookingPayload(chosen, { team: 't'.repeat(201) })),
    postJson('/api/book', bookingPayload(chosen, { team: 'bad\u0007team' })),
    postJson('/api/book', bookingPayload('not-a-date')),
  ];

  for (const req of badRequests) {
    const res = await readJson(await bookHandle(req, env, { now: NOW }));
    assert.equal(res.status, 400, req.url);
    assert.equal(res.json.error, 'bad_request');
  }
  assert.equal(store.bookings().length, 0);
});

test('POST /api/book honeypot returns normal 200 shape and stores and sends nothing', async () => {
  const store = fakeD1();
  const env = makeEnv(store, { RESEND_API_KEY: RESEND_SECRET });
  const slotsRes = await readJson(await slotsHandle(getReq('/api/book/slots'), env, { now: NOW }));
  const chosen = slotsRes.json.slots[0];

  let fetchCalls = 0;
  const res = await readJson(await bookHandle(
    postJson('/api/book', bookingPayload(chosen, { website: 'https://spam.example.invalid' })),
    env,
    { now: NOW, fetch: async () => { fetchCalls += 1; return new Response('{}'); } },
  ));
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.booking.start, chosen);
  assert.ok(typeof res.json.booking.id === 'string' && res.json.booking.id.length > 0);
  assert.equal(store.bookings().length, 0);
  assert.equal(fetchCalls, 0);
});

test('POST /api/book refuses slots outside hours, inside a buffer, or double-booked (409 slot_taken)', async () => {
  const store = fakeD1();
  const env = makeEnv(store, { BOOK_MODE: 'live', BOOK_ICAL_URL: ICAL_SECRET_URL });
  const icalFetch = async () => new Response(SAMPLE_ICS, { status: 200 });

  const outsideHours = '2026-11-25T15:00:00Z';
  const insideBuffer = '2026-11-25T19:00:00Z';
  const weekend = '2026-11-28T19:00:00Z';
  for (const slot of [outsideHours, insideBuffer, weekend]) {
    const res = await readJson(await bookHandle(postJson('/api/book', bookingPayload(slot)), env, { now: NOW, fetch: icalFetch }));
    assert.equal(res.status, 409, slot);
    assert.equal(res.json.error, 'slot_taken');
  }

  const validSlot = '2026-11-25T21:00:00Z';
  const [first, second] = await Promise.all([
    bookHandle(postJson('/api/book', bookingPayload(validSlot, { email: 'one@example.com' }), { ip: '198.51.100.1' }), env, { now: NOW, fetch: icalFetch }).then(readJson),
    bookHandle(postJson('/api/book', bookingPayload(validSlot, { email: 'two@example.com' }), { ip: '198.51.100.2' }), env, { now: NOW, fetch: icalFetch }).then(readJson),
  ]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  assert.equal(store.bookings().length, 1);
});

test('POST /api/book enforces all booking rate limits (attempts/hr, bookings/day/visitor, upcoming/email, global/day)', async () => {
  const store1 = fakeD1();
  const env1 = makeEnv(store1);
  const badSlot = '2026-11-25T15:00:00Z';
  for (let i = 0; i < 10; i++) {
    const res = await bookHandle(postJson('/api/book', bookingPayload(badSlot)), env1, { now: NOW });
    assert.equal(res.status, 409);
  }
  const overAttempts = await readJson(await bookHandle(postJson('/api/book', bookingPayload(badSlot)), env1, { now: NOW }));
  assert.equal(overAttempts.status, 429);
  assert.equal(overAttempts.json.error, 'rate_limited');
  assert.ok(Number(overAttempts.headers.get('retry-after')) > 0);

  const store2 = fakeD1();
  const env2 = makeEnv(store2, { BOOK_MAX_PER_DAY: '20' });
  const slots2 = (await readJson(await slotsHandle(getReq('/api/book/slots'), env2, { now: NOW }))).json.slots;
  const pickSpaced = (list, count) => {
    const picked = [];
    for (const s of list) {
      const ms = Date.parse(s);
      if (picked.every(p => Math.abs(ms - Date.parse(p)) >= 60 * 60_000)) picked.push(s);
      if (picked.length === count) break;
    }
    return picked;
  };
  const four = pickSpaced(slots2, 4);
  assert.equal(four.length, 4);

  for (let i = 0; i < 3; i++) {
    const res = await readJson(await bookHandle(
      postJson('/api/book', bookingPayload(four[i], { email: `v${i}@example.com` }), { ip: '198.51.100.50' }),
      env2,
      { now: NOW },
    ));
    assert.equal(res.status, 200);
  }
  const overVisitorDay = await readJson(await bookHandle(
    postJson('/api/book', bookingPayload(four[3], { email: 'v3@example.com' }), { ip: '198.51.100.50' }),
    env2,
    { now: NOW },
  ));
  assert.equal(overVisitorDay.status, 429);
  assert.equal(overVisitorDay.json.error, 'rate_limited');

  const store3 = fakeD1();
  const env3 = makeEnv(store3, { BOOK_MAX_PER_DAY: '20' });
  const slots3 = pickSpaced((await readJson(await slotsHandle(getReq('/api/book/slots'), env3, { now: NOW }))).json.slots, 3);
  for (let i = 0; i < 2; i++) {
    const res = await bookHandle(
      postJson('/api/book', bookingPayload(slots3[i], { email: 'Same@Example.com' }), { ip: `198.51.100.${60 + i}` }),
      env3,
      { now: NOW },
    );
    assert.equal(res.status, 200);
  }
  const overEmail = await readJson(await bookHandle(
    postJson('/api/book', bookingPayload(slots3[2], { email: 'same@example.com' }), { ip: '198.51.100.69' }),
    env3,
    { now: NOW },
  ));
  assert.equal(overEmail.status, 429);
  assert.equal(overEmail.json.error, 'rate_limited');

  const store4 = fakeD1();
  const env4 = makeEnv(store4, { BOOK_MAX_PER_DAY: '20' });
  const slots4 = pickSpaced((await readJson(await slotsHandle(getReq('/api/book/slots'), env4, { now: NOW }))).json.slots, 21);
  assert.equal(slots4.length, 21);
  for (let i = 0; i < 20; i++) {
    const res = await bookHandle(
      postJson('/api/book', bookingPayload(slots4[i], { email: `g${i}@example.com` }), { ip: `198.51.100.${100 + i}` }),
      env4,
      { now: NOW },
    );
    assert.equal(res.status, 200);
  }
  const overGlobal = await readJson(await bookHandle(
    postJson('/api/book', bookingPayload(slots4[20], { email: 'g20@example.com' }), { ip: '198.51.100.200' }),
    env4,
    { now: NOW },
  ));
  assert.equal(overGlobal.status, 429);
  assert.equal(overGlobal.json.error, 'rate_limited');
});

test('POST /api/book/cancel cancels, reopens slot for rebooking, is idempotent, and rejects bad/past requests', async () => {
  const store = fakeD1();
  const env = makeEnv(store, {
    RESEND_API_KEY: RESEND_SECRET,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REFRESH_TOKEN,
  });
  const slotsBefore = (await readJson(await slotsHandle(getReq('/api/book/slots'), env, { now: NOW }))).json.slots;
  const chosen = slotsBefore[0];

  let cancelToken = '';
  let deletedEvents = 0;
  let cancelMails = 0;
  const mockFetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'tok' });
    if (u.includes('googleapis.com/calendar/v3/calendars') && init.method === 'POST') return Response.json({ id: 'gev-cancel-1' });
    if (u.includes('googleapis.com/calendar/v3/calendars') && init.method === 'DELETE') {
      deletedEvents += 1;
      return new Response(null, { status: 204 });
    }
    if (u.includes('api.resend.com')) {
      const payload = JSON.parse(String(init.body));
      const m = payload.text.match(/\?cancel=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/);
      if (m) cancelToken = m[2];
      else cancelMails += 1;
      return Response.json({ id: 'mail-1' });
    }
    throw new Error(`unexpected ${u}`);
  };

  const booked = await readJson(await bookHandle(postJson('/api/book', bookingPayload(chosen)), env, { now: NOW, fetch: mockFetch }));
  assert.equal(booked.status, 200);
  const id = booked.json.booking.id;
  assert.ok(cancelToken.length > 10);

  const slotsAfterBook = (await readJson(await slotsHandle(getReq('/api/book/slots'), env, { now: NOW }))).json.slots;
  assert.ok(!slotsAfterBook.includes(chosen));

  const wrongToken = await readJson(await cancelHandle(postJson('/api/book/cancel', { id, token: 'wrong-token' }), env, { now: NOW, fetch: mockFetch }));
  assert.equal(wrongToken.status, 404);
  assert.equal(wrongToken.json.error, 'not_found');

  const unknownId = await readJson(await cancelHandle(postJson('/api/book/cancel', { id: 'missing-id', token: cancelToken }), env, { now: NOW, fetch: mockFetch }));
  assert.equal(unknownId.status, 404);

  const pastCancel = await readJson(await cancelHandle(postJson('/api/book/cancel', { id, token: cancelToken }), env, { now: Date.parse(chosen) + 1000, fetch: mockFetch }));
  assert.equal(pastCancel.status, 404);

  const cancelled = await readJson(await cancelHandle(postJson('/api/book/cancel', { id, token: cancelToken }), env, { now: NOW, fetch: mockFetch }));
  assert.equal(cancelled.status, 200);
  assert.deepEqual(cancelled.json, { ok: true });
  assert.equal(deletedEvents, 1);
  assert.equal(cancelMails, 1);

  const secondCancel = await readJson(await cancelHandle(postJson('/api/book/cancel', { id, token: cancelToken }), env, { now: NOW, fetch: mockFetch }));
  assert.equal(secondCancel.status, 200);
  assert.deepEqual(secondCancel.json, { ok: true });
  assert.equal(deletedEvents, 1);
  assert.equal(cancelMails, 1);

  const slotsAfterCancel = (await readJson(await slotsHandle(getReq('/api/book/slots'), env, { now: NOW }))).json.slots;
  assert.ok(slotsAfterCancel.includes(chosen));

  const rebooked = await readJson(await bookHandle(postJson('/api/book', bookingPayload(chosen, { email: 'rebook@example.com' }), { ip: '198.51.100.77' }), env, { now: NOW, fetch: mockFetch }));
  assert.equal(rebooked.status, 200);
});

test('GET /api/book/feed returns 404 without token, 401 on mismatch, and 200 with bookings window', async () => {
  const store = fakeD1();
  const noToken = await readJson(await feedHandle(getReq('/api/book/feed'), makeEnv(store), { now: NOW }));
  assert.equal(noToken.status, 404);
  assert.equal(noToken.headers.get('cache-control'), 'no-store');

  const env = makeEnv(store, { BOOK_FEED_TOKEN: FEED_SECRET });
  for (const auth of [null, '', 'Basic abc', 'Bearer wrong', `Bearer ${FEED_SECRET}x`]) {
    const headers = auth === null ? {} : { Authorization: auth };
    const unauth = await readJson(await feedHandle(getReq('/api/book/feed', { headers }), env, { now: NOW }));
    assert.equal(unauth.status, 401);
    assertNoSecrets(unauth.text);
  }

  const slotsRes = await readJson(await slotsHandle(getReq('/api/book/slots'), env, { now: NOW }));
  const chosen = slotsRes.json.slots[0];
  const booked = await readJson(await bookHandle(postJson('/api/book', bookingPayload(chosen)), env, { now: NOW }));
  assert.equal(booked.status, 200);

  const ok = await readJson(await feedHandle(getReq('/api/book/feed', { headers: { Authorization: `Bearer ${FEED_SECRET}` } }), env, { now: NOW }));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.equal(ok.json.schema, 'openwiz.book.v1');
  assert.equal(ok.json.bookings.length, 1);
  assert.equal(ok.json.bookings[0].id, booked.json.booking.id);
  assert.equal(ok.json.bookings[0].start, chosen);
  assert.equal(ok.json.bookings[0].name, 'Alex Rivera');
  assert.equal(ok.json.bookings[0].email, 'alex@example.com');
  assert.equal(ok.json.bookings[0].team, 'Ten-person platform team');
  assert.equal(ok.json.bookings[0].status, 'booked');
  assert.match(ok.json.bookings[0].created, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal('cancel_hash' in ok.json.bookings[0], false);
  assertNoSecrets(ok.text);
});

test('D1 failures and timeouts answer 503 unavailable on all routes', async () => {
  const failing = fakeD1({ fails: true });
  const hanging = fakeD1({ hang: true });
  const chosen = '2026-11-25T21:00:00Z';

  for (const [store, opts] of [[failing, { now: NOW }], [hanging, { now: NOW, storeTimeout: 25 }]]) {
    const env = makeEnv(store, { BOOK_FEED_TOKEN: FEED_SECRET });
    const s = await readJson(await slotsHandle(getReq('/api/book/slots'), env, opts));
    assert.equal(s.status, 503);
    assert.equal(s.json.error, 'unavailable');

    const b = await readJson(await bookHandle(postJson('/api/book', bookingPayload(chosen)), env, opts));
    assert.equal(b.status, 503);
    assert.equal(b.json.error, 'unavailable');

    const c = await readJson(await cancelHandle(postJson('/api/book/cancel', { id: 'abc', token: 'def' }), env, opts));
    assert.equal(c.status, 503);
    assert.equal(c.json.error, 'unavailable');

    const f = await readJson(await feedHandle(getReq('/api/book/feed', { headers: { Authorization: `Bearer ${FEED_SECRET}` } }), env, opts));
    assert.equal(f.status, 503);
    assert.equal(f.json.error, 'unavailable');
  }
});

test('onRequest entry points dispatch to handle for all four routes', async () => {
  const store = fakeD1();
  const env = makeEnv(store, { BOOK_FEED_TOKEN: FEED_SECRET });
  assert.equal((await slotsOnRequest({ request: getReq('/api/book/slots'), env })).status, 200);
  assert.equal((await bookOnRequest({ request: getReq('/api/book', { method: 'GET' }), env })).status, 405);
  assert.equal((await cancelOnRequest({ request: getReq('/api/book/cancel', { method: 'GET' }), env })).status, 405);
  assert.equal((await feedOnRequest({ request: getReq('/api/book/feed', { headers: { Authorization: `Bearer ${FEED_SECRET}` } }), env })).status, 200);
});

test('iCal follows HTTPS redirects and times out cleanly without leaking URL', async () => {
  const store = fakeD1();
  const env = makeEnv(store, { BOOK_MODE: 'live', BOOK_ICAL_URL: ICAL_SECRET_URL });
  let hops = 0;
  const redirectFetch = async url => {
    hops += 1;
    if (String(url) === ICAL_SECRET_URL) {
      return new Response(null, { status: 302, headers: { Location: 'https://calendar.example.invalid/final.ics' } });
    }
    return new Response(SAMPLE_ICS, { status: 200 });
  };
  const ok = await readJson(await slotsHandle(getReq('/api/book/slots'), env, { now: NOW, fetch: redirectFetch }));
  assert.equal(ok.status, 200);
  assert.equal(hops, 2);

  const hangingFetch = (_url, init = {}) => new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(new Error(`timeout ${ICAL_SECRET_URL}`)));
  });
  const timedOut = await readJson(await slotsHandle(getReq('/api/book/slots'), env, { now: NOW, fetch: hangingFetch, icalTimeout: 25 }));
  assert.equal(timedOut.status, 503);
  assert.equal(timedOut.json.error, 'unavailable');
  assertNoSecrets(timedOut.text);
});

test('POST /api/book succeeds when Google insert fails and reports skipped or failed email', async () => {
  const store = fakeD1();
  const envSkipped = makeEnv(store, {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REFRESH_TOKEN,
  });
  const slots = (await readJson(await slotsHandle(getReq('/api/book/slots'), envSkipped, { now: NOW }))).json.slots;
  const failingFetch = async () => new Response('upstream error', { status: 500 });

  const skipped = await readJson(await bookHandle(
    postJson('/api/book', bookingPayload(slots[0], { email: 'skip@example.com' }), { ip: '198.51.100.11' }),
    envSkipped,
    { now: NOW, fetch: failingFetch },
  ));
  assert.equal(skipped.status, 200);
  assert.equal(skipped.json.email, 'skipped');
  assert.equal(store.bookings()[0].google_event, null);

  const envFailedMail = makeEnv(store, { RESEND_API_KEY: RESEND_SECRET });
  const failed = await readJson(await bookHandle(
    postJson('/api/book', bookingPayload(slots[slots.length - 1], { email: 'fail@example.com' }), { ip: '198.51.100.12' }),
    envFailedMail,
    { now: NOW, fetch: failingFetch },
  ));
  assert.equal(failed.status, 200);
  assert.equal(failed.json.email, 'failed');
});

test('concurrent double booking hits the unique index and returns one 200 and one 409', async () => {
  const store = fakeD1();
  const env = makeEnv(store, { BOOK_MODE: 'live', BOOK_ICAL_URL: ICAL_SECRET_URL });
  let release;
  let waiting = 0;
  const barrier = new Promise(resolve => { release = resolve; });
  const syncedFetch = async () => {
    waiting += 1;
    if (waiting === 2) release();
    await barrier;
    return new Response(SAMPLE_ICS, { status: 200 });
  };
  const slot = '2026-11-25T21:00:00Z';
  const [a, b] = await Promise.all([
    bookHandle(postJson('/api/book', bookingPayload(slot, { email: 'race1@example.com' }), { ip: '198.51.100.21' }), env, { now: NOW, fetch: syncedFetch }).then(readJson),
    bookHandle(postJson('/api/book', bookingPayload(slot, { email: 'race2@example.com' }), { ip: '198.51.100.22' }), env, { now: NOW, fetch: syncedFetch }).then(readJson),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(store.bookings().length, 1);
});

test('GET /api/book/feed enforces the 7-day-back to horizon window and includes cancelled rows', async () => {
  const store = fakeD1();
  const env = makeEnv(store, { BOOK_FEED_TOKEN: FEED_SECRET });
  await slotsHandle(getReq('/api/book/slots'), env, { now: NOW });

  const dayMs = 86_400_000;
  const insert = store.db.prepare(
    'INSERT INTO book_bookings (id, start, end, name, email, team, tz, status, cancel_hash, google_event, created) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)',
  );
  insert.run('too-old', NOW - 8 * dayMs, NOW - 8 * dayMs + 1800_000, 'Old', 'old@example.com', 'T', 'UTC', 'booked', 'a'.repeat(64), NOW - 9 * dayMs);
  insert.run('recent-cancel', NOW - 3 * dayMs, NOW - 3 * dayMs + 1800_000, 'Mid', 'mid@example.com', 'T', 'UTC', 'cancelled', 'b'.repeat(64), NOW - 4 * dayMs);
  insert.run('future-ok', NOW + 2 * dayMs, NOW + 2 * dayMs + 1800_000, 'Fut', 'fut@example.com', 'T', 'UTC', 'booked', 'c'.repeat(64), NOW);
  insert.run('too-far', NOW + 20 * dayMs, NOW + 20 * dayMs + 1800_000, 'Far', 'far@example.com', 'T', 'UTC', 'booked', 'd'.repeat(64), NOW);

  const res = await readJson(await feedHandle(
    getReq('/api/book/feed', { headers: { Authorization: `Bearer ${FEED_SECRET}` } }),
    env,
    { now: NOW },
  ));
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.bookings.map(b => [b.id, b.status]), [
    ['recent-cancel', 'cancelled'],
    ['future-ok', 'booked'],
  ]);
});
