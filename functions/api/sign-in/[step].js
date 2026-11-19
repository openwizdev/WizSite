// The sign-in helper: the app's only server piece (a Cloudflare Pages Function).
//
//   GET  /api/sign-in/start    a fresh state value: into its own host-only cookie, and on to GitHub's sign-in page
//   POST /api/sign-in/token    {code, state}: needs that state's cookie, clears only it, swaps the code for the user's token
//   POST /api/sign-in/refresh  {refresh_token}: swaps it for a new token pair
//
// It answers only on https://openwiz.dev, and its POSTs only to that origin. It keeps nothing, has no storage
// binding, writes no log line, and hands the token straight back to the user's browser. Its only settings are the
// GitHub App's client id and secret (GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET), set in the Pages project.
//
// Each sign-in attempt has its own cookie, named by its state, so two tabs can sign in at once and a stale or
// refused callback never disturbs another attempt. Start keeps at most four attempts, dropping the oldest.
//
// The GitHub App (docs/github-app-manifest.json) asks for no sign-in during installation: installing on the
// repositories the user picks returns to openwiz.dev/app (its setup URL) with no code. The app then starts here, so
// every code that reaches /app carries this helper's state.

const SITE = 'https://openwiz.dev';
const CALLBACK = `${SITE}/app`;
const AUTHORIZE = 'https://github.com/login/oauth/authorize';
const TOKEN = 'https://github.com/login/oauth/access_token';
const COOKIE = '__Host-openwiz-sign-in-'; // + the attempt's state
const ATTEMPTS = 4;
const COOKIE_RULES = 'Path=/; Max-Age=%s; Secure; HttpOnly; SameSite=Lax';
const STATE = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url
const VALUE = /^[A-Za-z0-9_.-]{1,512}$/; // a GitHub code or refresh token
const MAX_BODY = 4096;
// Only these fields of GitHub's answer reach the browser.
const GRANT = { access_token: 'string', token_type: 'string', expires_in: 'number', refresh_token: 'string', refresh_token_expires_in: 'number' };

function answer(status, body, headers = {}, cookies = []) {
  const all = new Headers({ 'Cache-Control': 'no-store', ...(body === null ? {} : { 'Content-Type': 'application/json' }), ...headers });
  for (const line of cookies) all.append('Set-Cookie', line);
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: all });
}
const refuse = (status, error, headers) => answer(status, { error }, headers);
const cookie = (state, maxAge) => `${COOKIE}${state}=${maxAge ? '1' : ''}; ${COOKIE_RULES.replace('%s', maxAge)}`;

function settings(env) {
  const id = env.GITHUB_CLIENT_ID;
  const secret = env.GITHUB_CLIENT_SECRET;
  return typeof id === 'string' && id && typeof secret === 'string' && secret ? { id, secret } : null;
}

// The body as exactly these string keys, each a well-formed value; anything else is null.
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

// The states of the attempt cookies the browser sent, in its order (oldest first).
function attempts(request) {
  return (request.headers.get('Cookie') || '').split(';').map(part => part.trim())
    .filter(part => part.startsWith(COOKIE)).map(part => part.slice(COOKIE.length).split('=')[0])
    .filter(state => STATE.test(state));
}

// One POST to GitHub; only a well-formed grant comes back, anything else is GitHub's refusal.
async function exchange(fields, headers) {
  let grant;
  try {
    const response = await fetch(TOKEN, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
      redirect: 'manual', // the secret and the user's code or refresh token go to this URL and nowhere else
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

function start(request, app) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const state = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const to = new URL(AUTHORIZE);
  to.search = new URLSearchParams({ client_id: app.id, redirect_uri: CALLBACK, state }).toString();
  const dropped = attempts(request).slice(0, -(ATTEMPTS - 1)).map(old => cookie(old, 0));
  return answer(302, null, { Location: to.toString() }, [...dropped, cookie(state, 600)]);
}

async function token(request, app) {
  const body = await readBody(request, ['code', 'state']);
  if (body === 'type') return refuse(415, 'bad_request');
  if (!body) return refuse(400, 'bad_request');
  // Exactly one cookie for this attempt; a refusal leaves every attempt's cookie alone.
  if (!STATE.test(body.state) || attempts(request).filter(state => state === body.state).length !== 1) {
    return refuse(403, 'bad_state');
  }
  // This attempt's state is single use, whatever GitHub answers.
  const clear = { 'Set-Cookie': cookie(body.state, 0) };
  return exchange({ client_id: app.id, client_secret: app.secret, code: body.code, redirect_uri: CALLBACK }, clear);
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
