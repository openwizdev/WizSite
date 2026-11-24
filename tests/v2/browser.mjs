import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url);
const DIST = new URL('dist/', ROOT);
const FIXTURES = new URL('scripts/app-fixtures/', ROOT);
export const SITE = 'https://openwiz.dev';
export const API = 'https://api.github.com';
export const STATE = 'S'.repeat(43);
export const fixture = async name => JSON.parse(await readFile(new URL(name, FIXTURES), 'utf8'));

export function chromePath() {
  const found = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
    '/usr/bin/chromium-browser'].find(path => path && existsSync(path));
  if (!found) throw new Error('no Chrome or Chromium found; set CHROME');
  return found;
}

export async function launch() {
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
  const popups = new Map();
  const opened = new Map();
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

const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', json: 'application/json',
  webmanifest: 'application/manifest+json', svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon',
  woff2: 'font/woff2', txt: 'text/plain' };

async function siteHeaders(path) {
  const out = {};
  let match = false;
  for (const line of (await readFile(new URL('_headers', DIST), 'utf8')).split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (!line.startsWith(' ')) {
      const pattern = new RegExp(`^${line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
      match = pattern.test(path);
    } else if (match) {
      const trimmed = line.trim();
      if (trimmed.startsWith('!')) {
        const drop = trimmed.slice(1).trim().toLowerCase();
        for (const key of Object.keys(out)) if (key.toLowerCase() === drop) delete out[key];
      } else {
        const at = trimmed.indexOf(':');
        const name = trimmed.slice(0, at).trim();
        const value = trimmed.slice(at + 1).trim();
        const existing = Object.keys(out).find(k => k.toLowerCase() === name.toLowerCase());
        out[existing || name] = existing ? `${out[existing]}, ${value}` : value;
      }
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

export class World {
  constructor() {
    this.log = [];
    this.violations = [];
    this.github = {};
    this.recorded = {};
    this.graphql = {};
    this.site = {};
    this.opened = [];
  }

  async answer(request) {
    const url = new URL(request.url);
    const entry = { method: request.method, url: request.url, origin: url.origin, path: url.pathname,
      headers: request.headers, body: request.postData || '' };
    this.log.push(entry);
    if (url.origin === SITE && url.pathname.startsWith('/api/sign-in/')) {
      if (url.pathname === '/api/sign-in/token' && request.method === 'POST') return { status: 200, json: await fixture('token.json') };
      return { status: 404, json: { error: 'not_found' } };
    }
    if (url.origin === SITE && this.site[url.pathname]) return this.site[url.pathname](entry);
    if (url.origin === SITE) {
      const file = await staticFile(url.pathname);
      return { status: file.status, raw: file.body, type: file.type, headers: await siteHeaders(url.pathname) };
    }
    if (url.origin !== API) return null;
    if (request.method === 'OPTIONS') {
      return { status: 204, raw: Buffer.alloc(0), headers: { 'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Authorization, Accept, Content-Type' } };
    }
    const exact = this.recorded[`${request.method} ${url.pathname}${url.search}`];
    if (exact) return { status: exact.status, json: exact.json, headers: exact.next ? { Link: `<${API}/next>; rel="next"` } : {} };
    const route = this.github[`${request.method} ${url.pathname}`];
    if (route) return route(entry, url);
    if (request.method === 'GET' && url.pathname === '/user/installations') return { status: 200, json: await fixture('installations.json') };
    if (request.method === 'GET' && url.pathname === '/user/installations/1001/repositories') return { status: 200, json: await fixture('repositories.json') };
    if (request.method === 'POST' && url.pathname === '/graphql') {
      const name = (String(JSON.parse(entry.body || '{}').query).match(/^\s*query\s+(\w+)/) || [])[1];
      if (this.graphql[name]) return this.graphql[name](entry);
    }
    return { status: 404, json: { message: 'Not Found' } };
  }

  record(github) {
    Object.assign(this.recorded, github);
  }

  writes() {
    return this.log.filter(r => r.method !== 'GET' && r.method !== 'OPTIONS' && !(r.origin === API && r.path === '/graphql')
      && !(r.origin === SITE && r.path.startsWith('/api/sign-in/')));
  }
}

const LABEL = `const label = e => { const c = e.cloneNode(true); c.querySelectorAll('[aria-hidden="true"]').forEach(x => x.remove()); return c.textContent.replace(/\\s+/g, ' ').trim(); };`;

export async function open(browser, world) {
  const { browserContextId } = await browser.send('Target.createBrowserContext');
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  browser.on(async message => {
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      const reply = await world.answer(request);
      if (!reply || reply.abort) {
        await send('Fetch.failRequest', { requestId, errorReason: reply ? 'ConnectionFailed' : 'BlockedByClient' }).catch(() => {});
        return;
      }
      const body = reply.raw ?? Buffer.from(JSON.stringify(reply.json));
      const headers = { 'Content-Type': TYPES[reply.type || 'json'] || 'application/octet-stream', ...(reply.headers || {}) };
      if (request.url.startsWith(API)) {
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
    wheel: (x, y, deltaY) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY }),
    media: features => send('Emulation.setEmulatedMedia', { features }),
    async shot(path, width, height, mobile) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
      await new Promise(resolve => setTimeout(resolve, 400));
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(path, Buffer.from(data, 'base64'));
      await send('Emulation.clearDeviceMetricsOverride');
    },
    async key(key, ...held) {
      const codes = { Tab: ['Tab', 9], Enter: ['Enter', 13, '\r'], Escape: ['Escape', 27], ArrowDown: ['ArrowDown', 40], ArrowUp: ['ArrowUp', 38],
        Backspace: ['Backspace', 8], '?': ['Slash', 191, '?'] };
      const letter = /^[a-z]$/i.test(key) ? [`Key${key.toUpperCase()}`, key.toUpperCase().charCodeAt(0), key] : null;
      const [code, vk, typed] = codes[key] || letter || [`Digit${key}`, key.charCodeAt(0), key];
      const modifiers = held.reduce((m, name) => m | { Alt: 1, Ctrl: 2, Meta: 4, Shift: 8 }[name], 0);
      const text = typed && !(modifiers & 7) ? typed : undefined;
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers, ...(text ? { text } : {}) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
    },
    type: text => send('Input.insertText', { text }),
    clipboard: () => page.run('navigator.clipboard.readText()'),
    click: text => page.run(`(() => {
      ${LABEL}
      const el = [...document.querySelectorAll('a, button')].find(e => e.offsetParent !== null && label(e) === ${JSON.stringify(text)});
      if (!el) throw new Error('no visible control: ' + ${JSON.stringify(text)});
      el.click();
    })()`),
    async tap(text) {
      const box = await page.run(`(() => {
        ${LABEL}
        const el = [...document.querySelectorAll('a, button')].find(e => e.offsetParent !== null && label(e) === ${JSON.stringify(text)});
        if (!el) throw new Error('no visible control: ' + ${JSON.stringify(text)});
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`);
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    },
    close: async () => {
      await browser.send('Target.closeTarget', { targetId });
      await browser.send('Target.disposeBrowserContext', { browserContextId });
    },
  };
  return page;
}

export async function signIn(page) {
  await page.go(`${SITE}/app/?code=c0de&state=${STATE}`);
  await page.until(`document.body.innerText.includes('acme/factory')`, 'the repository picker');
}

export async function start(world = new World()) {
  if (!existsSync(new URL('app/index.html', DIST))) throw new Error('no dist/app: run npm run build first');
  const browser = await launch();
  const page = await open(browser, world);
  return { browser, page, world, close: async () => { await page.close().catch(() => {}); await browser.close(); } };
}
