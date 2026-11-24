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
    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/welcome`);
    await run.page.until(`document.body.innerText.includes('Run your software factory.')`, 'v2 welcome screen');
    assert.equal(await run.page.run(`document.documentElement.dataset.v2`), '1');
    assert.ok((await run.page.text()).includes('Sample data'));

    await run.page.click('Open Harbor workspace');
    await run.page.until(`location.hash === '#/chat' && document.body.innerText.includes('Accept all 3 recs')`, 'v2 chat with grill round');
    const nav = await run.page.run(`[...document.querySelectorAll('nav.main a')].map(a => a.getAttribute('href'))`);
    assert.deepEqual(nav, ['#/chat', '#/feed', '#/settings']);

    await run.page.click('Accept all 3 recs');
    await run.page.until(`document.body.innerText.includes('Answered · Spec queued in Feed')`, 'grill accepted');

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/feed`);
    await run.page.until(`document.body.innerText.includes('Magic-link sign-in')`, 'feed spec card');
    await run.page.click('Ship it');
    await run.page.until(`document.body.innerText.includes('Pricing copy on the checkout banner')`, 'advances after shipping');

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/feed/2`);
    await run.page.until(`document.body.innerText.includes('Pricing copy on the checkout banner')`, 'deep link to decision card');
    assert.ok((await run.page.text()).includes('Show "Save 20%"'));

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/settings`);
    await run.page.until(`document.body.innerText.includes('Where it runs') && document.body.innerText.includes('Home Mac Mini')`, 'settings screen');

    assert.deepEqual(apiRequests(run.world), [], 'demo mode sent an API or external network request');
    assert.deepEqual(run.world.writes(), [], 'demo mode wrote something');
    assert.deepEqual(run.world.violations, [], 'demo mode hit a CSP or console violation');
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
