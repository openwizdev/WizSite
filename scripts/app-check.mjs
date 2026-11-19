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
  const close = async () => {
    socket.close();
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  };
  return { send, on: listener => listeners.push(listener), close };
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
    this.graphql = {}; // operation name -> answer function (body) => {status, json, headers}
    this.rest = {}; // GitHub REST path -> answer function (url) => {status, json, headers}
    this.helper = {}; // helper path -> answer function (body) => {status, json} (may wait, to hold a response)
    this.done = []; // paths answered so far
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
      if (!reply) {
        await send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
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

const graphqlCount = world => world.log.filter(r => r.origin === API && r.path === '/graphql' && r.method === 'POST').length;
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
      const before = graphqlCount(world);
      assert(before === 2, `expected one read per feed before the back-off, saw ${before}`);
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
  } finally {
    await browser.close();
  }
  console.log(results.join('\n'));
  const failed = results.filter(line => line.startsWith('FAIL')).length;
  console.log(failed ? `${failed} of ${results.length} app checks failed` : `all ${results.length} app checks passed`);
  process.exit(failed ? 1 : 0);
}

await main();
