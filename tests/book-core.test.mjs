import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { busyFromIcal } from '../lib/book/ical.js';
import { settings, openSlots, window as bookWindow } from '../lib/book/slots.js';
import { fakeBusy } from '../lib/book/fake.js';

const FIXTURE_DIR = new URL('./book-fixtures/ical/', import.meta.url);
const readFixture = (name) => readFile(new URL(name, FIXTURE_DIR), 'utf8');
const iso = (s) => Date.parse(s);
const fmtLocal = (ms, timeZone) => new Intl.DateTimeFormat('en-CA', {
  timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
}).format(new Date(ms));

test('ical: unfolding, UTC, DURATION, TZID, X-WR-TIMEZONE, VALARM ignored, overlapping merged', async () => {
  const ics = await readFixture('basic.ics');
  const busy = busyFromIcal(ics, iso('2026-05-04T00:00:00Z'), iso('2026-05-05T00:00:00Z'));
  assert.deepEqual(busy, [
    { start: iso('2026-05-04T16:00:00Z'), end: iso('2026-05-04T17:30:00Z') },
    { start: iso('2026-05-04T19:00:00Z'), end: iso('2026-05-04T20:00:00Z') },
    { start: iso('2026-05-04T21:00:00Z'), end: iso('2026-05-04T21:30:00Z') },
  ]);
});

test('ical: floating time defaults to UTC without X-WR-TIMEZONE', async () => {
  const ics = await readFixture('floating-utc.ics');
  const busy = busyFromIcal(ics, iso('2026-05-06T00:00:00Z'), iso('2026-05-07T00:00:00Z'));
  assert.deepEqual(busy, [
    { start: iso('2026-05-06T14:00:00Z'), end: iso('2026-05-06T15:00:00Z') },
  ]);
});

test('ical: all-day, transparent, and cancelled events are not busy', async () => {
  const ics = await readFixture('not-busy.ics');
  const busy = busyFromIcal(ics, iso('2026-05-05T00:00:00Z'), iso('2026-05-06T00:00:00Z'));
  assert.deepEqual(busy, [
    { start: iso('2026-05-05T20:00:00Z'), end: iso('2026-05-05T20:30:00Z') },
  ]);
});

test('ical: RRULE DAILY and WEEKLY with INTERVAL, COUNT, UNTIL, BYDAY, WKST', async () => {
  const ics = await readFixture('rrule-daily-weekly.ics');
  const busy = busyFromIcal(ics, iso('2026-05-01T00:00:00Z'), iso('2026-05-31T00:00:00Z'));
  assert.deepEqual(busy, [
    { start: iso('2026-05-01T15:00:00Z'), end: iso('2026-05-01T15:30:00Z') },
    { start: iso('2026-05-03T15:00:00Z'), end: iso('2026-05-03T15:30:00Z') },
    { start: iso('2026-05-03T18:00:00Z'), end: iso('2026-05-03T18:30:00Z') },
    { start: iso('2026-05-05T15:00:00Z'), end: iso('2026-05-05T15:30:00Z') },
    { start: iso('2026-05-05T18:00:00Z'), end: iso('2026-05-05T18:30:00Z') },
    { start: iso('2026-05-07T15:00:00Z'), end: iso('2026-05-07T15:30:00Z') },
    { start: iso('2026-05-17T18:00:00Z'), end: iso('2026-05-17T18:30:00Z') },
    { start: iso('2026-05-19T18:00:00Z'), end: iso('2026-05-19T18:30:00Z') },
  ]);
});

test('ical: RRULE MONTHLY ordinals, BYMONTHDAY, and YEARLY BYMONTH', async () => {
  const ics = await readFixture('rrule-monthly-yearly.ics');
  const busy = busyFromIcal(ics, iso('2026-01-01T00:00:00Z'), iso('2027-04-01T00:00:00Z'));
  assert.deepEqual(busy, [
    { start: iso('2026-01-13T16:00:00Z'), end: iso('2026-01-13T16:30:00Z') },
    { start: iso('2026-01-15T18:00:00Z'), end: iso('2026-01-15T18:30:00Z') },
    { start: iso('2026-01-30T17:00:00Z'), end: iso('2026-01-30T17:30:00Z') },
    { start: iso('2026-01-31T18:00:00Z'), end: iso('2026-01-31T18:30:00Z') },
    { start: iso('2026-02-10T16:00:00Z'), end: iso('2026-02-10T16:30:00Z') },
    { start: iso('2026-02-15T18:00:00Z'), end: iso('2026-02-15T18:30:00Z') },
    { start: iso('2026-02-27T17:00:00Z'), end: iso('2026-02-27T17:30:00Z') },
    { start: iso('2026-02-28T18:00:00Z'), end: iso('2026-02-28T18:30:00Z') },
    { start: iso('2026-03-10T16:00:00Z'), end: iso('2026-03-10T16:30:00Z') },
    { start: iso('2026-03-10T19:00:00Z'), end: iso('2026-03-10T20:00:00Z') },
    { start: iso('2026-03-27T17:00:00Z'), end: iso('2026-03-27T17:30:00Z') },
    { start: iso('2026-09-10T19:00:00Z'), end: iso('2026-09-10T20:00:00Z') },
    { start: iso('2027-03-10T19:00:00Z'), end: iso('2027-03-10T20:00:00Z') },
  ]);
});

test('ical: recurring occurrences keep local wall time across spring and fall DST', async () => {
  const ics = await readFixture('dst-spring-fall.ics');
  const spring = busyFromIcal(ics, iso('2026-03-07T00:00:00Z'), iso('2026-03-10T00:00:00Z'));
  assert.deepEqual(spring, [
    { start: iso('2026-03-07T19:00:00Z'), end: iso('2026-03-07T19:30:00Z') },
    { start: iso('2026-03-08T18:00:00Z'), end: iso('2026-03-08T18:30:00Z') },
    { start: iso('2026-03-09T18:00:00Z'), end: iso('2026-03-09T18:30:00Z') },
  ]);
  const fall = busyFromIcal(ics, iso('2026-10-31T00:00:00Z'), iso('2026-11-03T00:00:00Z'));
  assert.deepEqual(fall, [
    { start: iso('2026-10-31T18:00:00Z'), end: iso('2026-10-31T18:30:00Z') },
    { start: iso('2026-11-01T19:00:00Z'), end: iso('2026-11-01T19:30:00Z') },
    { start: iso('2026-11-02T19:00:00Z'), end: iso('2026-11-02T19:30:00Z') },
  ]);
});

test('ical: EXDATE and RECURRENCE-ID moved and cancelled overrides', async () => {
  const ics = await readFixture('override-and-exdate.ics');
  const busy = busyFromIcal(ics, iso('2026-05-04T00:00:00Z'), iso('2026-05-10T00:00:00Z'));
  assert.deepEqual(busy, [
    { start: iso('2026-05-04T18:00:00Z'), end: iso('2026-05-04T18:30:00Z') },
    { start: iso('2026-05-06T21:00:00Z'), end: iso('2026-05-06T21:45:00Z') },
    { start: iso('2026-05-08T18:00:00Z'), end: iso('2026-05-08T18:30:00Z') },
  ]);
});

for (const fixture of [
  'fail-not-calendar.ics',
  'fail-bad-event.ics',
  'fail-rrule-bysetpos.ics',
  'fail-rrule-byweekno.ics',
  'fail-rrule-byyearday.ics',
  'fail-rrule-hourly.ics',
  'fail-rdate.ics',
]) {
  test(`ical: fail closed on ${fixture}`, async () => {
    const ics = await readFixture(fixture);
    assert.throws(
      () => busyFromIcal(ics, iso('2026-05-01T00:00:00Z'), iso('2026-05-31T00:00:00Z')),
      (err) => {
        assert.equal(err.code, 'calendar_unreadable');
        assert.ok(typeof err.message === 'string' && err.message.length > 0);
        assert.ok(!err.message.includes('Secret Event Title'));
        assert.ok(!err.message.includes('not-a-date'));
        return true;
      },
    );
  });
}

test('ical: caps at 5,000 events and 20,000 generated occurrences', () => {
  const manyEvents = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    ...Array.from({ length: 5001 }, (_, i) =>
      `BEGIN:VEVENT\nUID:e${i}@example.test\nDTSTART:20260501T150000Z\nDURATION:PT30M\nEND:VEVENT`,
    ),
    'END:VCALENDAR',
  ].join('\r\n');
  assert.throws(
    () => busyFromIcal(manyEvents, iso('2026-05-01T00:00:00Z'), iso('2026-05-02T00:00:00Z')),
    (err) => err.code === 'calendar_unreadable',
  );

  const manyOccurrences = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:big@example.test',
    'DTSTART:20260101T150000Z',
    'DURATION:PT30M',
    'RRULE:FREQ=DAILY;COUNT=20001',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  assert.throws(
    () => busyFromIcal(manyOccurrences, iso('2026-01-01T00:00:00Z'), iso('2090-01-01T00:00:00Z')),
    (err) => err.code === 'calendar_unreadable',
  );
});

test('slots: settings defaults, custom values, unknown mode falls back to off, malformed throws bad_settings', () => {
  assert.deepEqual(settings({}), {
    mode: 'off',
    timezone: 'America/Los_Angeles',
    days: [1, 2, 3, 4, 5],
    startMin: 660,
    endMin: 1080,
    slotMin: 30,
    bufferMin: 15,
    noticeMin: 240,
    horizonDays: 14,
    maxPerDay: 4,
  });

  assert.equal(settings({ BOOK_MODE: 'mystery' }).mode, 'off');
  assert.equal(settings({ BOOK_MODE: 'fake' }).mode, 'fake');
  assert.equal(settings({ BOOK_MODE: 'live' }).mode, 'live');

  assert.deepEqual(
    settings({
      BOOK_MODE: 'live',
      BOOK_TIMEZONE: 'America/New_York',
      BOOK_DAYS: '0,2,4',
      BOOK_START: '09:30',
      BOOK_END: '16:00',
      BOOK_BUFFER_MIN: '0',
      BOOK_NOTICE_HOURS: '2',
      BOOK_HORIZON_DAYS: '7',
      BOOK_MAX_PER_DAY: '2',
    }),
    {
      mode: 'live',
      timezone: 'America/New_York',
      days: [0, 2, 4],
      startMin: 570,
      endMin: 960,
      slotMin: 30,
      bufferMin: 0,
      noticeMin: 120,
      horizonDays: 7,
      maxPerDay: 2,
    },
  );

  for (const badEnv of [
    { BOOK_TIMEZONE: 'Mars/Olympus_Mons' },
    { BOOK_DAYS: '1,7' },
    { BOOK_DAYS: 'mon,tue' },
    { BOOK_START: '9:00' },
    { BOOK_START: '25:00' },
    { BOOK_END: '10:00' },
    { BOOK_START: '18:00', BOOK_END: '18:00' },
    { BOOK_BUFFER_MIN: '-5' },
    { BOOK_NOTICE_HOURS: 'soon' },
    { BOOK_HORIZON_DAYS: '0' },
    { BOOK_MAX_PER_DAY: '0' },
  ]) {
    assert.throws(() => settings(badEnv), (err) => err.code === 'bad_settings');
  }
});

test('slots: window covers notice, horizon, slot length, and buffers', () => {
  const cfg = settings({});
  const nowMs = iso('2026-05-04T15:00:00Z');
  const w = bookWindow(cfg, nowMs);
  assert.ok(w.fromMs <= nowMs - cfg.bufferMin * 60_000);
  assert.ok(w.toMs >= nowMs + cfg.horizonDays * 86_400_000 + (cfg.slotMin + cfg.bufferMin) * 60_000);
});

test('slots: notice, horizon, day and hour edges', () => {
  const cfg = settings({
    BOOK_DAYS: '1,2,3,4,5',
    BOOK_START: '11:15',
    BOOK_END: '17:45',
    BOOK_NOTICE_HOURS: '4',
    BOOK_HORIZON_DAYS: '3',
  });
  const nowMs = iso('2026-05-01T19:00:00Z');
  const slots = openSlots(cfg, [], [], nowMs);
  assert.equal(slots[0], iso('2026-05-01T23:00:00Z'));
  assert.equal(fmtLocal(slots[0], cfg.timezone), '2026-05-01, 16:00');
  const fridaySlots = slots.filter((ms) => fmtLocal(ms, cfg.timezone).startsWith('2026-05-01'));
  assert.equal(fmtLocal(fridaySlots[fridaySlots.length - 1], cfg.timezone), '2026-05-01, 17:00');
  assert.ok(slots.every((ms) => {
    const local = fmtLocal(ms, cfg.timezone);
    return !local.startsWith('2026-05-02') && !local.startsWith('2026-05-03');
  }));
  const mondaySlots = slots.filter((ms) => fmtLocal(ms, cfg.timezone).startsWith('2026-05-04'));
  assert.deepEqual(
    mondaySlots.map((ms) => fmtLocal(ms, cfg.timezone)),
    ['2026-05-04, 11:30', '2026-05-04, 12:00'],
  );
  assert.ok(slots.every((ms) => ms <= nowMs + 3 * 86_400_000));
});

test('slots: buffers around busy event and booking beside a busy event', () => {
  const cfg = settings({
    BOOK_NOTICE_HOURS: '0',
    BOOK_HORIZON_DAYS: '1',
    BOOK_BUFFER_MIN: '15',
  });
  const nowMs = iso('2026-05-04T15:00:00Z');
  const busy = [
    { start: iso('2026-05-04T19:15:00Z'), end: iso('2026-05-04T20:00:00Z') },
  ];
  const bookings = [
    { start: iso('2026-05-04T21:00:00Z'), end: iso('2026-05-04T21:30:00Z') },
  ];
  const slots = openSlots(cfg, busy, bookings, nowMs);
  const times = slots
    .filter((ms) => fmtLocal(ms, cfg.timezone).startsWith('2026-05-04'))
    .map((ms) => fmtLocal(ms, cfg.timezone).slice(-5));
  assert.ok(times.includes('11:00'));
  assert.ok(times.includes('11:30'));
  assert.ok(!times.includes('12:00'));
  assert.ok(!times.includes('12:30'));
  assert.ok(!times.includes('13:00'));
  assert.ok(!times.includes('13:30'));
  assert.ok(!times.includes('14:00'));
  assert.ok(!times.includes('14:30'));
  assert.ok(times.includes('15:00'));

  const bookingsWithRoom = [
    { start: iso('2026-05-04T21:30:00Z'), end: iso('2026-05-04T22:00:00Z') },
  ];
  const slotsWithRoom = openSlots(cfg, busy, bookingsWithRoom, nowMs);
  const timesWithRoom = slotsWithRoom
    .filter((ms) => fmtLocal(ms, cfg.timezone).startsWith('2026-05-04'))
    .map((ms) => fmtLocal(ms, cfg.timezone).slice(-5));
  assert.ok(timesWithRoom.includes('13:30'));
  assert.ok(!timesWithRoom.includes('14:00'));
});

test('slots: daily cap blocks the capped local day without blocking the next day', () => {
  const cfg = settings({
    BOOK_NOTICE_HOURS: '0',
    BOOK_HORIZON_DAYS: '2',
    BOOK_MAX_PER_DAY: '2',
  });
  const nowMs = iso('2026-05-04T15:00:00Z');
  const bookings = [
    { start: iso('2026-05-04T18:00:00Z'), end: iso('2026-05-04T18:30:00Z') },
    { start: iso('2026-05-05T00:30:00Z'), end: iso('2026-05-05T01:00:00Z') },
  ];
  const slots = openSlots(cfg, [], bookings, nowMs);
  assert.equal(slots.filter((ms) => fmtLocal(ms, cfg.timezone).startsWith('2026-05-04')).length, 0);
  assert.equal(slots.filter((ms) => fmtLocal(ms, cfg.timezone).startsWith('2026-05-05')).length, 14);
});

test('slots: 23-hour spring DST day and 25-hour fall DST day still offer 11:00 to 18:00 local', () => {
  const cfg = settings({
    BOOK_DAYS: '0',
    BOOK_NOTICE_HOURS: '0',
    BOOK_HORIZON_DAYS: '1',
  });
  const springSlots = openSlots(cfg, [], [], iso('2026-03-08T08:00:00Z'))
    .filter((ms) => fmtLocal(ms, cfg.timezone).startsWith('2026-03-08'));
  assert.equal(springSlots.length, 14);
  assert.equal(fmtLocal(springSlots[0], cfg.timezone), '2026-03-08, 11:00');
  assert.equal(fmtLocal(springSlots[springSlots.length - 1], cfg.timezone), '2026-03-08, 17:30');
  assert.equal(springSlots[0], iso('2026-03-08T18:00:00Z'));

  const fallSlots = openSlots(cfg, [], [], iso('2026-11-01T08:00:00Z'))
    .filter((ms) => fmtLocal(ms, cfg.timezone).startsWith('2026-11-01'));
  assert.equal(fallSlots.length, 14);
  assert.equal(fmtLocal(fallSlots[0], cfg.timezone), '2026-11-01, 11:00');
  assert.equal(fmtLocal(fallSlots[fallSlots.length - 1], cfg.timezone), '2026-11-01, 17:30');
  assert.equal(fallSlots[0], iso('2026-11-01T19:00:00Z'));
});

test('fake: deterministic weekday meetings, no weekend meetings, valid merged intervals', () => {
  const cfg = settings({ BOOK_MODE: 'fake' });
  const fromMs = iso('2026-05-02T00:00:00Z');
  const toMs = iso('2026-05-09T00:00:00Z');
  const a = fakeBusy(cfg, fromMs, toMs);
  const b = fakeBusy(cfg, fromMs, toMs);
  assert.deepEqual(a, b);
  assert.ok(a.length >= 10);
  for (let i = 0; i < a.length; i += 1) {
    assert.ok(a[i].end > a[i].start);
    assert.ok(a[i].end > fromMs && a[i].start < toMs);
    if (i > 0) assert.ok(a[i].start > a[i - 1].end);
    const localDay = fmtLocal(a[i].start, cfg.timezone).slice(0, 10);
    assert.notEqual(localDay, '2026-05-02');
    assert.notEqual(localDay, '2026-05-03');
  }
  const tuesdayOnly = fakeBusy(cfg, iso('2026-05-05T07:00:00Z'), iso('2026-05-06T07:00:00Z'));
  const tuesdayFromWeek = a.filter((iv) => fmtLocal(iv.start, cfg.timezone).startsWith('2026-05-05'));
  assert.deepEqual(tuesdayOnly, tuesdayFromWeek);
});
