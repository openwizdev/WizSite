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
    assert.deepEqual(apiRequests(run.world), []);
    assert.ok(!run.world.log.some(r => /\/pages\/v2[.]/.test(r.path)), 'switch-off app requested v2 assets');
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('switch on + demo=1: renders v2 shell, deep links, interactions, and makes zero network requests', async () => {
  const run = await start();
  try {
    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/welcome`);
    await run.page.until(`document.body.innerText.includes('Run your software factory from here.')`, 'v2 welcome screen');
    assert.equal(await run.page.run(`document.documentElement.dataset.v2`), '1');
    assert.ok((await run.page.text()).includes('Sample data'));

    await run.page.size(390, 844, true);
    await run.page.tap('Open Harbor workspace');
    await run.page.until(`location.hash === '#/chat' && document.body.innerText.includes('Accept all 3')`, 'v2 chat with grill round');
    const nav = await run.page.run(`[...document.querySelectorAll('nav.main a')].map(a => a.getAttribute('href'))`);
    assert.deepEqual(nav, ['#/chat', '#/feed', '#/settings']);

    assert.ok(await run.page.run(`(() => {
      const thread = document.querySelector('.v2-chat-scroll');
      const card = document.querySelector('.v2-grill');
      const accept = card.querySelector('footer button').getBoundingClientRect();
      const composer = document.querySelector('.v2-composer').getBoundingClientRect();
      return thread.scrollTop === 0 && accept.bottom <= composer.top
        && document.documentElement.scrollWidth === 390;
    })()`), 'the three questions and submit fit above the phone composer');
    await run.page.run(`document.querySelector('.v2-composer input').focus()`);
    await run.page.type('Draft for later');
    await run.page.run(`document.querySelector('.v2-q-pill:not([aria-pressed="true"])').focus()`);
    await run.page.key('Enter');
    assert.equal(await run.page.run(`document.activeElement.getAttribute('aria-pressed')`), 'true');
    assert.equal(await run.page.run(`document.querySelector('.v2-composer input').value`), 'Draft for later');
    await run.page.tap('Month end');
    await run.page.tap('Accept all 3');
    await run.page.until(`document.body.innerText.includes('I’ve added “Seat billing” to Feed.')`, 'questions accepted');
    assert.equal(await run.page.run(`document.querySelector('.v2-composer input').value`), 'Draft for later');

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/feed`);
    await run.page.until(`document.body.innerText.includes('Magic-link sign-in')`, 'feed spec card');
    await run.page.tap('Change something');
    assert.equal(await run.page.run(`document.activeElement.tagName`), 'TEXTAREA');
    assert.ok(await run.page.run(`document.querySelector('.v2-sheet').matches(':modal')`));
    await run.page.key('Escape');
    await run.page.until(`!document.querySelector('.v2-sheet') && document.activeElement.textContent === 'Change something'`, 'Escape restores focus to opener');
    await run.page.tap('Change something');
    await run.page.type('Use a shorter subject line');
    await run.page.tap('Send change');
    await run.page.until(`document.body.innerText.includes('Requested change: Use a shorter subject line')`, 'the updated spec');
    assert.equal(await run.page.run(`document.activeElement.textContent`), 'Change something');
    await run.page.tap('Ship it');
    await run.page.until(`document.body.innerText.includes('Keep the free plan?')`, 'advances after shipping');

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/feed/2`);
    await run.page.until(`document.body.innerText.includes('Keep the free plan?')`, 'deep link to decision card');
    assert.ok((await run.page.text()).includes('Keep it, cap at 3 seats'));

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/settings`);
    await run.page.until(`document.body.innerText.includes('Where it runs') && document.body.innerText.includes('Home computer')`, 'settings screen');

    assert.deepEqual(apiRequests(run.world), [], 'demo mode sent an API or external network request');
    assert.deepEqual(run.world.writes(), [], 'demo mode wrote something');
    assert.deepEqual(run.world.violations, [], 'demo mode hit a CSP or console violation');
  } finally {
    await run.close();
  }
});

test('demo isolates a stored GitHub session from reads, refresh, and the palette', async () => {
  const run = await start();
  try {
    await signIn(run.page);
    await run.page.click('acme/factory');
    await run.page.until(`OW.data.auth.signedIn() && OW.data.repo.get()?.full === 'acme/factory'`, 'stored sign-in and repository');
    assert.equal(await run.page.run('OW.data.auth.account()'), null);
    await run.page.until(`Object.values(OW.data.feeds).every(feed => feed.state !== 'loading' && !feed.busy)`, 'initial reads to settle');
    const before = run.world.log.length;

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/feed`);
    await run.page.until(`document.querySelector('.v2-shell') && document.body.innerText.includes('Magic-link sign-in')`, 'demo feed');
    await run.page.run(`(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
      OW.data.start();
      OW.data.refreshAll();
      return Promise.allSettled([OW.data.github('GET', '/user'), OW.data.repositories()]);
    })()`);
    await run.page.key('k', 'Ctrl');
    assert.equal(await run.page.run('OW.palette.shown()'), false);
    assert.doesNotMatch(await run.page.text(), /acme\/factory/);
    assert.deepEqual(apiRequests({ log: run.world.log.slice(before) }), []);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('real v2 keeps Settings and supported palette destinations available when Specs cannot be read', async () => {
  const run = await start();
  try {
    await run.page.go(`${SITE}/app/?v2=on`);
    await run.page.until(`document.body.innerText.includes('Continue with GitHub')`, 'signed-out v2');
    await signIn(run.page);
    await run.page.click('acme/factory');
    await run.page.until(`document.body.innerText.includes("press Refresh now")`, 'the unknown Feed state');
    await run.page.click('Refresh now');
    await run.page.click('Settings');
    await run.page.until(`document.body.innerText.includes('Sign out') && document.body.innerText.includes('acme/factory')`, 'Settings with repository and sign out');
    assert.match(await run.page.text(), /Coming soon/);
    assert.doesNotMatch(await run.page.text(), /Balanced|Managed locally|0\.02/);
    await run.page.key('k', 'Ctrl');
    assert.equal(await run.page.run(`OW.palette.shown()`), true);
    const palette = await run.page.run(`document.querySelector('#palette-results').innerText`);
    assert.match(palette, /Chat[\s\S]*Feed[\s\S]*Settings/);
    assert.doesNotMatch(palette, /Agents|Find a spec|Show only specs|ticket/i);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});
