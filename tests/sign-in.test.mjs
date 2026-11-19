// P1: the sign-in helper and the GitHub App's manifest, against a fake GitHub (synthetic values only).
// Run: npm run test:functions
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { onRequest } from '../functions/api/sign-in/[step].js';

const SITE = 'https://openwiz.dev';
const ID = 'Iv23fakeclientid0000';
const SECRET = 'fake-client-secret-0123456789abcdef';
const CODE = 'fakecode0123456789ab';
const ACCESS = 'ghu_fakeaccesstoken000000000000000000';
const REFRESH = 'ghr_fakerefreshtoken00000000000000000000000000000000000000000000000000000000000';
const STATE = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'; // 43 base64url characters
const COOKIE = '__Host-openwiz-sign-in-'; // one cookie per attempt, named by its state
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GRANT = {
  access_token: ACCESS, expires_in: 28800, refresh_token: REFRESH,
  refresh_token_expires_in: 15811200, token_type: 'bearer', scope: '',
};

// The fake GitHub: every outgoing request is recorded and answered by `github.answer`. Like fetch, it
// follows a redirect unless the request says redirect: 'manual', re-sending the same body to the new place.
let github, logs, envKeys, realFetch;
const realConsole = {};
beforeEach(() => {
  github = { calls: [], answer: () => Response.json(GRANT) };
  realFetch = globalThis.fetch;
  globalThis.fetch = async function fake(url, init = {}) {
    github.calls.push({ url: String(url), method: init.method, headers: new Headers(init.headers), body: init.body });
    const response = github.calls.length === 1 ? github.answer() : Response.json(GRANT);
    const to = response.headers.get('Location');
    if (to && response.status >= 300 && response.status < 400 && (init.redirect ?? 'follow') === 'follow') return fake(to, init);
    return response;
  };
  logs = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    realConsole[level] = console[level];
    console[level] = (...args) => logs.push(args.map(String).join(' '));
  }
  envKeys = new Set();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(console, realConsole);
  // Nothing logged: no token, code or secret can reach a log line if no line is written at all.
  assert.deepEqual(logs, []);
  // Nothing stored: the helper reads only its two settings, never a storage binding.
  for (const key of envKeys) assert.ok(key === 'GITHUB_CLIENT_ID' || key === 'GITHUB_CLIENT_SECRET', `read env.${key}`);
});

const env = (values = { GITHUB_CLIENT_ID: ID, GITHUB_CLIENT_SECRET: SECRET }) => new Proxy(values, {
  get(target, key) { envKeys.add(String(key)); return target[key]; },
});

function call(step, { method = 'POST', origin = SITE, host = SITE, cookie = `${COOKIE}${STATE}=1`, body, type = 'application/json', settings } = {}) {
  const headers = new Headers();
  if (origin) headers.set('Origin', origin);
  if (cookie) headers.set('Cookie', cookie);
  if (type) headers.set('Content-Type', type);
  const init = { method, headers };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const request = new Request(`${host}/api/sign-in/${step}`, init);
  return onRequest({ request, env: env(settings), params: { step } });
}

const noStore = response => assert.equal(response.headers.get('Cache-Control'), 'no-store');

test('start: a fresh state value goes to GitHub and into a host-only, single-site cookie', async () => {
  const first = await call('start', { method: 'GET', origin: null, cookie: null, type: null });
  const second = await call('start', { method: 'GET', origin: null, cookie: null, type: null });
  assert.equal(first.status, 302);
  noStore(first);
  const to = new URL(first.headers.get('Location'));
  assert.equal(`${to.origin}${to.pathname}`, 'https://github.com/login/oauth/authorize');
  assert.deepEqual([...to.searchParams.keys()].sort(), ['client_id', 'redirect_uri', 'state']);
  assert.equal(to.searchParams.get('client_id'), ID);
  assert.equal(to.searchParams.get('redirect_uri'), 'https://openwiz.dev/app');
  const state = to.searchParams.get('state');
  assert.match(state, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(first.headers.getSetCookie(), [`${COOKIE}${state}=1; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax`]);
  assert.notEqual(new URL(second.headers.get('Location')).searchParams.get('state'), state);
  assert.equal(github.calls.length, 0);
});

test('token: the code is exchanged once and only the token fields reach the browser', async () => {
  const response = await call('token', { body: { code: CODE, state: STATE } });
  assert.equal(response.status, 200);
  noStore(response);
  assert.deepEqual(await response.json(), {
    access_token: ACCESS, expires_in: 28800, refresh_token: REFRESH, refresh_token_expires_in: 15811200, token_type: 'bearer',
  });
  assert.deepEqual(response.headers.getSetCookie(), [`${COOKIE}${STATE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`]);
  assert.equal(github.calls.length, 1);
  const [sent] = github.calls;
  assert.equal(sent.url, GITHUB_TOKEN_URL);
  assert.equal(sent.method, 'POST');
  assert.equal(sent.headers.get('Accept'), 'application/json');
  assert.deepEqual(JSON.parse(sent.body), { client_id: ID, client_secret: SECRET, code: CODE, redirect_uri: 'https://openwiz.dev/app' });
});

test('refresh: the refresh token is exchanged once for a new pair', async () => {
  const response = await call('refresh', { cookie: null, body: { refresh_token: REFRESH } });
  assert.equal(response.status, 200);
  noStore(response);
  assert.equal((await response.json()).access_token, ACCESS);
  assert.equal(github.calls.length, 1);
  assert.equal(github.calls[0].url, GITHUB_TOKEN_URL);
  assert.deepEqual(JSON.parse(github.calls[0].body), { client_id: ID, client_secret: SECRET, grant_type: 'refresh_token', refresh_token: REFRESH });
});

// Every refusal answers before GitHub is called, and never echoes what it was sent.
const REFUSALS = [
  ['token: wrong state value', 'token', { body: { code: CODE, state: 'B'.repeat(43) } }, 403, 'bad_state'],
  ['token: no state cookie', 'token', { cookie: null, body: { code: CODE, state: STATE } }, 403, 'bad_state'],
  ['token: two cookies for one attempt', 'token', { cookie: `${COOKIE}${STATE}=1; ${COOKIE}${STATE}=1`, body: { code: CODE, state: STATE } }, 403, 'bad_state'],
  ['token: a cookie for another attempt only', 'token', { cookie: `${COOKIE}${'B'.repeat(43)}=1`, body: { code: CODE, state: STATE } }, 403, 'bad_state'],
  ['token: an install-time callback (code, no state)', 'token', { cookie: null, body: { code: CODE } }, 400, 'bad_request'],
  ['token: missing code', 'token', { body: { state: STATE } }, 400, 'bad_request'],
  ['token: empty code', 'token', { body: { code: '', state: STATE } }, 400, 'bad_request'],
  ['token: code not a string', 'token', { body: { code: 7, state: STATE } }, 400, 'bad_request'],
  ['token: an extra field', 'token', { body: { code: CODE, state: STATE, redirect_uri: 'https://evil.example/' } }, 400, 'bad_request'],
  ['token: a body that is not an object', 'token', { body: [CODE, STATE] }, 400, 'bad_request'],
  ['token: not JSON', 'token', { body: 'code=x', type: 'application/x-www-form-urlencoded' }, 415, 'bad_request'],
  ['token: broken JSON', 'token', { body: '{"code":' }, 400, 'bad_request'],
  ['token: another origin', 'token', { origin: 'https://evil.example', body: { code: CODE, state: STATE } }, 403, 'bad_origin'],
  ['token: no Origin header', 'token', { origin: null, body: { code: CODE, state: STATE } }, 403, 'bad_origin'],
  ['token: a lookalike origin', 'token', { origin: 'https://openwiz.dev.evil.example', body: { code: CODE, state: STATE } }, 403, 'bad_origin'],
  ['token: another host (a preview)', 'token', { host: 'https://preview.wizsite.pages.dev', origin: 'https://preview.wizsite.pages.dev', body: { code: CODE, state: STATE } }, 403, 'bad_origin'],
  ['token: plain http', 'token', { host: 'http://openwiz.dev', origin: 'http://openwiz.dev', body: { code: CODE, state: STATE } }, 403, 'bad_origin'],
  ['token: a GET', 'token', { method: 'GET', type: null }, 405, 'bad_method'],
  ['refresh: another origin', 'refresh', { origin: 'https://evil.example', body: { refresh_token: REFRESH } }, 403, 'bad_origin'],
  ['refresh: missing refresh token', 'refresh', { body: {} }, 400, 'bad_request'],
  ['refresh: a code instead', 'refresh', { body: { refresh_token: REFRESH, code: CODE } }, 400, 'bad_request'],
  ['start: another host (a preview)', 'start', { method: 'GET', host: 'https://preview.wizsite.pages.dev', origin: null, type: null }, 403, 'bad_origin'],
  ['start: a POST', 'start', { body: {} }, 405, 'bad_method'],
  ['an unknown step', 'login', { body: {} }, 404, 'not_found'],
  ['token: not configured yet', 'token', { body: { code: CODE, state: STATE }, settings: {} }, 503, 'not_configured'],
  ['start: not configured yet', 'start', { method: 'GET', origin: null, type: null, settings: {} }, 503, 'not_configured'],
];
for (const [name, step, options, status, error] of REFUSALS) {
  test(`refused: ${name}`, async () => {
    const response = await call(step, options);
    assert.equal(response.status, status);
    noStore(response);
    const text = await response.text();
    assert.deepEqual(JSON.parse(text), { error });
    for (const secret of [CODE, REFRESH, SECRET, STATE]) assert.ok(!text.includes(secret));
    assert.equal(response.headers.get('Location'), null);
    // A refused callback leaves every sign-in attempt's cookie alone.
    assert.deepEqual(response.headers.getSetCookie(), []);
    assert.equal(github.calls.length, 0);
  });
}

// GitHub's own refusals and failures: nothing of what GitHub said or was sent leaks back.
const GITHUB_FAILURES = [
  ['GitHub refuses the code', () => Response.json({ error: 'bad_verification_code', error_description: `The code ${CODE} is wrong` })],
  ['GitHub answers 500', () => new Response('oops', { status: 500 })],
  ['GitHub answers without a token', () => Response.json({ token_type: 'bearer' })],
  ['GitHub answers with a non-string token', () => Response.json({ ...GRANT, access_token: 7 })],
  ['GitHub redirects the exchange elsewhere', () => new Response(null, { status: 307, headers: { Location: 'https://evil.example/collect' } })],
  ['GitHub cannot be reached', () => { throw new TypeError('fetch failed'); }],
];
for (const [name, answer] of GITHUB_FAILURES) {
  test(`refused: ${name}`, async () => {
    github.answer = answer;
    const response = await call('token', { body: { code: CODE, state: STATE } });
    assert.equal(response.status, 502);
    noStore(response);
    const text = await response.text();
    assert.deepEqual(JSON.parse(text), { error: 'github_refused' });
    // The code and the client secret went to GitHub's token URL and nowhere else.
    assert.deepEqual(github.calls.map(sent => sent.url), [GITHUB_TOKEN_URL]);
  });
}

test('refused: GitHub redirects the refresh elsewhere, and the refresh token goes nowhere else', async () => {
  github.answer = () => new Response(null, { status: 308, headers: { Location: 'https://evil.example/collect' } });
  const response = await call('refresh', { cookie: null, body: { refresh_token: REFRESH } });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'github_refused' });
  assert.deepEqual(github.calls.map(sent => sent.url), [GITHUB_TOKEN_URL]);
});

// A browser cookie jar, in creation order, as the helper's Set-Cookie lines leave it.
function keep(jar, response) {
  for (const line of response.headers.getSetCookie()) {
    const [pair, ...rules] = line.split('; ');
    const [name, value] = pair.split('=');
    jar.delete(name);
    if (!rules.includes('Max-Age=0')) jar.set(name, value);
  }
}
const sent = jar => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
async function startIn(jar) {
  const response = await call('start', { method: 'GET', origin: null, cookie: sent(jar) || null, type: null });
  keep(jar, response);
  return new URL(response.headers.get('Location')).searchParams.get('state');
}
async function returnIn(jar, state) {
  const response = await call('token', { cookie: sent(jar) || null, body: { code: CODE, state } });
  keep(jar, response);
  return response.status;
}

test('two tabs: overlapping attempts both sign in, whichever returns from GitHub first', async () => {
  for (const order of [[0, 1], [1, 0]]) {
    const jar = new Map();
    const states = [await startIn(jar), await startIn(jar)];
    assert.equal(await returnIn(jar, states[order[0]]), 200);
    assert.equal(await returnIn(jar, states[order[1]]), 200);
    assert.equal(jar.size, 0);
  }
  assert.equal(github.calls.length, 4);
});

test('a stale or replayed callback leaves the current attempt intact', async () => {
  const jar = new Map();
  const first = await startIn(jar);
  assert.equal(await returnIn(jar, first), 200);
  const current = await startIn(jar);
  assert.equal(await returnIn(jar, first), 403);
  assert.equal(await returnIn(jar, current), 200);
  assert.equal(github.calls.length, 2);
});

test('at most four attempts are kept: a fifth start drops the oldest', async () => {
  const jar = new Map();
  const states = [];
  for (let i = 0; i < 5; i++) states.push(await startIn(jar));
  assert.deepEqual([...jar.keys()], states.slice(1).map(state => `${COOKIE}${state}`));
  assert.equal(await returnIn(jar, states[0]), 403);
  assert.equal(await returnIn(jar, states[4]), 200);
});

test('the manifest asks for read-only metadata, issues and pull requests and nothing else', async () => {
  const manifest = JSON.parse(await readFile(new URL('../docs/github-app-manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.default_permissions, { metadata: 'read', issues: 'read', pull_requests: 'read' });
  assert.deepEqual(manifest.default_events, []);
  assert.deepEqual(manifest.callback_urls, ['https://openwiz.dev/app']);
  assert.deepEqual(manifest.hook_attributes, { url: 'https://openwiz.dev/', active: false });
  // Only the manifest keys this app uses: nothing that could add access or a webhook elsewhere.
  assert.deepEqual(Object.keys(manifest).sort(),
    ['callback_urls', 'default_events', 'default_permissions', 'description', 'hook_attributes', 'name', 'public', 'request_oauth_on_install', 'setup_url', 'url']);
  // No sign-in during installation (it would return without the helper's state): installers land on the app,
  // which starts the state-bearing sign-in itself.
  assert.equal(manifest.request_oauth_on_install, false);
  assert.equal(manifest.setup_url, 'https://openwiz.dev/app');
  assert.equal(manifest.url, 'https://openwiz.dev/');
  assert.equal(manifest.public, true);
});
