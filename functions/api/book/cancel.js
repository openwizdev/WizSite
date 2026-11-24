import { settings } from '../../../lib/book/slots.js';
import { googleReady, googleDelete } from '../../../lib/book/google.js';
import { sendCancelMail } from '../../../lib/book/mail.js';
import {
  DEFAULT_STORE_TIMEOUT,
  constantTimeEqual,
  errorResponse,
  getDb,
  hasControlChars,
  jsonResponse,
  methodNotAllowed,
  openStore,
  readJsonBody,
  resolveNow,
  sha256Hex,
} from '../../../lib/book/store.js';

const CANCEL_KEYS = 'id,token';

export function onRequest(context) {
  return handle(context.request, context.env);
}

export async function handle(request, env, options = {}) {
  if (request.method !== 'POST') return methodNotAllowed('POST');

  const {
    fetch = globalThis.fetch,
    now,
    storeTimeout = DEFAULT_STORE_TIMEOUT,
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

  const body = await readJsonBody(request, CANCEL_KEYS);
  if (!body) {
    return errorResponse(400, 'bad_request', 'That cancel request could not be read.');
  }
  if (hasControlChars(body.id) || hasControlChars(body.token)) {
    return errorResponse(400, 'bad_request', 'That cancel request contains invalid characters.');
  }

  const id = body.id.trim();
  const token = body.token.trim();
  if (!id || !token) {
    return errorResponse(404, 'not_found', 'Booking not found.');
  }

  const nowMs = resolveNow(now);
  const store = openStore(db, storeTimeout);

  let booking;
  try {
    booking = await store.getBooking(id);
  } catch {
    return errorResponse(503, 'unavailable', 'Booking is not available right now.');
  }

  const tokenHash = await sha256Hex(token);
  const matches = await constantTimeEqual(tokenHash, booking?.cancel_hash ?? '');
  if (!booking || !matches || booking.start <= nowMs) {
    return errorResponse(404, 'not_found', 'Booking not found.');
  }

  if (booking.status === 'cancelled') {
    return jsonResponse({ ok: true });
  }

  try {
    await store.cancelBooking(id);
  } catch {
    return errorResponse(503, 'unavailable', 'Booking is not available right now.');
  }

  if (booking.google_event && googleReady(env)) {
    await googleDelete(env, booking.google_event, { fetch });
  }

  await sendCancelMail(env, booking, { fetch });

  return jsonResponse({ ok: true });
}
