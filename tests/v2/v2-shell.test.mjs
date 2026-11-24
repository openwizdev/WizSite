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
    const assets = await run.page.run(`['link[rel="stylesheet"]', 'script[src]'].map(selector =>
      [...document.querySelectorAll(selector)].map(el => new URL(el.href || el.src).pathname))`);
    const unfingerprint = path => path.replace(/\.[a-f0-9]{10}(?=\.(?:css|js)$)/, '');
    const mainAssets = [
      ['/app/ember.css', '/app/pages/queue.css', '/app/cards/decision.css'],
      [
        '/app/data.js', '/app/records.js', '/app/ui.js', '/app/pages/you.js', '/app/pages/queue.js',
        '/app/pages/specs.js', '/app/vendor/dagre-3.1.3.min.js', '/app/pages/spec.js', '/app/pages/agents.js',
        '/app/cards/decision.js', '/app/palette.js', '/app/shell.js',
      ],
    ];
    assert.deepEqual(assets.map(group => group.map(unfingerprint)), mainAssets);
    const requested = run.world.log.filter(r => /\.(css|js)$/.test(r.path)).map(r => unfingerprint(r.path));
    assert.deepEqual(requested.sort(), mainAssets.flat().sort());
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
    await run.page.size(1440, 900, false);
    await run.page.go(`${SITE}/app/?v2=on&demo=1#/welcome`);
    await run.page.until(`document.body.innerText.includes('Run your software factory from here.')`, 'v2 welcome screen');
    assert.equal(await run.page.run(`document.documentElement.dataset.v2`), '1');
    assert.equal(await run.page.run(`document.querySelector('.v2-sample-tag').textContent`), 'Sample data');
    assert.deepEqual(await run.page.run(`[...document.querySelectorAll('.v2-welcome-card a')].map(a => a.getAttribute('href'))`), ['#/chat']);

    await run.page.tap('Open Harbor workspace');
    await run.page.until(`location.hash === '#/chat' && document.body.innerText.includes('Accept all 3')`, 'v2 chat with grill round');
    const nav = await run.page.run(`[...document.querySelectorAll('nav.main a')].map(a => a.getAttribute('href'))`);
    assert.deepEqual(nav, ['#/chat', '#/feed', '#/settings']);
    assert.equal(await run.page.run(`(() => {
      const summary = document.querySelector('.v2-chat-summary').getBoundingClientRect();
      const thread = document.querySelector('.v2-chat-thread').getBoundingClientRect();
      return summary.left > thread.right && summary.width > 0;
    })()`), true, 'the desktop chat summary is beside the thread');

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
    await run.page.tap('Accept all 3');
    await run.page.until(`document.body.innerText.includes('Answers saved · Open Feed')`, 'grill accepted');
    assert.equal(await run.page.run(`window.originalMessages.every((message, i) =>
      message === document.querySelector('.v2-chat-thread').children[i])`), true, 'accepting replayed the thread');
    assert.equal(await run.page.run(`document.querySelector('.v2-chat-thread').children.length`), 5);

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/feed`);
    await run.page.until(`document.body.innerText.includes('Magic-link sign-in')`, 'feed spec card');
    assert.equal(await run.page.run(`(() => {
      const bounds = selector => document.querySelector(selector).getBoundingClientRect();
      const card = bounds('.v2-spec-card');
      const context = bounds('.v2-feed-context');
      return card.width >= 640 && card.width <= 720 && card.top === context.top
        && card.right < context.left && bounds('.v2-building').bottom < bounds('.v2-view').bottom;
    })()`), true, 'desktop Feed has room for the card and all Building rows');
    await run.page.size(390, 844, false);
    assert.equal(await run.page.run(`(() => {
      const bounds = selector => document.querySelector(selector).getBoundingClientRect();
      return document.documentElement.scrollWidth === 390
        && bounds('.v2-building').bottom <= bounds('.v2-tabs').top
        && bounds('.v2-pips').width === bounds('.v2-preview').width
        && document.querySelector('.v2-view').scrollHeight > document.querySelector('.v2-view').clientHeight;
    })()`), true, 'phone Feed fits above the tabs and can scroll inside the window');
    await run.page.tap('Change something');
    await run.page.until(`document.querySelector('.v2-sheet')?.matches(':modal')`, 'the change dialog');
    await run.page.key('Escape');
    await run.page.until(`document.activeElement.dataset.focus === 'change'`, 'focus returned to the change button');
    await run.page.tap('Change something');
    await run.page.tap('Simplify copy');
    await run.page.tap('Send change');
    await run.page.until(`location.hash === '#/feed/2' && document.activeElement.textContent === 'Keep the free plan?'`, 'a change advances to the next card and focuses its title');
    await run.page.go(`${SITE}/app/?demo=1#/chat`);
    await run.page.until(`document.body.innerText.includes('Simplify the copy to one line')`, 'change request recorded in Chat');
    await run.page.go(`${SITE}/app/?demo=1#/feed/clear`);
    await run.page.until(`document.querySelector('.v2-building')?.textContent.includes('Magic-link sign-in')`, 'revised spec moved to Building');

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/feed/2`);
    await run.page.until(`document.querySelector('.v2-card-title')?.textContent === 'Keep the free plan?'`, 'deep link to decision card');
    assert.match(await run.page.text(), /Recommended: Keep it, cap at 3 seats/);
    assert.equal(await run.page.run(`document.querySelector('.v2-hero-card .v2-preview')`), null);
    await run.page.go(`${SITE}/app/?demo=1#/feed`);
    const badges = () => run.page.run(`[...document.querySelectorAll('a[href="#/feed"] .v2-badge')].map(badge => badge.hidden ? null : badge.textContent)`);
    await run.page.until(`document.querySelector('.v2-card-title')?.textContent === 'Magic-link sign-in'`, 'spec card to ship');
    assert.deepEqual(await badges(), ['3', '3']);
    await run.page.tap('Ship it');
    await run.page.until(`document.querySelector('.v2-card-title')?.textContent === 'Keep the free plan?'`, 'advances after shipping');
    assert.deepEqual(await badges(), ['2', '2']);
    await run.page.click('Change something');
    await run.page.type('Review the seat cap again');
    await run.page.tap('Send change');
    await run.page.until(`location.hash === '#/feed/3' && !document.querySelector('.v2-toast').hidden`, 'the decision change can be undone');
    await run.page.tap('Undo');
    await run.page.until(`location.hash === '#/feed/2' && document.activeElement.textContent === 'Keep the free plan?'`, 'undo restores the decision');
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
    await run.page.click('Settings');
    await run.page.until(`location.hash === '#/settings' && document.querySelector('.v2-toast').hidden`, 'changing routes dismisses Undo');
    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/feed/clear`);
    await run.page.until(`document.querySelector('.v2-clear-card h2')?.textContent === 'All clear.'`, 'deep link to all clear');
    assert.deepEqual(await badges(), [null, null]);

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/settings`);
    await run.page.until(`document.querySelector('select[aria-label="Where it runs"]')?.value === 'Local workstation'`, 'settings screen');
    await run.page.tap('Not connected');
    assert.equal(await run.page.run(`document.querySelector('[aria-label="Notifications"]').getAttribute('aria-checked')`), 'true');

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
