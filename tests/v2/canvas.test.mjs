import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { SITE, signIn, start } from './browser.mjs';

const RATE = { limit: 5000, remaining: 4800, resetAt: '2099-01-01T00:00:00Z' };
const FLEET = '# Fleet\n\n## GitHub identity\n\n| What | Who |\n| --- | --- |\n| Record authors | `factory-bot[bot]` |\n';
const BOT = { login: 'factory-bot[bot]' };
const URL_OF = n => `https://github.com/acme/factory/issues/${n}`;
const ago = min => new Date(Date.now() - min * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

function note(id, { agent, state, step, min, pr, model = 'Opus 5.5 Medium', harness = 'Claude Code', version = 1 }) {
  const at = ago(min);
  const lines = [`<!-- openwiz:status v${version} -->`, `agent: ${agent}`, `state: ${state}`, `harness: ${harness}`, `model: ${model}`,
    'skills: build-ticket@0.2.0', `step: ${step}`, `time: ${at}`, ...(pr ? [`pr: https://github.com/acme/factory/pull/${pr}`] : [])];
  return { databaseId: id, body: lines.join('\n'), createdAt: at, updatedAt: at, author: BOT };
}
const ref = (n, state = 'OPEN', reason = null) => ({ number: n, title: `Synthetic ${n}`, url: URL_OF(n), state, stateReason: reason, repository: { nameWithOwner: 'acme/factory' } });
const pull = (n, { state = 'OPEN', draft = false, review = 'REVIEW_REQUIRED', checks = 'PENDING' } = {}) => ({ url: `https://github.com/acme/factory/pull/${n}`,
  state, isDraft: draft, reviewDecision: review, commits: { nodes: [{ commit: { statusCheckRollup: { state: checks } } }] } });

const TICKETS = [
  { n: 42, title: 'Cart contract', state: 'CLOSED', reason: 'COMPLETED', labels: ['ready-for-agent'], blockers: [], pulls: [pull(101, { state: 'MERGED', review: 'APPROVED', checks: 'SUCCESS' })],
    notes: [note(8421, { agent: 'builder', state: 'done', step: 'merged after one review', min: 300, pr: 101 })] },
  { n: 43, title: 'Price the basket', labels: ['ready-for-agent'], blockers: [42], pulls: [pull(112)],
    notes: [note(8431, { agent: 'builder', state: 'working', step: 'opened the pull request; CI is running', min: 2, pr: 112 })] },
  { n: 44, title: 'Shipping options', labels: ['ready-for-agent', 'needs-info'], blockers: [42], pulls: [pull(114, { review: 'CHANGES_REQUESTED', checks: 'SUCCESS' })],
    notes: [note(8441, { agent: 'builder', state: 'done', step: 'pushed the fix for the first finding', min: 40, pr: 114 }),
      note(8442, { agent: 'reviewer', state: 'working', step: 'reviewing at the exact head', min: 4, pr: 114, harness: 'Codex', model: 'Sol 6.1 High' })] },
  { n: 45, title: 'Tax at checkout', labels: ['ready-for-agent'], blockers: [42], pulls: [],
    notes: [note(8451, { agent: 'builder', state: 'asking', step: 'which tax rule applies to digital goods', min: 6 })] },
  { n: 46, title: 'Order summary', labels: ['ready-for-agent'], blockers: [43, 44], pulls: [], notes: [] },
  { n: 47, title: 'Receipt email', labels: ['ready-for-agent'], blockers: [45], pulls: [],
    notes: [note(8471, { agent: 'builder', state: 'stopped (plan limit)', step: 'stopped at the plan limit', min: 14 })] },
];
const SPECS = [
  { number: 41, title: 'Spec: checkout', total: 6, completed: 1, updatedAt: ago(5) },
  { number: 48, title: 'Spec: accounts', total: 0, completed: 0, updatedAt: ago(30) },
  { number: 33, title: 'Spec: catalog', total: 2, completed: 2, updatedAt: ago(60 * 24 * 5) },
];
const CONFIRM = {
  schema: 'openwiz.decisions.v1', kind: 'spec_confirmation', id: 'sc_accounts_1', status: 'open', fingerprint: 'b'.repeat(64), risk: 'ordinary',
  spec: 48, summary: ['Sign in with a magic link.'], headline: 'Sign in without a password.', tickets: [], graph: [],
};

function world(run, change = {}) {
  const tickets = structuredClone(TICKETS);
  change.tickets?.(tickets);
  const sub = t => ({ ...ref(t.n, t.state || 'OPEN', t.reason || null), title: t.title, labels: { nodes: t.labels.map(name => ({ name })) },
    blockedBy: { totalCount: t.blockers.length, nodes: t.blockers.map(b => { const x = tickets.find(y => y.n === b); return ref(b, x?.state || 'OPEN', x?.reason || null); }) },
    closedByPullRequestsReferences: { totalCount: t.pulls.length, nodes: t.pulls.map(({ commits, ...p }) => p) },
    comments: { totalCount: t.notes.length, nodes: t.notes } });
  const issue = s => ({ number: s.number, title: s.title, url: URL_OF(s.number), updatedAt: s.updatedAt, labels: { nodes: [{ name: 'spec' }] },
    subIssuesSummary: { total: s.total, completed: s.completed } });
  const marked = tickets.filter(t => t.labels.includes('needs-info')).map(t => ({ number: t.n, title: t.title, url: URL_OF(t.n), updatedAt: ago(3),
    labels: { nodes: t.labels.map(name => ({ name })) }, issueDependenciesSummary: { blockedBy: 0 } }));
  run.world.github['GET /user'] = () => ({ status: 200, json: { id: 5001, login: 'acme-owner' } });
  run.world.graphql.Specs = async () => ({ status: 200, json: { data: { rateLimit: RATE, specSearch: { totalCount: SPECS.length, nodes: SPECS.map(issue) },
    repository: { issues: { totalCount: SPECS.length, nodes: SPECS.map(issue) }, youIssues: { totalCount: marked.length, nodes: marked }, fleet: { text: FLEET } } } } });
  const s41 = { number: 41, comments: { totalCount: 0, nodes: [] }, subIssues: { totalCount: tickets.length + (change.missing || 0), nodes: tickets.map(sub) } };
  const s48 = { number: 48, comments: { totalCount: 1, nodes: [{ databaseId: 9480, body: `Spec ready for your confirm.\n\n\`\`\`json\n${JSON.stringify(CONFIRM, null, 2)}\n\`\`\``,
    url: `${URL_OF(48)}#issuecomment-9480`, createdAt: ago(30), updatedAt: ago(30), author: BOT }] }, subIssues: { totalCount: 0, nodes: [] } };
  const s33 = { number: 33, comments: { totalCount: 0, nodes: [] }, subIssues: { totalCount: 2, nodes: [
    { ...sub({ n: 31, title: 'Catalog list', state: 'CLOSED', reason: 'COMPLETED', labels: [], blockers: [], pulls: [], notes: [] }) },
    { ...sub({ n: 32, title: 'Catalog page', state: 'CLOSED', reason: 'COMPLETED', labels: [], blockers: [], pulls: [], notes: [] }) }] } };
  run.world.graphql.SpecTickets = async () => ({ status: 200, json: { data: { rateLimit: RATE, repository: { s41, s48, s33 } } } });
  const live = tickets.filter(t => t.notes.length && t.state !== 'CLOSED');
  run.world.graphql.Agents = async () => ({ status: 200, json: { data: { rateLimit: RATE, repository: {
    issues: { totalCount: live.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes: live.map(t => ({ number: t.n, title: t.title, url: URL_OF(t.n), state: 'OPEN',
      updatedAt: ago(1), comments: { totalCount: t.notes.length, nodes: t.notes }, closedByPullRequestsReferences: { totalCount: t.pulls.length, nodes: t.pulls } })) },
    fleet: { text: FLEET } } } } });
}

async function openCanvas(run, route = '#/canvas') {
  await signIn(run.page);
  await run.page.click('acme/factory');
  await run.page.until(`document.querySelector('nav a[aria-current="page"]')`, 'the shell');
  await run.page.go(`${SITE}/app/${route}`);
  await run.page.until(`document.querySelectorAll('.cv-stack[data-ticket]').length >= 6 || document.querySelector('.cv-over, .cv-focus, .cv-empty')`, 'the canvas');
  await run.page.until('OW.data.feeds.agents.readAt && OW.data.feeds.specs.readAt', 'both reads');
}
const stacks = run => run.page.run(`Object.fromEntries([...document.querySelectorAll('.cv-stack[data-ticket]')].map(s =>
  [s.dataset.ticket.split('#').pop(), s.dataset.state + (s.dataset.lead ? '/' + s.dataset.lead : '')]))`);
const sheets = run => run.page.run(`[...document.querySelectorAll('.cv-rail .cv-sheet')].map(s => s.querySelector('.cv-sheet-name').textContent)`);
const strip = run => run.page.run(`[...document.querySelectorAll('.cv-chip-go')].map(b => b.dataset.item + ' ' + b.querySelector('.num').textContent)`);
const SHOTS = process.env.SHOTS;

test('Canvas: one sheet per spec, one stack per ticket and one needs-you strip, from the reads the app already makes', async () => {
  const run = await start();
  try {
    world(run);
    await openCanvas(run);
    assert.equal(await run.page.run('location.hash'), '#/canvas');
    assert.deepEqual(await sheets(run), ['#41 Spec: checkout', '#48 Spec: accounts', 'Quiet · 1'], 'needs-you sheets first, the finished one folded into Quiet');
    assert.deepEqual(await stacks(run), {
      42: 'merged/done', 43: 'review/working', 44: 'you/working', 45: 'you/asking', 46: 'waiting', 47: 'waiting/stopped',
    });
    assert.deepEqual(await strip(run), ['ticket #44', 'asking #45', 'spec_confirmation spec #48'], 'newest first; the asking note is in the strip');
    assert.match(await run.page.run(`document.querySelector('.cv-chip-go[data-item="asking"]').textContent`), /Builder asks: which tax rule applies/);
    assert.equal(await run.page.run(`document.querySelectorAll('.cv-stack[data-ticket$="#44"] .cv-behind .cv-card').length`), 3,
      'behind #44: the builder\'s done note, its pull request and the ticket');
    assert.equal(await run.page.run(`document.querySelector('.cv-stack[data-ticket$="#44"] .cv-count').textContent`), '4');
    assert.equal(await run.page.run(`document.querySelectorAll('.cv-line').length`), 6, 'one line per blocked-by link');
    const asked = run.world.log.filter(r => r.path === '/graphql' && r.method === 'POST').map(r => (JSON.parse(r.body).query.match(/^\s*query\s+(\w+)/) || [])[1]);
    assert.ok(asked.every(name => ['Specs', 'SpecTickets', 'Agents', 'AgentPulls', 'Models'].includes(name)), `only the app's own reads: ${asked}`);
    assert.deepEqual(run.world.writes(), [], 'the canvas wrote something');
    assert.deepEqual(run.world.violations, []);
    if (SHOTS) {
      await run.page.shot(join(SHOTS, 'canvas-laptop.png'), 1440, 900, false);
    }
  } finally {
    await run.close();
  }
});

test('Canvas: a strip item opens its sheet and marks its stack; Space spreads a stack, Enter focuses it, Esc goes back', async () => {
  const run = await start();
  try {
    world(run);
    await openCanvas(run);
    await run.page.run(`document.querySelector('.cv-chip-go[data-item="spec_confirmation"]').click()`);
    await run.page.until(`location.hash === '#/canvas/48' && document.querySelector('.cv-title h2')?.textContent === '#48 Spec: accounts'`, 'sheet #48');
    assert.match(await run.page.text(), /No tickets yet: its spec or plan waits on you/);
    await run.page.run(`document.querySelector('.cv-chip-go[data-item="asking"]').click()`);
    await run.page.until(`location.hash === '#/canvas/41' && document.querySelector('.cv-stack.flash')`, 'sheet #41 with #45 marked');
    assert.equal(await run.page.run(`document.activeElement.dataset.ticket`), 'acme/factory#45');

    await run.page.run(`document.querySelector('.cv-stack[data-ticket$="#44"]').focus()`);
    await run.page.key(' ');
    await run.page.until(`document.querySelector('.cv-stack[data-ticket$="#44"]').getAttribute('aria-expanded') === 'true'`, 'the spread stack');
    assert.equal(await run.page.run(`getComputedStyle(document.querySelector('.cv-stack[data-ticket$="#44"] .cv-behind .cv-card > *')).visibility`), 'visible');
    if (SHOTS) await run.page.shot(join(SHOTS, 'canvas-spread.png'), 1440, 900, false);
    await run.page.run(`document.querySelector('.cv-stack[data-ticket$="#44"]').focus()`);
    await run.page.key('Enter');
    await run.page.until(`document.querySelector('.cv-focus')`, 'the focused ticket');
    if (SHOTS) await run.page.shot(join(SHOTS, 'canvas-focus.png'), 1440, 900, false);
    const text = await run.page.text();
    assert.match(text, /Reviewer · Codex, Sol 6\.1 High/);
    assert.match(text, /Builder · Claude Code, Opus 5\.5 Medium/);
    assert.match(text, /Waits for\s+#42 Cart contract \(merged\)/);
    assert.match(text, /Blocks\s+#46 Order summary \(waiting\)/);
    assert.match(text, /#114: open, changes requested, checks pass/);
    await run.page.key('Escape');
    await run.page.until(`!document.querySelector('.cv-focus') && document.querySelector('.cv-stack[data-ticket$="#44"]')`, 'the board again');
    assert.equal(await run.page.run(`document.activeElement.dataset.ticket`), 'acme/factory#44', 'focus returns to the stack');
    assert.deepEqual(run.world.writes(), []);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('Canvas: L shows every sheet, arrows choose one and Enter opens it; zoomed out, stacks become tiles; / finds a ticket', async () => {
  const run = await start();
  try {
    world(run);
    await openCanvas(run);
    await run.page.run('document.activeElement.blur()');
    await run.page.key('l');
    await run.page.until(`document.querySelector('.cv-over .cv-open')`, 'the sheets overview');
    assert.equal(await run.page.run(`document.querySelector('.cv-open').dataset.sheet`), '41');
    assert.deepEqual(await run.page.run(`[...document.querySelectorAll('.cv-slat')].map(s => s.dataset.sheet + ':' + s.dataset.offset)`), ['48:1']);
    if (SHOTS) await run.page.shot(join(SHOTS, 'canvas-sheets.png'), 1440, 900, false);
    await run.page.key('ArrowDown');
    await run.page.until(`document.querySelector('.cv-open')?.dataset.sheet === '48'`, 'sheet #48 facing');
    await run.page.key('Enter');
    await run.page.until(`location.hash === '#/canvas/48' && !document.querySelector('.cv-over')`, 'sheet #48 open');

    await run.page.size(1440, 900, false);
    await run.page.go(`${SITE}/app/#/canvas/41`);
    await run.page.until(`document.querySelectorAll('.cv-stack[data-ticket]').length >= 6`, 'sheet #41');
    await run.page.run(`document.querySelector('[aria-label="Fit the board"]').click()`);
    assert.ok(!(await run.page.run(`document.querySelector('.cv-board').classList.contains('far')`)), 'six tickets fit close up on a laptop');
    for (let i = 0; i < 6 && !(await run.page.run(`document.querySelector('.cv-board').classList.contains('far')`)); i += 1) {
      await run.page.run(`document.querySelector('[aria-label="Zoom out"]').click()`);
    }
    assert.ok(await run.page.run(`document.querySelector('.cv-board').classList.contains('far')`), 'zoomed out past the far line');
    assert.equal(await run.page.run(`getComputedStyle(document.querySelector('.cv-stack[data-ticket$="#45"] .cv-tile')).display`), 'flex');
    assert.equal(await run.page.run(`getComputedStyle(document.querySelector('.cv-stack[data-ticket$="#45"] .cv-front')).display`), 'none');
    if (SHOTS) await run.page.shot(join(SHOTS, 'canvas-far.png'), 1440, 900, false);
    await run.page.size(1440, 900, false);
    await run.page.run(`document.querySelector('[aria-label="Fit the board"]').click()`);

    await run.page.run('document.activeElement.blur()');
    await run.page.key('/');
    assert.equal(await run.page.run('document.activeElement.className'), 'cv-search');
    await run.page.type('tax');
    await run.page.until(`document.querySelector('.cv-stack.hit')`, 'a match');
    assert.deepEqual(await run.page.run(`[...document.querySelectorAll('.cv-stack.hit')].map(s => s.dataset.ticket)`), ['acme/factory#45']);
    assert.equal(await run.page.run(`document.querySelectorAll('.cv-stack.dim').length`), 5);
    assert.equal(await run.page.run(`document.querySelector('.cv-sheet[data-sheet="41"] .cv-sheet-line').textContent`), '1 match');
    assert.deepEqual(run.world.writes(), []);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('Canvas: unknown stays unknown, a note of another version or a partial ticket list shows as a gap, never a zero', async () => {
  const run = await start();
  try {
    world(run, {
      missing: 1,
      tickets: list => { list.find(t => t.n === 46).notes.push(note(8461, { agent: 'builder', state: 'working', step: 'a later version', min: 3, version: 2 })); },
    });
    await openCanvas(run);
    assert.match((await stacks(run))[46], /\/unknown$/);
    assert.match(await run.page.text(), /1 ticket of #41 couldn't be read, so it shows as unknown/);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('Canvas on a phone: the sheets scroll across, the board runs top to bottom and the strip stays on top', async () => {
  const run = await start();
  try {
    world(run);
    await run.page.size(390, 844, true);
    await openCanvas(run);
    const shape = await run.page.run(`(() => {
      const top = k => document.querySelector('.cv-stack[data-ticket$="#' + k + '"]').getBoundingClientRect().top;
      const rail = getComputedStyle(document.querySelector('.cv-rail')).flexDirection;
      const strip = document.querySelector('.cv-inbox').getBoundingClientRect().top < document.querySelector('.cv-board').getBoundingClientRect().top;
      return { rail, down: top(43) > top(42) && top(46) > top(43), strip, wide: document.scrollingElement.scrollWidth <= innerWidth };
    })()`);
    assert.deepEqual(shape, { rail: 'row', down: true, strip: true, wide: true });
    if (SHOTS) await run.page.shot(join(SHOTS, 'canvas-phone.png'), 390, 844, true);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('Canvas on a phone: a vertical swipe on the board or a card scrolls the page, a sideways swipe pans the board', async () => {
  const run = await start();
  try {
    world(run);
    await run.page.size(390, 844, true);
    await openCanvas(run);
    const state = () => run.page.run(`(() => ({
      scroll: document.querySelector('main').scrollTop || document.scrollingElement.scrollTop,
      cam: document.querySelector('.cv-world').style.transform,
    }))()`);
    const spot = selector => run.page.run(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + 8), y: Math.round(r.top + r.height / 2) };
    })()`);
    await run.page.run(`(() => { const b = document.querySelector('.cv-board'); b.scrollIntoView({ block: 'start' }); })()`);
    await new Promise(resolve => setTimeout(resolve, 200));
    const before = await state();
    const empty = await run.page.run(`(() => {
      const r = document.querySelector('.cv-view').getBoundingClientRect();
      return { x: Math.round(r.left + 6), y: Math.round(r.top + 60) };
    })()`);
    await run.page.touch(empty.x, empty.y, 0, 250);
    const afterBoard = await state();
    assert.ok(afterBoard.scroll < before.scroll - 100, `board swipe scrolled the page: ${JSON.stringify([before, afterBoard])}`);
    assert.equal(afterBoard.cam, before.cam);
    await new Promise(resolve => setTimeout(resolve, 200));
    const card = await spot('.cv-stack[data-ticket$="#43"]');
    const beforeCard = await state();
    await run.page.touch(card.x, card.y, 0, 150);
    const afterCard = await state();
    assert.ok(afterCard.scroll < beforeCard.scroll - 50, `card swipe scrolled the page: ${JSON.stringify([beforeCard, afterCard])}`);
    const side = await run.page.run(`(() => {
      const r = document.querySelector('.cv-view').getBoundingClientRect();
      return { x: Math.round(r.left + 6), y: Math.round((Math.max(r.top, 0) + Math.min(r.bottom, innerHeight)) / 2) };
    })()`);
    await run.page.touch(side.x, side.y, 120, 0);
    const afterSide = await state();
    assert.notEqual(afterSide.cam, afterCard.cam, 'sideways swipe pans the board');
    assert.equal(afterSide.scroll, afterCard.scroll);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

test('Canvas: widening the window refits a board that is still at its fitted view, and leaves a moved one alone', async () => {
  const run = await start();
  try {
    world(run);
    await run.page.size(900, 800, false);
    await openCanvas(run);
    const zoom = () => run.page.run(`parseInt(document.querySelector('.cv-zoom').textContent, 10)`);
    const narrow = await zoom();
    await run.page.size(1440, 900, false);
    await run.page.until(`parseInt(document.querySelector('.cv-zoom').textContent, 10) > ${narrow}`, 'the board to refit');
    await run.page.run(`document.querySelector('[aria-label="Zoom out"]').click()`);
    const moved = await zoom();
    await run.page.size(1100, 900, false);
    assert.equal(await zoom(), moved);
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});
