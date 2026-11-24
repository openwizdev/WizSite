import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SITE, signIn, start } from './browser.mjs';

const ROOT = new URL('../../', import.meta.url);
const grill = JSON.parse(await readFile(new URL('tests/v2/fixtures/queue/grill-round.json', ROOT), 'utf8'));
const FLEET = grill.fleet;
const RATE = { limit: 5000, remaining: 4800, resetAt: '2099-01-01T00:00:00Z' };
const EMPTY = 'No open spec or grill pull request is waiting on you';
const VIDEO = 'https://example.com/synthetic/spec.mp4';

const specIssue = (number, title, updatedAt, total, completed) => ({ number, title, url: `https://github.com/acme/factory/issues/${number}`,
  updatedAt, labels: { nodes: [{ name: 'spec' }] }, subIssuesSummary: { total, completed } });
const SPECS = [specIssue(60, 'Spec: synthetic notes', '2030-01-02T00:00:00Z', 3, 1), specIssue(61, 'Spec: synthetic tags', '2030-01-04T00:00:00Z', 2, 0),
  specIssue(62, 'Spec: synthetic done', '2030-01-06T00:00:00Z', 2, 2)];
const SPEC_BODY = '## Problem Statement\n\nSynthetic.\n\n## Changelog headline\n\nKeep your notes in one list.\n\n## User Stories\n';
const RECORD = { schema: 'openwiz.decisions.v1', kind: 'plan_approval', id: 'pa_notes_1', status: 'open', fingerprint: '966fd8d7e2da4f19c7939755fad5440c9d2e33924ba87ac867f5c5307d66037b',
  risk: 'ordinary', spec: 60, summary: ['One list for now.'], headline: 'Keep your notes in one list.', tickets: [{ number: 63, title: 'Synthetic notes ticket', blockers: [] }], graph: [] };
const recordBody = record => `Plan ready for your approval.\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\``;
const comment = (id, number, body, createdAt, login = 'factory-bot[bot]') => ({ databaseId: id, body,
  url: `https://github.com/acme/factory/issues/${number}#issuecomment-${id}`, createdAt, updatedAt: createdAt, author: { login } });
const detail = (number, comments) => ({ number, comments: { totalCount: comments.length, nodes: comments }, subIssues: { totalCount: 0, nodes: [] } });

function specsAnswer(specs) {
  return { data: { rateLimit: RATE, specSearch: { totalCount: specs.length, nodes: specs },
    repository: { issues: { totalCount: specs.length, nodes: specs }, youIssues: { totalCount: 0, nodes: [] }, fleet: { text: FLEET } } } };
}

async function queueWorld(run, { specs = SPECS, details, record = RECORD, specBody = SPEC_BODY, grillAnswers = grill.refreshes[0].github } = {}) {
  const world = run.world;
  world.github['GET /user'] = () => ({ status: 200, json: { id: 5001, login: 'acme-owner' } });
  world.graphql.Specs = async () => ({ status: 200, json: specsAnswer(specs) });
  world.graphql.SpecTickets = async () => ({ status: 200, json: { data: { rateLimit: RATE, repository: details ?? {
    s60: detail(60, [comment(9100021, 60, recordBody(record), '2030-01-05T00:00:00Z')]),
    s61: detail(61, [comment(9100022, 61, `[Watch the narrated spec](${VIDEO})\n\nComment here to steer: stop, reset, or anything else.`, '2030-01-04T01:00:00Z')]),
    s62: detail(62, []) } } } });
  world.github['GET /repos/acme/factory/contents/docs/agents/fleet.md'] = () => ({ status: 200,
    json: { path: 'docs/agents/fleet.md', encoding: 'base64', content: Buffer.from(FLEET).toString('base64') } });
  world.github['GET /repos/acme/factory/issues/60/sub_issues'] = () => ({ status: 200,
    json: [{ number: 63, title: 'Synthetic notes ticket', body: 'Synthetic ticket.' }] });
  world.github['GET /repos/acme/factory/issues/63/dependencies/blocked_by'] = () => ({ status: 200, json: [] });
  world.record(grillAnswers);
  world.github['GET /repos/acme/factory/issues/comments/9100021'] = () => ({ status: 200, json: { id: 9100021,
    issue_url: 'https://api.github.com/repos/acme/factory/issues/60', user: { login: 'factory-bot[bot]', id: 5900 },
    body: recordBody(record), created_at: '2030-01-05T00:00:00Z' } });
  world.github['GET /repos/acme/factory/issues/60'] = () => ({ status: 200, json: { number: 60, state: 'open', body: specBody } });
}

const MOCK_CARDS = `window.drawn = [];
OW.cards = { decision(item, el) { window.drawn.push(item); el.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Decision card ' + item.key })); },
  spec(item, el) { window.drawn.push(item); el.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Spec card ' + item.key })); } };`;
async function openQueue(run, value, { cards = false, plain = false } = {}) {
  await run.page.go(`${SITE}/app/`);
  await run.page.until(`document.readyState === 'complete'`, 'the app page');
  await run.page.run(`localStorage.setItem('openwiz.app.v2', ${JSON.stringify(JSON.stringify(value))})`);
  await signIn(run.page);
  if (cards) await run.page.run(MOCK_CARDS);
  if (plain) await run.page.run('OW.cards = {}');
  await run.page.click('acme/factory');
}
const wasChecked = (world, id) => world.log.some(r => r.method === 'GET' && r.path === `/repos/acme/factory/issues/comments/${id}`);
const latestOf = (run, key) => run.page.run(`window.drawn.filter(item => item.key === ${JSON.stringify(key)}).pop() ?? null`);
async function triggerRefresh(run) {
  await run.page.tap('Refresh now');
}
async function refreshed(run) {
  const was = await run.page.run('OW.data.feeds.specs.readAt');
  await triggerRefresh(run);
  await run.page.until(`OW.data.feeds.specs.readAt !== ${was}`, 'the refreshed Specs read');
  await new Promise(resolve => setTimeout(resolve, 700));
}
const ROUND = 'decision:acme/factory#7:9100003';
const SPEC_DECISION = 'decision:acme/factory#60:9100021';
const pageOne = 'GET /repos/acme/factory/pulls?state=open&per_page=100&page=1';
const roundComments = 'GET /repos/acme/factory/issues/7/comments?per_page=100&page=1';
const withComments = (change, base = grill.refreshes[0].github) => ({ ...base,
  [roundComments]: { ...base[roundComments], json: change(structuredClone(base[roundComments].json)) } });
const recordIn = c => JSON.parse(c.body.match(/```json\n([\s\S]*?)\n```/)[1]);
const withRecord = (c, record) => ({ ...c, body: c.body.replace(/```json\n[\s\S]*?\n```/, `\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\``) });

const pullsRead = world => world.log.filter(r => r.path === '/repos/acme/factory/pulls');

test('switch on: decisions and specs show in one ordered queue, drawn through the card interface', async () => {
  const run = await start();
  try {
    await queueWorld(run);
    await openQueue(run, 'on', { cards: true });
    await run.page.until(`location.hash === '#/feed' && document.querySelector('main h1').textContent === 'Feed'`, 'the feed opening first');
    await run.page.until(`window.drawn.length >= 5`, 'five cards');
    const drawn = await run.page.run('window.drawn');
    assert.deepEqual(drawn.map(item => item.key), ['decision:acme/factory#60:9100021', 'decision:acme/factory#7:9100003',
      'decision:acme/factory#7:9100005', 'spec:acme/factory#61', 'spec:acme/factory#60']);
    const [specDecision, round, unreadable, tags, notes] = drawn;
    const want = grill.refreshes[0].items[0];
    assert.equal(typeof round.checked_at, 'number');
    assert.deepEqual({ ...round, checked_at: want.checked_at }, want, 'the grill round item is the contract\'s');
    assert.deepEqual({ ...unreadable }, grill.refreshes[0].items[1], 'a spec record on a pull request has request null');
    assert.equal(typeof specDecision.checked_at, 'number');
    assert.deepEqual({ ...specDecision, checked_at: null }, { type: 'decision', key: 'decision:acme/factory#60:9100021', repository: 'acme/factory',
      subject: { kind: 'issue', number: 60 }, title: 'Spec: synthetic notes', url: 'https://github.com/acme/factory/issues/60#issuecomment-9100021',
      comment_id: 9100021, at: Date.parse('2030-01-05T00:00:00Z'), current: true, checked_at: null, request: RECORD });
    assert.deepEqual(Object.keys(tags).sort(), ['at', 'graph', 'key', 'repository', 'subject', 'title', 'type', 'url', 'video']);
    assert.deepEqual(tags.video, { url: VIDEO });
    assert.deepEqual(tags.subject, { kind: 'issue', number: 61 });
    assert.equal(notes.video, null);
    assert.deepEqual(notes.graph, { tickets: [], unknown: 0 });
    const text = await run.page.run(`document.querySelector('.queue').textContent`);
    assert.ok(text.indexOf('Decision card decision:acme/factory#60:9100021') < text.indexOf('Spec card spec:acme/factory#61'), text);
    assert.ok(!text.includes('#62'), 'a spec with every ticket done is not in the queue');
    assert.deepEqual(run.world.writes(), [], 'the queue wrote something');
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('switch on without card modules: plain cards link to GitHub, in the same order', async () => {
  const run = await start();
  try {
    await queueWorld(run);
    await openQueue(run, 'dry-run', { plain: true });
    await run.page.until(`document.querySelectorAll('.queue a.card').length === 5`, 'five plain cards');
    const links = await run.page.run(`[...document.querySelectorAll('.queue a.card')].map(a => [a.getAttribute('href'), a.target])`);
    assert.deepEqual(links, [['https://github.com/acme/factory/issues/60#issuecomment-9100021', '_blank'],
      ['https://github.com/acme/factory/pull/7#issuecomment-9100003', '_blank'], ['https://github.com/acme/factory/pull/7#issuecomment-9100005', '_blank'],
      ['https://github.com/acme/factory/issues/61', '_blank'], ['https://github.com/acme/factory/issues/60', '_blank']]);
    assert.match(await run.page.text(), /Plan to approve · #60/i);
    assert.equal(await run.page.run(`document.querySelectorAll('.v2-building progress').length`), 0,
      'specs already in Feed were repeated in Building');
    const visible = () => run.page.run(`[...document.querySelectorAll('.queue-item:not([hidden])')].map(e => e.dataset.key)`);
    assert.deepEqual(await visible(), [SPEC_DECISION]);
    assert.equal(await run.page.run(`document.querySelector('.v2-next-preview').getAttribute('aria-label')`), 'Next: Synthetic grill: notes');
    await run.page.run(`document.querySelector('.v2-next-preview').focus()`);
    await run.page.key('Enter');
    assert.equal(await run.page.run('location.hash'), '#/feed/2');
    assert.deepEqual(await visible(), [ROUND]);
    assert.match(await run.page.text(), /Questions to answer · #7/i);
    await run.page.tap('Next card');
    assert.match(await run.page.text(), /couldn't be read/i);
    await run.page.tap('Next card');
    assert.match(await run.page.text(), /Spec to watch · #61/i);
    assert.match(await run.page.text(), /0 of 2 tickets complete/);
    assert.equal(await run.page.run(`document.querySelector('.queue-item:not([hidden]) .v2-queue-video')?.href`), VIDEO);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('a partial read shows a gap, never the empty line', async () => {
  const run = await start();
  try {
    await queueWorld(run, { specs: [], details: {}, grillAnswers: {
      'GET /repos/acme/factory/pulls?state=open&per_page=100&page=1': { status: 502, json: { message: 'Bad Gateway' } } } });
    await openQueue(run, 'on');
    await run.page.until(`document.body.innerText.includes('may be missing items')`, 'the gap line');
    const text = await run.page.text();
    assert.match(text, /This list may be missing items: GitHub gave only part of the open pull requests\./);
    assert.ok(!text.includes(EMPTY), 'a partial read said the queue is empty');
  } finally {
    await run.close();
  }
});

test('a complete read with nothing waiting says exactly what was read', async () => {
  const run = await start();
  try {
    await queueWorld(run, { specs: [], details: {}, grillAnswers: {
      'GET /repos/acme/factory/pulls?state=open&per_page=100&page=1': { status: 200, json: [] } } });
    await openQueue(run, 'on');
    await run.page.until(`document.body.innerText.includes(${JSON.stringify(EMPTY)})`, 'the empty line');
    assert.ok(!(await run.page.text()).includes('may be missing'));
  } finally {
    await run.close();
  }
});

test('switch off: no queue, no pull request read, the You page first and the signed-out copy unchanged', async () => {
  const run = await start();
  try {
    await queueWorld(run);
    await run.page.go(`${SITE}/app/`);
    await run.page.until(`document.body.innerText.includes('Sign in with GitHub')`, 'the signed-out screen');
    assert.match(await run.page.text(), /Read-only, on the repositories you choose\./);
    await openQueue(run, 'off', { cards: true });
    await run.page.until(`document.querySelector('main h1')?.textContent === 'You'`, 'the You page');
    await run.page.go(`${SITE}/app/#/queue`);
    await run.page.until(`document.querySelector('main h1')?.textContent === 'You'`, 'the queue route falling back');
    await new Promise(resolve => setTimeout(resolve, 500));
    const nav = await run.page.run(`[...document.querySelectorAll('nav.main a')].map(a => a.getAttribute('href'))`);
    assert.deepEqual(nav, ['#/you', '#/specs', '#/agents']);
    assert.deepEqual(pullsRead(run.world), [], 'the switch off still read pull requests');
    assert.deepEqual(await run.page.run('window.drawn'), []);
  } finally {
    await run.close();
  }
});

test('switch on: the signed-out copy no longer says read-only, and the queue leads the pages', async () => {
  const run = await start();
  try {
    await queueWorld(run);
    await run.page.go(`${SITE}/app/`);
    await run.page.until(`document.readyState === 'complete'`, 'the app page');
    await run.page.run(`localStorage.setItem('openwiz.app.v2', '"on"')`);
    await run.page.go(`${SITE}/app/`);
    await run.page.until(`document.body.innerText.includes('Continue with GitHub')`, 'the signed-out screen');
    const text = await run.page.text();
    assert.ok(!/read-only/i.test(text), text);
    await signIn(run.page);
    await run.page.click('acme/factory');
    await run.page.until(`document.querySelector('main h1')?.textContent === 'Feed'`, 'the feed');
    const nav = await run.page.run(`[...document.querySelectorAll('nav.main a')].map(a => a.getAttribute('href'))`);
    assert.deepEqual(nav, ['#/chat', '#/feed', '#/settings']);
  } finally {
    await run.close();
  }
});

test('v2 Settings stays available after a failed Specs read and the palette offers current pages', async () => {
  const run = await start();
  try {
    await queueWorld(run);
    run.world.graphql.Specs = async () => ({ status: 502, json: { message: 'Bad Gateway' } });
    await openQueue(run, 'dry-run');
    await run.page.until(`document.body.innerText.includes("Feed couldn't be read from GitHub")`, 'the unknown Feed');
    assert.equal(await run.page.run(`document.querySelectorAll('.v2-notices .notice, .v2-queue-status .unknown').length`), 1);
    run.world.graphql.Specs = async () => ({ status: 429, headers: { 'Retry-After': '600' }, json: { message: 'Rate limited' } });
    await run.page.tap('Refresh now');
    await run.page.until(`document.querySelector('.v2-pause-note')?.textContent.includes('paused reads until')`, 'one rate-limit note in Feed');
    assert.equal(await run.page.run(`document.querySelectorAll('.v2-pause-note').length`), 1);
    assert.equal(await run.page.run(`document.querySelector('.v2-refresh').disabled`), true);
    await run.page.click('Settings');
    await run.page.until(`document.querySelector('.v2-settings .v2-sign-out')`, 'settings after the read failed');
    assert.match(await run.page.text(), /Where it runs\s+Coming soon/);
    assert.match(await run.page.text(), /Specs: unknown/);
    await run.page.run(`document.querySelector('.v2-settings button.repo').click()`);
    await run.page.until(`document.querySelector('.v2-settings .repo-list button[aria-current="true"]')`, 'the repository choices');
    await run.page.key('Escape');
    await run.page.key('k', 'Ctrl');
    await run.page.until(`OW.palette.shown()`, 'the command palette');
    const results = await run.page.run(`document.querySelector('#palette-results').textContent`);
    assert.match(results, /Chat.*Feed.*Settings/);
    assert.doesNotMatch(results, /Show only (specs|tickets|agents)|synthetic notes|synthetic tags/i);
    await run.page.key('Escape');
    await run.page.tap('Sign out');
    await run.page.until(`document.body.innerText.includes('Continue with GitHub')`, 'the signed-out screen');
    assert.deepEqual(run.world.writes(), []);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('a failed refresh never keeps an earlier true: the item turns unchecked and the queue shows a gap', async () => {
  const failed = JSON.parse(await readFile(new URL('tests/v2/fixtures/queue/grill-refresh-failed.json', ROOT), 'utf8'));
  const run = await start();
  try {
    await queueWorld(run, { specs: [], details: {}, grillAnswers: failed.refreshes[0].github });
    await openQueue(run, 'on', { cards: true });
    await run.page.until(`window.drawn.some(item => item.key === 'decision:acme/factory#7:9100003' && item.current === true)`, 'the first, matched read');
    assert.ok(!(await run.page.text()).includes('may be missing'));
    run.world.record(failed.refreshes[1].github);
    await triggerRefresh(run);
    await run.page.until(`window.drawn.some(item => item.key === 'decision:acme/factory#7:9100003' && item.current === null)`, 'the refreshed, unchecked item');
    const last = (await run.page.run('window.drawn')).filter(item => item.key === 'decision:acme/factory#7:9100003').pop();
    assert.deepEqual(last, failed.refreshes[1].items[0]);
    assert.match(await run.page.text(), /This list may be missing items: GitHub gave only part of #7's source check\./);
  } finally {
    await run.close();
  }
});

test('R1: the queue registers its check through OW.records.check, so a current decision composes', async () => {
  const run = await start();
  try {
    await queueWorld(run);
    await openQueue(run, 'dry-run');
    await run.page.until(`document.querySelectorAll('article.decision').length >= 2`, 'the decision cards');
    assert.ok(wasChecked(run.world, 9100021), 'the queue never checked the spec decision through OW.records.check');
    assert.ok(wasChecked(run.world, 9100003), 'the queue never checked the grill decision through OW.records.check');
    const yes = await run.page.run(`(() => { const card = document.querySelector('article.decision[data-key="${SPEC_DECISION}"]');
      const b = [...card.querySelectorAll('button')].find(b => b.textContent === 'Yes'); b.scrollIntoView({ block: 'center' }); return !b.disabled; })()`);
    assert.ok(yes, 'the current decision offers no Yes');
    await run.page.tap('Yes');
    await run.page.until(`document.body.innerText.includes('openwiz decision answer v1') && document.body.innerText.includes('approve #60')`, 'the real preview');
    assert.deepEqual(run.world.writes(), []);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('R1: a check OW.records answers unchecked, or that throws, leaves the item unchecked with a gap', async () => {
  const run = await start();
  try {
    await queueWorld(run);
    await openQueue(run, 'on', { cards: true });
    await run.page.until(`window.drawn.some(item => item.key === ${JSON.stringify(ROUND)} && item.current === true)`, 'the first, matched read');
    run.world.record({ 'GET /repos/acme/factory/pulls/7': { status: 502, json: { message: 'Bad Gateway' } } });
    run.world.github['GET /repos/acme/factory/issues/60'] = () => ({ status: 200, json: { number: 60, state: 'open', body: SPEC_BODY + 'Edited.' } });
    await refreshed(run);
    assert.match(await run.page.text(), /GitHub gave only part of #7's source check/);
    const round = await latestOf(run, ROUND);
    assert.equal(round.current, null);
    assert.equal(round.checked_at, null);
    const keys = await run.page.run(`[...document.querySelectorAll('.queue-item')].map(el => el.dataset.key)`);
    assert.ok(keys.includes(ROUND) && !keys.includes(SPEC_DECISION), `a changed source still shows its card: ${keys}`);
    await run.page.run(`OW.records = { ...OW.records, check: async () => { throw new Error('synthetic check failure'); } }`);
    await refreshed(run);
    assert.match(await run.page.text(), /GitHub gave only part of #60's source check, #7's source check/);
    const thrown = await latestOf(run, ROUND);
    assert.equal(thrown.current, null);
    assert.equal(thrown.checked_at, null);
  } finally {
    await run.close();
  }
});

for (const status of [429, 502]) {
  test(`a Specs refresh returning ${status} clears earlier checks and shows one dated warning`, async () => {
    const run = await start();
    try {
      await queueWorld(run);
      await openQueue(run, 'on', { cards: true });
      await run.page.until(`window.drawn.some(item => item.key === ${JSON.stringify(SPEC_DECISION)} && item.current === true)`
        + ` && window.drawn.some(item => item.key === ${JSON.stringify(ROUND)} && item.current === true)`, 'the first, matched read');
      run.world.graphql.Specs = async () => ({
        status, headers: status === 429 ? { 'Retry-After': '600' } : undefined, json: { message: 'Read failed' },
      });
      await triggerRefresh(run);
      await run.page.until(`document.body.innerText.includes("Couldn't read Specs")`, 'the failed refresh');
      await new Promise(resolve => setTimeout(resolve, 700));
      const shown = await run.page.run(`[...document.querySelectorAll('.queue-item')].map(el => el.dataset.key)`);
      const current = {};
      for (const key of [SPEC_DECISION, ROUND]) current[key] = (await latestOf(run, key)).current;
      assert.deepEqual(current, { [SPEC_DECISION]: null, [ROUND]: null }, 'a failed refresh kept an earlier true');
      assert.ok(shown.includes(SPEC_DECISION) && shown.includes(ROUND), 'the cards from the last good read went away');
      const text = await run.page.text();
      const [failed, lastGood] = await run.page.run(`['failedAt', 'readAt'].map(key => OW.ui.time(OW.data.feeds.specs[key]))`);
      assert.ok(text.includes(`Couldn't read Specs at ${failed}. Showing the read from ${lastGood}.`));
      assert.equal((text.match(/Couldn't read Specs/g) || []).length, 1, 'the Specs failure appears once');
    } finally {
      await run.close();
    }
  });
}

test('R2: a first Specs read with GraphQL errors and no nodes shows a gap, never the empty line', async () => {
  const run = await start();
  try {
    await queueWorld(run, { specs: [], details: {}, grillAnswers: { [pageOne]: { status: 200, json: [] } } });
    run.world.graphql.Specs = async () => ({ status: 200, json: { ...specsAnswer([]), errors: [{ message: 'synthetic', path: ['repository', 'issues'] }] } });
    await openQueue(run, 'on');
    await run.page.until(`document.querySelector('main h1')?.textContent === 'Feed' && document.body.innerText.includes('GitHub gave only part of')`
      + ` || document.body.innerText.includes(${JSON.stringify(EMPTY)})`, 'the queue settling');
    const text = await run.page.text();
    assert.ok(!text.includes(EMPTY), 'a partial Specs read said the queue is empty');
    assert.match(text, /This list may be missing items: GitHub gave only part of the spec read\./);
  } finally {
    await run.close();
  }
});

test('R2: a Specs read with GraphQL errors makes no spec decision current', async () => {
  const run = await start();
  try {
    await queueWorld(run);
    run.world.graphql.Specs = async () => ({ status: 200, json: { ...specsAnswer(SPECS), errors: [{ message: 'synthetic', path: ['specSearch'] }] } });
    await openQueue(run, 'on', { cards: true });
    await run.page.until(`window.drawn.some(item => item.key === ${JSON.stringify(SPEC_DECISION)})`, 'the spec decision');
    assert.equal((await latestOf(run, SPEC_DECISION)).current, null);
    assert.ok(!wasChecked(run.world, 9100021), 'a partial spec read was source checked');
  } finally {
    await run.close();
  }
});

test('R3: a later page of the pull request list that fails leaves page one\'s grill unchecked, with the gap', async () => {
  const run = await start();
  try {
    const first = grill.refreshes[0].github;
    await queueWorld(run, { grillAnswers: { ...first, [pageOne]: { ...first[pageOne], next: true },
      'GET /repos/acme/factory/pulls?state=open&per_page=100&page=2': { status: 502, json: { message: 'Bad Gateway' } } } });
    await openQueue(run, 'on', { cards: true });
    await run.page.until(`window.drawn.some(item => item.key === ${JSON.stringify(ROUND)})`, 'the grill round');
    await run.page.until(`document.body.innerText.includes('may be missing items')`, 'the gap line');
    const round = await latestOf(run, ROUND);
    assert.deepEqual({ current: round.current, checked_at: round.checked_at }, { current: null, checked_at: null }, 'a partial pull list made a grill current');
    assert.ok(!wasChecked(run.world, 9100003));
    assert.match(await run.page.text(), /GitHub gave only part of the open pull requests/);
  } finally {
    await run.close();
  }
});

test('R4: a later record in the same second supersedes the earlier one, by comment id', async () => {
  const run = await start();
  try {
    let newer;
    const answers = withComments(list => {
      const older = list.find(c => c.id === 9100003);
      newer = withRecord({ ...older, id: 9100009, html_url: older.html_url.replace('9100003', '9100009') }, { ...recordIn(older), id: 'gr_notes_3' });
      return [newer, ...list];
    });
    answers['GET /repos/acme/factory/issues/comments/9100009'] = { status: 200, json: newer };
    await queueWorld(run, { grillAnswers: answers });
    await openQueue(run, 'on', { cards: true });
    await run.page.until(`window.drawn.some(item => item.key === 'decision:acme/factory#7:9100009')`, 'the newer request');
    const current = {};
    for (const id of [9100003, 9100009]) current[id] = (await latestOf(run, `decision:acme/factory#7:${id}`))?.current ?? 'not drawn';
    assert.deepEqual(current, { 9100003: 'not drawn', 9100009: true }, 'two requests of one grill file are current');
    assert.ok(!wasChecked(run.world, 9100003), 'the superseded request was checked');
    assert.ok(wasChecked(run.world, 9100009), 'the newer request was not checked');
  } finally {
    await run.close();
  }
});

test('R5: a successful recheck of the same decision keeps the typed draft, and the draft composes', async () => {
  const run = await start();
  try {
    await queueWorld(run);
    await openQueue(run, 'dry-run');
    await run.page.until(`document.querySelector('article.decision[data-key="${SPEC_DECISION}"] textarea')`, 'the reply box');
    await run.page.run(`document.querySelector('article.decision[data-key="${SPEC_DECISION}"] textarea').focus()`);
    await run.page.type('Keep it, but later');
    await refreshed(run);
    const draft = await run.page.run(`document.querySelector('article.decision[data-key="${SPEC_DECISION}"] textarea').value`);
    assert.equal(draft, 'Keep it, but later', 'a recheck erased the draft');
    await run.page.run(`(() => { const card = document.querySelector('article.decision[data-key="${SPEC_DECISION}"]');
      [...card.querySelectorAll('button')].find(b => b.textContent === 'Preview reply').scrollIntoView({ block: 'center' }); })()`);
    await run.page.tap('Preview reply');
    await run.page.until(`document.body.innerText.includes('openwiz decision answer v1') && document.body.innerText.includes('Keep it, but later')`, 'the composed preview');
    assert.deepEqual(run.world.writes(), []);
  } finally {
    await run.close();
  }
});

for (const [name, id] of [['an object with a string toString', { toString: 'N2' }], ['a one-element array', ['N2']]]) {
  test(`R7: a question id that is ${name} makes one unreadable card and keeps the rest`, async () => {
    const run = await start();
    try {
      const answers = withComments(list => list.map(c => {
        if (c.id !== 9100003) return c;
        const record = recordIn(c);
        record.questions[1].id = id;
        return withRecord(c, record);
      }));
      await queueWorld(run, { grillAnswers: answers });
      await openQueue(run, 'on', { cards: true });
      await run.page.until(`document.querySelector('.queue-item') || document.body.innerText.includes('may be missing')`, 'the queue');
      await new Promise(resolve => setTimeout(resolve, 700));
      const keys = await run.page.run(`[...document.querySelectorAll('.queue-item')].map(el => el.dataset.key)`);
      assert.deepEqual(keys, [SPEC_DECISION, ROUND, 'decision:acme/factory#7:9100005', 'spec:acme/factory#61', 'spec:acme/factory#60']);
      const round = await latestOf(run, ROUND);
      assert.equal(round.request, null, 'a non-string question id passed validation');
      assert.ok(!wasChecked(run.world, 9100003), 'a malformed record was source checked');
      assert.ok(!(await run.page.text()).includes('may be missing'), 'a malformed record made a gap');
    } finally {
      await run.close();
    }
  });
}

test('R6: the app check refuses a page order that swaps You and Agents', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtemp, cp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const temp = await mkdtemp(`${tmpdir()}/queue-check-`);
  try {
    const dist = `${temp}/dist`;
    await cp(new URL('dist/', ROOT), dist, { recursive: true });
    const html = await readFile(`${dist}/app/index.html`, 'utf8');
    const you = html.match(/<script src="\/app\/pages\/you\.[0-9a-f]+\.js" defer><\/script>/)[0];
    const agents = html.match(/<script src="\/app\/pages\/agents\.[0-9a-f]+\.js" defer><\/script>/)[0];
    await writeFile(`${dist}/app/index.html`, html.replace(you, '\0').replace(agents, you).replace('\0', agents));
    const checker = `import sys; sys.path.insert(0, ${JSON.stringify(new URL('scripts/', ROOT).pathname)}); from pathlib import Path; from check import check_site
try:
    check_site(Path(sys.argv[1]))
except AssertionError as error:
    print('refused:', error)
else:
    print('accepted')`;
    const run = root => execFileSync('python3', ['-B', '-c', checker, root], { encoding: 'utf8' }).trim();
    assert.equal(run(new URL('dist/', ROOT).pathname), 'accepted', 'the built site itself fails the check');
    assert.match(run(dist), /^refused:.*order/, 'a You and Agents swap passed the app check');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('R8: a transient Specs 502 disables answering, keeps the draft in memory, and restores it on recovery', async () => {
  const run = await start();
  try {
    await queueWorld(run);
    await openQueue(run, 'dry-run');
    await run.page.until(`document.querySelector('article.decision[data-key="${SPEC_DECISION}"] textarea')`, 'the reply box');
    await run.page.run(`document.querySelector('article.decision[data-key="${SPEC_DECISION}"] textarea').focus()`);
    await run.page.type('Keep it through a 502');
    run.world.graphql.Specs = async () => ({ status: 502, json: { message: 'Bad Gateway' } });
    await run.page.click('Refresh now');
    await run.page.until(`document.body.innerText.includes("Couldn't read Specs")`, 'the failed refresh');
    await run.page.until(`document.querySelector('article.decision[data-key="${SPEC_DECISION}"] .decision-blocked')`, 'the unchecked card');
    const enabledWhileFailed = await run.page.run(`[...document.querySelectorAll('article.decision[data-key="${SPEC_DECISION}"] button')].filter(b => !b.disabled).length`);
    assert.equal(enabledWhileFailed, 0, 'answer actions stayed enabled during a Specs 502');
    run.world.graphql.Specs = async () => ({ status: 200, json: specsAnswer(SPECS) });
    await refreshed(run);
    await run.page.until(`document.querySelector('article.decision[data-key="${SPEC_DECISION}"] textarea')`, 'the restored reply box');
    const draft = await run.page.run(`document.querySelector('article.decision[data-key="${SPEC_DECISION}"] textarea').value`);
    assert.equal(draft, 'Keep it through a 502', 'a transient Specs 502 erased the draft');
    await run.page.run(`(() => { const card = document.querySelector('article.decision[data-key="${SPEC_DECISION}"]');
      [...card.querySelectorAll('button')].find(b => b.textContent === 'Preview reply').scrollIntoView({ block: 'center' }); })()`);
    await run.page.tap('Preview reply');
    await run.page.until(`document.body.innerText.includes('openwiz decision answer v1') && document.body.innerText.includes('Keep it through a 502')`, 'the composed preview');
    assert.deepEqual(run.world.writes(), []);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('R8: a changed binding on recovery does not restore the old draft', async () => {
  const run = await start();
  try {
    await queueWorld(run);
    await openQueue(run, 'dry-run');
    await run.page.until(`document.querySelector('article.decision[data-key="${SPEC_DECISION}"] textarea')`, 'the reply box');
    await run.page.run(`document.querySelector('article.decision[data-key="${SPEC_DECISION}"] textarea').focus()`);
    await run.page.type('Draft for old binding');
    run.world.graphql.Specs = async () => ({ status: 502, json: { message: 'Bad Gateway' } });
    await run.page.click('Refresh now');
    await run.page.until(`document.querySelector('article.decision[data-key="${SPEC_DECISION}"] .decision-blocked')`, 'the unchecked card');
    const updatedBody = SPEC_BODY.replace('Synthetic.', 'Synthetic body edited.');
    await queueWorld(run, { specBody: updatedBody,
      record: { ...RECORD, fingerprint: '2326a9c116e7c4312266b9ecfa0cfb914e66268ce2a01e54b2ab0fe80095a84e' } });
    await refreshed(run);
    await run.page.until(`document.querySelector('article.decision[data-key="${SPEC_DECISION}"] textarea')`, 'the recovered reply box');
    const draft = await run.page.run(`document.querySelector('article.decision[data-key="${SPEC_DECISION}"] textarea').value`);
    assert.equal(draft, '', 'a changed binding restored a draft from the old binding');
    assert.deepEqual(run.world.writes(), []);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('R9: tapping Yes during a refresh with a slow later GitHub read composes without stale refusal', async () => {
  const run = await start();
  try {
    await queueWorld(run);
    await openQueue(run, 'dry-run');
    await run.page.until(`document.querySelectorAll('article.decision').length >= 2`, 'the decision cards');
    const firstPulls = run.world.recorded[pageOne];
    delete run.world.recorded[pageOne];
    let pullsStarted;
    let releasePulls;
    const started = new Promise(resolve => { pullsStarted = resolve; });
    const gate = new Promise(resolve => { releasePulls = resolve; });
    run.world.github['GET /repos/acme/factory/pulls'] = async () => {
      pullsStarted();
      await gate;
      return { status: 200, json: firstPulls.json };
    };
    await run.page.click('Refresh now');
    await started;
    await run.page.run(`(() => { const card = document.querySelector('article.decision[data-key="${SPEC_DECISION}"]');
      [...card.querySelectorAll('button')].find(b => b.textContent === 'Yes').scrollIntoView({ block: 'center' }); })()`);
    await run.page.tap('Yes');
    await run.page.until(`document.body.innerText.includes('openwiz decision answer v1') && document.body.innerText.includes('approve #60')`
      + ` || document.body.innerText.includes('Not posted (source_changed)')`, 'the preview or refusal');
    const text = await run.page.text();
    assert.ok(!text.includes('Not posted (source_changed)'), 'Yes during an in-flight refresh was refused as stale');
    assert.match(text, /openwiz decision answer v1/);
    assert.match(text, /approve #60/);
    releasePulls();
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.deepEqual(run.world.writes(), []);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('R9: a card marked stale by a timestamp mismatch recovers on the next successful refresh and keeps its draft', async () => {
  const run = await start();
  try {
    await queueWorld(run);
    await openQueue(run, 'dry-run');
    await run.page.until(`document.querySelector('article.decision[data-key="${SPEC_DECISION}"] textarea')`, 'the reply box');
    await run.page.run(`document.querySelector('article.decision[data-key="${SPEC_DECISION}"] textarea').focus()`);
    await run.page.type('Draft survives stale recovery');
    const changedBody = SPEC_BODY.replace('Keep your notes in one list.', 'Changed headline temporarily.');
    run.world.github['GET /repos/acme/factory/issues/60'] = () => ({ status: 200, json: { number: 60, state: 'open', body: changedBody } });
    await run.page.run(`(() => { const card = document.querySelector('article.decision[data-key="${SPEC_DECISION}"]');
      [...card.querySelectorAll('button')].find(b => b.textContent === 'Yes').scrollIntoView({ block: 'center' }); })()`);
    await run.page.tap('Yes');
    await run.page.until(`document.querySelector('article.decision[data-key="${SPEC_DECISION}"] .decision-blocked')`, 'the stale card');
    run.world.github['GET /repos/acme/factory/issues/60'] = () => ({ status: 200, json: { number: 60, state: 'open', body: SPEC_BODY } });
    await refreshed(run);
    await run.page.until(`!document.querySelector('article.decision[data-key="${SPEC_DECISION}"] .decision-blocked')`, 'the recovered card');
    const state = await run.page.run(`(() => {
      const card = document.querySelector('article.decision[data-key="${SPEC_DECISION}"]');
      const yes = [...card.querySelectorAll('button')].find(b => b.textContent === 'Yes');
      const box = card.querySelector('textarea');
      return { blocked: Boolean(card.querySelector('.decision-blocked')), disabled: yes.disabled, draft: box.value };
    })()`);
    assert.deepEqual(state, { blocked: false, disabled: false, draft: 'Draft survives stale recovery' },
      'the stale card stayed disabled or lost its draft after a successful refresh');
    await run.page.run(`(() => { const card = document.querySelector('article.decision[data-key="${SPEC_DECISION}"]');
      [...card.querySelectorAll('button')].find(b => b.textContent === 'Preview reply').scrollIntoView({ block: 'center' }); })()`);
    await run.page.tap('Preview reply');
    await run.page.until(`document.body.innerText.includes('openwiz decision answer v1') && document.body.innerText.includes('Draft survives stale recovery')`, 'the recovered compose');
    assert.deepEqual(run.world.writes(), []);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});
