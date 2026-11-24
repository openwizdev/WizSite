import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = new URL('../', import.meta.url);
const DIST = new URL('dist/', ROOT);
const FIXTURES = new URL('book-fixtures/', import.meta.url);

const TYPES = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
  webp: 'image/webp',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
};

function parseArgs(argv) {
  let shots = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--shots' && argv[i + 1]) {
      shots = resolve(argv[++i]);
    }
  }
  return { shots };
}

function chromePath() {
  const found = [
    process.env.CHROME,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find(path => path && existsSync(path));
  if (!found) throw new Error('no Chrome or Chromium found; set CHROME');
  return found;
}

async function loadHeaders() {
  const raw = await readFile(new URL('_headers', DIST), 'utf8');
  const rules = [];
  let current = null;
  for (const line of raw.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (!line.startsWith(' ')) {
      const pattern = new RegExp(`^${line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
      current = { pattern, headers: {} };
      rules.push(current);
    } else if (current) {
      const at = line.indexOf(':');
      current.headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }
  return path => {
    const out = {};
    for (const rule of rules) {
      if (rule.pattern.test(path)) Object.assign(out, rule.headers);
    }
    return out;
  };
}

function buildSlots(template) {
  const now = new Date();
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const slots = [];
  for (const group of template.offsets) {
    for (const hour of group.utcHours) {
      const h = Math.floor(hour);
      const m = Math.round((hour - h) * 60);
      const ms = base + group.days * 86400000 + h * 3600000 + m * 60000;
      slots.push(new Date(ms).toISOString().replace('.000Z', 'Z'));
    }
  }
  return {
    schema: template.schema,
    mode: template.mode,
    timezone: template.timezone,
    minutes: template.minutes,
    slots,
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function startServer(slotsData) {
  const getHeaders = await loadHeaders();
  const state = {
    slotsMode: 'ok',
    slotsDelayMs: 0,
    slotsCalls: 0,
    bookMode: 'sent',
    bookPayloads: [],
    cancelPayloads: [],
    slotsData,
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname;

    if (path === '/api/book/slots' && req.method === 'GET') {
      state.slotsCalls++;
      if (state.slotsDelayMs > 0) {
        await new Promise(r => setTimeout(r, state.slotsDelayMs));
      }
      const common = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
      if (state.slotsMode === 'unavailable') {
        res.writeHead(503, common);
        res.end(JSON.stringify({ error: 'unavailable', message: 'Booking is not open right now.' }));
        return;
      }
      if (state.slotsMode === 'rate_limited') {
        res.writeHead(429, common);
        res.end(JSON.stringify({ error: 'rate_limited', message: 'Too many requests. Try again in a minute.' }));
        return;
      }
      if (state.slotsMode === 'empty') {
        res.writeHead(200, common);
        res.end(JSON.stringify({ ...state.slotsData, slots: [] }));
        return;
      }
      res.writeHead(200, common);
      res.end(JSON.stringify(state.slotsData));
      return;
    }

    if (path === '/api/book' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      state.bookPayloads.push(body);
      const common = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
      if (state.bookMode === 'slot_taken') {
        res.writeHead(409, common);
        res.end(JSON.stringify({ error: 'slot_taken', message: 'That time was just taken.' }));
        return;
      }
      if (state.bookMode === 'rate_limited') {
        res.writeHead(429, common);
        res.end(JSON.stringify({ error: 'rate_limited', message: 'Too many requests.' }));
        return;
      }
      if (state.bookMode === 'unavailable') {
        res.writeHead(503, common);
        res.end(JSON.stringify({ error: 'unavailable', message: 'Booking is not open right now.' }));
        return;
      }
      const end = new Date(Date.parse(body.start) + 30 * 60000).toISOString().replace('.000Z', 'Z');
      res.writeHead(200, common);
      res.end(JSON.stringify({
        ok: true,
        booking: { id: 'bk_demo01', start: body.start, end },
        email: state.bookMode === 'skipped' ? 'skipped' : 'sent',
      }));
      return;
    }

    if (path === '/api/book/cancel' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      state.cancelPayloads.push(body);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    let file = decodeURIComponent(path).replace(/^\/+/, '');
    if (file === '' || file.endsWith('/')) file += 'index.html';
    const target = new URL(file, DIST);
    if (!target.href.startsWith(DIST.href) || !existsSync(target)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const ext = file.split('.').pop();
    const hdrs = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      ...getHeaders(path),
    };
    res.writeHead(200, hdrs);
    res.end(await readFile(target));
  });

  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    state,
    close: () => new Promise(r => server.close(r)),
  };
}

async function launchBrowser() {
  const profile = await mkdtemp(join(tmpdir(), 'book-check-'));
  const child = spawn(
    chromePath(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--no-sandbox',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const wsUrl = await new Promise((resolveUrl, rejectUrl) => {
    let text = '';
    child.stderr.on('data', chunk => {
      text += chunk;
      const match = text.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolveUrl(match[1]);
    });
    child.on('exit', code => rejectUrl(new Error(`browser exited (${code}): ${text.slice(-400)}`)));
  });

  const socket = new WebSocket(wsUrl);
  await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });

  let nextId = 0;
  const waiting = new Map();
  const listeners = [];
  socket.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && waiting.has(msg.id)) {
      const { resolve: res, reject: rej } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  };

  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = ++nextId;
    waiting.set(id, { resolve: res, reject: rej });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  const close = async () => {
    socket.close();
    child.kill();
    await new Promise(r => child.once('exit', r));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  };

  return { send, on: fn => listeners.push(fn), close };
}

async function openTab(browser, width, height) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const errors = [];
  browser.on(msg => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(`exception: ${msg.params.exceptionDetails?.text || 'unknown'}`);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const entry = msg.params.entry;
      const expectedApiStatus = entry.source === 'network' &&
        (entry.url || '').includes('/api/book') &&
        /\b(409|429|503)\b/.test(entry.text || '');
      if (!expectedApiStatus) {
        errors.push(`log(${entry.source}): ${entry.text}`);
      }
    }
  });
  await browser.send('Page.enable', {}, sessionId);
  await browser.send('Runtime.enable', {}, sessionId);
  await browser.send('Network.enable', {}, sessionId);
  await browser.send('Log.enable', {}, sessionId);
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: width < 600,
  }, sessionId);
  await browser.send('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' }, sessionId);

  const evalJs = async expression => {
    const res = await browser.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    if (res.exceptionDetails) {
      throw new Error(`eval error: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
    }
    return res.result?.value;
  };

  const waitFor = async (fnExpr, timeoutMs = 8000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await evalJs(fnExpr);
      if (ok) return ok;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`timed out waiting for: ${fnExpr}`);
  };

  const goto = async url => {
    await browser.send('Page.navigate', { url }, sessionId);
    await waitFor('document.readyState === "complete"');
  };

  const shot = async filePath => {
    if (!filePath) return;
    const { data } = await browser.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    await writeFile(filePath, Buffer.from(data, 'base64'));
  };

  const close = async () => {
    await browser.send('Target.closeTarget', { targetId });
  };

  return { sessionId, evalJs, waitFor, goto, shot, errors, close };
}

async function runWidth(browser, srv, { name, width, height, shotsDir }) {
  const tab = await openTab(browser, width, height);
  try {
    const shotPath = file => (shotsDir ? join(shotsDir, `${name}-${file}.png`) : null);

    srv.state.slotsMode = 'ok';
    srv.state.slotsDelayMs = 350;
    await browser.send('Page.navigate', { url: `${srv.origin}/book/` }, tab.sessionId);
    await tab.waitFor('Boolean(document.querySelector("[data-state=\'loading\']:not([hidden])"))');
    const hasSkeleton = await tab.evalJs('Boolean(document.querySelector("[data-state=\'loading\']:not([hidden]) .book-skeleton"))');
    assert(hasSkeleton, `${name}: expected visible quiet loading skeleton`);
    srv.state.slotsDelayMs = 0;

    await tab.waitFor('document.querySelectorAll(".book-slot").length > 0');
    const pickerCheck = await tab.evalJs(`(() => {
      const days = [...document.querySelectorAll('.book-day')];
      const enabled = days.filter(d => !d.disabled);
      const disabled = days.filter(d => d.disabled);
      const selected = days.find(d => d.getAttribute('aria-pressed') === 'true');
      const slots = [...document.querySelectorAll('.book-slot')];
      const minHeight = Math.min(...slots.map(s => s.getBoundingClientRect().height));
      const tzText = document.querySelector('.book-tz')?.textContent || '';
      const navTeamBg = getComputedStyle(document.querySelector('.nav-team')).backgroundColor;
      const overflow = document.documentElement.scrollWidth > window.innerWidth;
      return {
        dayCount: days.length,
        enabledCount: enabled.length,
        disabledCount: disabled.length,
        firstEnabledSelected: selected === enabled[0],
        slotCount: slots.length,
        minHeight,
        tzText,
        navTeamBg,
        overflow,
      };
    })()`);
    assert(pickerCheck.dayCount >= 14 && pickerCheck.dayCount <= 15, `${name}: expected 14 or 15 days, got ${pickerCheck.dayCount}`);
    assert(pickerCheck.enabledCount === 4, `${name}: expected 4 enabled days (including 15th-day slot), got ${pickerCheck.enabledCount}`);
    assert(pickerCheck.firstEnabledSelected, `${name}: first day with free time should be selected`);
    assert(pickerCheck.slotCount === 4, `${name}: expected 4 slots on first day, got ${pickerCheck.slotCount}`);
    assert(pickerCheck.minHeight >= 44, `${name}: slot tap target too small: ${pickerCheck.minHeight}px`);
    assert(pickerCheck.tzText.includes('New York') && !pickerCheck.tzText.includes('America/New_York'),
      `${name}: time zone should be friendly, not raw IANA: ${pickerCheck.tzText}`);
    assert(pickerCheck.navTeamBg === 'rgba(0, 0, 0, 0)' || pickerCheck.navTeamBg === 'transparent',
      `${name}: .nav-team should be a quiet link on /book, got bg ${pickerCheck.navTeamBg}`);
    assert(!pickerCheck.overflow, `${name}: horizontal overflow on picker`);
    const monthCueCheck = await tab.evalJs(`(() => {
      const changed = [...document.querySelectorAll('.book-day')].filter(b => b.querySelector('.book-day-month'));
      return changed.map(b => ({
        month: b.querySelector('.book-day-month')?.textContent?.trim(),
        wd: b.querySelector('.book-day-wd')?.textContent?.trim(),
      }));
    })()`);
    for (const item of monthCueCheck) {
      assert(item.month && item.wd && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/i.test(item.wd) && item.wd.toLowerCase() !== item.month.toLowerCase(),
        `${name}: month change must keep weekday alongside month label: ${JSON.stringify(item)}`);
    }
    await tab.shot(shotPath('picker'));

    const kbCheck = await tab.evalJs(`(() => {
      const enabled = [...document.querySelectorAll('.book-day:not(:disabled)')];
      enabled[0].focus();
      enabled[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      const afterRight = document.activeElement === enabled[1] && enabled[1].getAttribute('aria-pressed') === 'true';
      const slotsAfterRight = document.querySelectorAll('.book-slot').length;
      enabled[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      const afterLeft = document.activeElement === enabled[0] && enabled[0].getAttribute('aria-pressed') === 'true';
      return { afterRight, slotsAfterRight, afterLeft };
    })()`);
    assert(kbCheck.afterRight && kbCheck.slotsAfterRight === 2 && kbCheck.afterLeft,
      `${name}: keyboard day navigation failed: ${JSON.stringify(kbCheck)}`);

    await tab.evalJs('document.querySelector(".book-slot").click()');
    await tab.waitFor('Boolean(document.querySelector(".book-form") && !document.querySelector(".book-form").hidden)');

    const hpCheck = await tab.evalJs(`(() => {
      const hp = document.querySelector('input[name="website"]');
      if (!hp) return null;
      const style = getComputedStyle(hp);
      const wrapStyle = getComputedStyle(hp.parentElement);
      return {
        tabindex: hp.getAttribute('tabindex'),
        autocomplete: hp.getAttribute('autocomplete'),
        notDisplayNone: style.display !== 'none' && wrapStyle.display !== 'none',
      };
    })()`);
    assert(hpCheck && hpCheck.tabindex === '-1' && hpCheck.autocomplete === 'off' && hpCheck.notDisplayNone,
      `${name}: honeypot requirements failed: ${JSON.stringify(hpCheck)}`);

    await tab.evalJs('document.querySelector(".book-submit").click()');
    const invalidFocus = await tab.evalJs(`(() => ({
      activeId: document.activeElement?.id,
      nameInvalid: document.querySelector('#book-name')?.getAttribute('aria-invalid'),
      errText: document.querySelector('#book-name-error')?.textContent?.trim(),
    }))()`);
    assert(invalidFocus.activeId === 'book-name' && invalidFocus.nameInvalid === 'true' && invalidFocus.errText,
      `${name}: inline validation failed: ${JSON.stringify(invalidFocus)}`);

    await tab.evalJs(`(() => {
      const fill = (sel, val) => {
        const el = document.querySelector(sel);
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      fill('#book-name', 'Alex Rivera');
      fill('#book-email', 'alex@example.com');
      fill('#book-team', 'Three engineers shipping a CLI tool with Claude Code.');
      document.querySelector('.book-surface').scrollIntoView({ block: 'start' });
    })()`);
    const formOverflow = await tab.evalJs('document.documentElement.scrollWidth > window.innerWidth');
    assert(!formOverflow, `${name}: horizontal overflow on form`);
    await tab.shot(shotPath('form'));

    srv.state.bookMode = 'rate_limited';
    await tab.evalJs('document.querySelector(".book-submit").scrollIntoView({ block: "end" }); document.querySelector(".book-submit").click();');
    await tab.waitFor('Boolean(document.querySelector("#book-alert:not([hidden])"))');
    const postErrorCheck = await tab.evalJs(`(() => {
      const el = document.querySelector('#book-alert');
      const r = el.getBoundingClientRect();
      return {
        focused: document.activeElement === el,
        inView: r.top >= 0 && r.bottom <= window.innerHeight,
        top: r.top,
        bottom: r.bottom,
        vh: window.innerHeight,
      };
    })()`);
    assert(postErrorCheck.focused && postErrorCheck.inView,
      `${name}: POST error alert must be focused and visible in viewport: ${JSON.stringify(postErrorCheck)}`);

    srv.state.bookMode = 'slot_taken';
    srv.state.slotsDelayMs = 350;
    const callsBefore = srv.state.slotsCalls;
    await tab.evalJs('document.querySelector(".book-submit").click()');
    await tab.waitFor(`Boolean(document.querySelector('.book-alert')?.textContent?.toLowerCase().includes('taken'))`);
    await tab.waitFor('Boolean(document.querySelector("#book-picker:not([hidden]) .book-slot"))');
    srv.state.slotsDelayMs = 0;
    assert(srv.state.slotsCalls > callsBefore, `${name}: slot_taken should reload slots`);
    const keptValues = await tab.evalJs(`(() => ({
      name: document.querySelector('#book-name').value,
      email: document.querySelector('#book-email').value,
      team: document.querySelector('#book-team').value,
    }))()`);
    assert(keptValues.name === 'Alex Rivera' && keptValues.email === 'alex@example.com' && keptValues.team.includes('CLI tool'),
      `${name}: slot_taken lost typed form values: ${JSON.stringify(keptValues)}`);

    srv.state.bookMode = 'sent';
    srv.state.bookPayloads.length = 0;
    await tab.evalJs('document.querySelector(".book-slot").click()');
    await tab.waitFor('Boolean(document.querySelector(".book-form") && !document.querySelector(".book-form").hidden)');
    await tab.evalJs('document.querySelector(".book-submit").click()');
    await tab.waitFor('Boolean(document.querySelector(".book-confirm") && !document.querySelector(".book-confirm").hidden)');

    assert(srv.state.bookPayloads.length === 1, `${name}: expected one POST /api/book`);
    const payload = srv.state.bookPayloads[0];
    assert(payload.tz === 'America/New_York' && payload.website === '' && payload.name === 'Alex Rivera',
      `${name}: unexpected booking payload: ${JSON.stringify(payload)}`);

    const confirmCheck = await tab.evalJs(`(() => {
      const text = document.querySelector('.book-confirm').textContent;
      const when = document.querySelector('#book-confirm-when')?.textContent || '';
      const icsBtn = document.querySelector('.book-ics');
      const overflow = document.documentElement.scrollWidth > window.innerWidth;
      return { text, when, hasIcs: Boolean(icsBtn), overflow };
    })()`);
    assert(confirmCheck.text.includes('A confirmation is on its way to alex@example.com'),
      `${name}: missing confirmation email wording: ${confirmCheck.text}`);
    assert(!confirmCheck.when.includes('America/New_York'),
      `${name}: confirmation time should not include raw IANA zone: ${confirmCheck.when}`);
    assert(confirmCheck.hasIcs, `${name}: missing Add to calendar button`);
    assert(/install/i.test(confirmCheck.text), `${name}: missing install hint`);
    assert(!confirmCheck.overflow, `${name}: horizontal overflow on confirmation`);
    await tab.shot(shotPath('confirmation'));

    const icsContent = await tab.evalJs(`(async () => {
      let captured = null;
      const orig = URL.createObjectURL;
      URL.createObjectURL = blob => { captured = blob; return 'blob:captured'; };
      const origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = () => {};
      try {
        document.querySelector('.book-ics').click();
        return captured ? await captured.text() : '';
      } finally {
        URL.createObjectURL = orig;
        HTMLAnchorElement.prototype.click = origClick;
      }
    })()`);
    assert(icsContent.includes('BEGIN:VCALENDAR') && icsContent.includes('BEGIN:VEVENT') && icsContent.includes('END:VCALENDAR'),
      `${name}: invalid .ics download: ${icsContent.slice(0, 120)}`);
    for (const line of icsContent.split('\r\n')) {
      assert(Buffer.byteLength(line, 'utf8') <= 75, `${name}: .ics line exceeds 75 octets (${Buffer.byteLength(line, 'utf8')}): ${line}`);
    }

    srv.state.bookMode = 'skipped';
    await tab.goto(`${srv.origin}/book/`);
    await tab.waitFor('document.querySelectorAll(".book-slot").length > 0');
    await tab.evalJs(`(() => {
      document.querySelector('.book-slot').click();
      document.querySelector('#book-name').value = 'Sam Lee';
      document.querySelector('#book-email').value = 'sam@example.com';
      document.querySelector('#book-team').value = 'Two founders building a dev tool.';
      document.querySelector('.book-submit').click();
    })()`);
    await tab.waitFor('Boolean(document.querySelector(".book-confirm") && !document.querySelector(".book-confirm").hidden)');
    const skippedText = await tab.evalJs('document.querySelector("#book-confirm-note").textContent.trim()');
    assert(skippedText === 'No email is coming, so add it to your calendar now.',
      `${name}: unexpected skipped-email wording: ${skippedText}`);

    srv.state.slotsMode = 'empty';
    await tab.goto(`${srv.origin}/book/`);
    await tab.waitFor('Boolean(document.querySelector("[data-state=\'empty\']:not([hidden])"))');

    srv.state.slotsMode = 'rate_limited';
    await tab.goto(`${srv.origin}/book/`);
    await tab.waitFor('Boolean(document.querySelector("[data-state=\'rate_limited\']:not([hidden])"))');

    srv.state.slotsMode = 'unavailable';
    await tab.goto(`${srv.origin}/book/`);
    await tab.waitFor('Boolean(document.querySelector("[data-state=\'unavailable\']:not([hidden])"))');
    const unavailCheck = await tab.evalJs(`(() => {
      const box = document.querySelector('[data-state="unavailable"]:not([hidden])');
      const link = box?.querySelector('a[href="/team/"]');
      const mailto = document.querySelector('a[href^="mailto:"]');
      const heading = box?.querySelector('h2')?.textContent?.trim() || '';
      const body = box?.querySelector('#book-unavailable-text')?.textContent?.trim() || '';
      const overflow = document.documentElement.scrollWidth > window.innerWidth;
      return { hasTeamLink: Boolean(link), hasMailto: Boolean(mailto), heading, body, overflow };
    })()`);
    assert(unavailCheck.hasTeamLink && !unavailCheck.hasMailto && !unavailCheck.overflow,
      `${name}: unavailable state check failed: ${JSON.stringify(unavailCheck)}`);
    assert(unavailCheck.heading === 'Booking is closed right now',
      `${name}: unexpected unavailable heading: ${unavailCheck.heading}`);
    assert(unavailCheck.body === 'Check back soon, or see the team page for how the call works.',
      `${name}: unavailable body should not repeat heading: ${unavailCheck.body}`);
    await tab.shot(shotPath('unavailable'));

    srv.state.cancelPayloads.length = 0;
    await tab.goto(`${srv.origin}/book/?cancel=bk_demo01.tok_example99`);
    await tab.waitFor('Boolean(document.querySelector("[data-state=\'cancel\']:not([hidden])"))');
    const cancelCheck = await tab.evalJs(`(() => ({
      search: location.search,
      text: document.querySelector('[data-state="cancel"]:not([hidden])').textContent,
      btnCount: document.querySelectorAll('[data-state="cancel"]:not([hidden]) button').length,
    }))()`);
    assert(cancelCheck.search === '', `${name}: cancel token was not stripped from URL: ${cancelCheck.search}`);
    assert(cancelCheck.text.includes('Cancel this call?') && cancelCheck.btnCount === 1,
      `${name}: cancel view mismatch: ${JSON.stringify(cancelCheck)}`);
    await tab.evalJs('document.querySelector("[data-state=\'cancel\']:not([hidden]) button").click()');
    await tab.waitFor('Boolean(document.querySelector("[data-state=\'cancelled\']:not([hidden])"))');
    assert(srv.state.cancelPayloads.length === 1 && srv.state.cancelPayloads[0].id === 'bk_demo01' && srv.state.cancelPayloads[0].token === 'tok_example99',
      `${name}: unexpected cancel payload: ${JSON.stringify(srv.state.cancelPayloads)}`);
    const cancelledCheck = await tab.evalJs(`(() => ({
      text: document.querySelector('[data-state="cancelled"]:not([hidden])').textContent,
      hasBookLink: Boolean(document.querySelector('[data-state="cancelled"]:not([hidden]) a[href="/book/"]')),
    }))()`);
    assert(cancelledCheck.text.includes('Cancelled') && cancelledCheck.hasBookLink,
      `${name}: cancelled view mismatch: ${JSON.stringify(cancelledCheck)}`);

    assert(tab.errors.length === 0, `${name}: console/runtime errors: ${tab.errors.join('; ')}`);
  } finally {
    await tab.close();
  }
}

async function runPwaAndOffline(browser, srv) {
  const tab = await openTab(browser, 390, 844);
  try {
    srv.state.slotsMode = 'ok';
    await tab.goto(`${srv.origin}/book/`);
    await tab.waitFor('document.querySelectorAll(".book-slot").length > 0');

    const swReady = await tab.evalJs(`(async () => {
      if (!('serviceWorker' in navigator)) return null;
      const reg = await navigator.serviceWorker.ready;
      return { scope: reg.scope, state: reg.active?.state };
    })()`);
    assert(swReady && swReady.scope.endsWith('/book/') && swReady.state === 'activated',
      `service worker not active: ${JSON.stringify(swReady)}`);

    await tab.goto(`${srv.origin}/book/`);
    await tab.waitFor('document.querySelectorAll(".book-slot").length > 0');

    const manifest = await browser.send('Page.getAppManifest', {}, tab.sessionId);
    assert(manifest.errors.length === 0, `manifest errors: ${JSON.stringify(manifest.errors)}`);
    const parsed = JSON.parse(manifest.data);
    assert(parsed.name === 'Book OpenWiz' && parsed.display === 'standalone' && parsed.scope === '/book/',
      `manifest mismatch: ${manifest.data}`);

    const install = await browser.send('Page.getInstallabilityErrors', {}, tab.sessionId);
    assert(install.installabilityErrors.length === 0,
      `installability errors: ${JSON.stringify(install.installabilityErrors)}`);

    const standaloneRule = await tab.evalJs(`(() => {
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of rules) {
          if (rule.type === CSSRule.MEDIA_RULE && /display-mode:\\s*standalone/.test(rule.conditionText)) {
            const texts = [...rule.cssRules].map(r => r.cssText);
            const hidesNav = texts.some(t => t.includes('.landing-nav') && /display:\\s*none/.test(t));
            const hidesFooter = texts.some(t => t.includes('.landing-footer') && /display:\\s*none/.test(t));
            if (hidesNav && hidesFooter) return true;
          }
        }
      }
      return false;
    })()`);
    assert(standaloneRule, 'standalone display-mode rule must hide .landing-nav and .landing-footer');

    const setOffline = offline => browser.send('Network.emulateNetworkConditions', {
      offline,
      latency: 0,
      downloadThroughput: offline ? 0 : -1,
      uploadThroughput: offline ? 0 : -1,
    }, tab.sessionId);

    srv.state.bookMode = 'skipped';
    await tab.evalJs(`(() => {
      document.querySelector('.book-slot').click();
      document.querySelector('#book-name').value = 'Drop Test';
      document.querySelector('#book-email').value = 'drop@example.com';
      document.querySelector('#book-team').value = 'Testing offline resilience.';
      document.querySelector('.book-submit').click();
    })()`);
    await tab.waitFor('Boolean(document.querySelector("[data-state=\'confirmed\']:not([hidden])"))');
    await setOffline(true);
    await new Promise(r => setTimeout(r, 250));
    const stillConfirmedOffline = await tab.evalJs('!document.querySelector("[data-state=\'confirmed\']").hidden && Boolean(document.querySelector(".book-ics"))');
    assert(stillConfirmedOffline, 'brief offline drop wiped the confirmation view');
    await setOffline(false);
    await new Promise(r => setTimeout(r, 250));
    const stillConfirmedOnline = await tab.evalJs('!document.querySelector("[data-state=\'confirmed\']").hidden && Boolean(document.querySelector(".book-ics"))');
    assert(stillConfirmedOnline, 'reconnecting wiped the confirmation view');

    srv.state.cancelPayloads.length = 0;
    await tab.goto(`${srv.origin}/book/?cancel=bk_drop1.tok_keep99`);
    await tab.waitFor('Boolean(document.querySelector("[data-state=\'cancel\']:not([hidden])"))');
    await setOffline(true);
    await new Promise(r => setTimeout(r, 200));
    const stillCancelOnDrop = await tab.evalJs('!document.querySelector("[data-state=\'cancel\']").hidden');
    assert(stillCancelOnDrop, 'brief offline drop wiped the cancel view');
    await tab.evalJs('document.querySelector("[data-state=\'cancel\'] button").click()');
    await tab.waitFor('Boolean(document.querySelector("[data-state=\'offline\']:not([hidden])"))');
    await setOffline(false);
    await tab.evalJs('document.querySelector("#book-offline-retry").click()');
    await tab.waitFor('Boolean(document.querySelector("[data-state=\'cancelled\']:not([hidden])"))');
    assert(srv.state.cancelPayloads.length === 1 && srv.state.cancelPayloads[0].id === 'bk_drop1' && srv.state.cancelPayloads[0].token === 'tok_keep99',
      `offline cancel retry lost token: ${JSON.stringify(srv.state.cancelPayloads)}`);

    await setOffline(true);
    await browser.send('Page.reload', {}, tab.sessionId);
    await tab.waitFor('Boolean(document.querySelector("[data-state=\'offline\']:not([hidden])"))');
    const offlineText = await tab.evalJs('document.querySelector("[data-state=\'offline\']:not([hidden])").textContent');
    assert(/connection|offline/i.test(offlineText), `unexpected offline text: ${offlineText}`);
  } finally {
    await tab.close();
  }
}

async function runDstChecks(browser, srv) {
  const cases = [
    { tz: 'America/New_York', nowIso: '2027-03-14T04:30:00Z', slotIso: '2027-03-15T18:00:00Z', mustInclude: ['2027-03-13', '2027-03-14', '2027-03-15'] },
    { tz: 'America/New_York', nowIso: '2027-03-14T06:30:00Z', slotIso: '2027-03-15T18:00:00Z', mustInclude: ['2027-03-14', '2027-03-15', '2027-03-16'] },
    { tz: 'Europe/London', nowIso: '2027-03-27T23:30:00Z', slotIso: '2027-03-29T18:00:00Z', mustInclude: ['2027-03-27', '2027-03-28', '2027-03-29'] },
    { tz: 'Europe/London', nowIso: '2027-03-28T00:30:00Z', slotIso: '2027-03-29T18:00:00Z', mustInclude: ['2027-03-28', '2027-03-29', '2027-03-30'] },
  ];
  const savedSlots = srv.state.slotsData;
  try {
    for (const c of cases) {
      srv.state.slotsMode = 'ok';
      srv.state.slotsData = { ...savedSlots, slots: [c.slotIso] };
      const tab = await openTab(browser, 390, 844);
      try {
        await browser.send('Emulation.setTimezoneOverride', { timezoneId: c.tz }, tab.sessionId);
        await browser.send('Page.addScriptToEvaluateOnNewDocument', {
          source: `(() => {
            const fixed = Date.parse(${JSON.stringify(c.nowIso)});
            const RealDate = Date;
            class MockDate extends RealDate {
              constructor(...args) { super(...(args.length ? args : [fixed])); }
              static now() { return fixed; }
            }
            window.Date = MockDate;
          })();`,
        }, tab.sessionId);
        await tab.goto(`${srv.origin}/book/`);
        await tab.waitFor('document.querySelectorAll(".book-day").length >= 14');
        const keys = await tab.evalJs('[...document.querySelectorAll(".book-day")].map(b => b.dataset.day)');
        for (const req of c.mustInclude) {
          assert(keys.includes(req), `DST ${c.tz} at ${c.nowIso}: missing day ${req} in ${keys.join(',')}`);
        }
        for (let i = 1; i < keys.length; i++) {
          const prev = Date.parse(`${keys[i - 1]}T12:00:00Z`);
          const cur = Date.parse(`${keys[i]}T12:00:00Z`);
          assert(cur - prev === 86400000, `DST ${c.tz} at ${c.nowIso}: non-consecutive days ${keys[i - 1]} -> ${keys[i]}`);
        }
      } finally {
        await tab.close();
      }
    }
  } finally {
    srv.state.slotsData = savedSlots;
  }
}

async function main() {
  const { shots } = parseArgs(process.argv.slice(2));
  if (shots) await mkdir(shots, { recursive: true });
  const template = JSON.parse(await readFile(new URL('slots.json', FIXTURES), 'utf8'));
  const slotsData = buildSlots(template);
  const srv = await startServer(slotsData);
  const browser = await launchBrowser();
  try {
    await runWidth(browser, srv, { name: 'phone', width: 390, height: 844, shotsDir: shots });
    await runWidth(browser, srv, { name: 'desktop', width: 1280, height: 900, shotsDir: shots });
    await runDstChecks(browser, srv);
    await runPwaAndOffline(browser, srv);
    console.log('PASS: book-check (390px, 1280px, keyboard, states, cancel, DST, installability, offline)');
  } finally {
    await browser.close();
    await srv.close();
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
