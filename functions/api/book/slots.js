import { settings, window, openSlots } from '../../../lib/book/slots.js';
import {
  BOOK_SCHEMA,
  DEFAULT_ICAL_TIMEOUT,
  DEFAULT_STORE_TIMEOUT,
  errorResponse,
  getDb,
  jsonResponse,
  methodNotAllowed,
  openStore,
  readBusy,
  resolveNow,
  toIsoUtc,
  untilHourEnds,
  utcDay,
  utcHour,
  visitorHash,
} from '../../../lib/book/store.js';

const SLOTS_PER_HOUR = 120;

export function onRequest(context) {
  return handle(context.request, context.env);
}

export async function handle(request, env, options = {}) {
  if (request.method !== 'GET') return methodNotAllowed('GET');

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

  const nowMs = resolveNow(now);
  const day = utcDay(nowMs);
  const hour = utcHour(nowMs);
  const store = openStore(db, storeTimeout);

  try {
    const salt = await store.salt(day);
    const hash = await visitorHash(salt, request.headers.get('CF-Connecting-IP') ?? '');
    const allowed = await store.bumpLimit(day, `slots:${hash}:${hour}`, SLOTS_PER_HOUR);
    if (!allowed) {
      return errorResponse(429, 'rate_limited', 'Too many requests. Please try again later.', {
        'Retry-After': String(untilHourEnds(nowMs)),
      });
    }
  } catch {
    return errorResponse(503, 'unavailable', 'Booking is not available right now.');
  }

  const { fromMs, toMs } = window(cfg, nowMs);
  let busy;
  let bookings;
  try {
    [busy, bookings] = await Promise.all([
      readBusy(cfg, env, fromMs, toMs, { fetch, icalTimeout }),
      store.listBookedInRange(fromMs, toMs),
    ]);
  } catch {
    return errorResponse(503, 'unavailable', 'Booking is not available right now.');
  }

  const slots = openSlots(cfg, busy, bookings, nowMs).map(toIsoUtc);
  return jsonResponse({
    schema: BOOK_SCHEMA,
    mode: cfg.mode,
    timezone: cfg.timezone,
    minutes: cfg.slotMin,
    slots,
  });
}
