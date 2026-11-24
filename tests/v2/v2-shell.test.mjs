import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, signIn, start } from './browser.mjs';

const apiRequests = world => world.log.filter(r => r.origin !== SITE || r.path.startsWith('/api/'));

test('switch off: none of the v2 shell renders and demo=1 is ignored', async () => {
  const run = await start();
  try {
    await run.page.go(`${SITE}/app/?demo=1#/feed`);
    await run.page.until(`document.body.innerText.includes('Sign in with GitHub')`, 'v1 signed-out screen');
    const v2Attr = await run.page.run(`document.documentElement.dataset.v2 ?? null`);
    assert.equal(v2Attr, null);
    assert.equal(await run.page.run(`Boolean(document.querySelector('.v2-shell, .v2-welcome-card'))`), false);
    assert.match(await run.page.text(), /Read-only, on the repositories you choose\./);
    assert.ok(!run.world.log.some(r => /^\/app\/(pages\/v2\.|art\/)/.test(r.path)), 'switch off loaded a v2 asset');
    assert.deepEqual(apiRequests(run.world), []);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('switch on + demo=1: renders v2 shell, deep links, interactions, and makes zero network requests', async () => {
  const run = await start();
  try {
    await run.page.size(1440, 900, false);
    await run.page.go(`${SITE}/app/?v2=on&demo=1#/welcome`);
    await run.page.until(`document.body.innerText.includes('Run your software factory from here.')`, 'v2 welcome screen');
    assert.equal(await run.page.run(`document.documentElement.dataset.v2`), '1');
    assert.equal(await run.page.run(`document.querySelector('.v2-sample-tag').textContent`), 'Sample data');

    assert.equal(await run.page.run(`document.querySelector('.v2-welcome-link').getAttribute('href')`), '/api/sign-in/start');
    await run.page.tap('Open Harbor workspace');
    await run.page.until(`location.hash === '#/chat' && document.body.innerText.includes('Accept all 3')`, 'v2 chat with grill round');
    const nav = await run.page.run(`[...document.querySelectorAll('nav.main a')].map(a => a.getAttribute('href'))`);
    assert.deepEqual(nav, ['#/chat', '#/feed', '#/settings']);

    await run.page.run(`window.firstMessage = document.querySelector('.v2-chat-thread .v2-msg');
      window.firstQuestion = document.querySelector('.v2-grill-q');
      document.querySelector('.v2-composer input').focus()`);
    await run.page.type('An unfinished idea');
    await run.page.click('Right away');
    assert.equal(await run.page.run(`document.activeElement.value`), 'An unfinished idea');
    assert.equal(await run.page.run(`document.querySelector('.v2-grill-q') === window.firstQuestion
      && window.firstQuestion.querySelector('[aria-pressed="true"]').textContent === 'Right away'`), true);
    await run.page.run(`document.querySelector('.v2-q-pill').click()`);
    await run.page.tap('Accept all 3');
    await run.page.until(`document.body.innerText.includes('Answers saved · Open Feed')`, 'grill accepted');
    assert.equal(await run.page.run(`document.querySelector('.v2-chat-thread .v2-msg') === window.firstMessage
      && document.querySelector('.v2-grill-q') === window.firstQuestion
      && document.querySelector('.v2-chat-thread .v2-msg:last-child p').textContent.includes('is now in Feed.')`), true);

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/feed`);
    await run.page.until(`document.body.innerText.includes('Magic-link sign-in')`, 'feed spec card');
    assert.equal(await run.page.run(`(() => {
      const row = document.querySelector('.v2-card-actions');
      const ship = row.querySelector('.primary').getBoundingClientRect();
      return ship.height >= 48 && ship.width >= Math.max(200, row.clientWidth / 2);
    })()`), true, 'Ship it is the largest desktop action');
    assert.ok(run.world.log.some(r => r.path === '/app/art/sea-wide.webp'));
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
    await run.page.until(`document.querySelector('.v2-card-title')?.textContent === 'Pricing copy on the checkout banner'`, 'advances after shipping');
    await new Promise(resolve => setTimeout(resolve, 4600));
    await run.page.tap('Undo');
    await run.page.until(`document.querySelector('.v2-card-title')?.textContent === 'Magic-link sign-in'`, 'Undo stays available');

    await run.page.size(390, 844, true);

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/feed/2`);
    await run.page.until(`document.querySelector('.v2-card-title')?.textContent === 'Pricing copy on the checkout banner'`, 'deep link to decision card');
    assert.equal(await run.page.run(`!document.querySelector('.v2-preview')
      && document.querySelector('.v2-next').textContent.includes('CSV export for audit log')
      && document.documentElement.scrollWidth === innerWidth`), true);
    await run.page.until(`performance.getEntriesByName(location.origin + '/app/art/sea-tall.webp').length`, 'portrait painting');
    assert.ok((await run.page.text()).includes('Show "Save 20%"'));

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/settings`);
    await run.page.until(`document.querySelector('select[aria-label="Where it runs"]')?.value === 'Local workstation'`, 'settings screen');
    await run.page.tap('Not connected');
    assert.equal(await run.page.run(`document.querySelector('[aria-label="Notifications"]').getAttribute('aria-checked')`), 'true');

    assert.equal(await run.page.run(`performance.getEntriesByType('resource')
      .some(entry => ['fetch', 'xmlhttprequest', 'beacon'].includes(entry.initiatorType))`), false);
    assert.deepEqual(apiRequests(run.world), [], 'demo mode sent an API or external network request');
    assert.deepEqual(run.world.writes(), [], 'demo mode wrote something');
    assert.deepEqual(run.world.violations, [], 'demo mode hit a CSP or console violation');

    await run.page.tap('Exit sample workspace');
    await run.page.until(`location.pathname === '/app/' && !location.search
      && document.querySelector('.v2-welcome-card') && !document.querySelector('.v2-sample-tag')`, 'exit sample workspace');
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
