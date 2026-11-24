import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, signIn, start } from './browser.mjs';

const apiRequests = world => world.log.filter(r => r.origin !== SITE || r.path.startsWith('/api/'));
const sample = route => `${SITE}/app/?v2=dry-run&demo=1#/${route}`;

test('switch off: none of the v2 shell or assets load and demo=1 is ignored', async () => {
  const run = await start();
  try {
    await run.page.go(`${SITE}/app/?demo=1#/feed`);
    await run.page.until(`document.body.innerText.includes('Sign in with GitHub')`, 'v1 signed-out screen');
    assert.equal(await run.page.run(`document.documentElement.dataset.v2 ?? null`), null);
    assert.equal(await run.page.run(`Boolean(document.querySelector('.v2-shell, .v2-welcome-card'))`), false);
    assert.match(await run.page.text(), /Read-only, on the repositories you choose\./);
    assert.deepEqual(run.world.log.filter(r => r.path.startsWith('/app/pages/v2.')), []);
    assert.deepEqual(apiRequests(run.world), []);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('signed-out v2 has one primary action and the sample link opens the first questions', async () => {
  const run = await start();
  try {
    await run.page.go(`${SITE}/app/?v2=on#/welcome`);
    await run.page.until(`document.querySelector('.v2-welcome-card')`, 'signed-out v2 welcome');
    assert.deepEqual(await run.page.run(`[...document.querySelectorAll('.v2-btn.primary')].map(a => [a.textContent, a.getAttribute('href')])`),
      [['Continue with GitHub', '/api/sign-in/start']]);
    await run.page.tap('See a sample factory');
    await run.page.until(`location.hash === '#/chat' && document.body.innerText.includes('Accept all 3')`, 'sample questions in one tap');
    assert.deepEqual(apiRequests(run.world), []);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('demo: complete the sample walkthrough, preserve drafts, and make zero API requests', async () => {
  const run = await start();
  try {
    await run.page.size(390, 844, true);
    await run.page.go(sample('welcome'));
    await run.page.until(`document.body.innerText.includes('Run your software factory from here.')`, 'v2 welcome screen');
    assert.equal(await run.page.run(`document.documentElement.dataset.v2`), '1');
    assert.match(await run.page.text(), /Sample data/);

    await run.page.tap('Open Harbor workspace');
    await run.page.until(`location.hash === '#/chat' && document.body.innerText.includes('Accept all 3')`, 'ready-to-answer Chat');
    const nav = await run.page.run(`[...document.querySelectorAll('nav.main a')].map(a => a.getAttribute('href'))`);
    assert.deepEqual(nav, ['#/chat', '#/feed', '#/settings']);
    assert.equal(await run.page.run(`(() => {
      const btn = document.querySelector('.v2-grill-foot button').getBoundingClientRect();
      const composer = document.querySelector('.v2-composer-wrap').getBoundingClientRect();
      const first = document.querySelector('.v2-msg').getBoundingClientRect();
      return btn.bottom <= composer.top && first.top >= document.querySelector('.v2-head').getBoundingClientRect().bottom
        && document.documentElement.scrollWidth === innerWidth;
    })()`), true, 'the whole round and composer should fit at 390×844');
    await run.page.run(`document.querySelector('.v2-composer input').focus()`);
    await run.page.type('Keep my draft');
    await run.page.tap('Right away');
    assert.equal(await run.page.run(`document.activeElement.textContent`), 'Right away');
    await run.page.tap('At month end');
    await run.page.tap('Accept all 3');
    await run.page.until(`location.hash === '#/feed' && document.querySelector('.v2-card-title')?.textContent === 'Usage-based seat billing'`, 'accepted answers open the resulting spec');
    await run.page.tap('Chat');
    await run.page.until(`document.querySelector('.v2-composer input')`, 'return to Chat');
    assert.equal(await run.page.run(`document.querySelector('.v2-composer input').value`), 'Keep my draft');
    await run.page.tap('Feed');
    await run.page.until(`document.querySelector('.v2-card-actions')`, 'return to Feed');
    await run.page.tap('Change something');
    await run.page.until(`document.querySelector('.v2-sheet:modal') && document.activeElement.matches('.v2-sheet-input')`, 'change dialog and focus');
    await run.page.key('Escape');
    assert.equal(await run.page.run(`document.activeElement.textContent`), 'Change something');
    await run.page.tap('Change something');
    await run.page.tap('Make it smaller');
    await run.page.tap('Send change');
    await run.page.until(`document.body.innerText.includes('Requested change: Split this into a smaller first release.')`, 'change attached to the spec');
    assert.equal(await run.page.run(`document.activeElement.textContent`), 'Change something');
    await run.page.tap('Ship it');
    await run.page.until(`document.querySelector('.v2-card-title')?.textContent === 'Magic-link sign-in'`, 'advances after shipping');

    await run.page.go(sample('feed/2'));
    await run.page.until(`document.querySelector('.v2-card-title')?.textContent === 'Pricing copy on the checkout banner'`, 'deep link to decision card');
    assert.match(await run.page.text(), /Show "Save 20%"/);
    await run.page.tap('Settings');
    await run.page.until(`document.body.innerText.includes('Where it runs') && document.body.innerText.includes('Local computer')`, 'settings screen');
    const signOut = await run.page.run(`(() => {
      const link = document.querySelector('.v2-panel a');
      link.scrollIntoView({ block: 'end' });
      return link.getBoundingClientRect().bottom <= document.querySelector('.v2-tabs').getBoundingClientRect().top;
    })()`);
    assert.equal(signOut, true, 'settings scroll to the repository controls');

    assert.deepEqual(apiRequests(run.world), []);
    assert.deepEqual(run.world.writes(), []);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('demo with a saved sign-in and repository never queries GitHub or opens the palette', async () => {
  const run = await start();
  try {
    await signIn(run.page);
    await run.page.click('acme/factory');
    await run.page.until(`location.hash === '#/you' && Object.values(OW.data.feeds).every(feed => !feed.busy && feed.state !== 'loading')`, 'a signed-in session with a selected repository');
    const saved = await run.page.run(`[OW.data.auth.get(), OW.data.repo.get()]`);
    assert.equal(saved[0].account, null, 'the saved session still needs a v2 account lookup');
    assert.ok(saved[0].token && saved[1].full);
    const beforeDemo = run.world.log.length;
    await run.page.go(sample('feed'));
    await run.page.until(`document.querySelector('.v2-card-title')?.textContent === 'Magic-link sign-in'`, 'sample Feed');
    await run.page.run(`(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      OW.data.start();
      OW.data.refreshAll();
      return Promise.allSettled([OW.data.repositories(), OW.data.github('GET', '/user')]);
    })()`);
    await run.page.key('k', 'Ctrl');
    await run.page.key('k', 'Meta');
    assert.equal(await run.page.run(`OW.palette.shown()`), false);
    assert.equal(await run.page.run(`document.body.innerText.includes('acme/factory')`), false);
    assert.deepEqual(await run.page.run(`[OW.data.auth.get(), OW.data.repo.get()]`), saved);
    const demoRequests = apiRequests({ log: run.world.log.slice(beforeDemo) });
    assert.deepEqual(demoRequests, []);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('real v2 Settings works when Specs is unknown and the palette only offers live routes', async () => {
  const run = await start();
  try {
    await signIn(run.page);
    await run.page.click('acme/factory');
    await run.page.go(`${SITE}/app/?v2=dry-run#/settings`);
    await run.page.until(`document.querySelector('.v2-panel .repo') && OW.data.feeds.specs.state === 'unknown'`, 'settings with a failed Specs read');
    assert.match(await run.page.text(), /Coming soon/);
    assert.match(await run.page.text(), /Sign out/);
    assert.doesNotMatch(await run.page.text(), /Balanced|0\.02|Local computer|Agents/);
    await run.page.key('k', 'Ctrl');
    await run.page.until(`OW.palette.shown()`, 'command palette');
    assert.doesNotMatch(await run.page.text(), /Show only (specs|tickets|agents)/i);
    await run.page.type('Feed');
    await run.page.key('Enter');
    await run.page.until(`location.hash === '#/feed' && document.body.innerText.includes('Refresh now')`, 'Feed with the refresh control');
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});
