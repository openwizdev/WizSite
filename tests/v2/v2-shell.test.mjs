import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { SITE, signIn, start } from './browser.mjs';

const apiRequests = world => world.log.filter(r => r.origin !== SITE || r.path.startsWith('/api/')
  || ['Fetch', 'XHR', 'Ping', 'EventSource', 'WebSocket'].includes(r.resourceType));

test('switch off: none of the v2 shell renders and demo=1 is ignored', async () => {
  const run = await start();
  try {
    await run.page.go(`${SITE}/app/?demo=1#/feed`);
    await run.page.until(`document.body.innerText.includes('Sign in with GitHub')`, 'v1 signed-out screen');
    const v2Attr = await run.page.run(`document.documentElement.dataset.v2 ?? null`);
    assert.equal(v2Attr, null);
    assert.equal(await run.page.run(`Boolean(document.querySelector('.v2-shell, .v2-welcome-card'))`), false);
    assert.match(await run.page.text(), /Read-only, on the repositories you choose\./);
    assert.ok(!run.world.log.some(r => /^\/app\/pages\/v2\./.test(r.path)), 'switch off loaded a v2 asset');
    assert.deepEqual(apiRequests(run.world), []);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('switch on + demo=1: renders v2 shell, deep links, interactions, and makes zero network requests', async () => {
  const run = await start();
  try {
    await run.page.size(390, 844, true);
    await run.page.go(`${SITE}/app/?v2=on&demo=1#/welcome`);
    await run.page.until(`document.body.innerText.includes('Your software factory, in one quiet room.')`, 'v2 welcome screen');
    assert.equal(await run.page.run(`document.documentElement.dataset.v2`), '1');
    assert.equal(await run.page.run(`document.querySelector('.v2-sample-tag').textContent`), 'Sample data');

    assert.equal(await run.page.run(`document.querySelector('.v2-welcome-sign-in').getAttribute('href')`), '/api/sign-in/start');
    await run.page.tap('Open Harbor workspace');
    await run.page.until(`location.hash === '#/chat' && document.body.innerText.includes('Accept all 3')`, 'v2 chat with grill round');
    const nav = await run.page.run(`[...document.querySelectorAll('nav.main a')].map(a => a.getAttribute('href'))`);
    assert.deepEqual(nav, ['#/chat', '#/feed', '#/settings']);

    await run.page.run(`window.initialMessages = [...document.querySelector('.v2-chat-thread').children];
      window.initialChoices = [...document.querySelectorAll('.v2-q-pill')];
      document.querySelector('.v2-composer input').focus()`);
    await run.page.type('An unfinished idea');
    await run.page.click('Right away');
    assert.equal(await run.page.run(`document.activeElement.value`), 'An unfinished idea');
    assert.equal(await run.page.run(`initialChoices[1] === document.querySelectorAll('.v2-q-pill')[1]
      && initialChoices[1].getAttribute('aria-pressed') === 'true'`), true);
    await run.page.run(`document.querySelector('.v2-q-pill').click()`);
    await run.page.tap('Accept all 3');
    await run.page.until(`document.body.innerText.includes('Answers saved · Open Feed')`, 'grill accepted');
    assert.equal(await run.page.run(`(() => {
      const thread = document.querySelector('.v2-chat-thread');
      return thread.children.length === initialMessages.length + 2
        && initialMessages.every((node, i) => node === thread.children[i]);
    })()`), true, 'accepting a grill replaced existing log entries');

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/feed`);
    await run.page.until(`document.body.innerText.includes('Magic-link sign-in')`, 'feed spec card');
    assert.equal(await run.page.run(`document.documentElement.scrollWidth`), 390);
    assert.equal(await run.page.run(`document.querySelector('.v2-tabs a[href="#/feed"] .v2-tab-glyph > .v2-badge').textContent`), '4');
    assert.match(await run.page.run(`document.querySelector('.v2-next-card').innerText`), /Next.*Needs a decision\s+Pricing copy/i);
    await run.page.tap('Change something');
    await run.page.until(`document.querySelector('.v2-sheet')?.matches(':modal')`, 'the change dialog');
    await run.page.key('Escape');
    await run.page.until(`document.activeElement.dataset.focus === 'change'`, 'focus returned to the change button');
    await run.page.tap('Change something');
    await run.page.type('Make the link last ten minutes');
    await run.page.tap('Send change');
    assert.match(await run.page.text(), /Make the link last ten minutes/);
    assert.equal(await run.page.run(`document.activeElement.dataset.focus`), 'change');
    await run.page.tap('Ship it');
    await run.page.until(`document.querySelector('.v2-card-title').textContent === 'Pricing copy on the checkout banner'`, 'advances after shipping');
    await run.page.run(`document.querySelector('.v2-toast button').focus()`);
    await delay(4600);
    assert.equal(await run.page.run(`document.querySelector('.v2-toast').hidden`), false, 'focused Undo expired');
    await run.page.key('Enter');
    await run.page.until(`document.querySelector('.v2-card-title').textContent === 'Magic-link sign-in'`, 'Undo restores the spec');
    await run.page.run(`document.querySelector('.v2-next-card').click()`);
    await run.page.until(`location.hash === '#/feed/2' && document.activeElement.matches('.v2-card-title')`, 'next preview opens the decision');

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/feed/2`);
    await run.page.until(`document.body.innerText.includes('Pricing copy on the checkout banner')`, 'deep link to decision card');
    assert.ok((await run.page.text()).includes('Show "Save 20%"'));
    assert.equal(await run.page.run(`Boolean(document.querySelector('.v2-preview'))`), false);
    await run.page.size(1440, 900, false);
    assert.equal(await run.page.run(`(() => {
      const row = document.querySelector('.v2-card-actions');
      const ship = row.querySelector('.primary').getBoundingClientRect();
      return ship.height >= 48 && ship.width >= Math.max(200, row.clientWidth / 2);
    })()`), true);

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/settings`);
    await run.page.until(`document.querySelector('select[aria-label="Where it runs"]')?.value === 'Local workstation'`, 'settings screen');
    await run.page.tap('Not connected');
    assert.equal(await run.page.run(`document.querySelector('[aria-label="Notifications"]').getAttribute('aria-checked')`), 'true');

    assert.deepEqual(apiRequests(run.world), [], 'demo mode sent an API or external network request');
    assert.deepEqual(run.world.writes(), [], 'demo mode wrote something');
    assert.deepEqual(run.world.violations, [], 'demo mode hit a CSP or console violation');
    await run.page.tap('Exit sample workspace');
    await run.page.until(`!OW.data.demo && !location.search && document.querySelector('.v2-welcome .primary')?.textContent.includes('Continue with GitHub')`, 'exits to signed-out v2');
  } finally {
    await run.close();
  }
});


test('demo isolates a saved GitHub session from boot, visibility refresh, and the palette', async () => {
  const run = await start();
  try {
    await signIn(run.page);
    await run.page.click('acme/factory');
    await run.page.until(`document.querySelector('main h1')?.textContent === 'You'`, 'signed in with a picked repository');
    const stored = `['auth', 'repo'].map(key => localStorage.getItem('openwiz.app.' + key))`;
    const session = await run.page.run(stored);
    assert.ok(JSON.parse(session[0]).token);
    assert.equal(JSON.parse(session[1]).full, 'acme/factory');
    await run.page.go('about:blank');
    run.world.log.length = 0;

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/feed`);
    await run.page.until(`document.body.innerText.includes('Magic-link sign-in')`, 'the sample feed');
    await run.page.run(`Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
      OW.data.start();
      OW.data.refreshAll();
      Promise.allSettled([OW.data.github('GET', '/user'), OW.data.repositories()])`);
    await run.page.key('k', 'Ctrl');

    assert.equal(await run.page.run('OW.palette.shown()'), false);
    assert.doesNotMatch(await run.page.text(), /acme\/factory/);
    assert.deepEqual(await run.page.run(stored), session);
    assert.deepEqual(apiRequests(run.world), [], 'demo used network access with a saved session');
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});
