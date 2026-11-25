import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { onRequest } from '../functions/api/sign-in/[step].js';

const SITE = 'https://openwiz.dev';
const ID = 'Iv23fakeclientid0000';
const SECRET = 'fake-client-secret-0123456789abcdef';
const CODE = 'fakecode0123456789ab';
const ACCESS = 'ghu_fakeaccesstoken000000000000000000';
const REFRESH = 'ghr_fakerefreshtoken00000000000000000000000000000000000000000000000000000000000';
const STATE = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const VERIFIER = 'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV';
const sha256b64url = value => createHash('sha256').update(value).digest('base64url');
const CHALLENGE = sha256b64url(VERIFIER);
const COOKIE_PREFIX = '__Host-openwiz-sign-in-';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GRANT = {
  access_token: ACCESS, expires_in: 28800, refresh_token: REFRESH,
  refresh_token_expires_in: 15811200, token_type: 'bearer', scope: '',
};

let github, logs, envKeys, realFetch, nextCode;
const realConsole = {};
function verifyGrant(_url, init) {
  const sent = JSON.parse(init.body || '{}');
  if (sent.grant_type === 'refresh_token') return Response.json(GRANT);
  const expected = github.challenges.get(sent.code);
  if (!expected || typeof sent.code_verifier !== 'string' || !sent.code_verifier || sha256b64url(sent.code_verifier) !== expected) {
    return Response.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
  }
  return Response.json(GRANT);
}
beforeEach(() => {
  nextCode = 0;
  github = { calls: [], challenges: new Map([[CODE, CHALLENGE]]), answer: null };
  realFetch = globalThis.fetch;
  globalThis.fetch = async function fake(url, init = {}) {
    github.calls.push({ url: String(url), method: init.method, headers: new Headers(init.headers), body: init.body });
    const response = github.answer && github.calls.length === 1 ? github.answer(url, init) : verifyGrant(url, init);
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
  assert.deepEqual(logs, []);
  for (const key of envKeys) assert.ok(key === 'GITHUB_CLIENT_ID' || key === 'GITHUB_CLIENT_SECRET', `read env.${key}`);
});

const env = (values = { GITHUB_CLIENT_ID: ID, GITHUB_CLIENT_SECRET: SECRET }) => new Proxy(values, {
  get(target, key) { envKeys.add(String(key)); return target[key]; },
});

function call(step, { method = 'POST', origin = SITE, host = SITE, cookie = `${COOKIE_PREFIX}${STATE}=${VERIFIER}`, body, type = 'application/json', settings } = {}) {
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

test('start: a fresh state and PKCE challenge go to GitHub and the verifier stays in a host-only cookie', async () => {
  const first = await call('start', { method: 'GET', origin: null, cookie: null, type: null });
  const second = await call('start', { method: 'GET', origin: null, cookie: null, type: null });
  assert.equal(first.status, 302);
  noStore(first);
  const to = new URL(first.headers.get('Location'));
  assert.equal(`${to.origin}${to.pathname}`, 'https://github.com/login/oauth/authorize');
  assert.deepEqual([...to.searchParams.keys()].sort(), ['client_id', 'code_challenge', 'code_challenge_method', 'redirect_uri', 'state']);
  assert.equal(to.searchParams.get('client_id'), ID);
  assert.equal(to.searchParams.get('redirect_uri'), 'https://openwiz.dev/app');
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
  const state = to.searchParams.get('state');
  const codeChallenge = to.searchParams.get('code_challenge');
  assert.match(state, /^[A-Za-z0-9_-]{43}$/);
  assert.match(codeChallenge, /^[A-Za-z0-9_-]{43}$/);
  const [setCookie] = first.headers.getSetCookie();
  const match = setCookie.match(new RegExp(`^${COOKIE_PREFIX}${state}=([A-Za-z0-9_-]{43}); Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax$`));
  assert.ok(match, `unexpected Set-Cookie: ${setCookie}`);
  const verifier = match[1];
  assert.notEqual(verifier, state);
  assert.equal(sha256b64url(verifier), codeChallenge);
  const secondTo = new URL(second.headers.get('Location'));
  assert.notEqual(secondTo.searchParams.get('state'), state);
  assert.notEqual(secondTo.searchParams.get('code_challenge'), codeChallenge);
  assert.equal(github.calls.length, 0);
});

test('token: the code is exchanged once with the cookie verifier and only the token fields reach the browser', async () => {
  const response = await call('token', { body: { code: CODE, state: STATE } });
  assert.equal(response.status, 200);
  noStore(response);
  assert.deepEqual(await response.json(), {
    access_token: ACCESS, expires_in: 28800, refresh_token: REFRESH, refresh_token_expires_in: 15811200, token_type: 'bearer',
  });
  assert.deepEqual(response.headers.getSetCookie(), [`${COOKIE_PREFIX}${STATE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`]);
  assert.equal(github.calls.length, 1);
  const [sent] = github.calls;
  assert.equal(sent.url, GITHUB_TOKEN_URL);
  assert.equal(sent.method, 'POST');
  assert.equal(sent.headers.get('Accept'), 'application/json');
  assert.deepEqual(JSON.parse(sent.body), {
    client_id: ID, client_secret: SECRET, code: CODE, redirect_uri: 'https://openwiz.dev/app', code_verifier: VERIFIER,
  });
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

const REFUSALS = [
  ['token: wrong state value', 'token', { body: { code: CODE, state: 'B'.repeat(43) } }, 403, 'bad_state'],
  ['token: no state cookie', 'token', { cookie: null, body: { code: CODE, state: STATE } }, 403, 'bad_state'],
  ['token: empty verifier in state cookie', 'token', { cookie: `${COOKIE_PREFIX}${STATE}=`, body: { code: CODE, state: STATE } }, 403, 'bad_state'],
  ['token: missing verifier in legacy state cookie', 'token', { cookie: `${COOKIE_PREFIX}${STATE}=1`, body: { code: CODE, state: STATE } }, 403, 'bad_state'],
  ['token: malformed verifier in state cookie', 'token', { cookie: `${COOKIE_PREFIX}${STATE}=${VERIFIER}=extra`, body: { code: CODE, state: STATE } }, 403, 'bad_state'],
  ['token: two cookies for one attempt', 'token', { cookie: `${COOKIE_PREFIX}${STATE}=${VERIFIER}; ${COOKIE_PREFIX}${STATE}=${VERIFIER}`, body: { code: CODE, state: STATE } }, 403, 'bad_state'],
  ['token: a cookie for another attempt only', 'token', { cookie: `${COOKIE_PREFIX}${'B'.repeat(43)}=${VERIFIER}`, body: { code: CODE, state: STATE } }, 403, 'bad_state'],
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
    for (const secret of [CODE, REFRESH, SECRET, STATE, VERIFIER]) assert.ok(!text.includes(secret));
    assert.equal(response.headers.get('Location'), null);
    assert.deepEqual(response.headers.getSetCookie(), []);
    assert.equal(github.calls.length, 0);
  });
}

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
  const to = new URL(response.headers.get('Location'));
  const state = to.searchParams.get('state');
  const code = `fakecode_${++nextCode}`;
  github.challenges.set(code, to.searchParams.get('code_challenge'));
  return { state, code };
}
async function returnIn(jar, attempt) {
  const response = await call('token', { cookie: sent(jar) || null, body: { code: attempt.code, state: attempt.state } });
  keep(jar, response);
  return response.status;
}

test('PKCE: wrong verifier is refused by GitHub', async () => {
  const response = await call('token', { cookie: `${COOKIE_PREFIX}${STATE}=${'W'.repeat(43)}`, body: { code: CODE, state: STATE } });
  assert.equal(response.status, 502);
  noStore(response);
  assert.deepEqual(await response.json(), { error: 'github_refused' });
  assert.equal(github.calls.length, 1);
  assert.equal(JSON.parse(github.calls[0].body).code_verifier, 'W'.repeat(43));
});

test('PKCE: another attempt’s verifier cannot exchange a leaked code', async () => {
  const victim = new Map();
  const attacker = new Map();
  const victimAttempt = await startIn(victim);
  const attackerAttempt = await startIn(attacker);
  assert.equal(await returnIn(attacker, { state: attackerAttempt.state, code: victimAttempt.code }), 502);
  assert.equal(await returnIn(victim, victimAttempt), 200);
  assert.equal(github.calls.length, 2);
});

test('two tabs: overlapping attempts both sign in, whichever returns from GitHub first', async () => {
  for (const order of [[0, 1], [1, 0]]) {
    const jar = new Map();
    const tries = [await startIn(jar), await startIn(jar)];
    assert.equal(await returnIn(jar, tries[order[0]]), 200);
    assert.equal(await returnIn(jar, tries[order[1]]), 200);
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
  const tries = [];
  for (let i = 0; i < 5; i++) tries.push(await startIn(jar));
  assert.deepEqual([...jar.keys()], tries.slice(1).map(attempt => `${COOKIE_PREFIX}${attempt.state}`));
  assert.equal(await returnIn(jar, tries[0]), 403);
  assert.equal(await returnIn(jar, tries[4]), 200);
});

test('the manifest asks for read-only metadata, issues and pull requests and nothing else', async () => {
  const manifest = JSON.parse(await readFile(new URL('../docs/github-app-manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.default_permissions, { metadata: 'read', issues: 'write', pull_requests: 'read' });
  assert.deepEqual(manifest.default_events, []);
  assert.deepEqual(manifest.callback_urls, ['https://openwiz.dev/app']);
  assert.deepEqual(manifest.hook_attributes, { url: 'https://openwiz.dev/', active: false });
  assert.deepEqual(Object.keys(manifest).sort(),
    ['callback_urls', 'default_events', 'default_permissions', 'description', 'hook_attributes', 'name', 'public', 'request_oauth_on_install', 'setup_url', 'url']);
  assert.equal(manifest.request_oauth_on_install, false);
  assert.equal(manifest.setup_url, 'https://openwiz.dev/app');
  assert.equal(manifest.url, 'https://openwiz.dev/');
  assert.equal(manifest.public, true);
});
