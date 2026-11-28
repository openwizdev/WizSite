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
const WIDTHS = [[320, 640], [390, 844], [800, 1000], [1440, 1100]];
const MODES = { script: {}, reduced: { reduced: true }, 'no JavaScript': { noScript: true } };
const failures = [];
let passed = 0;
const expect = (ok, where, message) => { if (ok) passed += 1; else failures.push(`${where}: ${message}`); };

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

async function launch() {
  const chrome = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    .find(path => path && existsSync(path));
  if (!chrome) throw new Error('no Chrome or Chromium found; set CHROME');
  const profile = await mkdtemp(join(tmpdir(), 'market-check-'));
  const child = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-sandbox',
    '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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

async function open(browser, url, width, height, mode) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*api.github.com*'] });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 480 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: mode.reduced ? 'reduce' : 'no-preference' }] });
  if (mode.noScript) await send('Emulation.setScriptExecutionDisabled', { value: true });
  const loaded = new Promise(resolve => browser.on(m => m.sessionId === sessionId && m.method === 'Page.loadEventFired' && resolve()));
  await send('Page.navigate', { url });
  await loaded;
  const evaluate = async expression => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  await evaluate('document.fonts.ready.then(() => true)');
  const key = async (key, code, keyCode, text) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, ...(text ? { text } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
  };
  return { send, evaluate, key, close: () => browser.send('Target.closeTarget', { targetId }) };
}

const SHOWN = `const shown = el => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
  const cards = () => [...document.querySelectorAll('.market-card')];
  const visible = () => cards().filter(shown);`;

async function layout(page, where, width, mode) {
  const facts = await page.evaluate(`(() => { ${SHOWN}
    const small = [];
    const targets = '.market-chip, .market-select, .market-copy, .market-links a:first-child, .market-publish-jump, .market-publish-start';
    if (innerWidth <= 960) for (const el of document.querySelectorAll(targets)) if (shown(el) && el.getBoundingClientRect().height < 44) small.push(el.className || el.textContent.trim());
    const spill = cards().slice(0, 12).flatMap(card => [...card.querySelectorAll('*')].filter(el => shown(el) && el.getBoundingClientRect().right > card.getBoundingClientRect().right + 1).map(el => card.dataset.listing + ' ' + el.tagName));
    const chip = document.querySelector('.market-chip');
    return {
      scroll: document.scrollingElement.scrollWidth, inner: innerWidth, small: [...new Set(small)].slice(0, 4), spill: spill.slice(0, 4),
      search: shown(document.querySelector('.market-search')), by: shown(document.querySelector('.market-by')), sort: shown(document.querySelector('.market-sort')),
      motion: chip ? getComputedStyle(chip).transitionDuration : 'no chips',
      credit: cards().filter(card => { const dd = card.querySelector('dd.market-publisher'); const dt = dd?.previousElementSibling;
        return !shown(dd) || dd.textContent !== card.dataset.publisher || Math.abs(dd.getBoundingClientRect().top - dt.getBoundingClientRect().top) > 2; }).map(card => card.dataset.listing).slice(0, 3), publish: shown(document.querySelector('.market-publish')), cards: cards().length,
    };
  })()`);
  expect(facts.cards > 0, where, 'the market has no cards');
  expect(facts.scroll <= width && facts.inner <= width, where, `sideways scroll (${facts.scroll}px content in a ${width}px window)`);
  expect(!facts.small.length, where, `touch targets under 44px: ${facts.small.join(', ')}`);
  expect(!facts.spill.length, where, `card content spills out of its card: ${facts.spill.join(', ')}`);
  expect(facts.publish, where, 'Publish your own is not shown');
  expect(!facts.credit.length, where, `a card does not show who listed it beside Listed by: ${facts.credit.join(', ')}`);
  const scripted = !mode.noScript;
  expect(facts.search === scripted && facts.by === scripted && facts.sort === scripted, where,
    scripted ? 'search, Listed by and Sort are missing with the script' : 'search, Listed by or Sort shows without the script, where it would do nothing');
  if (mode.reduced) expect(facts.motion.split(',').every(d => parseFloat(d) === 0), where, `chips still move with reduced motion (${facts.motion})`);
}

async function noScript(page, where) {
  const facts = await page.evaluate(`(() => { ${SHOWN}
    const tops = visible().map(card => Math.round(card.getBoundingClientRect().top));
    const inOrder = tops.every((top, i) => i === 0 || top >= tops[i - 1]);
    const names = cards().map(card => card.querySelector('h3').textContent);
    const sorted = names.slice().sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
    const empties = [];
    for (const kind of ['driver', 'harness', 'skill', 'mcp', 'other']) {
      document.getElementById('market-kind-' + kind).checked = true;
      for (const verified of [false, true]) {
        document.getElementById('market-verified-only').checked = verified;
        const n = visible().length;
        const want = cards().filter(card => card.dataset.kind === kind && (!verified || card.dataset.status === 'verified')).length;
        if (n !== want || shown(document.querySelector('.market-none')) !== (n === 0)) empties.push(kind + (verified ? '+verified' : '') + ': ' + n + ' of ' + want);
      }
    }
    return { inOrder, named: names.every((name, i) => name === sorted[i]), empties };
  })()`);
  expect(facts.inOrder, where, 'the cards are not shown in their source order, so Tab would jump around');
  expect(facts.named, where, 'the cards are not in name order');
  expect(!facts.empties.length, where, `a Type or Verified choice without the script shows the wrong cards or empty state: ${facts.empties.join('; ')}`);
}

async function scripted(page, where) {
  const step = expression => page.evaluate(`(async () => { ${SHOWN}
    const tools = document.querySelector('.market-tools');
    const set = (selector, value) => { const el = document.querySelector(selector); el.value = value; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
    const pick = selector => { document.querySelector(selector).click(); };
    const wait = () => new Promise(resolve => setTimeout(resolve, 400));
    ${expression}
  })()`);
  const total = await page.evaluate(`document.querySelectorAll('.market-card').length`);
  let facts = await step(`const target = cards().at(-1); const name = target.querySelector('h3').textContent;
    set('#market-q', name); await wait();
    return { first: visible()[0]?.dataset.listing, want: target.dataset.listing, live: document.querySelector('.market-live').textContent, url: location.search };`);
  expect(facts.first === facts.want, where, `searching a listing's name does not put it first (${facts.first})`);
  expect(/^Showing \d+ of \d+$/.test(facts.live), where, `the live count does not say how many show (${facts.live})`);
  expect(facts.url.startsWith('?q='), where, `the search is not in the address (${facts.url})`);
  facts = await step(`set('#market-q', 'zzqx no such listing'); await wait();
    return { n: visible().length, empty: shown(document.querySelector('.market-none')), reset: shown(document.querySelector('.market-none button')) };`);
  expect(facts.n === 0 && facts.empty && facts.reset, where, 'a search that matches nothing does not show the empty state with Clear all filters');
  facts = await step(`document.querySelector('.market-none button').click(); await wait();
    return { n: visible().length, q: document.querySelector('#market-q').value, focus: document.activeElement?.id };`);
  expect(facts.n === total && facts.q === '' && facts.focus === 'market-q', where, `Clear all filters does not bring every listing back (${facts.n} of ${total})`);
  facts = await step(`pick('#market-kind-skill'); pick('#market-verified-only'); await wait();
    const n = visible().length;
    const want = cards().filter(card => card.dataset.kind === 'skill' && card.dataset.status === 'verified').length;
    const count = document.querySelector('#market-kind-skill').closest('label').querySelector('.market-n')?.textContent;
    return { n, want, count, url: location.search, only: visible().every(card => card.dataset.kind === 'skill' && card.dataset.status === 'verified') };`);
  expect(facts.only && facts.n === facts.want && String(facts.want) === facts.count, where, `Skills + Verified only shows ${facts.n}, wants ${facts.want} (chip says ${facts.count})`);
  expect(facts.url.includes('type=skill') && facts.url.includes('verified=1'), where, `the filters are not in the address (${facts.url})`);
  facts = await step(`pick('#market-kind-all'); pick('#market-verified-only'); const by = document.querySelector('#market-by');
    const login = by.options[1]?.value; set('#market-by', login); await wait();
    const want = cards().filter(card => card.dataset.publisher === login).length;
    const label = document.querySelector('.market-card:not(.is-out) .market-publisher')?.textContent;
    return { login, want, n: visible().length, label, options: by.options.length };`);
  expect(facts.options > 1 && facts.n === facts.want && facts.label === facts.login, where, `Listed by ${facts.login} shows ${facts.n} of its ${facts.want}`);
  facts = await step(`set('#market-by', ''); set('#market-sort', 'verified'); await wait();
    const flags = visible().map(card => card.dataset.status === 'verified');
    const tops = visible().map(card => card.getBoundingClientRect().top);
    return { first: flags.indexOf(false) === -1 || flags.slice(flags.indexOf(false)).every(f => !f), order: [...document.querySelector('.market-cards').children].filter(shown).every((card, i) => card === visible()[i]) };`);
  expect(facts.first, where, 'Verified first does not put the verified listings first');
  expect(facts.order, where, 'Sort moves cards visually without moving them in the page, so Tab would jump around');
  facts = await step(`set('#market-sort', 'match'); const tag = cards()[0].querySelector('.market-tags a'); const name = tag.textContent; tag.click(); await wait();
    return { name, every: visible().every(card => [...card.querySelectorAll('.market-tags a')].some(a => a.textContent === name)), clear: shown(document.querySelector('#market-clear-tag')) };`);
  expect(facts.every && facts.clear, where, `a tag does not filter to its listings with a way to clear it (${facts.name})`);
  facts = await step(`document.querySelector('#market-clear-tag').click(); await wait(); return { n: visible().length };`);
  expect(facts.n === total, where, 'Clear tag does not bring every listing back');
  await page.evaluate(`document.activeElement?.blur?.(), document.body.focus(), true`);
  await page.key('/', 'Slash', 191, '/');
  facts = await page.evaluate(`({ focus: document.activeElement?.id, value: document.querySelector('#market-q').value })`);
  expect(facts.focus === 'market-q' && facts.value === '', where, 'the / key does not focus the search');
  facts = await step(`const installs = cards().filter(card => card.querySelector('.market-install'));
    const missing = installs.filter(card => !card.querySelector('.market-install .market-copy')).length;
    const built = cards().filter(card => card.dataset.stage === 'being-built' && card.querySelector('.market-install')).length;
    const button = installs[0].querySelector('.market-copy'); button.click(); await wait();
    return { installs: installs.length, missing, built, label: button.textContent };`);
  expect(facts.installs > 0 && facts.missing === 0, where, `an install line has no Copy button (${facts.missing})`);
  expect(facts.built === 0, where, 'a listing that is being built offers an install line');
  expect(['Copied', 'Selected'].includes(facts.label), where, `Copy gives no feedback (${facts.label})`);
}

async function restored(browser, origin, where) {
  const page = await open(browser, `${origin}/market/?type=driver&verified=1&sort=kind`, 390, 844, {});
  try {
    const facts = await page.evaluate(`(() => { ${SHOWN} return {
      kind: document.querySelector('#market-kind-driver').checked, verified: document.querySelector('#market-verified-only').checked,
      sort: document.querySelector('#market-sort').value, only: visible().every(card => card.dataset.kind === 'driver' && card.dataset.status === 'verified'),
      n: visible().length, chip: (() => { const strip = document.querySelector('.market-kinds').getBoundingClientRect(); const r = document.querySelector('#market-kind-driver').closest('label').getBoundingClientRect(); return r.left >= strip.left - 1 && r.right <= strip.right + 1; })() }; })()`);
    expect(facts.kind && facts.verified && facts.sort === 'kind' && facts.only && facts.n > 0, where, 'a shared address does not restore its filters');
    expect(facts.chip, where, 'the chosen Type chip is scrolled out of view');
  } finally {
    await page.close();
  }
}

async function main() {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await launch();
  try {
    for (const [width, height] of WIDTHS) {
      for (const [name, mode] of Object.entries(MODES)) {
        const where = `/market/ ${width}px, ${name}`;
        const page = await open(browser, `${origin}/market/`, width, height, mode);
        try {
          await layout(page, where, width, mode);
          if (mode.noScript) await noScript(page, where);
          else if (width === 390 || width === 1440) await scripted(page, where);
        } catch (error) {
          expect(false, where, `the check could not finish: ${error.message.split('\n')[0]}`);
        } finally {
          await page.close();
        }
      }
    }
    await restored(browser, origin, '/market/ 390px, shared address').catch(error => expect(false, '/market/ 390px, shared address', `the check could not finish: ${error.message.split('\n')[0]}`));
  } finally {
    await browser.close();
    server.close();
  }
  for (const failure of failures) console.log(`FAIL ${failure}`);
  console.log(`market check: ${passed} passed, ${failures.length} failed`);
  process.exitCode = failures.length ? 1 : 0;
}

await main();
