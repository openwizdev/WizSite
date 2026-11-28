import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const ROOT = new URL('../', import.meta.url);
const DIST = new URL('dist/', ROOT);
const TEST_CHECKOUT = 'https://buy.polar.sh/polar_cl_bench_test';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const TYPES = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  mp4: 'video/mp4',
  vtt: 'text/vtt',
  txt: 'text/plain; charset=utf-8',
};

function chromePath() {
  const found = [
    process.env.CHROME,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find(p => p && existsSync(p));
  if (!found) throw new Error('no Chrome or Chromium found; set CHROME');
  return found;
}

async function startServer() {
  if (!existsSync(new URL('index.html', DIST))) {
    throw new Error('dist/ is missing; run npm run build first');
  }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      let file = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (file === '' || file.endsWith('/')) file += 'index.html';
      const target = new URL(file, DIST);
      if (!target.href.startsWith(DIST.href) || !existsSync(target)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      let body = await readFile(target);
      if (file === 'pro/index.html') {
        const html = body.toString('utf8');
        if (html.includes('data-checkout href="#checkout"')) {
          body = Buffer.from(html.replace('data-checkout href="#checkout"', `data-checkout href="${TEST_CHECKOUT}"`), 'utf8');
        }
      }
      const ext = file.split('.').pop();
      res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream' });
      res.end(body);
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String(error));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

async function launchBrowser() {
  const profile = await mkdtemp(join(tmpdir(), 'pay-bench-'));
  const child = spawn(chromePath(), [
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
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const wsUrl = await new Promise((resolve, reject) => {
    let text = '';
    child.stderr.on('data', chunk => {
      text += chunk;
      const match = text.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
    child.on('exit', code => reject(new Error(`browser exited (${code}): ${text.slice(-400)}`)));
  });

  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });

  let nextId = 0;
  const waiting = new Map();
  const listeners = new Set();
  socket.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      for (const listener of listeners) listener(msg);
    }
  };

  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  const close = async () => {
    socket.close();
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  };

  return { send, on: fn => { listeners.add(fn); return () => listeners.delete(fn); }, close };
}

async function openIphoneTab(browser) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  let popupOpened = false;
  const offTarget = browser.on(msg => {
    if (msg.method === 'Target.targetCreated' && msg.params.targetInfo?.openerId === targetId) {
      popupOpened = true;
    }
  });
  await browser.send('Target.setDiscoverTargets', { discover: true });
  await browser.send('Page.enable', {}, sessionId);
  await browser.send('Runtime.enable', {}, sessionId);
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  }, sessionId);
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
  await browser.send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' }, sessionId);
  await browser.send('Fetch.enable', {
    patterns: [{ urlPattern: 'https://buy.polar.sh/*', requestStage: 'Request' }],
  }, sessionId);

  let checkoutHit = null;
  let onCheckout = null;
  const offFetch = browser.on(async msg => {
    if (msg.method === 'Fetch.requestPaused' && msg.sessionId === sessionId) {
      const { requestId, request } = msg.params;
      if (request.url.startsWith('https://buy.polar.sh/')) {
        checkoutHit = { url: request.url, at: performance.now() };
        if (onCheckout) onCheckout(checkoutHit);
        await browser.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }],
          body: Buffer.from('<!doctype html><title>Polar Checkout</title><h1>Polar Checkout</h1>').toString('base64'),
        }, sessionId).catch(() => {});
      } else {
        await browser.send('Fetch.continueRequest', { requestId }, sessionId).catch(() => {});
      }
    }
  });

  const waitForLoad = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('timed out waiting for load')); }, 15000);
    const off = browser.on(msg => {
      if (msg.method === 'Page.loadEventFired' && msg.sessionId === sessionId) {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  });

  const waitForCheckout = () => new Promise((resolve, reject) => {
    if (checkoutHit) return resolve(checkoutHit);
    const timer = setTimeout(() => { onCheckout = null; reject(new Error('timed out waiting for Polar checkout navigation')); }, 15000);
    onCheckout = hit => {
      clearTimeout(timer);
      onCheckout = null;
      resolve(hit);
    };
  });

  const evalJson = async expression => {
    const { result, exceptionDetails } = await browser.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }, sessionId);
    if (exceptionDetails) throw new Error(exceptionDetails.text || 'Runtime.evaluate failed');
    return result.value;
  };

  const tap = async selector => {
    const box = await evalJson(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        width: r.width,
        height: r.height,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        href: el.getAttribute('href'),
      };
    })()`);
    if (!box || box.width === 0 || box.height === 0) {
      throw new Error(`tap target not visible: ${selector}`);
    }
    if (box.overflow) {
      throw new Error(`horizontal overflow at 390px before tapping ${selector}`);
    }
    const point = [{ x: Math.round(box.x), y: Math.round(box.y) }];
    await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point }, sessionId);
    await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);
    return box;
  };

  const navigate = async url => {
    const loaded = waitForLoad();
    await browser.send('Page.navigate', { url }, sessionId);
    await loaded;
  };

  const close = async () => {
    offFetch();
    offTarget();
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});
  };

  return {
    navigate,
    tap,
    waitForLoad,
    waitForCheckout,
    hasPopup: () => popupOpened,
    close,
  };
}

async function measureFromHome(browser, origin) {
  const tab = await openIphoneTab(browser);
  try {
    await tab.navigate(`${origin}/`);
    const t0 = performance.now();
    const proLoaded = tab.waitForLoad();
    await tab.tap('.landing-nav a.nav-pro');
    await proLoaded;
    const checkout = tab.waitForCheckout();
    await tab.tap('a[data-checkout]');
    const hit = await checkout;
    if (tab.hasPopup()) throw new Error('checkout opened a popup instead of same-tab navigation');
    return {
      engine: 'chromium',
      taps: 2,
      ms: Math.round(hit.at - t0),
      path: ['/', '/pro/', hit.url],
    };
  } finally {
    await tab.close();
  }
}

async function measureFromPro(browser, origin) {
  const tab = await openIphoneTab(browser);
  try {
    await tab.navigate(`${origin}/pro/`);
    const t0 = performance.now();
    const checkout = tab.waitForCheckout();
    await tab.tap('a[data-checkout]');
    const hit = await checkout;
    if (tab.hasPopup()) throw new Error('checkout opened a popup instead of same-tab navigation');
    return {
      engine: 'chromium',
      taps: 1,
      ms: Math.round(hit.at - t0),
      path: ['/pro/', hit.url],
    };
  } finally {
    await tab.close();
  }
}

const server = await startServer();
const browser = await launchBrowser();
try {
  const fromHome = await measureFromHome(browser, server.origin);
  const fromPro = await measureFromPro(browser, server.origin);
  const report = {
    ...fromHome,
    gap: 'WebKit unavailable in repo tooling (uses raw CDP over Chromium with zero browser dependencies)',
    fromPro,
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
