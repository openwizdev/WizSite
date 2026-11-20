// The Models page (MD6, #1808), proof P6: the page reads fleet.md and the offered-models snapshot as the models
// contract (openwiz.models.v1) pins them, and its Change button hands over exactly the contract's line.
//
// Two seams. The page's reader runs in Node on the contract's own fixtures (tests/models-fixtures/). Then the built
// app runs in a real headless Chromium against recorded GitHub answers: sign in, pick the repository, open Models,
// press Change, pick a choice and read the clipboard. Every request is answered here; anything else fails the test.
//
//   npm run build && node --test tests/models-page.test.mjs     (CHROME=/path/to/chrome picks the browser)
//   SHOTS=dir node --test tests/models-page.test.mjs            also saves the page on a laptop and a phone
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const DIST = new URL('dist/', ROOT);
const FIX = new URL('models-fixtures/', import.meta.url);
const APP_FIX = new URL('scripts/app-fixtures/', ROOT);
const SITE = 'https://openwiz.dev';
const API = 'https://api.github.com';
const text = async (url) => readFile(url, 'utf8');
const json = async (url) => JSON.parse(await text(url));
const CASES = ['one-table', 'five-tables', 'both', 'overridden', 'same-family'];
const ROLE_KEYS = ['orchestrator', 'builder', 'reviewer', 'small_builder', 'fixer'];

// ---- The reader, in Node ----------------------------------------------------------------------------------------

// The page script as the app loads it, with only what it needs from the rest of the app.
async function loadModels() {
  const file = new URL('app/pages/models.js', ROOT);
  assert.ok(existsSync(file), 'the app has no Models page script (app/pages/models.js)');
  const source = await text(file);
  const pages = [];
  const OW = { page: page => pages.push(page), ui: { h: () => null, icon: () => null, time: String } };
  vm.runInNewContext(source, { window: { OW }, OW, console });
  assert.ok(OW.models, 'app/pages/models.js gives no OW.models reader');
  assert.equal(pages.length, 1, 'app/pages/models.js registers no page');
  return OW.models;
}

describe('the Models page reader', () => {
  let models;
  before(async () => { models = await loadModels(); });

  // catches: a role read from the wrong row or table, a follow rule applied wrongly, the older tables' Reviewer or
  // Fixer taken from the wrong family, a stale older table winning over the Models table, or an older table left out
  // of step with the Models table read silently (its older_table_kept warning missing or worded otherwise).
  for (const name of CASES) {
    test(`${name}: every role reads as the contract's show fixture says`, async () => {
      const show = await json(new URL(`${name}/show.json`, FIX));
      const read = models.read(await text(new URL(`${name}/fleet.md`, FIX)));
      assert.equal(read.form, show.read);
      assert.deepEqual(JSON.parse(JSON.stringify(read.roles)), show.roles);
      assert.deepEqual([...read.warnings], show.warnings.map(w => w.text));
    });
  }

  // catches: a broken Models table guessed at (so the page shows a model no reader would start), or a fall back to
  // the older tables past a broken Models table.
  test('a broken Models table is refused, never guessed', async () => {
    const good = await text(new URL('one-table/fleet.md', FIX));
    const breaks = [
      ['| Reviewer | Codex', '| Reviewers | Codex'],
      ['| Builder | Claude Code | Opus 5.5 | Medium | `--provider claude-code --model claude-opus-5-5 --reasoning-level medium` |', '| Builder | follows Builder | | | |'],
      ['--reasoning-level medium` |\n| Reviewer', '--effort medium` |\n| Reviewer'],
      ['| Small builder | follows Builder | | | |\n| Fixer', '| Fixer | follows Builder | | | |\n| Small builder'],
      ['`room-cli thread spawn` flags |', 'flags |'],
      ['--model claude-opus-5-5 --reasoning-level medium` |\n| Reviewer', '--model vendor//demo --reasoning-level medium` |\n| Reviewer'],
      ['## Loop', '## Models'],
    ];
    for (const [from, to] of breaks) {
      assert.ok(good.includes(from), from);
      assert.throws(() => models.read(good.replace(from, to)), models.Refused, `taken: ${to}`);
    }
    const older = await text(new URL('five-tables/fleet.md', FIX));
    assert.throws(() => models.read(older.replace('## Reviewer for GPT-built', '## Reviewer for others')), models.Refused);
    assert.throws(() => models.read('# Fleet settings\n'), models.Refused);
  });

  // catches: a hand-off line that differs from the contract's by a word, a name or a flag, so the agent runs
  // something else or nothing.
  test('every hand-off line is exactly the contract\'s', async () => {
    const { lines } = await json(new URL('handoff.json', FIX));
    for (const { role, to, line } of lines) assert.equal(models.line(role, to), line);
  });

  // catches: a choice the snapshot never offered, or one `set` can't write, offered as a Change; a recommendation
  // shown when it isn't offered.
  test('the picker offers only the snapshot\'s settable choices, the recommended ones marked', async () => {
    const snapshot = await json(new URL('models-offered.json', FIX));
    const read = JSON.parse(JSON.stringify(models.offered(JSON.stringify(snapshot))));
    const ids = c => `${c.provider} ${c.model} ${c.effort}`;
    const listed = snapshot.harnesses.flatMap(h => h.models.flatMap(m => m.efforts.map(e => `${h.provider} ${m.model} ${e}`)));
    assert.deepEqual(read.choices.map(ids), listed);
    assert.deepEqual(read.choices.filter(c => !c.settable).map(ids), ['codex syn-vendor/demo:latest medium']);
    assert.equal(read.readAt, snapshot.read_at);
    const marked = role => read.choices.filter(c => c.recommended.includes(role)).map(ids);
    assert.deepEqual(marked('builder'), ['claude-code claude-opus-5-5 medium']);
    assert.deepEqual(marked('reviewer'), ['codex gpt-6.2-sol medium']);
    snapshot.recommended.reviewer.offered = false;
    assert.equal(models.offered(JSON.stringify(snapshot)).choices.filter(c => c.recommended.includes('reviewer')).length, 0);
    for (const broken of ['{', '{"schema": "openwiz.models-offered.v1"}', JSON.stringify({ ...snapshot, state: { kind: 'no_options' } })]) {
      assert.throws(() => models.offered(broken), models.Refused);
    }
  });

  // catches (review R3): a snapshot that breaks its pinned schema (openwiz.models-offered.v1) still supplying
  // choices: a harness without its name, a model with no effort, an unknown key, a broken recommendation.
  test('a snapshot that breaks its schema is refused whole, never offered', async () => {
    const good = await json(new URL('models-offered.json', FIX));
    const broken = [
      s => { delete s.harnesses[0].harness; },
      s => { s.harnesses[0].models[1].efforts = []; },
      s => { s.harnesses[0].models[0].efforts.push(''); },
      s => { s.harnesses[1].provider = ''; },
      s => { s.harnesses[0].extra = true; },
      s => { s.extra = true; },
      s => { delete s.unavailable; },
      s => { s.unavailable[0].reason = 'gone'; },
      s => { s.label = 'from somewhere'; },
      s => { s.read_at = -1; },
      s => { s.read_at = 1.5; },
      s => { delete s.recommended.orchestrator; },
      s => { s.recommended.builder.offered = 'yes'; },
      s => { delete s.recommended.builder.choice.names; },
      s => { s.recommended.reviewer.choice.model = 'vendor//demo'; },
      s => { s.recommended.reviewer.choice.family = 'other'; },
      s => { s.recommended.reviewer.source = ''; },
      s => { s.recommended.fixer = s.recommended.builder; },
      s => { s.state = { kind: 'offered', reason: 'not_ready' }; },
      s => { s.harnesses = {}; },
    ];
    assert.doesNotThrow(() => models.offered(JSON.stringify(good)));
    for (const [i, breakIt] of broken.entries()) {
      const copy = structuredClone(good);
      breakIt(copy);
      assert.throws(() => models.offered(JSON.stringify(copy)), models.Refused, `case ${i} taken: ${breakIt}`);
    }
    const none = { ...structuredClone(good), state: { kind: 'no_options', reason: 'read_failed', text: 'CloudRoom did not answer.' } };
    assert.throws(() => models.offered(JSON.stringify(none)), models.Refused);
    const nullChoice = structuredClone(good);
    nullChoice.recommended.orchestrator = { choice: null, source: 'no fleet.md read', offered: false };
    assert.doesNotThrow(() => models.offered(JSON.stringify(nullChoice)));
  });
});

// ---- The page, in a real browser ----------------------------------------------------------------------------------

function chromePath() {
  const found = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
    '/usr/bin/chromium-browser'].find(path => path && existsSync(path));
  assert.ok(found, 'no Chrome or Chromium found; set CHROME');
  return found;
}

async function launch() {
  const profile = await mkdtemp(join(tmpdir(), 'models-page-'));
  const child = spawn(chromePath(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--no-sandbox', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let out = '';
    child.stderr.on('data', chunk => {
      out += chunk;
      const match = out.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
    child.on('exit', code => reject(new Error(`browser exited (${code}): ${out.slice(-400)}`)));
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
    } else if (message.method) listeners.forEach(listener => listener(message));
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

const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', json: 'application/json',
  webmanifest: 'application/manifest+json', svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon', woff2: 'font/woff2' };
const blob = value => (value === null ? null : { text: value });

// GitHub as the app sees it: the sign-in, the picker's lists, and each feed's GraphQL read. `files` is what
// HEAD:docs/agents/<name> holds for the Models read (null: no such file); `modelsStatus` other than 200 fails it;
// `forbidden` names the fields GitHub refuses.
class World {
  constructor({ fleet, offered, modelsStatus = 200, forbidden = [] }) {
    Object.assign(this, { fleet, offered, modelsStatus, forbidden, log: [], problems: [] });
  }

  async answer(request) {
    const url = new URL(request.url);
    this.log.push({ method: request.method, url: request.url, body: request.postData || '' });
    if (url.origin === SITE && url.pathname === '/api/sign-in/token' && request.method === 'POST') {
      return { status: 200, json: await json(new URL('token.json', APP_FIX)) };
    }
    if (url.origin === SITE && !url.pathname.startsWith('/api/')) {
      let file = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (file === '' || file.endsWith('/')) file += 'index.html';
      const target = new URL(file, DIST);
      if (!target.href.startsWith(DIST.href) || !existsSync(target)) return { status: 404, raw: Buffer.from('not found'), type: 'html' };
      return { status: 200, raw: await readFile(target), type: file.split('.').pop() };
    }
    if (url.origin !== API) return null;
    if (request.method === 'OPTIONS') {
      return { status: 204, raw: Buffer.alloc(0), headers: { 'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Authorization, Accept, Content-Type' } };
    }
    if (request.method === 'GET' && url.pathname === '/user/installations') return { status: 200, json: await json(new URL('installations.json', APP_FIX)) };
    if (request.method === 'GET' && url.pathname === '/user/installations/1001/repositories') return { status: 200, json: await json(new URL('repositories.json', APP_FIX)) };
    if (request.method === 'POST' && url.pathname === '/graphql') {
      const query = String(JSON.parse(request.postData || '{}').query);
      const rateLimit = { limit: 5000, remaining: 4800, resetAt: '2099-01-01T00:00:00Z' };
      if (/^\s*query\s+Models\b/.test(query)) {
        if (this.modelsStatus !== 200) return { status: this.modelsStatus, json: { message: 'Server Error' } };
        // A field GitHub refuses (an App without contents access) comes back null, with a FORBIDDEN error at its path.
        const repository = { fleet: blob(this.fleet), offered: blob(this.offered) };
        const errors = this.forbidden.map(field => {
          repository[field] = null;
          return { type: 'FORBIDDEN', path: ['repository', field], message: 'Resource not accessible by integration' };
        });
        return { status: 200, json: { data: { rateLimit, repository }, ...(errors.length ? { errors } : {}) } };
      }
      return { status: 200, json: { data: { rateLimit, repository: { issues: { totalCount: 0, nodes: [] },
        specIssues: { totalCount: 0, nodes: [] }, youIssues: { totalCount: 0, nodes: [] }, fleet: null } } } };
    }
    return { status: 404, json: { message: 'Not Found' } };
  }
}

async function open(browser, world) {
  const { browserContextId } = await browser.send('Target.createBrowserContext');
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  browser.on(async message => {
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      const reply = await world.answer(request);
      if (!reply) {
        world.problems.push(`refused ${request.method} ${request.url}`);
        await send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
        return;
      }
      const headers = { 'Content-Type': TYPES[reply.type || 'json'] || 'application/octet-stream', ...(reply.headers || {}) };
      if (request.url.startsWith(API)) {
        headers['Access-Control-Allow-Origin'] = SITE;
        headers['Access-Control-Expose-Headers'] = 'Link, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After';
      }
      await send('Fetch.fulfillRequest', { requestId, responseCode: reply.status,
        responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })),
        body: Buffer.from(reply.raw ?? JSON.stringify(reply.json)).toString('base64') }).catch(() => {});
    }
    if (message.method === 'Runtime.exceptionThrown') {
      world.problems.push(`exception: ${message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text}`);
    }
  });
  await browser.send('Browser.grantPermissions', { origin: SITE, browserContextId, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Runtime.enable');
  await send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
  const page = {
    go: url => send('Page.navigate', { url }),
    async run(expression) {
      const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (exceptionDetails) throw new Error(`page error: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
      return result.value;
    },
    text: () => page.run('document.querySelector("main") ? document.querySelector("main").innerText : document.body.innerText'),
    async until(expression, what, ms = 8000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await page.run(`(() => { try { return !!(${expression}); } catch { return false; } })()`)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.fail(`timed out waiting for ${what}; page text: ${(await page.text()).slice(0, 800)}`);
    },
    // Click the visible button or link inside `scope` (a CSS selector) whose text is exactly this.
    click: (label, scope = 'body') => page.run(`(() => {
      const el = [...document.querySelector(${JSON.stringify(scope)}).querySelectorAll('a, button')]
        .find(e => e.offsetParent !== null && e.textContent.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(label)});
      if (!el) throw new Error('no visible control: ' + ${JSON.stringify(label)});
      el.click();
    })()`),
    clipboard: () => page.run('navigator.clipboard.readText()'),
    async shot(path, width, height, mobile) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
      await new Promise(resolve => setTimeout(resolve, 400));
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(path, Buffer.from(data, 'base64'));
      await send('Emulation.clearDeviceMetricsOverride');
    },
    close: async () => {
      await browser.send('Target.closeTarget', { targetId });
      await browser.send('Target.disposeBrowserContext', { browserContextId });
    },
  };
  return page;
}

// Signed in, acme/factory picked, on the Models page with its read done.
async function modelsPage(browser, world) {
  const page = await open(browser, world);
  await page.go(`${SITE}/app/?code=c0de&state=${'S'.repeat(43)}`);
  await page.until(`document.body.innerText.includes('acme/factory')`, 'the repository picker');
  await page.click('acme/factory');
  await page.until(`[...document.querySelectorAll('nav.main a')].some(a => a.getAttribute('href') === '#/models')`, 'a Models page in the navigation');
  await page.run(`location.hash = '#/models'`);
  await page.until(`document.querySelector('main h1').textContent === 'Models' && !document.querySelector('main .page-body').innerText.includes('Reading GitHub')`, 'the Models page read');
  return page;
}

// The app never writes: only the site and GitHub, only reads, no GraphQL mutation; nothing thrown in the page.
function readOnly(world) {
  for (const r of world.log) {
    const { origin, pathname } = new URL(r.url);
    assert.ok(origin === SITE || origin === API, `outside the site and GitHub: ${r.url}`);
    if (origin === API) {
      assert.ok(['GET', 'OPTIONS'].includes(r.method) || (r.method === 'POST' && pathname === '/graphql'), `a write to GitHub: ${r.method} ${r.url}`);
      if (r.method === 'POST') assert.ok(!/\bmutation\b/i.test(JSON.parse(r.body).query), 'a GraphQL mutation');
    }
  }
  assert.deepEqual(world.problems, []);
}

// A role's card text, by its heading.
const card = (page, role) => page.run(`(() => { const c = [...document.querySelectorAll('.models .card')]
  .find(c => c.querySelector('h3')?.textContent === ${JSON.stringify(role)}); return c ? c.innerText.replace(/\\s+/g, ' ') : null; })()`);

describe('the Models page in the app', () => {
  let browser;
  let offered;
  before(async () => {
    assert.ok(existsSync(new URL('app/index.html', DIST)), 'dist/ is missing: run npm run build first');
    browser = await launch();
    offered = await text(new URL('models-offered.json', FIX));
  });
  after(async () => { await browser?.close(); });

  // catches: the page not reading fleet.md's Models table, a role left out, or what a following role follows
  // not shown.
  test('one table: each role with its harness, model and effort, and what the small builder and fixer follow', async () => {
    const world = new World({ fleet: await text(new URL('one-table/fleet.md', FIX)), offered });
    const page = await modelsPage(browser, world);
    assert.match(await card(page, 'Orchestrator'), /Opus 5\.5 Medium on Claude Code/);
    assert.match(await card(page, 'Builder'), /Opus 5\.5 Medium on Claude Code/);
    assert.match(await card(page, 'Reviewer'), /Sol 6\.2 Medium on Codex/);
    assert.match(await card(page, 'Small builder'), /Follows the Builder: Opus 5\.5 Medium on Claude Code/);
    assert.match(await card(page, 'Fixer'), /Follows the Builder: Opus 5\.5 Medium on Claude Code/);
    readOnly(world);
    await page.close();
  });

  // catches: a project still on the older five tables shown as empty or wrong, or its reviewer taken from the
  // wrong family's table.
  test('five tables: each role read from the older tables, the orchestrator following the builder', async () => {
    const fleet = (await text(new URL('five-tables/fleet.md', FIX)))
      .replace('| Model | Sol 6.2 | `--model gpt-6.2-sol` |', '| Model | Sol 6.1 | `--model gpt-6.1-sol` |');
    const world = new World({ fleet, offered });
    const page = await modelsPage(browser, world);
    assert.match(await card(page, 'Orchestrator'), /Follows the Builder: Opus 5\.5 Medium on Claude Code/);
    assert.match(await card(page, 'Reviewer'), /Sol 6\.1 Medium on Codex/);
    assert.match(await card(page, 'Small builder'), /Opus 5\.5 Medium on Claude Code/);
    assert.match(await card(page, 'Fixer'), /Opus 5\.5 Medium on Claude Code/);
    readOnly(world);
    await page.close();
  });

  // catches: Change offering a model the snapshot doesn't list (or one set can't write), no read time or
  // recommendation shown, or a copied line that isn't the contract's.
  test('Change: the snapshot\'s choices only, recommended marked, read time shown; a pick shows and copies the exact line', async () => {
    const world = new World({ fleet: await text(new URL('one-table/fleet.md', FIX)), offered });
    const page = await modelsPage(browser, world);
    await page.click('Change', '.models .card.builder');
    const picker = () => page.run(`[...document.querySelectorAll('.models .card.builder .picker li')].map(li => li.innerText.replace(/\\s+/g, ' ').trim())`);
    const choices = await picker();
    assert.deepEqual(choices.map(c => c.replace(/ (Recommended|Can't be set from here)$/, '')), [
      'Opus 5.5 Low on Claude Code', 'Opus 5.5 Medium on Claude Code', 'Opus 5.5 High on Claude Code', 'Opus 5.5 Xhigh on Claude Code',
      'Opus 5.5 Max on Claude Code', 'Sonnet 5.5 Low on Claude Code', 'Sonnet 5.5 Medium on Claude Code', 'Sonnet 5.5 High on Claude Code',
      'Sol 6.2 Low on Codex', 'Sol 6.2 Medium on Codex', 'Sol 6.2 High on Codex', 'Sol 6.2 Xhigh on Codex',
      'vendor/demo Medium on Codex', 'vendor/demo High on Codex', 'syn-vendor/demo:latest Medium on Codex']);
    assert.deepEqual(choices.filter(c => c.endsWith('Recommended')), ['Opus 5.5 Medium on Claude Code Recommended']);
    assert.deepEqual(choices.filter(c => c.endsWith('Can\'t be set from here')), ['syn-vendor/demo:latest Medium on Codex Can\'t be set from here']);
    assert.equal(await page.run(`document.querySelectorAll('.models .card.builder .picker li:last-child button').length`), 0);
    const at = await page.run('OW.ui.time(1700000600000)');
    assert.ok((await card(page, 'Builder')).includes(`Offered by your harnesses at ${at}`), 'no read time');
    await page.click('Sonnet 5.5 High on Claude Code', '.models .card.builder .picker');
    const line = 'Set the builder to Sonnet 5.5 High on Claude Code: run `openwiz models set builder claude-code claude-sonnet-5-5 high` and commit the change.';
    await page.until(`document.querySelector('.models .card.builder .handoff')?.innerText.includes(${JSON.stringify(line)})`, 'the line shown');
    assert.equal(await page.clipboard(), line);
    await page.click('Change', '.models .card.fixer');
    await page.click('Follow the Builder', '.models .card.fixer .picker');
    await page.until(`document.querySelector('.models .card.fixer .handoff')`, 'the fixer line');
    assert.equal(await page.clipboard(), 'Set the fixer to follow the builder: run `openwiz models set fixer follows-builder` and commit the change.');
    if (process.env.SHOTS) {
      await page.click('Change', '.models .card.builder');
      await page.click('Sonnet 5.5 High on Claude Code', '.models .card.builder .picker');
      await page.shot(join(process.env.SHOTS, 'models-laptop.png'), 1440, 1960, false);
      await page.shot(join(process.env.SHOTS, 'models-phone.png'), 390, 2000, true);
    }
    readOnly(world);
    await page.close();
  });

  // catches: an older table that fleets still start from, left out of step with the Models table, not shown on the
  // page (the planner's ruling: the mismatch is never silent).
  test('both forms: an older table kept out of step is named on the page', async () => {
    const world = new World({ fleet: await text(new URL('both/fleet.md', FIX)), offered });
    const page = await modelsPage(browser, world);
    const { warnings } = await json(new URL('both/show.json', FIX));
    const shown = await page.run(`[...document.querySelectorAll('.models .notice')].map(n => n.innerText.replace(/\\s+/g, ' ').trim())`);
    for (const w of warnings) assert.ok(shown.includes(w.text), `not shown: ${w.text}`);
    readOnly(world);
    await page.close();
  });

  // catches (review R1): GitHub refusing the file reads (an App without contents access, as on a private repository)
  // shown as a missing fleet.md with setup advice, or a refused snapshot shown as "none yet".
  test('a refused file read is a failed read, never a missing file, and offers no choice', async () => {
    const fleet = await text(new URL('one-table/fleet.md', FIX));
    let world = new World({ fleet, offered, forbidden: ['fleet', 'offered'] });
    let page = await modelsPage(browser, world);
    let body = await page.text();
    assert.match(body, /GitHub refused to read docs\/agents\/fleet\.md/);
    assert.doesNotMatch(body, /has no docs\/agents\/fleet\.md|setup skill/);
    assert.equal(await page.run(`document.querySelectorAll('.models .card').length`), 0);
    await page.close();

    world = new World({ fleet, offered, forbidden: ['offered'] });
    page = await modelsPage(browser, world);
    body = await page.text();
    assert.match(body, /GitHub refused to read docs\/agents\/models-offered\.json/);
    assert.doesNotMatch(body, /No list of offered models yet/);
    await page.click('Change', '.models .card.builder');
    assert.equal(await page.run(`document.querySelectorAll('.models .picker li button').length`), 0);
    readOnly(world);
    await page.close();
  });

  // catches (review R2): after a failed refresh the old read's choices stay selectable, or a hand-off copied from a
  // snapshot that a newer read no longer has stays shown as the line to paste.
  test('a failed refresh offers no choice and drops the old hand-off; so does a refresh that finds no snapshot', async () => {
    const fleet = await text(new URL('one-table/fleet.md', FIX));
    for (const after of [{ modelsStatus: 502 }, { offered: null }]) {
      const world = new World({ fleet, offered });
      const page = await modelsPage(browser, world);
      await page.click('Change', '.models .card.builder');
      await page.click('Sonnet 5.5 High on Claude Code', '.models .card.builder .picker');
      await page.until(`document.querySelector('.models .card.builder .handoff')`, 'the line shown');
      Object.assign(world, after);
      const before = await page.run('OW.data.feeds.models.failedAt || OW.data.feeds.models.readAt');
      await page.run(`OW.data.refreshAll()`);
      await page.until(`(OW.data.feeds.models.failedAt || OW.data.feeds.models.readAt) !== ${before} && !OW.data.feeds.models.busy`, 'the refresh');
      assert.equal(await page.run(`document.querySelectorAll('.models .handoff').length`), 0, `old hand-off kept after ${JSON.stringify(after)}`);
      if (!(await page.run(`document.querySelector('.models .card.builder .picker')`))) await page.click('Change', '.models .card.builder');
      assert.equal(await page.run(`document.querySelectorAll('.models .picker li button').length`), 0, `choices offered after ${JSON.stringify(after)}`);
      assert.match(await page.text(), after.modelsStatus ? /Refresh now/ : /openwiz models list --save/);
      await page.close();
    }
  });

  // catches (review R4): a clipboard write that finishes after the user left the page redrawing the Models cards
  // into another page's body.
  test('a copy that finishes after leaving the page never draws Models into another page', async () => {
    const world = new World({ fleet: await text(new URL('one-table/fleet.md', FIX)), offered });
    const page = await modelsPage(browser, world);
    await page.run(`(() => { navigator.clipboard.writeText = () => new Promise(resolve => { window.releaseCopy = resolve; }); })()`);
    await page.click('Change', '.models .card.builder');
    await page.click('Sonnet 5.5 High on Claude Code', '.models .card.builder .picker');
    await page.until('window.releaseCopy', 'the copy started');
    await page.run(`location.hash = '#/agents'`);
    await page.until(`document.querySelector('main h1').textContent === 'Agents'`, 'the Agents page');
    await page.run('window.releaseCopy()');
    await page.run('new Promise(resolve => setTimeout(resolve, 300))');
    assert.equal(await page.run(`document.querySelector('main h1').textContent`), 'Agents');
    assert.equal(await page.run(`document.querySelectorAll('main .models, main .card.builder').length`), 0);
    await page.close();
  });

  // catches: a project with no snapshot shown made-up choices, or left without a way to make one.
  test('no snapshot: the page says how to make one and offers no choice', async () => {
    const world = new World({ fleet: await text(new URL('one-table/fleet.md', FIX)), offered: null });
    const page = await modelsPage(browser, world);
    assert.match(await page.text(), /openwiz models list --save/);
    await page.click('Change', '.models .card.builder');
    assert.equal(await page.run(`document.querySelectorAll('.models .card.builder .picker li').length`), 0);
    assert.match(await card(page, 'Builder'), /openwiz models list --save/);
    readOnly(world);
    await page.close();
  });

  // catches: an unreadable snapshot or fleet.md shown as choices or roles, a failed read shown as empty.
  test('an unreadable snapshot, a broken fleet.md or a failed read: the page says what to do and offers no choice', async () => {
    const fleet = await text(new URL('one-table/fleet.md', FIX));
    let world = new World({ fleet, offered: '{"schema": "openwiz.models-offered.v1"' });
    let page = await modelsPage(browser, world);
    assert.match(await page.text(), /couldn't be read[\s\S]*openwiz models list --save/);
    await page.click('Change', '.models .card.reviewer');
    assert.equal(await page.run(`document.querySelectorAll('.models .picker li').length`), 0);
    await page.close();

    world = new World({ fleet: fleet.replace('| Reviewer | Codex', '| Reviewers | Codex'), offered });
    page = await modelsPage(browser, world);
    assert.match(await page.text(), /docs\/agents\/fleet\.md[\s\S]*openwiz models show/);
    assert.equal(await page.run(`document.querySelectorAll('.models .card, .models .picker li').length`), 0);
    await page.close();

    world = new World({ fleet, offered, modelsStatus: 502 });
    page = await modelsPage(browser, world);
    assert.match(await page.text(), /Unknown/);
    assert.equal(await page.run(`document.querySelectorAll('.models .card').length`), 0);
    readOnly(world);
    await page.close();
  });
});
