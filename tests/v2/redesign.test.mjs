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
    await run.page.run("document.querySelector('.v2-poster').click()");
    await run.page.until(`document.querySelector('dialog[open]')?.textContent.includes('Enter your email')`, 'the local narrated preview');
    await run.page.key('Escape');
    await run.page.tap('Ship it');
    await run.page.until(`document.body.innerText.includes('Shipped · Magic-link sign-in')`, 'the spec was shipped');
    await run.page.tap('Undo');

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/feed/2`);
    await run.page.until(`document.body.innerText.includes('Pricing copy on the checkout banner')`, 'the demo decision card');
    assert.match(await run.page.text(), /Show "Save 20%"/);

    await run.page.tap('Change something');
    await run.page.until(`document.querySelector('dialog[open] .v2-sheet-input')`, 'the change dialog');
    assert.equal(await run.page.run("document.activeElement.matches('.v2-sheet-input')"), true);
    await run.page.key('Escape');
    await run.page.until(`document.activeElement.textContent === 'Change something' && !document.querySelector('dialog[open]')`, 'focus returned to the opener');
    await run.page.tap('Change something');
    await run.page.click('Simplify the copy');
    await run.page.click('Send change');
    await run.page.until(`document.body.innerText.includes('Change requested: "Simplify the copy"')`, 'the change note');

    await run.page.click('Ship it');
    await run.page.until(`document.body.innerText.includes('Accepted')`, 'the ship toast');

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/chat`);
    await run.page.until(`document.body.innerText.includes('Accept all 3')`, 'the demo grill round');
    await run.page.size(390, 844, true);
    assert.equal(await run.page.run(`(() => {
      const action = document.querySelector('.v2-question-foot button').getBoundingClientRect();
      const scroll = document.querySelector('.v2-chat-scroll').getBoundingClientRect();
      return action.height >= 44 && action.top >= scroll.top && action.bottom <= scroll.bottom;
    })()`), true, 'the chat action fits above the composer at 390×844');
    await run.page.run("document.querySelector('.v2-composer-input').focus()");
    await run.page.type('Half written');
    await run.page.run('OW.demo.notify()');
    assert.equal(await run.page.run('document.activeElement.value'), 'Half written');
    await run.page.click('Accept all 3');
    await run.page.until(`document.body.innerText.includes('Answered · Spec queued in Feed')`, 'the answered questions');

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/settings`);
    await run.page.until(`document.querySelector('main h1')?.textContent === 'Settings'`, 'the demo Settings');
    assert.match(await run.page.text(), /Home computer/);
    await run.page.run(`[...document.querySelectorAll('summary')].find(summary => summary.textContent.startsWith('Budget')).click()`);
    assert.equal(await run.page.run(`document.querySelectorAll('details[open] input[type="range"]').length`), 2);

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/welcome`);
    await run.page.until(`document.body.innerText.includes('Open sample workspace')`, 'the demo Welcome screen');
    await run.page.click('Open sample workspace');
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

test('real Feed can refresh an unavailable read and Settings stays available', async () => {
  const run = await start();
  try {
    await run.page.go(`${SITE}/app/?v2=on`);
    await run.page.until(`document.querySelector('.v2-welcome-card')`, 'the real welcome screen');
    assert.match(await run.page.text(), /Continue with GitHub/);
    assert.equal(await run.page.run("document.querySelectorAll('.v2-welcome-card .v2-btn-primary').length"), 1);
    await signIn(run.page);
    await run.page.click('acme/factory');
    await run.page.until(`document.body.innerText.includes('Press Refresh now')`, 'the unavailable Feed');
    const reads = () => run.world.log.filter(r => r.path === '/graphql' && r.body.includes('query Specs(')).length;
    const before = reads();
    await run.page.tap('Refresh now');
    await run.page.until(`!OW.data.feeds.specs.busy`, 'the retry to finish');
    assert.equal(reads(), before + 1);
    assert.equal(await run.page.run('document.activeElement.textContent'), 'Refresh now');

    await run.page.key('k', 'Ctrl');
    await run.page.until(`OW.palette.shown()`, 'the real palette');
    const results = await run.page.run("document.querySelector('#palette-results').textContent");
    assert.match(results, /Chat/);
    assert.doesNotMatch(results, /Show only (?:specs|tickets|agents)|Go to (?:Specs|You|Agents)/i);
    await run.page.key('Escape');

    await run.page.go(`${SITE}/app/#/settings`);
    await run.page.until(`document.querySelector('.v2-settings')`, 'Settings despite unavailable specs');
    assert.match(await run.page.text(), /Sign out/);
    assert.doesNotMatch(await run.page.text(), /0\.02|Model providers|Home computer|Balanced/);
    await run.page.run(`[...document.querySelectorAll('summary')].find(summary => summary.textContent.startsWith('Repository')).click()`);
    await run.page.click('Switch repository');
    await run.page.until(`document.querySelector('h1')?.textContent === 'Pick a repository'`, 'the working repository picker');
    assert.deepEqual(run.world.writes(), []);
  } finally {
    await run.close();
  }
});
