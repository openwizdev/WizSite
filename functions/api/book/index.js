import { settings, window, openSlots } from '../../../lib/book/slots.js';
import { googleReady, googleInsert } from '../../../lib/book/google.js';
import { sendBookingMail } from '../../../lib/book/mail.js';
import {
  DEFAULT_ICAL_TIMEOUT,
  DEFAULT_STORE_TIMEOUT,
  codePointLength,
  errorResponse,
  getDb,
  hasControlChars,
  isPlausibleEmail,
  jsonResponse,
  methodNotAllowed,
  openStore,
  parseIsoTimestamp,
  randomBase64Url,
  readBusy,
  readJsonBody,
  resolveNow,
  sha256Hex,
  toIsoUtc,
  untilDayEnds,
  untilHourEnds,
  utcDay,
  utcHour,
  visitorHash,
} from '../../../lib/book/store.js';

const BOOK_KEYS = 'email,name,start,team,tz,website';
const ATTEMPTS_PER_HOUR = 10;
const BOOKINGS_PER_DAY_VISITOR = 3;
const UPCOMING_PER_EMAIL = 2;
const BOOKINGS_PER_DAY_GLOBAL = 20;
const MAX_NAME = 80;
const MAX_TEAM = 200;
const MAX_TZ = 100;

export function onRequest(context) {
  return handle(context.request, context.env);
}

export async function handle(request, env, options = {}) {
  if (request.method !== 'POST') return methodNotAllowed('POST');

  const {
    fetch = globalThis.fetch,
    now,
    storeTimeout = DEFAULT_STORE_TIMEOUT,
    icalTimeout = DEFAULT_ICAL_TIMEOUT,
  } = options;

  let cfg;
  try {
    cfg = settings(env);
  } catch {
    return errorResponse(503, 'unavailable', 'Booking is not available right now.');
  }
  if (cfg.mode === 'off') {
    return errorResponse(503, 'unavailable', 'Booking is not available right now.');
  }

  const db = getDb(env);
  if (!db) {
    return errorResponse(503, 'unavailable', 'Booking is not available right now.');
  }

  const body = await readJsonBody(request, BOOK_KEYS);
  if (!body) {
    return errorResponse(400, 'bad_request', 'That booking request could not be read.');
  }

  for (const value of Object.values(body)) {
    if (hasControlChars(value)) {
      return errorResponse(400, 'bad_request', 'That booking request contains invalid characters.');
    }
  }

  const startMs = parseIsoTimestamp(body.start.trim());
  const name = body.name.trim();
  const email = body.email.trim();
  const team = body.team.trim();
  const tz = body.tz.trim();
  const website = body.website.trim();

  if (
    startMs === null ||
    codePointLength(name) < 1 || codePointLength(name) > MAX_NAME ||
    !isPlausibleEmail(email) ||
    codePointLength(team) < 1 || codePointLength(team) > MAX_TEAM ||
    codePointLength(tz) > MAX_TZ
  ) {
    return errorResponse(400, 'bad_request', 'Please check your booking details and try again.');
  }

  const endMs = startMs + cfg.slotMin * 60_000;
  if (website.length > 0) {
    return jsonResponse({
      ok: true,
      booking: {
        id: randomBase64Url(16),
        start: toIsoUtc(startMs),
        end: toIsoUtc(endMs),
      },
      email: 'sent',
    });
  }

  const nowMs = resolveNow(now);
  const day = utcDay(nowMs);
  const hour = utcHour(nowMs);
  const store = openStore(db, storeTimeout);

  let visitorBookKey;
  try {
    const salt = await store.salt(day);
    const hash = await visitorHash(salt, request.headers.get('CF-Connecting-IP') ?? '');
    const attemptAllowed = await store.bumpLimit(day, `attempt:${hash}:${hour}`, ATTEMPTS_PER_HOUR);
    if (!attemptAllowed) {
      return errorResponse(429, 'rate_limited', 'Too many booking attempts. Please try again later.', {
        'Retry-After': String(untilHourEnds(nowMs)),
      });
    }

    visitorBookKey = `book:${hash}`;
    const [visitorCount, globalCount, emailUpcoming] = await Promise.all([
      store.getLimit(day, visitorBookKey),
      store.getLimit(day, 'global'),
      store.countUpcomingByEmail(email, nowMs),
    ]);
    if (visitorCount >= BOOKINGS_PER_DAY_VISITOR || globalCount >= BOOKINGS_PER_DAY_GLOBAL) {
      return errorResponse(429, 'rate_limited', 'Booking limit reached for today. Please try again tomorrow.', {
        'Retry-After': String(untilDayEnds(nowMs, day)),
      });
    }
    if (emailUpcoming >= UPCOMING_PER_EMAIL) {
      return errorResponse(429, 'rate_limited', 'You already have the maximum number of upcoming bookings.', {
        'Retry-After': String(untilDayEnds(nowMs, day)),
      });
    }
  } catch {
    return errorResponse(503, 'unavailable', 'Booking is not available right now.');
  }

  const { fromMs, toMs } = window(cfg, nowMs);
  let busy;
  let existing;
  try {
    [busy, existing] = await Promise.all([
      readBusy(cfg, env, fromMs, toMs, { fetch, icalTimeout }),
      store.listBookedInRange(fromMs, toMs),
    ]);
  } catch {
    return errorResponse(503, 'unavailable', 'Booking is not available right now.');
  }

  const available = openSlots(cfg, busy, existing, nowMs);
  if (!available.includes(startMs)) {
    return errorResponse(409, 'slot_taken', 'That time slot is no longer available.');
  }

  const id = randomBase64Url(16);
  const cancelToken = randomBase64Url(32);
  const cancelHash = await sha256Hex(cancelToken);

  try {
    await store.insertBooking(
      {
        id,
        start: startMs,
        end: endMs,
        name,
        email,
        team,
        tz,
        cancelHash,
        created: nowMs,
      },
      day,
      visitorBookKey,
    );
  } catch (err) {
    if (err?.code === 'slot_taken') {
      return errorResponse(409, 'slot_taken', 'That time slot is no longer available.');
    }
    return errorResponse(503, 'unavailable', 'Booking is not available right now.');
  }

  const bookingRecord = {
    id,
    start: startMs,
    end: endMs,
    name,
    email,
    team,
    tz,
  };

  if (googleReady(env)) {
    const eventId = await googleInsert(env, bookingRecord, { fetch });
    if (eventId) {
      await store.setGoogleEvent(id, eventId).catch(() => {});
    }
  }

  const origin = new URL(request.url).origin;
  const cancelUrl = `${origin}/book/?cancel=${id}.${cancelToken}`;
  const emailStatus = await sendBookingMail(env, { ...bookingRecord, cancelUrl }, { fetch });

  return jsonResponse({
    ok: true,
    booking: {
      id,
      start: toIsoUtc(startMs),
      end: toIsoUtc(endMs),
    },
    email: emailStatus,
  });
}
