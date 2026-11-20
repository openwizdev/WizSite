// FA3 (#1901): the Ask-a-Wiz function (functions/api/ask.js) against contract openwiz.ask-a-wiz.v1.
// Every contract fixture is replayed against the function with a fake OpenRouter, a fake D1 store (a real
// in-memory SQLite, so the function's own SQL runs) and a fake site serving the index. Synthetic values only:
// no real key, no real OpenRouter, no real store.
// Run: npm run test:functions
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { handle, onRequest, rankPassages } from '../functions/api/ask.js';

const FIXTURES = new URL('./ask-fixtures/', import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(name, FIXTURES), 'utf8'));
const KEY = 'fake-openrouter-key';
const SITE = 'https://openwiz.dev';
const UPSTREAM = 'https://openrouter.ai/api/v1/chat/completions';
const PIN = JSON.parse((await readFile(new URL('ask-a-wiz.v1.md', FIXTURES), 'utf8')).match(/## The pin[\s\S]*?```json\n([\s\S]*?)\n```/)[1]);
const INDEX = await read('index.json');
const CASES = (await readdir(FIXTURES)).filter(f => f.endsWith('.json') && !['index.json', 'store.json'].includes(f)).map(f => f.slice(0, -5)).sort();
const BASE = await read('answer.json'); // a valid on-switch request, settings and store to vary from

// ---- The fakes -------------------------------------------------------------------------------------------------

// The fake D1: the binding's API (prepare, bind, first, all, run, batch) over an in-memory SQLite. `fails` makes
// every operation fail; `hang` makes every operation never finish; `rival` is a salt another first request
// stores just before this request's salt insert.
function fakeD1(store, { fails = false, hang = false, rival = null, failWhen = null, empty = false } = {}) {
  const db = new DatabaseSync(':memory:');
  if (empty) store = { salts: [], counters: [] }; // a database with no tables at all, as a new D1 binding starts
  else {
    db.exec('CREATE TABLE ask_counters (day TEXT, key TEXT, count INTEGER, PRIMARY KEY (day, key))');
    db.exec('CREATE TABLE ask_salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL)');
  }
  for (const s of store.salts) db.prepare('INSERT INTO ask_salts VALUES (?, ?)').run(s.day, s.salt);
  for (const c of store.counters) db.prepare('INSERT INTO ask_counters VALUES (?, ?, ?)').run(c.day, c.key, c.count);
  const log = [];
  const exec = (sql, values) => {
    log.push(sql);
    if (failWhen?.(sql)) throw new Error('synthetic D1 failure');
    if (rival && /^\s*INSERT INTO ask_salts/i.test(sql)) {
      db.prepare('INSERT INTO ask_salts (day, salt) VALUES (?, ?) ON CONFLICT (day) DO NOTHING').run(values[0], rival);
      rival = null;
    }
    const statement = db.prepare(sql);
    return statement.columns().length ? statement.all(...values).map(row => ({ ...row })) : (statement.run(...values), []);
  };
  const gate = async () => {
    if (hang) return new Promise(() => {});
    if (fails) throw new Error('synthetic D1 failure');
  };
  const statement = (sql, values = []) => ({
    sql, values,
    bind: (...more) => statement(sql, more),
    all: async () => { await gate(); return { success: true, results: exec(sql, values), meta: {} }; },
    first: async column => { await gate(); const row = exec(sql, values)[0] ?? null; return column && row ? row[column] : row; },
    run: async () => { await gate(); return { success: true, results: exec(sql, values), meta: {} }; },
  });
  const binding = (wait = null) => ({
    prepare: sql => statement(sql),
    batch: async statements => {
      if (wait) { const until = wait; wait = null; await until; }
      await gate();
      db.exec('BEGIN');
      try {
        const out = statements.map(s => ({ success: true, results: exec(s.sql, s.values), meta: {} }));
        db.exec('COMMIT');
        return out;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  });
  return {
    log,
    // The same database through a binding whose first batch runs only once `until` settles: a delayed write.
    delayed: until => binding(until),
    binding: {
      prepare: sql => statement(sql),
      batch: async statements => {
        await gate();
        db.exec('BEGIN');
        try {
          const out = statements.map(s => ({ success: true, results: exec(s.sql, s.values), meta: {} }));
          db.exec('COMMIT');
          return out;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
      exec: async sql => { await gate(); db.exec(sql); return { count: 1 }; },
    },
    dump() {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(r => r.name);
      return {
        tables,
        salts: db.prepare('SELECT day, salt FROM ask_salts').all().map(r => ({ ...r })),
        counters: db.prepare('SELECT day, key, count FROM ask_counters').all().map(r => ({ ...r })),
      };
    },
  };
}

const canon = store => ({
  salts: [...store.salts].map(s => ({ day: s.day, salt: s.salt })).sort((a, b) => a.day.localeCompare(b.day)),
  counters: [...store.counters].map(c => ({ day: c.day, key: c.key, count: c.count }))
    .sort((a, b) => `${a.day} ${a.key}`.localeCompare(`${b.day} ${b.key}`)),
});

// The fake OpenRouter's server-sent events: a comment line, then one event per content piece, then the usage
// event (with `cost` only when the case reports one), then [DONE]. Every event is sent in two halves, so the
// function must join lines across reads.
function sse(upstream, { extra = [] } = {}) {
  const enc = new TextEncoder();
  const ERROR = Symbol('error');
  const data = value => `data: ${JSON.stringify(value)}\n\n`;
  const pieces = upstream.chunks.map(content => data({ id: 'gen-synthetic', choices: [{ index: 0, delta: { content } }] }));
  const usage = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 };
  if ('cost' in upstream) usage.cost = upstream.cost;
  const events = upstream.fails
    ? [': OPENROUTER PROCESSING\n\n', ...pieces.slice(0, upstream.after_chunks ?? 0), ERROR]
    : [': OPENROUTER PROCESSING\n\n', ...pieces, ...extra,
      data({ id: 'gen-synthetic', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage }), 'data: [DONE]\n\n'];
  let at = 0;
  const state = { cancelled: false };
  const body = new ReadableStream({
    pull(controller) {
      if (at >= events.length) { controller.close(); return; }
      const next = events[at++];
      if (next === ERROR) { controller.error(new Error(`synthetic upstream reset ${KEY}`)); return; }
      const half = Math.ceil(next.length / 2);
      controller.enqueue(enc.encode(next.slice(0, half)));
      controller.enqueue(enc.encode(next.slice(half)));
    },
    cancel() { state.cancelled = true; },
  });
  return { body, state };
}

let calls, logs, answer, realFetch;
const realConsole = {};
beforeEach(() => {
  calls = [];
  answer = null;
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url instanceof Request ? url.url : url), method: init.method, headers: new Headers(init.headers), body: init.body, signal: init.signal };
    calls.push(call);
    if (!answer) throw new Error('unexpected upstream call');
    const response = await answer(call);
    // Like fetch: a redirect is followed, re-sending the same request, unless the request says redirect: 'manual'
    // (or 'error', which fails).
    const to = response.headers.get('Location');
    if (to && response.status >= 300 && response.status < 400) {
      if (init.redirect === 'error') throw new TypeError('redirect refused');
      if ((init.redirect ?? 'follow') === 'follow') return globalThis.fetch(new URL(to, call.url).toString(), init);
    }
    return response;
  };
  logs = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    realConsole[level] = console[level];
    console[level] = (...args) => logs.push(args.map(String).join(' '));
  }
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(console, realConsole);
  // The function writes no log line at all, so no key, question or address can reach one.
  assert.deepEqual(logs, []);
});

// The fake site: env.ASSETS serves the index at /ask-index.json, as Pages serves the built site's files.
const assets = (index = INDEX) => ({
  fetch: async input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname !== '/ask-index.json' || index === null) return new Response('Not found', { status: 404 });
    return new Response(typeof index === 'string' ? index : JSON.stringify(index), { headers: { 'Content-Type': 'application/json' } });
  },
});

// Runs one request through the function: returns the response, its body text, the store after every waitUntil
// promise settled, the upstream calls and the env names the function read.
async function run(c, { store = fakeD1(c.store, { fails: !!c.store_fails, rival: c.rival_salt ?? null }), index = INDEX, rank, deps = {}, request } = {}) {
  const read = new Set();
  const values = { ...c.settings, ASSETS: assets(index) };
  if (values.ASK_A_WIZ_COUNTERS === 'bound') values.ASK_A_WIZ_COUNTERS = store.binding;
  const env = new Proxy(values, { get(target, key) { read.add(String(key)); return target[key]; } });
  const req = request ?? new Request(`${SITE}/api/ask`, { method: c.request.method, headers: c.request.headers, body: c.request.body ?? undefined });
  const times = [c.now, c.dispatch_at ?? c.now].map(t => new Date(t));
  let clockReads = 0;
  const pending = [];
  const context = { request: req, env, params: {}, waitUntil: p => pending.push(p) };
  const response = await handle(context, {
    clock: () => times[Math.min(clockReads++, times.length - 1)],
    salt: () => c.new_salt ?? 'f'.repeat(64),
    ...(rank ? { rank } : c.retrieved ? { rank: () => c.retrieved } : {}),
    ...deps,
  });
  const body = response.body ? await response.text() : null;
  await Promise.all(pending);
  return { response, body, store: store.dump(), storeLog: store.log, read };
}

const headersOf = response => Object.fromEntries([...response.headers].map(([k, v]) => [k.toLowerCase(), v]));
const lower = headers => Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
const events = body => body.split('\n').slice(0, -1).map(line => JSON.parse(line));
const RAW = /[<>&\u2028\u2029]/;
const upstreamAnswer = (upstream, opts) => () => {
  if (upstream.status === 404) return Response.json({ error: { code: 404, message: 'No endpoints found matching your data policy' } }, { status: 404 });
  const { body } = sse(upstream, opts);
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
};
const withCase = (overrides = {}) => ({ ...structuredClone(BASE), ...overrides });
const settingsWith = changes => ({ ...BASE.settings, ...changes });
const ask = (question, extra = {}) => ({ method: 'POST', headers: { ...BASE.request.headers, ...extra.headers }, body: extra.body ?? JSON.stringify({ question }) });

// ---- P2: every contract fixture, replayed --------------------------------------------------------------------

test('the fixtures copied here are the contract\'s full list', () => {
  assert.deepEqual(CASES, [...PIN.fixtures].sort());
});

for (const name of CASES) {
  test(`contract fixture ${name}: the exact response, upstream request and store`, async () => {
    const c = await read(`${name}.json`);
    if (c.upstream) answer = upstreamAnswer(c.upstream);
    const out = await run(c);
    assert.equal(out.response.status, c.response.status, 'status');
    assert.deepEqual(headersOf(out.response), lower(c.response.headers), 'headers');
    assert.equal(out.body, c.response.body, 'body');
    if (c.upstream) {
      assert.equal(calls.length, 1, 'one upstream attempt, never a retry');
      assert.equal(calls[0].url, UPSTREAM);
      assert.equal(calls[0].method, 'POST');
      assert.equal(calls[0].headers.get('Authorization'), `Bearer ${KEY}`);
      assert.equal(calls[0].headers.get('Content-Type'), 'application/json');
      assert.deepEqual(JSON.parse(calls[0].body), c.upstream.request, 'the exact upstream body');
    } else {
      assert.equal(calls.length, 0, 'no upstream call');
    }
    assert.deepEqual(canon(out.store), canon(c.store_after), 'the store after');
    const text = JSON.stringify(headersOf(out.response)) + (out.body ?? '');
    assert.ok(!text.includes(KEY), 'the key never reaches a response');
    assert.ok(!RAW.test(out.body ?? ''), 'no raw < > & U+2028 U+2029 in any body');
    for (const key of out.read) assert.ok(key === 'ASSETS' || Object.values(PIN.names).includes(key), `read env.${key}`);
  });
}

// ---- The key, the log and the escaping ------------------------------------------------------------------------

test('the key never appears in a response, even when OpenRouter echoes it in an error or the stream', async () => {
  const c = withCase();
  const bodies = [];
  for (const reply of [
    () => Response.json({ error: { message: `bad key ${KEY}` } }, { status: 401 }),
    () => Response.json({ error: { message: `bad key ${KEY}` } }, { status: 404 }),
    () => { throw new Error(`fetch failed for ${KEY}`); },
    () => new Response(sse({ chunks: ['Synthetic text long enough to send. '] }, { extra: [`data: ${JSON.stringify({ error: { message: KEY } })}\n\n`] }).body),
    () => new Response(sse({ chunks: [], fails: true, after_chunks: 0 }).body),
  ]) {
    answer = reply;
    calls.length = 0;
    const store = fakeD1(c.store);
    const out = await run(c, { store });
    bodies.push(out);
    assert.equal(calls.length, 1, 'one attempt, never a retry, whatever went wrong');
    assert.ok(!JSON.stringify(headersOf(out.response)).includes(KEY), 'headers');
    assert.ok(!out.body.includes(KEY), `body: ${out.body}`);
  }
  assert.deepEqual(bodies.map(b => b.response.status), [502, 503, 502, 200, 502]);
  assert.match(bodies[3].body, /"reason":"upstream_error"/);
});

test('an answer holding < > & U+2028 U+2029 reaches the visitor escaped, and joins back to the same text', async () => {
  const pieces = ['Synthetic <script>alert(1)</script> & more ', 'line\u2028sep\u2029para "quoted" é 😀'];
  answer = upstreamAnswer({ chunks: pieces, cost: 0.0001 });
  const out = await run(withCase());
  assert.ok(!RAW.test(out.body), out.body);
  assert.match(out.body, /\\u003cscript\\u003e/);
  assert.match(out.body, /\\u2028/);
  assert.equal(events(out.body).filter(e => e.type === 'text').map(e => e.text).join(''), pieces.join(''));
});

// ---- The switch, the probe and the configuration --------------------------------------------------------------

test('the switch is on only for exactly "on": anything else answers 404 with no body and reads nothing else', async () => {
  for (const value of [undefined, '', 'On', 'ON', ' on', 'on ', 'true', '1', 'yes']) {
    for (const request of [{ method: 'GET', headers: {}, body: null }, BASE.request, { method: 'PUT', headers: {}, body: 'x' }]) {
      const c = withCase({ settings: settingsWith({ ASK_A_WIZ: value }), request });
      if (value === undefined) delete c.settings.ASK_A_WIZ;
      const out = await run(c);
      assert.equal(out.response.status, 404, `ASK_A_WIZ=${JSON.stringify(value)}`);
      assert.equal(out.body, null);
      assert.deepEqual([...out.read], ['ASK_A_WIZ'], 'off reads only the switch');
      assert.deepEqual(out.storeLog, []);
    }
  }
  assert.equal(calls.length, 0);
});

test('the probe reads only the switch: no secret, store or index, even when they are missing', async () => {
  const c = withCase({ request: { method: 'GET', headers: {}, body: null }, settings: { ASK_A_WIZ: 'on' } });
  const out = await run(c, { index: null });
  assert.equal(out.response.status, 200);
  assert.equal(out.body, '{"schema":"openwiz.ask-a-wiz.v1","enabled":true,"max_question_chars":300}');
  assert.deepEqual([...out.read], ['ASK_A_WIZ']);
});

test('a missing or invalid secret, model, store or maximum price is unavailable before the request is read', async () => {
  const bad = [
    { OPENROUTER_API_KEY: undefined }, { OPENROUTER_API_KEY: '' }, { ASK_A_WIZ_MODEL: undefined }, { ASK_A_WIZ_MODEL: '' },
    { ASK_A_WIZ_COUNTERS: undefined }, { ASK_A_WIZ_COUNTERS: 'not a binding' },
    ...['ASK_A_WIZ_MAX_PROMPT_PRICE', 'ASK_A_WIZ_MAX_COMPLETION_PRICE', 'ASK_A_WIZ_MAX_REQUEST_PRICE'].flatMap(name =>
      [undefined, '', '0', '0.0', '-1', '1000.000001', '1001', '1e-3', '.5', '0.1234567', '12345', ' 0.1', 'abc'].map(v => ({ [name]: v }))),
  ];
  for (const change of bad) {
    const c = withCase({ settings: settingsWith(change), request: { ...BASE.request, body: 'not even JSON' } });
    for (const [k, v] of Object.entries(change)) if (v === undefined) delete c.settings[k];
    const store = fakeD1(c.store);
    const out = await run(c, { store });
    assert.equal(out.response.status, 503, JSON.stringify(change));
    assert.equal(out.body, '{"type":"refused","reason":"unavailable","message":"Ask a Wiz isn\'t available right now."}\n');
    assert.deepEqual(store.log, [], 'no store operation');
  }
  for (const good of ['1000', '0.000001', '1', '0.10', '999.5']) {
    answer = upstreamAnswer({ chunks: ['Synthetic answer, priced at the edge.'], cost: 0 });
    const out = await run(withCase({ settings: settingsWith({ ASK_A_WIZ_MAX_REQUEST_PRICE: good }) }));
    assert.equal(out.response.status, 200, `price ${good} is valid`);
  }
  assert.equal(calls.length, 5);
});

test('a missing or invalid index is unavailable after the visitor is counted, with no model call', async () => {
  const bads = [null, 'not json', { ...INDEX, schema: 'other' }, { ...INDEX, extra: 1 }, { ...INDEX, sources: [{ title: 'x', url: 'https://example.invalid/' }] },
    { ...INDEX, passages: [{ source: 9, text: 'x' }] }, { ...INDEX, passages: [{ source: 0, text: 'x'.repeat(1201) }] }, 'x'.repeat(2_000_001)];
  for (const index of bads) {
    const c = withCase();
    delete c.retrieved;
    const out = await run(c, { index });
    assert.equal(out.response.status, 503, JSON.stringify(index).slice(0, 80));
    assert.match(out.body, /"reason":"unavailable"/);
    const visitor = out.store.counters.find(r => r.key.startsWith('visitor:'));
    assert.equal(visitor.count, 3, 'the question still counts');
  }
  assert.equal(calls.length, 0);
});

// ---- The request ---------------------------------------------------------------------------------------------

test('every malformed request is bad_request, counts nothing and calls nothing', async () => {
  const ok = BASE.request;
  const bad = [
    { ...ok, method: 'PUT' }, { ...ok, method: 'DELETE' },
    { ...ok, headers: { ...ok.headers, 'Content-Type': 'text/plain' } },
    { ...ok, headers: { ...ok.headers, 'Content-Type': 'application/x-www-form-urlencoded' } },
    { ...ok, headers: { ...ok.headers, Origin: 'https://example.invalid' } },
    { ...ok, headers: { ...ok.headers, Origin: 'http://openwiz.dev' } },
    { ...ok, headers: { ...ok.headers, Origin: 'null' } },
    { ...ok, headers: (({ Origin, ...rest }) => rest)(ok.headers) },
    { ...ok, body: '' }, { ...ok, body: 'not json' }, { ...ok, body: '[]' }, { ...ok, body: '"question"' }, { ...ok, body: 'null' },
    { ...ok, body: '{}' }, { ...ok, body: '{"question": 1}' }, { ...ok, body: '{"question": null}' },
    { ...ok, body: '{"question": "a", "extra": 1}' }, { ...ok, body: '{"Question": "a"}' },
    { ...ok, body: '{"question": "a", "question": "b"}' }, { ...ok, body: '{"question": "a", "\\u0071uestion": "b"}' },
    { ...ok, body: '{"question": ["a"]}' }, { ...ok, body: '{"question": "a"} {}' },
    { ...ok, body: '{"question": "   \\n\\t  "}' }, { ...ok, body: '{"question": ""}' },
    { ...ok, body: JSON.stringify({ question: 'a'.repeat(200) }).padEnd(4097, ' ') },
  ];
  for (const request of bad) {
    const c = withCase({ request });
    const store = fakeD1(c.store);
    const out = await run(c, { store });
    assert.equal(out.response.status, 400, JSON.stringify(request).slice(0, 160));
    assert.equal(out.body, '{"type":"refused","reason":"bad_request","message":"That question couldn\'t be read. Try again."}\n');
    assert.deepEqual(canon(out.store), canon(c.store), 'nothing counted');
  }
  assert.equal(calls.length, 0);
});

test('the question is trimmed and counted in code points: 300 pass, 301 are too_long', async () => {
  const astral = '😀'; // two UTF-16 units, one code point
  for (const [question, status] of [
    [astral.repeat(300), 200], [`  ${'é'.repeat(300)}\n`, 200], [astral.repeat(301), 413], ['a'.repeat(301), 413],
  ]) {
    answer = upstreamAnswer({ chunks: ['Synthetic answer to a long question.'], cost: 0.0001 });
    const out = await run(withCase({ request: ask(question) }));
    assert.equal(out.response.status, status, `${[...question.trim()].length} code points`);
  }
});

test('a body of exactly 4096 bytes is read, and Content-Type parameters are allowed', async () => {
  answer = upstreamAnswer({ chunks: ['Synthetic answer to a padded body.'], cost: 0.0001 });
  const body = JSON.stringify({ question: 'Synthetic padded question?' }).padEnd(4096, ' ');
  const out = await run(withCase({ request: ask('', { body, headers: { 'Content-Type': 'application/json; charset=utf-8' } }) }));
  assert.equal(out.response.status, 200);
  // Escapes in the name or the value, and JSON white space anywhere between tokens, are still one valid member.
  answer = upstreamAnswer({ chunks: ['Synthetic answer to an escaped question.'], cost: 0.0001 });
  const escaped = run(withCase({ request: ask('', { body: '\r\n\t{ "\\u0071uestion" :\n"Say \\"hi\\" \\u00e9 \\ud83d\\ude00 \\\\ \\/?" }\n' }) }));
  assert.equal((await escaped).response.status, 200);
  assert.match(JSON.parse(calls.at(-1).body).messages[1].content, /Question: Say "hi" é 😀 \\ \/\?$/);
});

// ---- Retrieval -----------------------------------------------------------------------------------------------

test('keyword scoring ranks passages sharing the question\'s words, best first, and drops those sharing none', () => {
  const ranked = rankPassages(INDEX, 'How do I set OpenWiz up with one line?');
  assert.deepEqual(ranked.map(p => p.text), [INDEX.passages[2].text, INDEX.passages[0].text]);
  assert.deepEqual(ranked[0].source, INDEX.sources[1]);
  assert.deepEqual(rankPassages(INDEX, 'What is the price of a unicorn?'), [], 'only common words match: no passage');
  assert.deepEqual(rankPassages(INDEX, 'the and of to a'), []);
  assert.deepEqual(rankPassages(INDEX, 'FAQ').map(p => p.text), [INDEX.passages[1].text], 'case does not matter');
  const tie = rankPassages({ ...INDEX, passages: [{ source: 0, text: 'kernel one' }, { source: 1, text: 'kernel two' }] }, 'kernel');
  assert.deepEqual(tie.map(p => p.text), ['kernel one', 'kernel two'], 'a tie keeps index order');
});

test('with the real scoring, a matching question sends its passage and an unmatched one gets not_covered with no call', async () => {
  answer = upstreamAnswer({ chunks: ['Synthetic answer about setup.'], cost: 0.0001 });
  const c = withCase({ request: ask('How do I set OpenWiz up with one line?') });
  delete c.retrieved;
  const out = await run(c);
  assert.equal(out.response.status, 200);
  assert.match(JSON.parse(calls[0].body).messages[1].content, /^Passage 1 from https:\/\/github\.com\/openwizdev\/openwiz#readme:\nSynthetic passage: one line/);
  const none = withCase({ request: ask('What is the price of a unicorn?') });
  delete none.retrieved;
  const out2 = await run(none);
  assert.equal(out2.response.status, 200);
  assert.equal(events(out2.body)[0].type, 'not_covered');
  assert.equal(calls.length, 1);
});

// ---- The model's answer ----------------------------------------------------------------------------------------

test('NOT_COVERED with white space or split oddly is still the not-covered answer, and never reaches the visitor', async () => {
  for (const chunks of [['  \n NOT_COVERED'], ['N', 'O', 'T', '_', 'C', 'O', 'V', 'E', 'R', 'E', 'D'], ['NOT_COVERED. The passages do not say.']]) {
    answer = upstreamAnswer({ chunks, cost: 0.0001 });
    const out = await run(withCase());
    assert.equal(out.response.status, 200);
    assert.deepEqual(events(out.body).map(e => e.type), ['not_covered'], chunks.join('|'));
    assert.ok(!out.body.includes('NOT_COVERED'));
  }
  answer = upstreamAnswer({ chunks: ['NOT_', 'COVERED is a phrase this answer explains.'], cost: 0.0001 });
  // "starts with NOT_COVERED" holds here too: the contract's rule is a prefix test on the trimmed answer.
  assert.deepEqual(events((await run(withCase())).body).map(e => e.type), ['not_covered']);
  answer = upstreamAnswer({ chunks: ['NOT', ' COVERED here: a real answer.'], cost: 0.0001 });
  assert.deepEqual(events((await run(withCase())).body).map(e => e.type), ['text', 'text', 'sources', 'done']);
});

test('a short answer under 16 characters still streams, and an empty answer is upstream_error', async () => {
  answer = upstreamAnswer({ chunks: ['Yes.'], cost: 0.0001 });
  assert.deepEqual(events((await run(withCase())).body), [{ type: 'text', text: 'Yes.' }, { type: 'sources', sources: [INDEX.sources[0], INDEX.sources[1]] }, { type: 'done' }]);
  answer = upstreamAnswer({ chunks: [], cost: 0.0001 });
  const out = await run(withCase());
  assert.equal(out.response.status, 502);
  assert.match(out.body, /"reason":"upstream_error"/);
});

test('any upstream status but 200 and 404 is upstream_error, with one attempt and the reservation kept', async () => {
  for (const status of [400, 401, 402, 429, 500, 503]) {
    calls.length = 0;
    answer = () => Response.json({ error: { message: 'synthetic' } }, { status });
    const out = await run(withCase());
    assert.equal(out.response.status, 502, `upstream ${status}`);
    assert.equal(calls.length, 1, 'no retry');
    assert.equal(out.store.counters.find(r => r.key === 'spend').count, 61000 + 2610);
  }
});

test('an upstream that never answers times out as upstream_error, and the reservation stays', async () => {
  answer = call => new Promise((_, reject) => call.signal.addEventListener('abort', () => reject(call.signal.reason)));
  const out = await run(withCase(), { deps: { upstreamTimeout: 30 } });
  assert.equal(out.response.status, 502);
  assert.match(out.body, /"reason":"upstream_error"/);
  assert.equal(out.store.counters.find(r => r.key === 'spend').count, 63610);
});

test('an upstream that stalls mid-answer times out: text, then upstream_error, reservation kept', async () => {
  answer = () => new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Synthetic first piece, then silence.' } }] })}\n\n`)); },
  }));
  const out = await run(withCase(), { deps: { upstreamTimeout: 30 } });
  assert.equal(out.response.status, 200);
  assert.deepEqual(events(out.body).map(e => e.type), ['text', 'refused']);
  assert.equal(out.store.counters.find(r => r.key === 'spend').count, 63610);
});

test('R1: a successful answer that carries the key, whole or split across pieces, never shows it or any of its pieces', async () => {
  const split = (text, at) => at.reduce((out, n, i) => [...out, text.slice(i ? at[i - 1] : 0, n)], []).concat(text.slice(at.at(-1)));
  const leak = `Synthetic answer that goes on long enough to be sent, then: ${KEY} and more text after it.`;
  const at = leak.indexOf(KEY);
  for (const chunks of [
    [leak],
    split(leak, [at + 4]),
    split(leak, [at + 4, at + 9, at + 15]),
    split(leak, [at, at + KEY.length]),
    ['Synthetic first piece long enough to send. ', ...split(`then ${KEY} at the end`, [8, 12, 20])],
  ]) {
    answer = upstreamAnswer({ chunks, cost: 0.0001 });
    const out = await run(withCase());
    assert.ok(!out.body.includes(KEY), `the key in the body: ${chunks.join('|')}`);
    // No sent piece overlaps the key: every text event comes before the key's first character.
    const keyAt = chunks.join('').indexOf(KEY);
    const sent = events(out.body).filter(e => e.type === 'text').map(e => e.text);
    assert.ok(sent.join('').length <= keyAt, `a piece holding part of the key was sent: ${JSON.stringify(sent)}`);
    assert.deepEqual(sent, chunks.slice(0, sent.length), 'the pieces sent are the answer\'s own pieces, in order');
    assert.equal(events(out.body).at(-1).type, 'refused', 'the answer ends as upstream_error');
    assert.equal(events(out.body).at(-1).reason, 'upstream_error');
    assert.ok(!events(out.body).some(e => e.type === 'done'));
    assert.equal(out.store.counters.find(r => r.key === 'spend').count, 63610, 'the reservation stays');
  }
});

test('R1: an upstream failure or stall right after part of the key arrives sends no part of the key, only the refusal', async () => {
  const part = KEY.slice(0, 9);
  for (const [upstream, deps] of [
    [{ chunks: [`Synthetic answer long enough to send: ${part}`], fails: true, after_chunks: 1 }, {}],
    [{ chunks: ['Synthetic answer long enough to send: ', KEY.slice(0, 2), KEY.slice(2, 9)], fails: true, after_chunks: 3 }, {}],
    [{ chunks: [`Synthetic answer long enough to send: ${part}`] }, { upstreamTimeout: 30, stall: true }],
  ]) {
    const { stall, ...options } = deps;
    answer = stall
      ? () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: upstream.chunks[0] } }] })}\n\n`)); } }))
      : upstreamAnswer(upstream);
    const out = await run(withCase(), { deps: options });
    for (let n = 2; n <= KEY.length; n++) assert.ok(!out.body.includes(KEY.slice(0, n)), `part of the key sent: ${JSON.stringify(out.body)}`);
    assert.deepEqual(events(out.body).filter(e => e.type === 'text').map(e => e.text).filter(t => t.includes(KEY.slice(0, 2))), []);
    assert.equal(events(out.body).at(-1).reason, 'upstream_error');
    assert.equal(out.store.counters.find(r => r.key === 'spend').count, 63610, 'the reservation stays');
  }
  // Text that can't begin the key still streams before a failure, as the contract's mid-answer case requires.
  answer = upstreamAnswer({ chunks: ['Synthetic safe first piece of the answer. ', `then ${part}`], fails: true, after_chunks: 2 });
  const out = await run(withCase());
  assert.equal(out.response.status, 200);
  assert.deepEqual(events(out.body), [{ type: 'text', text: 'Synthetic safe first piece of the answer. ' }, { type: 'refused', reason: 'upstream_error', message: "Ask a Wiz couldn't answer just now. Try again." }]);
});

test('R2: a redirect from OpenRouter is not followed: one call, upstream_error, the question sent nowhere else', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    calls.length = 0;
    answer = call => call.url === UPSTREAM
      ? new Response(null, { status, headers: { Location: 'https://example.invalid/collect' } })
      : upstreamAnswer({ chunks: ['Synthetic answer from somewhere else.'], cost: 0.0001 })();
    const out = await run(withCase());
    assert.deepEqual(calls.map(c => c.url), [UPSTREAM], `status ${status}: only OpenRouter is called`);
    assert.equal(out.response.status, 502);
    assert.match(out.body, /"reason":"upstream_error"/);
    assert.equal(out.store.counters.find(r => r.key === 'spend').count, 63610);
  }
});

test('R3: a previous day\'s write delayed past midnight leaves no row of that day behind', async () => {
  // Request A starts at 23:59:59 and its first store batch is delayed; request B, after midnight, runs to the end;
  // then A's batch commits. Both questions match no passage, so neither writes again.
  const store = fakeD1({ salts: [], counters: [] });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const asking = (now, binding, salt) => {
    const c = withCase({ now, request: ask('What is the price of a unicorn?') });
    const env = { ...c.settings, ASSETS: assets(), ASK_A_WIZ_COUNTERS: binding };
    const pending = [];
    return handle({ request: new Request(`${SITE}/api/ask`, { method: 'POST', headers: c.request.headers, body: c.request.body }), env, waitUntil: p => pending.push(p) },
      { clock: () => new Date(now), salt: () => salt, rank: () => [] }).then(async response => { await response.text(); await Promise.all(pending); return response; });
  };
  const a = asking('2026-01-15T23:59:59+00:00', store.delayed(held), 'a'.repeat(64));
  const b = await asking('2026-01-16T00:00:01+00:00', store.binding, 'b'.repeat(64));
  assert.equal(b.status, 200);
  release();
  await a;
  const after = store.dump();
  assert.deepEqual(after.salts.filter(s => s.day < '2026-01-16'), [], 'no previous-day salt');
  assert.deepEqual(after.counters.filter(c => c.day < '2026-01-16'), [], 'no previous-day counter');
  assert.deepEqual(after.salts, [{ day: '2026-01-16', salt: 'b'.repeat(64) }]);
});

test('R3: a call is counted on the newest day the store holds, even when this request\'s clock is behind', async () => {
  // Another request already wrote the next day and used its whole call cap: this one, on the old day, must not
  // slip a call through on a day that is about to be pruned.
  const c = withCase({ now: '2026-01-15T23:59:58+00:00', store: { salts: [], counters: [{ day: '2026-01-16', key: 'cap', count: 200 }] } });
  answer = upstreamAnswer({ chunks: ['Synthetic answer that must not be sent.'], cost: 0.0001 });
  const out = await run(c);
  assert.equal(calls.length, 0, 'no model call');
  assert.equal(out.response.status, 429);
  assert.match(out.body, /"reason":"daily_cap"/);
  assert.equal(out.response.headers.get('Retry-After'), String(86400 + 2), 'until the end of that newest day');
  assert.deepEqual(out.store.counters.filter(r => r.day < '2026-01-16'), []);
});

test('a visitor who stops the stream cancels the upstream call, and the reservation stays', async () => {
  let upstream;
  answer = () => {
    const pieces = Array.from({ length: 20 }, (_, i) => `Synthetic piece ${i}. `);
    upstream = sse({ chunks: pieces, cost: 0.0001 });
    return new Response(upstream.body);
  };
  const c = withCase();
  const store = fakeD1(c.store);
  const pending = [];
  const env = { ...c.settings, ASSETS: assets(), ASK_A_WIZ_COUNTERS: store.binding };
  const response = await handle({ request: new Request(`${SITE}/api/ask`, { method: 'POST', headers: c.request.headers, body: c.request.body }), env, waitUntil: p => pending.push(p) },
    { clock: () => new Date(c.now), rank: () => c.retrieved });
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  await Promise.all(pending);
  assert.equal(upstream.state.cancelled, true);
  assert.equal(store.dump().counters.find(r => r.key === 'spend').count, 63610);
});

test('a stream nobody reads still ends at the timeout: the upstream call is cancelled and its waitUntil settles', async () => {
  let upstream;
  answer = () => {
    upstream = sse({ chunks: Array.from({ length: 20 }, (_, i) => `Synthetic unread piece ${i}. `), cost: 0.0001 });
    return new Response(upstream.body);
  };
  const c = withCase();
  const store = fakeD1(c.store);
  const pending = [];
  const env = { ...c.settings, ASSETS: assets(), ASK_A_WIZ_COUNTERS: store.binding };
  const response = await handle({ request: new Request(`${SITE}/api/ask`, { method: 'POST', headers: c.request.headers, body: c.request.body }), env, waitUntil: p => pending.push(p) },
    { clock: () => new Date(c.now), rank: () => c.retrieved, upstreamTimeout: 30 });
  assert.equal(response.status, 200);
  const outcome = await Promise.race([Promise.all(pending).then(() => 'settled'), new Promise(r => setTimeout(() => r('still pending'), 1000))]);
  assert.equal(outcome, 'settled');
  assert.equal(upstream.state.cancelled, true);
  assert.equal(store.dump().counters.find(r => r.key === 'spend').count, 63610, 'the reservation stays');
});

test('R6: a reader who pauses past the deadline then resumes gets only the refusal: no held text, no buffered piece, no done', async () => {
  // The whole answer, the key's prefix and [DONE] are already buffered when the deadline passes; nothing after the
  // abort may be sent, not even the safe first piece queued before it.
  const enc = new TextEncoder();
  const data = value => `data: ${JSON.stringify(value)}\n\n`;
  const all = [
    data({ choices: [{ delta: { content: 'Synthetic safe first piece long enough to send. ' } }] }),
    data({ choices: [{ delta: { content: KEY.slice(0, -1) } }] }),
    data({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { cost: 0.0001 } }),
    'data: [DONE]\n\n',
  ].join('');
  const upstream = { cancelled: false };
  answer = () => new Response(new ReadableStream({
    start(c) { c.enqueue(enc.encode(all)); },
    cancel() { upstream.cancelled = true; },
  }));
  const c = withCase();
  const store = fakeD1(c.store);
  const pending = [];
  const env = { ...c.settings, ASSETS: assets(), ASK_A_WIZ_COUNTERS: store.binding };
  const response = await handle({ request: new Request(`${SITE}/api/ask`, { method: 'POST', headers: c.request.headers, body: c.request.body }), env, waitUntil: p => pending.push(p) },
    { clock: () => new Date(c.now), rank: () => c.retrieved, upstreamTimeout: 30 });
  assert.equal(response.status, 200);
  await Promise.all(pending); // the deadline passed: the upstream call is cancelled and settled
  assert.equal(upstream.cancelled, true);
  const body = await response.text();
  for (let n = 2; n <= KEY.length; n++) assert.ok(!body.includes(KEY.slice(0, n)), `part of the key sent: ${JSON.stringify(body)}`);
  assert.deepEqual(events(body), [{ type: 'refused', reason: 'upstream_error', message: "Ask a Wiz couldn't answer just now. Try again." }]);
  assert.equal(store.dump().counters.find(r => r.key === 'spend').count, 63610, 'the reservation stays');
});

test('an invalid reported cost keeps the whole reservation; a valid one replaces it', async () => {
  for (const [cost, spend] of [[-0.001, 63610], ['0.0001', 63610], [null, 63610], [0, 61000], [0.0000001, 61001], [0.0026, 63600]]) {
    answer = upstreamAnswer({ chunks: ['Synthetic answer with a cost.'], cost });
    const out = await run(withCase());
    assert.equal(out.store.counters.find(r => r.key === 'spend').count, spend, `cost ${JSON.stringify(cost)}`);
  }
});

// ---- The store -----------------------------------------------------------------------------------------------

test('a store that fails at any step before the call refuses store_error with no call', async () => {
  for (const step of [/CREATE TABLE/i, /DELETE FROM ask_salts/i, /INSERT INTO ask_salts/i, /SELECT salt/i, /INSERT INTO ask_counters/i, /^\s*UPDATE/i]) {
    const c = withCase();
    const failWhen = sql => step.test(sql);
    const store = fakeD1(c.store, { failWhen });
    const out = await run(c, { store });
    assert.equal(out.response.status, 503, String(step));
    assert.match(out.body, /"reason":"store_error"/);
  }
  // The cap and the spend reservations (step 6) fail after the visitor counted.
  for (const nth of [2, 3]) {
    let updates = 0;
    const c = withCase();
    const store = fakeD1(c.store, { failWhen: sql => /^\s*UPDATE/i.test(sql) && ++updates === nth });
    const out = await run(c, { store });
    assert.equal(out.response.status, 503, `update ${nth}`);
    assert.match(out.body, /"reason":"store_error"/);
  }
  assert.equal(calls.length, 0);
});

test('a store that never answers times out as store_error', async () => {
  const c = withCase();
  const out = await run(c, { store: fakeD1(c.store, { hang: true }), deps: { storeTimeout: 20 } });
  assert.equal(out.response.status, 503);
  assert.match(out.body, /"reason":"store_error"/);
  assert.equal(calls.length, 0);
});

test('a failing settle keeps the reservation and leaves the answer unchanged', async () => {
  answer = upstreamAnswer({ chunks: ['Synthetic answer, settled or not.'], cost: 0.0001 });
  const c = withCase();
  let updates = 0;
  const store = fakeD1(c.store, { failWhen: sql => /^\s*UPDATE/i.test(sql) && ++updates === 4 });
  const out = await run(c, { store });
  assert.equal(out.response.status, 200);
  assert.deepEqual(events(out.body).map(e => e.type), ['text', 'sources', 'done']);
  assert.equal(out.store.counters.find(r => r.key === 'spend').count, 63610);
});

test('the store holds only the two tables and the pinned key forms, on a fresh store too', async () => {
  answer = upstreamAnswer({ chunks: ['Synthetic answer on a fresh store.'], cost: 0.0001 });
  const store = { salts: [], counters: [] };
  const c = withCase({ store });
  const d1 = fakeD1(store, { empty: true }); // no tables: the function must create them itself
  const out = await run(c, { store: d1 });
  assert.equal(out.response.status, 200);
  assert.deepEqual(events(out.body).map(e => e.type), ['text', 'sources', 'done']);
  assert.deepEqual(out.store.tables, ['ask_counters', 'ask_salts']);
  assert.deepEqual(out.store.counters.map(r => [r.key.replace(/[0-9a-f]{32}/, '<hash>'), r.count]).sort(),
    [['cap', 1], ['spend', 100], ['visitor:<hash>:14', 1]], 'the question, the call and its settled cost are counted');
  for (const row of out.store.counters) assert.match(row.key, /^(cap|spend|visitor:[0-9a-f]{32}:([01][0-9]|2[0-3]))$/);
  for (const row of out.store.salts) assert.match(row.salt, /^[0-9a-f]{64}$/);
  const all = JSON.stringify(out.store);
  for (const never of ['192.0.2.10', 'Synthetic question', 'Synthetic answer']) assert.ok(!all.includes(never), never);
});

test('the default salt is 32 random bytes as 64 lower-case hex digits, fresh each day', async () => {
  answer = upstreamAnswer({ chunks: ['Synthetic answer, default salt.'], cost: 0.0001 });
  const salts = [];
  for (const day of ['2026-02-01', '2026-02-02']) {
    const c = withCase({ now: `${day}T10:00:00+00:00`, store: { salts: [], counters: [] } });
    const store = fakeD1(c.store);
    const pending = [];
    const env = { ...c.settings, ASSETS: assets(), ASK_A_WIZ_COUNTERS: store.binding };
    const response = await handle({ request: new Request(`${SITE}/api/ask`, { method: 'POST', headers: c.request.headers, body: c.request.body }), env, waitUntil: p => pending.push(p) },
      { clock: () => new Date(c.now), rank: () => c.retrieved });
    await response.text();
    await Promise.all(pending);
    salts.push(store.dump().salts[0].salt);
  }
  for (const salt of salts) assert.match(salt, /^[0-9a-f]{64}$/);
  assert.notEqual(salts[0], salts[1]);
});

test('onRequest is the Pages entry point: the probe answers through it', async () => {
  const response = await onRequest({ request: new Request(`${SITE}/api/ask`), env: { ASK_A_WIZ: 'on' }, waitUntil() {} });
  assert.equal(response.status, 200);
  assert.equal((await onRequest({ request: new Request(`${SITE}/api/ask`), env: {}, waitUntil() {} })).status, 404);
});
