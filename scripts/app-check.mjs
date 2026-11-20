// The app's browser check (P2, P3): the built app in a real headless Chromium, against recorded GitHub answers.
//
// Every request the page makes is paused through the DevTools protocol and answered here: openwiz.dev from dist/
// (with the security headers _headers gives it), the sign-in helper and api.github.com from scripts/app-fixtures/.
// Anything else is refused and fails the check. The request log then has to show only GitHub and the helper, and
// no write. No npm dependency: Node's own WebSocket talks to the browser.
//
//   node scripts/app-check.mjs            (after npm run build; CHROME=/path/to/chrome to pick the browser)
//   SHOTS=dir node scripts/app-check.mjs  also saves the shell on a laptop and a phone as PNGs, for review
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url);
const DIST = new URL('dist/', ROOT);
const FIXTURES = new URL('app-fixtures/', import.meta.url);
const SITE = 'https://openwiz.dev';
const API = 'https://api.github.com';
const STATE = 'S'.repeat(43);
const fixture = async name => JSON.parse(await readFile(new URL(name, FIXTURES), 'utf8'));

// ---- The browser ----------------------------------------------------------------------------------------------

function chromePath() {
  const found = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
    '/usr/bin/chromium-browser'].find(path => path && existsSync(path));
  if (!found) throw new Error('no Chrome or Chromium found; set CHROME');
  return found;
}

async function launch() {
  const profile = await mkdtemp(join(tmpdir(), 'app-check-'));
  const child = spawn(chromePath(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--no-sandbox', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let text = '';
    child.stderr.on('data', chunk => {
      text += chunk;
      const match = text.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
    child.on('exit', code => reject(new Error(`browser exited (${code}): ${text.slice(-400)}`)));
  });
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let next = 0;
  const waiting = new Map();
  const listeners = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && waiting.has(message.id)) {
      const { resolve, reject } = waiting.get(message.id);
      waiting.delete(message.id);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
    } else if (message.method) {
      for (const listener of listeners) listener(message);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++next;
    waiting.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  // Every new tab or window is attached paused, before it loads anything. One the app opens (it has an opener) has its
  // first request handed to its opener's check (popups) and refused, and is closed: it never reaches the network.
  const popups = new Map(); // opener target id -> (request) => void
  const opened = new Map(); // popup session id -> opener target id
  listeners.push(async message => {
    if (message.method === 'Target.attachedToTarget' && !message.sessionId) {
      const { sessionId, targetInfo } = message.params;
      if (targetInfo.openerId) {
        opened.set(sessionId, targetInfo.openerId);
        await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, sessionId).catch(() => {});
      }
      await send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
    }
    if (message.method === 'Fetch.requestPaused' && opened.has(message.sessionId)) {
      popups.get(opened.get(message.sessionId))?.(message.params.request);
      await send('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'BlockedByClient' }, message.sessionId).catch(() => {});
      await send('Target.closeTarget', { targetId: message.params.frameId }).catch(() => {});
    }
  });
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  const close = async () => {
    socket.close();
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  };
  return { send, on: listener => listeners.push(listener), popups, close };
}

// ---- The recorded world ---------------------------------------------------------------------------------------

const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', json: 'application/json',
  webmanifest: 'application/manifest+json', svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon',
  woff2: 'font/woff2', txt: 'text/plain' };

// The _headers rules for a path, as Cloudflare Pages applies them (splat patterns only).
async function siteHeaders(path) {
  const out = {};
  let match = false;
  for (const line of (await readFile(new URL('_headers', DIST), 'utf8')).split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (!line.startsWith(' ')) {
      const pattern = new RegExp(`^${line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
      match = pattern.test(path);
    } else if (match) {
      const at = line.indexOf(':');
      out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }
  return out;
}

async function staticFile(path) {
  let file = decodeURIComponent(path).replace(/^\/+/, '');
  if (file === '' || file.endsWith('/')) file += 'index.html';
  const target = new URL(file, DIST);
  if (!target.href.startsWith(DIST.href) || !existsSync(target)) return { status: 404, body: 'not found', type: 'txt' };
  return { status: 200, body: await readFile(target), type: file.split('.').pop() };
}

class World {
  constructor() {
    this.log = [];
    this.violations = [];
    // operation name -> answer function (body) => {status, json, headers}. The Specs feed's second read (each running
    // spec's tickets) answers with no spec by default, so those specs' tickets show as unknown.
    this.graphql = { SpecTickets: async () => ({ status: 200, json: { data: { rateLimit: { limit: 5000, remaining: 4800, resetAt: '2099-01-01T00:00:00Z' }, repository: {} } } }) };
    this.rest = {}; // GitHub REST path -> answer function (url) => {status, json, headers}
    this.helper = {}; // helper path -> answer function (body) => {status, json} (may wait, to hold a response)
    this.done = []; // paths answered so far
    this.opened = []; // tabs the page opened (a link to GitHub), by their first request: never answered
    this.site = {}; // site path -> answer function () => {status, raw, type} or {abort}, in place of the built file
  }

  answered(path) {
    return this.done.includes(path);
  }

  async answer(request) {
    const url = new URL(request.url);
    const entry = { method: request.method, url: request.url, origin: url.origin, path: url.pathname,
      headers: request.headers, body: request.postData || '' };
    this.log.push(entry);
    if (url.origin === SITE && url.pathname.startsWith('/api/sign-in/')) {
      if (request.method === 'POST' && this.helper[url.pathname]) return this.helper[url.pathname](request.postData || '');
      if (url.pathname === '/api/sign-in/token' && request.method === 'POST') {
        return { status: 200, json: await fixture('token.json') };
      }
      return { status: 404, json: { error: 'not_found' } };
    }
    if (url.origin === SITE && this.site[url.pathname]) return this.site[url.pathname]();
    if (url.origin === SITE) {
      const file = await staticFile(url.pathname);
      return { status: file.status, raw: file.body, type: file.type, headers: await siteHeaders(url.pathname) };
    }
    if (url.origin === API) {
      // The browser's own CORS preflight, answered as GitHub does: it carries no data and changes nothing.
      if (request.method === 'OPTIONS') {
        return { status: 204, raw: Buffer.alloc(0), headers: { 'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'Authorization, Accept, Content-Type' } };
      }
      if (request.method === 'GET' && this.rest[url.pathname]) return this.rest[url.pathname](url);
      if (request.method === 'GET' && url.pathname === '/user/installations') return { status: 200, json: await fixture('installations.json') };
      if (request.method === 'GET' && url.pathname === '/user/installations/1001/repositories') return { status: 200, json: await fixture('repositories.json') };
      if (request.method === 'POST' && url.pathname === '/graphql') {
        const body = JSON.parse(request.postData || '{}');
        const name = (String(body.query).match(/^\s*query\s+(\w+)/) || [])[1];
        const reply = this.graphql[name];
        if (reply) return reply(body);
      }
      return { status: 404, json: { message: 'Not Found' } };
    }
    return null; // refused: not GitHub, not the site
  }
}

// The text a person reads on a control: without parts hidden from assistive technology (key hints, icons).
const LABEL = `const label = e => { const c = e.cloneNode(true); c.querySelectorAll('[aria-hidden="true"]').forEach(x => x.remove()); return c.textContent.replace(/\\s+/g, ' ').trim(); };`;

// ---- One page under test --------------------------------------------------------------------------------------

async function open(browser, world) {
  // Each check gets its own browser context: its own storage, so no sign-in or picked repository carries over.
  const { browserContextId } = await browser.send('Target.createBrowserContext');
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  browser.on(async message => {
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      const reply = await world.answer(request);
      world.done.push(new URL(request.url).pathname);
      if (!reply || reply.abort) {
        // Refused (not GitHub, not the site), or a recorded network failure (abort).
        await send('Fetch.failRequest', { requestId, errorReason: reply ? 'ConnectionFailed' : 'BlockedByClient' }).catch(() => {});
        return;
      }
      const body = reply.raw ?? Buffer.from(JSON.stringify(reply.json));
      const headers = { 'Content-Type': TYPES[reply.type || 'json'] || 'application/octet-stream', ...(reply.headers || {}) };
      if (request.url.startsWith(API)) {
        // As GitHub's API answers a browser: any origin, with its paging and limit headers readable.
        headers['Access-Control-Allow-Origin'] = SITE;
        headers['Access-Control-Expose-Headers'] = 'Link, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After';
      }
      await send('Fetch.fulfillRequest', { requestId, responseCode: reply.status,
        responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })),
        body: Buffer.from(body).toString('base64') }).catch(() => {});
    }
    if (message.method === 'Log.entryAdded' && /Content Security Policy|Refused to/.test(message.params.entry.text)) {
      world.violations.push(message.params.entry.text);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      world.violations.push(`exception: ${message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text}`);
    }
  });
  // A tab the page opens (a link to GitHub) is noted in world.opened by its first request, which is refused (launch).
  browser.popups.set(targetId, request => world.opened.push({ method: request.method, url: request.url }));
  await browser.send('Browser.grantPermissions', { origin: SITE, browserContextId, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Log.enable');
  await send('Runtime.enable');
  await send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
  const page = {
    async go(url) {
      await send('Page.navigate', { url });
    },
    async run(expression) {
      const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (exceptionDetails) throw new Error(`page error: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
      return result.value;
    },
    async until(expression, what, ms = 8000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await page.run(`(() => { try { return !!(${expression}); } catch { return false; } })()`)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`timed out waiting for ${what}; page text: ${(await page.text()).slice(0, 600)}`);
    },
    text: () => page.run('document.body ? document.body.innerText : ""'),
    async size(width, height, mobile) {
      if (width === null) return send('Emulation.clearDeviceMetricsOverride');
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
      await new Promise(resolve => setTimeout(resolve, 200));
    },
    async shot(path, width, height, mobile) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
      await new Promise(resolve => setTimeout(resolve, 400));
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(path, Buffer.from(data, 'base64'));
      await send('Emulation.clearDeviceMetricsOverride');
    },
    // Press one key as a keyboard does (keyDown, then keyUp): 'Tab', 'Enter', 'Escape', an arrow, 'Backspace', '?',
    // a digit or a letter, with any of the modifiers Alt, Ctrl, Meta and Shift held.
    async key(key, ...held) {
      const codes = { Tab: ['Tab', 9], Enter: ['Enter', 13, '\r'], Escape: ['Escape', 27], ArrowDown: ['ArrowDown', 40], ArrowUp: ['ArrowUp', 38],
        Backspace: ['Backspace', 8], '?': ['Slash', 191, '?'] };
      const letter = /^[a-z]$/i.test(key) ? [`Key${key.toUpperCase()}`, key.toUpperCase().charCodeAt(0), key] : null;
      const [code, vk, typed] = codes[key] || letter || [`Digit${key}`, key.charCodeAt(0), key];
      const modifiers = held.reduce((m, name) => m | { Alt: 1, Ctrl: 2, Meta: 4, Shift: 8 }[name], 0);
      // A key pressed with Ctrl, Alt or Meta types nothing.
      const text = typed && !(modifiers & 7) ? typed : undefined;
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers, ...(text ? { text } : {}) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
    },
    // Type text into the focused field, as a keyboard's input does.
    type: text => send('Input.insertText', { text }),
    // What the app put on the clipboard, read as this site.
    clipboard: () => page.run('navigator.clipboard.readText()'),
    // Click the visible control (link or button) whose text, without its aria-hidden parts, is exactly this.
    click: text => page.run(`(() => {
      ${LABEL}
      const el = [...document.querySelectorAll('a, button')].find(e => e.offsetParent !== null && label(e) === ${JSON.stringify(text)});
      if (!el) throw new Error('no visible control: ' + ${JSON.stringify(text)});
      el.click();
    })()`),
    close: async () => {
      await browser.send('Target.closeTarget', { targetId });
      await browser.send('Target.disposeBrowserContext', { browserContextId });
    },
  };
  return page;
}

// ---- The checks -----------------------------------------------------------------------------------------------

const results = [];
async function check(name, body) {
  try {
    await body();
    results.push(`PASS ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${error.message}`);
  }
}
function assert(ok, message) {
  if (!ok) throw new Error(message);
}

async function waitFor(test, what, ms = 8000) {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

const operation = r => (String(JSON.parse(r.body || '{}').query).match(/^\s*query\s+(\w+)/) || [])[1];
// GraphQL reads sent, or only those of the named operations (the first read of each feed: Specs, Agents).
const graphqlCount = (world, names) => world.log.filter(r => r.origin === API && r.path === '/graphql' && r.method === 'POST'
  && (!names || names.includes(operation(r)))).length;
const settle = (page, ms = 300) => page.run(`new Promise(resolve => setTimeout(resolve, ${ms}))`);
const ok = name => async () => ({ status: 200, json: await fixture(name) });

// Every logged request: only the site (static reads and the helper) and GitHub's API, and nothing that writes.
function checkRequestLog(world) {
  assert(world.log.length > 0, 'no requests were logged');
  for (const r of world.log) {
    const where = `${r.method} ${r.url}`;
    assert(r.origin === SITE || r.origin === API, `request outside GitHub and the helper: ${where}`);
    if (r.origin === SITE) {
      const helper = r.path === '/api/sign-in/token' || r.path === '/api/sign-in/refresh';
      assert(r.method === 'GET' || (r.method === 'POST' && helper), `the site was sent a write: ${where}`);
      assert(!r.path.startsWith('/api/') || helper || r.path === '/api/sign-in/start', `unknown helper route: ${where}`);
      const auth = Object.keys(r.headers).some(key => key.toLowerCase() === 'authorization');
      assert(!auth, `the GitHub token was sent to the site: ${where}`);
    } else {
      const preflight = r.method === 'OPTIONS' && !r.body;
      assert(r.method === 'GET' || preflight || (r.method === 'POST' && r.path === '/graphql'), `a write to GitHub: ${where}`);
      if (r.method === 'POST') {
        const query = String(JSON.parse(r.body).query);
        assert(/^\s*query\s/.test(query) && !/\bmutation\b|\bsubscription\b/i.test(query), `a GraphQL write: ${query.slice(0, 80)}`);
      }
    }
    assert(!/gh[ur]_SYNTHETIC/.test(r.url), `a token in a URL: ${where}`);
  }
  assert(world.violations.length === 0, `blocked or failed in the page: ${world.violations.slice(0, 3).join(' | ')}`);
}

async function signIn(page, world) {
  await page.go(`${SITE}/app/?code=c0de&state=${STATE}`);
  await page.until(`document.body.innerText.includes('acme/factory')`, 'the repository picker');
}

async function main() {
  if (!existsSync(new URL('index.html', DIST))) throw new Error('dist/ is missing: run npm run build first');
  const browser = await launch();
  try {
    // #1357: the landing's install box. The line is the one the install skill expects, word for word.
    const LINE = 'Install OpenWiz from github.com/openwizdev/OpenWiz';
    const landing = await readFile(new URL('index.html', DIST), 'utf8');
    // The release's one change: the box's switch from coming-soon to live, served in place of the built landing.
    const switchedOn = world => {
      assert(landing.split('data-install="coming-soon"').length === 2, 'the landing has no single coming-soon switch to turn on');
      world.site['/'] = async () => ({ status: 200, raw: Buffer.from(landing.replace('data-install="coming-soon"', 'data-install="live"')), type: 'html' });
    };
    const installBox = page => page.run(`(() => { ${LABEL} const box = document.querySelector('.install-box'); const b = box.querySelector('button.install');
      const line = box.querySelector('.install-line'); const hint = box.querySelector('.install-hint');
      return { line: line && line.textContent, lineShown: !!line && line.offsetParent !== null, hint: hint && hint.innerText.trim(),
        shown: b.offsetParent !== null, disabled: b.disabled, label: label(b) }; })()`);
    const landed = page => page.until(`document.readyState === 'complete' && window.gsap`, 'the landing and its scripts');

    await check('#1357 install box before the release: the line and the instruction show, Copy is disabled, coming soon, and copies nothing', async () => {
      const world = new World();
      const page = await open(browser, world);
      await page.go(`${SITE}/`);
      await landed(page);
      await page.run(`navigator.clipboard.writeText('untouched')`);
      await settle(page);
      const box = await installBox(page);
      assert(box.line === LINE && box.lineShown, `the install line is not shown exactly: ${JSON.stringify(box.line)}`);
      assert(box.hint === 'Paste this into your agent', `the instruction is missing: ${box.hint}`);
      assert(box.shown && box.disabled && box.label === 'Copy · coming soon', `Copy is not shown disabled as coming soon: ${JSON.stringify(box)}`);
      await page.run(`document.querySelector('.install-box button.install').click()`);
      await settle(page);
      assert(await page.clipboard() === 'untouched', 'the disabled Copy button changed the clipboard');
      checkRequestLog(world);
      await page.close();
    });

    await check('#1357 install box switched on: Copy is enabled and puts exactly the install line on the clipboard', async () => {
      const world = new World();
      switchedOn(world);
      const page = await open(browser, world);
      await page.go(`${SITE}/`);
      await landed(page);
      await page.run(`navigator.clipboard.writeText('untouched')`);
      await page.until(`!document.querySelector('.install-box button.install').disabled`, 'Copy to be enabled');
      const box = await installBox(page);
      assert(box.line === LINE && box.lineShown && box.hint === 'Paste this into your agent', `the box changed when switched on: ${JSON.stringify(box)}`);
      assert(box.shown && box.label === 'Copy', `the switched-on button does not read Copy: ${JSON.stringify(box)}`);
      await page.click('Copy');
      await page.until(`document.querySelector('.install-box button.install').innerText.trim() === 'Copied'`, 'Copied');
      const copied = await page.clipboard();
      assert(copied === LINE, `the clipboard does not hold exactly the install line: ${JSON.stringify(copied)}`);
      checkRequestLog(world);
      await page.close();
    });

    await check('#1357 install box switched on with its script blocked: the line still shows, with no dead Copy button', async () => {
      const world = new World();
      switchedOn(world);
      const script = landing.match(/src="(\/site\.[0-9a-f]{10}\.js)"/)[1];
      world.site[script] = async () => ({ abort: true });
      const page = await open(browser, world);
      await page.go(`${SITE}/`);
      await page.until(`document.readyState === 'complete'`, 'the landing');
      const box = await installBox(page);
      assert(box.line === LINE && box.lineShown, 'the install line is hidden without the script');
      assert(!box.shown, `a Copy button that can't copy is shown: ${JSON.stringify(box)}`);
      await page.close();
    });

    await check('signed out: the app offers Sign in with GitHub through the helper', async () => {
      const world = new World();
      const page = await open(browser, world);
      await page.go(`${SITE}/app/`);
      await page.until(`[...document.querySelectorAll('a')].some(a => a.textContent.trim() === 'Sign in with GitHub')`, 'the sign-in link');
      const href = await page.run(`[...document.querySelectorAll('a')].find(a => a.textContent.trim() === 'Sign in with GitHub').getAttribute('href')`);
      assert(href === '/api/sign-in/start', `sign-in goes to ${href}, not the helper`);
      assert(graphqlCount(world) === 0, 'GitHub was read before sign-in');
      if (process.env.SHOTS) await page.shot(join(process.env.SHOTS, 'sign-in-phone.png'), 390, 844, true);
      checkRequestLog(world);
      await page.close();
    });

    await check('sign-in: the code goes to the helper once, the token stays in the browser, the picker lists the repositories', async () => {
      const world = new World();
      const page = await open(browser, world);
      await signIn(page, world);
      const swaps = world.log.filter(r => r.path === '/api/sign-in/token');
      assert(swaps.length === 1, `expected one token exchange, saw ${swaps.length}`);
      assert(JSON.stringify(JSON.parse(swaps[0].body)) === JSON.stringify({ code: 'c0de', state: STATE }), `exchange body: ${swaps[0].body}`);
      assert(await page.run('location.search') === '', 'the sign-in code is still in the address');
      assert(await page.run('document.cookie') === '', 'the app set a cookie');
      const text = await page.text();
      assert(text.includes('acme/factory') && text.includes('acme/site'), 'the picker does not list both repositories');
      if (process.env.SHOTS) await page.shot(join(process.env.SHOTS, 'picker-laptop.png'), 1440, 900, false);
      const asked = world.log.filter(r => r.origin === API && r.method !== 'OPTIONS');
      assert(asked.length && asked.every(r => r.headers.Authorization === 'Bearer ghu_SYNTHETICaccess0000000000000000000'), 'GitHub reads do not carry the token');
      checkRequestLog(world);
      await page.close();
    });

    await check('picker and shell: the picked repository opens the shell with You, Specs and Agents, and is remembered', async () => {
      const world = new World();
      world.graphql.Specs = ok('specs.json');
      world.graphql.Agents = ok('agents.json');
      const page = await open(browser, world);
      await signIn(page, world);
      await page.click('acme/factory');
      await page.until(`document.querySelector('nav a[aria-current="page"]')`, 'the navigation');
      const nav = await page.run(`(() => { ${LABEL} return [...document.querySelectorAll('nav.main a')].map(label); })()`);
      assert(JSON.stringify(nav) === JSON.stringify(['You', 'Specs', 'Agents']), `navigation is ${JSON.stringify(nav)}`);
      await page.click('Specs');
      await page.until(`location.hash === '#/specs' && document.querySelector('h1').textContent.trim() === 'Specs'`, 'the Specs page');
      await page.go(`${SITE}/app/`);
      await page.until(`document.querySelector('h1') && document.querySelector('h1').textContent.trim() === 'You'`, 'the shell after reopening');
      assert((await page.text()).includes('acme/factory'), 'the picked repository was not remembered');
      assert(!(await page.text()).includes('Pick a repository'), 'the picker came back');
      checkRequestLog(world);
      await page.close();
    });

    await check('read times: each read shows when it happened', async () => {
      const world = new World();
      world.graphql.Specs = ok('specs.json');
      world.graphql.Agents = ok('agents.json');
      const page = await open(browser, world);
      await signIn(page, world);
      await page.click('acme/factory');
      await page.until(`/Specs read \\d\\d:\\d\\d/.test(document.body.innerText) && /Agents read \\d\\d:\\d\\d/.test(document.body.innerText)`, 'both read times');
      const now = new Date();
      const hhmm = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
      const shown = (await page.text()).match(/Specs read (\d\d:\d\d)/)[1];
      const minutes = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
      const apart = Math.abs(minutes(shown) - minutes(hhmm));
      assert(Math.min(apart, 1440 - apart) <= 1, `read time ${shown} is not the time of the read (${hhmm})`);
      for (const [width, height, mobile] of [[1440, 900, false], [390, 844, true]]) {
        await page.size(width, height, mobile);
        const shown = await page.text();
        const leak = shown.match(/.{0,40}(null|undefined|NaN)/);
        assert(!leak, `a missing value leaks into the ${mobile ? 'phone' : 'laptop'} page: ${leak?.[0]}`);
        assert(/Specs read \d\d:\d\d/.test(shown) && /Agents read \d\d:\d\d/.test(shown), `the ${mobile ? 'phone' : 'laptop'} page does not show both read times`);
      }
      await page.size(null);
      if (process.env.SHOTS) {
        await page.shot(join(process.env.SHOTS, 'shell-laptop.png'), 1440, 900, false);
        await page.shot(join(process.env.SHOTS, 'shell-phone.png'), 390, 844, true);
      }
      checkRequestLog(world);
      await page.close();
    });

    await check('a failed read: shown as unknown, never as empty', async () => {
      const world = new World();
      world.graphql.Specs = async () => ({ status: 502, json: { message: 'Bad Gateway' } });
      world.graphql.Agents = ok('agents.json');
      const page = await open(browser, world);
      await signIn(page, world);
      await page.click('acme/factory');
      await page.click('Specs');
      await page.until(`/couldn.t read/i.test(document.querySelector('main').innerText)`, 'the failed-read notice');
      const main = await page.run(`document.querySelector('main').innerText`);
      assert(/unknown/i.test(main), 'the failed read is not called unknown');
      assert(!/\bno specs\b|\bnothing\b|\b0 specs\b/i.test(main), 'the failed read is shown as empty');
      if (process.env.SHOTS) await page.shot(join(process.env.SHOTS, 'failed-read-laptop.png'), 1440, 900, false);
      checkRequestLog(world);
      await page.close();
    });

    await check('a partial read: the missing part is unknown', async () => {
      const world = new World();
      world.graphql.Specs = async () => {
        const answer = await fixture('specs.json');
        answer.errors = [{ message: 'Something went wrong', path: ['repository', 'issues', 'nodes', 1] }];
        return { status: 200, json: answer };
      };
      world.graphql.Agents = ok('agents.json');
      const page = await open(browser, world);
      await signIn(page, world);
      await page.click('acme/factory');
      await page.click('Specs');
      await page.until(`/part of this read failed/i.test(document.querySelector('main').innerText)`, 'the partial-read notice');
      assert(/unknown/i.test(await page.run(`document.querySelector('main').innerText`)), 'the partial read does not say unknown');
      checkRequestLog(world);
      await page.close();
    });

    await check('a low GitHub limit: the app backs off and says so', async () => {
      const world = new World();
      world.graphql.Specs = ok('specs.json');
      world.graphql.Agents = async () => {
        const answer = await fixture('agents.json');
        answer.data.rateLimit = { limit: 5000, remaining: 12, resetAt: '2030-01-01T00:00:00Z' };
        return { status: 200, json: answer };
      };
      const page = await open(browser, world);
      await signIn(page, world);
      await page.click('acme/factory');
      await page.until(`/GitHub.s limit is low/.test(document.body.innerText)`, 'the low-limit notice');
      assert(/paused until/i.test(await page.text()), 'the notice does not say when reads resume');
      if (process.env.SHOTS) await page.shot(join(process.env.SHOTS, 'low-limit-phone.png'), 390, 844, true);
      await settle(page);
      const first = graphqlCount(world, ['Specs', 'Agents']);
      assert(first === 2, `expected one read per feed before the back-off, saw ${first}`);
      const before = graphqlCount(world);
      const disabled = await page.run(`[...document.querySelectorAll('button')].filter(b => /refresh now/i.test(b.textContent)).map(b => b.disabled)`);
      assert(disabled.length === 2 && disabled.every(Boolean), `Refresh now is not disabled while backing off: ${JSON.stringify(disabled)}`);
      // Even forced, a refresh reads nothing while the limit is low (the data layer's own guard, not the button).
      await page.run(`OW.data.refreshAll()`);
      await page.run(`new Promise(resolve => setTimeout(resolve, 300))`);
      assert(graphqlCount(world) === before, 'the app read GitHub again while backing off');
      checkRequestLog(world);
      await page.close();
    });

    await check('a refused request: anything but GitHub and the helper is blocked by the page itself', async () => {
      const world = new World();
      const page = await open(browser, world);
      await page.go(`${SITE}/app/`);
      await page.until(`document.readyState === 'complete'`, 'the page');
      const outcome = await page.run(`fetch('https://example.com/collect').then(() => 'sent', () => 'blocked')`);
      assert(outcome === 'blocked', 'the page could send to another server');
      assert(!world.log.some(r => r.url.startsWith('https://example.com')), 'the page could reach another server');
      const end = Date.now() + 5000;
      while (!world.violations.some(text => /Content Security Policy/.test(text)) && Date.now() < end) await new Promise(r => setTimeout(r, 50));
      assert(world.violations.some(text => /Content Security Policy/.test(text)), 'no Content Security Policy refused it');
      await page.close();
    });

    // ---- AP6 (#1259): You, Specs and a spec's page, against recorded answers (ap6-*.json) ----
    // A ticket's state comes from GitHub and the agents' openwiz:status v1 notes (AP1's contract), never from a state
    // label. Notes and decision records count only from the record authors in the repository's docs/agents/fleet.md.

    const live = text => {
      const now = Date.now();
      return JSON.parse(text.replaceAll('"LIVE-5"', JSON.stringify(new Date(now - 5 * 60 * 1000).toISOString()))
        .replaceAll('"LIVE"', JSON.stringify(new Date(now).toISOString())));
    };
    const ap6World = (change = {}) => {
      const world = new World();
      world.graphql.Specs = async () => {
        const answer = await fixture('ap6-specs.json');
        change.specs?.(answer.data.repository);
        return { status: 200, json: answer };
      };
      world.graphql.Agents = ok('agents.json');
      world.graphql.SpecTickets = async () => {
        const answer = live(JSON.stringify(await fixture('ap6-spec-tickets.json')));
        change.tickets?.(answer.data.repository);
        return { status: 200, json: answer };
      };
      return world;
    };
    const ap6Open = async (world, route) => {
      const page = await open(browser, world);
      await signIn(page, world);
      await page.click('acme/factory');
      await page.until(`document.querySelector('nav a[aria-current="page"]')`, 'the shell');
      if (route) await page.go(`${SITE}/app/${route}`);
      return page;
    };
    const youItems = page => page.run(`[...document.querySelectorAll('main .cards a.card')].map(a => a.querySelector('.num').textContent.split(' · ')[0] + ' ' + a.getAttribute('href').replace('https://github.com/acme/factory/issues/', ''))`);
    const graphStates = page => page.run(`Object.fromEntries([...document.querySelectorAll('main .graph [data-ticket]')].map(c => [c.dataset.ticket, c.dataset.state]))`);

    await check('AP6 You: the counts, then what needs you, newest first, each linked to GitHub', async () => {
      const world = ap6World();
      const page = await ap6Open(world);
      await page.until(`document.querySelectorAll('main .cards a.card').length >= 6`, 'the You items');
      const tiles = await page.run(`[...document.querySelectorAll('main .tile')].map(t => t.querySelector('.k').textContent + '=' + t.querySelector('.v').textContent)`);
      assert(JSON.stringify(tiles) === JSON.stringify(['Needs you=4', 'Building=1', 'In review=1', 'Merged=3']), `tiles: ${JSON.stringify(tiles)}`);
      const items = await youItems(page);
      const want = ['Ticket marked for you 46', 'Spec to confirm 60#issuecomment-9001', 'Plan to approve 50#issuecomment-9003',
        'A decision record that couldn\'t be read 50#issuecomment-9005', 'Ticket marked for you 48', 'A decision record that couldn\'t be read 50#issuecomment-9006'];
      assert(JSON.stringify(items) === JSON.stringify(want), `You items: ${JSON.stringify(items)}`);
      const badge = await page.run(`document.querySelector('nav.main a[href="#/you"] .badge').textContent`);
      assert(badge === '4', `the You badge is ${badge}`);
      if (process.env.SHOTS) {
        await page.shot(join(process.env.SHOTS, 'you-laptop.png'), 1440, 900, false);
        await page.shot(join(process.env.SHOTS, 'you-phone.png'), 390, 844, true);
      }
      checkRequestLog(world);
      await page.close();
    });

    await check('R3: a decision record needs a record author and a valid, bound decisions.v1 request, or it is unreadable', async () => {
      const world = ap6World({ specs: repository => { repository.fleet = null; } });
      const page = await ap6Open(world);
      await page.until(`document.querySelectorAll('main .cards a.card').length >= 2`, 'the You items');
      await settle(page, 600);
      const items = await youItems(page);
      // Without the repository's record authors no record can be verified, not even a visitor's or a resolved one: all
      // six are unreadable, and none is an approval.
      assert(!items.some(item => /^(Spec to confirm|Plan to approve)/.test(item)), `an unverified record shows as needing a yes: ${JSON.stringify(items)}`);
      assert(items.filter(item => item.startsWith('A decision record that couldn\'t be read')).length === 6, `unverified records are not unreadable: ${JSON.stringify(items)}`);
      checkRequestLog(world);
      await page.close();
    });

    await check('R7: a decision record with the wrong field types is unreadable, never a crash, and the rest still renders', async () => {
      // Synthetic comments on spec #50: a visitor's record whose kind names an inherited property (read before its
      // author was checked, it threw), and the record authors' with a kind, id or fingerprint of the wrong JSON type
      // (coerced to a string, they read as a valid plan approval).
      const record = fields => '```json\n' + JSON.stringify({ schema: 'openwiz.decisions.v1', kind: 'plan_approval',
        id: 'r-plan_approval-50-typed', status: 'open', fingerprint: 'a'.repeat(64), risk: 'ordinary', spec: 50,
        summary: ['Synthetic summary line.'], headline: 'Synthetic headline.', tickets: [], graph: [], ...fields }, null, 2) + '\n```';
      const comment = (id, login, fields) => ({ databaseId: id, body: record(fields), url: `https://github.com/acme/factory/issues/50#issuecomment-${id}`,
        createdAt: `2029-12-${id - 9000}T12:00:00Z`, updatedAt: `2029-12-${id - 9000}T12:00:00Z`, author: { login } });
      const world = ap6World({ tickets: repository => {
        repository.s50.comments.nodes.push(comment(9020, 'helpful-collaborator', { kind: 'constructor' }),
          { ...comment(9021, 'helpful-collaborator'), body: 'Not openwiz.decisions.v1:\n\n```json\n{"kind": "constructor"}\n```' },
          comment(9019, 'factory-bot[bot]', { kind: 'toString' }), comment(9018, 'factory-bot[bot]', { kind: ['plan_approval'] }),
          comment(9017, 'factory-bot[bot]', { id: ['r-plan_approval-50-typed'] }), comment(9016, 'factory-bot[bot]', { fingerprint: ['a'.repeat(64)] }));
        repository.s50.comments.totalCount = repository.s50.comments.nodes.length;
      } });
      const page = await ap6Open(world);
      await page.until(`document.querySelectorAll('main .cards a.card').length >= 6`, 'the You items');
      await settle(page, 600);
      const items = await youItems(page);
      const unreadable = id => `A decision record that couldn't be read 50#issuecomment-${id}`;
      const want = ['Ticket marked for you 46', 'Spec to confirm 60#issuecomment-9001', 'Plan to approve 50#issuecomment-9003',
        unreadable(9005), 'Ticket marked for you 48', unreadable(9006), unreadable(9019), unreadable(9018), unreadable(9017), unreadable(9016)];
      assert(JSON.stringify(items) === JSON.stringify(want), `You items: ${JSON.stringify(items)}`);
      const badge = await page.run(`document.querySelector('nav.main a[href="#/you"] .badge')?.textContent`);
      assert(badge === '4', `the You badge is ${badge}`);
      await page.go(`${SITE}/app/#/specs`);
      await page.until(`document.querySelectorAll('main a.card').length === 3`, 'the spec cards');
      checkRequestLog(world);
      await page.close();
    });

    await check('R4: a list GitHub gave only part of says so, never "nothing needs you"', async () => {
      const world = ap6World({
        specs: repository => { repository.youIssues = { totalCount: 1, nodes: [] }; repository.specIssues = { totalCount: 2, nodes: [] }; },
      });
      const page = await ap6Open(world);
      await page.until(`/may be missing/.test(document.querySelector('main').innerText)`, 'the partial-list notice');
      const main = await page.run(`document.querySelector('main').innerText`);
      assert(!/Nothing needs you/.test(main), 'a partial read says nothing needs you');
      const needs = await page.run(`document.querySelector('main .tile .v').textContent`);
      assert(needs === '0+', `the Needs you count from a partial list is ${needs}`);
      checkRequestLog(world);
      await page.close();
    });

    await check('R4: a failed ticket read keeps the specs from the first read', async () => {
      const world = ap6World();
      world.graphql.SpecTickets = async () => ({ abort: true });
      const page = await ap6Open(world, '#/specs');
      await page.until(`document.querySelectorAll('main a.card').length === 3`, 'the spec cards from the first read');
      const main = await page.run(`document.querySelector('main').innerText`);
      assert(/1 of 9 tickets done/.test(main) && /couldn.t be read/.test(main), 'the spec list or its unknown tickets are lost');
      world.violations = world.violations.filter(text => !/ERR_CONNECTION_FAILED|Failed to load resource/.test(text));
      checkRequestLog(world);
      await page.close();
    });

    await check('AP6 Specs and R5: every spec by its label, with its progress, including one with no tickets yet', async () => {
      const world = ap6World();
      const page = await ap6Open(world, '#/specs');
      await page.until(`document.querySelectorAll('main a.card').length === 3`, 'the spec cards');
      const cards = await page.run(`[...document.querySelectorAll('main a.card')].map(a => [a.getAttribute('href'), [...a.querySelectorAll('p')].map(p => p.textContent).join('|')])`);
      assert(JSON.stringify(cards.map(c => c[0])) === JSON.stringify(['#/specs/60', '#/specs/50', '#/specs/40']), `spec links: ${JSON.stringify(cards)}`);
      assert(cards[0][1].includes('No tickets yet') && cards[1][1].includes('2 of 3 tickets done') && cards[2][1].includes('1 of 9 tickets done'), `progress: ${JSON.stringify(cards)}`);
      const bar = await page.run(`document.querySelector('main a.card[href="#/specs/40"] .bar').getAttribute('aria-label')`);
      assert(bar === '1 merged, 1 in review, 1 building, 1 ready, 2 waiting, 1 needs you, 1 held, 1 unknown', `spec #40's bar: ${bar}`);
      if (process.env.SHOTS) await page.shot(join(process.env.SHOTS, 'specs-laptop.png'), 1440, 900, false);
      checkRequestLog(world);
      await page.close();
    });

    await check('AP6 spec page and R1, R2: arrows, one colour per state, AP1 notes per agent kind and blocker gaps', async () => {
      const world = ap6World();
      const page = await ap6Open(world, '#/specs');
      await page.until(`document.querySelector('main a.card[href="#/specs/40"]')`, 'the spec card');
      await page.run(`document.querySelector('main a.card[href="#/specs/40"]').click()`);
      await page.until(`document.querySelectorAll('main .graph [data-ticket]').length === 10`, 'the ticket graph');
      assert(await page.run(`document.querySelector('h1').textContent.trim()`) === 'Specs', 'the spec page is not inside the Specs page');
      const states = await graphStates(page);
      const want = { 30: 'merged', 41: 'merged', 42: 'review', 43: 'building', 44: 'ready', 45: 'waiting', 46: 'you', 47: 'held', 49: 'waiting', 'gap-49': 'unknown' };
      assert(JSON.stringify(states) === JSON.stringify(want), `states: ${JSON.stringify(states)}`);
      const colours = await page.run(`(() => {
        const root = getComputedStyle(document.documentElement);
        const token = { merged: '--em-merged', review: '--em-review', building: '--em-building', ready: '--em-ready', waiting: '--em-waiting', you: '--em-you', held: '--em-held', unknown: '--em-unknown' };
        return [...document.querySelectorAll('main .graph [data-ticket]')].map(c => [c.dataset.state, getComputedStyle(c, '::before').backgroundColor,
          (() => { const probe = document.createElement('i'); probe.style.color = root.getPropertyValue(token[c.dataset.state]).trim(); document.body.append(probe); const v = getComputedStyle(probe).color; probe.remove(); return v; })()]);
      })()`);
      for (const [state, shown, token] of colours) assert(shown === token, `a ${state} ticket is drawn ${shown}, not its colour ${token}`);
      assert(new Set(colours.filter(c => c[0] !== 'unknown').map(c => c[1])).size === 7, `the seven states are not seven colours: ${JSON.stringify(colours)}`);
      const arrows = await page.run(`[...document.querySelectorAll('main .graph path.arrow')].map(p => p.dataset.from.split('#').pop() + '>' + p.dataset.to.split('#').pop()).sort()`);
      assert(JSON.stringify(arrows) === JSON.stringify(['30>43', '41>42', '41>44', '41>49', '42>45', '43>45', '44>47', 'gap-49>49']), `arrows: ${JSON.stringify(arrows)}`);
      assert(/Waits for #41 and 2 tickets GitHub couldn.t read or list/.test(await page.run(`document.querySelector('main').innerText`)), 'the blocker gap is not said');
      if (process.env.SHOTS) {
        await page.shot(join(process.env.SHOTS, 'spec-laptop.png'), 1440, 900, false);
        await page.shot(join(process.env.SHOTS, 'spec-phone.png'), 390, 844, true);
      }
      checkRequestLog(world);
      await page.close();
    });

    await check('R1: without the record authors, a ticket whose state rests on its notes is unknown', async () => {
      const world = ap6World({ specs: repository => { repository.fleet = null; } });
      const page = await ap6Open(world, '#/specs/40');
      await page.until(`document.querySelectorAll('main .graph [data-ticket]').length === 10`, 'the ticket graph');
      const states = await graphStates(page);
      assert(states[42] === 'unknown' && states[43] === 'unknown', `notes from unverified authors decided a state: ${JSON.stringify(states)}`);
      assert(states[41] === 'merged' && states[46] === 'you' && states[47] === 'held', `GitHub's own states were lost: ${JSON.stringify(states)}`);
      checkRequestLog(world);
      await page.close();
    });

    await check('AP6 spec page: a ticket GitHub could not read shows as unknown', async () => {
      const world = ap6World();
      const page = await ap6Open(world, '#/specs/40');
      await page.until(`document.querySelector('main .graph')`, 'the ticket graph');
      const main = await page.run(`document.querySelector('main').innerText`);
      assert(/1 of this spec.s tickets couldn.t be read/.test(main), 'the unreadable ticket is not called out');
      assert(/A ticket GitHub couldn.t read\s*Unknown/.test(main), 'the unreadable ticket is not listed as unknown');
      checkRequestLog(world);
      await page.close();
    });

    await check('AP6 spec page: a failed read of the tickets is unknown, never an empty graph', async () => {
      const world = ap6World();
      world.graphql.SpecTickets = async () => ({ status: 502, json: { message: 'Bad Gateway' } });
      const page = await ap6Open(world, '#/specs/40');
      await page.until(`/couldn.t be read/.test(document.querySelector('main').innerText)`, 'the unknown tickets');
      const main = await page.run(`document.querySelector('main').innerText`);
      assert(/This spec.s tickets couldn.t be read/.test(main), 'the failed ticket read is not called unknown');
      assert(!(await page.run(`!!document.querySelector('main .graph')`)), 'an empty graph is drawn for tickets that could not be read');
      assert(/1 of 9 tickets done/.test(main), 'the spec\'s own progress is lost');
      checkRequestLog(world);
      await page.close();
    });

    await check('AP6 keyboard: every page and link is reachable by keyboard, with visible focus, in reading order', async () => {
      const world = ap6World();
      const page = await ap6Open(world);
      await page.until(`document.querySelectorAll('main .cards a.card').length >= 6`, 'the You items');
      // What has focus: a ticket card's number, a link's address, or the element's tag; and whether its focus shows.
      const focused = () => page.run(`(() => { const e = document.activeElement; const s = getComputedStyle(e);
        return { what: e.dataset.ticket || e.getAttribute('href') || e.tagName, shows: s.outlineStyle !== 'none' && s.outlineWidth !== '0px' }; })()`);
      const tabTo = async (what, most = 60) => {
        const seen = [];
        for (let i = 0; i < most; i += 1) {
          await page.key('Tab');
          const now = await focused();
          seen.push(now.what);
          if (now.what === what) {
            assert(now.shows, `${what} has focus but no visible focus ring`);
            return seen;
          }
        }
        throw new Error(`Tab never reached ${what}: ${seen.join(' ')}`);
      };
      // You: each item is reached by Tab, newest first.
      const you = await tabTo('https://github.com/acme/factory/issues/48');
      const order = ['https://github.com/acme/factory/issues/46', 'https://github.com/acme/factory/issues/60#issuecomment-9001',
        'https://github.com/acme/factory/issues/50#issuecomment-9003', 'https://github.com/acme/factory/issues/48'];
      assert(JSON.stringify(you.filter(w => order.includes(w))) === JSON.stringify(order), `You's items in Tab order: ${you.join(' ')}`);
      // The shell's 2 opens Specs; Tab reaches a spec and Enter opens its page, with focus on its title.
      await page.key('2');
      await page.until(`location.hash === '#/specs' && document.querySelector('main a.card[href="#/specs/40"]')`, 'Specs by its key');
      await tabTo('#/specs/40');
      await page.key('Enter');
      await page.until(`location.hash === '#/specs/40' && document.activeElement.classList.contains('spec-title')`, 'focus on the spec page\'s title');
      // The graph's tickets come in reading order: every ticket after each ticket it waits for.
      const walk = await tabTo('41', 80);
      const graph = [];
      const card = what => /^(\d+|gap-\d+)$/.test(what);
      for (let i = 0; i < 14 && graph.length < 10; i += 1) {
        await page.key('Tab');
        const now = await focused();
        assert(now.shows, `${now.what} has focus but no visible focus ring`);
        if (card(now.what)) graph.push(now.what);
      }
      const all = [...walk.filter(card), ...graph];
      assert(new Set(all).size === 10, `not every ticket card is reached by Tab: ${all.join(' ')}`);
      for (const [blocker, ticket] of [['30', '43'], ['41', '42'], ['41', '44'], ['41', '49'], ['42', '45'], ['43', '45'], ['44', '47'], ['gap-49', '49']]) {
        assert(all.indexOf(blocker) < all.indexOf(ticket), `#${ticket} comes before #${blocker}, which it waits for: ${all.join(' ')}`);
      }
      // Esc goes back to all specs, with focus on the spec just left; the shell's 1 still opens You.
      await page.key('Escape');
      await page.until(`location.hash === '#/specs' && document.activeElement.getAttribute('href') === '#/specs/40'`, 'Esc back to the spec\'s card');
      await page.key('1');
      await page.until(`location.hash === '#/you'`, 'You by its key');
      checkRequestLog(world);
      await page.close();
    });

    await check('R6: a refresh keeps keyboard focus on the same ticket', async () => {
      const world = ap6World();
      const page = await ap6Open(world, '#/specs/40');
      await page.until(`document.querySelector('main .graph [data-ticket="41"]')`, 'the ticket graph');
      await page.run(`document.querySelector('main .graph [data-ticket="41"]').focus()`);
      const before = graphqlCount(world);
      await page.run(`OW.data.refreshAll()`);
      await waitFor(() => graphqlCount(world) >= before + 3, 'both feeds read again');
      await settle(page, 500);
      const focused = await page.run(`document.activeElement.dataset.ticket || document.activeElement.tagName`);
      assert(focused === '41', `after a refresh focus is on ${focused}, not ticket 41`);
      assert(await page.run(`document.activeElement.isConnected && document.querySelector('main .graph').contains(document.activeElement)`), 'focus is on a card no longer shown');
      checkRequestLog(world);
      await page.close();
    });

    // ---- AP7 (#1260): the Agents page and the pulse, against recorded answers (ap7-agents.json) ----
    // Agents come from their openwiz:status v1 notes (WizSkills' agent-status contract) and GitHub's pull requests,
    // reviews and checks, never from a state label. "LIVE-<n>" in a fixture is n minutes before the read.

    const ago = text => {
      const now = Date.now();
      const at = n => new Date(now - Number(n) * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      return JSON.parse(text.replace(/"LIVE-(\d+)"/g, (_, n) => JSON.stringify(at(n))).replace(/time: LIVE-(\d+)/g, (_, n) => `time: ${at(n)}`));
    };
    const ap7World = (change = {}) => {
      const world = ap6World(change);
      world.graphql.Agents = async () => {
        const answer = ago(JSON.stringify(await fixture('ap7-agents.json')));
        change.agents?.(answer.data.repository);
        return { status: 200, json: answer };
      };
      return world;
    };
    // Each card on the Agents page: [section, note id, status, its text].
    const agentRows = page => page.run(`[...document.querySelectorAll('main article.card')].map(c => [
      c.closest('.cards').previousElementSibling.textContent, Number(c.dataset.note), c.dataset.status, c.innerText.replace(/\\s+/g, ' ')])`);

    await check('AP7 Agents: working now and the last day, each with kind, model, last step, ticket, time and its pull request', async () => {
      const world = ap7World();
      const page = await ap6Open(world, '#/agents');
      await page.until(`document.querySelectorAll('main article.card').length >= 10`, 'the agent cards');
      const rows = await agentRows(page);
      const ids = section => rows.filter(r => r[0] === section).map(r => [r[1], r[2]]);
      assert(JSON.stringify(ids('Working now')) === JSON.stringify([[7201, 'asking'], [7001, 'working'], [7101, 'working']]),
        `working now: ${JSON.stringify(ids('Working now'))}`);
      assert(JSON.stringify(ids('In the last day')) === JSON.stringify([[7005, 'second'], [7601, 'unknown'], [7901, 'unknown'], [7401, 'lapsed'],
        [7501, 'stopped'], [7102, 'done'], [7301, 'done']]), `the last day: ${JSON.stringify(ids('In the last day'))}`);
      const text = Object.fromEntries(rows.map(r => [r[1], r[3]]));
      assert(/Builder · Synthetic Harness, Synthetic Model/.test(text[7001]) && /#70 Synthetic agents page/.test(text[7001])
        && /opened the pull request; CI is running/.test(text[7001]) && /Working · \d\d:\d\d \(3 min ago\)/.test(text[7001]),
        `the builder's row: ${text[7001]}`);
      assert(/Pull request #12: open, waiting for review, checks running/.test(text[7001]), `#12 from GitHub: ${text[7001]}`);
      assert(/Reviewer ·/.test(text[7101]) && /Pull request #13: open, approved, checks pass/.test(text[7101]), `the reviewer's row: ${text[7101]}`);
      assert(/Pull request #11: merged/.test(text[7301]) && /Stopped: lost claim/.test(text[7501]) && /Fleet ·/.test(text[7501]), 'merged or stopped rows');
      assert(/Lapsed/.test(text[7401]) && /Asking you/.test(text[7201]) && /Not holding the claim/.test(text[7005]), 'lapsed, asking or second rows');
      assert(!rows.some(r => [7701, 7801].includes(r[1])), 'a note older than a day, or a visitor\'s, is shown');
      const links = await page.run(`[...document.querySelectorAll('main article.card[data-note="7001"] a')].map(a => a.getAttribute('href'))`);
      assert(JSON.stringify(links) === JSON.stringify(['https://github.com/acme/factory/issues/70', 'https://github.com/acme/site/pull/12',
        'https://12.example-site.pages.dev/app/']), `the builder's links: ${JSON.stringify(links)}`);
      const badge = await page.run(`[...document.querySelectorAll('nav.main a')].find(a => a.getAttribute('href') === '#/agents').querySelector('.badge').textContent`);
      assert(badge === '3', `the Agents badge says ${badge}, not 3 working now`);
      assert(!/building|in-review/i.test(world.log.filter(r => operation(r) === 'Agents').map(r => r.body).join('')), 'the Agents read asks for a state label');
      if (process.env.SHOTS) {
        await page.shot(join(process.env.SHOTS, 'agents-laptop.png'), 1440, 900, false);
        await page.shot(join(process.env.SHOTS, 'agents-phone.png'), 390, 844, true);
      }
      checkRequestLog(world);
      await page.close();
    });

    await check('AP7 Agents: a status note of an unknown version, or one that does not read as v1, shows as unknown', async () => {
      const world = ap7World();
      const page = await ap6Open(world, '#/agents');
      await page.until(`document.querySelector('main article.card[data-note="7601"]')`, 'the unknown note');
      const rows = Object.fromEntries((await agentRows(page)).map(r => [r[1], r]));
      for (const id of [7601, 7901]) {
        assert(rows[id][2] === 'unknown' && /Unknown agent/.test(rows[id][3]) && /Unknown\b/.test(rows[id][3]), `note ${id}: ${rows[id][3]}`);
        assert(!/Synthetic Harness|mood|no skills line/.test(rows[id][3]), `note ${id}'s fields are guessed at: ${rows[id][3]}`);
      }
      assert(/version 2/.test(rows[7601][3]), `the v2 note doesn't say its version: ${rows[7601][3]}`);
      checkRequestLog(world);
      await page.close();
    });

    await check('AP7 Agents: without the record authors, every note is unknown, never trusted', async () => {
      const world = ap7World({ agents: repository => { repository.fleet = null; } });
      const page = await ap6Open(world, '#/agents');
      await page.until(`/record authors/i.test(document.querySelector('main').innerText)`, 'the record-authors notice');
      const rows = await agentRows(page);
      assert(rows.length && rows.every(r => r[2] === 'unknown'), `a note was trusted without its author checked: ${JSON.stringify(rows.map(r => r.slice(1, 3)))}`);
      assert(!rows.some(r => r[0] === 'Working now'), 'an unverified note is listed as working now');
      checkRequestLog(world);
      await page.close();
    });

    await check('AP7 pulse: a spec page marks the tickets an agent is working on now, and only those', async () => {
      // AP1's writer always writes a skills line; the recorded AP6 notes get one here.
      const skills = repository => {
        for (const ticket of repository.s40.subIssues.nodes) for (const c of ticket?.comments?.nodes || []) {
          c.body = c.body.replace('\nstep:', '\nskills: build-ticket@0.1.2\nstep:');
        }
      };
      const world = ap7World({ tickets: skills });
      const page = await ap6Open(world, '#/specs/40');
      await page.until(`document.querySelectorAll('main .graph [data-ticket]').length === 10`, 'the ticket graph');
      await page.until(`document.querySelector('main .graph [data-pulse]')`, 'a pulse');
      const pulsing = await page.run(`[...document.querySelectorAll('main .graph [data-pulse]')].map(c => c.dataset.ticket).sort()`);
      assert(JSON.stringify(pulsing) === JSON.stringify(['42', '43']), `pulsing tickets: ${JSON.stringify(pulsing)}`);
      const said = await page.run(`document.querySelector('main .graph [data-ticket="43"]').innerText`);
      assert(/Agent working/.test(said), `the pulse has no words: ${said}`);
      if (process.env.SHOTS) await page.shot(join(process.env.SHOTS, 'pulse-laptop.png'), 1440, 900, false);
      checkRequestLog(world);
      await page.close();
    });

    await check('AP7 keyboard: 3 opens Agents; Tab walks each card\'s ticket, pull request and preview with visible focus; a refresh keeps it', async () => {
      const world = ap7World();
      const page = await ap6Open(world);
      await page.until(`document.querySelectorAll('main .cards a.card').length >= 6`, 'the You page');
      await page.key('3');
      await page.until(`location.hash === '#/agents' && document.querySelectorAll('main article.card').length >= 10`, 'Agents by its key');
      const focused = () => page.run(`(() => { const e = document.activeElement; const s = getComputedStyle(e);
        return { what: e.getAttribute('href') || e.tagName, shows: s.outlineStyle !== 'none' && s.outlineWidth !== '0px' }; })()`);
      const walk = [];
      for (let i = 0; i < 40 && walk.length < 6; i += 1) {
        await page.key('Tab');
        const now = await focused();
        if (!now.what.startsWith('https://')) continue;
        assert(now.shows, `${now.what} has focus but no visible focus ring`);
        walk.push(now.what);
      }
      const want = ['https://github.com/acme/factory/issues/72', 'https://github.com/acme/factory/issues/70', 'https://github.com/acme/site/pull/12',
        'https://12.example-site.pages.dev/app/', 'https://github.com/acme/factory/issues/71', 'https://github.com/acme/site/pull/13'];
      assert(JSON.stringify(walk) === JSON.stringify(want), `Tab order: ${walk.join(' ')}`);
      const before = graphqlCount(world, ['Agents']);
      await page.run(`OW.data.refreshAll()`);
      await waitFor(() => graphqlCount(world, ['Agents']) > before, 'the Agents feed read again');
      await settle(page, 500);
      assert((await focused()).what === 'https://github.com/acme/site/pull/13', 'a refresh moved keyboard focus');
      await page.key('1');
      await page.until(`location.hash === '#/you'`, 'You by its key');
      checkRequestLog(world);
      await page.close();
    });

    // ---- Review round 1 (R1-R6) ----

    await check('R1: signing out while a token refresh is still out stays signed out', async () => {
      const world = new World();
      const grant = await fixture('token.json');
      world.helper['/api/sign-in/token'] = async () => ({ status: 200, json: { ...grant, expires_in: 30 } });
      let release;
      const held = new Promise(resolve => { release = resolve; });
      world.helper['/api/sign-in/refresh'] = async () => {
        await held;
        return { status: 200, json: { ...grant, access_token: 'ghu_SYNTHETICafter0000000000000000000' } };
      };
      const page = await open(browser, world);
      await page.go(`${SITE}/app/?code=c0de&state=${STATE}`);
      await waitFor(() => world.log.some(r => r.path === '/api/sign-in/refresh'), 'the held token refresh');
      await page.click('Sign out');
      await page.until(`[...document.querySelectorAll('a')].some(a => a.textContent.trim() === 'Sign in with GitHub')`, 'the signed-out screen');
      const signedOutAt = world.log.length;
      release();
      await waitFor(() => world.answered('/api/sign-in/refresh'), 'the refresh answer');
      await page.run(`new Promise(resolve => setTimeout(resolve, 400))`);
      assert(await page.run(`localStorage.getItem('openwiz.app.auth')`) === null, 'the late refresh put a sign-in back');
      const after = world.log.slice(signedOutAt).filter(r => r.origin === API && r.method !== 'OPTIONS');
      assert(after.length === 0, `GitHub was read after sign-out: ${after.map(r => r.path).join(', ')}`);
      assert((await page.text()).includes('Sign in with GitHub'), 'the page left the signed-out screen');
      checkRequestLog(world);
      await page.close();
    });

    await check('R2: changing repository keeps a GitHub back-off', async () => {
      const world = new World();
      world.graphql.Specs = ok('specs.json');
      world.graphql.Agents = async () => {
        const answer = await fixture('agents.json');
        answer.data.rateLimit = { limit: 5000, remaining: 12, resetAt: '2030-01-01T00:00:00Z' };
        return { status: 200, json: answer };
      };
      const page = await open(browser, world);
      await signIn(page, world);
      await page.click('acme/factory');
      await page.until(`/GitHub.s limit is low/.test(document.body.innerText)`, 'the low-limit notice');
      const before = graphqlCount(world);
      await page.click('acme/factory'); // the repository button: change repository
      await page.until(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'acme/site')`, 'the picker');
      await page.click('acme/site');
      await page.until(`document.querySelector('h1') && document.querySelector('h1').textContent.trim() === 'You' && document.body.innerText.includes('acme/site')`, 'the shell on acme/site');
      await page.run(`new Promise(resolve => setTimeout(resolve, 400))`);
      assert(graphqlCount(world) === before, `changing repository read GitHub's GraphQL while paused (${graphqlCount(world) - before} more)`);
      assert(/GitHub.s limit is low/.test(await page.text()), 'the back-off notice is gone after changing repository');
      checkRequestLog(world);
      await page.close();
    });

    await check('R3: the skip link moves to the page without changing it', async () => {
      const world = new World();
      world.graphql.Specs = ok('specs.json');
      world.graphql.Agents = ok('agents.json');
      const page = await open(browser, world);
      await signIn(page, world);
      await page.click('acme/factory');
      await page.click('Specs');
      await page.until(`location.hash === '#/specs'`, 'the Specs page');
      await page.click('Skip to the page');
      await page.run(`new Promise(resolve => setTimeout(resolve, 200))`);
      assert(await page.run('location.hash') === '#/specs', `the skip link changed the route to ${await page.run('location.hash')}`);
      assert(await page.run(`document.querySelector('h1').textContent.trim()`) === 'Specs', 'the skip link changed the page');
      assert(await page.run(`!!document.activeElement.closest('main')`), 'focus did not move into the page');
      checkRequestLog(world);
      await page.close();
    });

    const many = Array.from({ length: 100 }, (_, i) => ({ id: 3000 + i, name: `repo-${String(i).padStart(3, '0')}`,
      full_name: `acme/repo-${String(i).padStart(3, '0')}`, private: true, owner: { login: 'acme' } }));
    const pageTwo = `${API}/user/installations/1001/repositories?per_page=100&page=2`;
    const paged = second => async url => url.searchParams.get('page') === '2' ? second()
      : { status: 200, json: { total_count: 101, repositories: many }, headers: { Link: `<${pageTwo}>; rel="next", <${pageTwo}>; rel="last"` } };

    await check('R4: the picker follows every page of repositories', async () => {
      const world = new World();
      world.rest['/user/installations/1001/repositories'] = paged(async () => ({ status: 200,
        json: { total_count: 101, repositories: [{ id: 3999, name: 'zz-last', full_name: 'acme/zz-last', private: false, owner: { login: 'acme' } }] } }));
      const page = await open(browser, world);
      await page.go(`${SITE}/app/?code=c0de&state=${STATE}`);
      await page.until(`document.body.innerText.includes('acme/repo-000')`, 'the picker');
      await page.until(`document.body.innerText.includes('acme/zz-last')`, 'the repository on the second page');
      const count = await page.run(`document.querySelectorAll('.repos button').length`);
      assert(count === 101, `the picker shows ${count} repositories, not 101`);
      checkRequestLog(world);
      await page.close();
    });

    await check('R4: a failed or foreign next page says the list is incomplete', async () => {
      for (const [name, second, link] of [
        ['a failed page', async () => ({ status: 502, json: { message: 'Bad Gateway' } }), null],
        ['a next link off GitHub\'s route', null, 'https://example.com/user/installations/1001/repositories?page=2'],
      ]) {
        const world = new World();
        world.rest['/user/installations/1001/repositories'] = link
          ? async () => ({ status: 200, json: { total_count: 101, repositories: many }, headers: { Link: `<${link}>; rel="next"` } })
          : paged(second);
        const page = await open(browser, world);
        await page.go(`${SITE}/app/?code=c0de&state=${STATE}`);
        await page.until(`document.body.innerText.includes('acme/repo-000')`, `the picker (${name})`);
        await page.until(`/some may be missing/i.test(document.body.innerText)`, `the incomplete-list notice (${name})`);
        assert(!world.log.some(r => r.url.startsWith('https://example.com')), `${name}: the app followed a link off GitHub`);
        checkRequestLog(world);
        await page.close();
      }
    });

    await check('R5: Sign out stays offered while the picker can\'t read GitHub', async () => {
      const world = new World();
      world.rest['/user/installations'] = async () => ({ status: 502, json: { message: 'Bad Gateway' } });
      const page = await open(browser, world);
      await page.go(`${SITE}/app/?code=c0de&state=${STATE}`);
      await page.until(`/couldn.t read your repositories/i.test(document.body.innerText)`, 'the picker error');
      await page.click('Sign out');
      await page.until(`[...document.querySelectorAll('a')].some(a => a.textContent.trim() === 'Sign in with GitHub')`, 'the signed-out screen');
      assert(await page.run(`localStorage.getItem('openwiz.app.auth')`) === null, 'the sign-in is still kept');
      checkRequestLog(world);
      await page.close();
    });

    await check('R6: a long repository name fits a phone', async () => {
      const world = new World();
      const long = `acme/${'averylongrepositoryname'.repeat(4)}`; // 92 characters, nowhere to break
      world.rest['/user/installations/1001/repositories'] = async () => ({ status: 200,
        json: { total_count: 1, repositories: [{ id: 4001, name: long.slice(5), full_name: long, private: true, owner: { login: 'acme' } }] } });
      const page = await open(browser, world);
      await page.size(320, 640, true);
      await page.go(`${SITE}/app/?code=c0de&state=${STATE}`);
      await page.until(`document.body.innerText.includes('Private')`, 'the picker');
      const width = await page.run('document.documentElement.scrollWidth');
      assert(width <= 320, `the picker is ${width} CSS pixels wide on a 320-pixel phone`);
      const tag = await page.run(`(() => { const r = document.querySelector('.repos .tag').getBoundingClientRect(); return r.right; })()`);
      assert(tag <= 320, 'the Private label is off screen');
      await page.size(null);
      checkRequestLog(world);
      await page.close();
    });
    // ---- #1325: a first sign-in with no installation ----

    await check('#1325: no installation yet: one more step installs OpenWiz Viewer, and the return lists the repositories', async () => {
      const world = new World();
      let installed = false;
      world.rest['/user/installations'] = async () => ({ status: 200,
        json: installed ? await fixture('installations.json') : { total_count: 0, installations: [] } });
      const page = await open(browser, world);
      await page.go(`${SITE}/app/?code=c0de&state=${STATE}`);
      await page.until(`/one more step/i.test(document.body.innerText)`, 'the one-more-step message');
      assert((await page.text()).includes('One more step: let OpenWiz Viewer read your repositories'), 'the message is not the plain one-more-step sentence');
      const main = await page.run(`[...document.querySelectorAll('a.btn.primary')].filter(a => a.offsetParent !== null).map(a => a.getAttribute('href'))`);
      assert(JSON.stringify(main) === JSON.stringify(['https://github.com/apps/openwiz-viewer/installations/new']),
        `the main button is ${JSON.stringify(main)}, not the direct install link`);
      assert(!(await page.text()).includes('Choose repositories on GitHub'), 'the empty state still offers the settings link');
      await page.size(320, 640, true);
      const width = await page.run('document.documentElement.scrollWidth');
      assert(width <= 320, `the one-more-step screen is ${width} CSS pixels wide on a 320-pixel phone`);
      await page.size(null);
      if (process.env.SHOTS) await page.shot(join(process.env.SHOTS, 'install-phone.png'), 390, 844, true);
      // GitHub sends the installer back to the setup URL with installation_id and setup_action; still signed in.
      installed = true;
      await page.go(`${SITE}/app/?installation_id=1001&setup_action=install`);
      await page.until(`document.body.innerText.includes('acme/factory') && document.body.innerText.includes('acme/site')`, 'the filled picker');
      assert(await page.run('location.search') === '', 'the setup parameters stayed in the address');
      const text = await page.text();
      assert(!/one more step/i.test(text), 'the filled picker still asks for one more step');
      assert(text.includes('Choose repositories on GitHub'), 'the filled picker lost its link');
      const swaps = world.log.filter(r => r.path === '/api/sign-in/token').length;
      assert(swaps === 1, `returning from the install exchanged ${swaps} codes, not the one sign-in`);
      checkRequestLog(world);
      await page.close();
    });

    await check('#1325 R1: an existing installation with no readable repository keeps the picker and its settings link', async () => {
      for (const [name, reply, shown] of [
        ['no readable repository', { status: 200, json: { total_count: 0, repositories: [] } }, /can.t see any repository yet/i],
        ['a failed repository read', { status: 502, json: { message: 'Bad Gateway' } }, /some may be missing/i],
      ]) {
        const world = new World();
        world.rest['/user/installations/1001/repositories'] = async () => reply;
        const page = await open(browser, world);
        await page.go(`${SITE}/app/?code=c0de&state=${STATE}`);
        await page.until(`document.body.innerText.includes('Choose repositories on GitHub') || /one more step/i.test(document.body.innerText)`, `the picker (${name})`);
        const text = await page.text();
        assert(!/one more step/i.test(text), `${name}: an existing installation is asked to install again`);
        assert(shown.test(text), `${name}: the picker does not say ${shown}`);
        const href = await page.run(`[...document.querySelectorAll('a')].find(a => a.textContent.trim() === 'Choose repositories on GitHub')?.getAttribute('href')`);
        assert(href === 'https://github.com/settings/installations', `${name}: the settings link is ${href}`);
        checkRequestLog(world);
        await page.close();
      }
    });
    // ---- AP14 (#1326): the new OpenWiz mark and the Wiz family, cream on charcoal; nothing else in the shell moves ----

    const CREAM = '#cfc6b8';
    const CHARCOAL = '#1b1916';
    // Where the brand and the page sit, measured on main before the new mark (AP7's shell): the mark must take the old
    // logo's 28 x 28 place exactly, so nothing else in the layout moves. [x, y, width, height], CSS pixels; a title's
    // place only, as its width is its words'.
    const LAYOUT = {
      laptop: { brand: [12, 20, 239, 34], mark: [22, 23, 28, 28], nav: [12, 142, 239, 152], title: [312, 40] },
      phone: { top: [0, 0, 390, 65], brand: [14, 18, 28, 28], mark: [14, 18, 28, 28], title: [16, 87] },
      panel: { brand: [490, 307, 460, 30], mark: [490, 308, 28, 28], title: [490, 360] },
    };
    const box = selector => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.getClientRects().length);
      if (!el) return null; const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); })()`;
    // Every brand mark on screen: the new mark file, loaded and drawn at 28 x 28, with no old drawn logo beside it.
    async function checkMarks(page, where) {
      const marks = await page.run(`[...document.querySelectorAll('.brand')].filter(b => b.getClientRects().length).map(b => {
        const img = b.querySelector('img');
        return { img: img && img.getAttribute('src'), alt: img && img.getAttribute('alt'), loaded: !!img && img.complete && img.naturalWidth > 0,
          size: img ? [img.width, img.height] : null, oldLogo: !!b.querySelector('svg'), text: b.innerText.trim() };
      })`);
      assert(marks.length > 0, `${where}: no brand on screen`);
      for (const m of marks) {
        assert(m.img === '/app/mark.svg', `${where}: the brand shows ${m.oldLogo ? 'the old drawn logo' : m.img}, not the new mark /app/mark.svg`);
        assert(m.loaded, `${where}: the mark did not load`);
        assert(JSON.stringify(m.size) === '[28,28]', `${where}: the mark is ${JSON.stringify(m.size)}, not 28 x 28`);
        assert(!m.oldLogo, `${where}: the old logo is still drawn beside the mark`);
        assert(m.alt === '', `${where}: the mark is not decorative (alt=${JSON.stringify(m.alt)}) next to the OpenWiz name`);
      }
    }
    async function checkLayout(page, where, expected) {
      for (const [part, want] of Object.entries(expected)) {
        const selector = { brand: '.brand', mark: '.brand img, .brand svg', nav: 'nav.main', top: 'header.top', title: 'h1' }[part];
        const got = (await page.run(box(selector)))?.slice(0, want.length);
        assert(JSON.stringify(got) === JSON.stringify(want), `${where}: the ${part} moved: ${JSON.stringify(got)}, was ${JSON.stringify(want)}`);
      }
    }
    // A served file of the app's, read as the browser gets it.
    const served = async path => {
      const file = await staticFile(path);
      assert(file.status === 200, `${path} is not served (${file.status})`);
      return file.body;
    };

    await check('AP14: the new mark, cream on charcoal, is the favicon and the home-screen icon', async () => {
      const world = new World();
      const page = await open(browser, world);
      await page.go(`${SITE}/app/`);
      await page.until(`document.querySelector('.panel')`, 'the sign-in screen');
      const icons = await page.run(`[...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')].map(l => [l.rel, l.getAttribute('href')])`);
      assert(JSON.stringify(icons) === JSON.stringify([['icon', '/app/icon.svg'], ['icon', '/app/icon.ico'], ['apple-touch-icon', '/app/icon-180.png']]),
        `the app's icons are ${JSON.stringify(icons)}, not the new mark's`);
      const svg = String(await served('/app/icon.svg')).toLowerCase();
      assert(svg.includes(`fill="${CHARCOAL}"`) && svg.includes(`fill="${CREAM}"`), 'the favicon is not the cream mark on charcoal');
      assert(!/#2b2bff|#e8b46a/.test(svg), 'the favicon still carries an old logo colour');
      const ico = await served('/app/icon.ico');
      assert(ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1, 'icon.ico is not an icon file');
      const sizes = [...Array(ico.readUInt16LE(4)).keys()].map(i => ico[6 + 16 * i] || 256);
      assert(JSON.stringify(sizes) === '[16,32,48]', `icon.ico holds ${JSON.stringify(sizes)}, not 16, 32 and 48`);
      const png = await served('/app/icon-180.png');
      assert(png.readUInt32BE(16) === 180 && png.readUInt32BE(20) === 180, 'the home-screen icon is not 180 x 180');
      // The picture itself: drawn in the page, its corner is charcoal and the mark's middle is cream.
      const pixels = await page.run(`new Promise(resolve => { const img = new Image(); img.onload = () => {
        const c = document.createElement('canvas'); c.width = c.height = 180; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const at = (x, y) => '#' + [...g.getImageData(x, y, 1, 1).data.slice(0, 3)].map(v => v.toString(16).padStart(2, '0')).join('');
        resolve([at(90, 8), at(60, 100)]); }; img.src = '/app/icon-180.png'; })`);
      assert(JSON.stringify(pixels) === JSON.stringify([CHARCOAL, CREAM]), `the home-screen icon reads ${JSON.stringify(pixels)}, not charcoal around a cream mark`);
      checkRequestLog(world);
      await page.close();
    });

    await check('AP14: the brand shows the new mark on the sign-in screen, the picker and the shell, and nothing else moves', async () => {
      const world = new World();
      world.graphql.Specs = ok('specs.json');
      world.graphql.Agents = ok('agents.json');
      const page = await open(browser, world);
      await page.size(1440, 900, false);
      await page.go(`${SITE}/app/`);
      await page.until(`document.querySelector('.panel')`, 'the sign-in screen');
      await settle(page);
      await checkMarks(page, 'sign-in');
      await checkLayout(page, 'sign-in', LAYOUT.panel);
      await page.go(`${SITE}/app/?code=c0de&state=${STATE}`);
      await page.until(`document.body.innerText.includes('acme/factory')`, 'the repository picker');
      await settle(page);
      await checkMarks(page, 'picker');
      await page.click('acme/factory');
      await page.until(`/Specs read \\d\\d:\\d\\d/.test(document.body.innerText)`, 'the shell');
      await settle(page);
      await checkMarks(page, 'shell on a laptop');
      await checkLayout(page, 'shell on a laptop', LAYOUT.laptop);
      await page.size(390, 844, true);
      await checkMarks(page, 'shell on a phone');
      await checkLayout(page, 'shell on a phone', LAYOUT.phone);
      await page.size(null);
      if (process.env.SHOTS) {
        await page.shot(join(process.env.SHOTS, 'mark-laptop.png'), 1440, 900, false);
        await page.shot(join(process.env.SHOTS, 'mark-phone.png'), 390, 844, true);
      }
      const mark = String(await served('/app/mark.svg')).toLowerCase();
      assert(mark.includes(`fill="${CREAM}"`) && !/#2b2bff|#e8b46a|#ffffff/.test(mark), 'the header mark is not drawn in cream alone');
      checkRequestLog(world);
      await page.close();
    });

    await check('AP14: a Wiz of the family keeps the picker\'s empty states company, and only them', async () => {
      const family = () => page.run(`[...document.querySelectorAll('.panel img')].filter(i => !i.closest('.brand')).map(i =>
        ({ src: i.getAttribute('src'), alt: i.getAttribute('alt'), loaded: i.complete && i.naturalWidth > 0 }))`);
      let page;
      for (const [name, rest, shown] of [
        ['no installation', { '/user/installations': async () => ({ status: 200, json: { total_count: 0, installations: [] } }) }, /one more step/i],
        ['no readable repository', { '/user/installations/1001/repositories': async () => ({ status: 200, json: { total_count: 0, repositories: [] } }) }, /can.t see any repository yet/i],
        ['a filled picker', {}, null],
      ]) {
        const world = new World();
        Object.assign(world.rest, rest);
        page = await open(browser, world);
        await page.go(`${SITE}/app/?code=c0de&state=${STATE}`);
        await page.until(shown ? `${shown}.test(document.body.innerText)` : `document.body.innerText.includes('acme/factory')`, `the picker (${name})`);
        await settle(page);
        const wizes = await family();
        if (shown) {
          assert(wizes.length === 1, `${name}: the empty state shows ${wizes.length} family Wizes, not one`);
          assert(wizes[0].src === '/app/wiz-reviewer.svg' && wizes[0].loaded, `${name}: the family Wiz is ${JSON.stringify(wizes[0])}`);
          assert(wizes[0].alt === '', `${name}: the Wiz is announced (alt=${JSON.stringify(wizes[0].alt)}); the sentence beside it already says it all`);
          const svg = String(await served('/app/wiz-reviewer.svg')).toLowerCase();
          assert(svg.includes(`fill="${CREAM}"`) && !/#2b2bff|#e8b46a/.test(svg), `${name}: the Wiz is not drawn in cream`);
          await page.size(320, 640, true);
          const width = await page.run('document.documentElement.scrollWidth');
          assert(width <= 320, `${name}: the empty state is ${width} CSS pixels wide on a 320-pixel phone`);
          await page.size(null);
          if (process.env.SHOTS) await page.shot(join(process.env.SHOTS, `family-${name.replace(/ /g, '-')}.png`), 390, 844, true);
        } else {
          assert(wizes.length === 0, 'a filled picker shows a family Wiz; only the empty states have one');
        }
        checkRequestLog(world);
        await page.close();
      }
    });

    // ---- AP15 (#1327): Cmd-K, a keyboard-first command palette, and `?` for every shortcut ----
    // The palette is a modal dialog: a search field (a combobox) over a list of results (a listbox). It finds every page,
    // spec, ticket and agent the app shows, and runs the app's view actions. It never writes to GitHub: anything that
    // changes work is something an agent does through GitHub, and the palette only links to it.

    const palette = page => page.run(`(() => { const d = document.querySelector('dialog[open]'); if (!d) return null;
      const input = d.querySelector('input'); const active = d.querySelector('[role="option"][aria-selected="true"]');
      return { label: d.getAttribute('aria-label') || d.querySelector('h2')?.textContent || '', typing: document.activeElement === input,
        inside: d.contains(document.activeElement), value: input?.value ?? null,
        active: active ? active.innerText.replace(/\\s+/g, ' ').trim() : null,
        options: [...d.querySelectorAll('[role="option"]')].map(o => o.innerText.replace(/\\s+/g, ' ').trim()) }; })()`);
    const paletteOpen = async (page, ...held) => {
      await page.key('k', ...(held.length ? held : ['Ctrl']));
      await page.until(`document.querySelector('dialog[open] input') === document.activeElement`, 'the palette, with the search field focused');
    };
    // Type into the palette and wait until the first result is the one wanted.
    const find = async (page, text, first) => {
      await page.type(text);
      await page.until(`(document.querySelector('dialog[open] [role="option"][aria-selected="true"]')?.innerText || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(first)})`,
        `"${first}" as the palette's first result for "${text}"`, 4000);
    };
    const visibleFocus = page => page.run(`(() => { const e = document.activeElement; const s = getComputedStyle(e);
      return s.outlineStyle !== 'none' && s.outlineWidth !== '0px'; })()`);

    await check('AP15 palette: Cmd-K and Ctrl-K open it; typing finds any page, spec, ticket or agent, and Enter goes there', async () => {
      const world = ap7World();
      const page = await ap6Open(world);
      await page.until(`document.querySelectorAll('main .cards a.card').length >= 6`, 'the You page');
      await page.until(`/Agents read \\d\\d:\\d\\d/.test(document.body.innerText) && OW.data.feeds.specs.data?.specs`, 'both feeds read');
      // Ctrl-K opens it with the search field focused; Esc closes it and gives focus back; Cmd-K (Meta) opens it too.
      await page.run(`document.querySelector('main .cards a.card').focus()`);
      await paletteOpen(page, 'Ctrl');
      assert(/command/i.test((await palette(page)).label), 'the palette has no accessible name');
      await page.key('Escape');
      await page.until(`!document.querySelector('dialog[open]')`, 'Esc to close the palette');
      assert(await page.run(`document.activeElement === document.querySelector('main .cards a.card')`), 'closing the palette lost the focused card');
      assert(await page.run(`location.hash`) === '#/you', 'Esc in the palette left the page');
      await paletteOpen(page, 'Meta');
      // A page, by its name.
      await find(page, 'agents', 'Agents');
      await page.key('Enter');
      await page.until(`location.hash === '#/agents' && !document.querySelector('dialog[open]')`, 'Enter on a page to go there');
      // A spec, by its number: its page, with focus on its title.
      await paletteOpen(page);
      await find(page, '#40', 'Spec: shipping notes');
      await page.key('Enter');
      await page.until(`location.hash === '#/specs/40' && document.activeElement.classList.contains('spec-title')`, 'Enter on a spec to open its page');
      // A ticket, by words of its title: its spec's page, with focus on its card in the graph.
      await paletteOpen(page);
      await find(page, 'notes search', '#45 Notes search');
      await page.key('Enter');
      await page.until(`location.hash === '#/specs/40' && document.activeElement.dataset.ticket === '45'`, 'Enter on a ticket to focus its card');
      // A ticket on another spec, from another page.
      await page.key('1');
      await page.until(`location.hash === '#/you'`, 'You by its key');
      await paletteOpen(page);
      await find(page, 'results page', '#53 Results page');
      await page.key('Enter');
      await page.until(`location.hash === '#/specs/50' && document.activeElement.dataset.ticket === '53'`, 'Enter on a ticket of spec 50');
      // An agent, by its ticket: the Agents page, with focus on its card's ticket.
      await paletteOpen(page);
      await find(page, 'synthetic contract', 'Reviewer');
      await page.key('Enter');
      await page.until(`location.hash === '#/agents' && document.activeElement.closest('article.card')?.dataset.note === '7101'`, 'Enter on an agent to focus its card');
      // Nothing found says so, never an empty box.
      await paletteOpen(page);
      await page.type('zzqx nothing like this');
      await page.until(`/no match/i.test(document.querySelector('dialog[open]').innerText)`, 'the no-match line');
      await page.key('Escape');
      checkRequestLog(world);
      assert(world.opened.length === 0, `going somewhere in the app opened a tab: ${JSON.stringify(world.opened)}`);
      await page.close();
    });

    await check('AP15 palette: its view actions (open on GitHub, copy a link, filter, refresh) work, and nothing writes to GitHub', async () => {
      const world = ap7World();
      const page = await ap6Open(world, '#/specs/40');
      await page.until(`document.querySelectorAll('main .graph [data-ticket]').length === 10`, 'the ticket graph');
      await page.until(`/Agents read \\d\\d:\\d\\d/.test(document.body.innerText)`, 'the Agents read');
      // Copy a link: this page's own address.
      await paletteOpen(page);
      await find(page, 'copy link', 'Copy a link to this page');
      await page.key('Enter');
      await page.until(`/copied/i.test(document.querySelector('dialog[open]')?.innerText || '')`, 'the copied line');
      assert(await page.clipboard() === `${SITE}/app/#/specs/40`, `the copied link is ${await page.clipboard()}`);
      await page.key('Escape');
      // Alt+Enter copies the chosen result's GitHub link.
      await paletteOpen(page);
      await find(page, 'notes export', '#47 Notes export');
      await page.key('Enter', 'Alt');
      await page.until(`/copied/i.test(document.querySelector('dialog[open]')?.innerText || '')`, 'the copied line');
      assert(await page.clipboard() === 'https://github.com/acme/factory/issues/47', `Alt+Enter copied ${await page.clipboard()}`);
      await page.key('Escape');
      // Open on GitHub: this page's spec, and a chosen result with Shift+Enter, each in a new tab; the app stays.
      await paletteOpen(page);
      await find(page, 'open on github', 'Open this page on GitHub');
      await page.key('Enter');
      await waitFor(() => world.opened.length >= 1, 'the spec opened on GitHub');
      await paletteOpen(page);
      await find(page, 'notes feed', '#44 Notes feed');
      await page.key('Enter', 'Shift');
      await waitFor(() => world.opened.length >= 2, 'the ticket opened on GitHub');
      assert(JSON.stringify(world.opened.map(o => `${o.method} ${o.url}`)) === JSON.stringify(['GET https://github.com/acme/factory/issues/40',
        'GET https://github.com/acme/factory/issues/44']), `opened: ${JSON.stringify(world.opened)}`);
      assert(await page.run(`location.href`) === `${SITE}/app/#/specs/40`, 'opening on GitHub moved the app');
      // Filter: only one kind of result, until Backspace in the empty field shows everything again.
      await paletteOpen(page);
      await find(page, 'only tickets', 'Show only tickets');
      await page.key('Enter');
      await page.until(`document.querySelector('dialog[open] input').value === '' && document.querySelectorAll('dialog[open] [role="option"]').length > 3`, 'the filtered list');
      let shown = await palette(page);
      assert(shown.options.every(o => /^Ticket\b/.test(o)), `the ticket filter shows: ${shown.options.slice(0, 6).join(' | ')}`);
      assert(shown.options.some(o => o.includes('#53 Results page')) && shown.options.some(o => o.includes('#48 Register the notes domain')), 'the ticket filter misses tickets');
      await page.type('agents');
      await page.until(`!document.querySelector('dialog[open] [role="option"]')`, 'no ticket matching "agents"');
      for (let i = 0; i < 'agents'.length + 1; i += 1) await page.key('Backspace');
      await page.until(`[...document.querySelectorAll('dialog[open] [role="option"]')].some(o => /^Page\\b/.test(o.innerText.trim()))`, 'everything back after Backspace');
      await page.key('Escape');
      // Refresh: every feed is read again.
      const before = graphqlCount(world);
      await paletteOpen(page);
      await find(page, 'refresh', 'Refresh now');
      await page.key('Enter');
      await waitFor(() => graphqlCount(world) >= before + 3, 'both feeds read again');
      // Every result that would change work only links to GitHub; no request the app sent writes anything.
      checkRequestLog(world);
      assert(world.opened.every(o => o.method === 'GET' && o.url.startsWith('https://github.com/')), 'a tab opened somewhere other than GitHub');
      await page.close();
    });

    // AP18 (#1588): the palette reaches everything the app shows, outside blockers and You-only tickets included.
    await check('AP18 R1: an outside blocker the graph draws is a palette result whose Enter focuses its card; its own spec wins; placeholders stay out', async () => {
      // #45 (spec 40) also blocks #52, so spec 50 (read first) draws #45 outside it.
      const world = ap7World({ tickets: repository => {
        const query = repository.s50.subIssues.nodes.find(issue => issue?.number === 52);
        query.blockedBy.nodes.push({ number: 45, title: 'Notes search', url: 'https://github.com/acme/factory/issues/45', state: 'OPEN',
          stateReason: null, repository: { nameWithOwner: 'acme/factory' } });
        query.blockedBy.totalCount += 1;
      } });
      const page = await ap6Open(world);
      await page.until(`document.querySelectorAll('main .cards a.card').length >= 6`, 'the You page');
      await page.until(`OW.factory.model(OW.data.feeds)?.specs.find(s => s.number === 50)?.graph?.tickets.some(t => t.number === 45 && t.outside)`,
        'spec 50 drawing #45 outside it');
      // #30 blocks #43 from outside spec 40: Enter opens spec 40 and focuses #30's card there.
      await paletteOpen(page);
      await find(page, '#30', '#30');
      const blocker = (await palette(page)).options.filter(o => o.includes('#30 #30'));
      assert(blocker.length === 1 && /outside #40/.test(blocker[0]), `the outside blocker's results: ${JSON.stringify(blocker)}`);
      await page.key('Enter');
      await page.until(`location.hash === '#/specs/40' && document.activeElement.dataset.ticket === '30'`, 'Enter on the outside blocker to focus its card');
      assert(await visibleFocus(page), "the outside blocker's card has focus but no visible focus ring");
      // A ticket drawn outside one spec and inside its own goes to its own spec.
      await page.key('1');
      await page.until(`location.hash === '#/you'`, 'You by its key');
      await paletteOpen(page);
      await find(page, '#45', '#45 Notes search');
      const results = (await palette(page)).options.filter(o => o.includes('#45 Notes search'));
      assert(results.length === 1 && !/outside/i.test(results[0]), `#45's results: ${JSON.stringify(results)}`);
      await page.key('Enter');
      await page.until(`location.hash === '#/specs/40' && document.activeElement.dataset.ticket === '45'`, 'Enter on #45 to its own spec');
      // The blocked-by placeholders GitHub couldn't read are no result.
      await paletteOpen(page);
      await page.type("couldn't read");
      await page.until(`/no match/i.test(document.querySelector('dialog[open]').innerText)`, 'no result for an unreadable placeholder');
      await page.key('Escape');
      checkRequestLog(world);
      assert(world.opened.length === 0, `going somewhere in the app opened a tab: ${JSON.stringify(world.opened)}`);
      await page.close();
    });

    await check('AP18 R2: a ticket shown only on You goes to You and focuses its card; Shift+Enter still opens it on GitHub', async () => {
      const world = ap7World();
      const page = await ap6Open(world, '#/specs');
      await page.until(`OW.data.feeds.specs.data?.specs && document.querySelector('main a.card')`, 'the Specs page');
      // #48 is on You and in no spec's graph.
      await paletteOpen(page);
      await find(page, '#48', '#48 Register the notes domain');
      await page.key('Enter');
      await page.until(`location.hash === '#/you' && document.activeElement.dataset.focus === 'item:https://github.com/acme/factory/issues/48'`,
        "Enter on #48 to focus its card on You");
      assert(await visibleFocus(page), "#48's card has focus but no visible focus ring");
      assert(world.opened.length === 0, `Enter on #48 opened a tab: ${JSON.stringify(world.opened)}`);
      // Shift+Enter is still the direct GitHub action, and the app stays where it is.
      await paletteOpen(page);
      await find(page, '#48', '#48 Register the notes domain');
      await page.key('Enter', 'Shift');
      await waitFor(() => world.opened.length >= 1, '#48 opened on GitHub');
      assert(JSON.stringify(world.opened.map(o => `${o.method} ${o.url}`)) === JSON.stringify(['GET https://github.com/acme/factory/issues/48']),
        `opened: ${JSON.stringify(world.opened)}`);
      assert(await page.run(`location.hash`) === '#/you', 'Shift+Enter moved the app');
      // #46 is on You and in spec 40's graph: its card in the graph stays its place.
      await paletteOpen(page);
      await find(page, '#46', '#46 ');
      await page.key('Enter');
      await page.until(`location.hash === '#/specs/40' && document.activeElement.dataset.ticket === '46'`, 'Enter on #46 to its graph card');
      checkRequestLog(world);
      await page.close();
    });

    // Every key the app answers to, as the `?` list must name it: [keys, what they do].
    const SHORTCUTS = [/Ctrl K|⌘ K/, /\b1\b[^\n]*You/, /\b2\b[^\n]*Specs/, /\b3\b[^\n]*Agents/, /\?[^\n]*shortcuts/i, /Esc/, /↑ ↓|Up|Down/,
      /Enter[^\n]*go/i, /Shift Enter[^\n]*GitHub/i, /Alt Enter[^\n]*cop/i, /Backspace[^\n]*filter/i, /Tab/];

    await check('AP15 shortcuts: ? lists every shortcut, the number keys still work, and neither fires while typing', async () => {
      const world = ap7World();
      const page = await ap6Open(world);
      await page.until(`document.querySelectorAll('main .cards a.card').length >= 6`, 'the You page');
      await page.key('?');
      await page.until(`document.querySelector('dialog[open]') && /keyboard shortcuts/i.test(document.querySelector('dialog[open]').innerText)`, '? to list the shortcuts');
      const list = await page.run(`document.querySelector('dialog[open]').innerText`);
      for (const want of SHORTCUTS) assert(want.test(list), `the shortcut list misses ${want}: ${list.replace(/\s+/g, ' ')}`);
      assert((await palette(page)).inside, 'focus is not inside the shortcut list');
      // A number key while the list is open doesn't move the page behind it.
      await page.key('2');
      assert(await page.run(`location.hash`) === '#/you', 'a number key moved the page behind the shortcut list');
      await page.key('Escape');
      await page.until(`!document.querySelector('dialog[open]')`, 'Esc to close the list');
      for (const [key, hash] of [['2', '#/specs'], ['3', '#/agents'], ['1', '#/you']]) {
        await page.key(key);
        await page.until(`location.hash === '${hash}'`, `${key} to open ${hash}`);
      }
      // Typing ? or a digit in the palette's field types it: no list opens, and the page stays.
      await paletteOpen(page);
      await page.key('2');
      await page.key('?');
      const typed = await palette(page);
      assert(typed.value === '2?' && typed.typing, `typing in the palette gave ${JSON.stringify(typed.value)}`);
      assert(await page.run(`location.hash`) === '#/you', 'a digit typed in the palette moved the page');
      assert(await page.run(`document.querySelectorAll('dialog[open]').length`) === 1, 'a ? typed in the palette opened the shortcut list');
      // The palette offers the shortcut list too.
      await page.key('Backspace');
      await page.key('Backspace');
      await find(page, 'shortcuts', 'Show keyboard shortcuts');
      await page.key('Enter');
      await page.until(`/keyboard shortcuts/i.test(document.querySelector('dialog[open]')?.innerText || '')`, 'the list from the palette');
      await page.key('Escape');
      checkRequestLog(world);
      await page.close();
    });

    await check('AP15 keyboard: the palette and the shortcut list are used without a mouse, with visible focus that stays inside and comes back', async () => {
      const world = ap7World();
      const page = await ap6Open(world);
      await page.until(`document.querySelectorAll('main .cards a.card').length >= 6`, 'the You page');
      await page.until(`OW.data.feeds.specs.data?.specs`, 'the spec tickets');
      await page.key('Tab');
      await page.key('Tab');
      const before = await page.run(`document.activeElement.getAttribute('href')`);
      await paletteOpen(page);
      assert(await visibleFocus(page), "the palette's search field has focus but no visible focus ring");
      // Down and Up move the chosen result, which shows as chosen and is announced (aria-activedescendant).
      await page.type('notes');
      await page.until(`document.querySelectorAll('dialog[open] [role="option"]').length >= 3`, 'several results');
      const first = (await palette(page)).active;
      await page.key('ArrowDown');
      await page.key('ArrowDown');
      await page.key('ArrowUp');
      const chosen = await page.run(`(() => { const d = document.querySelector('dialog[open]'); const o = d.querySelector('[role="option"][aria-selected="true"]');
        const s = getComputedStyle(o); return { id: o.id, text: o.innerText.replace(/\\s+/g, ' ').trim(), second: o === d.querySelectorAll('[role="option"]')[1],
        announced: d.querySelector('input').getAttribute('aria-activedescendant') === o.id, marked: s.boxShadow !== 'none' || (s.outlineStyle !== 'none' && s.outlineWidth !== '0px') }; })()`);
      assert(chosen.second && chosen.text !== first, `Down, Down, Up did not choose the second result: ${chosen.text}`);
      assert(chosen.announced, "the chosen result is not the field's aria-activedescendant");
      assert(chosen.marked, 'the chosen result is not visibly marked');
      // Tab and Shift+Tab keep focus inside the open palette.
      for (const held of [[], ['Shift']]) {
        await page.key('Tab', ...held);
        assert((await palette(page)).inside, `${held.length ? 'Shift+Tab' : 'Tab'} took focus out of the open palette`);
      }
      // Esc gives focus back to where it was.
      await page.key('Escape');
      await page.until(`!document.querySelector('dialog[open]')`, 'Esc to close');
      assert(await page.run(`document.activeElement.getAttribute('href')`) === before, 'closing the palette did not give focus back');
      assert(await visibleFocus(page), 'focus came back without a visible focus ring');
      // The shortcut list: focus inside on a visible control, Tab stays inside, Esc gives focus back.
      await page.key('?');
      await page.until(`document.querySelector('dialog[open]')?.contains(document.activeElement)`, 'focus inside the shortcut list');
      assert(await visibleFocus(page), "the shortcut list's focused control has no visible focus ring");
      await page.key('Tab');
      assert((await palette(page)).inside, 'Tab took focus out of the shortcut list');
      await page.key('Escape');
      await page.until(`!document.querySelector('dialog[open]') && document.activeElement.getAttribute('href') === ${JSON.stringify(before)}`, 'focus back after the list');
      // A whole trip without a mouse: open, find, go, and land with visible focus on the ticket's card.
      await paletteOpen(page);
      await find(page, '43', '#43 Store the notes');
      await page.key('Enter');
      await page.until(`document.activeElement.dataset.ticket === '43'`, 'focus on ticket 43');
      assert(await visibleFocus(page), 'the ticket the palette went to has focus but no visible focus ring');
      // The palette opens on a phone too, inside the screen.
      await page.size(390, 844, true);
      await paletteOpen(page);
      const box = await page.run(`(() => { const r = document.querySelector('dialog[open]').getBoundingClientRect(); return [r.left, r.right, r.top]; })()`);
      assert(box[0] >= 0 && box[1] <= 390 && box[2] >= 0, `the palette is off a 390-pixel phone screen: ${JSON.stringify(box)}`);
      if (process.env.SHOTS) {
        await page.type('notes');
        await page.shot(join(process.env.SHOTS, 'palette-phone.png'), 390, 844, true);
      }
      await page.key('Escape');
      await page.size(null);
      if (process.env.SHOTS) {
        await paletteOpen(page);
        await page.type('notes');
        await page.shot(join(process.env.SHOTS, 'palette-laptop.png'), 1440, 900, false);
        await page.key('Escape');
        await page.key('?');
        await page.shot(join(process.env.SHOTS, 'shortcuts-laptop.png'), 1440, 900, false);
        await page.key('Escape');
      }
      checkRequestLog(world);
      await page.close();
    });
  } finally {
    await browser.close();
  }
  console.log(results.join('\n'));
  const failed = results.filter(line => line.startsWith('FAIL')).length;
  console.log(failed ? `${failed} of ${results.length} app checks failed` : `all ${results.length} app checks passed`);
  process.exit(failed ? 1 : 0);
}

await main();
