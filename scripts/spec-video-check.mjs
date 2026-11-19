// The "Watch your spec" moment's browser check (#1405): the built landing in a real headless Chromium, on a phone and
// a laptop, with motion, with reduced motion, with GSAP blocked and with no JavaScript at all.
//
// The spec video must not load with the page; in view it plays muted (with motion) or waits on its poster (reduced
// motion), and a "Play with sound" control plays it with sound on request; its captions load; with no script the poster
// and a plain link to the video show. No sideways scroll on a phone. dist/ is served on 127.0.0.1; every other host is
// blocked. No npm dependency: Node's own WebSocket talks to the browser.
//
//   node scripts/spec-video-check.mjs            (after npm run build; CHROME=/path/to/chrome to pick the browser)
//   SHOTS=dir node scripts/spec-video-check.mjs  also saves the moment on a phone and a laptop as PNGs, for review
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.webm': 'video/webm', '.mp4': 'video/mp4',
  '.vtt': 'text/vtt; charset=utf-8', '.woff2': 'font/woff2' };
const VIDEO = /\/art\/[^/?]+\.(webm|mp4)(\?|$)/;

function serve() {
  const server = createServer(async (request, response) => {
    let path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname));
    if (path.endsWith('/')) path += 'index.html';
    try {
      const data = await readFile(join(DIST, path));
      response.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
      response.end(data);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function chromePath() {
  const found = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
    '/usr/bin/chromium-browser'].find(path => path && existsSync(path));
  if (!found) throw new Error('no Chrome or Chromium found; set CHROME');
  return found;
}

async function launch() {
  const profile = await mkdtemp(join(tmpdir(), 'spec-video-check-'));
  const child = spawn(chromePath(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--no-sandbox', '--hide-scrollbars', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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

const MODES = {
  motion: {},
  reduced: { reduced: true },
  'no GSAP': { block: ['*gsap*'] },
  'no JavaScript': { noScript: true },
};
const SIZES = [[390, 844], [1280, 800]];

async function open(browser, origin, width, height, mode) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  const requests = [];
  browser.on(m => m.sessionId === sessionId && m.method === 'Network.requestWillBeSent' && requests.push(m.params.request.url));
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*api.github.com*', ...(mode.block || [])] });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 480 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: mode.reduced ? 'reduce' : 'no-preference' }] });
  if (mode.noScript) await send('Emulation.setScriptExecutionDisabled', { value: true });
  const loaded = new Promise(resolve => browser.on(m => m.sessionId === sessionId && m.method === 'Page.loadEventFired' && resolve()));
  await send('Page.navigate', { url: `${origin}/` });
  await loaded;
  const evaluate = async expression => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  await evaluate('document.fonts.ready.then(() => true)');
  const click = async (x, y) => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
  };
  const shot = async path => {
    const { data } = await send('Page.captureScreenshot', { format: 'png',
      clip: await evaluate(`(() => { const r = ${MOMENT}.getBoundingClientRect();
        return { x: 0, y: r.top + scrollY - 16, width: ${width}, height: r.height + 32, scale: 1 }; })()`) });
    await writeFile(path, Buffer.from(data, 'base64'));
  };
  return { evaluate, click, shot, requests, close: () => browser.send('Target.closeTarget', { targetId }) };
}

// The moment's state, read inside the page.
// The moment is the one of the three whose heading is "Watch your spec".
const MOMENT = "[...document.querySelectorAll('.moments li')].find(li => li.querySelector('h3')?.textContent === 'Watch your spec')";
const FACTS = `(() => {
  const moment = ${MOMENT};
  const shown = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const video = moment?.querySelector('video');
  const sound = moment?.querySelector('.spec-play');
  const link = [...moment?.querySelectorAll('a[href]') || []].find(a => /\\.(webm|mp4)$/.test(a.getAttribute('href')));
  const track = video && [...video.textTracks].find(t => t.kind === 'captions');
  return {
    video: shown(video), poster: !!video?.getAttribute('poster'), playing: !!video && !video.paused && !video.ended,
    muted: !!video?.muted, autoplay: !!video?.autoplay, preload: video?.getAttribute('preload'),
    sound: shown(sound) && /sound/i.test(sound.textContent + (sound.getAttribute('aria-label') || '')),
    link: shown(link), cues: track ? (track.cues?.length || 0) : -1, captions: track ? track.mode : 'none',
    sideways: document.documentElement.scrollWidth > innerWidth,
    inside: !moment || [...moment.querySelectorAll('video, .spec-play, a')].filter(shown).every(el => {
      const r = el.getBoundingClientRect(), m = moment.getBoundingClientRect();
      return r.left >= m.left - 0.5 && r.right <= m.right + 0.5;
    }),
  };
})()`;
// Polled from Node: with no JavaScript the page's own timers never run.
const until = async (page, test, ms = 5000) => {
  const start = Date.now();
  for (;;) {
    const facts = await page.evaluate(FACTS);
    if (test(facts) || Date.now() - start > ms) return facts;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};
const loadedVideo = page => page.requests.some(url => VIDEO.test(url));

const failures = [];
let passed = 0;
function expect(ok, where, message) {
  if (ok) passed += 1;
  else failures.push(`${where}: ${message}`);
}

async function moment(page, where, name, width) {
  const scripted = name !== 'no JavaScript';
  const ambient = name === 'motion' || name === 'no GSAP';
  let facts = await page.evaluate(FACTS);
  expect(facts.video && facts.poster, where, 'the moment shows no video with a poster');
  expect(facts.preload === 'none' && !facts.autoplay, where, 'the video is not lazy (preload must be none, no autoplay attribute)');
  expect(facts.link, where, 'no plain link to the video');
  expect(!facts.sideways, where, 'the page scrolls sideways');
  expect(!loadedVideo(page), where, 'the video loads with the page, before the moment is near the viewport');
  expect(!facts.playing, where, 'the video plays before it is in view');

  await page.evaluate(`${MOMENT}.querySelector('video').scrollIntoView({ block: 'center' }), true`);
  facts = await until(page, ambient ? f => f.playing : () => false, ambient ? 5000 : 1500);
  if (ambient) {
    expect(facts.playing && facts.muted, where, 'in view, the video does not play muted inline');
    expect(loadedVideo(page), where, 'in view, the video never loads');
  } else {
    expect(!facts.playing, where, `with ${name}, the video plays without being asked`);
  }
  expect(scripted ? facts.sound : true, where, 'no visible "Play with sound" control');
  if (scripted) expect(!facts.sideways, where, 'the page scrolls sideways with the moment in view');
  expect(facts.inside, where, 'the video, its control or its link sticks out of the moment\'s card');
  if (process.env.SHOTS && name === 'motion') await page.shot(join(process.env.SHOTS, `spec-moment-${width}.png`));

  if (ambient) {
    await page.evaluate('scrollTo(0, 0), true');
    facts = await until(page, f => !f.playing, 3000);
    expect(!facts.playing, where, 'out of view, the muted video keeps playing');
    await page.evaluate(`${MOMENT}.querySelector('video').scrollIntoView({ block: 'center' }), true`);
    facts = await until(page, f => f.playing, 5000);
    expect(facts.playing && facts.muted, where, 'back in view, the video does not resume muted');
  }
  if (!scripted) return;
  const at = await page.evaluate(`(() => { const r = ${MOMENT}.querySelector('.spec-play').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await page.click(at.x, at.y);
  facts = await until(page, f => f.playing && !f.muted, 5000);
  expect(facts.playing && !facts.muted, where, '"Play with sound" does not play the video with sound');
  facts = await until(page, f => f.cues > 0, 3000);
  expect(facts.captions === 'showing' && facts.cues > 0, where, `captions are not showing (${facts.captions}, ${facts.cues} cues)`);
  await page.evaluate('scrollTo(0, 0), true');
  facts = await until(page, () => false, 800);
  expect(facts.playing && !facts.muted, where, 'once asked for, playback with sound is taken over by the scroll');
}

async function main() {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await launch();
  try {
    for (const [width, height] of SIZES) {
      for (const [name, mode] of Object.entries(MODES)) {
        const where = `${width}px, ${name}`;
        const page = await open(browser, origin, width, height, mode);
        try {
          await moment(page, where, name, width);
        } catch (error) {
          failures.push(`${where}: ${error.message}`);
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  for (const failure of failures) console.log(`FAIL ${failure}`);
  console.log(`spec video check: ${passed} passed, ${failures.length} failed`);
  process.exitCode = failures.length ? 1 : 0;
}

await main();
