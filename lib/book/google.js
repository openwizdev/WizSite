const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_FREEBUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy';
const GOOGLE_CALENDARS_URL = 'https://www.googleapis.com/calendar/v3/calendars';
const DEFAULT_CALENDAR = 'primary';
const TIMEOUT_MS = 10_000;
const ENCODER = new TextEncoder();

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function calendarIdOf(env) {
  return nonEmpty(env?.BOOK_GOOGLE_CALENDAR) || DEFAULT_CALENDAR;
}

function calendarUnreadable() {
  const err = new Error('Calendar unreadable');
  err.code = 'calendar_unreadable';
  return err;
}

async function eventIdFor(bookingId) {
  const digest = await crypto.subtle.digest('SHA-256', ENCODER.encode(`openwiz-book:${bookingId}`));
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

async function fetchAccessToken(env, fetchFn) {
  if (!googleReady(env)) return null;
  try {
    const body = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID.trim(),
      client_secret: env.GOOGLE_CLIENT_SECRET.trim(),
      refresh_token: env.GOOGLE_REFRESH_TOKEN.trim(),
      grant_type: 'refresh_token',
    }).toString();
    const response = await fetchFn(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return nonEmpty(data?.access_token) || null;
  } catch {
    return null;
  }
}

function mergeBusy(intervals) {
  if (intervals.length === 0) return [];
  intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [{ start: intervals[0].start, end: intervals[0].end }];
  for (let i = 1; i < intervals.length; i++) {
    const cur = merged[merged.length - 1];
    const next = intervals[i];
    if (next.start <= cur.end) {
      if (next.end > cur.end) cur.end = next.end;
    } else {
      merged.push({ start: next.start, end: next.end });
    }
  }
  return merged;
}

export function googleReady(env) {
  return Boolean(
    nonEmpty(env?.GOOGLE_CLIENT_ID)
    && nonEmpty(env?.GOOGLE_CLIENT_SECRET)
    && nonEmpty(env?.GOOGLE_REFRESH_TOKEN),
  );
}

export async function googleBusy(env, fromMs, toMs, { fetch = globalThis.fetch } = {}) {
  const token = await fetchAccessToken(env, fetch);
  if (!token) throw calendarUnreadable();

  const calendarId = calendarIdOf(env);
  let data;
  try {
    const response = await fetch(GOOGLE_FREEBUSY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        timeMin: new Date(fromMs).toISOString(),
        timeMax: new Date(toMs).toISOString(),
        items: [{ id: calendarId }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw calendarUnreadable();
    data = await response.json();
  } catch {
    throw calendarUnreadable();
  }

  const cal = data?.calendars?.[calendarId];
  if (!cal || typeof cal !== 'object') throw calendarUnreadable();
  if (Array.isArray(cal.errors) && cal.errors.length > 0) throw calendarUnreadable();
  if (!Array.isArray(cal.busy)) throw calendarUnreadable();

  const intervals = [];
  for (const item of cal.busy) {
    const start = Date.parse(item?.start);
    const end = Date.parse(item?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw calendarUnreadable();
    if (end > start) intervals.push({ start, end });
  }
  return mergeBusy(intervals);
}

export async function googleInsert(env, booking, { fetch = globalThis.fetch } = {}) {
  const token = await fetchAccessToken(env, fetch);
  if (!token) return null;

  const calendarId = calendarIdOf(env);
  const meetingUrl = nonEmpty(env?.BOOK_MEETING_URL);
  try {
    const eventId = await eventIdFor(String(booking.id));
    const event = {
      id: eventId,
      summary: `OpenWiz call: ${booking.name ?? ''}`,
      description: `Name: ${booking.name ?? ''}\nEmail: ${booking.email ?? ''}\nTeam: ${booking.team ?? ''}`,
      start: { dateTime: new Date(booking.start).toISOString() },
      end: { dateTime: new Date(booking.end).toISOString() },
    };
    if (meetingUrl) event.location = meetingUrl;

    const url = `${GOOGLE_CALENDARS_URL}/${encodeURIComponent(calendarId)}/events?sendUpdates=none`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 409) return eventId;
    if (!response.ok) return null;
    const data = await response.json();
    return nonEmpty(data?.id) || null;
  } catch {
    return null;
  }
}

export async function googleDelete(env, eventId, { fetch = globalThis.fetch } = {}) {
  const cleanId = nonEmpty(eventId);
  if (!cleanId) return false;
  const token = await fetchAccessToken(env, fetch);
  if (!token) return false;

  const calendarId = calendarIdOf(env);
  try {
    const url = `${GOOGLE_CALENDARS_URL}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(cleanId)}?sendUpdates=none`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok || response.status === 404 || response.status === 410;
  } catch {
    return false;
  }
}
