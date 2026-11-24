import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API, SITE, signIn, start } from './browser.mjs';

test('v2 switch off: none of the new v2 UI appears, and ?demo=1 stays signed out', async () => {
  const run = await start();
  try {
    await run.page.go(`${SITE}/app/?demo=1#/feed`);
    await run.page.until(`document.body.innerText.includes('Sign in with GitHub')`, 'the v1 signed-out screen');
    const v2Attr = await run.page.run('document.documentElement.dataset.v2 ?? null');
    assert.equal(v2Attr, null, 'v2 attribute leaked when switch is off');
    const hasV2 = await run.page.run(`Boolean(document.querySelector('.v2-welcome-card, .v2-shell'))`);
    assert.ok(!run.world.log.some(r => /\/app\/pages\/(?:v2|v2-demo|chat|feed|settings)\.[a-f0-9]{10}\.(?:css|js)$/.test(r.path)));
    assert.equal(hasV2, false, 'v2 markup rendered when switch is off');
    assert.match(await run.page.text(), /Read-only, on the repositories you choose\./);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('v2 switch on + demo: deep links render the new shell, work interactively, and make no network requests', async () => {
  const run = await start();
  try {
    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/feed`);
    await run.page.until(`document.querySelector('main h1')?.textContent === 'Feed'`, 'the demo Feed');
    const v2Attr = await run.page.run('document.documentElement.dataset.v2');
    assert.equal(v2Attr, '1');

    const nav = await run.page.run(`[...document.querySelectorAll('.v2-side a[href^="#/"]')].map(a => a.getAttribute('href'))`);
    assert.deepEqual(nav, ['#/welcome', '#/chat', '#/feed', '#/settings']);
    assert.ok(!nav.includes('#/agents'), 'Agents page must not appear in v2 nav');
    assert.match(await run.page.text(), /Sample data/);
    assert.match(await run.page.text(), /Magic-link sign-in/);

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/feed/2`);
    await run.page.until(`document.body.innerText.includes('Pricing copy on the checkout banner')`, 'the demo decision card');
    assert.match(await run.page.text(), /Show "Save 20%"/);

    await run.page.click('Change something');
    await run.page.until(`document.querySelector('.v2-sheet-input')`, 'the change sheet');
    await run.page.click('Simplify the copy');
    await run.page.click('Send change');
    await run.page.until(`document.body.innerText.includes('Change requested: "Simplify the copy"')`, 'the change note');

    await run.page.click('Ship it');
    await run.page.until(`document.body.innerText.includes('Accepted')`, 'the ship toast');

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/chat`);
    await run.page.until(`document.body.innerText.includes('Accept all 3 recs')`, 'the demo grill round');
    await run.page.click('Accept all 3 recs');
    await run.page.until(`document.body.innerText.includes('Answered · Spec queued in Feed')`, 'the answered grill');

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/settings`);
    await run.page.until(`document.querySelector('main h1')?.textContent === 'Settings'`, 'the demo Settings');
    assert.match(await run.page.text(), /Home Mac Mini/);

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/welcome`);
    await run.page.until(`document.body.innerText.includes('Start Harbor')`, 'the demo Welcome screen');
    await run.page.click('Start Harbor');
    await run.page.until(`document.querySelector('main h1')?.textContent === 'Chat'`, 'Chat after 1 tap from Welcome');

    for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
      await run.page.size(w, h, mobile);
      const overflow = await run.page.run('document.documentElement.scrollWidth - window.innerWidth');
      assert.ok(overflow <= 0, `horizontal overflow at ${w}x${h}: ${overflow}`);
    }

    const network = run.world.log.filter(r => r.origin === API || r.path.startsWith('/api/'));
    assert.deepEqual(network, [], `demo mode made network requests: ${JSON.stringify(network)}`);
    assert.deepEqual(run.world.violations, [], `CSP or runtime violations: ${JSON.stringify(run.world.violations)}`);
  } finally {
    await run.close();
  }
});

test('demo leaves an existing GitHub session isolated and unchanged', async () => {
  const run = await start();
  const storage = 'JSON.stringify(Object.fromEntries(Object.entries(localStorage).sort()))';
  try {
    await signIn(run.page);
    await run.page.click('acme/factory');
    await run.page.until(`Object.values(OW.data.feeds).every(feed => feed.state !== 'loading' && !feed.busy)`, 'the signed-in reads to settle');
    assert.equal(await run.page.run('OW.data.auth.signedIn() && OW.data.repo.get()?.full'), 'acme/factory');
    assert.equal(await run.page.run('OW.data.auth.account()'), null);
    const kept = await run.page.run(storage);
    const afterSignIn = run.world.log.length;

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/feed`);
    await run.page.until(`document.querySelector('main h1')?.textContent === 'Feed'`, 'the sample Feed');
    await run.page.run(`
      Object.defineProperty(document, 'hidden', { value: false });
      document.dispatchEvent(new Event('visibilitychange'));
      OW.data.start();
      OW.data.refreshAll();
      Promise.allSettled([OW.data.github('GET', '/user'), OW.data.repositories()]);
    `);
    await run.page.key('k', 'Ctrl');
    await run.page.key('k', 'Meta');
    assert.equal(await run.page.run("Boolean(document.querySelector('dialog[open]'))"), false);
    assert.doesNotMatch(await run.page.text(), /acme\/factory/);
    assert.equal(await run.page.run(storage), kept);
    assert.deepEqual(run.world.log.slice(afterSignIn).filter(r => r.origin === API || r.path.startsWith('/api/')), []);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});
