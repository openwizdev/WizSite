import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { SITE, signIn, start } from './browser.mjs';

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
const SCRIPTS = ['app/data.js', 'app/records.js', 'app/ui.js', 'app/pages/specs.js'];
const json = async url => JSON.parse(await readFile(url, 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value));
const names = async url => (await readdir(url)).filter(n => n.endsWith('.input.json')).map(n => n.slice(0, -'.input.json'.length)).sort();
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise(resolve => setImmediate(resolve)); };
const RECORDED_AT = '2030-01-07T07:06:40.000Z';

class Net {
  constructor(github = {}, comments = {}) {
    this.github = structuredClone(github);
    this.comments = structuredClone(comments);
    this.log = [];
    this.mode = 'ok';
    this.next = 9100050;
    this.account = OWNER;
    this.edited = {};
    this.held = [];
    this.intercept = null;
    this.link = undefined;
  }
  writes() { return this.log.filter(r => r.method !== 'GET' && !(r.url === `${API}/graphql`) && !r.url.startsWith('/api/')); }
  posts() { return this.log.filter(r => r.method === 'POST' && /\/comments$/.test(r.url)); }
  list(number, full = 'acme/factory') { return (this.comments[full === 'acme/factory' ? number : `${full}#${number}`] ||= []); }
  add(number, comment, full = 'acme/factory') { this.list(number, full).push(comment); }
  recorded(full, number) {
    return Object.entries(this.github).filter(([key, got]) => key.startsWith(`GET /repos/${full}/issues/comments/`) && got.status === 200
      && got.json?.issue_url === `${API}/repos/${full}/issues/${number}`).map(([, got]) => ({ created_at: RECORDED_AT, ...got.json }));
  }
  async fetch(url, init = {}) {
    const method = init.method || 'GET';
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    this.log.push({ method, url: String(url), headers, body: init.body, redirect: init.redirect });
    const at = new URL(url, 'https://openwiz.dev');
    if (this.intercept) {
      const out = await this.intercept(method, at, init);
      if (out) return out;
    }
    const answer = (status, body, extra = {}) => Response.json(body, { status, headers: extra });
    if (at.origin === 'https://openwiz.dev' && method === 'POST' && at.pathname === '/api/sign-in/token') {
      return answer(200, { access_token: TOKEN, expires_in: 28800, refresh_token: 'synthetic-refresh', refresh_token_expires_in: 1e6 });
    }
    if (at.origin === 'https://openwiz.dev' && method === 'POST' && at.pathname === '/api/sign-in/refresh') {
      return answer(200, { access_token: `${TOKEN}-renewed`, expires_in: 28800, refresh_token: 'synthetic-refresh-2', refresh_token_expires_in: 1e6 });
    }
    if (at.origin !== API) return Response.json({ error: 'not_found' }, { status: 404 });
    if (method === 'GET' && at.pathname === '/user') return answer(200, this.account);
    if (method === 'POST' && at.pathname === '/graphql') {
      const query = JSON.parse(init.body);
      const number = query.variables?.number;
      if (/lastEditedAt/.test(query.query) && Object.hasOwn(this.edited, number) && this.edited[number] === 'fail') return answer(502, {});
      if (/lastEditedAt/.test(query.query)) return answer(200, { data: { repository: { issue: { lastEditedAt: this.edited[number] ?? null } } } });
      return answer(200, { data: {} });
    }
    const comments = at.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/comments$/);
    if (comments && method === 'GET') {
      const [, full, number] = comments;
      const page = Number(at.searchParams.get('page'));
      const all = [...this.recorded(full, number), ...this.list(number, full).map(c => ({ html_url: `https://github.com/${full}/issues/${number}#issuecomment-${c.id}`,
        issue_url: `${API}/repos/${full}/issues/${number}`, ...c }))];
      if (this.link !== undefined && page === 1) return answer(200, all, { Link: this.link });
      if (this.pages && page === 1) return answer(200, all.slice(0, 1), { Link: `<${API}${at.pathname}?per_page=100&page=2>; rel="next"` });
      if (this.pages && page === 2) return this.pages === 'fail' ? answer(502, {}) : answer(200, all.slice(1));
      return answer(200, page === 1 ? all : []);
    }
    if (comments && method === 'POST') {
      const [, full, number] = comments;
      const id = this.next++;
      const comment = { id, user: { login: this.account.login, id: this.account.id }, body: JSON.parse(init.body).body,
        created_at: new Date().toISOString(), html_url: `https://github.com/${full}/issues/${number}#issuecomment-${id}` };
      if (this.mode === 'hang') return new Promise(resolve => this.held.push(() => { this.add(number, comment, full); resolve(answer(201, comment)); }));
      if (this.mode === 'void') { this.add(number, comment, full); return new Promise(() => {}); }
      if (this.mode === 'dropped') throw new TypeError('synthetic network failure');
      if (this.mode === 'server') return answer(502, { message: 'Bad Gateway' });
      if (this.mode === 'forbidden') return answer(403, { message: 'Resource not accessible by integration' });
      if (this.mode === 'expired') { this.mode = 'ok'; return answer(401, { message: 'Bad credentials' }); }
      if (this.mode === 'redirect') return new Response(null, { status: 307, headers: { Location: `${API}/repos/acme/elsewhere/issues/${number}/comments` } });
      this.add(number, comment, full);
      if (this.mode === 'lost') throw new TypeError('synthetic lost answer');
      return answer(201, comment);
    }
    const recorded = this.github[`${method} ${at.pathname}${at.search}`];
    if (recorded) return answer(recorded.status, recorded.json, recorded.next ? { Link: `<${API}/next>; rel="next"` } : {});
    return answer(404, { message: 'Not Found' });
  }
}

const branded = new WeakMap();
class FakeEvent {
  constructor(type, trusted) {
    branded.set(this, type);
    Object.defineProperty(this, 'isTrusted', { get: () => trusted, enumerable: true, configurable: false });
  }
}
Object.defineProperty(FakeEvent.prototype, 'type', { configurable: true, enumerable: true, get() {
  if (!branded.has(this)) throw new TypeError('Illegal invocation');
  return branded.get(this);
} });
const tap = () => new FakeEvent('click', true);

class Locks {
  constructor() { this.held = new Map(); }
  async request(name, options, callback) {
    if (typeof options === 'function') [options, callback] = [{}, options];
    if (options.ifAvailable && this.held.has(name)) return callback(null);
    while (this.held.has(name)) await this.held.get(name).promise;
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    this.held.set(name, { promise });
    try { return await callback({ name, mode: 'exclusive' }); } finally { this.held.delete(name); release(); }
  }
}

function scriptElement(src) {
  return { tagName: 'SCRIPT', nextElementSibling: null, getAttribute: name => (name === 'src' ? `/${src}` : null) };
}

async function boot({ net = new Net(), storage = new Map(), locks = new Locks(), mode = 'on', account = OWNER, picked = PICKED, search = '',
  signedIn = true, known = true, between, expiresAt = null, lockless = false } = {}) {
  if (mode !== null) storage.set('openwiz.app.v2', JSON.stringify(mode));
  if (signedIn) {
    storage.set('openwiz.app.auth', JSON.stringify({ session: `session-${account.id}`, token: TOKEN, expiresAt, refresh: 'synthetic-refresh',
      refreshExpiresAt: null, ...(known ? { account: account.id } : {}) }));
  }
  if (picked) storage.set('openwiz.app.repo', JSON.stringify(picked));
  net.account = account;
  const page = { search, replaced: [] };
  class Document {}
  Object.defineProperty(Document.prototype, 'currentScript', { configurable: true, get() { return page.current ?? null; } });
  const document = Object.assign(new Document(), { hidden: false, addEventListener() {}, createElementNS() { throw new Error('no DOM in this test'); } });
  const order = between ? [SCRIPTS[0], 'app/between.js', ...SCRIPTS.slice(1)] : SCRIPTS;
  const elements = order.map(scriptElement);
  elements.forEach((el, i) => { el.nextElementSibling = elements[i + 1] ?? null; });
  const context = {
    console, URL, URLSearchParams, Headers, Response, TextDecoder, TextEncoder, atob, btoa, setTimeout, clearTimeout,
    crypto: webcrypto, Event: FakeEvent, structuredClone, Document, document,
    navigator: lockless ? {} : { locks },
    fetch: (url, init) => net.fetch(url, init),
    localStorage: {
      getItem: key => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    location: { get search() { return page.search; }, pathname: '/app/', hash: '#/you' },
    history: { replaceState: (_, __, url) => { page.replaced.push(url); page.search = new URL(url, 'https://openwiz.dev').search; } },
  };
  context.window = context;
  vm.createContext(context);
  for (const [i, script] of order.entries()) {
    page.current = elements[i];
    if (script === 'app/between.js') vm.runInContext(between, context);
    else {
      const file = new URL(script, ROOT);
      if (existsSync(file)) vm.runInContext(await readFile(file, 'utf8'), context, { filename: script });
    }
  }
  page.current = null;
  const OW = context.OW;
  OW.data.feeds.specs.data = { fleet: { text: FLEET } };
  await settle();
  const run = { OW, net, storage, locks, page, context, records: OW.records };
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
  if (action.item?.type === 'decision' && action.item.request) {
    const checked = await records.check(action.item);
    action = { ...action, item: { ...action.item, checked_at: checked.checked_at } };
  }
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
  assert.equal(OW.data.claim(), null, 'a second script claimed the write path');
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
  const forged = Object.create(FakeEvent.prototype);
  Object.defineProperty(forged, 'isTrusted', { get: () => true, configurable: false });
  run.records.confirm(preview, forged);
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
  net.mode = 'void';
  first.records.post(preview);
  await settle();
  assert.equal(net.writes().length, 1, 'the first write did not start');
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
  assert.deepEqual(plain(await run.records.compose({ ...input.action, item: { ...input.action.item, checked_at: checked.checked_at } })), { refused: 'source_changed' },
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

const STEER = new URL('spec-not_now.input.json', FORMS);
const OTHER = { id: 6001, login: 'acme-other' };
const PUBLIC = { owner: 'acme', name: 'public', full: 'acme/public', private: false };
async function steerPreview(run, words) {
  const { action } = await json(words ? new URL('spec-change.input.json', FORMS) : STEER);
  return run.records.compose(words ? { ...action, words } : action);
}
function onFirstRead(net, then) {
  const original = net.fetch.bind(net);
  let done = false;
  net.fetch = async (url, init = {}) => {
    const response = await original(url, init);
    if (!done && (init.method || 'GET') === 'GET' && /\/issues\/\d+\/comments/.test(String(url))) {
      done = true;
      const body = response.json.bind(response);
      response.json = async () => { then(); return body(); };
    }
    return response;
  };
}

test('R1: a repository switched during post\'s reads never moves the write to it', async () => {
  const run = await boot();
  const preview = await steerPreview(run);
  run.records.confirm(preview, tap());
  onFirstRead(run.net, () => run.storage.set('openwiz.app.repo', JSON.stringify(PUBLIC)));
  const outcome = plain(await run.records.post(preview));
  assert.equal(outcome.outcome, 'refused', JSON.stringify(outcome));
  assert.deepEqual(run.net.posts().map(r => r.url), [], 'the private repository\'s preview was posted to another repository');
});

test('R1: a session switched during post\'s reads never posts under the new account', async () => {
  const run = await boot();
  const preview = await steerPreview(run);
  run.records.confirm(preview, tap());
  onFirstRead(run.net, () => run.storage.set('openwiz.app.auth', JSON.stringify({ session: 'session-6001', token: 'synthetic-token-other',
    expiresAt: null, refresh: null, refreshExpiresAt: null, account: OTHER.id })));
  const outcome = plain(await run.records.post(preview));
  assert.equal(outcome.outcome, 'refused', JSON.stringify(outcome));
  assert.deepEqual(run.net.posts(), [], 'the confirmed preview was posted after the session changed');
});

test('R1: a preview composed under one sign-in is never posted under another', async () => {
  const run = await boot();
  const preview = await steerPreview(run);
  run.storage.set('openwiz.app.auth', JSON.stringify({ session: 'session-later', token: 'synthetic-token-other',
    expiresAt: null, refresh: null, refreshExpiresAt: null, account: OTHER.id }));
  run.records.confirm(preview, tap());
  const from = run.net.log.length;
  assert.deepEqual(plain(await run.records.post(preview)), { outcome: 'refused', op: preview.op, reason: 'not_composed' });
  assert.equal(run.net.log.length, from, 'a preview from an earlier sign-in made requests');
});

test('R1: records-layer requests never follow a redirect, and a redirected write is refused', async () => {
  const run = await boot();
  const preview = await steerPreview(run);
  run.records.confirm(preview, tap());
  const from = run.net.log.length;
  run.net.mode = 'redirect';
  const outcome = plain(await run.records.post(preview));
  assert.deepEqual(outcome, { outcome: 'refused', op: preview.op, reason: 'github' });
  const sent = run.net.log.slice(from);
  assert.ok(sent.length >= 2, 'post made no reads');
  for (const request of sent) assert.equal(request.redirect, 'manual', `${request.method} ${request.url} follows redirects`);
  assert.equal(run.net.posts().length, 1);
});

test('R2: no page script can obtain the write path, before or after records.js', async () => {
  const between = await boot({ between: 'OW.stolen = [OW.data.claim?.() ?? null, OW.data.writer?.() ?? null];' });
  assert.deepEqual(plain(between.OW.stolen.map(Boolean)), [false, false], 'a script after data.js obtained the write path');
  assert.equal(between.records.enabled(), false, 'records.js wrote with an unknown script between it and data.js');
  const run = await boot();
  assert.equal(run.records.enabled(), true, 'records.js did not get the write path');
  assert.equal(run.OW.data.writer, undefined, 'OW.data still offers a writer');
  assert.equal(run.OW.data.claim?.() ?? null, null, 'a later script obtained the write path');
});

test('R3: the public client checks the payload it actually sends, not the caller\'s object', async () => {
  const run = await boot();
  let reads = 0;
  const shifty = { variables: {}, get query() { reads += 1; return reads > 1 ? 'mutation M { addComment(input: {}) { clientMutationId } }' : 'query Q { viewer { login } }'; } };
  const masked = { query: 'query Q { viewer { login } }', toJSON: () => ({ query: 'mutation M { addComment(input: {}) { clientMutationId } }' }) };
  for (const body of [shifty, masked]) await run.OW.data.github('POST', '/graphql', body).catch(() => {});
  for (const request of run.net.log.filter(r => r.url === `${API}/graphql`)) {
    assert.doesNotMatch(JSON.parse(request.body).query, /mutation/, 'a GraphQL mutation was sent with the user\'s token');
  }
});

test('R4: compose builds the preview from one snapshot, whatever the caller changes during its reads', async () => {
  const input = await json(new URL('decision-own-plan_approval.input.json', FORMS));
  const run = await boot({ net: new Net(input.github) });
  const checked = await run.records.check(input.action.item);
  const action = structuredClone({ ...input.action, item: { ...input.action.item, checked_at: checked.checked_at } });
  const composing = run.records.compose(action);
  action.words = 'launch-fleet: started';
  action.item.request.risk = 'ordinary';
  const preview = plain(await composing);
  assert.equal(preview.body, await json(new URL('decision-own-plan_approval.body.json', FORMS)), JSON.stringify(preview).slice(0, 200));
  assert.equal(preview.confirms, 2, 'the risky preview lost its second confirm');
});

async function genuineUnknown(storage = new Map()) {
  const input = await json(new URL('decision-yes-plan_approval.input.json', FORMS));
  const net = new Net(input.github);
  const run = await boot({ net, storage });
  const preview = await composeLike(run.records, input.action);
  await confirmAll(run.records, preview);
  net.mode = 'dropped';
  assert.equal(plain(await run.records.post(preview)).outcome, 'unknown');
  net.mode = 'ok';
  return { net, storage, preview, key: `openwiz.app.v2.receipts.${OWNER.id}` };
}

test('R5: a tampered receipt restores nothing, and a forged one never becomes a preview', async () => {
  const tampers = {
    'no before': r => { delete r.before; },
    'one confirm for a live approval': r => { r.preview.confirms = 1; },
    'another body': r => { r.preview.body = 'launch-fleet: started'; r.body = r.preview.body; },
    'another subject': r => { r.preview.subject.number = 42; r.subject = { ...r.preview.subject }; },
    'no sent_at': r => { delete r.sent_at; },
  };
  const restored = [];
  for (const [what, tamper] of Object.entries(tampers)) {
    const { net, storage, preview, key } = await genuineUnknown();
    const ledger = JSON.parse(storage.get(key));
    tamper(ledger[preview.op]);
    storage.set(key, JSON.stringify(ledger));
    const run = await boot({ net, storage });
    if (run.records.pending().length) restored.push(what);
  }
  assert.deepEqual(restored, [], 'tampered receipts were restored');
});

test('R5: an unreadable receipt ledger refuses every post for that account with zero requests', async () => {
  for (const ledger of ['{"op-', '[]', JSON.stringify({ 'op-1': { state: 'sending' } })]) {
    const storage = new Map([[`openwiz.app.v2.receipts.${OWNER.id}`, ledger]]);
    const run = await boot({ storage });
    const preview = await steerPreview(run);
    run.records.confirm(preview, tap());
    const from = run.net.log.length;
    const outcome = plain(await run.records.post(preview));
    assert.deepEqual(outcome, { outcome: 'refused', op: preview.op, reason: 'pending' }, ledger);
    assert.equal(run.net.log.length, from, `${ledger}: post made a request`);
  }
});

test('R6: two previews for one subject confirmed together send one comment', async () => {
  const run = await boot();
  const a = await steerPreview(run);
  const b = await steerPreview(run, 'later words');
  run.records.confirm(a, tap());
  run.records.confirm(b, tap());
  const outcomes = (await Promise.all([run.records.post(a), run.records.post(b)])).map(plain);
  assert.equal(run.net.posts().length, 1, `two comments while the first was unresolved: ${JSON.stringify(outcomes)}`);
  assert.deepEqual(outcomes.map(o => o.outcome).sort(), ['posted', 'refused']);
  assert.equal(outcomes.find(o => o.outcome === 'refused').reason, 'pending');
});

test('R6: another tab cannot reconcile and resend an attempt that is still in flight', async () => {
  const net = new Net();
  const storage = new Map();
  const locks = new Locks();
  const first = await boot({ net, storage, locks });
  const preview = await steerPreview(first);
  first.records.confirm(preview, tap());
  net.mode = 'hang';
  const sending = first.records.post(preview);
  await settle();
  assert.equal(net.posts().length, 1, 'the first write did not start');
  net.mode = 'ok';
  const second = await boot({ net, storage, locks });
  const restored = second.records.pending();
  assert.deepEqual(plain(restored.map(p => p.op)), [preview.op]);
  second.records.confirm(restored[0], tap());
  const from = net.log.length;
  const outcome = plain(await second.records.post(restored[0]));
  assert.deepEqual(outcome, { outcome: 'refused', op: preview.op, reason: 'pending' }, JSON.stringify(outcome));
  assert.equal(net.log.length, from, 'the second tab made requests for an attempt still in flight');
  net.held.shift()();
  assert.equal(plain(await sending).outcome, 'posted');
  assert.equal(net.posts().length, 1);
});

test('R7: a confirmed post sends one POST, even when GitHub refuses the token and a refresh would succeed', async () => {
  const run = await boot();
  const preview = await steerPreview(run);
  run.records.confirm(preview, tap());
  run.net.mode = 'expired';
  const outcome = plain(await run.records.post(preview));
  assert.equal(run.net.posts().length, 1, 'one confirm sent two POSTs');
  assert.deepEqual(outcome, { outcome: 'refused', op: preview.op, reason: 'github' });
});

test('R7: an expired token is refreshed before the one POST, never after it', async () => {
  const run = await boot({ expiresAt: Date.now() - 1000 });
  const preview = await steerPreview(run);
  run.records.confirm(preview, tap());
  const outcome = plain(await run.records.post(preview));
  assert.equal(outcome.outcome, 'posted', JSON.stringify(outcome));
  assert.equal(run.net.posts().length, 1);
  assert.equal(run.net.posts()[0].headers.authorization, `Bearer ${TOKEN}-renewed`);
});

test('R8: signing in again after an interrupted send restores the pending intent', async () => {
  const net = new Net();
  const storage = new Map();
  const first = await boot({ net, storage });
  const preview = await steerPreview(first);
  first.records.confirm(preview, tap());
  net.mode = 'void';
  first.records.post(preview);
  await settle();
  net.mode = 'ok';
  storage.delete('openwiz.app.auth');
  const run = await boot({ net, storage, signedIn: false });
  assert.deepEqual(plain(run.records.pending()), []);
  await run.OW.data.finishSignIn('c0de', 'S'.repeat(43));
  await settle();
  assert.deepEqual(plain(run.records.pending().map(p => p.op)), [preview.op], 'the pending intent is missing after signing in again');
});

test('R8: an unconfirmed post makes zero requests, whatever is known about the account', async () => {
  const run = await boot({ mode: 'off', known: false });
  run.storage.set('openwiz.app.v2', '"on"');
  const preview = await steerPreview(run);
  const from = run.net.log.length;
  const outcome = plain(await run.records.post(preview));
  assert.equal(outcome.outcome, 'refused', JSON.stringify(outcome));
  assert.deepEqual(run.net.log.slice(from).map(r => `${r.method} ${r.url}`), [], 'an unconfirmed post made a request');
});

async function grillRound(edit = {}) {
  const input = await json(new URL('decision-yes-grill_round.input.json', FORMS));
  const key = Object.keys(input.github).find(k => k.includes('/contents/'));
  const comment = Object.keys(input.github).find(k => k.includes('/issues/comments/'));
  const file = input.github[key].json;
  let bytes = Buffer.from(file.content, 'base64');
  if (edit.grill) bytes = Buffer.from(edit.grill(bytes.toString('utf8')), 'utf8');
  if (edit.bytes) bytes = edit.bytes(bytes);
  file.content = edit.content ? edit.content(bytes.toString('base64')) : bytes.toString('base64');
  if (edit.path) file.path = edit.path(file.path);
  if (edit.request) {
    edit.request(input.action.item.request);
    input.github[comment].json.body = `**Decision request** for the owner.\n\n\`\`\`json\n${JSON.stringify(input.action.item.request, null, 2)}\n\`\`\``;
  }
  const net = new Net(input.github);
  const run = await boot({ net });
  return { input, net, run, key };
}

test('R9: a later check of the same decision never authorises an older card\'s action', async () => {
  const { input, net, run, key } = await grillRound();
  const older = plain(await run.records.check(input.action.item));
  assert.equal(older.result, 'matched');
  const file = net.github[key].json;
  file.content = Buffer.from(Buffer.from(file.content, 'base64').toString('utf8').replace('Feeds: the notes spec.', 'Feeds: the notes spec, edited.')).toString('base64');
  const newer = plain(await run.records.check(input.action.item));
  assert.equal(newer.result, 'matched');
  assert.notEqual(newer.binding.digest, older.binding.digest);
  const got = plain(await run.records.compose({ ...input.action, item: { ...input.action.item, checked_at: older.checked_at } }));
  assert.deepEqual(got, { refused: 'source_changed' }, 'the older card composed against a newer check');
});

test('R9: the binding check returns is a copy the caller cannot use to change the kept one', async () => {
  const { input, run } = await grillRound();
  const checked = await run.records.check(input.action.item);
  try { checked.binding.digest = '0'.repeat(64); } catch {}
  const preview = plain(await run.records.compose({ ...input.action, item: { ...input.action.item, checked_at: checked.checked_at } }));
  assert.match(preview.op ?? '', /^op-/, `the kept binding was changed through check's answer: ${JSON.stringify(preview)}`);
});

test('R10: a saved grill or request the grill parser refuses is never a current decision', async () => {
  const twice = r => { r.questions[1].id = 'N1'; };
  const cases = {
    'duplicate question ids': { grill: g => g.replace('**N2 - Whether', '**N1 - Whether'), request: twice },
    'an empty question context': { grill: g => g.replace('stay** Done notes can hide or stay.', 'stay** '), request: r => { r.questions[1].context = ''; } },
    'a context line starting **': { grill: g => g.replace('hide or stay.\n', 'hide or stay.\n**Also** this.\n'),
      request: r => { r.questions[1].context += '\n**Also** this.'; } },
    'repeated answer progress': { request: r => { r.answered = ['N1', 'N1']; } },
    'a byte order mark': { bytes: b => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), b]) },
    'base64 with spaces': { content: c => c.replace(/(.{8})/g, '$1 ') },
    'another blob path': { path: path => path.replace('notes', 'other') },
  };
  const accepted = [];
  for (const [what, edit] of Object.entries(cases)) {
    const { input, run } = await grillRound(edit);
    const checked = plain(await run.records.check(input.action.item));
    const got = plain(await run.records.compose({ ...input.action, item: { ...input.action.item, checked_at: checked.checked_at } }));
    if (checked.result === 'matched' || !got.refused) accepted.push(`${what} (${checked.result}, ${got.refused ?? 'composed'})`);
  }
  assert.deepEqual(accepted, [], 'the grill parser refuses these, and the records layer accepted them');
});

test('R11: a newer record on the subject stops an older card\'s answer before it is sent', async () => {
  const later = (id, body) => ({ id, user: { login: 'factory-bot[bot]', id: 5900 }, body, created_at: '2030-01-08T00:00:00.000Z' });
  for (const [body, reason] of [
    ['```json\n{"schema":"openwiz.decisions.v1","kind":"spec_confirmation","id":"sc_notes_2","status":"open","fingerprint":"2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f","risk":"ordinary","spec":41,"summary":["Keep notes in two lists."],"headline":"Keep your notes in one list.","tickets":[],"graph":[]}\n```', 'source_changed'],
    ['```json\n{"schema":"openwiz.decisions.v1","kind":"spec_confirmation",\n```', 'source_unchecked'],
  ]) {
    const { input, net, run } = await specConfirmation();
    const preview = await composeLike(run.records, input.action);
    await confirmAll(run.records, preview);
    net.add(41, later(9100009, body));
    const outcome = plain(await run.records.post(preview));
    assert.deepEqual(outcome, { outcome: 'refused', op: preview.op, reason }, JSON.stringify(outcome));
    assert.deepEqual(net.posts(), [], 'an answer to a replaced request was sent');
  }
});

test('R12: two comments that could be this send stay unknown, never posted', async () => {
  const { net, storage, preview } = await genuineUnknown();
  const mine = id => ({ id, user: { login: OWNER.login, id: OWNER.id }, body: preview.body, created_at: new Date().toISOString() });
  net.add(41, mine(9100060));
  net.add(41, mine(9100061));
  const run = await boot({ net, storage });
  const [restored] = run.records.pending();
  await confirmAll(run.records, restored);
  const outcome = plain(await run.records.post(restored));
  assert.equal(outcome.outcome, 'unknown', JSON.stringify(outcome));
  assert.equal(net.posts().length, 1);
});

test('R12: a match on an incomplete read stays unknown', async () => {
  const input = await json(new URL('spec-not_now.input.json', FORMS));
  const run = await boot();
  const preview = await run.records.compose(input.action);
  run.records.confirm(preview, tap());
  run.net.mode = 'lost';
  assert.equal(plain(await run.records.post(preview)).outcome, 'unknown');
  run.net.mode = 'ok';
  run.net.add(41, { id: 9100070, user: { login: 'someone', id: 77 }, body: 'hello', created_at: new Date().toISOString() });
  run.net.pages = 'fail';
  run.records.confirm(preview, tap());
  const outcome = plain(await run.records.post(preview));
  assert.equal(outcome.outcome, 'unknown', JSON.stringify(outcome));
  assert.equal(run.net.posts().length, 1);
});

test('R12: an unreadable comment in the reconciling read never rules the earlier send out', async () => {
  for (const entry of [{ id: 'x', body: 'stop' }, null, { id: 9100071, user: null, body: 'stop', created_at: new Date().toISOString() },
    { id: 9100072, user: { login: OWNER.login, id: OWNER.id }, body: 'stop' }]) {
    const run = await boot();
    const preview = await steerPreview(run);
    run.records.confirm(preview, tap());
    run.net.mode = 'dropped';
    assert.equal(plain(await run.records.post(preview)).outcome, 'unknown');
    run.net.mode = 'ok';
    run.net.add(41, entry);
    run.records.confirm(preview, tap());
    const outcome = plain(await run.records.post(preview));
    assert.equal(outcome.outcome, 'unknown', `${JSON.stringify(entry)}: ${JSON.stringify(outcome)}`);
    assert.equal(run.net.posts().length, 1, `${JSON.stringify(entry)}: sent again after an unreadable read`);
  }
});

test('R13: a retired operation stays retired, even when its source returns to what was shown', async () => {
  const { run, net, preview, outcome } = await lostPlanApproval('dropped');
  assert.equal(outcome.reason, 'source_changed');
  const issue = 'GET /repos/acme/factory/issues/41';
  net.github[issue].json.body = net.github[issue].json.body.replace('Sync, later.', 'Sync.');
  const counted = [];
  for (let i = 0; i < preview.confirms; i += 1) counted.push(run.records.confirm(preview, tap()).confirmed);
  const from = net.log.length;
  const again = plain(await run.records.post(preview));
  assert.deepEqual(again, { outcome: 'refused', op: preview.op, reason: 'source_changed' }, JSON.stringify(again));
  assert.equal(net.log.length, from, 'a retired operation made requests');
  assert.deepEqual(counted, counted.map(() => 0), 'a retired operation counted confirms');
  assert.equal(net.posts().length, 1);
});

test('R15: a spec edited after its confirmation request was posted is never matched, whatever its headline', async () => {
  for (const [edited, result] of [['2030-01-08T00:00:00Z', 'changed'], ['2030-01-07T07:06:40Z', 'unchecked'], ['fail', 'unchecked'], [null, 'matched'], ['2030-01-07T07:06:39Z', 'matched']]) {
    const { input, net, run } = await specConfirmation();
    net.edited[41] = edited;
    const checked = plain(await run.records.check(input.action.item));
    assert.equal(checked.result, result, `last edited ${edited}`);
  }
});

test('R9 (#2923): an older check finishing after a newer changed or unchecked check never publishes currentness', async () => {
  for (const newerOutcome of ['changed', 'unchecked']) {
    const { input, net, run, key } = await grillRound();
    const original = structuredClone(net.github[key]);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let held = false;
    net.intercept = async (method, at) => {
      if (method === 'GET' && at.pathname.includes('/contents/') && !held) {
        held = true;
        await gate;
        return Response.json(original.json, { status: original.status });
      }
      return null;
    };
    const olderPromise = run.records.check(input.action.item);
    await settle();
    assert.equal(held, true, `${newerOutcome}: older check did not reach contents read`);
    if (newerOutcome === 'changed') {
      net.github['GET /repos/acme/factory/pulls/7'].json.state = 'closed';
    } else {
      net.github[key] = { status: 502, json: { message: 'Bad Gateway' } };
    }
    const newer = plain(await run.records.check(input.action.item));
    assert.equal(newer.result, newerOutcome, `${newerOutcome}: newer check did not produce expected negative outcome`);
    release();
    const older = plain(await olderPromise);
    assert.deepEqual(older, { result: 'unchecked', binding: null, checked_at: null },
      `${newerOutcome}: older check published currentness after newer ${newerOutcome}`);
    net.github['GET /repos/acme/factory/pulls/7'].json.state = 'open';
    net.github[key] = structuredClone(original);
    const composed = plain(await run.records.compose({ ...input.action, item: { ...input.action.item, checked_at: older.checked_at ?? 1 } }));
    assert.equal(composed.refused, 'source_unchecked',
      `${newerOutcome}: older check left a kept binding that allowed compose: ${JSON.stringify(composed)}`);
  }
});

test('R11 (#2923): a replacement or unreadable record posted while post source check runs is refused before dispatch, while landed sends still reconcile first', async () => {
  const later = (id, body) => ({ id, user: { login: 'factory-bot[bot]', id: 5900 }, body, created_at: '2030-01-08T00:00:00.000Z' });
  const replacement = '```json\n{"schema":"openwiz.decisions.v1","kind":"spec_confirmation","id":"sc_notes_2","status":"open","fingerprint":"2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f","risk":"ordinary","spec":41,"summary":["Keep notes in two lists."],"headline":"Keep your notes in one list.","tickets":[],"graph":[]}\n```';
  const unreadable = '```json\n{"schema":"openwiz.decisions.v1","kind":"spec_confirmation",\n```';
  for (const [body, reason] of [[replacement, 'source_changed'], [unreadable, 'source_unchecked']]) {
    const { input, net, run } = await specConfirmation();
    const preview = await composeLike(run.records, input.action);
    await confirmAll(run.records, preview);
    let injected = false;
    net.intercept = async (method, at) => {
      if (method === 'GET' && at.pathname === '/repos/acme/factory/issues/41' && !injected) {
        injected = true;
        net.add(41, later(9100019, body));
      }
      return null;
    };
    const outcome = plain(await run.records.post(preview));
    assert.equal(injected, true, `${reason}: sourceCheck did not read the spec`);
    assert.deepEqual(outcome, { outcome: 'refused', op: preview.op, reason }, JSON.stringify(outcome));
    assert.deepEqual(net.posts(), [], `${reason}: post sent despite late record during source check`);
  }
  {
    const { input, net, run } = await specConfirmation();
    const preview = await composeLike(run.records, input.action);
    await confirmAll(run.records, preview);
    net.mode = 'dropped';
    assert.equal(plain(await run.records.post(preview)).outcome, 'unknown');
    net.mode = 'ok';
    let injected = false;
    net.intercept = async (method, at) => {
      if (method === 'GET' && at.pathname === '/repos/acme/factory/issues/41' && !injected) {
        injected = true;
        net.add(41, later(9100020, replacement));
      }
      return null;
    };
    await confirmAll(run.records, preview);
    const outcome = plain(await run.records.post(preview));
    assert.equal(injected, true, 'retry: sourceCheck did not run');
    assert.deepEqual(outcome, { outcome: 'refused', op: preview.op, reason: 'source_changed' }, JSON.stringify(outcome));
    assert.equal(net.posts().length, 1, 'retry: sent a second POST despite late replacement');
    assert.deepEqual(plain(run.records.pending()), [], 'retry: retired receipt stayed pending');
  }
  {
    const { input, net, run } = await specConfirmation();
    const preview = await composeLike(run.records, input.action);
    await confirmAll(run.records, preview);
    net.mode = 'lost';
    assert.equal(plain(await run.records.post(preview)).outcome, 'unknown');
    net.mode = 'ok';
    net.add(41, later(9100021, replacement));
    await confirmAll(run.records, preview);
    const outcome = plain(await run.records.post(preview));
    assert.equal(outcome.outcome, 'posted', `landed send was not reconciled first: ${JSON.stringify(outcome)}`);
    assert.equal(net.posts().length, 1, 'landed send sent a second POST');
  }
});

test('R12 (#2923): a present but unreadable Link header is an incomplete read before either branch of reconcile and on baseline reads', async () => {
  const badLinks = [
    '',
    'garbage',
    `<${API}/repos/acme/factory/issues/41/comments?per_page=100&page=2>; rel=next`,
    `<${API}/repos/acme/factory/issues/41/comments?per_page=100&page=2>; rel="last"`,
    `<${API}/repos/acme/factory/issues/41/comments?per_page=100&page=2>; rel="next", broken`,
  ];
  for (const bad of badLinks) {
    {
      const run = await boot();
      const preview = await steerPreview(run);
      run.records.confirm(preview, tap());
      run.net.mode = 'dropped';
      assert.equal(plain(await run.records.post(preview)).outcome, 'unknown');
      run.net.mode = 'ok';
      run.net.link = bad;
      run.records.confirm(preview, tap());
      const outcome = plain(await run.records.post(preview));
      assert.deepEqual(outcome, { outcome: 'unknown', op: preview.op, reason: 'incomplete' }, `empty branch (${bad}): ${JSON.stringify(outcome)}`);
      assert.equal(run.net.posts().length, 1, `empty branch (${bad}): resent on unreadable Link`);
    }
    {
      const run = await boot();
      const preview = await steerPreview(run);
      run.records.confirm(preview, tap());
      run.net.mode = 'lost';
      assert.equal(plain(await run.records.post(preview)).outcome, 'unknown');
      run.net.mode = 'ok';
      run.net.link = bad;
      run.records.confirm(preview, tap());
      const outcome = plain(await run.records.post(preview));
      assert.deepEqual(outcome, { outcome: 'unknown', op: preview.op, reason: 'incomplete' }, `found branch (${bad}): ${JSON.stringify(outcome)}`);
      assert.equal(run.net.posts().length, 1, `found branch (${bad}): sent again`);
    }
    {
      const run = await boot();
      const preview = await steerPreview(run);
      run.records.confirm(preview, tap());
      run.net.link = bad;
      const outcome = plain(await run.records.post(preview));
      assert.deepEqual(outcome, { outcome: 'refused', op: preview.op, reason: 'source_unchecked' }, `baseline (${bad}): ${JSON.stringify(outcome)}`);
      assert.equal(run.net.posts().length, 0, `baseline (${bad}): posted despite unreadable Link`);
    }
  }
  {
    const run = await boot();
    const preview = await steerPreview(run);
    run.records.confirm(preview, tap());
    run.net.intercept = async (method, at) => {
      if (method === 'GET' && at.pathname === '/repos/acme/factory/issues/41/comments') {
        const page = Number(at.searchParams.get('page'));
        if (page === 1) return Response.json([], { status: 200, headers: { Link: `<${API}${at.pathname}?per_page=100&page=2>; rel="next", <${API}${at.pathname}?per_page=100&page=2>; rel="last"` } });
        if (page === 2) return Response.json([], { status: 200, headers: { Link: `<${API}${at.pathname}?per_page=100&page=1>; rel="prev", <${API}${at.pathname}?per_page=100&page=1>; rel="first"` } });
      }
      return null;
    };
    const outcome = plain(await run.records.post(preview));
    assert.equal(outcome.outcome, 'posted', `valid two-page Link header was refused: ${JSON.stringify(outcome)}`);
    assert.equal(run.net.posts().length, 1);
  }
});

test('R14: in the built app, a real tap confirms and posts once; a scripted click, a dispatched click and one tap counted twice do not', async () => {
  const approval = await json(new URL('decision-yes-plan_approval.input.json', FORMS));
  const steer = (await json(STEER)).action;
  const run = await start();
  const { world, page } = run;
  try {
    const request = { created_at: RECORDED_AT, ...approval.github['GET /repos/acme/factory/issues/comments/9100002'].json };
    const lists = { 41: [request], 44: [] };
    const held = [];
    world.record(approval.github);
    world.github['GET /user'] = () => ({ status: 200, json: OWNER });
    for (const number of [41, 44]) {
      world.github[`GET /repos/acme/factory/issues/${number}/comments`] = () => ({ status: 200, json: lists[number] });
    }
    world.github['POST /repos/acme/factory/issues/41/comments'] = entry => {
      const comment = { id: 9100080 + lists[41].length, user: { login: OWNER.login, id: OWNER.id }, body: JSON.parse(entry.body).body,
        created_at: new Date().toISOString(), html_url: `https://github.com/acme/factory/issues/41#issuecomment-${9100080 + lists[41].length}` };
      lists[41].push(comment);
      return { status: 201, json: comment };
    };
    world.github['POST /repos/acme/factory/issues/44/comments'] = () => ({ status: 307, json: {}, headers: { Location: `${API}/repos/acme/elsewhere/issues/44/comments` } });
    await page.go(`${SITE}/app/?v2=on`);
    await page.until(`document.readyState === 'complete' && window.OW && OW.records`, 'the app page');
    await signIn(page);
    await page.until('OW.data.auth.account() === 5001', 'the account read after signing in');
    const setup = await page.run(`(async () => {
      localStorage.setItem('openwiz.app.repo', JSON.stringify(${JSON.stringify(PICKED)}));
      OW.data.feeds.specs.data = { fleet: { text: ${JSON.stringify(FLEET)} } };
      window.taps = [];
      window.twice = false;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Synthetic confirm';
      b.onclick = e => {
        window.taps.push(OW.records.confirm(window.preview, e));
        if (window.twice) window.taps.push(OW.records.confirm(window.preview, e));
      };
      document.body.prepend(b);
      window.preview = await OW.records.compose(${JSON.stringify(steer)});
      return { enabled: OW.records.enabled(), claim: OW.data.claim(), op: window.preview.op };
    })()`);
    assert.deepEqual(setup.enabled, true, 'records.js got no write path from the built page');
    assert.equal(setup.claim, null, 'a page script obtained the write path');
    assert.match(setup.op, /^op-[0-9a-f]{32}$/);

    await page.click('Synthetic confirm');
    await page.run(`document.querySelector('button').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    const forged = await page.run(`(() => { const e = Object.create(MouseEvent.prototype); return OW.records.confirm(window.preview, e); })()`);
    assert.deepEqual(await page.run('window.taps'), [{ confirmed: 0, of: 1 }, { confirmed: 0, of: 1 }], 'a scripted click confirmed');
    assert.deepEqual(forged, { confirmed: 0, of: 1 });
    assert.deepEqual(await page.run('OW.records.post(window.preview)'), { outcome: 'refused', op: setup.op, reason: 'not_confirmed' });
    assert.deepEqual(world.writes(), []);

    await page.tap('Synthetic confirm');
    assert.deepEqual(await page.run('window.taps.at(-1)'), { confirmed: 1, of: 1 }, 'a real tap did not confirm');
    const posted = await page.run('OW.records.post(window.preview)');
    assert.equal(posted.outcome, 'posted', JSON.stringify(posted));
    assert.equal(world.writes().length, 1);
    assert.equal(world.writes()[0].body, JSON.stringify({ body: 'stop' }));

    const item = approval.action.item;
    const risky = await page.run(`(async () => {
      const item = ${JSON.stringify(item)};
      const checked = await OW.records.check(item);
      window.preview = await OW.records.compose({ ...${JSON.stringify(approval.action)}, item: { ...item, checked_at: checked.checked_at } });
      window.twice = true;
      window.taps = [];
      return window.preview;
    })()`);
    assert.equal(risky.confirms, 2, JSON.stringify(risky));
    await page.tap('Synthetic confirm');
    assert.deepEqual(await page.run('window.taps'), [{ confirmed: 1, of: 2 }, { confirmed: 1, of: 2 }], 'one tap counted twice');
    assert.equal((await page.run('OW.records.post(window.preview)')).reason, 'not_confirmed');
    assert.equal(world.writes().length, 1);
    await page.run('window.twice = false');
    await page.tap('Synthetic confirm');
    const second = await page.run('OW.records.post(window.preview)');
    assert.equal(second.outcome, 'posted', JSON.stringify(second));
    assert.equal(world.writes().length, 2);

    const moved = await page.run(`(async () => {
      window.preview = await OW.records.compose(${JSON.stringify({ ...steer, item: { ...steer.item, key: 'spec:acme/factory#44', subject: { kind: 'issue', number: 44 }, url: 'https://github.com/acme/factory/issues/44' } })});
      return window.preview.op;
    })()`);
    await page.tap('Synthetic confirm');
    assert.deepEqual(await page.run('OW.records.post(window.preview)'), { outcome: 'refused', op: moved, reason: 'github' }, 'a redirected write');
    assert.equal(world.writes().length, 3);
    assert.ok(!world.log.some(r => r.path.includes('/elsewhere/')), 'the redirect was followed');
    assert.deepEqual(world.violations, []);
  } finally {
    await run.close();
  }
});
