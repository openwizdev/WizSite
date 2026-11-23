import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const COPY_LINE = 'Write an OpenWiz driver for my host with the write-driver skill: https://github.com/openwizdev/WizSkills/tree/main/skills/write-driver';
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
    const box = await evaluate(`(() => { const all = document.querySelectorAll('.own-driver button.install');
      if (all.length !== 1 || all[0].disabled) return null; const b = all[0];
      window.copied = new Promise(resolve => new MutationObserver(() => resolve(b.textContent)).observe(b, { childList: true, characterData: true, subtree: true }));
      b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    assert.ok(box, 'the Write your own driver part has one Copy button, enabled once site.js runs');
    for (const type of ['mousePressed', 'mouseReleased']) {
      await page('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
    assert.equal(await evaluate('Promise.race([window.copied, new Promise(r => setTimeout(() => r("no change"), 5000))])'), 'Copied');
    assert.equal(await evaluate('navigator.clipboard.readText()'), COPY_LINE);
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

test('the rendered Drivers page shows Devin only as built, waiting on its live check', async () => {
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
    await page('Page.enable');
    const loaded = new Promise(resolve => listeners.push(m => m.sessionId === sessionId && m.method === 'Page.loadEventFired' && resolve()));
    await page('Page.navigate', { url: `${origin}/drivers/` });
    await loaded;
    const { result } = await page('Runtime.evaluate', { returnByValue: true, expression: `(() => {
      const norm = s => s.replace(/\\s+/g, ' ').trim();
      const tiles = document.querySelectorAll('#devin');
      if (tiles.length !== 1) return { tiles: tiles.length };
      const [tile] = tiles;
      const box = tile.getBoundingClientRect();
      const rest = document.documentElement.cloneNode(true);
      rest.querySelector('#devin').remove();
      const released = '[data-state="live"], [data-state="passed"], [data-state="shipped"], .passed, .shipped';
      return {
        tiles: tiles.length,
        visible: box.width > 0 && box.height > 0 && getComputedStyle(tile).visibility === 'visible',
        inWaitingGroup: tile.matches('li.tile') && Boolean(tile.closest('#hosts-waiting[data-state="waiting"]')),
        state: tile.dataset.state,
        status: [...tile.querySelectorAll('.tile-state')].map(e => norm(e.innerText)),
        shown: norm(tile.innerText),
        links: [...tile.querySelectorAll('a')].map(a => [norm(a.innerText), a.href]),
        markedReleased: Boolean(tile.closest(released) || tile.querySelector(released)),
        devinElsewhere: /devin/i.test(rest.outerHTML),
        comingSoon: /coming soon/i.test(tile.textContent),
      };
    })()` });
    assert.deepEqual(result.value, {
      tiles: 1,
      visible: true,
      inWaitingGroup: true,
      state: 'waiting',
      status: ['Built, waiting on its live check'],
      shown: 'Devin Built, waiting on its live check Login: held by Devin Pull request',
      links: [['Pull request', 'https://github.com/openwizdev/OpenWiz/pull/2490']],
      markedReleased: false,
      devinElsewhere: false,
      comingSoon: false,
    });
  } finally {
    await browser.close();
    server.close();
  }
});
