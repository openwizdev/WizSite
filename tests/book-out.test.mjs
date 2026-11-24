import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { icsFor, sendBookingMail, sendCancelMail } from '../lib/book/mail.js';
import { googleReady, googleBusy, googleInsert, googleDelete } from '../lib/book/google.js';

const RESEND_URL = 'https://api.resend.com/emails';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_FREEBUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy';

const RESEND_KEY = 're_fake_key_0123456789abcdef';
const CLIENT_ID = 'fake-google-client-id.apps.googleusercontent.com';
const CLIENT_SECRET = 'fake-google-client-secret-xyz987';
const REFRESH_TOKEN = '1//fake-google-refresh-token-abc123';
const ACCESS_TOKEN = 'ya29.fake-google-access-token-secret456';

const START = Date.parse('2026-11-25T19:00:00Z');
const END = Date.parse('2026-11-25T19:30:00Z');
const NOW = Date.parse('2026-11-24T12:34:56Z');

const BOOKING = {
  id: 'bk_test_id_0123456789',
  start: START,
  end: END,
  name: 'Alex Rivera',
  email: 'visitor@example.com',
  team: 'Building a 12-person platform team',
  tz: 'America/New_York',
  cancelUrl: 'https://openwiz.dev/book/?cancel=bk_test_id_0123456789.faketoken123',
};

const MAIL_ENV = {
  RESEND_API_KEY: RESEND_KEY,
  BOOK_FROM: 'OpenWiz <book@openwiz.dev>',
  BOOK_OWNER_EMAIL: 'owner@example.com',
  BOOK_MEETING_URL: 'https://meet.example.com/openwiz-room',
};

const GOOGLE_ENV = {
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN: REFRESH_TOKEN,
};

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

function decodeBase64Utf8(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function unescapeIcs(value) {
  return value.replace(/\\([\\;,nN])/g, (_, ch) => {
    if (ch === 'n' || ch === 'N') return '\n';
    return ch;
  });
}

function parseIcs(ics) {
  assert.ok(ics.endsWith('\r\n'), 'ICS must end with CRLF');
  assert.equal(ics.replace(/\r\n/g, '').includes('\n'), false, 'ICS must not have bare LF');
  assert.equal(ics.replace(/\r\n/g, '').includes('\r'), false, 'ICS must not have bare CR');

  const rawLines = ics.slice(0, -2).split('\r\n');
  const encoder = new TextEncoder();
  for (const line of rawLines) {
    assert.ok(encoder.encode(line).length <= 75, `ICS line exceeds 75 octets: ${line}`);
  }

  const unfolded = [];
  for (const line of rawLines) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      assert.ok(unfolded.length > 0, 'Continuation line cannot be first');
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }

  const props = {};
  const counts = {};
  for (const line of unfolded) {
    const idx = line.indexOf(':');
    assert.ok(idx > 0, `Malformed ICS line: ${line}`);
    const key = line.slice(0, idx);
    const val = line.slice(idx + 1);
    counts[key] = (counts[key] || 0) + 1;
    props[key] = val;
  }
  return { rawLines, unfolded, props, counts };
}

function makeRecorder(handlers) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: init.method || 'GET',
      headers: new Headers(init.headers),
      body: init.body,
      signal: init.signal,
    };
    calls.push(call);
    const idx = calls.length - 1;
    const handler = Array.isArray(handlers) ? handlers[idx] : handlers;
    assert.ok(handler, `Unexpected fetch call #${idx + 1} to ${call.url}`);
    return handler(call, idx);
  };
  return { calls, fetch };
}

function timeoutError() {
  return new DOMException('The operation was aborted due to timeout', 'TimeoutError');
}

test('icsFor: generates valid folded RFC 5545 VCALENDAR that parses back', () => {
  const trickyUrl = 'https://meet.example.com/room;team=a,b\\c?long=' + 'x'.repeat(80) + '&note=café';
  const ics = icsFor(BOOKING, { BOOK_MEETING_URL: trickyUrl }, NOW);
  const { rawLines, props, counts } = parseIcs(ics);

  assert.ok(rawLines.some(line => line.startsWith(' ')), 'Long LOCATION should fold across lines');
  assert.equal(counts.BEGIN, 2);
  assert.equal(counts.END, 2);
  assert.equal(props.VERSION, '2.0');
  assert.equal(props.UID, `${BOOKING.id}@openwiz.dev`);
  assert.equal(props.DTSTAMP, '20261124T123456Z');
  assert.equal(props.DTSTART, '20261125T190000Z');
  assert.equal(props.DTEND, '20261125T193000Z');
  assert.equal(props.SUMMARY, 'OpenWiz call');
  assert.equal(unescapeIcs(props.LOCATION), trickyUrl);
  assert.equal(ics.includes(BOOKING.name), false);
  assert.equal(ics.includes(BOOKING.team), false);

  const defaultIcs = icsFor(BOOKING, {});
  const { props: defaultProps } = parseIcs(defaultIcs);
  assert.notEqual(defaultProps.DTSTAMP, defaultProps.DTSTART);
});

test('icsFor: omits LOCATION when BOOK_MEETING_URL is not set', () => {
  const ics = icsFor(BOOKING, {});
  const { props } = parseIcs(ics);
  assert.equal('LOCATION' in props, false);
  assert.equal(props.UID, `${BOOKING.id}@openwiz.dev`);
  assert.equal(props.SUMMARY, 'OpenWiz call');
});

test('sendBookingMail: returns skipped with no RESEND_API_KEY and makes no requests', async () => {
  const { calls, fetch } = makeRecorder([]);
  assert.equal(await sendBookingMail({}, BOOKING, { fetch }), 'skipped');
  assert.equal(await sendBookingMail({ RESEND_API_KEY: '   ' }, BOOKING, { fetch }), 'skipped');
  assert.equal(calls.length, 0);
});

test('sendBookingMail: sends visitor confirmation with .ics and owner notice with escaped fields', async () => {
  const { calls, fetch } = makeRecorder([
    () => Response.json({ id: 'email_visitor_1' }),
    () => Response.json({ id: 'email_owner_1' }),
  ]);

  const result = await sendBookingMail(MAIL_ENV, BOOKING, { fetch, now: NOW });
  assert.equal(result, 'sent');
  assert.equal(calls.length, 2);

  const [vCall, oCall] = calls;
  assert.equal(vCall.url, RESEND_URL);
  assert.equal(vCall.method, 'POST');
  assert.equal(vCall.headers.get('Authorization'), `Bearer ${RESEND_KEY}`);
  assert.equal(vCall.headers.get('Content-Type'), 'application/json');
  assert.ok(vCall.headers.get('Idempotency-Key').includes(BOOKING.id));
  assert.ok(vCall.signal instanceof AbortSignal);

  const vBody = JSON.parse(vCall.body);
  assert.equal(vBody.from, MAIL_ENV.BOOK_FROM);
  assert.deepEqual(vBody.to, [BOOKING.email]);
  assert.equal('reply_to' in vBody, false);
  assert.ok(vBody.text.includes('2:00 PM'));
  assert.ok(vBody.text.includes('11:00 AM'));
  assert.ok(vBody.text.includes('30 minutes'));
  assert.ok(vBody.text.includes(MAIL_ENV.BOOK_MEETING_URL));
  assert.ok(vBody.text.includes(BOOKING.cancelUrl));
  assert.ok(vBody.html.includes('2:00 PM'));
  assert.ok(vBody.html.includes('11:00 AM'));
  assert.ok(vBody.html.includes(MAIL_ENV.BOOK_MEETING_URL));
  assert.ok(vBody.html.includes(BOOKING.cancelUrl));
  assert.equal(vBody.attachments.length, 1);
  assert.equal(vBody.attachments[0].filename, 'openwiz-call.ics');
  assert.equal(decodeBase64Utf8(vBody.attachments[0].content), icsFor(BOOKING, MAIL_ENV, NOW));

  assert.equal(oCall.url, RESEND_URL);
  assert.equal(oCall.method, 'POST');
  assert.equal(oCall.headers.get('Authorization'), `Bearer ${RESEND_KEY}`);
  assert.ok(oCall.headers.get('Idempotency-Key').includes(BOOKING.id));
  assert.notEqual(oCall.headers.get('Idempotency-Key'), vCall.headers.get('Idempotency-Key'));
  assert.ok(oCall.signal instanceof AbortSignal);

  const oBody = JSON.parse(oCall.body);
  assert.equal(oBody.from, MAIL_ENV.BOOK_FROM);
  assert.deepEqual(oBody.to, [MAIL_ENV.BOOK_OWNER_EMAIL]);
  assert.equal(oBody.reply_to, BOOKING.email);
  assert.ok(oBody.text.includes(BOOKING.name));
  assert.ok(oBody.text.includes(BOOKING.team));
  assert.ok(oBody.text.includes('11:00 AM'));
  assert.ok(oBody.html.includes(BOOKING.name));
  assert.ok(oBody.html.includes(BOOKING.team));
  assert.ok(oBody.html.includes('11:00 AM'));
});

test('sendBookingMail: visitor message never carries visitor-typed markup or URLs; owner HTML escapes them', async () => {
  const hostile = {
    ...BOOKING,
    name: '<script>alert("xss")</script> https://phish.example/login',
    team: 'Visit https://spam.example/offer & click <a href="https://evil.example">here</a>',
    tz: '<img src=x onerror=alert(1)>',
  };
  const { calls, fetch } = makeRecorder([
    () => Response.json({ id: 'v1' }),
    () => Response.json({ id: 'o1' }),
  ]);

  const result = await sendBookingMail({ RESEND_API_KEY: RESEND_KEY, BOOK_OWNER_EMAIL: 'owner@example.com' }, hostile, { fetch });
  assert.equal(result, 'sent');

  const vBody = JSON.parse(calls[0].body);
  assert.equal(vBody.from, 'OpenWiz <book@openwiz.dev>');
  const vAll = [vBody.subject, vBody.text, vBody.html, decodeBase64Utf8(vBody.attachments[0].content)].join('\n');
  for (const needle of ['<script>', 'alert', 'phish.example', 'spam.example', 'evil.example', 'onerror', hostile.name, hostile.team, hostile.tz]) {
    assert.equal(vAll.includes(needle), false, `Visitor email leaked: ${needle}`);
  }
  assert.ok(vBody.text.includes('11:00 AM'));
  assert.match(vBody.text, /follow/i);

  const oBody = JSON.parse(calls[1].body);
  assert.equal(oBody.html.includes('<script>'), false);
  assert.equal(oBody.html.includes('<a href="https://evil.example">'), false);
  assert.ok(oBody.html.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'));
  assert.ok(oBody.html.includes('&amp; click &lt;a href=&quot;https://evil.example&quot;&gt;here&lt;/a&gt;'));
});

test('sendBookingMail: skips owner email when BOOK_OWNER_EMAIL is unset', async () => {
  const { calls, fetch } = makeRecorder([() => Response.json({ id: 'v1' })]);
  const result = await sendBookingMail({ RESEND_API_KEY: RESEND_KEY }, BOOKING, { fetch });
  assert.equal(result, 'sent');
  assert.equal(calls.length, 1);
});

test('sendBookingMail: result is visitor outcome even when owner mail fails', async () => {
  const { calls, fetch } = makeRecorder([
    () => Response.json({ id: 'v1' }),
    () => new Response('upstream error', { status: 500 }),
  ]);
  const result = await sendBookingMail(MAIL_ENV, BOOKING, { fetch });
  assert.equal(result, 'sent');
  assert.equal(calls.length, 2);
});

test('sendBookingMail: failure paths (timeout, non-2xx, malformed JSON) return failed without throwing', async () => {
  const envNoOwner = { RESEND_API_KEY: RESEND_KEY };
  assert.equal(
    await sendBookingMail(envNoOwner, BOOKING, { fetch: async () => { throw timeoutError(); } }),
    'failed',
  );
  assert.equal(
    await sendBookingMail(envNoOwner, BOOKING, { fetch: async () => new Response('rate limited', { status: 429 }) }),
    'failed',
  );
  assert.equal(
    await sendBookingMail(envNoOwner, BOOKING, { fetch: async () => new Response('not json{', { status: 200 }) }),
    'failed',
  );
});

test('sendCancelMail: skips without key, sends both recipients, strips visitor text, handles failures', async () => {
  const { calls: skipCalls, fetch: skipFetch } = makeRecorder([]);
  assert.equal(await sendCancelMail({}, BOOKING, { fetch: skipFetch }), 'skipped');
  assert.equal(skipCalls.length, 0);

  const hostile = {
    ...BOOKING,
    name: '<b>Mallory</b> https://evil.example/cancel',
    team: 'Click https://spam.example/cancel',
  };
  const { calls, fetch } = makeRecorder([
    () => Response.json({ id: 'cv1' }),
    () => Response.json({ id: 'co1' }),
  ]);
  const result = await sendCancelMail(MAIL_ENV, hostile, { fetch });
  assert.equal(result, 'sent');
  assert.equal(calls.length, 2);

  const vBody = JSON.parse(calls[0].body);
  const oBody = JSON.parse(calls[1].body);
  assert.deepEqual(vBody.to, [BOOKING.email]);
  assert.ok(calls[0].headers.get('Idempotency-Key').includes(BOOKING.id));
  assert.notEqual(calls[0].headers.get('Idempotency-Key'), calls[1].headers.get('Idempotency-Key'));
  const vAll = [vBody.subject, vBody.text, vBody.html].join('\n');
  assert.equal(vAll.includes('Mallory'), false);
  assert.equal(vAll.includes('evil.example'), false);
  assert.equal(vAll.includes('spam.example'), false);
  assert.ok(vBody.text.includes('2:00 PM'));
  assert.ok(vBody.text.includes('11:00 AM'));

  assert.deepEqual(oBody.to, [MAIL_ENV.BOOK_OWNER_EMAIL]);
  assert.equal(oBody.reply_to, BOOKING.email);
  assert.equal(oBody.html.includes('<b>Mallory</b>'), false);
  assert.ok(oBody.html.includes('&lt;b&gt;Mallory&lt;/b&gt;'));

  const envNoOwner = { RESEND_API_KEY: RESEND_KEY };
  assert.equal(await sendCancelMail(envNoOwner, BOOKING, { fetch: async () => { throw timeoutError(); } }), 'failed');
  assert.equal(await sendCancelMail(envNoOwner, BOOKING, { fetch: async () => new Response('err', { status: 502 }) }), 'failed');
  assert.equal(await sendCancelMail(envNoOwner, BOOKING, { fetch: async () => new Response('{bad', { status: 200 }) }), 'failed');
});

test('sendBookingMail and sendCancelMail: return failed without throwing or calling fetch on bad booking or non-bare email', async () => {
  const badBookings = [
    null,
    undefined,
    { ...BOOKING, start: Number.NaN },
    { ...BOOKING, start: Number.POSITIVE_INFINITY },
    { ...BOOKING, start: 'not-a-number' },
    { ...BOOKING, end: Number.NaN },
    { ...BOOKING, end: undefined },
  ];
  const badEmails = [
    '',
    'not-an-email',
    'Alex <visitor@example.com>',
    '<visitor@example.com>',
    'a@example.com,b@example.com',
    'a@example.com;b@example.com',
    'visitor @example.com',
    'visitor@example.com\r\nBcc: other@example.com',
    'visitor@example.com\n',
    'visitor@example.com\u0000',
  ];

  const { calls, fetch } = makeRecorder([]);
  for (const bad of badBookings) {
    assert.equal(await sendBookingMail(MAIL_ENV, bad, { fetch }), 'failed');
    assert.equal(await sendCancelMail(MAIL_ENV, bad, { fetch }), 'failed');
  }
  for (const email of badEmails) {
    assert.equal(await sendBookingMail(MAIL_ENV, { ...BOOKING, email }, { fetch }), 'failed');
    assert.equal(await sendCancelMail(MAIL_ENV, { ...BOOKING, email }, { fetch }), 'failed');
  }
  assert.equal(calls.length, 0);
});

test('googleReady: true only when all three Google credentials are non-empty', () => {
  assert.equal(googleReady(GOOGLE_ENV), true);
  assert.equal(googleReady({}), false);
  assert.equal(googleReady(null), false);
  assert.equal(googleReady({ ...GOOGLE_ENV, GOOGLE_CLIENT_ID: '' }), false);
  assert.equal(googleReady({ ...GOOGLE_ENV, GOOGLE_CLIENT_SECRET: '   ' }), false);
  assert.equal(googleReady({ ...GOOGLE_ENV, GOOGLE_REFRESH_TOKEN: undefined }), false);
});

test('googleBusy: exchanges refresh token, queries freeBusy, merges overlapping intervals ascending', async () => {
  const fromMs = Date.parse('2026-11-25T16:00:00Z');
  const toMs = Date.parse('2026-11-26T04:00:00Z');
  const env = { ...GOOGLE_ENV, BOOK_GOOGLE_CALENDAR: 'team@example.com' };

  const { calls, fetch } = makeRecorder([
    () => Response.json({ access_token: ACCESS_TOKEN, expires_in: 3600 }),
    () => Response.json({
      calendars: {
        'team@example.com': {
          busy: [
            { start: '2026-11-25T21:00:00Z', end: '2026-11-25T22:00:00Z' },
            { start: '2026-11-25T18:00:00Z', end: '2026-11-25T19:00:00Z' },
            { start: '2026-11-25T18:30:00Z', end: '2026-11-25T19:30:00Z' },
            { start: '2026-11-25T19:30:00Z', end: '2026-11-25T20:00:00Z' },
          ],
        },
      },
    }),
  ]);

  const busy = await googleBusy(env, fromMs, toMs, { fetch });
  assert.deepEqual(busy, [
    { start: Date.parse('2026-11-25T18:00:00Z'), end: Date.parse('2026-11-25T20:00:00Z') },
    { start: Date.parse('2026-11-25T21:00:00Z'), end: Date.parse('2026-11-25T22:00:00Z') },
  ]);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, GOOGLE_TOKEN_URL);
  assert.equal(calls[0].method, 'POST');
  assert.ok(calls[0].signal instanceof AbortSignal);
  const tokenParams = new URLSearchParams(calls[0].body);
  assert.equal(tokenParams.get('client_id'), CLIENT_ID);
  assert.equal(tokenParams.get('client_secret'), CLIENT_SECRET);
  assert.equal(tokenParams.get('refresh_token'), REFRESH_TOKEN);
  assert.equal(tokenParams.get('grant_type'), 'refresh_token');

  assert.equal(calls[1].url, GOOGLE_FREEBUSY_URL);
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].headers.get('Authorization'), `Bearer ${ACCESS_TOKEN}`);
  assert.ok(calls[1].signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(calls[1].body), {
    timeMin: '2026-11-25T16:00:00.000Z',
    timeMax: '2026-11-26T04:00:00.000Z',
    items: [{ id: 'team@example.com' }],
  });
});

test('googleBusy: any failure throws Error with code calendar_unreadable and leaks nothing', async () => {
  const fromMs = Date.parse('2026-11-25T16:00:00Z');
  const toMs = Date.parse('2026-11-26T04:00:00Z');
  const secretLeakBody = `secret-body-${CLIENT_SECRET}-${REFRESH_TOKEN}-${ACCESS_TOKEN}`;

  const cases = [
    ['not ready', {}, []],
    ['token timeout', GOOGLE_ENV, [() => { throw timeoutError(); }]],
    ['token non-2xx', GOOGLE_ENV, [() => new Response(secretLeakBody, { status: 401 })]],
    ['token malformed JSON', GOOGLE_ENV, [() => new Response(secretLeakBody, { status: 200 })]],
    ['freeBusy timeout', GOOGLE_ENV, [
      () => Response.json({ access_token: ACCESS_TOKEN }),
      () => { throw timeoutError(); },
    ]],
    ['freeBusy non-2xx', GOOGLE_ENV, [
      () => Response.json({ access_token: ACCESS_TOKEN }),
      () => new Response(secretLeakBody, { status: 503 }),
    ]],
    ['freeBusy malformed JSON', GOOGLE_ENV, [
      () => Response.json({ access_token: ACCESS_TOKEN }),
      () => new Response(secretLeakBody, { status: 200 }),
    ]],
    ['freeBusy calendar errors', GOOGLE_ENV, [
      () => Response.json({ access_token: ACCESS_TOKEN }),
      () => Response.json({ calendars: { primary: { errors: [{ domain: 'global', reason: 'notFound' }], busy: [] } } }),
    ]],
  ];

  for (const [label, env, handlers] of cases) {
    const { fetch } = makeRecorder(handlers);
    await assert.rejects(
      () => googleBusy(env, fromMs, toMs, { fetch }),
      (err) => {
        assert.ok(err instanceof Error, `${label}: expected Error`);
        assert.equal(err.code, 'calendar_unreadable', `${label}: expected calendar_unreadable`);
        for (const secret of [CLIENT_SECRET, REFRESH_TOKEN, ACCESS_TOKEN, 'secret-body']) {
          assert.equal(err.message.includes(secret), false, `${label}: leaked ${secret}`);
        }
        return true;
      },
    );
  }
});

test('googleInsert: inserts event with deterministic id, sendUpdates=none, and handles retry 409', async () => {
  const { calls, fetch } = makeRecorder([
    () => Response.json({ access_token: ACCESS_TOKEN }),
    (call) => Response.json({ id: JSON.parse(call.body).id }),
    () => Response.json({ access_token: ACCESS_TOKEN }),
    () => new Response('conflict', { status: 409 }),
  ]);

  const id1 = await googleInsert({ ...GOOGLE_ENV, BOOK_MEETING_URL: MAIL_ENV.BOOK_MEETING_URL }, BOOKING, { fetch });
  const id2 = await googleInsert(GOOGLE_ENV, BOOKING, { fetch });

  assert.equal(typeof id1, 'string');
  assert.match(id1, /^[a-v0-9]{5,1024}$/);
  assert.equal(id2, id1);

  const other = await googleInsert(GOOGLE_ENV, { ...BOOKING, id: 'bk_other_id_9876543210' }, {
    fetch: makeRecorder([
      () => Response.json({ access_token: ACCESS_TOKEN }),
      (call) => Response.json({ id: JSON.parse(call.body).id }),
    ]).fetch,
  });
  assert.notEqual(other, id1);

  assert.equal(calls[1].url, 'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none');
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].headers.get('Authorization'), `Bearer ${ACCESS_TOKEN}`);
  assert.ok(calls[1].signal instanceof AbortSignal);

  const event = JSON.parse(calls[1].body);
  assert.equal(event.id, id1);
  assert.equal(event.summary, `OpenWiz call: ${BOOKING.name}`);
  assert.ok(event.description.includes(BOOKING.name));
  assert.ok(event.description.includes(BOOKING.team));
  assert.ok(event.description.includes(BOOKING.email));
  assert.equal('attendees' in event, false);
  assert.equal(event.start.dateTime, '2026-11-25T19:00:00.000Z');
  assert.equal(event.end.dateTime, '2026-11-25T19:30:00.000Z');
  assert.equal(event.location, MAIL_ENV.BOOK_MEETING_URL);
});

test('googleInsert: returns null on any failure without throwing', async () => {
  assert.equal(await googleInsert({}, BOOKING, { fetch: makeRecorder([]).fetch }), null);
  assert.equal(
    await googleInsert(GOOGLE_ENV, BOOKING, { fetch: makeRecorder([() => { throw timeoutError(); }]).fetch }),
    null,
  );
  assert.equal(
    await googleInsert(GOOGLE_ENV, BOOKING, {
      fetch: makeRecorder([
        () => Response.json({ access_token: ACCESS_TOKEN }),
        () => new Response('forbidden', { status: 403 }),
      ]).fetch,
    }),
    null,
  );
  assert.equal(
    await googleInsert(GOOGLE_ENV, BOOKING, {
      fetch: makeRecorder([
        () => Response.json({ access_token: ACCESS_TOKEN }),
        () => new Response('not json', { status: 200 }),
      ]).fetch,
    }),
    null,
  );
});

test('googleDelete: true on 204/404/410, false on failures without throwing', async () => {
  const env = { ...GOOGLE_ENV, BOOK_GOOGLE_CALENDAR: 'team@example.com' };
  const eventId = 'abc123def456';

  for (const status of [204, 404, 410]) {
    const { calls, fetch } = makeRecorder([
      () => Response.json({ access_token: ACCESS_TOKEN }),
      () => new Response(null, { status }),
    ]);
    assert.equal(await googleDelete(env, eventId, { fetch }), true);
    assert.equal(
      calls[1].url,
      'https://www.googleapis.com/calendar/v3/calendars/team%40example.com/events/abc123def456?sendUpdates=none',
    );
    assert.equal(calls[1].method, 'DELETE');
    assert.equal(calls[1].headers.get('Authorization'), `Bearer ${ACCESS_TOKEN}`);
    assert.ok(calls[1].signal instanceof AbortSignal);
  }

  assert.equal(await googleDelete({}, eventId, { fetch: makeRecorder([]).fetch }), false);
  assert.equal(await googleDelete(GOOGLE_ENV, '', { fetch: makeRecorder([]).fetch }), false);
  assert.equal(
    await googleDelete(GOOGLE_ENV, eventId, {
      fetch: makeRecorder([
        () => Response.json({ access_token: ACCESS_TOKEN }),
        () => new Response('err', { status: 500 }),
      ]).fetch,
    }),
    false,
  );
  assert.equal(
    await googleDelete(GOOGLE_ENV, eventId, {
      fetch: makeRecorder([
        () => Response.json({ access_token: ACCESS_TOKEN }),
        () => { throw timeoutError(); },
      ]).fetch,
    }),
    false,
  );
});
