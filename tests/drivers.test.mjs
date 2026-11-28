import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { readDrivers, withDrivers, ordered, badge } from '../scripts/drivers.mjs';

const COPY_LINE = 'Write an OpenWiz driver for my host with the write-driver skill: https://github.com/openwizdev/WizSkills/tree/main/skills/write-driver';
const INSTALL_LINE = 'Install OpenWiz from github.com/openwizdev/OpenWiz';
const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

async function serve() {
  const server = createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (path.endsWith('/')) path += 'index.html';
    try {
      const body = await readFile(join(DIST, path));
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

function chromePath() {
  const found = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
    '/usr/bin/chromium-browser'].find(path => path && existsSync(path));
  assert.ok(found, 'no Chrome or Chromium found; set CHROME');
  return found;
}

async function launch() {
  const profile = await mkdtemp(join(tmpdir(), 'drivers-test-'));
  const child = spawn(chromePath(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--no-sandbox', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let log = '';
    child.stderr.on('data', chunk => {
      log += chunk;
      const match = log.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
    child.on('exit', code => reject(new Error(`browser exited (${code}): ${log.slice(-400)}`)));
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
    await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  return { send, listeners, close };
}

const aim = (selector, name) => `(async () => {
  const all = document.querySelectorAll(${JSON.stringify(selector)});
  if (all.length !== 1 || all[0].disabled) return null;
  const b = all[0];
  window.${name} = new Promise(resolve => new MutationObserver(() => resolve(b.textContent)).observe(b, { childList: true, characterData: true, subtree: true }));
  const frame = () => new Promise(resolve => setTimeout(resolve, 50));
  for (let tries = 0; tries < 50; tries += 1) {
    b.scrollIntoView({ block: 'center' });
    await frame();
    const r = b.getBoundingClientRect();
    const at = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    if (b.contains(document.elementFromPoint(at.x, at.y))) return at;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return null;
})()`;

test('the Write your own driver part shows the contract\'s copy line once, and Copy puts exactly the contract\'s copy line on the clipboard', async () => {
  assert.ok(existsSync(join(DIST, 'drivers/index.html')), 'run npm run build first');
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await launch();
  try {
    const { send, listeners } = browser;
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => send(method, params, sessionId);
    listeners.push(message => {
      if (message.sessionId !== sessionId || message.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = message.params;
      if (request.url.startsWith(origin + '/')) page('Fetch.continueRequest', { requestId }).catch(() => {});
      else page('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
    });
    await page('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await send('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
    await page('Emulation.setFocusEmulationEnabled', { enabled: true });
    await page('Runtime.enable');
    await page('Page.enable');
    const loaded = new Promise(resolve => listeners.push(m => m.sessionId === sessionId && m.method === 'Page.loadEventFired' && resolve()));
    await page('Page.navigate', { url: `${origin}/drivers/` });
    await loaded;
    const evaluate = async expression => (await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".own-driver .install-line")].map(e => e.innerText)'), [COPY_LINE]);
    const box = await evaluate(aim('.own-driver button.install', 'copied'));
    assert.ok(box, 'the Write your own driver part has one Copy button, enabled once site.js runs');
    for (const type of ['mousePressed', 'mouseReleased']) {
      await page('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
    assert.equal(await evaluate('Promise.race([window.copied, new Promise(r => setTimeout(() => r("no change"), 10000))])'), 'Copied');
    assert.equal(await evaluate('navigator.clipboard.readText()'), COPY_LINE);
    const start = await evaluate(aim('.start button.install', 'started'));
    assert.ok(start, 'the hero\'s Start one box has one Copy button, enabled once site.js runs');
    for (const type of ['mousePressed', 'mouseReleased']) {
      await page('Input.dispatchMouseEvent', { type, x: start.x, y: start.y, button: 'left', clickCount: 1 });
    }
    assert.equal(await evaluate('Promise.race([window.started, new Promise(r => setTimeout(() => r("no change"), 10000))])'), 'Copied');
    assert.equal(await evaluate('navigator.clipboard.readText()'), INSTALL_LINE);
  } finally {
    await browser.close();
    server.close();
  }
});

test('the key-host section says where a host key lives, who reads it, where it goes, and that the five checks have no exception', async () => {
  const html = await readFile(join(ROOT, 'drivers/index.html'), 'utf8');
  const text = s => s.replace(/<[^>]+>/g, ' ').replace(/&#39;|&rsquo;/g, '\'').replace(/\s+/g, ' ').trim();
  const sections = html.match(/<section class="[^"]*\bkey-hosts\b[^"]*"[\s\S]*?<\/section>/g) ?? [];
  assert.equal(sections.length, 1, 'the Drivers page has one key-host section');
  const section = sections[0];
  const facts = [...section.matchAll(/<li class="key-fact" data-fact="([^"]+)">([\s\S]*?)<\/li>/g)].map(([, key, body]) => [key, text(body)]);
  assert.deepEqual(facts.map(([key]) => key), ['lives', 'stored', 'helper', 'driver', 'checks'], 'the five facts, in order');
  const fact = Object.fromEntries(facts);
  assert.match(fact.lives, /only on your computer/, 'N4: the key lives only on the user\'s computer');
  assert.match(fact.lives, /system keychain/, 'N4: read from the user\'s system keychain');
  assert.match(fact.lives, /environment variable you set/, 'N4: or from the environment variable the user set');
  assert.match(fact.stored, /OpenWiz never stores it/, 'N4: OpenWiz never stores a key');
  assert.match(fact.stored, /revoke/, 'the fact says how the user revokes it');
  assert.match(fact.stored, /clear every place you put it/, 'one copy left behind still works: clear every copy');
  assert.match(fact.stored, /keychain entry/, 'a copy can sit in the keychain entry');
  assert.match(fact.stored, /environment variable/, 'a copy can sit in the environment variable');
  assert.match(fact.stored, /restart anything that inherited/, 'a running process keeps an inherited value until it restarts');
  assert.doesNotMatch(fact.stored, /remove it from there/, 'no single-copy removal advice');
  assert.match(fact.helper, /one small helper in the kernel's driver kit/, 'N4: one helper in the kit');
  assert.match(fact.helper, /only thing that reads/, 'N4: the helper alone reads the key');
  assert.match(fact.helper, /only over HTTPS to that host's own registered address/, 'N4: sent only over HTTPS to the host\'s registered address');
  assert.match(section, /href="https:\/\/github\.com\/openwizdev\/OpenWiz\/blob\/main\/kernel\/driver-kit\/hostkey\.py"/);
  assert.match(section, /href="https:\/\/github\.com\/openwizdev\/OpenWiz\/blob\/main\/kernel\/driver\.v1\.md#2-logins"/);
  assert.match(fact.driver, /driver never sees it/, 'N4: the driver never reads or receives the key');
  assert.match(fact.driver, /the kit checks that/, 'the token check runs the key check');
  assert.match(fact.checks, /same five checks/, 'driver v1 section 3: the same five checks, no sixth');
  assert.match(fact.checks, /can't wake or stop a run gets no driver/, 'wake and stop are two of the five checks');
  assert.doesNotMatch(text(section), /\bsix(th)?\b|\bexcept(ion)?\b|\bwaive/i, 'no extra or skipped check');
});

test('the directory renders one row per entry, hosts then harnesses, each in ladder order with its own badge and proof', async () => {
  const page = await readFile(join(ROOT, 'drivers/index.html'), 'utf8');
  const data = await readDrivers();
  const html = withDrivers(page, data);
  const rows = [...html.matchAll(/<li class="row[^"]*" id="([^"]+)" data-kind="([a-z]+)" data-state="([a-z]+)"[^>]*>([\s\S]*?)<\/li>/g)];
  const want = ordered(data.entries);
  assert.deepEqual(rows.map(([, id]) => id), want.map(entry => entry.id));
  for (const [[, id, kind, state, body], entry] of rows.map((row, i) => [row, want[i]])) {
    assert.deepEqual([kind, state], [entry.kind, entry.state], id);
    assert.match(body, new RegExp(`<p class="badge" data-state="${state}">${badge(state, data.release).replace('.', '\\.')}</p>`), id);
    const links = [...body.matchAll(/<a href="([^"]+)"/g)].map(([, href]) => href);
    assert.deepEqual(links, [entry.kit?.url, entry.evidence, entry.docs].filter(Boolean), `${id}: its links are its proof, nothing else`);
    if (entry.state !== 'shipped') assert.doesNotMatch(body, /Shipped|Kit run/, `${id} never reads as shipped`);
  }
  assert.equal(new Set(rows.map(([, id]) => id)).size, rows.length, 'no duplicate row ids');
  assert.throws(() => withDrivers(page.replace('<template data-slot="drivers-directory"></template>', ''), data), /exactly one directory slot/);
  const fake = { ...data, entries: [...data.entries, { id: 'fake', name: 'Fake <b>host</b>', kind: 'host', state: 'review', evidence: 'https://github.com/openwizdev/OpenWiz/pull/1' }] };
  assert.match(withDrivers(page, fake), /Fake &lt;b&gt;host&lt;\/b&gt;/, 'names are escaped');
});

async function openDrivers(browser, origin, { width = 390, height = 844, script = true, reduced = false } = {}) {
  const { send, listeners } = browser;
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  listeners.push(message => {
    if (message.sessionId !== sessionId || message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    if (request.url.startsWith(origin + '/')) page('Fetch.continueRequest', { requestId }).catch(() => {});
    else page('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
  });
  await page('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await page('Page.enable');
  await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 480 });
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
  if (!script) await page('Emulation.setScriptExecutionDisabled', { value: true });
  const loaded = new Promise(resolve => listeners.push(m => m.sessionId === sessionId && m.method === 'Page.loadEventFired' && resolve()));
  await page('Page.navigate', { url: `${origin}/drivers/` });
  await loaded;
  const evaluate = async expression => {
    const { result, exceptionDetails } = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(exceptionDetails, undefined, exceptionDetails?.exception?.description);
    return result.value;
  };
  const click = async selector => {
    const at = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await page('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
  };
  const type = async (selector, text) => {
    await click(selector);
    await page('Input.insertText', { text });
  };
  const visible = () => evaluate('[...document.querySelectorAll(".rows > .row")].filter(r => r.getClientRects().length).map(r => r.id)');
  return { evaluate, click, type, visible, close: () => send('Target.closeTarget', { targetId }) };
}

test('at 390 px the directory fits, reads in full without scripts, and filters by kind, state and name with site.js', async () => {
  assert.ok(existsSync(join(DIST, 'drivers/index.html')), 'run npm run build first');
  const data = await readDrivers();
  const all = ordered(data.entries).map(entry => entry.id);
  const of = filter => ordered(data.entries).filter(filter).map(entry => entry.id);
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await launch();
  try {
    const still = await openDrivers(browser, origin, { script: false });
    assert.deepEqual(await still.visible(), all, 'without scripts every row shows');
    assert.ok(await still.evaluate('document.scrollingElement.scrollWidth <= innerWidth'), 'no sideways scroll at 390 px without scripts');
    assert.deepEqual(await still.evaluate('[...document.querySelectorAll(".dir-states button")].filter(b => b.getClientRects().length).map(b => b.textContent.trim())'),
      ['Shipped in 0.01 5', 'Live-checked 1', 'Merged 15', 'In review 14', 'Planned 2', 'Held or parked 3'], 'the state counts read without scripts');
    await still.close();

    const live = await openDrivers(browser, origin);
    assert.ok(await live.evaluate('document.scrollingElement.scrollWidth <= innerWidth'), 'no sideways scroll at 390 px');
    assert.equal(await live.evaluate('[...document.querySelectorAll(".dir-tools input, .dir-tools button")].every(c => !c.disabled)'), true, 'site.js enables the controls');
    assert.deepEqual(await live.visible(), all);
    await live.click('.dir-kinds button[data-kind="harness"]');
    assert.deepEqual(await live.visible(), of(e => e.kind === 'harness'), 'Harnesses shows only harnesses');
    assert.equal(await live.evaluate('document.querySelector("#hosts").hidden'), true, 'an empty group hides with its rows');
    assert.equal(await live.evaluate('document.querySelector(".dir-showing").textContent'), `Showing ${of(e => e.kind === 'harness').length} of ${all.length}`);
    await live.click('.dir-kinds button[data-kind="all"]');
    await live.click('.dir-states button[data-states="live"]');
    assert.deepEqual(await live.visible(), of(e => e.state === 'live'), 'Live-checked shows only what passed live');
    await live.click('.dir-states button[data-states="shipped"]');
    assert.deepEqual(await live.visible(), of(e => ['live', 'shipped'].includes(e.state)), 'two states together show both');
    assert.equal(await live.evaluate('document.querySelector(".dir-states button[data-states=shipped]").getAttribute("aria-pressed")'), 'true');
    await live.click('.dir-states button[data-states="live"]');
    await live.click('.dir-states button[data-states="shipped"]');
    await live.type('.dir-search input', 'codex');
    assert.deepEqual(await live.visible(), ['codex'], 'search finds by name');
    await live.evaluate('(() => { const i = document.querySelector(".dir-search input"); i.value = ""; i.dispatchEvent(new Event("input")); })()');
    await live.type('.dir-search input', 'zzzz');
    assert.deepEqual(await live.visible(), []);
    assert.equal(await live.evaluate('!document.querySelector(".dir-none").hidden'), true, 'an empty result says so');
    await live.click('.dir-none button');
    assert.deepEqual(await live.visible(), all, 'Clear the filters shows every row again');
    const devin = await live.evaluate(`(() => { const rows = [...document.querySelectorAll('.row')].filter(r => /Devin/.test(r.textContent));
      return rows.map(r => ({ id: r.id, badge: r.querySelector('.badge').textContent, links: [...r.querySelectorAll('a')].map(a => [a.textContent, a.href]) })); })()`);
    const entry = data.entries.find(e => e.id === 'devin');
    assert.deepEqual(devin, [{ id: 'devin', badge: badge(entry.state, data.release), links: [['Pull request', entry.evidence], ['Docs', entry.docs]] }], 'exactly one Devin row, with its own state and proof');
    await live.close();

    const calm = await openDrivers(browser, origin, { reduced: true });
    assert.deepEqual(await calm.evaluate(`[...document.querySelectorAll('.dir-states button, .dir-kinds button, .row-links a, .voyage-ship, .voyage-glow')]
      .map(el => [getComputedStyle(el).transitionDuration, getComputedStyle(el).animationName]).filter(([t, a]) => t !== '0s' || a !== 'none')`), [],
      'with reduced motion nothing on the page moves');
    await calm.close();

    const wide = await openDrivers(browser, origin, { width: 1440, height: 1000 });
    assert.ok(await wide.evaluate('document.scrollingElement.scrollWidth <= innerWidth'), 'no sideways scroll at 1440 px');
    const columns = await wide.evaluate('[...document.querySelectorAll(".dir-group")].map(g => Math.round(g.getBoundingClientRect().top))');
    assert.equal(columns[0], columns[1], 'at 1440 px hosts and harnesses sit side by side');
    await wide.close();
  } finally {
    await browser.close();
    server.close();
  }
});
