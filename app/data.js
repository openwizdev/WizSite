// The app's data layer: sign-in, the token, and every read from GitHub.
//
// The app only reads. Every request goes through ask() below, which allows only:
//   - GitHub's API (https://api.github.com): GET, and POST /graphql with a query (never a mutation);
//   - the sign-in helper on this site: POST /api/sign-in/token and /api/sign-in/refresh.
// The page's Content-Security-Policy (_headers) enforces the same two destinations in the browser itself.
//
// The token lives only in this browser (localStorage), and goes only to api.github.com.
// Feeds read on their own: agents every two minutes, specs every ten. A read that fails, or a part of one that
// does, is unknown, never empty. When GitHub's limit runs low the feeds pause until it resets, and say so.
'use strict';
(() => {
  const OW = (window.OW = window.OW || {});
  const API = 'https://api.github.com';
  const AUTH_KEY = 'openwiz.app.auth';
  const REPO_KEY = 'openwiz.app.repo';
  const LOW = 100; // GitHub points left at which the app stops reading until the limit resets
  const PAUSE_DEFAULT = 5 * 60 * 1000; // when GitHub refuses for its limit without saying until when

  // ---- The token and the picked repository, in this browser only ----

  const store = {
    get(key) {
      try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
    },
    set(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
    drop(key) { localStorage.removeItem(key); },
  };
  const auth = {
    get: () => store.get(AUTH_KEY),
    signedIn: () => Boolean(store.get(AUTH_KEY)?.token),
    keep(grant) {
      const now = Date.now();
      store.set(AUTH_KEY, {
        token: grant.access_token,
        expiresAt: grant.expires_in ? now + grant.expires_in * 1000 : null,
        refresh: grant.refresh_token || null,
        refreshExpiresAt: grant.refresh_token_expires_in ? now + grant.refresh_token_expires_in * 1000 : null,
      });
    },
    signOut() {
      store.drop(AUTH_KEY);
      store.drop(REPO_KEY);
    },
  };
  const repo = {
    get: () => store.get(REPO_KEY),
    pick(full) {
      const [owner, name] = full.split('/');
      store.set(REPO_KEY, { owner, name, full });
    },
    forget: () => store.drop(REPO_KEY),
  };

  // ---- The one way out ----

  class Refused extends Error {}
  function allowed(method, url, body) {
    if (url.startsWith(`${API}/`)) {
      if (method === 'GET') return true;
      return method === 'POST' && url === `${API}/graphql` && /^\s*query\s/.test(body.query) && !/\b(mutation|subscription)\b/i.test(body.query);
    }
    return method === 'POST' && (url === '/api/sign-in/token' || url === '/api/sign-in/refresh');
  }
  async function ask(method, url, body, headers = {}) {
    if (!allowed(method, url, body || {})) throw new Refused(`the app never sends ${method} ${url}`);
    return fetch(url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      credentials: url.startsWith('/') ? 'same-origin' : 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  }

  // ---- Sign-in: the helper swaps GitHub's code (or the refresh token) for the user's token ----

  async function finishSignIn(code, state) {
    const response = await ask('POST', '/api/sign-in/token', { code, state });
    const grant = response.ok ? await response.json() : null;
    if (!grant?.access_token) throw new Error('the sign-in did not finish');
    auth.keep(grant);
  }
  let refreshing = null;
  function refresh() {
    refreshing ||= (async () => {
      const kept = auth.get();
      if (!kept?.refresh || (kept.refreshExpiresAt && kept.refreshExpiresAt < Date.now())) return false;
      const response = await ask('POST', '/api/sign-in/refresh', { refresh_token: kept.refresh });
      const grant = response.ok ? await response.json() : null;
      if (!grant?.access_token) return false;
      auth.keep(grant);
      return true;
    })().catch(() => false).finally(() => { refreshing = null; });
    return refreshing;
  }

  // A GitHub request with the token. An expired token is refreshed once; a refused refresh signs out.
  async function github(method, path, body) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const kept = auth.get();
      if (!kept?.token) throw new SignedOut();
      if (kept.expiresAt && kept.expiresAt < Date.now() + 60_000 && attempt === 0 && !(await refresh())) {
        auth.signOut();
        throw new SignedOut();
      }
      const response = await ask(method, `${API}${path}`, body, {
        Authorization: `Bearer ${auth.get().token}`,
        Accept: 'application/vnd.github+json',
      });
      if (response.status !== 401) return response;
      if (attempt === 0 && (await refresh())) continue;
      auth.signOut();
      throw new SignedOut();
    }
    throw new SignedOut();
  }
  class SignedOut extends Error {}

  // ---- The repository picker's read: every repository the user's installations of the App can see ----

  async function repositories() {
    const installs = await github('GET', '/user/installations?per_page=100');
    if (!installs.ok) throw new Error(`GitHub answered ${installs.status}`);
    const out = [];
    for (const install of (await installs.json()).installations || []) {
      const page = await github('GET', `/user/installations/${encodeURIComponent(install.id)}/repositories?per_page=100`);
      if (!page.ok) throw new Error(`GitHub answered ${page.status}`);
      for (const r of (await page.json()).repositories || []) out.push({ full: r.full_name, private: Boolean(r.private) });
    }
    return out.sort((a, b) => a.full.localeCompare(b.full));
  }

  // ---- Feeds: the reads pages show, each on its own schedule ----
  // Pages (AP6 You and Specs, AP7 Agents) read feeds[name].data. A feed's state is:
  //   loading  - not read yet;  ok - read whole;  partial - read, but part failed (missing parts are unknown);
  //   unknown  - never read successfully (the last read failed);  stale - the last read failed, the data is older.

  const SPECS = `query Specs($owner: String!, $name: String!) {
  rateLimit { limit remaining resetAt }
  repository(owner: $owner, name: $name) {
    issues(first: 100, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      nodes { number title url updatedAt labels(first: 20) { nodes { name } } subIssuesSummary { total completed } }
    }
  }
}`;
  const AGENTS = `query Agents($owner: String!, $name: String!) {
  rateLimit { limit remaining resetAt }
  repository(owner: $owner, name: $name) {
    issues(first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { number title url state updatedAt labels(first: 20) { nodes { name } } comments(last: 20) { nodes { body updatedAt } } }
    }
  }
}`;
  const feeds = {
    specs: { label: 'Specs', every: 10 * 60 * 1000, query: SPECS },
    agents: { label: 'Agents', every: 2 * 60 * 1000, query: AGENTS },
  };
  for (const feed of Object.values(feeds)) Object.assign(feed, { state: 'loading', data: null, readAt: null, failedAt: null, timer: null, busy: false });

  const limit = { remaining: null, limit: null, pausedUntil: null };
  const listeners = new Set();
  const changed = () => listeners.forEach(listener => listener());
  const paused = () => limit.pausedUntil !== null && limit.pausedUntil > Date.now();

  function noteLimit(rate, response) {
    const remaining = rate?.remaining ?? Number(response.headers.get('x-ratelimit-remaining') ?? NaN);
    const reset = rate?.resetAt ? Date.parse(rate.resetAt) : Number(response.headers.get('x-ratelimit-reset') ?? NaN) * 1000;
    if (Number.isFinite(remaining)) {
      limit.remaining = remaining;
      limit.limit = rate?.limit ?? limit.limit;
      if (remaining < LOW) limit.pausedUntil = Number.isFinite(reset) ? reset : Date.now() + PAUSE_DEFAULT;
    }
    // GitHub refusing for its limit: a 429, or a 403 that says no points are left or asks to wait.
    const retry = Number(response.headers.get('retry-after') ?? NaN);
    if (response.status === 429 || (response.status === 403 && (remaining === 0 || Number.isFinite(retry)))) {
      limit.pausedUntil = Number.isFinite(retry) ? Date.now() + retry * 1000 : Number.isFinite(reset) ? reset : Date.now() + PAUSE_DEFAULT;
    }
  }

  async function read(name) {
    const feed = feeds[name];
    const picked = repo.get();
    if (!picked || feed.busy || paused()) return;
    feed.busy = true;
    try {
      const response = await github('POST', '/graphql', { query: feed.query, variables: { owner: picked.owner, name: picked.name } });
      const answer = await response.json().catch(() => null);
      noteLimit(answer?.data?.rateLimit, response);
      if (!response.ok || !answer?.data?.repository) throw new Error(`GitHub answered ${response.status}`);
      feed.data = answer.data.repository;
      feed.state = answer.errors?.length ? 'partial' : 'ok';
      feed.errors = answer.errors || [];
      feed.readAt = Date.now();
      feed.failedAt = null;
    } catch (error) {
      if (error instanceof SignedOut) {
        OW.onSignedOut?.();
        return;
      }
      feed.failedAt = Date.now();
      feed.state = feed.data ? 'stale' : 'unknown';
    } finally {
      feed.busy = false;
      changed();
    }
  }

  function schedule(name) {
    const feed = feeds[name];
    clearTimeout(feed.timer);
    feed.timer = setTimeout(async () => {
      if (!document.hidden) await read(name);
      schedule(name);
    }, feed.every);
  }
  function start() {
    for (const name of Object.keys(feeds)) {
      read(name);
      schedule(name);
    }
  }
  function stop() {
    for (const feed of Object.values(feeds)) {
      clearTimeout(feed.timer);
      Object.assign(feed, { state: 'loading', data: null, readAt: null, failedAt: null });
    }
    limit.pausedUntil = null;
  }
  // Read everything now (the Refresh button), unless GitHub's limit is low.
  function refreshAll() {
    if (paused()) return;
    for (const name of Object.keys(feeds)) {
      read(name);
      schedule(name);
    }
  }
  // Back on a hidden tab: read whatever came due while it was hidden.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !repo.get() || !auth.signedIn()) return;
    for (const [name, feed] of Object.entries(feeds)) {
      if (!feed.readAt || Date.now() - feed.readAt >= feed.every) read(name);
    }
  });

  OW.data = {
    auth, repo, feeds, limit, paused, finishSignIn, repositories, start, stop, refreshAll, SignedOut,
    onChange: listener => listeners.add(listener),
  };
})();
