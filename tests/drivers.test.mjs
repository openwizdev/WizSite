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
