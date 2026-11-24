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
    '--disable-sync', '--no-sandbox', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
  'in-app browser': { inApp: true },
};
const IN_APP = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 LinkedInApp';
const PLAYERS = '.spec-play, .spec-video, .launch-play, .launch-video';
const EARS = `(() => {
  window.__pressed = false;
  window.__heard = [];
  addEventListener('click', e => { if (e.isTrusted && e.target.closest?.('${PLAYERS}')) window.__pressed = true; }, true);
  const listen = ({ target }) => {
    if (target instanceof HTMLMediaElement && !target.paused && !target.muted && target.volume > 0 && !window.__pressed)
      window.__heard.push(target.className + ' at ' + target.currentTime.toFixed(1) + 's');
  };
  for (const type of ['play', 'playing', 'volumechange', 'timeupdate']) document.addEventListener(type, listen, true);
})()`;
const SIZES = [[390, 844], [1280, 800]];

async function open(browser, origin, width, height, mode) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  const requests = [];
  browser.on(m => m.sessionId === sessionId && m.method === 'Network.requestWillBeSent' && requests.push(m.params.request.url));
  await send('Page.enable');
  await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: EARS });
  if (mode.inApp) {
    await send('Emulation.setUserAgentOverride', { userAgent: IN_APP });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
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
  const swipe = async (x, y) => send('Input.synthesizeScrollGesture',
    { x, y, yDistance: -120, gestureSourceType: 'touch', repeatCount: 2, repeatDelayMs: 150 });
  return { evaluate, click, swipe, shot, requests, close: () => browser.send('Target.closeTarget', { targetId }) };
}

const MOMENT = "document.querySelector('.moments .spec-moment')";
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
  let facts = await page.evaluate(FACTS);
  expect(facts.video && facts.poster, where, 'the moment shows no video with a poster');
  expect(facts.preload === 'none' && !facts.autoplay, where, 'the video is not lazy (preload must be none, no autoplay attribute)');
  expect(facts.muted, where, 'the video does not start muted');
  expect(facts.link, where, 'no plain link to the video');
  expect(!facts.sideways, where, 'the page scrolls sideways');
  expect(!loadedVideo(page), where, 'the video loads with the page, before the moment is near the viewport');
  expect(!facts.playing, where, 'the video plays before it is in view');

  await page.evaluate(`${MOMENT}.querySelector('video').scrollIntoView({ block: 'center' }), true`);
  facts = await until(page, f => f.playing, 2500);
  expect(!facts.playing, where, 'in view, the video plays before anyone presses play');
  if (name === 'in-app browser') {
    const at = await page.evaluate(`(() => { const r = ${MOMENT}.querySelector('video').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await page.swipe(at.x, at.y);
    await page.evaluate(`${MOMENT}.querySelector('video').scrollIntoView({ block: 'center' }), true`);
    facts = await until(page, f => f.playing, 1500);
    expect(!facts.playing, where, 'a finger scrolling over the video starts it');
  }
  await page.evaluate('scrollTo(0, 0), true');
  await page.evaluate(`${MOMENT}.querySelector('video').scrollIntoView({ block: 'center' }), true`);
  facts = await until(page, f => f.playing, 1500);
  expect(!facts.playing, where, 'scrolled away and back, the video starts by itself');
  expect(!loadedVideo(page), where, 'the video loads before anyone presses play');
  if (scripted) {
    await page.evaluate(`document.querySelector('.moments h2').scrollIntoView({ block: 'center' }), true`);
    const h2 = await page.evaluate(`(() => { const r = document.querySelector('.moments h2').getBoundingClientRect();
      return { x: r.left + 10, y: r.top + r.height / 2 }; })()`);
    await page.click(h2.x, h2.y);
    await page.evaluate(`['.spec-play', '.spec-video', '.launch-play'].forEach(s => document.querySelector(s).click()), true`);
    facts = await until(page, f => f.playing, 1500);
    const launch = await page.evaluate(`!document.querySelector('.launch-video').paused`);
    expect(!facts.playing && !launch, where, 'after an unrelated click, a scripted click on a player starts it');
    await page.evaluate(`${MOMENT}.querySelector('video').scrollIntoView({ block: 'center' }), true`);
  }
  const heard = await page.evaluate('window.__heard');
  expect(!heard?.length, where, `sound played before a press on a player: ${heard}`);
  expect(scripted ? facts.sound : true, where, 'no visible "Play with sound" control');
  if (scripted) expect(!facts.sideways, where, 'the page scrolls sideways with the moment in view');
  expect(facts.inside, where, 'the video, its control or its link sticks out of the moment\'s card');
  if (process.env.SHOTS && name === 'motion') await page.shot(join(process.env.SHOTS, `spec-moment-${width}.png`));
  if (!scripted) return;
  const at = await page.evaluate(`(() => { const r = ${MOMENT}.querySelector('.spec-play').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await page.click(at.x, at.y);
  facts = await until(page, f => f.playing && !f.muted, 5000);
  expect(facts.playing && !facts.muted, where, '"Play with sound" does not play the video with sound');
  let focused = false;
  for (let i = 0; i < 30 && !focused; i++) {
    focused = await page.evaluate(`document.activeElement === ${MOMENT}.querySelector('video')`);
    if (!focused) await new Promise(r => setTimeout(r, 100));
  }
  expect(focused, where, '"Play with sound" leaves focus on the button instead of the player');
  facts = await until(page, f => f.cues > 0, 3000);
  expect(facts.captions === 'showing' && facts.cues > 0, where, `captions are not showing (${facts.captions}, ${facts.cues} cues)`);
  await page.evaluate('scrollTo(0, 0), true');
  facts = await until(page, () => false, 800);
  expect(facts.playing && !facts.muted, where, 'once asked for, playback with sound is taken over by the scroll');
}

const LAUNCH = `(() => {
  const shown = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const video = document.querySelector('.launch-video');
  const play = document.querySelector('.launch-play');
  const frame = video?.closest('.launch-frame');
  const track = video && [...video.textTracks].find(t => t.kind === 'captions');
  const box = el => el.getBoundingClientRect();
  return {
    video: shown(video), poster: !!video?.getAttribute('poster'), preload: video?.getAttribute('preload'), autoplay: !!video?.autoplay,
    playing: !!video && !video.paused && !video.ended, muted: !!video?.muted, controls: !!video?.controls, focused: document.activeElement === video,
    play: shown(play) && play.textContent.trim() === 'Watch OpenWiz in two minutes',
    covers: shown(play) && Math.abs(box(play).width - box(frame).width) < 1 && Math.abs(box(play).height - box(frame).height) < 1,
    post: shown([...document.querySelectorAll('.launch a')].find(a => a.textContent.trim() === 'See the launch post')),
    cues: track ? (track.cues?.length || 0) : -1, sideways: document.documentElement.scrollWidth > innerWidth,
    above: !!video && video.compareDocumentPosition(document.querySelector('.agent-row')) === Node.DOCUMENT_POSITION_FOLLOWING
      && document.querySelector('.install-box').compareDocumentPosition(video) === Node.DOCUMENT_POSITION_FOLLOWING,
  };
})()`;
const loadedLaunch = page => page.requests.some(url => /\/art\/launch-video\.mp4(\?|$)/.test(url));

async function launchVideo(page, where, name) {
  const scripted = name !== 'no JavaScript';
  let facts = await page.evaluate(LAUNCH);
  expect(facts.video && facts.poster && facts.post, where, 'the launch video lost its poster or its launch post link');
  expect(facts.above, where, 'the launch video is not between the install box and the agents');
  expect(facts.preload === 'none' && !facts.autoplay && !facts.playing, where, 'the launch video is not opt-in');
  expect(scripted ? facts.play && facts.covers && !facts.controls : facts.controls && !facts.play, where,
    scripted ? 'no "Watch OpenWiz in two minutes" button over the poster' : 'without scripts the launch video has no native controls');
  await page.evaluate(`document.querySelector('.launch-video').scrollIntoView({ block: 'center' }), true`);
  await new Promise(resolve => setTimeout(resolve, 1500));
  facts = await page.evaluate(LAUNCH);
  expect(!loadedLaunch(page) && !facts.playing, where, 'the launch video loads or plays before it is pressed');
  expect(!facts.sideways, where, 'the page scrolls sideways at the launch video');
  if (!scripted) return;
  const at = await page.evaluate(`(() => { const r = document.querySelector('.launch-play').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await page.click(at.x, at.y);
  const start = Date.now();
  do {
    facts = await page.evaluate(LAUNCH);
    if (facts.playing && !facts.muted) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() - start < 8000);
  expect(facts.playing && !facts.muted && facts.controls && !facts.play, where, 'pressing play does not play the launch video with sound and controls');
  expect(facts.focused, where, 'pressing play leaves focus nowhere instead of on the player');
  expect(loadedLaunch(page), where, 'pressing play never loads the launch video');
  await page.evaluate(`[...document.querySelector('.launch-video').textTracks].find(t => t.kind === 'captions').mode = 'hidden', true`);
  const cued = Date.now();
  do {
    facts = await page.evaluate(LAUNCH);
    if (facts.cues > 0) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() - cued < 3000);
  expect(facts.cues > 20, where, `the launch video's captions do not load (${facts.cues} cues)`);
}

const VOICES = `(() => {
  const state = video => ({ playing: !video.paused && !video.ended, muted: video.muted, time: video.currentTime });
  return { launch: state(document.querySelector('.launch-video')), spec: state(document.querySelector('.spec-video')) };
})()`;
const voices = async (page, test, ms = 8000) => {
  const start = Date.now();
  for (;;) {
    const now = await page.evaluate(VOICES);
    if (test(now) || Date.now() - start > ms) return now;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};
const press = async (page, selector) => {
  const at = await page.evaluate(`(() => { const el = document.querySelector('${selector}'); el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await new Promise(resolve => setTimeout(resolve, 300));
  await page.click(at.x, at.y);
};
const audible = side => side.playing && !side.muted;
const keepsPlayhead = async (page, which, where, message) => {
  const paused = await page.evaluate(VOICES);
  await new Promise(resolve => setTimeout(resolve, 600));
  const later = await page.evaluate(VOICES);
  expect(!later[which].playing && later[which].time > 0 && Math.abs(later[which].time - paused[which].time) < 0.05, where, message);
};

async function oneVoice(page, where, name, first) {
  const [one, other] = first === 'launch' ? ['.launch-play', '.spec-play'] : ['.spec-play', '.launch-play'];
  const [a, b] = first === 'launch' ? ['launch', 'spec'] : ['spec', 'launch'];
  await press(page, one);
  let now = await voices(page, v => audible(v[a]) && v[a].time > 0.5);
  expect(audible(now[a]), where, `the ${a} video does not play with sound`);
  if (first === 'launch') {
    await page.evaluate(`document.querySelector('.spec-video').scrollIntoView({ block: 'center' }), true`);
    now = await voices(page, v => v.spec.playing, 1500);
    expect(!now.spec.playing && audible(now.launch), where, 'scrolling to the spec started it, or stopped the launch video');
  }
  await press(page, other);
  now = await voices(page, v => audible(v[b]) && !v[a].playing);
  expect(audible(now[b]), where, `switching to the ${b} video does not play it with sound`);
  expect(!now[a].playing, where, `starting the ${b} video with sound leaves the ${a} video talking`);
  await keepsPlayhead(page, a, where, `the paused ${a} video lost its playhead`);
}

async function main() {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await launch();
  try {
    for (const [width, height] of SIZES) {
      for (const [name, mode] of Object.entries(MODES)) {
        if (mode.inApp && width > 480) continue;
        const where = `${width}px, ${name}`;
        const page = await open(browser, origin, width, height, mode);
        try {
          await moment(page, where, name, width);
        } catch (error) {
          failures.push(`${where}: ${error.message}`);
        } finally {
          await page.close();
        }
        if (name === 'motion' || name === 'reduced') {
          for (const first of ['launch', 'spec']) {
            const page = await open(browser, origin, width, height, mode);
            try {
              await oneVoice(page, `${where}, ${first} first`, name, first);
            } catch (error) {
              failures.push(`${where}, ${first} first: ${error.message}`);
            } finally {
              await page.close();
            }
          }
        }
        const fresh = await open(browser, origin, width, height, mode);
        try {
          await launchVideo(fresh, where, name);
        } catch (error) {
          failures.push(`${where}: launch video: ${error.message}`);
        } finally {
          await fresh.close();
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
