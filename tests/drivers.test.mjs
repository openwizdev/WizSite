import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';

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

test('the rendered Drivers page shows exactly one visible Devin entry', async () => {
  assert.ok(existsSync(join(DIST, 'drivers/index.html')), 'run npm run build first');
  const snapshot = JSON.parse(await readFile(join(ROOT, 'market/registry.json'), 'utf8'));
  const listing = snapshot.listings.find(item => item.id === 'devin' && item.tags.includes('driver'));
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
    const evaluate = async fn => {
      const { result, exceptionDetails } = await page('Runtime.evaluate', {
        expression: `(${fn})()`,
        returnByValue: true,
      });
      assert.equal(exceptionDetails, undefined, result.description);
      return result.value;
    };
    const readDevin = () => evaluate(() => {
      const norm = s => s.replace(/\s+/g, ' ').trim();
      const tiles = document.querySelectorAll('article[data-listing="devin"], li.tile[data-listing="devin"], #devin');
      if (tiles.length !== 1) return { tiles: tiles.length };
      const [tile] = tiles;
      const box = tile.getBoundingClientRect();
      const state = tile.dataset.state;
      const group = tile.parentElement.closest('[data-state]');
      const rest = document.documentElement.cloneNode(true);
      rest.querySelector('#' + CSS.escape(tile.id)).remove();
      const released = '[data-state="live"], [data-state="passed"], [data-state="shipped"], .live, .passed, .shipped';
      return {
        tiles: tiles.length,
        visible: box.width > 0 && box.height > 0
          && tile.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
        inHostGroup: tile.matches('li.tile') && group?.id === `hosts-${state}`
          && group.dataset.state === state && Boolean(group.closest('#hosts')),
        state,
        names: [...tile.querySelectorAll('h3, h4')].map(e => norm(e.innerText)),
        shown: norm(tile.innerText),
        links: [...tile.querySelectorAll('a')].map(a => [norm(a.innerText), a.href]),
        markedReleased: Boolean(tile.closest(released) || tile.querySelector(released)),
        devinElsewhere: /devin/i.test(rest.outerHTML),
        comingSoon: /coming soon/i.test(norm(tile.textContent)),
        listing: tile.dataset.listing,
        stage: tile.dataset.stage,
        status: tile.dataset.status,
        login: tile.querySelector('.driver-login')?.innerText,
        summary: tile.querySelector('.build-line')?.innerText,
        wording: tile.querySelector('.tile-state')?.innerText,
        kit: tile.querySelector('.driver-kit')?.innerText,
        marks: document.querySelectorAll('li[data-host][data-listing="devin"]').length,
      };
    });

    if (listing) {
      const entry = await readDevin();
      assert.equal(entry.tiles, 1, 'exactly one registry-covered Devin card');
      assert.equal(entry.visible, true);
      assert.deepEqual([entry.listing, entry.stage, entry.status], [listing.id, listing.stage, listing.status]);
      assert.deepEqual(entry.names, [listing.name]);
      assert.equal(entry.login, listing.login ? 'Login: ' + listing.login : undefined);
      const receipt = listing.proof?.receipt;
      if (listing.stage === 'available' && receipt) {
        assert.equal(entry.marks, 1);
        assert.equal(entry.kit, 'Kit: passed, 5 of 5');
        assert.deepEqual(entry.links, [['Kit run, ' + receipt.date, receipt.url]]);
      } else {
        assert.equal(entry.marks, 0);
        assert.equal(entry.inHostGroup, true);
        assert.equal(entry.summary, listing.summary);
        if (listing.stage === 'being-built') {
          const work = listing.links[0];
          const links = [[work.label, work.url]];
          if (receipt) {
            assert.equal(entry.wording, 'Passed its live check, 5 of 5 on a real host; not in a release yet');
            links.push(['Live check receipt, ' + receipt.date, receipt.url]);
          } else {
            assert.equal(entry.markedReleased, false);
          }
          assert.deepEqual(entry.links, links);
        } else {
          assert.equal(entry.markedReleased, false);
          assert.deepEqual(entry.links, [['Get it', listing.url]]);
        }
      }
      return;
    }

    const labels = {
      review: 'In review',
      waiting: 'Built, waiting on its live check',
      building: 'Being built',
    };
    const assertDevin = card => {
      assert.equal(card.tiles, 1, 'exactly one Devin tile');
      assert.equal(card.visible, true, 'the Devin tile is visible');
      assert.ok(Object.hasOwn(labels, card.state), 'Devin has a pre-live state');
      assert.equal(card.inHostGroup, true, 'Devin is in the host group for its state');
      assert.equal(card.markedReleased, false, 'Devin has no live, passed or shipped marker');
      assert.equal(card.comingSoon, false, 'Devin never says Coming soon');
      assert.equal(card.devinElsewhere, false, 'there is no Devin claim outside its tile');
      assert.deepEqual(card.names, ['Devin']);
      assert.equal(card.links.length, 1, 'Devin has one pull request link');
      const [[linkText, href]] = card.links;
      assert.ok(linkText === 'Pull request' || (card.state === 'building' && linkText === 'Draft pull request'),
        'Devin shows the pull request link');
      assert.equal(href, 'https://github.com/openwizdev/OpenWiz/pull/2490');
      const status = `Devin ${labels[card.state]}`;
      const shown = [`${status} Login: held by Devin ${linkText}`];
      if (card.state !== 'waiting') shown.push(`${status} ${linkText}`);
      assert.ok(shown.includes(card.shown), 'Devin shows the expected copy for its state');
    };

    assertDevin(await readDevin());

    await evaluate(() => {
      document.querySelector('#hosts').insertAdjacentHTML('beforeend',
        '<p id="extra-claim-probe">Use the Devin driver today.</p>');
    });
    const extraClaim = await readDevin();
    assert.throws(() => assertDevin(extraClaim), /there is no Devin claim outside its tile/);

    await evaluate(() => {
      document.querySelector('#extra-claim-probe').remove();
      document.querySelector('#devin').style.opacity = '0';
    });
    const transparent = await readDevin();
    assert.throws(() => assertDevin(transparent), /the Devin tile is visible/);
  } finally {
    await browser.close();
    server.close();
  }
});

const REGISTRY_FILE = 'market/registry.json';

async function buildDriverFixture(listings) {
  const dir = await mkdtemp(join(tmpdir(), 'drivers-registry-'));
  try {
    const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: ROOT, encoding: 'utf8',
    }).split('\0');
    for (const file of new Set(files)) {
      if (!file || file === REGISTRY_FILE) continue;
      const target = join(dir, file);
      await mkdir(dirname(target), { recursive: true });
      await link(join(ROOT, file), target);
    }
    await symlink(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
    await writeFile(join(dir, REGISTRY_FILE), JSON.stringify({ contract: 'listing.v1', commit: 'd'.repeat(40), listings }));
    execFileSync(process.execPath, ['build.mjs'], { cwd: dir, stdio: 'pipe' });
    return {
      drivers: await readFile(join(dir, 'dist/drivers/index.html'), 'utf8'),
      market: await readFile(join(dir, 'dist/market/index.html'), 'utf8'),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function fixtureListing(id, name, fields) {
  return {
    id, name, stage: 'available', status: 'listed', tags: ['driver'],
    summary: 'Runs agents on an example host.', plugs_into: 'OpenWiz drivers',
    publisher: 'example-publisher', url: `https://example.com/${id}`, ...fields,
  };
}

function fixtureReceipt(id) {
  const date = '2026-11-01';
  const path = `receipts/${id}/${date}-aaaaaaaaaaaa.txt`;
  return { receipt: { date, path, url: `https://github.com/openwizdev/WizMarket/blob/${'d'.repeat(40)}/${path}` } };
}

const cardLinks = card => [...card.matchAll(/<a\b[^>]* href="([^"]+)"/g)].map(([, href]) => href.replaceAll('&amp;', '&'));

test('the two built pages read the same driver listings and keep uncovered page entries', async () => {
  const shipped = fixtureListing('example-driver', 'Example & Sons', {
    status: 'verified', login: 'stays on your machine', proof: fixtureReceipt('example-driver'),
  });
  const building = fixtureListing('example-building', 'Example in progress', {
    stage: 'being-built', login: 'held by the example host',
    links: [{ label: 'Example issue', url: 'https://tracker.example.com/example/issues/5?a=1&b=2' }],
  });
  const passed = fixtureListing('openclaw', 'OpenClaw', {
    stage: 'being-built', status: 'verified', proof: fixtureReceipt('openclaw'),
    links: [{ label: 'Work ticket', url: 'https://example.com/openclaw/work' }],
  });
  const listed = fixtureListing('example-listed', 'Listed example', {});
  const local = fixtureListing('local', 'Example computer or VPS', {
    status: 'verified', login: 'stays on your machine', proof: fixtureReceipt('local'),
  });
  const harness = fixtureListing('copilot-cli', 'Example harness', {
    stage: 'being-built', tags: ['harness'], links: [{ label: 'Example issue', url: 'https://example.com/harness/work' }],
  });
  const { drivers, market } = await buildDriverFixture([harness, building, shipped, listed, local, passed]);
  const hostSection = id => drivers.match(new RegExp(`<section class="wall wrap" id="${id}"[\\s\\S]*?<\\/section>`))[0];
  const hostCards = drivers.slice(drivers.indexOf('<main'), drivers.indexOf(hostSection('harnesses')));
  const rendered = [...hostCards.matchAll(/<(article|li)\b(?=[^>]* data-listing="([^"]+)")([^>]*)>([\s\S]*?)<\/\1>/g)]
    .filter(([, , , attrs]) => !attrs.includes('data-host='));
  assert.deepEqual(rendered.map(([, , id]) => id).sort(), [building.id, shipped.id, listed.id, local.id, passed.id].sort(),
    'exactly one Drivers card per registry driver, with harnesses excluded from hosts');
  const cards = Object.fromEntries(rendered.map(([card, , id]) => [id, card]));
  for (const [listing, name, expectedLinks] of [
    [shipped, 'Example &amp; Sons', [shipped.proof.receipt.url]],
    [building, building.name, [building.links[0].url]],
    [listed, listed.name, [listed.url]],
    [local, local.name, [local.proof.receipt.url]],
    [passed, passed.name, [passed.links[0].url, passed.proof.receipt.url]],
  ]) {
    const card = cards[listing.id];
    assert.ok(card.includes(`>${name}</`), `${listing.id}: registry display name`);
    assert.ok(card.includes(`data-status="${listing.status}"`), `${listing.id}: registry verification state`);
    assert.ok(card.includes(`data-stage="${listing.stage}"`), `${listing.id}: registry stage`);
    assert.deepEqual(cardLinks(card).sort(), expectedLinks.sort(), `${listing.id}: only the registry links`);
    const marketCard = market.match(new RegExp(`<article class="market-card" id="listing-${listing.id}"[\\s\\S]*?<\\/article>`))?.[0];
    assert.ok(marketCard?.includes(`>${name}</`), `${listing.id}: adding it to the snapshot also adds it to Market`);
    assert.ok(marketCard.includes(`data-status="${listing.status}"`) && marketCard.includes(`data-stage="${listing.stage}"`));
    assert.ok(expectedLinks.every(link => cardLinks(marketCard).includes(link)), `${listing.id}: Market has the same links`);
  }
  assert.match(cards[shipped.id], /Login: stays on your machine/);
  assert.match(cards[shipped.id], /Kit: passed, 5 of 5/);
  assert.match(cards[shipped.id], /<time datetime="2026-11-01">2026-11-01<\/time>/);
  assert.match(cards[shipped.id], /src="\/drivers\/logos\/monitor\.svg"/);
  assert.match(cards[building.id], /Login: held by the example host/);
  assert.ok(cards[building.id].includes(building.summary));
  assert.match(cards[passed.id], />Passed its live check, 5 of 5 on a real host; not in a release yet<\//);
  assert.match(cards[passed.id], /src="\/drivers\/logos\/openclaw\.svg"/);
  const marks = [...drivers.matchAll(/<li data-host="([^"]+)"/g)].map(([, id]) => id);
  assert.deepEqual(marks.sort(), ['boat-dev', 'cloudroom', 'example-driver', 'vps']);
  assert.equal([...drivers.matchAll(/ id="openclaw"/g)].length, 1, 'the registry replaces the OpenClaw fallback in place');
  assert.match(cards[local.id], / id="vps"/, 'the local seed replaces the existing computer or VPS card');
  const harnessCard = hostSection('harnesses').match(/<li class="tile" id="copilot"[^>]*>[\s\S]*?<\/li>/)?.[0];
  assert.ok(harnessCard?.includes('data-listing="copilot-cli"'), 'the harness seed replaces its existing row');
  assert.deepEqual(cardLinks(harnessCard), [harness.links[0].url]);

  const { drivers: empty } = await buildDriverFixture([]);
  const fallbackCards = empty.matchAll(/<article class="driver[^"]*" id="([^"]+)"[\s\S]*?<\/article>|<li class="tile[^"]*" id="([^"]+)"[\s\S]*?<\/li>/g);
  const replaced = new Set(['openclaw', 'vps', 'copilot']);
  for (const [html, article, tile] of fallbackCards) {
    const id = article ?? tile;
    if (!replaced.has(id)) assert.ok(drivers.includes(html), `${id}: uncovered card retains its entire markup`);
    assert.equal([...drivers.matchAll(new RegExp(` id="${id}"`, 'g'))].length, 1, `${id}: present exactly once`);
  }
});
