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
const RECORD = { schema: 'openwiz.decisions.v1', kind: 'spec_confirmation', id: 'sc_notes_1', status: 'open', fingerprint: '5e'.repeat(32),
  risk: 'ordinary', spec: 60, summary: ['One list for now.'], headline: 'Keep your notes in one list.', tickets: [], graph: [] };
const recordBody = record => `Spec ready for your confirm.\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\``;
const comment = (id, number, body, createdAt, login = 'factory-bot[bot]') => ({ databaseId: id, body,
  url: `https://github.com/acme/factory/issues/${number}#issuecomment-${id}`, createdAt, updatedAt: createdAt, author: { login } });
const detail = (number, comments) => ({ number, comments: { totalCount: comments.length, nodes: comments }, subIssues: { totalCount: 0, nodes: [] } });

function specsAnswer(specs) {
  return { data: { rateLimit: RATE, specSearch: { totalCount: specs.length, nodes: specs },
    repository: { issues: { totalCount: specs.length, nodes: specs }, youIssues: { totalCount: 0, nodes: [] }, fleet: { text: FLEET } } } };
}

async function served(page) {
  const html = await readFile(new URL(`dist${page}`, ROOT), 'utf8');
  return [...html.matchAll(/src="(\/app\/data\.[0-9a-f]{10}\.js)"/g)].map(m => m[1])[0];
}

async function queueWorld(run, { specs = SPECS, details, grillAnswers = grill.refreshes[0].github, cards = false } = {}) {
  const world = run.world;
  world.graphql.Specs = async () => ({ status: 200, json: specsAnswer(specs) });
  world.graphql.SpecTickets = async () => ({ status: 200, json: { data: { rateLimit: RATE, repository: details ?? {
    s60: detail(60, [comment(9100021, 60, recordBody(RECORD), '2030-01-05T00:00:00Z')]),
    s61: detail(61, [comment(9100022, 61, `[Watch the narrated spec](${VIDEO})\n\nComment here to steer: stop, reset, or anything else.`, '2030-01-04T01:00:00Z')]),
    s62: detail(62, []) } } } });
  world.record(grillAnswers);
  world.github['GET /repos/acme/factory/issues/comments/9100021'] = () => ({ status: 200, json: { id: 9100021,
    issue_url: 'https://api.github.com/repos/acme/factory/issues/60', user: { login: 'factory-bot[bot]', id: 5900 }, body: recordBody(RECORD) } });
  world.github['GET /repos/acme/factory/issues/60'] = () => ({ status: 200, json: { number: 60, state: 'open', body: SPEC_BODY } });
  const dataPath = await served('/app/index.html');
  const real = await readFile(new URL('app/data.js', ROOT), 'utf8');
  const exported = real.replace('auth, repo, feeds, limit, paused,', 'auth, repo, feeds, limit, paused, github, noteLimit,');
  assert.notEqual(exported, real, 'the stub could not add github to OW.data');
  const stub = `${exported}
OW.records = { enabled: () => ['on', 'dry-run'].includes(JSON.parse(localStorage.getItem('openwiz.app.v2'))), dryRun: () => false };
${cards ? `window.drawn = [];
OW.cards = { decision(item, el) { window.drawn.push(item); el.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Decision card ' + item.key })); },
  spec(item, el) { window.drawn.push(item); el.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Spec card ' + item.key })); } };` : ''}`;
  world.site[dataPath] = () => ({ status: 200, raw: Buffer.from(stub), type: 'js' });
}

async function openQueue(run, value) {
  await run.page.go(`${SITE}/app/`);
  await run.page.until(`document.readyState === 'complete'`, 'the app page');
  await run.page.run(`localStorage.setItem('openwiz.app.v2', ${JSON.stringify(JSON.stringify(value))})`);
  await signIn(run.page);
  await run.page.click('acme/factory');
}

const pullsRead = world => world.log.filter(r => r.path === '/repos/acme/factory/pulls');

test('switch on: decisions and specs show in one ordered queue, drawn through the card interface', async () => {
  const run = await start();
  try {
    await queueWorld(run, { cards: true });
    await openQueue(run, 'on');
    await run.page.until(`location.hash === '#/queue' && document.querySelector('main h1').textContent === 'Queue'`, 'the queue opening first');
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
    const text = await run.page.text();
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
    await openQueue(run, 'dry-run');
    await run.page.until(`document.querySelectorAll('.queue a.card').length === 5`, 'five plain cards');
    const links = await run.page.run(`[...document.querySelectorAll('.queue a.card')].map(a => [a.getAttribute('href'), a.target])`);
    assert.deepEqual(links, [['https://github.com/acme/factory/issues/60#issuecomment-9100021', '_blank'],
      ['https://github.com/acme/factory/pull/7#issuecomment-9100003', '_blank'], ['https://github.com/acme/factory/pull/7#issuecomment-9100005', '_blank'],
      ['https://github.com/acme/factory/issues/61', '_blank'], ['https://github.com/acme/factory/issues/60', '_blank']]);
    const text = await run.page.text();
    assert.match(text, /Spec to confirm · #60/);
    assert.match(text, /Grill round to answer · #7/);
    assert.match(text, /couldn't be read/);
    assert.match(text, /Spec to watch · #61/);
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
    await queueWorld(run, { cards: true });
    await run.page.go(`${SITE}/app/`);
    await run.page.until(`document.body.innerText.includes('Sign in with GitHub')`, 'the signed-out screen');
    assert.match(await run.page.text(), /Read-only, on the repositories you choose\./);
    await openQueue(run, 'off');
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
    await run.page.until(`document.body.innerText.includes('Sign in with GitHub')`, 'the signed-out screen');
    const text = await run.page.text();
    assert.ok(!/read-only/i.test(text), text);
    await signIn(run.page);
    await run.page.click('acme/factory');
    await run.page.until(`document.querySelector('main h1')?.textContent === 'Queue'`, 'the queue');
    const nav = await run.page.run(`[...document.querySelectorAll('nav.main a')].map(a => a.getAttribute('href'))`);
    assert.deepEqual(nav, ['#/queue', '#/you', '#/specs', '#/agents']);
  } finally {
    await run.close();
  }
});
