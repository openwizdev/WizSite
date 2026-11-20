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
  'no FAQ script': { block: ['*/faq.*.js'] },
};
const WIDTHS = [[320, 640], [390, 844], [800, 1000], [1280, 800], [1440, 1100]];

async function open(browser, origin, width, height, mode, path = '/') {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*api.github.com*', ...(mode.block || [])] });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 480 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: mode.reduced ? 'reduce' : 'no-preference' }] });
  if (mode.noScript) await send('Emulation.setScriptExecutionDisabled', { value: true });
  const loaded = new Promise(resolve => browser.on(m => m.sessionId === sessionId && m.method === 'Page.loadEventFired' && resolve()));
  await send('Page.navigate', { url: `${origin}${path}` });
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
  const shot = async (path) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
      clip: await evaluate(`({ x: 0, y: 0, width: ${width}, height: document.documentElement.scrollHeight, scale: 1 })`) });
    await writeFile(path, Buffer.from(data, 'base64'));
  };
  return { send, evaluate, click, shot, close: () => browser.send('Target.closeTarget', { targetId }) };
}

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
  for (const row of facts.rows) {
    const left = Math.min(...row.map(i => i.left));
    const right = Math.max(...row.map(i => i.right));
    expect(left - facts.list.left < 2 && facts.list.right - right < 2, where,
      `a row of ${row.length} moment(s) leaves an empty cell (${Math.round(left)}–${Math.round(right)} of ${Math.round(facts.list.left)}–${Math.round(facts.list.right)})`);
  }
  if (width <= 480) expect(facts.wizTops.length === 1, where, `footer Wizes in ${facts.wizTops.length} rows`);
  if (mode === 'motion') {
    expect(!!facts.pause, where, 'no Pause motion control with motion on');
    const { pause: p, window: w } = facts;
    if (p) expect(p.top >= w.bottom || p.bottom <= w.top || p.left >= w.right || p.right <= w.left, where,
      `Pause motion (${Math.round(p.top)}–${Math.round(p.bottom)}) covers the app window (ends at ${Math.round(w.bottom)})`);
  }
  if (mode !== 'no JavaScript') expect(!!facts.play, where, 'the spec sample has no play button');
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

async function family(page, where, mode) {
  await page.evaluate(`new Promise(resolve => { let last; const tick = () => {
    const wiz = document.querySelectorAll('.family-wiz')[5]; wiz.scrollIntoView({ block: 'end' });
    const now = JSON.stringify(wiz.getBoundingClientRect()); if (now === last) return resolve(); last = now; setTimeout(tick, 300); };
    tick(); })`);
  const at = await page.evaluate(`(() => { const wiz = document.querySelectorAll('.family-wiz')[5];
    wiz.scrollIntoView({ block: 'end' }); const r = wiz.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: Math.min(r.top + r.height * .45, innerHeight - 4), rest: !!document.querySelector('.wiz-line') }; })()`);
  expect(!at.rest, where, 'a Wiz line shows at rest');
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
  await page.evaluate(`window.landingWatch = (${watch})(document.querySelectorAll('.family-wiz')[5]); true`);
  await page.click(at.x, at.y);
  const clicked = await page.evaluate('window.landingWatch');
  expect(!!clicked.line, where, 'clicking a Wiz shows no line');
  expect(clicked.faded, where, 'the Wiz line does not fade');
  expect(clicked.restored, where, 'a clicked Wiz is not back at rest, in its own costume, a second later');
  expect(!clicked.renamed, where, 'a clicked Wiz changes its accessible name');
  if (mode === 'motion') expect(clicked.moved || clicked.swapped, where, 'a clicked Wiz does not react');
  if (mode === 'reduced') {
    expect(!clicked.moved, where, 'a Wiz moves with reduced motion on');
    expect(clicked.swapped, where, 'with reduced motion a click is not a still pose change');
  }
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

async function handoff(page, where) {
  const centre = i => page.evaluate(`(() => { const r = document.querySelectorAll('.family-wiz')[${i}].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: Math.min(r.top + r.height * .45, innerHeight - 4) }; })()`);
  const busy = `(() => { ${HELPERS} return [...document.querySelectorAll('.family-wiz')].map((wiz, i) =>
    !still(wiz) || shown(wiz.querySelector('.wiz-sprite')) ? i : -1).filter(i => i >= 0); })()`;
  const wait = ms => page.evaluate(`new Promise(r => setTimeout(r, ${ms}))`);
  const move = async ({ x, y }) => page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await move({ x: 2, y: 2 });
  await wait(1200);
  const [a, b, c, d] = [await centre(4), await centre(7), await centre(3), await centre(8)];
  await move(a);
  await wait(1000);
  let now = await page.evaluate(busy);
  expect(now.length === 0, where, `a hovered Wiz is still reacting after a second (Wiz ${now.join(', ')})`);
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

async function buy(page, where, path) {
  const facts = await page.evaluate(`(() => { ${HELPERS}
    const bar = document.querySelector('header.landing-nav');
    // The worst case a visitor sees: a long star count and, above phone and tablet widths, a classic scrollbar taking 17 px.
    const stars = bar?.querySelector('[data-stars]');
    if (stars) { stars.hidden = false; stars.textContent = '12.3k'; }
    if (innerWidth > 640) document.documentElement.style.width = (innerWidth - 17) + 'px';
    const inside = el => shown(el) && el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth && el.scrollWidth <= el.clientWidth + 1;
    const button = bar?.querySelector('a.nav-team[href="/team/"]');
    const facts = {
      scroll: document.scrollingElement.scrollWidth, inner: innerWidth,
      clipped: [...bar.querySelectorAll('a')].filter(a => a.scrollWidth > a.clientWidth + 1).map(a => a.className || a.getAttribute('href')),
      over: bar.scrollWidth - bar.clientWidth,
      button: inside(button) && button.innerText.trim().length > 0,
      drivers: inside(bar?.querySelector('a[href="/drivers/"]')),
      book: [...document.querySelectorAll('a[data-book]')].filter(shown).length,
    };
    document.documentElement.style.width = '';
    return facts;
  })()`);
  expect(facts.over <= 1 && !facts.clipped.length, where, `the top bar clips (with a star count and a scrollbar): ${facts.over}px over, links ${facts.clipped.join(', ')}`);
  expect(facts.scroll <= facts.inner, where, `sideways scroll (${facts.scroll}px content in a ${facts.inner}px window)`);
  expect(facts.button, where, 'the top bar lacks the buy button inside the window');
  expect(facts.drivers, where, 'the top bar lacks the Drivers link inside the window');
  if (path === '/team/') expect(facts.book === 2, where, `the team page needs its two Book a call links (${facts.book})`);
}

async function footer(page, where, mode) {
  const facts = await page.evaluate(`(async () => { ${HELPERS}
    const footer = document.querySelector('footer.landing-footer');
    const mark = footer.querySelector('.footer-wordmark');
    // #75 R2: the painted Wizes, not their boxes: each shown Wiz's top opaque row, from its untransformed place.
    footer.scrollIntoView({ block: 'end', behavior: 'instant' });
    const shownWizes = [...footer.querySelectorAll('.family-wiz')].filter(shown);
    await Promise.all(shownWizes.map(wiz => wiz.querySelector('img').decode().catch(() => {})));
    const row = footer.querySelector('.family');
    const painted = Math.min(...shownWizes.map(wiz => {
      const img = wiz.querySelector('img');
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(img, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let first = canvas.height;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 24) { first = Math.floor((i - 3) / 4 / canvas.width); break; }
      return row.getBoundingClientRect().top + wiz.offsetTop - row.offsetTop + img.offsetTop + first * img.offsetHeight / canvas.height;
    }));
    const range = document.createRange();
    range.selectNodeContents(mark);
    const text = range.getBoundingClientRect();
    // The ink, not the font's content box: the baseline from the font's ascent, then the letters' own descent.
    const ink = document.createElement('canvas').getContext('2d');
    const style = getComputedStyle(mark);
    ink.font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
    ink.letterSpacing = style.letterSpacing;
    const metrics = ink.measureText(mark.textContent);
    const glyphs = { left: text.left, right: text.right, bottom: text.top + metrics.fontBoundingBoxAscent + metrics.actualBoundingBoxDescent };
    const f = footer.getBoundingClientRect(), m = mark.getBoundingClientRect();
    const family = footer.querySelector('.family').getBoundingClientRect();
    const links = [...footer.querySelectorAll('.footer-groups a')];
    return {
      count: document.querySelectorAll('footer').length,
      buttons: footer.querySelectorAll('.family-wiz[role="button"]').length,
      links: links.length, inside: links.every(a => shown(a) && a.getBoundingClientRect().left >= 0 && a.getBoundingClientRect().right <= innerWidth),
      line: shown(footer.querySelector('.footer-line')),
      dbg: [glyphs.left, f.left, glyphs.right, f.right, glyphs.bottom, m.bottom, f.bottom].map(Math.round),
      whole: glyphs.left >= f.left && glyphs.right <= f.right && glyphs.bottom <= m.bottom + 1 && m.bottom <= f.bottom,
      gap: Math.round(painted - glyphs.bottom),
      bottom: Math.round(f.bottom + scrollY), height: document.documentElement.scrollHeight, inner: innerHeight,
    };
  })()`);
  expect(facts.count === 1, where, `one footer (${facts.count})`);
  expect(facts.buttons === (mode === 'no JavaScript' ? 0 : 12), where, `the footer Wizes are not the landing's (${facts.buttons} of 12 respond)`);
  expect(facts.links === 8 && facts.inside, where, 'the footer link groups are not all shown inside the window');
  expect(facts.line, where, 'the footer lacks its Apache-2.0 line');
  expect(facts.whole, where, `the footer wordmark is clipped (ink and box: ${facts.dbg})`);
  expect(facts.gap >= 0 && facts.gap <= 16, where, `a ${facts.gap}px painted gap between the wordmark's ink and the Wizes (0 to 16)`);
  expect(facts.bottom >= facts.inner && facts.bottom >= facts.height - 1, where, `the footer ends at ${facts.bottom}px, above the window's bottom (${facts.inner}px)`);
}

const FAQ_PATHS = ['/', '/team/', '/faq/'];
async function faq(page, where, width, mode) {
  const read = () => page.evaluate(`(() => { ${HELPERS}
    const faq = document.querySelector('section.faq');
    const head = faq.querySelector('.faq-head').getBoundingClientRect(), rows = faq.querySelector('.faq-rows').getBoundingClientRect();
    const buttons = [...faq.querySelectorAll('.faq-q button')];
    const answers = buttons.map(b => document.getElementById(b.getAttribute('aria-controls')));
    return {
      rows: buttons.length, head: { left: head.left, right: head.right, top: head.top }, list: { left: rows.left, right: rows.right, top: rows.top },
      width: faq.getBoundingClientRect().width,
      expanded: buttons.map(b => b.getAttribute('aria-expanded')),
      open: answers.map(a => shown(a) && a.getBoundingClientRect().height > 20),
      disabled: buttons.map(b => b.disabled),
      duration: getComputedStyle(answers[0]).transitionDuration,
    };
  })()`);
  const facts = await read();
  expect(facts.rows === 7, where, `the Questions have ${facts.rows} rows`);
  if (width >= 1280) {
    const third = (facts.head.right - facts.head.left) / facts.width;
    expect(facts.list.left > facts.head.right && Math.abs(facts.head.top - facts.list.top) < 2 && third > .25 && third < .4, where,
      `the Questions are not two columns, heading about a third (${third.toFixed(2)})`);
  }
  if (width <= 480) expect(facts.list.top > facts.head.top && Math.abs(facts.list.left - facts.head.left) < 2, where, 'the Questions are not one column on a phone');
  if (mode === 'no JavaScript' || mode === 'no FAQ script') {
    expect(facts.open.every(Boolean), where, `without ${mode === 'no JavaScript' ? 'scripts' : 'faq.js'} an answer is hidden`);
    expect(facts.disabled.every(Boolean) && facts.expanded.every(e => e === 'true'), where, 'a row offers a button that does nothing');
    return;
  }
  expect(facts.disabled.every(d => !d), where, 'a row button stays disabled with its script');
  expect(facts.open.every(o => !o) && facts.expanded.every(e => e === 'false'), where, 'an answer starts open');
  if (mode === 'no GSAP' || (width !== 390 && width !== 1280)) return;
  expect(facts.duration === (mode === 'reduced' ? '0s' : '0.35s, 0.35s, 0s'), where, `the answer's motion is ${facts.duration}`);
  const settle = () => page.evaluate('new Promise(r => setTimeout(() => r(true), 450))');
  const at = await page.evaluate(`(() => { const b = document.querySelector('.faq-q button'); b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await page.click(at.x, at.y);
  const press = async (n, key, code, keyCode, text) => {
    await page.evaluate(`document.querySelectorAll('.faq-q button')[${n}].focus()`);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, ...(text ? { text } : {}) });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
  };
  await press(1, 'Enter', 'Enter', 13, '\r');
  await press(2, ' ', 'Space', 32, ' ');
  await settle();
  let now = await read();
  expect(now.open.slice(0, 3).every(Boolean) && now.expanded.slice(0, 3).every(e => e === 'true') && !now.open[3], where,
    `click, Enter and Space do not open their answers (${now.expanded.join(' ')})`);
  await page.click(at.x, at.y);
  await settle();
  now = await read();
  expect(!now.open[0] && now.expanded[0] === 'false', where, 'a second click does not close the answer');
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
        for (const path of ['/', '/changelog/', '/drivers/', '/team/', '/faq/']) {
          const other = await open(browser, origin, width, height, mode, path);
          try {
            await buy(other, `${path} ${where}`, path);
            await chrome(other, `${path} ${where}`, name);
            await footer(other, `${path} ${where}`, name);
            if (FAQ_PATHS.includes(path)) await faq(other, `${path} ${where}`, width, name);
            if (process.env.SHOTS && name === 'motion' && path !== '/' && (width === 390 || width === 1280)) {
              await other.shot(join(process.env.SHOTS, `${path.slice(1, -1)}-${width}.png`));
            }
          } finally {
            await other.close();
          }
        }
      }
    }
    for (const width of (process.env.WIDTHS || '481,500,560,640,641,700,760,761,800,900,960,1024').split(',').map(Number)) {
      for (const path of ['/', '/changelog/', '/drivers/', '/team/', '/faq/']) {
        const other = await open(browser, origin, width, 800, MODES.motion, path);
        try {
          await buy(other, `${path} ${width}px, motion`, path);
          await footer(other, `${path} ${width}px, motion`, 'motion');
        } finally {
          await other.close();
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
