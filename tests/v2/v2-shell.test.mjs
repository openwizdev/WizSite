import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SITE, signIn, start } from './browser.mjs';

const FLEET = JSON.parse(await readFile(new URL('fixtures/queue/grill-round.json', import.meta.url), 'utf8')).fleet;

const apiRequests = world => world.log.filter(r => r.origin !== SITE || r.path.startsWith('/api/'));
const withoutFingerprint = path => path.replace(/\.[a-f0-9]{10}(?=\.(?:css|js)$)/, '');
const mainStyles = ['/app/ember.css', '/wiz-loader/wiz-loader.css', '/app/pages/queue.css', '/app/pages/canvas.css', '/app/cards/decision.css'];
const mainScripts = [
  '/wiz-loader/wiz-loader.js', '/app/data.js', '/app/records.js', '/app/ui.js', '/app/pages/you.js', '/app/pages/queue.js',
  '/app/pages/specs.js', '/app/vendor/dagre-3.1.3.min.js', '/app/pages/spec.js', '/app/pages/agents.js',
  '/app/pages/canvas.js', '/app/pages/models.js', '/app/cards/decision.js', '/app/palette.js', '/app/shell.js',
];

test('switch off: main’s assets, navigation and startup requests are kept, and demo=1 is ignored', async () => {
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

    await signIn(run.page);
    await run.page.click('acme/factory');
    await run.page.until(`document.querySelector('main h1')?.textContent === 'You' &&
      Object.values(OW.data.feeds).every(feed => !feed.busy && feed.state !== 'loading')`, 'the legacy startup reads');
    const nav = await run.page.run(`['nav.main', 'nav.tabs'].map(selector =>
      [...document.querySelectorAll(selector + ' a')].map(link => link.getAttribute('href')))`);
    const mainNav = ['#/you', '#/specs', '#/agents', '#/canvas', '#/models'];
    assert.deepEqual(nav, [mainNav, mainNav]);
    await run.page.click('Models');
    await run.page.until(`location.hash === '#/models' && document.querySelector('main h1')?.textContent === 'Models'`, 'the Models page');
    const startup = apiRequests(run.world).filter(r => r.method !== 'OPTIONS').map(r => {
      const operation = r.path === '/graphql' ? JSON.parse(r.body).query.match(/\bquery\s+(\w+)/)[1] : '';
      return [r.method, r.url, operation];
    });
    assert.deepEqual(startup.sort(), [
      ['GET', 'https://api.github.com/user/installations/1001/repositories?per_page=100', ''],
      ['GET', 'https://api.github.com/user/installations?per_page=100', ''],
      ['POST', 'https://api.github.com/graphql', 'Agents'],
      ['POST', 'https://api.github.com/graphql', 'Models'],
      ['POST', 'https://api.github.com/graphql', 'Specs'],
      ['POST', `${SITE}/api/sign-in/token`, ''],
    ]);
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
    assert.equal(await run.page.run(`document.querySelector('.v2-welcome-sample').textContent`), 'Continue with GitHub');
    assert.equal(await run.page.run(`document.querySelector('.v2-welcome-sample').getAttribute('href')`), '/api/sign-in/start');
    assert.doesNotMatch(await run.page.text(), /Exit sample workspace/);

    await run.page.click('Open Harbor workspace');
    await run.page.until(`location.hash === '#/chat' && document.body.innerText.includes('Accept all 3')`, 'v2 chat with grill round');
    const nav = await run.page.run(`[...document.querySelectorAll('nav.main a')].map(a => a.getAttribute('href'))`);
    assert.deepEqual(nav, ['#/chat', '#/feed', '#/canvas', '#/settings']);

    await run.page.run(`window.originalMessages = [...document.querySelector('.v2-chat-thread').children];
      window.originalChoices = [...document.querySelectorAll('.v2-q-pill')];
      document.querySelector('.v2-composer textarea').focus()`);
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
    assert.equal(await run.page.run(`document.querySelector('.v2-recommendation')`), null);
    assert.equal(await run.page.run(`document.querySelector('.v2-rec-tag')?.textContent`), 'Recommended');
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
    assert.deepEqual(await run.page.run(`[...document.querySelectorAll('.v2-build-card')].map(card => [card.getAttribute('href'), card.querySelectorAll('.cv-blocks i').length, card.querySelector('.cv-sheet-line').textContent])`),
      [['#/canvas/201', 7, '1\u00a0building · 5\u00a0of\u00a07\u00a0done'], ['#/canvas/221', 4, '1\u00a0building · 1\u00a0in\u00a0review · 2\u00a0of\u00a04\u00a0done']]);
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

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/canvas`);
    await run.page.until(`document.querySelectorAll('.cv-stack').length === 7`, 'the sample board');
    assert.equal(await run.page.run(`document.querySelector('.cv-title h2').textContent`), '#201 Audit log export');
    assert.deepEqual(await run.page.run(`[...document.querySelectorAll('.cv-rail .cv-sheet-name')].map(name => name.textContent)`),
      ['#201 Audit log export', '#221 Project activity digest', '#211 Magic-link sign-in']);
    assert.equal(await run.page.run(`[...document.querySelectorAll('.cv a')].some(link => /^https?:/.test(link.getAttribute('href')))`), false, 'the sample board links off the app');

    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/settings`);
    const hostValue = `document.querySelector('.v2-setting-trigger .v2-setting-value')?.textContent`;
    await run.page.until(`${hostValue} === 'Local workstation'`, 'settings screen');
    assert.equal(await run.page.run(`document.querySelectorAll('select, [role="switch"]').length`), 0);
    const openRow = name => run.page.run(`[...document.querySelectorAll('.v2-setting-trigger')]
      .find(el => el.querySelector('.v2-setting-label').textContent === ${JSON.stringify(name)}).click()`);
    await openRow('Where it runs');
    await run.page.until(`document.querySelector('.v2-setting-panel [aria-pressed="true"]')?.textContent === 'Local workstation'`, 'settings choices open with the current one checked');
    await run.page.click('Cloud workspace');
    await run.page.until(`${hostValue} === 'Cloud workspace' && !document.querySelector('.v2-setting-panel')
      && document.querySelector('.v2-toast:not([hidden])')?.textContent === 'Saved'`, 'choosing applies the setting with a Saved toast');
    await openRow('Connections');
    await run.page.until(`document.querySelector('.v2-setting-panel')`, 'connections choices');
    await run.page.run(`[...document.querySelectorAll('.v2-setting-option')].find(el => el.firstChild.textContent === 'Notifications').click()`);
    await run.page.until(`[...document.querySelectorAll('.v2-setting-value')].some(el => el.textContent === '2 connected')`, 'connecting notifications');

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

    await run.page.go('about:blank');
    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/canvas`);
    await run.page.until(`document.querySelectorAll('.cv-stack').length === 7`, 'the sample board with a saved session');
    assert.deepEqual(await run.page.run(`[...document.querySelectorAll('.cv-chip-go')].map(chip => chip.getAttribute('href'))`), ['#/feed', '#/feed/2', '#/feed/3']);
    assert.doesNotMatch(await run.page.text(), /acme\/factory|Claude|Codex|Builder|Reviewer|agent/i);
    await run.page.run(`document.querySelector('.cv-stack[data-ticket$="#208"]').click()`);
    await run.page.until(`document.querySelector('.cv-focus h3')?.textContent === '#208 Retention rules'`, 'the ticket that needs you');
    await run.page.click('Decide in Feed');
    await run.page.until(`location.hash === '#/feed/3' && document.querySelector('.v2-card-title')?.textContent === 'Retention window for deleted projects'`, 'its decision in Feed');
    await run.page.click('Allow recovery for 30 days');
    await run.page.until(`document.querySelector('.v2-build-card')?.textContent.includes('Audit log export')`, 'Feed with the Building cards');
    await run.page.run(`document.querySelector('.v2-build-card').click()`);
    await run.page.until(`location.hash === '#/canvas/201' && document.querySelector('.cv-stack[data-ticket$="#208"] .pill')?.textContent === 'Building'`, 'Building opens the board, with the decided ticket building');
    await run.page.run(`Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'))`);
    assert.deepEqual(await run.page.run(stored), session);
    assert.deepEqual(apiRequests(run.world), [], 'demo used network access with a saved session');
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('real signed-in v2: welcome, picker, calm Chat card, Feed states, and truthful Settings', async () => {
  const run = await start();
  try {
    const emptySpecs = { data: { rateLimit: { limit: 5000, remaining: 4800, resetAt: '2099-01-01T00:00:00Z' },
      specSearch: { totalCount: 0, nodes: [] },
      repository: { issues: { totalCount: 0, nodes: [] }, youIssues: { totalCount: 0, nodes: [] },
        fleet: { text: FLEET } } } };
    run.world.graphql.Specs = () => ({ status: 200, json: emptySpecs });
    run.world.github['GET /repos/acme/factory/pulls'] = () => ({ status: 200, json: [] });

    await run.page.go(`${SITE}/app/?v2=dry-run`);
    await run.page.until(`document.body.innerText.includes('Continue with GitHub')`, 'real v2 signed-out welcome');
    assert.equal(await run.page.run(`document.querySelector('.v2-welcome-sample')?.textContent`), 'See a sample factory');
    assert.equal(await run.page.run(`document.querySelector('.v2-sample-tag')`), null);

    await run.page.go(`${SITE}/app/?v2=dry-run&code=c0de&state=${'S'.repeat(43)}`);
    await run.page.until(`document.body.innerText.includes('Pick a repository') && document.body.innerText.includes('acme/factory')`, 'v2 repository picker');
    assert.equal(await run.page.run(`Boolean(document.querySelector('.v2-welcome-stage .panel'))`), true);
    await run.page.click('acme/factory');

    await run.page.until(`location.hash === '#/feed' && document.querySelector('.v2-clear-card h2')?.textContent === 'All clear.'`, 'real v2 Feed all-clear');
    assert.match(await run.page.text(), /No open spec or grill pull request is waiting on you/);

    await run.page.click('Chat');
    await run.page.until(`document.querySelector('.v2-chat-empty h2')?.textContent === 'Start work from here'`, 'real v2 Chat coming-soon card');
    assert.doesNotMatch(await run.page.text(), /\b0\.\d+/);
    assert.equal(await run.page.run(`document.querySelector('.v2-composer input').disabled`), true);

    await run.page.click('Settings');
    await run.page.until(`document.querySelector('.v2-settings .v2-sign-out')`, 'real v2 Settings');
    assert.match(await run.page.text(), /Where it runs\s+Coming soon/);
    assert.match(await run.page.text(), /GitHub\s+Connected/);
    assert.match(await run.page.text(), /acme\/factory/);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('demo welcome: the quiet GitHub link reopens a saved session instead of restarting sign-in', async () => {
  const run = await start();
  try {
    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/welcome`);
    await run.page.until(`document.querySelector('.v2-welcome-sample')`, 'demo welcome');
    assert.equal(await run.page.run(`document.querySelector('.v2-welcome-sample').getAttribute('href')`), '/api/sign-in/start');
    assert.equal(await run.page.run(`document.querySelector('.v2-welcome-sub')?.textContent`), 'Answer a few questions. Watch it build. Ship it.');
    await signIn(run.page);
    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/welcome`);
    await run.page.until(`document.querySelector('.v2-welcome-sample')`, 'demo welcome with a saved session');
    assert.equal(await run.page.run(`document.querySelector('.v2-welcome-sample').getAttribute('href')`), '/app/');
    assert.deepEqual(apiRequests(run.world).filter(r => r.path.startsWith('/api/sign-in/start')), []);
  } finally {
    await run.close();
  }
});
