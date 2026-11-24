import { settings } from '../../../lib/book/slots.js';
import {
  BOOK_SCHEMA,
  DEFAULT_STORE_TIMEOUT,
  constantTimeEqual,
  errorResponse,
  getDb,
  jsonResponse,
  methodNotAllowed,
  openStore,
  resolveNow,
  toIsoUtc,
} from '../../../lib/book/store.js';

const DAY_MS = 86_400_000;
const FEED_BACK_DAYS = 7;

export function onRequest(context) {
  return handle(context.request, context.env);
}

export async function handle(request, env, options = {}) {
  if (request.method !== 'GET') return methodNotAllowed('GET');

  const expected = typeof env?.BOOK_FEED_TOKEN === 'string' ? env.BOOK_FEED_TOKEN.trim() : '';
  if (!expected) {
    return errorResponse(404, 'not_found', 'Not found.');
  }

  const auth = request.headers.get('Authorization') ?? '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const authorized = provided.length > 0 && (await constantTimeEqual(provided, expected));
  if (!authorized) {
    return errorResponse(401, 'unauthorized', 'Unauthorized.');
  }

  const { now, storeTimeout = DEFAULT_STORE_TIMEOUT } = options;

  let cfg;
  try {
    cfg = settings(env);
  } catch {
    return errorResponse(503, 'unavailable', 'Booking feed is not available right now.');
  }

  const db = getDb(env);
  if (!db) {
    return errorResponse(503, 'unavailable', 'Booking feed is not available right now.');
  }

  const nowMs = resolveNow(now);
  const fromMs = nowMs - FEED_BACK_DAYS * DAY_MS;
  const toMs = nowMs + cfg.horizonDays * DAY_MS;
  const store = openStore(db, storeTimeout);

  let rows;
  try {
    rows = await store.listFeed(fromMs, toMs);
  } catch {
    return errorResponse(503, 'unavailable', 'Booking feed is not available right now.');
  }

  return jsonResponse({
    schema: BOOK_SCHEMA,
    bookings: rows.map(row => ({
      id: row.id,
      start: toIsoUtc(row.start),
      end: toIsoUtc(row.end),
      name: row.name,
      email: row.email,
      team: row.team,
      status: row.status,
      created: toIsoUtc(row.created),
    })),
  });
}
