const SITE = 'https://openwiz.dev';
const CALLBACK = `${SITE}/app`;
const AUTHORIZE = 'https://github.com/login/oauth/authorize';
const TOKEN = 'https://github.com/login/oauth/access_token';
const COOKIE_PREFIX = '__Host-openwiz-sign-in-';
const ATTEMPTS = 4;
const COOKIE_RULES = 'Path=/; Max-Age=%s; Secure; HttpOnly; SameSite=Lax';
const STATE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9_-]{43}$/;
const VALUE = /^[A-Za-z0-9_.-]{1,512}$/;
const MAX_BODY = 4096;
const GRANT = { access_token: 'string', token_type: 'string', expires_in: 'number', refresh_token: 'string', refresh_token_expires_in: 'number' };

function answer(status, body, headers = {}, cookies = []) {
  const all = new Headers({ 'Cache-Control': 'no-store', ...(body === null ? {} : { 'Content-Type': 'application/json' }), ...headers });
  for (const line of cookies) all.append('Set-Cookie', line);
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: all });
}
const refuse = (status, error, headers) => answer(status, { error }, headers);
const cookie = (state, maxAge, verifier = '') => `${COOKIE_PREFIX}${state}=${maxAge ? verifier : ''}; ${COOKIE_RULES.replace('%s', maxAge)}`;

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const randomToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
async function challenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function settings(env) {
  const id = env.GITHUB_CLIENT_ID;
  const secret = env.GITHUB_CLIENT_SECRET;
  return typeof id === 'string' && id && typeof secret === 'string' && secret ? { id, secret } : null;
}

async function readBody(request, keys) {
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return 'type';
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  let body;
  try { body = JSON.parse(text); } catch { return null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const got = Object.keys(body).sort();
  if (got.join() !== [...keys].sort().join()) return null;
  return got.every(key => typeof body[key] === 'string' && VALUE.test(body[key])) ? body : null;
}

function attempts(request) {
  const out = [];
  for (const raw of (request.headers.get('Cookie') || '').split(';')) {
    const part = raw.trim();
    if (!part.startsWith(COOKIE_PREFIX)) continue;
    const rest = part.slice(COOKIE_PREFIX.length);
    const eq = rest.indexOf('=');
    const state = eq === -1 ? rest : rest.slice(0, eq);
    const verifier = eq === -1 ? '' : rest.slice(eq + 1);
    if (STATE.test(state)) out.push({ state, verifier });
  }
  return out;
}

async function exchange(fields, headers) {
  let grant;
  try {
    const response = await fetch(TOKEN, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    grant = response.ok ? await response.json() : null;
  } catch {
    grant = null;
  }
  if (!grant || typeof grant !== 'object' || typeof grant.access_token !== 'string' || !grant.access_token) {
    return refuse(502, 'github_refused', headers);
  }
  const out = {};
  for (const [key, kind] of Object.entries(GRANT)) {
    if (key in grant) {
      if (typeof grant[key] !== kind) return refuse(502, 'github_refused', headers);
      out[key] = grant[key];
    }
  }
  return answer(200, out, headers);
}

async function start(request, app) {
  const state = randomToken();
  const verifier = randomToken();
  const to = new URL(AUTHORIZE);
  to.search = new URLSearchParams({
    client_id: app.id,
    redirect_uri: CALLBACK,
    state,
    code_challenge: await challenge(verifier),
    code_challenge_method: 'S256',
  }).toString();
  const dropped = attempts(request).slice(0, -(ATTEMPTS - 1)).map(old => cookie(old.state, 0));
  return answer(302, null, { Location: to.toString() }, [...dropped, cookie(state, 600, verifier)]);
}

async function token(request, app) {
  const body = await readBody(request, ['code', 'state']);
  if (body === 'type') return refuse(415, 'bad_request');
  if (!body) return refuse(400, 'bad_request');
  const matched = STATE.test(body.state) ? attempts(request).filter(attempt => attempt.state === body.state) : [];
  if (matched.length !== 1 || !VERIFIER.test(matched[0].verifier)) {
    return refuse(403, 'bad_state');
  }
  const clear = { 'Set-Cookie': cookie(body.state, 0) };
  return exchange({
    client_id: app.id,
    client_secret: app.secret,
    code: body.code,
    redirect_uri: CALLBACK,
    code_verifier: matched[0].verifier,
  }, clear);
}

async function refresh(request, app) {
  const body = await readBody(request, ['refresh_token']);
  if (body === 'type') return refuse(415, 'bad_request');
  if (!body) return refuse(400, 'bad_request');
  return exchange({ client_id: app.id, client_secret: app.secret, grant_type: 'refresh_token', refresh_token: body.refresh_token });
}

const STEPS = { start: ['GET', start], token: ['POST', token], refresh: ['POST', refresh] };

export async function onRequest({ request, env, params }) {
  const step = STEPS[params.step];
  if (!step) return refuse(404, 'not_found');
  const [method, run] = step;
  if (request.method !== method) return refuse(405, 'bad_method', { Allow: method });
  if (new URL(request.url).origin !== SITE) return refuse(403, 'bad_origin');
  if (method === 'POST' && request.headers.get('Origin') !== SITE) return refuse(403, 'bad_origin');
  const app = settings(env);
  if (!app) return refuse(503, 'not_configured');
  return run(request, app);
}
