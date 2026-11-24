const visitorTz = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

const els = {
  live: document.getElementById('book-live'),
  alert: document.getElementById('book-alert'),
  loading: document.getElementById('book-loading'),
  picker: document.getElementById('book-picker'),
  tz: document.getElementById('book-tz'),
  days: document.getElementById('book-days'),
  dayHeading: document.getElementById('book-day-heading'),
  slots: document.getElementById('book-slots'),
  form: document.getElementById('book-form'),
  chosenWhen: document.getElementById('book-chosen-when'),
  changeBtn: document.getElementById('book-change'),
  name: document.getElementById('book-name'),
  email: document.getElementById('book-email'),
  team: document.getElementById('book-team'),
  website: document.getElementById('book-website'),
  nameErr: document.getElementById('book-name-error'),
  emailErr: document.getElementById('book-email-error'),
  teamErr: document.getElementById('book-team-error'),
  submit: document.getElementById('book-submit'),
  turnstile: document.getElementById('book-turnstile'),
  confirm: document.getElementById('book-confirm'),
  confirmWhen: document.getElementById('book-confirm-when'),
  confirmNote: document.getElementById('book-confirm-note'),
  icsBtn: document.getElementById('book-ics'),
  empty: document.getElementById('book-empty'),
  rateLimited: document.getElementById('book-rate-limited'),
  rateRetry: document.getElementById('book-rate-retry'),
  unavailable: document.getElementById('book-unavailable'),
  unavailableText: document.getElementById('book-unavailable-text'),
  offline: document.getElementById('book-offline'),
  offlineRetry: document.getElementById('book-offline-retry'),
  cancel: document.getElementById('book-cancel'),
  cancelBtn: document.getElementById('book-cancel-btn'),
  cancelled: document.getElementById('book-cancelled'),
};

const views = [
  els.loading,
  els.picker,
  els.form,
  els.confirm,
  els.empty,
  els.rateLimited,
  els.unavailable,
  els.offline,
  els.cancel,
  els.cancelled,
];

const state = {
  minutes: 30,
  dayMap: new Map(),
  dayList: [],
  selectedDay: null,
  selectedSlot: null,
  booking: null,
  cancelPair: null,
  currentView: els.loading,
  turnstileSiteKey: undefined,
};

function announce(text) {
  els.live.textContent = '';
  requestAnimationFrame(() => {
    els.live.textContent = text;
  });
}

function showAlert(text, { focus = false } = {}) {
  if (!text) {
    els.alert.hidden = true;
    els.alert.textContent = '';
    return;
  }
  els.alert.textContent = text;
  els.alert.hidden = false;
  if (focus) {
    els.alert.scrollIntoView({ behavior: 'instant', block: 'center' });
    els.alert.focus({ preventScroll: true });
  }
}

function showView(target) {
  state.currentView = target;
  for (const view of views) {
    view.hidden = view !== target;
  }
}

function localDayKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: visitorTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function buildDayList(rawSlots) {
  const days = [];
  const todayKey = localDayKey(new Date());
  const [year, monthNum, dayNum] = todayKey.split('-').map(Number);
  let lastSlotKey = '';
  for (const iso of rawSlots) {
    const key = localDayKey(new Date(iso));
    if (key > lastSlotKey) lastSlotKey = key;
  }
  let prevMonth = null;
  for (let i = 0; i < 22; i++) {
    const cal = new Date(Date.UTC(year, monthNum - 1, dayNum + i, 12, 0, 0));
    const key = cal.toISOString().slice(0, 10);
    const month = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(cal);
    const monthChanged = prevMonth !== null && month !== prevMonth;
    prevMonth = month;
    days.push({
      key,
      month,
      monthChanged,
      weekday: new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(cal),
      dayNum: new Intl.DateTimeFormat(undefined, { day: 'numeric', timeZone: 'UTC' }).format(cal),
      fullLabel: new Intl.DateTimeFormat(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(cal),
    });
    if (days.length >= 14 && (!lastSlotKey || key >= lastSlotKey)) break;
  }
  return days;
}

function shortZoneName(date) {
  const parts = new Intl.DateTimeFormat(undefined, {
    timeZone: visitorTz,
    timeZoneName: 'short',
  }).formatToParts(date);
  return parts.find(p => p.type === 'timeZoneName')?.value || '';
}

function friendlyZoneLabel(sampleIso) {
  const sampleDate = sampleIso ? new Date(sampleIso) : new Date();
  const abbr = shortZoneName(sampleDate);
  if (visitorTz === 'UTC' || visitorTz === 'Etc/UTC') return 'Times in UTC';
  const city = visitorTz.split('/').pop().replaceAll('_', ' ');
  return abbr ? `Times in ${city} time (${abbr})` : `Times in ${city} time`;
}

function formatTime(iso) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: visitorTz,
  }).format(new Date(iso));
}

function formatFullSlot(iso) {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: visitorTz,
  }).format(d);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: visitorTz,
  }).format(d);
  return `${day} · ${time}`;
}

function renderDays() {
  els.days.textContent = '';
  for (const day of state.dayList) {
    const slots = state.dayMap.get(day.key) || [];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'book-day';
    btn.dataset.day = day.key;
    btn.setAttribute('aria-label', slots.length ? `${day.fullLabel}, ${slots.length} open times` : `${day.fullLabel}, no open times`);
    btn.setAttribute('aria-pressed', day.key === state.selectedDay ? 'true' : 'false');
    if (slots.length === 0) btn.disabled = true;

    if (day.monthChanged) {
      const mo = document.createElement('span');
      mo.className = 'book-day-month';
      mo.textContent = day.month;
      btn.appendChild(mo);
    }
    const wd = document.createElement('span');
    wd.className = 'book-day-wd';
    wd.textContent = day.weekday;
    const num = document.createElement('span');
    num.className = 'book-day-num';
    num.textContent = day.dayNum;
    btn.append(wd, num);

    if (slots.length > 0) {
      const dot = document.createElement('span');
      dot.className = 'book-day-dot';
      dot.setAttribute('aria-hidden', 'true');
      btn.appendChild(dot);
    }

    btn.addEventListener('click', () => selectDay(day.key, true));
    btn.addEventListener('keydown', onDayKeyDown);
    els.days.appendChild(btn);
  }
}

function onDayKeyDown(event) {
  const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const enabled = [...els.days.querySelectorAll('.book-day:not(:disabled)')];
  const idx = enabled.indexOf(event.currentTarget);
  if (idx === -1) return;
  event.preventDefault();
  let nextIdx = idx;
  if (event.key === 'ArrowRight') nextIdx = (idx + 1) % enabled.length;
  if (event.key === 'ArrowLeft') nextIdx = (idx - 1 + enabled.length) % enabled.length;
  if (event.key === 'Home') nextIdx = 0;
  if (event.key === 'End') nextIdx = enabled.length - 1;
  const target = enabled[nextIdx];
  selectDay(target.dataset.day, true);
  target.focus();
}

function selectDay(dayKey, announceChange) {
  state.selectedDay = dayKey;
  for (const btn of els.days.querySelectorAll('.book-day')) {
    btn.setAttribute('aria-pressed', btn.dataset.day === dayKey ? 'true' : 'false');
  }
  const dayInfo = state.dayList.find(d => d.key === dayKey);
  const slots = state.dayMap.get(dayKey) || [];
  els.dayHeading.textContent = dayInfo ? dayInfo.fullLabel : '';
  els.slots.textContent = '';

  for (const iso of slots) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'book-slot';
    btn.dataset.slot = iso;
    btn.textContent = formatTime(iso);
    btn.setAttribute('aria-pressed', iso === state.selectedSlot ? 'true' : 'false');
    btn.addEventListener('click', () => chooseSlot(iso));
    els.slots.appendChild(btn);
  }

  if (announceChange && dayInfo) {
    announce(`${dayInfo.fullLabel}, ${slots.length} open times`);
  }
}

let turnstileScript;
let widgetId;

function loadTurnstile() {
  turnstileScript ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => {
      clearTimeout(timeout);
      script.remove();
      turnstileScript = undefined;
      reject(new Error('Could not load Turnstile'));
    };
    const timeout = setTimeout(fail, 8000);
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.onload = () => {
      if (!window.turnstile) return fail();
      clearTimeout(timeout);
      resolve(window.turnstile);
    };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return turnstileScript;
}

async function prepareTurnstile() {
  const sitekey = state.turnstileSiteKey;
  if (!sitekey || !navigator.onLine) return;
  const api = await loadTurnstile();
  if (state.currentView !== els.form || sitekey !== state.turnstileSiteKey || widgetId !== undefined) return;
  widgetId = api.render(els.turnstile, {
    sitekey,
    action: 'book',
    appearance: 'interaction-only',
    size: 'compact',
    'response-field': false,
  }) ?? undefined;
}

function chooseSlot(iso) {
  state.selectedSlot = iso;
  showAlert('');
  els.chosenWhen.textContent = formatFullSlot(iso);
  showView(els.form);
  prepareTurnstile().catch(() => {});
  els.name.focus();
  announce(`Selected ${formatFullSlot(iso)}`);
}

function clearFieldErrors() {
  for (const [input, err] of [
    [els.name, els.nameErr],
    [els.email, els.emailErr],
    [els.team, els.teamErr],
  ]) {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
    err.textContent = '';
  }
}

function hasControlChars(text) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function validateForm() {
  clearFieldErrors();
  const name = els.name.value.trim();
  const email = els.email.value.trim();
  const team = els.team.value.trim();
  const errors = [];

  if (!name || name.length > 80 || hasControlChars(name)) {
    errors.push([els.name, els.nameErr, 'Enter your name (up to 80 characters).']);
  }
  if (!email || email.length > 254 || hasControlChars(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push([els.email, els.emailErr, 'Enter a valid email address.']);
  }
  if (!team || team.length > 200 || hasControlChars(team)) {
    errors.push([els.team, els.teamErr, 'Add one line about your team (up to 200 characters).']);
  }

  if (errors.length) {
    for (const [input, err, msg] of errors) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', err.id);
      err.textContent = msg;
    }
    errors[0][0].focus();
    announce(errors[0][2]);
    return null;
  }

  return { name, email, team, website: els.website.value };
}

function toIcsUtc(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function foldIcsLine(line) {
  const encoder = new TextEncoder();
  const out = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const len = encoder.encode(ch).length;
    if (bytes + len > limit && current) {
      out.push(current);
      current = ' ' + ch;
      bytes = 1 + len;
      limit = 75;
    } else {
      current += ch;
      bytes += len;
    }
  }
  if (current) out.push(current);
  return out.join('\r\n');
}

function downloadIcs() {
  if (!state.booking) return;
  const { id, start, end } = state.booking;
  const rawLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenWiz//Book//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${id}@openwiz.dev`,
    `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    'SUMMARY:OpenWiz — 30-minute team call',
    'DESCRIPTION:30-minute setup call with Jake. Bring your repo and agent.',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  const ics = rawLines.map(foldIcsLine).join('\r\n') + '\r\n';
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'openwiz-call.ics';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function submitBooking(event) {
  event.preventDefault();
  if (els.submit.disabled) return;
  const fields = validateForm();
  const start = state.selectedSlot;
  if (!fields || !start) return;

  if (!navigator.onLine) {
    showAlert('Booking needs an internet connection. Reconnect and try again.', { focus: true });
    announce('Booking needs an internet connection.');
    return;
  }

  showAlert('');
  els.submit.disabled = true;
  let turnstileToken;
  let attemptedWidget;
  try {
    if (state.turnstileSiteKey !== undefined) {
      try {
        await prepareTurnstile();
        if (state.currentView !== els.form || state.selectedSlot !== start) return;
        if (widgetId === undefined) throw new Error('Turnstile is unavailable');
        turnstileToken = window.turnstile.getResponse(widgetId);
      } catch {
        showAlert('Human verification is unavailable. Check your connection and try again.', { focus: true });
        return;
      }
      if (!turnstileToken) {
        showAlert('Complete human verification or wait for it to finish, then try again.');
        return;
      }
      attemptedWidget = widgetId;
    }

    const res = await fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        start,
        name: fields.name,
        email: fields.email,
        team: fields.team,
        website: fields.website,
        tz: visitorTz,
        turnstileToken,
      }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 200 && data.ok && data.booking) {
      state.booking = data.booking;
      els.confirmWhen.textContent = formatFullSlot(data.booking.start);
      if (data.email === 'sent') {
        els.confirmNote.textContent = `A confirmation is on its way to ${fields.email}.`;
      } else {
        els.confirmNote.textContent = 'No email is coming, so add it to your calendar now.';
      }
      showView(els.confirm);
      announce('Your call is booked.');
      return;
    }

    if (res.status === 409 || data.error === 'slot_taken') {
      state.selectedSlot = null;
      showAlert('That time was just taken. Pick another below.', { focus: true });
      await loadSlots({ keepAlert: true });
      return;
    }

    if (res.status === 429 || data.error === 'rate_limited') {
      showAlert(data.message || 'Too many requests. Wait a minute and try again.', { focus: true });
      return;
    }

    if (res.status === 503 || data.error === 'unavailable') {
      els.unavailableText.textContent = 'Check back soon, or see the team page for how the call works.';
      showView(els.unavailable);
      return;
    }

    showAlert(data.message || 'Check your details and try again.', { focus: true });
  } catch {
    if (!navigator.onLine) {
      showAlert('Booking needs an internet connection. Reconnect and try again.', { focus: true });
    } else {
      showAlert('Something went wrong. Please try again.', { focus: true });
    }
  } finally {
    els.submit.disabled = false;
    if (attemptedWidget !== undefined && attemptedWidget === widgetId) {
      window.turnstile.reset(attemptedWidget);
    }
  }
}

async function loadSlots({ keepAlert = false } = {}) {
  if (!keepAlert) showAlert('');
  if (!navigator.onLine) {
    showView(els.offline);
    announce('Booking needs an internet connection.');
    return;
  }
  showView(els.loading);

  try {
    const res = await fetch('/api/book/slots', { headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({}));

    if (res.status === 429 || data.error === 'rate_limited') {
      showView(els.rateLimited);
      announce('Too many requests.');
      return;
    }

    if (!res.ok) {
      els.unavailableText.textContent = 'Check back soon, or see the team page for how the call works.';
      showView(els.unavailable);
      announce('Booking is closed right now.');
      return;
    }

    if (data.turnstileSiteKey !== state.turnstileSiteKey && widgetId !== undefined) {
      window.turnstile.remove(widgetId);
      widgetId = undefined;
    }
    state.turnstileSiteKey = data.turnstileSiteKey;
    state.minutes = data.minutes || 30;
    const rawSlots = Array.isArray(data.slots) ? data.slots : [];
    state.dayList = buildDayList(rawSlots);
    state.dayMap = new Map();
    for (const day of state.dayList) state.dayMap.set(day.key, []);

    for (const iso of rawSlots) {
      const key = localDayKey(new Date(iso));
      if (state.dayMap.has(key)) {
        state.dayMap.get(key).push(iso);
      }
    }

    const firstOpen = state.dayList.find(d => (state.dayMap.get(d.key) || []).length > 0);
    if (!firstOpen) {
      showView(els.empty);
      announce('No open times in the next 14 days.');
      return;
    }

    const sampleSlot = state.dayMap.get(firstOpen.key)[0];
    els.tz.textContent = friendlyZoneLabel(sampleSlot);
    state.selectedDay = firstOpen.key;
    renderDays();
    selectDay(firstOpen.key, false);
    showView(els.picker);
    announce(`Loaded open times. ${firstOpen.fullLabel} selected.`);
  } catch {
    if (!navigator.onLine) {
      showView(els.offline);
      announce('Booking needs an internet connection.');
    } else {
      els.unavailableText.textContent = 'Check back soon, or see the team page for how the call works.';
      showView(els.unavailable);
      announce('Booking is closed right now.');
    }
  }
}

async function runCancel() {
  if (!state.cancelPair) return;
  showAlert('');
  if (!navigator.onLine) {
    showView(els.offline);
    announce('Booking needs an internet connection.');
    return;
  }
  els.cancelBtn.disabled = true;
  try {
    const res = await fetch('/api/book/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(state.cancelPair),
    });
    if (res.ok) {
      state.cancelPair = null;
      showView(els.cancelled);
      announce('Your call has been cancelled.');
      return;
    }
    const data = await res.json().catch(() => ({}));
    showView(els.cancel);
    showAlert(data.message || 'Could not cancel this call.', { focus: true });
  } catch {
    if (!navigator.onLine) {
      showView(els.offline);
      announce('Booking needs an internet connection.');
    } else {
      showView(els.cancel);
      showAlert('Could not cancel this call. Please try again.', { focus: true });
    }
  } finally {
    els.cancelBtn.disabled = false;
  }
}

function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/book/sw.js', { scope: '/book/' }).catch(() => {});
}

function init() {
  registerWorker();
  els.form.addEventListener('submit', submitBooking);
  for (const [input, err] of [
    [els.name, els.nameErr],
    [els.email, els.emailErr],
    [els.team, els.teamErr],
  ]) {
    input.addEventListener('input', () => {
      if (input.getAttribute('aria-invalid') === 'true') {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
        err.textContent = '';
      }
    });
  }
  els.changeBtn.addEventListener('click', () => {
    showAlert('');
    showView(els.picker);
  });
  els.icsBtn.addEventListener('click', downloadIcs);
  els.rateRetry.addEventListener('click', () => loadSlots());
  els.offlineRetry.addEventListener('click', () => {
    if (state.cancelPair) {
      runCancel();
    } else {
      loadSlots();
    }
  });
  els.cancelBtn.addEventListener('click', runCancel);

  window.addEventListener('offline', () => {
    if (state.currentView === els.loading || state.currentView === els.picker) {
      showView(els.offline);
      announce('Booking needs an internet connection.');
    }
  });
  window.addEventListener('online', () => {
    if (state.currentView === els.form) prepareTurnstile().catch(() => {});
    if (state.currentView === els.offline) {
      if (state.cancelPair) {
        showView(els.cancel);
      } else {
        loadSlots();
      }
    }
  });

  const params = new URLSearchParams(window.location.search);
  const cancelParam = params.get('cancel');
  if (cancelParam) {
    window.history.replaceState(null, '', window.location.pathname);
    const dot = cancelParam.indexOf('.');
    if (dot > 0 && dot < cancelParam.length - 1) {
      state.cancelPair = {
        id: cancelParam.slice(0, dot),
        token: cancelParam.slice(dot + 1),
      };
      showView(els.cancel);
      return;
    }
    showAlert('This cancel link is not valid.', { focus: true });
  }

  loadSlots();
}

init();
