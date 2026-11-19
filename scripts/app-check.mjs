// The app's browser check (P2, P3): the built app in a real headless Chromium, against recorded GitHub answers.
//
// Every request the page makes is paused through the DevTools protocol and answered here: openwiz.dev from dist/
// (with the security headers _headers gives it), the sign-in helper and api.github.com from scripts/app-fixtures/.
// Anything else is refused and fails the check. The request log then has to show only GitHub and the helper, and
// no write. No npm dependency: Node's own WebSocket talks to the browser.
//
//   node scripts/app-check.mjs            (after npm run build; CHROME=/path/to/chrome to pick the browser)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
    await rm(profile, { recursive: true, force: true });
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
  }

  async answer(request) {
    const url = new URL(request.url);
    const entry = { method: request.method, url: request.url, origin: url.origin, path: url.pathname,
      headers: request.headers, body: request.postData || '' };
    this.log.push(entry);
    if (url.origin === SITE && url.pathname.startsWith('/api/sign-in/')) {
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

// ---- One page under test --------------------------------------------------------------------------------------

async function open(browser, world) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  browser.on(async message => {
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      const reply = await world.answer(request);
      if (!reply) {
        await send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
        return;
      }
      const body = reply.raw ?? Buffer.from(JSON.stringify(reply.json));
      const headers = { 'Content-Type': TYPES[reply.type || 'json'] || 'application/octet-stream', ...(reply.headers || {}) };
      if (request.url.startsWith(API)) headers['Access-Control-Allow-Origin'] = SITE;
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
    // Click the visible control (link or button) whose accessible text is exactly this.
    click: text => page.run(`(() => {
      const el = [...document.querySelectorAll('a, button')].find(e => e.offsetParent !== null && e.textContent.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(text)});
      if (!el) throw new Error('no visible control: ' + ${JSON.stringify(text)});
      el.click();
    })()`),
    close: () => browser.send('Target.closeTarget', { targetId }),
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

const graphqlCount = world => world.log.filter(r => r.origin === API && r.path === '/graphql').length;
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
      assert(r.method === 'GET' || (r.method === 'POST' && r.path === '/graphql'), `a write to GitHub: ${where}`);
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
      const asked = world.log.filter(r => r.origin === API);
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
      const nav = await page.run(`[...document.querySelectorAll('nav.main a')].map(a => a.textContent.replace(/\\s+/g, ' ').trim().split(' ')[0])`);
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
      assert(Math.abs(minutes(shown) - minutes(hhmm)) <= 1, `read time ${shown} is not the time of the read (${hhmm})`);
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
      const before = graphqlCount(world);
      await page.run(`(() => { const b = [...document.querySelectorAll('button')].find(b => /refresh/i.test(b.textContent)); if (b) b.click(); })()`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      assert(graphqlCount(world) === before, 'the app read GitHub again while backing off');
      checkRequestLog(world);
      await page.close();
    });

    await check('a refused request: anything but GitHub and the helper is blocked by the page itself', async () => {
      const world = new World();
      const page = await open(browser, world);
      await page.go(`${SITE}/app/`);
      await page.until(`document.readyState === 'complete'`, 'the page');
      await page.run(`fetch('https://example.com/collect').then(() => 'sent', () => 'blocked')`);
      assert(!world.log.some(r => r.url.startsWith('https://example.com')), 'the page could reach another server');
      assert(world.violations.some(text => /Content Security Policy/.test(text)), 'no Content Security Policy refused it');
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
