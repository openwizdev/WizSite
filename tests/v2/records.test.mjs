import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const ROOT = new URL('../../', import.meta.url);
const FORMS = new URL('tests/v2/fixtures/forms/', ROOT);
const REFUSED = new URL('refused/', FORMS);
const ACCEPTED = new URL('accepted/', FORMS);
const POSTS = new URL('tests/v2/fixtures/posts/', ROOT);
const API = 'https://api.github.com';
const TOKEN = 'synthetic-token-for-tests';
const OWNER = { id: 5001, login: 'acme-owner' };
const PICKED = { owner: 'acme', name: 'factory', full: 'acme/factory', private: true };
const FLEET = '# Fleet\n\n## GitHub identity\n\n| Role | Logins |\n| --- | --- |\n| Record authors | `factory-bot[bot]` |\n';
const SCRIPTS = ['app/data.js', 'app/ui.js', 'app/pages/specs.js', 'app/records.js'];
const json = async url => JSON.parse(await readFile(url, 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value));
const names = async url => (await readdir(url)).filter(n => n.endsWith('.input.json')).map(n => n.slice(0, -'.input.json'.length)).sort();
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise(resolve => setImmediate(resolve)); };

class Net {
  constructor(github = {}, comments = {}) {
    this.github = structuredClone(github);
    this.comments = structuredClone(comments);
    this.log = [];
    this.mode = 'ok';
    this.next = 9100050;
    this.account = OWNER;
  }
  writes() { return this.log.filter(r => r.method !== 'GET'); }
  list(number) { return (this.comments[number] ||= []); }
  add(number, comment) { this.list(number).push(comment); }
  async fetch(url, init = {}) {
    const method = init.method || 'GET';
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    this.log.push({ method, url: String(url), headers, body: init.body });
    const at = new URL(url, 'https://openwiz.dev');
    if (at.origin !== API) return Response.json({ error: 'not_found' }, { status: 404 });
    const answer = (status, body, extra = {}) => Response.json(body, { status, headers: extra });
    if (method === 'GET' && at.pathname === '/user') return answer(200, this.account);
    const comments = at.pathname.match(/^\/repos\/acme\/factory\/issues\/(\d+)\/comments$/);
    if (comments && method === 'GET') {
      const page = Number(at.searchParams.get('page'));
      return answer(200, page === 1 ? this.list(comments[1]).map(c => ({ html_url: `https://github.com/acme/factory/issues/${comments[1]}#issuecomment-${c.id}`, ...c })) : []);
    }
    if (comments && method === 'POST') {
      const id = this.next++;
      const comment = { id, user: { login: this.account.login, id: this.account.id }, body: JSON.parse(init.body).body,
        created_at: new Date().toISOString(), html_url: `https://github.com/acme/factory/issues/${comments[1]}#issuecomment-${id}` };
      if (this.mode === 'dropped') throw new TypeError('synthetic network failure');
      if (this.mode === 'server') return answer(502, { message: 'Bad Gateway' });
      if (this.mode === 'forbidden') return answer(403, { message: 'Resource not accessible by integration' });
      this.add(comments[1], comment);
      if (this.mode === 'lost') throw new TypeError('synthetic lost answer');
      return answer(201, comment);
    }
    const recorded = this.github[`${method} ${at.pathname}${at.search}`];
    if (recorded) return answer(recorded.status, recorded.json, recorded.next ? { Link: `<${API}/next>; rel="next"` } : {});
    return answer(404, { message: 'Not Found' });
  }
}

class FakeEvent {
  constructor(type, trusted) {
    this.type = type;
    Object.defineProperty(this, 'isTrusted', { value: trusted });
  }
}
const tap = () => new FakeEvent('click', true);

async function boot({ net = new Net(), storage = new Map(), mode = 'on', account = OWNER, picked = PICKED, search = '', signedIn = true, before } = {}) {
  if (mode !== null) storage.set('openwiz.app.v2', JSON.stringify(mode));
  if (signedIn) storage.set('openwiz.app.auth', JSON.stringify({ session: `session-${account.id}`, token: TOKEN, expiresAt: null, refresh: null, refreshExpiresAt: null }));
  if (picked) storage.set('openwiz.app.repo', JSON.stringify(picked));
  net.account = account;
  const page = { search, replaced: [] };
  const context = {
    console, URL, URLSearchParams, Headers, Response, TextDecoder, TextEncoder, atob, btoa, setTimeout, clearTimeout,
    crypto: webcrypto, Event: FakeEvent, structuredClone,
    fetch: (url, init) => net.fetch(url, init),
    localStorage: {
      getItem: key => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    location: { get search() { return page.search; }, pathname: '/app/', hash: '#/you' },
    history: { replaceState: (_, __, url) => { page.replaced.push(url); page.search = new URL(url, 'https://openwiz.dev').search; } },
    document: { hidden: false, addEventListener() {}, createElementNS() { throw new Error('no DOM in this test'); } },
  };
  context.window = context;
  vm.createContext(context);
  for (const script of SCRIPTS) {
    const file = new URL(script, ROOT);
    if (script === 'app/records.js' && before) vm.runInContext(before, context);
    if (existsSync(file)) vm.runInContext(await readFile(file, 'utf8'), context, { filename: script });
  }
  const OW = context.OW;
  OW.data.feeds.specs.data = { fleet: { text: FLEET } };
  await settle();
  const run = { OW, net, storage, page, records: OW.records };
  needsRecords(run);
  return run;
}

function needsRecords(run) {
  assert.ok(run.records, 'app/records.js defines no OW.records');
  for (const name of ['enabled', 'dryRun', 'compose', 'confirm', 'post', 'pending', 'check']) {
    assert.equal(typeof run.records[name], 'function', `OW.records.${name} is missing`);
  }
  return run.records;
}

async function composeLike(records, action) {
  if (action.item?.type === 'decision' && action.item.request) await records.check(action.item);
  return records.compose(action);
}

async function confirmAll(records, preview) {
  for (let i = 0; i < preview.confirms; i += 1) records.confirm(preview, tap());
}

test('every form fixture composes to its exact body, target and visibility', async () => {
  const fixtures = await names(FORMS);
  assert.equal(fixtures.length, 15);
  for (const name of fixtures) {
    const input = await json(new URL(`${name}.input.json`, FORMS));
    const body = await json(new URL(`${name}.body.json`, FORMS));
    const run = await boot({ net: new Net(input.github), picked: { owner: 'acme', name: 'factory', ...input.picked } });
    const records = needsRecords(run);
    const preview = await composeLike(records, input.action);
    assert.equal(preview.body, body, name);
    const { item } = input.action;
    assert.match(preview.op, /^op-[0-9a-f]{32}$/, name);
    assert.deepEqual(plain(preview), {
      op: preview.op, form: input.action.form, body, repository: 'acme/factory', subject: item.subject, url: item.url.replace(/#.*$/, ''),
      visibility: 'repository', confirms: item.type === 'decision' && item.request.risk !== 'ordinary' ? 2 : 1, source: plain(preview).source,
    }, name);
    if (item.type === 'spec') assert.equal(preview.source, null, name);
    else assert.match(preview.source.digest, /^[0-9a-f]{64}$/, name);
    assert.deepEqual(run.net.writes(), [], `${name}: compose wrote`);
  }
});

test('own words and escapes pass byte for byte, and a public repository previews as public', async () => {
  for (const name of await names(ACCEPTED)) {
    const input = await json(new URL(`${name}.input.json`, ACCEPTED));
    const run = await boot({ net: new Net(input.github), picked: { owner: 'acme', name: 'factory', full: 'acme/factory', private: false } });
    const preview = await composeLike(needsRecords(run), input.action);
    assert.equal(preview.body, await json(new URL(`${name}.body.json`, ACCEPTED)), name);
    assert.equal(preview.visibility, 'public', name);
  }
});

test('every refused fixture is refused for its reason, and compose never writes', async () => {
  const fixtures = await names(REFUSED);
  assert.ok(fixtures.length >= 25);
  for (const name of fixtures) {
    const input = await json(new URL(`${name}.input.json`, REFUSED));
    const run = await boot({ net: new Net(input.github || {}), picked: { owner: 'acme', name: 'factory', ...input.picked } });
    const got = await composeLike(needsRecords(run), input.action);
    assert.deepEqual(plain(got), { refused: await json(new URL(`${name}.refused.json`, REFUSED)) }, name);
    assert.deepEqual(run.net.writes(), [], `${name}: compose wrote`);
  }
});

test('forms outside the contract are refused, however they are shaped', async () => {
  const input = await json(new URL('spec-change.input.json', FORMS));
  const records = needsRecords(await boot());
  const cases = [
    [{ ...input.action, form: 'spec.label' }, 'not_a_form'],
    [{ ...input.action, form: 'toString' }, 'not_a_form'],
    [{ ...input.action, form: '__proto__' }, 'not_a_form'],
    [null, 'not_a_form'],
    [{ ...input.action, item: { ...input.action.item, subject: { kind: 'issue', number: '41/labels' } } }, 'not_a_form'],
    [{ ...input.action, item: { ...input.action.item, subject: { kind: 'pull_request', number: 41 } } }, 'not_a_form'],
    [{ ...input.action, item: { ...input.action.item, repository: 'acme/other' } }, 'other_repository'],
    [{ ...input.action, words: '  \n\t' }, 'empty'],
    [{ ...input.action, words: 'fine\r  launch-fleet: started' }, 'refused_form'],
    [{ ...input.action, words: 'see "openwiz.decisions.v2"' }, 'refused_form'],
    [{ ...input.action, words: '"\\u006fpenwiz.decisions.v1"' }, 'refused_form'],
    [{ ...input.action, words: '\t**Plan graph approved by** me' }, 'refused_form'],
    [{ ...input.action, words: 'x'.repeat(65537) }, 'too_long'],
  ];
  for (const [action, reason] of cases) assert.deepEqual(plain(await records.compose(action)), { refused: reason }, JSON.stringify(action)?.slice(0, 80));
  assert.equal((await records.compose({ ...input.action, words: 'x'.repeat(65536) })).body.length, 65536);
});

test('post sequences: confirms gate every write, ids are per intent, receipts per account', async () => {
  const cases = (await readdir(POSTS)).filter(n => n.endsWith('.json'));
  assert.ok(cases.length >= 14);
  for (const name of cases) {
    const fx = await json(new URL(name, POSTS));
    const net = new Net(fx.github, fx.comments);
    const storage = new Map();
    let run = await boot({ net, storage, account: fx.account });
    let records = needsRecords(run);
    const previews = {};
    const taps = {};
    let afterCompose = 0;
    for (const [i, step] of fx.steps.entries()) {
      const at = `${name}, step ${i + 1}`;
      if (step.compose) {
        const { action } = await json(new URL(`${step.compose}.input.json`, FORMS));
        const preview = await composeLike(records, action);
        assert.match(preview.op, /^op-[0-9a-f]{32}$/, `${at}: ${JSON.stringify(preview)}`);
        previews[step.as] = preview;
        afterCompose = net.log.length;
      } else if (step.confirm) {
        taps[step.tap] ||= new FakeEvent('click', !step.untrusted);
        records.confirm(previews[step.confirm], taps[step.tap]);
      } else if ('edit' in step) {
        net.github = structuredClone(step.edit);
      } else if (step.reload) {
        run = await boot({ net, storage, account: step.reload });
        records = run.records;
      } else if (step.pending) {
        const restored = records.pending();
        assert.deepEqual(plain(restored.map(p => p.op)), step.pending.map(n => previews[n].op), at);
        for (const [j, n] of step.pending.entries()) previews[n] = restored[j];
      } else if (step.post) {
        net.mode = step.write || 'ok';
        const first = records.post(previews[step.post]);
        if (step.twice) assert.equal(records.post(previews[step.post]), first, `${at}: a double tap made a second post`);
        const outcome = plain(await first);
        assert.equal(outcome.outcome, step.expect.outcome, `${at}: ${JSON.stringify(outcome)}`);
        if (step.expect.reason) assert.equal(outcome.reason, step.expect.reason, at);
        assert.equal(outcome.op, previews[step.post].op, at);
      }
    }
    assert.equal(net.writes().length, fx.writes, `${name}: write requests`);
    if (fx.requests_after_compose === 0) assert.equal(net.log.length - afterCompose, 0, `${name}: requests after compose`);
  }
});

test('the request guard admits only the records layer\'s one comment POST on the picked repository', async () => {
  const run = await boot();
  const { OW, net } = run;
  needsRecords(run);
  assert.equal(OW.data.writer(), null, 'a second script claimed the write path');
  const refusedBy = async (call, what) => {
    const before = net.log.length;
    await assert.rejects(call, error => error instanceof OW.data.Refused, what);
    assert.equal(net.log.length, before, `${what} reached the network`);
  };
  const path = '/repos/acme/factory/issues/41/comments';
  await refusedBy(() => OW.data.github('POST', path, { body: 'stop' }), 'a comment not made through records.js');
  for (const method of ['PATCH', 'PUT', 'DELETE']) {
    await refusedBy(() => OW.data.github(method, path, { body: 'stop' }), method);
    await refusedBy(() => OW.data.github(method, '/repos/acme/factory/issues/comments/9100001', { body: 'stop' }), `${method} a comment`);
  }
  for (const query of ['mutation { addComment(input: {}) { clientMutationId } }', 'query Q { a } mutation M { b }', ' subscription { x }']) {
    await refusedBy(() => OW.data.github('POST', '/graphql', { query }), query);
  }
  assert.equal((await OW.data.github('GET', '/user')).status, 200);
  assert.equal(typeof OW.data.noteLimit, 'function');
});

test('the records layer cannot write anywhere but the picked repository\'s issue comments', async () => {
  const input = await json(new URL('spec-not_now.input.json', FORMS));
  for (const [picked, item] of [
    [{ owner: 'acme', name: 'other', full: 'acme/other', private: true }, input.action.item],
    [PICKED, { ...input.action.item, subject: { kind: 'issue', number: 0 } }],
    [PICKED, { ...input.action.item, subject: { kind: 'issue', number: 41.5 } }],
  ]) {
    const run = await boot({ picked });
    const outcome = await run.records.compose({ ...input.action, item });
    assert.ok(outcome.refused, JSON.stringify(outcome));
    assert.deepEqual(run.net.writes(), []);
  }
  const run = await boot();
  const preview = await run.records.compose(input.action);
  run.storage.set('openwiz.app.repo', JSON.stringify({ owner: 'acme', name: 'other', full: 'acme/other', private: true }));
  await confirmAll(run.records, preview);
  const outcome = plain(await run.records.post(preview));
  assert.equal(outcome.outcome, 'refused', JSON.stringify(outcome));
  assert.deepEqual(run.net.writes(), [], 'a preview for one repository was posted after the pick changed');
});

test('one confirm sends exactly one write, with the exact body, to GitHub only, and the token goes nowhere else', async () => {
  const input = await json(new URL('spec-change.input.json', FORMS));
  const run = await boot();
  const preview = await run.records.compose(input.action);
  run.records.confirm(preview, tap());
  const outcome = plain(await run.records.post(preview));
  assert.equal(outcome.outcome, 'posted');
  const writes = run.net.writes();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'POST');
  assert.equal(writes[0].url, `${API}/repos/acme/factory/issues/41/comments`);
  assert.equal(writes[0].body, JSON.stringify({ body: input.action.words }));
  assert.deepEqual(JSON.parse(writes[0].body), { body: preview.body });
  for (const request of run.net.log) {
    const sent = JSON.stringify(request);
    if (!request.url.startsWith(`${API}/`)) assert.ok(!sent.includes(TOKEN), `the token reached ${request.url}`);
    else assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
    assert.ok(!(request.body || '').includes(TOKEN), 'the token is in a request body');
  }
  assert.deepEqual(plain(await run.records.post(preview)), outcome, 'a posted id sent again');
  assert.equal(run.net.writes().length, 1);
});

test('dry run and off compose and refuse with zero requests; off is the default', async () => {
  const input = await json(new URL('spec-not_now.input.json', FORMS));
  for (const [mode, reason, enabled] of [['dry-run', 'dry_run', true], ['off', 'disabled', false], [null, 'disabled', false], ['yes', 'disabled', false]]) {
    const run = await boot({ mode });
    const records = needsRecords(run);
    assert.equal(records.enabled(), enabled, String(mode));
    assert.equal(records.dryRun(), mode === 'dry-run', String(mode));
    const preview = await records.compose(input.action);
    assert.equal(preview.body, 'stop');
    records.confirm(preview, tap());
    const before = run.net.log.length;
    assert.deepEqual(plain(await records.post(preview)), { outcome: 'refused', op: preview.op, reason }, String(mode));
    assert.equal(run.net.log.length, before, `${mode}: post made a request`);
    assert.deepEqual(run.net.writes(), []);
  }
});

test('the switch is set from ?v2= and the parameter leaves the address; other values change nothing', async () => {
  for (const [search, stored, left] of [['?v2=on', '"on"', ''], ['?v2=dry-run&code=c0de', '"dry-run"', '?code=c0de'], ['?v2=off', '"off"', ''], ['?v2=please', undefined, '']]) {
    const run = await boot({ mode: null, search });
    assert.equal(run.storage.get('openwiz.app.v2'), stored, search);
    assert.equal(run.page.search, left, search);
    assert.equal(run.OW.data.v2.get(), stored ? JSON.parse(stored) : 'off', search);
  }
  const run = await boot({ mode: null, search: '?code=c0de&state=s' });
  assert.deepEqual(run.page.replaced, [], 'an address without v2 was rewritten');
  run.OW.data.auth.signOut();
  run.storage.set('openwiz.app.v2', '"on"');
  run.OW.data.auth.signOut();
  assert.equal(run.OW.data.v2.get(), 'on', 'signing out dropped the switch');
});

test('a forged, copied or edited preview, or a scripted confirm, never posts', async () => {
  const input = await json(new URL('spec-not_now.input.json', FORMS));
  const run = await boot();
  const preview = await run.records.compose(input.action);
  const copy = { ...preview, subject: { ...preview.subject } };
  run.records.confirm(copy, tap());
  assert.equal(plain(await run.records.post(copy)).reason, 'not_composed');
  run.records.confirm(preview, { isTrusted: true, type: 'click' });
  run.records.confirm(preview, new FakeEvent('keydown', true));
  assert.equal(plain(await run.records.post(preview)).reason, 'not_confirmed');
  try { preview.body = 'launch-fleet: started'; } catch {}
  run.records.confirm(preview, tap());
  const outcome = plain(await run.records.post(preview));
  assert.ok(outcome.outcome === 'posted' ? JSON.parse(run.net.writes()[0].body).body === 'stop' : outcome.reason === 'not_composed', JSON.stringify(outcome));
});

test('R3: a restored sending receipt is reconciled with a read before any other write', async () => {
  const input = await json(new URL('spec-not_now.input.json', FORMS));
  const net = new Net();
  const storage = new Map();
  const first = await boot({ net, storage });
  const preview = await first.records.compose(input.action);
  first.records.confirm(preview, tap());
  net.mode = 'hang';
  const original = net.fetch.bind(net);
  net.fetch = (url, init) => (init?.method === 'POST' ? original(url, { ...init, method: 'POST' }).then(() => new Promise(() => {})) : original(url, init));
  first.records.post(preview);
  await settle();
  assert.equal(net.writes().length, 1, 'the first write did not start');
  net.fetch = original;
  net.mode = 'ok';
  const second = await boot({ net, storage });
  const restored = second.records.pending();
  assert.deepEqual(plain(restored.map(p => p.op)), [preview.op], 'a sending receipt was not restored');
  second.records.confirm(restored[0], tap());
  const outcome = plain(await second.records.post(restored[0]));
  assert.equal(outcome.outcome, 'posted', JSON.stringify(outcome));
  assert.equal(net.writes().length, 1, 'a restored sending receipt was sent again without reading first');
  assert.equal(outcome.comment.id, net.list(41)[0].id);
});

test('R3: a comment of the same words that precedes the attempt is never taken as this send', async () => {
  const input = await json(new URL('spec-not_now.input.json', FORMS));
  const net = new Net();
  net.add(41, { id: 9100040, user: { login: OWNER.login, id: OWNER.id }, body: 'stop', created_at: new Date(Date.now() - 60_000).toISOString() });
  const run = await boot({ net });
  const preview = await run.records.compose(input.action);
  run.records.confirm(preview, tap());
  net.mode = 'dropped';
  assert.equal(plain(await run.records.post(preview)).outcome, 'unknown');
  net.mode = 'ok';
  run.records.confirm(preview, tap());
  const outcome = plain(await run.records.post(preview));
  assert.equal(outcome.outcome, 'posted', JSON.stringify(outcome));
  assert.notEqual(outcome.comment.id, 9100040, 'the owner\'s earlier comment was claimed as this send');
  assert.equal(net.writes().length, 2);
});

async function specConfirmation() {
  const input = await json(new URL('decision-yes-spec_confirmation.input.json', FORMS));
  const net = new Net(input.github);
  const run = await boot({ net });
  return { input, net, run, issue: 'GET /repos/acme/factory/issues/41' };
}

test('R5: compose binds the source the queue verified, not whatever the spec says by then', async () => {
  const { input, net, run, issue } = await specConfirmation();
  const checked = plain(await run.records.check(input.action.item));
  assert.equal(checked.result, 'matched', JSON.stringify(checked));
  net.github[issue].json.body = net.github[issue].json.body.replace('Synthetic notes are scattered.', 'Synthetic notes sync to every device.');
  assert.deepEqual(plain(await run.records.compose(input.action)), { refused: 'source_changed' },
    'the spec body changed under an unchanged headline after the queue checked it');
});

test('R5: compose refuses a current item no source check of OW.records verified', async () => {
  const { input, run } = await specConfirmation();
  assert.deepEqual(plain(await run.records.compose(input.action)), { refused: 'source_unchecked' });
  assert.deepEqual(run.net.writes(), []);
});

async function lostPlanApproval(mode) {
  const input = await json(new URL('decision-yes-plan_approval.input.json', FORMS));
  const net = new Net(input.github);
  const run = await boot({ net });
  const preview = await composeLike(run.records, input.action);
  await confirmAll(run.records, preview);
  net.mode = mode;
  assert.equal(plain(await run.records.post(preview)).outcome, 'unknown');
  net.mode = 'ok';
  const issue = 'GET /repos/acme/factory/issues/41';
  net.github[issue].json.body = net.github[issue].json.body.replace('Sync.', 'Sync, later.');
  await confirmAll(run.records, preview);
  return { run, net, preview, outcome: plain(await run.records.post(preview)) };
}

test('R6: an unknown send that landed is found by a read before the changed source can refuse it', async () => {
  const { net, outcome } = await lostPlanApproval('lost');
  assert.equal(outcome.outcome, 'posted', JSON.stringify(outcome));
  assert.equal(outcome.comment.id, net.list(41)[0].id);
  assert.equal(net.writes().length, 1);
});

test('R6: a stale preview a complete read rules out is retired, unsent, and stops blocking its subject', async () => {
  const { run, net, preview, outcome } = await lostPlanApproval('dropped');
  assert.deepEqual(outcome, { outcome: 'refused', op: preview.op, reason: 'source_changed' });
  assert.equal(net.writes().length, 1, 'a stale preview was sent again');
  assert.deepEqual(plain(run.records.pending().map(p => p.op)), [], 'the retired intent is still pending');
  const steer = await json(new URL('spec-not_now.input.json', FORMS));
  const next = await run.records.compose(steer.action);
  next.confirms && run.records.confirm(next, tap());
  assert.equal(plain(await run.records.post(next)).outcome, 'posted', 'the retired intent still blocks its subject');
});

test('R6: after an unknown, a new write needs a fresh source match', async () => {
  const input = await json(new URL('decision-yes-plan_approval.input.json', FORMS));
  const net = new Net(input.github);
  const run = await boot({ net });
  const preview = await composeLike(run.records, input.action);
  await confirmAll(run.records, preview);
  net.mode = 'dropped';
  assert.equal(plain(await run.records.post(preview)).outcome, 'unknown');
  net.mode = 'ok';
  delete net.github['GET /repos/acme/factory/issues/41/sub_issues?per_page=100&page=1'];
  await confirmAll(run.records, preview);
  assert.deepEqual(plain(await run.records.post(preview)), { outcome: 'refused', op: preview.op, reason: 'source_unchecked' });
  assert.equal(net.writes().length, 1);
});

test('a script that claims the write path before records.js leaves the layer off, with zero writes', async () => {
  const input = await json(new URL('spec-not_now.input.json', FORMS));
  const run = await boot({ before: 'OW.stolen = OW.data.writer();' });
  assert.equal(typeof run.OW.stolen?.github, 'function', 'the first claim got no handle');
  assert.equal(run.records.enabled(), false);
  const preview = await run.records.compose(input.action);
  run.records.confirm(preview, tap());
  assert.deepEqual(plain(await run.records.post(preview)), { outcome: 'refused', op: preview.op, reason: 'disabled' });
  assert.deepEqual(run.net.writes(), []);
});

test('a 4xx answer is refused and frees the subject; a 5xx answer is unknown and holds it', async () => {
  const input = await json(new URL('spec-not_now.input.json', FORMS));
  const run = await boot();
  const first = await run.records.compose(input.action);
  run.records.confirm(first, tap());
  run.net.mode = 'forbidden';
  assert.deepEqual(plain(await run.records.post(first)), { outcome: 'refused', op: first.op, reason: 'github' });
  assert.deepEqual(plain(run.records.pending()), []);
  const second = await run.records.compose(input.action);
  run.records.confirm(second, tap());
  run.net.mode = 'server';
  assert.equal(plain(await run.records.post(second)).outcome, 'unknown');
  assert.deepEqual(plain(run.records.pending().map(p => p.op)), [second.op]);
  assert.equal(run.net.writes().length, 2);
});
