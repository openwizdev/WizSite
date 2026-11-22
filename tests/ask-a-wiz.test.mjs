import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const line = event => JSON.stringify(event).replace(/[<>&]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`) + '\n';
const refused = (reason, message) => line({ type: 'refused', reason, message });
const PROBE_ON = '{"schema":"openwiz.ask-a-wiz.v1","enabled":true,"max_question_chars":300}';
const ANSWER = ['Synthetic answer: OpenWiz ', 'runs a fleet of coding agents ', 'from one approved plan.'].map(text => line({ type: 'text', text }))
  .concat(line({ type: 'sources', sources: [{ title: 'Questions', url: 'https://openwiz.dev/faq/' }, { title: 'OpenWiz README', url: 'https://github.com/openwizdev/openwiz#readme' }] }), line({ type: 'done' }));
const ESCAPED = [line({ type: 'text', text: 'Synthetic answer: a row like <b>bold</b> ' }), line({ type: 'text', text: 'shows as text, & stays text.' }),
  line({ type: 'sources', sources: [{ title: 'Questions', url: 'https://openwiz.dev/faq/' }] }), line({ type: 'done' })];
const NOT_COVERED_TEXT = "The OpenWiz docs don't cover that yet, so I won't guess. Book a call or open a GitHub issue, and we'll answer it.";
const LINKS = [{ label: 'Book a call', href: 'https://openwiz.dev/team/#book' }, { label: 'GitHub issues', href: 'https://github.com/openwizdev/openwiz/issues' }];
const NOT_COVERED = [line({ type: 'not_covered', text: NOT_COVERED_TEXT, links: LINKS })];
const TOO_LONG = refused('too_long', 'That question is too long. Keep it to 300 characters or fewer.');
const MIDSTREAM = [line({ type: 'text', text: 'Synthetic part one. ' }), refused('upstream_error', "Ask a Wiz couldn't answer just now. Try again.")];

let fake;
beforeEach(() => {
  fake = { probe: { status: 404 }, probed: 0, answers: [], asked: [], closed: 0, release: null };
});
function serve() {
  const server = createServer(async (request, response) => {
    const path0 = new URL(request.url, 'http://x').pathname;
    if (path0 === '/api/ask') {
      if (request.method === 'GET') {
        fake.probed++;
        const { status, type = 'application/json', body } = fake.probe;
        response.writeHead(status, body ? { 'content-type': type, 'cache-control': 'no-store' } : {}).end(body);
        return;
      }
      let body = '';
      for await (const chunk of request) body += chunk;
      fake.asked.push({ body: JSON.parse(body), origin: request.headers.origin, type: request.headers['content-type'] });
      const { status = 200, lines, hold, type = 'application/x-ndjson; charset=utf-8' } = fake.answers.shift();
      const held = new Promise(resolve => { fake.release = resolve; response.on('close', resolve); });
      response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
      response.on('close', () => { if (!response.writableFinished) fake.closed++; });
      for (const each of lines) { response.write(each); await new Promise(resolve => setTimeout(resolve, 30)); }
      if (hold) await held;
      response.end(...(hold && Array.isArray(hold) ? [hold.join('')] : []));
      return;
    }
    let path = normalize(decodeURIComponent(path0));
    if (path.endsWith('/')) path += 'index.html';
    try {
      const data = await readFile(join(DIST, path));
      response.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(data);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function launch() {
  const chrome = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
    '/usr/bin/chromium-browser'].find(path => path && existsSync(path));
  if (!chrome) throw new Error('no Chrome or Chromium found; set CHROME');
  const profile = await mkdtemp(join(tmpdir(), 'ask-a-wiz-'));
  const child = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--no-sandbox', '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let text = '';
    child.stderr.on('data', chunk => { text += chunk; const m = text.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
    child.on('exit', code => reject(new Error(`browser exited (${code})`)));
  });
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let next = 0;
  const waiting = new Map(), listeners = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const wait = waiting.get(message.id);
    if (wait) { waiting.delete(message.id); message.error ? wait.reject(new Error(JSON.stringify(message.error))) : wait.resolve(message.result); }
    else if (message.method) for (const listener of listeners) listener(message);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    waiting.set(++next, { resolve, reject });
    socket.send(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const close = async () => {
    socket.close(); child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  };
  return { send, on: listener => listeners.push(listener), close };
}

let server, browser, origin;
before(async () => {
  server = await serve();
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await launch();
});
after(async () => { await browser?.close(); server?.close(); });

async function open(path = '/', { width = 1280, height = 900, reduced = false, scroll = true } = {}) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  await send('Page.enable');
  await send('Network.setBlockedURLs', { urls: ['*api.github.com*'] }).catch(() => {});
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 480 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
  const loaded = new Promise(resolve => browser.on(m => m.sessionId === sessionId && m.method === 'Page.loadEventFired' && resolve()));
  await send('Page.navigate', { url: `${origin}${path}` });
  await loaded;
  if (scroll) await send('Runtime.evaluate', { expression: `document.querySelector('section.faq').scrollIntoView()` });
  const evaluate = async expression => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  const until = (expression, what = expression) => evaluate(`new Promise((resolve, reject) => { const t0 = Date.now();
    const tick = () => { let ok; try { ok = (${expression}); } catch {} ok ? resolve(true) : Date.now() - t0 > 5000 ? reject(new Error(${JSON.stringify(`timed out: ${what}`)})) : setTimeout(tick, 20); }; tick(); })`);
  const ask = async question => {
    await evaluate(`document.querySelector('.faq-ask input').focus()`);
    await send('Input.insertText', { text: question });
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) });
  };
  const press = label => evaluate(`[...document.querySelectorAll('.faq-ask button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} && b.getClientRects().length).click()`);
  const shot = async name => {
    if (!process.env.SHOTS) return;
    const clip = await evaluate(`(() => { const r = document.querySelector('section.faq').getBoundingClientRect(); return { x: 0, y: r.top + scrollY, width: ${width}, height: r.height, scale: 1 }; })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
    await writeFile(join(process.env.SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
  };
  return { evaluate, until, ask, press, shot, close: () => browser.send('Target.closeTarget', { targetId }) };
}

const ROWS = `[...document.querySelectorAll('section.faq .faq-rows > *')].map(row => ({
  ask: row.classList.contains('faq-ask'), input: !!row.querySelector('input') && row.querySelector('input').getClientRects().length > 0,
  q: row.querySelector('.faq-q')?.textContent.trim() ?? '', a: row.querySelector('.faq-a')?.innerText.trim() ?? '',
  button: !!row.querySelector('.faq-q button'), links: [...row.querySelectorAll('.faq-a a')].map(a => [a.textContent, a.href]),
  bold: !!row.querySelector('.faq-a b'),
  buttons: [...row.querySelectorAll('.faq-ask-actions button')].filter(b => b.getClientRects().length).map(b => b.textContent.trim()) }))`;
const rows = page => page.evaluate(ROWS);
const told = page => page.evaluate(`document.querySelector('section.faq [aria-live="polite"]')?.textContent.trim()`);
const focused = page => page.evaluate(`(e => e === document.body ? 'the page' : e.tagName === 'INPUT' ? 'input' : e.textContent.trim())(document.activeElement)`);
const waitFake = async (test, what) => {
  for (const t0 = Date.now(); !test(); await new Promise(resolve => setTimeout(resolve, 20))) if (Date.now() - t0 > 5000) throw new Error(`timed out: ${what}`);
};
const probeOn = () => { fake.probe = { status: 200, body: PROBE_ON }; };

test('with the switch off the FAQ shows no input row, and asks nothing', async () => {
  for (const probe of [{ status: 404 }, { status: 200, type: 'text/html', body: '<!doctype html><title>OpenWiz</title>' },
    { status: 200, body: '{"schema":"openwiz.ask-a-wiz.v1","enabled":false,"max_question_chars":300}' },
    { status: 200, body: '{"schema":"openwiz.ask-a-wiz.v1","enabled":true}' },
    { status: 200, body: '{"schema":"openwiz.ask-a-wiz.v1","enabled":true,"max_question_chars":299}' },
    { status: 200, body: '{"schema":"openwiz.ask-a-wiz.v1","enabled":true,"max_question_chars":300,"extra":1}' }]) {
    fake.probe = probe;
    for (const path of ['/', '/team/', '/faq/']) {
      const probed = fake.probed, page = await open(path);
      await page.evaluate('new Promise(resolve => setTimeout(resolve, 300))');
      assert.equal(fake.probed, probed + 1, `${path}: asked once`);
      assert.equal(await page.evaluate(`document.querySelectorAll('section.faq input, section.faq form, .faq-ask').length`), 0, `${path} ${probe.status}`);
      assert.equal((await rows(page)).length, 7, `${path}: only the seven hand-written rows`);
      await page.close();
    }
  }
  assert.equal(fake.asked.length, 0);
  const probed = fake.probed, page = await open('/', { scroll: false });
  await page.evaluate('new Promise(resolve => setTimeout(resolve, 300))');
  assert.equal(fake.probed, probed, 'the landing asks nothing before its FAQ nears the screen');
  await page.evaluate(`document.querySelector('section.faq').scrollIntoView()`);
  await page.until(`true`).then(() => new Promise(resolve => setTimeout(resolve, 300)));
  assert.equal(fake.probed, probed + 1, 'and asks once it does');
  await page.close();
});

test('an answer streams in, becomes a normal FAQ row, and a fresh input row appears', async () => {
  probeOn();
  for (const path of ['/', '/faq/']) {
    fake.answers.push({ lines: ANSWER.slice(0, 1), hold: ANSWER.slice(1) }, { lines: ESCAPED });
    const page = await open(path);
    await page.until(`document.querySelector('.faq-ask input')`, 'the input row');
    assert.equal(await page.evaluate(`document.querySelector('.faq-ask input').placeholder`), 'Ask a Wiz...');
    assert.equal(await page.evaluate(`document.querySelector('.faq-rows').lastElementChild.classList.contains('faq-ask')`), true);
    assert.equal(await focused(page), 'the page', 'the row never takes focus on its own');
    await page.ask('  What does OpenWiz run?  ');
    await page.until(`document.querySelector('.faq-ask .faq-a')?.innerText.includes('Synthetic answer: OpenWiz')`, 'the first piece');
    let seen = (await rows(page)).at(-1);
    assert.deepEqual([seen.q, seen.input, seen.buttons], ['What does OpenWiz run?', false, ['Stop']]);
    assert.equal(await focused(page), 'Stop', 'focus moves to Stop, never to the page');
    assert.deepEqual(fake.asked.at(-1).body, { question: 'What does OpenWiz run?' });
    assert.equal(fake.asked.at(-1).origin, origin);
    await page.evaluate(`document.querySelector('footer a').focus()`);
    const away = await focused(page);
    fake.release();
    await page.until(`document.querySelectorAll('.faq-rows > .faq-row').length === 9`, 'the converted row and a fresh one');
    let all = await rows(page);
    const done = all.at(-2);
    assert.equal(done.ask, false);
    assert.equal(done.button, true);
    assert.equal(done.q, 'What does OpenWiz run?');
    assert.match(done.a, /^Synthetic answer: OpenWiz runs a fleet of coding agents from one approved plan\.\s+Sources: Questions, OpenWiz README$/);
    assert.deepEqual(done.links, []);
    assert.deepEqual([all.at(-1).ask, all.at(-1).input, all.at(-1).q], [true, true, '']);
    assert.equal(await focused(page), away, 'focus stays where the visitor moved it');
    assert.equal(await told(page), 'Synthetic answer: OpenWiz runs a fleet of coding agents from one approved plan.');
    assert.equal(await page.evaluate(`new Set([...document.querySelectorAll('.faq-rows .faq-q')].map(h => h.tagName)).size`), 1, 'one heading level');
    assert.equal(await page.evaluate(`(() => { const b = document.querySelectorAll('.faq-rows .faq-q button'); return b[b.length - 1].getAttribute('aria-expanded'); })()`), 'true');
    await page.ask('Is markup shown?');
    await page.until(`document.querySelectorAll('.faq-rows > .faq-row').length === 10`, 'the second answer');
    seen = (await rows(page)).at(-2);
    assert.match(seen.a, /^Synthetic answer: a row like <b>bold<\/b> shows as text, & stays text\./);
    assert.equal(seen.bold, false, 'text stays text');
    await page.close();
  }
});

test('stop ends the stream, shows nothing as finished, and retry asks again', async () => {
  probeOn();
  fake.answers.push({ lines: ANSWER.slice(0, 1), hold: true }, { lines: ANSWER });
  const page = await open('/team/');
  await page.until(`document.querySelector('.faq-ask input')`);
  await page.ask('What does OpenWiz run?');
  await page.until(`document.querySelector('.faq-ask .faq-a')?.innerText.includes('Synthetic answer')`);
  await page.press('Stop');
  await page.until(`!document.querySelector('.faq-ask .faq-a')?.innerText.includes('Synthetic answer')`, 'the partial answer gone');
  await waitFake(() => fake.closed === 1, 'the stream closed');
  assert.equal(await focused(page), 'Retry');
  assert.equal(await told(page), 'Stopped.');
  let seen = (await rows(page)).at(-1);
  assert.deepEqual([seen.ask, seen.q, seen.buttons], [true, 'What does OpenWiz run?', ['Retry', 'Edit']]);
  assert.match(seen.a, /Stopped/);
  assert.equal((await rows(page)).length, 8, 'no converted row');
  await page.press('Retry');
  await page.until(`document.querySelectorAll('.faq-rows > .faq-row').length === 9`, 'the retried answer');
  assert.deepEqual(fake.asked.map(a => a.body.question), ['What does OpenWiz run?', 'What does OpenWiz run?']);
  assert.match((await rows(page)).at(-2).a, /^Synthetic answer: OpenWiz runs/);
  assert.equal(await focused(page), 'input', 'focus inside the row moves to the fresh input');
  await page.close();
});

test('refusals and the not-covered answer show in the row\'s own style', async () => {
  probeOn();
  fake.answers.push({ status: 413, lines: [TOO_LONG] }, { lines: MIDSTREAM.slice(0, 1), hold: MIDSTREAM.slice(1) }, { lines: NOT_COVERED });
  const page = await open('/');
  await page.until(`document.querySelector('.faq-ask input')`);
  await page.ask('A synthetic question that is too long');
  await page.until(`document.querySelector('.faq-ask .faq-a')?.innerText.includes('too long')`);
  let seen = (await rows(page)).at(-1);
  assert.deepEqual([seen.a, seen.buttons], ['That question is too long. Keep it to 300 characters or fewer.', ['Edit']]);
  assert.deepEqual([await focused(page), await told(page)], ['Edit', seen.a]);
  await page.press('Edit');
  await page.until(`document.querySelector('.faq-ask input')?.value === 'A synthetic question that is too long'`, 'the question back to edit');
  await page.evaluate(`document.querySelector('.faq-ask input').select()`);
  await page.ask('Why did it fail?');
  await page.until(`document.querySelector('.faq-ask .faq-a')?.innerText.includes('Synthetic part one')`);
  await page.evaluate(`document.querySelector('footer a').focus()`);
  const away = await focused(page);
  fake.release();
  await page.until(`document.querySelector('.faq-ask .faq-a')?.innerText.includes("couldn't answer")`);
  seen = (await rows(page)).at(-1);
  assert.deepEqual([seen.a, seen.buttons], ["Ask a Wiz couldn't answer just now. Try again.", ['Retry', 'Edit']]);
  assert.deepEqual([await focused(page), await told(page)], [away, seen.a]);
  await page.press('Retry');
  await page.until(`document.querySelectorAll('.faq-rows > .faq-row').length === 9`, 'the not-covered row');
  seen = (await rows(page)).at(-2);
  assert.deepEqual([seen.q, seen.a.startsWith(NOT_COVERED_TEXT), seen.links], ['Why did it fail?', true, LINKS.map(l => [l.label, l.href])]);
  assert.equal(await told(page), NOT_COVERED_TEXT);
  await page.shot('refused-then-not-covered');
  await page.close();
});

test('a stream that breaks the contract\'s shape is never shown as an answer', async () => {
  probeOn();
  const text = line({ type: 'text', text: 'Synthetic text. ' }), sources = ANSWER[3], done = ANSWER[4];
  const bad = [[line({ type: 'text', text: 'Synthetic text. ', html: '<b>x</b>' }), sources, done], [text, line({ type: 'note' }), sources, done],
    [text, done], [text, sources, text, done], [text, line({ type: 'sources', sources: [] }), done],
    [line({ type: 'not_covered', text: NOT_COVERED_TEXT, links: [LINKS[0], { label: 'GitHub issues', href: 'https://example.com/' }] })],
    [line({ type: 'not_covered', text: 'Synthetic other text.', links: LINKS })], [text, refused('too_long', 'Synthetic.')], ['not json\n'],
    [ANSWER.join('') + text], [ANSWER.join(''), 'x'], [ANSWER.join('') + done], [NOT_COVERED[0] + NOT_COVERED[0]], [ANSWER.join('').slice(0, -1)],
  ].map(lines => ({ lines })).concat({ status: 503, lines: ANSWER }, { status: 200, lines: [TOO_LONG] }, { type: 'text/html', lines: ANSWER },
    { status: 413, lines: [refused('too_long', 'Synthetic other message.')] });
  for (const answer of bad) fake.answers.push(answer);
  const page = await open('/faq/');
  await page.until(`document.querySelector('.faq-ask input')`);
  await page.ask('A synthetic question');
  for (const [n, answer] of bad.entries()) {
    await page.until(`document.querySelector('.faq-ask')?.dataset.state === 'ended'`, `bad stream ${n}`);
    const seen = (await rows(page)).at(-1);
    assert.deepEqual([seen.a, seen.buttons, (await rows(page)).length], ['The answer didn\u2019t finish. Try again.', ['Retry', 'Edit'], 8], `bad stream ${n}: ${JSON.stringify(answer)}`);
    if (n < bad.length - 1) await page.press('Retry');
  }
  await page.close();
});

test('phone and laptop fit, and reduced motion keeps the row still', async () => {
  probeOn();
  const long = `Is ${'x'.repeat(90)} a ticket?`, LONG = [line({ type: 'text', text: `Synthetic ${'y'.repeat(400)} ` }), ...ANSWER.slice(1)];
  for (const [width, height, reduced] of [[390, 844, false], [1280, 900, false], [390, 844, true]]) {
    fake.answers.push({ lines: LONG.slice(0, 1), hold: LONG.slice(1) });
    const page = await open('/faq/', { width, height, reduced });
    await page.until(`document.querySelector('.faq-ask input')`);
    await page.ask(long);
    await page.until(`document.querySelector('.faq-ask .faq-a')?.innerText.includes('Synthetic')`);
    const facts = await page.evaluate(`(() => { const row = document.querySelector('.faq-ask');
      const moving = [row, ...row.querySelectorAll('*')].map(el => [getComputedStyle(el).animationName, getComputedStyle(el, '::after').animationName]).flat().filter(n => n !== 'none');
      return { scroll: document.documentElement.scrollWidth - innerWidth, moving, right: row.getBoundingClientRect().right,
        small: [...row.querySelectorAll('button')].filter(b => b.getClientRects().length && b.getBoundingClientRect().height < 44).length }; })()`);
    assert.equal(facts.scroll, 0, `${width}: no sideways scroll`);
    assert.ok(facts.right <= width, `${width}: the row fits`);
    assert.equal(facts.small, 0, `${width}: every button is at least 44px tall`);
    assert.equal(facts.moving.length === 0, reduced, `${width} ${reduced ? 'reduced' : 'motion'}: ${facts.moving}`);
    await page.shot(`streaming-${width}${reduced ? '-reduced' : ''}`);
    fake.release();
    await page.until(`document.querySelectorAll('.faq-rows > .faq-row').length === 9`);
    const done = await page.evaluate(`(() => { const row = document.querySelectorAll('.faq-rows > .faq-row')[7], panel = row.querySelector('.faq-a > div');
      return { scroll: document.documentElement.scrollWidth - innerWidth, chevron: row.querySelector('.faq-chevron').getBoundingClientRect().right,
        clipped: panel.scrollWidth - panel.clientWidth, input: document.querySelector('.faq-ask input').getBoundingClientRect().height }; })()`);
    assert.deepEqual([done.scroll, done.clipped, done.chevron <= width], [0, 0, true], `${width}: the converted row fits: ${JSON.stringify(done)}`);
    assert.ok(done.input >= 44, `${width}: the input is at least 44px tall`);
    await page.shot(`answered-${width}${reduced ? '-reduced' : ''}`);
    await page.close();
  }
});
