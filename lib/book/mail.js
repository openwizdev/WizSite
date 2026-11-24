const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'OpenWiz <book@openwiz.dev>';
const PACIFIC = 'America/Los_Angeles';
const TIMEOUT_MS = 10_000;
const ENCODER = new TextEncoder();

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeIcsText(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function foldIcsLine(line) {
  const parts = [];
  let chunk = '';
  let bytes = 0;
  for (const ch of line) {
    const len = ENCODER.encode(ch).length;
    if (bytes + len > 75 && chunk.length > 0) {
      parts.push(chunk);
      chunk = ` ${ch}`;
      bytes = 1 + len;
    } else {
      chunk += ch;
      bytes += len;
    }
  }
  parts.push(chunk);
  return parts.join('\r\n');
}

function formatIcsUtc(ms) {
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

function toBase64(text) {
  const bytes = ENCODER.encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function resolveZone(tz) {
  const candidate = nonEmpty(tz);
  if (!candidate) return PACIFIC;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: candidate }).resolvedOptions().timeZone;
  } catch {
    return PACIFIC;
  }
}

function formatWhen(ms, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(ms));
}

function darkHtml(title, bodyHtml) {
  return [
    '<!doctype html>',
    '<html><body style="margin:0;padding:24px;background:#0e0f12;color:#f2f2f2;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;line-height:1.5;">',
    '<div style="max-width:540px;margin:0 auto;padding:24px;background:#16181d;border:1px solid #2a2e38;border-radius:12px;">',
    `<h1 style="margin:0 0 16px;font-size:20px;color:#ffffff;">${escapeHtml(title)}</h1>`,
    bodyHtml,
    '</div></body></html>',
  ].join('');
}

function visitorTimeLines(startMs, tz) {
  const visitorZone = resolveZone(tz);
  const pacificWhen = formatWhen(startMs, PACIFIC);
  if (visitorZone === PACIFIC) {
    return {
      text: [`Time (${PACIFIC}): ${pacificWhen}`],
      html: `<p style="margin:0 0 12px;"><strong>Time (${escapeHtml(PACIFIC)}):</strong> ${escapeHtml(pacificWhen)}</p>`,
    };
  }
  const visitorWhen = formatWhen(startMs, visitorZone);
  return {
    text: [
      `Your time (${visitorZone}): ${visitorWhen}`,
      `Pacific time (${PACIFIC}): ${pacificWhen}`,
    ],
    html: [
      `<p style="margin:0 0 8px;"><strong>Your time (${escapeHtml(visitorZone)}):</strong> ${escapeHtml(visitorWhen)}</p>`,
      `<p style="margin:0 0 12px;"><strong>Pacific time (${escapeHtml(PACIFIC)}):</strong> ${escapeHtml(pacificWhen)}</p>`,
    ].join(''),
  };
}

function bookingVisitorMessage(booking, env, from) {
  const times = visitorTimeLines(booking.start, booking.tz);
  const meetingUrl = nonEmpty(env?.BOOK_MEETING_URL);
  const cancelUrl = nonEmpty(booking?.cancelUrl);

  const textLines = [
    'Your OpenWiz call is confirmed.',
    '',
    ...times.text,
    'Duration: 30 minutes',
    '',
    meetingUrl ? `Meeting link: ${meetingUrl}` : 'The meeting link will follow by email.',
  ];
  if (cancelUrl) textLines.push('', `Need to cancel? ${cancelUrl}`);

  const htmlParts = [
    '<p style="margin:0 0 16px;">Your OpenWiz call is confirmed.</p>',
    times.html,
    '<p style="margin:0 0 12px;"><strong>Duration:</strong> 30 minutes</p>',
    meetingUrl
      ? `<p style="margin:0 0 12px;"><strong>Meeting link:</strong> <a href="${escapeHtml(meetingUrl)}" style="color:#ff8a3d;">${escapeHtml(meetingUrl)}</a></p>`
      : '<p style="margin:0 0 12px;">The meeting link will follow by email.</p>',
  ];
  if (cancelUrl) {
    htmlParts.push(`<p style="margin:16px 0 0;font-size:13px;color:#b4b8c4;">Need to cancel? <a href="${escapeHtml(cancelUrl)}" style="color:#ff8a3d;">Cancel this call</a></p>`);
  }

  return {
    from,
    to: [booking.email],
    subject: 'OpenWiz call confirmed',
    text: textLines.join('\n'),
    html: darkHtml('OpenWiz call confirmed', htmlParts.join('')),
    attachments: [{
      filename: 'openwiz-call.ics',
      content: toBase64(icsFor(booking, env)),
      content_type: 'text/calendar; charset=utf-8',
    }],
  };
}

function bookingOwnerMessage(booking, ownerEmail, from) {
  const pacificWhen = formatWhen(booking.start, PACIFIC);
  const name = String(booking.name ?? '');
  const email = String(booking.email ?? '');
  const team = String(booking.team ?? '');

  const text = [
    'New OpenWiz call booked.',
    '',
    `Time (${PACIFIC}): ${pacificWhen}`,
    `Name: ${name}`,
    `Email: ${email}`,
    `Team: ${team}`,
  ].join('\n');

  const html = darkHtml('New OpenWiz call booked', [
    `<p style="margin:0 0 12px;"><strong>Time (${escapeHtml(PACIFIC)}):</strong> ${escapeHtml(pacificWhen)}</p>`,
    `<p style="margin:0 0 8px;"><strong>Name:</strong> ${escapeHtml(name)}</p>`,
    `<p style="margin:0 0 8px;"><strong>Email:</strong> ${escapeHtml(email)}</p>`,
    `<p style="margin:0;"><strong>Team:</strong> ${escapeHtml(team)}</p>`,
  ].join(''));

  return {
    from,
    to: [ownerEmail],
    reply_to: email,
    subject: 'New OpenWiz call booked',
    text,
    html,
  };
}

function cancelVisitorMessage(booking, from) {
  const times = visitorTimeLines(booking.start, booking.tz);

  const text = [
    'Your OpenWiz call has been cancelled.',
    '',
    ...times.text,
    'Duration: 30 minutes',
  ].join('\n');

  const html = darkHtml('OpenWiz call cancelled', [
    '<p style="margin:0 0 16px;">Your OpenWiz call has been cancelled.</p>',
    times.html,
    '<p style="margin:0;"><strong>Duration:</strong> 30 minutes</p>',
  ].join(''));

  return {
    from,
    to: [booking.email],
    subject: 'OpenWiz call cancelled',
    text,
    html,
  };
}

function cancelOwnerMessage(booking, ownerEmail, from) {
  const pacificWhen = formatWhen(booking.start, PACIFIC);
  const name = String(booking.name ?? '');
  const email = String(booking.email ?? '');
  const team = String(booking.team ?? '');

  const text = [
    'An OpenWiz call was cancelled.',
    '',
    `Time (${PACIFIC}): ${pacificWhen}`,
    `Name: ${name}`,
    `Email: ${email}`,
    `Team: ${team}`,
  ].join('\n');

  const html = darkHtml('OpenWiz call cancelled', [
    `<p style="margin:0 0 12px;"><strong>Time (${escapeHtml(PACIFIC)}):</strong> ${escapeHtml(pacificWhen)}</p>`,
    `<p style="margin:0 0 8px;"><strong>Name:</strong> ${escapeHtml(name)}</p>`,
    `<p style="margin:0 0 8px;"><strong>Email:</strong> ${escapeHtml(email)}</p>`,
    `<p style="margin:0;"><strong>Team:</strong> ${escapeHtml(team)}</p>`,
  ].join(''));

  return {
    from,
    to: [ownerEmail],
    reply_to: email,
    subject: 'OpenWiz call cancelled',
    text,
    html,
  };
}

async function sendResend(apiKey, idempotencyKey, payload, fetchFn) {
  try {
    const response = await fetchFn(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const data = await response.json();
    return Boolean(data && typeof data === 'object' && !Array.isArray(data));
  } catch {
    return false;
  }
}

export function icsFor(booking, env) {
  const meetingUrl = nonEmpty(env?.BOOK_MEETING_URL);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenWiz//Book//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(booking?.id)}@openwiz.dev`,
    `DTSTAMP:${formatIcsUtc(booking.start)}`,
    `DTSTART:${formatIcsUtc(booking.start)}`,
    `DTEND:${formatIcsUtc(booking.end)}`,
    'SUMMARY:OpenWiz call',
  ];
  if (meetingUrl) lines.push(`LOCATION:${escapeIcsText(meetingUrl)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

export async function sendBookingMail(env, booking, { fetch = globalThis.fetch } = {}) {
  const apiKey = nonEmpty(env?.RESEND_API_KEY);
  if (!apiKey) return 'skipped';
  const from = nonEmpty(env?.BOOK_FROM) || DEFAULT_FROM;
  const ownerEmail = nonEmpty(env?.BOOK_OWNER_EMAIL);

  const visitorOk = await sendResend(
    apiKey,
    `book-${booking.id}-visitor`,
    bookingVisitorMessage(booking, env, from),
    fetch,
  );
  if (ownerEmail) {
    await sendResend(
      apiKey,
      `book-${booking.id}-owner`,
      bookingOwnerMessage(booking, ownerEmail, from),
      fetch,
    );
  }
  return visitorOk ? 'sent' : 'failed';
}

export async function sendCancelMail(env, booking, { fetch = globalThis.fetch } = {}) {
  const apiKey = nonEmpty(env?.RESEND_API_KEY);
  if (!apiKey) return 'skipped';
  const from = nonEmpty(env?.BOOK_FROM) || DEFAULT_FROM;
  const ownerEmail = nonEmpty(env?.BOOK_OWNER_EMAIL);

  const visitorOk = await sendResend(
    apiKey,
    `cancel-${booking.id}-visitor`,
    cancelVisitorMessage(booking, from),
    fetch,
  );
  if (ownerEmail) {
    await sendResend(
      apiKey,
      `cancel-${booking.id}-owner`,
      cancelOwnerMessage(booking, ownerEmail, from),
      fetch,
    );
  }
  return visitorOk ? 'sent' : 'failed';
}
