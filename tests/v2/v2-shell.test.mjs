import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, signIn, start } from './browser.mjs';

const apiRequests = world => world.log.filter(r => r.origin !== SITE || r.path.startsWith('/api/'));
const withoutFingerprint = path => path.replace(/\.[a-f0-9]{10}(?=\.(?:css|js)$)/, '');
const mainStyles = ['/app/ember.css', '/app/pages/queue.css', '/app/cards/decision.css'];
const mainScripts = [
  '/app/data.js', '/app/records.js', '/app/ui.js', '/app/pages/you.js', '/app/pages/queue.js',
  '/app/pages/specs.js', '/app/vendor/dagre-3.1.3.min.js', '/app/pages/spec.js', '/app/pages/agents.js',
  '/app/cards/decision.js', '/app/palette.js', '/app/shell.js',
];

test('switch off: none of the v2 shell renders and demo=1 is ignored', async () => {
  const run = await start();
  try {
    await run.page.go(`${SITE}/app/?demo=1#/feed`);
    await run.page.until(`document.body.innerText.includes('Sign in with GitHub')`, 'v1 signed-out screen');
    const v2Attr = await run.page.run(`document.documentElement.dataset.v2 ?? null`);
    assert.equal(v2Attr, null);
    assert.equal(await run.page.run(`Boolean(document.querySelector('.v2-shell, .v2-welcome-card'))`), false);
    assert.match(await run.page.text(), /Read-only, on the repositories you choose\./);
    const styles = await run.page.run(`[...document.querySelectorAll('link[rel="stylesheet"]')].map(el => el.getAttribute('href'))`);
    const scripts = await run.page.run(`[...document.scripts].map(el => el.getAttribute('src'))`);
    assert.deepEqual(styles.map(withoutFingerprint), mainStyles);
    assert.deepEqual(scripts.map(withoutFingerprint), mainScripts);
    const requested = run.world.log.map(r => r.path).filter(path => /\.(?:css|js)$/.test(path));
    assert.deepEqual(requested.map(withoutFingerprint).sort(), [...mainStyles, ...mainScripts].sort());
    assert.deepEqual(apiRequests(run.world), []);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('switch on + demo=1: renders v2 shell, deep links, interactions, and makes zero network requests', async () => {
  const run = await start();
  try {
    await run.page.go(`${SITE}/app/?v2=on&demo=1#/welcome`);
    await run.page.until(`document.body.innerText.includes('Run your software factory from here.')`, 'v2 welcome screen');
    assert.equal(await run.page.run(`document.documentElement.dataset.v2`), '1');
    assert.equal(await run.page.run(`document.querySelector('.v2-sample-tag').textContent`), 'Sample data');
    assert.equal(await run.page.run(`document.querySelector('.v2-welcome-sample').getAttribute('href')`), '/api/sign-in/start');

    await run.page.click('Open Harbor workspace');
    await run.page.until(`location.hash === '#/chat' && document.body.innerText.includes('Accept all 3')`, 'v2 chat with grill round');
    const nav = await run.page.run(`[...document.querySelectorAll('nav.main a')].map(a => a.getAttribute('href'))`);
    assert.deepEqual(nav, ['#/chat', '#/feed', '#/settings']);

    await run.page.run(`window.originalMessages = [...document.querySelector('.v2-chat-thread').children];
      window.originalChoices = [...document.querySelectorAll('.v2-q-pill')];
      document.querySelector('.v2-composer input').focus()`);
    await run.page.type('An unfinished idea');
    await run.page.click('Right away');
    assert.equal(await run.page.run(`document.activeElement.value`), 'An unfinished idea');
    assert.equal(await run.page.run(`window.originalChoices.every((choice, i) =>
      choice === document.querySelectorAll('.v2-q-pill')[i])`), true, 'answering replaced question controls');
    assert.equal(await run.page.run(`window.originalChoices[1].getAttribute('aria-pressed')`), 'true');
    await run.page.run(`document.querySelector('.v2-q-pill').click()`);
    await run.page.click('Accept all 3');
    await run.page.until(`document.body.innerText.includes('Answers saved · Open Feed')`, 'grill accepted');
    assert.equal(await run.page.run(`window.originalMessages.every((message, i) =>
      message === document.querySelector('.v2-chat-thread').children[i])`), true, 'accepting replayed the thread');
    assert.equal(await run.page.run(`document.querySelector('.v2-chat-thread').children.length`), 5);

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/feed`);
    await run.page.until(`document.body.innerText.includes('Magic-link sign-in')`, 'feed spec card');
    await run.page.tap('Change something');
    await run.page.until(`document.querySelector('.v2-sheet')?.matches(':modal')`, 'the change dialog');
    await run.page.key('Escape');
    await run.page.until(`document.activeElement.dataset.focus === 'change'`, 'focus returned to the change button');
    await run.page.tap('Change something');
    await run.page.type('Make the link last ten minutes');
    await run.page.tap('Send change');
    await run.page.until(`location.hash === '#/feed/2' && document.activeElement.textContent === 'Keep the free plan?'`, 'a change advances to the next card and focuses its title');
    assert.equal(await run.page.run(`document.querySelector('.v2-toast').hidden`), false);
    await run.page.click('Chat');
    await run.page.until(`document.querySelector('.v2-toast').hidden`, 'route change dismisses the toast');
    await run.page.until(`document.body.innerText.includes('Make the link last ten minutes')`, 'change request recorded in Chat');
    await run.page.go(`${SITE}/app/?demo=1#/feed/clear`);
    await run.page.until(`document.querySelector('.v2-building')?.textContent.includes('Magic-link sign-in')`, 'revised spec moved to Building');

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/feed/2`);
    await run.page.until(`document.querySelector('.v2-card-title')?.textContent === 'Keep the free plan?'`, 'deep link to decision card');
    assert.equal(await run.page.run(`document.querySelector('#v2-recommended').textContent`), 'Recommended');
    assert.equal((await run.page.text()).match(/Keep it, cap at 3 seats/g)?.length, 1);
    assert.equal(await run.page.run(`document.querySelector('.v2-hero-card .v2-preview')`), null);
    assert.equal(await run.page.run(`document.querySelector('.v2-hero-card button.primary').textContent`), 'Keep it, cap at 3 seats');
    await run.page.tap('Change something');
    await run.page.tap('Simplify copy');
    await run.page.tap('Send change');
    await run.page.until(`location.hash === '#/feed/3' && !document.querySelector('.v2-toast').hidden`, 'decision change advances with Undo');
    await run.page.tap('Undo');
    await run.page.until(`document.querySelector('.v2-card-title')?.textContent === 'Keep the free plan?'`, 'Undo restores the changed decision');
    await run.page.click('Chat');
    await run.page.until(`document.querySelector('.v2-chat-thread')`, 'back in Chat after Undo');
    assert.doesNotMatch(await run.page.text(), /Simplify the copy to one line/);
    await run.page.go(`${SITE}/app/?demo=1#/feed`);
    const badges = () => run.page.run(`[...document.querySelectorAll('a[href="#/feed"] .v2-badge')].map(badge => badge.hidden ? null : badge.textContent)`);
    await run.page.until(`document.querySelector('.v2-card-title')?.textContent === 'Magic-link sign-in'`, 'spec card to ship');
    assert.deepEqual(await badges(), ['3', '3']);
    await run.page.click('Ship it');
    await run.page.until(`document.querySelector('.v2-card-title')?.textContent === 'Keep the free plan?'`, 'advances after shipping');
    assert.deepEqual(await badges(), ['2', '2']);
    await run.page.click('Keep it, cap at 3 seats');
    await run.page.until(`document.querySelector('.v2-card-title')?.textContent === 'Retention window for deleted projects'`, 'next decision');
    assert.deepEqual(await badges(), ['1', '1']);
    await run.page.click('Not now');
    await run.page.until(`location.hash === '#/feed/clear' && document.querySelector('.v2-clear-card h2')?.textContent === 'All clear.'`, 'all clear after the last decision');
    assert.deepEqual(await badges(), [null, null]);
    assert.equal(await run.page.run(`document.querySelector('.v2-building progress').value`), 5);
    await run.page.run(`document.querySelector('.v2-toast button').focus()`);
    await new Promise(resolve => setTimeout(resolve, 4700));
    assert.equal(await run.page.run(`document.querySelector('.v2-toast').hidden`), false, 'Undo expired while focused');
    await run.page.key('Enter');
    await run.page.until(`document.querySelector('.v2-card-title')?.textContent === 'Retention window for deleted projects'`, 'undo restores the last decision');
    assert.deepEqual(await badges(), ['1', '1']);
    await run.page.click('Allow recovery for 30 days');
    await run.page.until(`location.hash === '#/feed/clear' && document.querySelector('.v2-lighthouse')`, 'approving the final decision clears Feed');
    assert.deepEqual(await badges(), [null, null]);
    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/feed/clear`);
    await run.page.until(`document.querySelector('.v2-clear-card h2')?.textContent === 'All clear.'`, 'deep link to all clear');
    assert.deepEqual(await badges(), [null, null]);

    await run.page.size(1440, 900, false);
    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/settings`);
    await run.page.until(`document.querySelector('.v2-setting-value')?.textContent === 'Home computer'`, 'settings screen');
    const stored = () => run.page.run('JSON.stringify(localStorage)');
    const beforeSettings = await stored();
    await run.page.tap('ModelsRecommended');
    await run.page.until(`document.querySelector('.v2-setting-panel')?.matches(':popover-open')`, 'desktop settings popover');
    assert.equal(await run.page.run(`document.activeElement.textContent`), 'Recommended');
    await run.page.run(`document.querySelector('.v2-models summary').click()`);
    assert.match(await run.page.text(), /Claude Sonnet/);
    assert.equal(await run.page.run(`document.querySelector('.v2-models').open`), true);
    await run.page.key('Escape');
    await run.page.until(`document.activeElement.classList.contains('v2-setting-trigger') &&
      !document.querySelector('.v2-setting-panel')`, 'Escape closes the popover and returns focus');
    await run.page.tap('Where it runsHome computer');
    await run.page.tap('Cloud workspace');
    await run.page.until(`document.querySelector('.v2-setting-value')?.textContent === 'Cloud workspace' &&
      document.querySelector('.v2-toast')?.textContent === 'Saved'`, 'setting saved');

    await run.page.size(390, 844, true);
    await run.page.tap('ConnectionsGitHub connected');
    await run.page.until(`document.querySelector('.v2-setting-panel')?.matches(':modal')`, 'phone settings sheet');
    assert.equal(await run.page.run(`document.querySelector('.v2-setting-option[aria-pressed="true"]').textContent`), 'GitHubConnected');
    await run.page.tap('NotificationsNot connected');
    await run.page.until(`!document.querySelector('.v2-setting-panel')`, 'connection saved');
    await run.page.tap('Connections2 connected');
    const enabled = await run.page.run(`[...document.querySelectorAll('.v2-setting-option[aria-pressed="true"]')].map(el => el.textContent)`);
    assert.deepEqual(enabled, ['GitHubConnected', 'NotificationsConnected']);
    await run.page.key('Escape');
    await run.page.click('Chat');
    await run.page.until(`location.hash === '#/chat'`, 'left Settings');
    await run.page.click('Settings');
    await run.page.until(`document.querySelector('.v2-setting-value')?.textContent === 'Cloud workspace'`, 'settings retained while navigating');
    assert.equal(await stored(), beforeSettings, 'sample settings should remain in memory');

    assert.deepEqual(apiRequests(run.world), [], 'demo mode sent an API or external network request');
    assert.deepEqual(await run.page.run(`performance.getEntriesByType('resource').filter(entry =>
      ['fetch', 'xmlhttprequest', 'beacon'].includes(entry.initiatorType)).map(entry => entry.name)`), []);
    assert.deepEqual(run.world.writes(), [], 'demo mode wrote something');
    assert.deepEqual(run.world.violations, [], 'demo mode hit a CSP or console violation');
    await run.page.click('Exit sample workspace');
    await run.page.until(`location.pathname === '/app/' && !location.search && OW.data.demo === false
      && document.querySelector('.v2-welcome-sample')?.textContent === 'See a sample factory'`, 'exiting reaches the real welcome');
  } finally {
    await run.close();
  }
});


test('a fresh sample workspace opens on the grill and ships in three taps at 390px', async () => {
  const run = await start();
  try {
    await run.page.size(390, 844, true);
    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1`);
    await run.page.until(`location.hash === '#/chat' && document.querySelector('.v2-grill-foot button')`, 'first grill without a tap');
    const accept = await run.page.run(`(() => {
      const bounds = document.querySelector('.v2-grill-foot button').getBoundingClientRect();
      const scroll = document.querySelector('.v2-chat-scroll').getBoundingClientRect();
      return bounds.top >= scroll.top && bounds.bottom <= scroll.bottom;
    })()`);
    assert.equal(accept, true, 'Accept all fits in the first phone view');
    await run.page.tap('Accept all 3');
    await run.page.tap('Answers saved · Open Feed');
    await run.page.until(`location.hash === '#/feed' && document.querySelector('.v2-card-title')?.textContent === 'Magic-link sign-in'`, 'first ready spec');
    const inFrame = await run.page.run(`(() => {
      const view = document.querySelector('.v2-view');
      const last = document.querySelector('.v2-building li:last-child');
      view.scrollTop = view.scrollHeight;
      return view.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom;
    })()`);
    assert.ok(inFrame >= 31, 'the final Building row has 32px of scroll clearance');
    await run.page.tap('Ship it');
    await run.page.until(`location.hash === '#/feed/2' && document.querySelector('.v2-toast')?.textContent.includes('Shipped')`, 'shipped after three taps');
    assert.equal(await run.page.run('document.documentElement.scrollWidth'), 390);
    assert.deepEqual(apiRequests(run.world), []);
    assert.deepEqual(run.world.writes(), []);
    assert.deepEqual(run.world.violations, []);
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
