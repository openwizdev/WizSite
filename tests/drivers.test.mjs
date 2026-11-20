// #1932 (WD4): the Drivers page's Write your own driver part shows the write-driver contract's copy line, and its Copy
// button copies exactly that line. Run after `npm run build`: node --test tests/drivers.test.mjs
// (CHROME=/path/to/chrome picks the browser). The browser reaches only this test's own server: every other request,
// GitHub's included, is refused before it leaves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

// Byte for byte the `copy_line` of contracts/write-driver.v1.md (openwizdev/OpenWiz, openwiz.write-driver.v1).
const COPY_LINE = 'Write an OpenWiz driver for my host with the write-driver skill: https://github.com/openwizdev/WizSkills/tree/main/skills/write-driver';
const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" };
const text = html => html.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39|apos);/g, (_, name) => entities[name]);

function ownPart(html) {
  const parts = html.match(/<section class="own-driver[^"]*"[\s\S]*?<\/section>/g) ?? [];
  assert.equal(parts.length, 1, 'one Write your own driver part');
  return parts[0];
}

test('the Write your own driver part shows exactly the contract\'s copy line, once, with a live Copy button', async () => {
  const own = ownPart(await readFile(join(ROOT, 'drivers/index.html'), 'utf8'));
  const lines = [...own.matchAll(/<code class="install-line">([\s\S]*?)<\/code>/g)].map(m => text(m[1]));
  assert.deepEqual(lines, [COPY_LINE]);
  assert.match(own, /<div class="install-box" data-install="live">/, 'the box is live, so site.js enables its Copy');
  assert.equal((own.match(/<button class="btn install" type="button"[^>]*>/g) ?? []).length, 1, 'one Copy button');
});

// ---- The browser, against the built site ---------------------------------------------------------------------

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
    await rm(profile, { recursive: true, force: true });
  };
  return { send, listeners, close };
}

test('Copy on the Drivers page puts exactly the contract\'s copy line on the clipboard', async () => {
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
    const button = 'document.querySelector(".own-driver button.install")';
    const box = await evaluate(`(() => { const b = ${button}; if (!b || b.disabled) return null;
      b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    assert.ok(box, 'the Write your own driver part has an enabled Copy button once site.js runs');
    for (const type of ['mousePressed', 'mouseReleased']) {
      await page('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
    let label;
    for (let i = 0; i < 50 && label !== 'Copied'; i++) {
      label = await evaluate(`${button}.textContent`);
      if (label !== 'Copied') await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(label, 'Copied');
    assert.equal(await evaluate('navigator.clipboard.readText()'), COPY_LINE);
  } finally {
    await browser.close();
    server.close();
  }
});
