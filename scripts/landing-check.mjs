// The landing page's browser check (#1355): the built landing in a real headless Chromium, at phone, tablet and
// laptop widths, with motion, with reduced motion, with GSAP blocked and with no JavaScript at all.
//
// It covers what the static checks can't see: no sideways scroll, the three moments filling their rows (#1354),
// Pause motion clear of the app window (#1351), the footer Wizes in one row on phones (#1352), the spec sample
// playable on request with reduced motion on or GSAP blocked (#1349), and the hero window showing each part only
// from its step onward, with tickets that look like tickets (the owner's fix 1). dist/ is served on 127.0.0.1;
// every other host is blocked. No npm dependency: Node's own WebSocket talks to the browser.
//
//   node scripts/landing-check.mjs            (after npm run build; CHROME=/path/to/chrome to pick the browser)
//   SHOTS=dir node scripts/landing-check.mjs  also saves the landing on a phone and a laptop as PNGs, for review
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.webm': 'video/webm', '.woff2': 'font/woff2' };

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
  const profile = await mkdtemp(join(tmpdir(), 'landing-check-'));
  const child = spawn(chromePath(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--no-sandbox', '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
const WIDTHS = [[320, 640], [390, 844], [800, 1000], [1280, 800]];

async function open(browser, origin, width, height, mode, path = '/') {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  await send('Page.enable');
  await send('Network.enable');
  // Only the local copy of dist/; the star count's GitHub request and anything else stay offline.
  await send('Network.setBlockedURLs', { urls: ['*api.github.com*', ...(mode.block || [])] });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 480 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: mode.reduced ? 'reduce' : 'no-preference' }] });
  if (mode.noScript) await send('Emulation.setScriptExecutionDisabled', { value: true });
  const loaded = new Promise(resolve => browser.on(m => m.sessionId === sessionId && m.method === 'Page.loadEventFired' && resolve()));
  await send('Page.navigate', { url: `${origin}${path}` });
  await loaded;
  // With scripts disabled, evaluation still works through the protocol (it is the page's scripts that stop).
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
  const shot = async (path) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
      clip: await evaluate(`({ x: 0, y: 0, width: ${width}, height: document.documentElement.scrollHeight, scale: 1 })`) });
    await writeFile(path, Buffer.from(data, 'base64'));
  };
  return { send, evaluate, click, shot, close: () => browser.send('Target.closeTarget', { targetId }) };
}

// Shared page helpers, evaluated inside the page.
const HELPERS = `
  const shown = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const still = el => ['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(getComputedStyle(el).transform);
  const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top + scrollY, bottom: r.bottom + scrollY }; };
`;

const failures = [];
let passed = 0;
function expect(ok, where, message) {
  if (ok) passed += 1;
  else failures.push(`${where}: ${message}`);
}

async function layout(page, where, width, mode) {
  const facts = await page.evaluate(`(() => { ${HELPERS}
    const list = document.querySelector('.moments ol');
    const items = [...list.children].map(box);
    const rows = [...new Set(items.map(i => Math.round(i.top)))].map(top => items.filter(i => Math.round(i.top) === top));
    const pause = document.querySelector('.demo-pause');
    const play = document.querySelector('.spec-play');
    const wizes = [...document.querySelectorAll('.family-wiz')].filter(shown).map(box);
    const tickets = [...document.querySelectorAll('.product-window .ember-ticket')].filter(shown);
    return {
      scroll: document.scrollingElement.scrollWidth, inner: innerWidth,
      list: box(list), rows,
      pause: shown(pause) ? box(pause) : null, window: box(document.querySelector('.product-window')),
      play: shown(play) ? box(play) : null,
      wizTops: [...new Set(wizes.map(w => Math.round(w.top)))],
      ticketsHeading: shown(document.querySelector('.window-tickets h3')) ? document.querySelector('.window-tickets h3').textContent.trim() : '',
      tickets: tickets.map(t => ({ number: t.querySelector('.ticket-number')?.textContent.trim() || '',
        chip: shown(t.querySelector('.ticket-chip')) ? t.querySelector('.ticket-chip').textContent.trim() : '',
        builder: shown(t.querySelector('.ticket-builder')) })),
      spec: shown(document.querySelector('.window-spec .spec-summary')),
    };
  })()`);
  expect(facts.scroll <= facts.inner, where, `sideways scroll (${facts.scroll}px content in a ${facts.inner}px window)`);
  // #1354: every row of moments spans the whole list, so no moment sits beside an empty cell.
  for (const row of facts.rows) {
    const left = Math.min(...row.map(i => i.left));
    const right = Math.max(...row.map(i => i.right));
    expect(left - facts.list.left < 2 && facts.list.right - right < 2, where,
      `a row of ${row.length} moment(s) leaves an empty cell (${Math.round(left)}–${Math.round(right)} of ${Math.round(facts.list.left)}–${Math.round(facts.list.right)})`);
  }
  // #1352: on a phone the footer Wizes peek in one row.
  if (width <= 480) expect(facts.wizTops.length === 1, where, `footer Wizes in ${facts.wizTops.length} rows`);
  // #1351: Pause motion never covers the app window.
  if (mode === 'motion') {
    expect(!!facts.pause, where, 'no Pause motion control with motion on');
    const { pause: p, window: w } = facts;
    if (p) expect(p.top >= w.bottom || p.bottom <= w.top || p.left >= w.right || p.right <= w.left, where,
      `Pause motion (${Math.round(p.top)}–${Math.round(p.bottom)}) covers the app window (ends at ${Math.round(w.bottom)})`);
  }
  // #1349: whenever the page's script runs, the silent spec sample can be played on request.
  if (mode !== 'no JavaScript') expect(!!facts.play, where, 'the spec sample has no play button');
  // The still (and the motion start, before it steps) shows a complete page; the still's tickets look like tickets.
  if (mode === 'reduced' || mode === 'no JavaScript' || mode === 'no GSAP') {
    expect(facts.spec, where, 'the still shows no spec');
    expect(facts.ticketsHeading === 'Tickets', where, 'the still has no "Tickets" heading');
    expect(facts.tickets.length === 3 && facts.tickets.every(t => /^#\d+$/.test(t.number) && t.chip), where,
      'the still\'s tickets lack a number like #12 or a status chip');
    expect(facts.tickets.some(t => t.chip === 'Building' && t.builder), where, 'no builder Wiz on the ticket being built');
  }
  return facts;
}

async function playable(page, where) {
  const play = await page.evaluate(`(() => { const r = document.querySelector('.spec-play')?.getBoundingClientRect();
    return r && r.width ? (scrollTo(0, r.top + scrollY - innerHeight / 2), true) : false; })()`);
  if (!play) return;
  const at = await page.evaluate(`(() => { const r = document.querySelector('.spec-play').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await page.click(at.x, at.y);
  const started = await page.evaluate(`new Promise(resolve => {
    const video = document.querySelector('.spec-video');
    const done = () => resolve(!video.hidden && !video.paused);
    if (!video.paused) return done();
    video.addEventListener('playing', done, { once: true });
    setTimeout(done, 4000);
  })`);
  expect(started, where, 'the spec sample does not play on request');
}

// The owner's fix 1: in the hero window nothing downstream exists before its step.
async function sequence(page, where) {
  const seen = await page.evaluate(`new Promise(resolve => { ${HELPERS}
    const seen = {};
    const started = Date.now();
    const look = () => {
      const label = document.querySelector('.demo-status').textContent.trim();
      const tickets = [...document.querySelectorAll('.product-window .ember-ticket')].filter(shown);
      const building = tickets.filter(t => /Building/.test(t.querySelector('.ticket-chip')?.textContent || ''));
      const state = { spec: shown(document.querySelector('.window-spec .spec-summary')),
        tickets: tickets.length, heading: shown(document.querySelector('.window-tickets h3')),
        builder: building.length === 0 || building.every(t => shown(t.querySelector('.ticket-builder'))) };
      const all = seen[label] ||= { spec: [], tickets: [], heading: [], builder: [] };
      for (const key of Object.keys(state)) if (!all[key].includes(state[key])) all[key].push(state[key]);
      if (Object.keys(seen).length >= 5 && Date.now() - started > 20000 || Date.now() - started > 30000) resolve(seen);
      else setTimeout(look, 120);
    };
    look();
  })`);
  const step = label => seen[label] || { spec: [], tickets: [], heading: [], builder: [] };
  const questions = step('Answering a few questions');
  const spec = step('Writing the spec');
  expect(Object.keys(seen).length >= 5, where, `the hero shows ${Object.keys(seen).length} of its 5 steps`);
  expect(questions.spec.length === 1 && questions.spec[0] === false, where, 'the spec is shown while answering questions');
  expect(questions.tickets.length === 1 && questions.tickets[0] === 0, where, 'tickets are shown while answering questions');
  expect(spec.spec.length === 1 && spec.spec[0] === true, where, 'the spec is missing at the spec step');
  expect(spec.tickets.length === 1 && spec.tickets[0] === 0, where, 'tickets are shown before the spec is done');
  for (const label of ['Agents building the to-do app', 'Reviewing the changes', 'Merged · to-do app shipped']) {
    const later = step(label);
    expect(later.spec.every(Boolean) && later.tickets.every(n => n === 3) && later.heading.every(Boolean), where,
      `"${label}" lacks the spec, the "Tickets" heading or its three tickets`);
    expect(later.builder.every(Boolean), where, `"${label}": a ticket being built has no builder Wiz`);
  }
}

// The owner's fix 2: a click (or Enter) on a footer Wiz gets a reaction and a tiny line that then fades; with
// reduced motion it is a still pose change only. At rest no line shows.
async function family(page, where, mode) {
  // Wait until the footer stops moving (the spec sample's metadata can resize the page above it).
  await page.evaluate(`new Promise(resolve => { let last; const tick = () => {
    const wiz = document.querySelectorAll('.family-wiz')[5]; wiz.scrollIntoView({ block: 'end' });
    const now = JSON.stringify(wiz.getBoundingClientRect()); if (now === last) return resolve(); last = now; setTimeout(tick, 300); };
    tick(); })`);
  const at = await page.evaluate(`(() => { const wiz = document.querySelectorAll('.family-wiz')[5];
    wiz.scrollIntoView({ block: 'end' }); const r = wiz.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: Math.min(r.top + r.height * .45, innerHeight - 4), rest: !!document.querySelector('.wiz-line') }; })()`);
  expect(!at.rest, where, 'a Wiz line shows at rest');
  // Watches one Wiz for 1.4 s: its line, whether it moved, its picture and its accessible name.
  const watch = `(wiz) => new Promise(resolve => { ${HELPERS}
    const before = { src: wiz.querySelector('img').getAttribute('src'), name: wiz.getAttribute('aria-label') };
    const seen = { line: '', moved: false, swapped: false, renamed: false };
    const started = Date.now();
    const look = () => {
      const line = wiz.querySelector('.wiz-line');
      if (shown(line) && getComputedStyle(line).opacity > .5) seen.line ||= line.textContent.trim();
      if (!still(wiz) || shown(wiz.querySelector('.wiz-sprite'))) seen.moved = true;
      if (wiz.querySelector('img').getAttribute('src') !== before.src) seen.swapped = true;
      if (wiz.getAttribute('aria-label') !== before.name) seen.renamed = true;
      if (Date.now() - started > 1400) {
        seen.faded = !shown(line) || getComputedStyle(line).opacity < .05;
        seen.restored = wiz.querySelector('img').getAttribute('src') === before.src && still(wiz)
          && !shown(wiz.querySelector('.wiz-sprite'));
        return resolve(seen);
      }
      setTimeout(look, 30);
    };
    look();
  })`;
  const press = async () => {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  };
  // Start watching first, in its own call: the protocol does not order input events after an evaluation.
  await page.evaluate(`window.landingWatch = (${watch})(document.querySelectorAll('.family-wiz')[5]); true`);
  await page.click(at.x, at.y);
  const clicked = await page.evaluate('window.landingWatch');
  expect(!!clicked.line, where, 'clicking a Wiz shows no line');
  expect(clicked.faded, where, 'the Wiz line does not fade');
  // Every reaction ends within a second and leaves the Wiz as it was, under the same name.
  expect(clicked.restored, where, 'a clicked Wiz is not back at rest, in its own costume, a second later');
  expect(!clicked.renamed, where, 'a clicked Wiz changes its accessible name');
  if (mode === 'motion') expect(clicked.moved || clicked.swapped, where, 'a clicked Wiz does not react');
  if (mode === 'reduced') {
    expect(!clicked.moved, where, 'a Wiz moves with reduced motion on');
    expect(clicked.swapped, where, 'with reduced motion a click is not a still pose change');
  }
  // Keyboard: focus the next Wiz and press Enter, twice; with reduced motion it answers as itself both times.
  const keyed = [];
  for (let i = 0; i < 2; i++) {
    await page.evaluate(`window.landingWatch = (${watch})((() => { const wiz = document.querySelectorAll('.family-wiz')[6]; wiz.focus(); return wiz; })()); true`);
    await press();
    keyed.push(await page.evaluate('window.landingWatch'));
  }
  expect(keyed.every(k => k.line), where, 'Enter on a focused Wiz shows no line');
  expect(keyed.every(k => !k.renamed && k.restored), where, 'Enter leaves a Wiz renamed or in another costume');
  if (mode === 'reduced') expect(keyed[0].line === keyed[1].line, where,
    `the same Wiz answers as someone else the second time ("${keyed[0].line}", then "${keyed[1].line}")`);
  if (mode === 'motion') await handoff(page, where);
}

// One Wiz at a time, each reaction under a second: hovering, moving along the row and quick clicks.
async function handoff(page, where) {
  const centre = i => page.evaluate(`(() => { const r = document.querySelectorAll('.family-wiz')[${i}].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: Math.min(r.top + r.height * .45, innerHeight - 4) }; })()`);
  const busy = `(() => { ${HELPERS} return [...document.querySelectorAll('.family-wiz')].map((wiz, i) =>
    !still(wiz) || shown(wiz.querySelector('.wiz-sprite')) ? i : -1).filter(i => i >= 0); })()`;
  const wait = ms => page.evaluate(`new Promise(r => setTimeout(r, ${ms}))`);
  const move = async ({ x, y }) => page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await move({ x: 2, y: 2 });
  await wait(1200);
  // Resting the pointer on a Wiz: its reaction is over within a second.
  const [a, b, c, d] = [await centre(4), await centre(7), await centre(3), await centre(8)];
  await move(a);
  await wait(1000);
  let now = await page.evaluate(busy);
  expect(now.length === 0, where, `a hovered Wiz is still reacting after a second (Wiz ${now.join(', ')})`);
  // Moving to another Wiz ends the first one's reaction at once.
  await move({ x: a.x, y: a.y - 400 });
  await wait(1000);
  await move(a);
  await wait(100);
  await move(b);
  await wait(100);
  now = await page.evaluate(busy);
  expect(now.length <= 1, where, `${now.length} Wizes react at once after moving along the row`);
  await move({ x: 2, y: 2 });
  await wait(1100);
  // Two quick clicks: the second cancels the first.
  await page.click(c.x, c.y);
  await wait(60);
  await page.click(d.x, d.y);
  for (const ms of [60, 175, 400]) {
    await wait(ms === 60 ? 60 : ms - 60);
    now = await page.evaluate(busy);
    expect(now.length <= 1, where, `${now.length} Wizes react at once ${ms} ms after a second click`);
  }
  await wait(1000);
  now = await page.evaluate(busy);
  expect(now.length === 0, where, `a Wiz still reacts more than a second after the last click (Wiz ${now.join(', ')})`);
}

// The owner's fix 3: every site page outside the app has the landing's exact top bar (the cream mark, the GitHub
// logo with its star count or the logo alone, Sign in) and its footer, with no sideways scroll.
async function chrome(page, where, mode) {
  const facts = await page.evaluate(`(() => { ${HELPERS}
    const bar = document.querySelector('header.landing-nav');
    const mark = bar?.querySelector('.landing-brand svg');
    const star = bar?.querySelector('.github-star');
    const footer = document.querySelector('footer.landing-footer');
    return {
      scroll: document.scrollingElement.scrollWidth, inner: innerWidth,
      mark: shown(mark) && mark.querySelector('[fill="#cfc6b8"]') !== null,
      star: shown(star) && star.getAttribute('href') === 'https://github.com/openwizdev/openwiz' && shown(star.querySelector('svg')),
      signIn: shown(bar?.querySelector('a.sign-in[href="/app/"]')),
      footer: shown(footer?.querySelector('.footer-wordmark')) && footer.querySelectorAll('.family-wiz').length === 12,
      font: getComputedStyle(document.body).fontFamily.split(',')[0].trim(),
    };
  })()`);
  expect(facts.scroll <= facts.inner, where, `sideways scroll (${facts.scroll}px content in a ${facts.inner}px window)`);
  expect(facts.mark, where, 'the top bar lacks the cream mark');
  expect(facts.star, where, 'the top bar lacks the GitHub logo link');
  expect(facts.signIn, where, 'the top bar lacks Sign in');
  expect(facts.footer, where, 'the page lacks the landing footer (wordmark and Wizes)');
  expect(facts.font === 'Geist', where, `the page is not set in the landing's type (${facts.font})`);
}

// #63: every site page's top bar shows the one buy button and the Drivers link inside the window, with no sideways
// scroll, and the team page shows its one Book a call link.
async function buy(page, where, path) {
  const facts = await page.evaluate(`(() => { ${HELPERS}
    const bar = document.querySelector('header.landing-nav');
    const inside = el => shown(el) && el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth;
    const button = bar?.querySelector('a.nav-team[href="/team/"]');
    return {
      scroll: document.scrollingElement.scrollWidth, inner: innerWidth,
      button: inside(button) && button.innerText.trim().length > 0,
      drivers: inside(bar?.querySelector('a[href="/drivers/"]')),
      book: [...document.querySelectorAll('a[data-book]')].filter(shown).length,
    };
  })()`);
  expect(facts.scroll <= facts.inner, where, `sideways scroll (${facts.scroll}px content in a ${facts.inner}px window)`);
  expect(facts.button, where, 'the top bar lacks the buy button inside the window');
  expect(facts.drivers, where, 'the top bar lacks the Drivers link inside the window');
  if (path === '/team/') expect(facts.book === 1, where, `the team page needs one Book a call link (${facts.book})`);
}

async function main() {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await launch();
  try {
    for (const [width, height] of WIDTHS) {
      for (const [name, mode] of Object.entries(MODES)) {
        const where = `${width}px, ${name}`;
        const page = await open(browser, origin, width, height, mode);
        try {
          await layout(page, where, width, name);
          await chrome(page, where, name);
          if (process.env.SHOTS && name === 'motion' && (width === 390 || width === 1280)) {
            await page.shot(join(process.env.SHOTS, `landing-${width}.png`));
          }
          if (name === 'reduced' || name === 'no GSAP') await playable(page, where);
          if (name === 'motion' && (width === 390 || width === 1280)) await sequence(page, where);
          if ((name === 'motion' || name === 'reduced') && (width === 390 || width === 1280)) await family(page, where, name);
        } finally {
          await page.close();
        }
        for (const path of ['/', '/changelog/', '/drivers/', '/team/']) {
          const other = await open(browser, origin, width, height, mode, path);
          try {
            await buy(other, `${path} ${where}`, path);
            if (process.env.SHOTS && name === 'motion' && path === '/team/' && (width === 390 || width === 1280)) {
              await other.shot(join(process.env.SHOTS, `team-${width}.png`));
            }
          } finally {
            await other.close();
          }
        }
        const changelog = await open(browser, origin, width, height, mode, '/changelog/');
        try {
          await chrome(changelog, `/changelog/ ${where}`, name);
          if (process.env.SHOTS && name === 'motion' && (width === 390 || width === 1280)) {
            await changelog.shot(join(process.env.SHOTS, `changelog-${width}.png`));
          }
        } finally {
          await changelog.close();
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  for (const failure of failures) console.log(`FAIL ${failure}`);
  console.log(`landing check: ${passed} passed, ${failures.length} failed`);
  process.exitCode = failures.length ? 1 : 0;
}

await main();
