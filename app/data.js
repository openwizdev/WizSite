'use strict';
(() => {
  const OW = (window.OW = window.OW || {});
  const API = 'https://api.github.com';
  const AUTH_KEY = 'openwiz.app.auth';
  const REPO_KEY = 'openwiz.app.repo';
  const LOW = 100;
  const PAUSE_DEFAULT = 5 * 60 * 1000;


  const store = {
    get(key) {
      try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
    },
    set(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
    drop(key) { localStorage.removeItem(key); },
  };
  const auth = {
    get: () => store.get(AUTH_KEY),
    session: () => store.get(AUTH_KEY)?.session ?? null,
    signedIn: () => Boolean(store.get(AUTH_KEY)?.token),
    keep(grant, session) {
      const now = Date.now();
      store.set(AUTH_KEY, {
        session,
        token: grant.access_token,
        expiresAt: grant.expires_in ? now + grant.expires_in * 1000 : null,
        refresh: grant.refresh_token || null,
        refreshExpiresAt: grant.refresh_token_expires_in ? now + grant.refresh_token_expires_in * 1000 : null,
      });
    },
    signOut() {
      store.drop(AUTH_KEY);
      store.drop(REPO_KEY);
      refreshing = null;
      stop();
      Object.assign(limit, { remaining: null, limit: null, pausedUntil: null });
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


  async function finishSignIn(code, state) {
    const response = await ask('POST', '/api/sign-in/token', { code, state });
    const grant = response.ok ? await response.json() : null;
    if (!grant?.access_token) throw new Error('the sign-in did not finish');
    auth.keep(grant, crypto.randomUUID());
  }
  let refreshing = null;
  function refresh(session) {
    if (refreshing?.session !== session) {
      const run = (async () => {
        const kept = auth.get();
        if (kept?.session !== session || !kept.refresh || (kept.refreshExpiresAt && kept.refreshExpiresAt < Date.now())) return false;
        const response = await ask('POST', '/api/sign-in/refresh', { refresh_token: kept.refresh });
        const grant = response.ok ? await response.json() : null;
        if (auth.session() !== session || !grant?.access_token) return false;
        auth.keep(grant, session);
        return true;
      })().catch(() => false).finally(() => { if (refreshing?.run === run) refreshing = null; });
      refreshing = { session, run };
    }
    return refreshing.run;
  }

  class Ended extends Error {}
  class SignedOut extends Error {}

  async function github(method, path, body) {
    const session = auth.session();
    if (!session) throw new Ended();
    const still = () => { if (auth.session() !== session) throw new Ended(); };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const kept = auth.get();
      if (kept.expiresAt && kept.expiresAt < Date.now() + 60_000 && attempt === 0) {
        const renewed = await refresh(session);
        still();
        if (!renewed) {
          auth.signOut();
          throw new SignedOut();
        }
      }
      const response = await ask(method, `${API}${path}`, body, {
        Authorization: `Bearer ${auth.get().token}`,
        Accept: 'application/vnd.github+json',
      });
      still();
      if (response.status !== 401) return response;
      const renewed = attempt === 0 && (await refresh(session));
      still();
      if (renewed) continue;
      auth.signOut();
      throw new SignedOut();
    }
    throw new SignedOut();
  }


  const MAX_PAGES = 50;
  function nextPage(response, path) {
    const link = (response.headers.get('Link') || '').split(',').map(part => part.match(/^\s*<([^>]*)>\s*;\s*rel="next"\s*$/)).find(Boolean);
    if (!link) return { done: true };
    let url;
    try { url = new URL(link[1]); } catch { return { done: false }; }
    const keys = [...url.searchParams.keys()];
    const fine = url.origin === API && url.pathname === path && !url.hash && !url.username && !url.password
      && keys.every(key => key === 'per_page' || key === 'page') && /^\d+$/.test(url.searchParams.get('page') || '');
    return fine ? { next: `${url.pathname}${url.search}` } : { done: false };
  }
  async function every(path, field) {
    const items = [];
    let at = `${path}?per_page=100`;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = await github('GET', at);
      if (!response.ok) {
        if (!page) throw new Error(`GitHub answered ${response.status}`);
        return { items, complete: false };
      }
      const body = await response.json().catch(() => null);
      if (!Array.isArray(body?.[field])) {
        if (!page) throw new Error('GitHub answered an unreadable list');
        return { items, complete: false };
      }
      items.push(...body[field]);
      const next = nextPage(response, path);
      if (!next.next) return { items, complete: next.done };
      at = next.next;
    }
    return { items, complete: false };
  }

  async function repositories() {
    const installs = await every('/user/installations', 'installations');
    let complete = installs.complete;
    const repos = [];
    for (const install of installs.items) {
      if (!Number.isSafeInteger(install?.id)) { complete = false; continue; }
      try {
        const page = await every(`/user/installations/${install.id}/repositories`, 'repositories');
        complete &&= page.complete;
        for (const r of page.items) if (typeof r?.full_name === 'string') repos.push({ full: r.full_name, private: Boolean(r.private) });
      } catch (error) {
        if (error instanceof Ended || error instanceof SignedOut) throw error;
        complete = false;
      }
    }
    return { repos: repos.sort((a, b) => a.full.localeCompare(b.full)), complete, installations: installs.items.length };
  }


  const SPECS = `query Specs($owner: String!, $name: String!, $specs: String!) {
  rateLimit { limit remaining resetAt }
  specSearch: search(query: $specs, type: ISSUE_ADVANCED, first: 100) {
    totalCount: issueCount
    nodes { ... on Issue { number title url updatedAt labels(first: 20) { nodes { name } } subIssuesSummary { total completed } } }
  }
  repository(owner: $owner, name: $name) {
    issues(first: 100, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      nodes { number title url updatedAt labels(first: 20) { nodes { name } } subIssuesSummary { total completed } }
    }
    youIssues: issues(first: 50, states: OPEN, labels: ["needs-info", "ready-for-human"], orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      nodes { number title url updatedAt labels(first: 20) { nodes { name } } }
    }
    fleet: object(expression: "HEAD:docs/agents/fleet.md") { ... on Blob { text } }
  }
}`;
  const SPEC_DETAILS = 30;
  const RECENT = 'orderBy: {field: UPDATED_AT, direction: DESC}';
  const TICKET = 'number title url state stateReason repository { nameWithOwner }';
  function specTickets(repository) {
    const numbers = (repository.specIssues?.nodes || []).map(issue => issue?.number).filter(Number.isSafeInteger).slice(0, SPEC_DETAILS);
    if (!numbers.length) return null;
    return `query SpecTickets($owner: String!, $name: String!) {
  rateLimit { limit remaining resetAt }
  repository(owner: $owner, name: $name) {${numbers.map(n => `
    s${n}: issue(number: ${n}) { number
      comments(first: 50, ${RECENT}) { totalCount nodes { databaseId body url createdAt updatedAt author { login } } }
      subIssues(first: 50) { totalCount nodes { ${TICKET} labels(first: 20) { nodes { name } }
        blockedBy(first: 10) { totalCount nodes { ${TICKET} } }
        closedByPullRequestsReferences(first: 5) { totalCount nodes { url state isDraft reviewDecision } }
        comments(first: 20, ${RECENT}) { totalCount nodes { databaseId body createdAt updatedAt author { login } } } } } }`).join('')}
  }
}`;
  }
  const AGENTS = `query Agents($owner: String!, $name: String!) {
  rateLimit { limit remaining resetAt }
  repository(owner: $owner, name: $name) {
    issues(first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      nodes { number title url state updatedAt
        comments(first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) { totalCount nodes { databaseId body createdAt updatedAt author { login } } }
        closedByPullRequestsReferences(first: 5, includeClosedPrs: true) { totalCount nodes { url state isDraft reviewDecision
          commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } }
    }
    fleet: object(expression: "HEAD:docs/agents/fleet.md") { ... on Blob { text } }
  }
}`;
  const SPEC_TITLE = /(^|\s)spec:\s/i;
  const SPEC_SEARCH = full => `repo:${full} is:issue state:open (has:sub-issue OR label:spec OR in:title spec) -label:wayfind:map sort:updated-desc`;
  function specsOf(search) {
    if (!search || !Array.isArray(search.nodes)) return null;
    const given = search.nodes.filter(issue => Number.isSafeInteger(issue?.number));
    const labels = issue => (issue.labels?.nodes || []).map(label => label?.name);
    const nodes = given.filter(issue => !labels(issue).includes('wayfind:map')
      && (issue.subIssuesSummary?.total > 0 || labels(issue).includes('spec') || SPEC_TITLE.test(issue.title || '')));
    return { totalCount: nodes.length + Math.max(0, (search.totalCount ?? 0) - given.length), nodes };
  }
  const feeds = {
    specs: { label: 'Specs', every: 10 * 60 * 1000, query: SPECS, more: specTickets,
      variables: picked => ({ specs: SPEC_SEARCH(picked.full) }),
      shape: (data, answer) => { data.specIssues = specsOf(answer.specSearch); } },
    agents: { label: 'Agents', every: 2 * 60 * 1000, query: AGENTS },
  };
  for (const feed of Object.values(feeds)) Object.assign(feed, { state: 'loading', data: null, readAt: null, failedAt: null, timer: null, busy: false });

  const limit = { remaining: null, limit: null, pausedUntil: null };
  let generation = 0;
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
    const retry = Number(response.headers.get('retry-after') ?? NaN);
    if (response.status === 429 || (response.status === 403 && (remaining === 0 || Number.isFinite(retry)))) {
      limit.pausedUntil = Number.isFinite(retry) ? Date.now() + retry * 1000 : Number.isFinite(reset) ? reset : Date.now() + PAUSE_DEFAULT;
    }
  }

  async function read(name) {
    const feed = feeds[name];
    const picked = repo.get();
    if (!picked || feed.busy || paused()) return;
    const mine = generation;
    feed.busy = true;
    try {
      const response = await github('POST', '/graphql', { query: feed.query, variables: { owner: picked.owner, name: picked.name, ...feed.variables?.(picked) } });
      const answer = await response.json().catch(() => null);
      if (mine !== generation) return;
      noteLimit(answer?.data?.rateLimit, response);
      if (!response.ok || !answer?.data?.repository) throw new Error(`GitHub answered ${response.status}`);
      const data = answer.data.repository;
      feed.shape?.(data, answer.data);
      const errors = [...(answer.errors || [])];
      const more = feed.more?.(data);
      if (more) {
        data.specs = null;
        if (paused()) {
          errors.push({ message: 'the second read waits for GitHub\'s limit' });
        } else {
          try {
            const second = await github('POST', '/graphql', { query: more, variables: { owner: picked.owner, name: picked.name } });
            const extra = await second.json().catch(() => null);
            if (mine !== generation) return;
            noteLimit(extra?.data?.rateLimit, second);
            if (second.ok && extra?.data?.repository) data.specs = extra.data.repository;
            errors.push(...(second.ok && extra?.data?.repository ? extra.errors || [] : [{ message: `GitHub answered ${second.status}` }]));
          } catch (error) {
            if (error instanceof Ended || error instanceof SignedOut) throw error;
            if (mine !== generation) return;
            errors.push({ message: 'the second read failed' });
          }
        }
      }
      feed.data = data;
      feed.state = errors.length ? 'partial' : 'ok';
      feed.errors = errors;
      feed.readAt = Date.now();
      feed.failedAt = null;
    } catch (error) {
      if (error instanceof Ended) return;
      if (error instanceof SignedOut) {
        OW.onSignedOut?.();
        return;
      }
      if (mine !== generation) return;
      feed.failedAt = Date.now();
      feed.state = feed.data ? 'stale' : 'unknown';
    } finally {
      if (mine === generation) {
        feed.busy = false;
        changed();
      }
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
    generation += 1;
    for (const feed of Object.values(feeds)) {
      clearTimeout(feed.timer);
      Object.assign(feed, { state: 'loading', data: null, readAt: null, failedAt: null, busy: false });
    }
  }
  function refreshAll() {
    if (paused()) return;
    for (const name of Object.keys(feeds)) {
      read(name);
      schedule(name);
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !repo.get() || !auth.signedIn()) return;
    for (const [name, feed] of Object.entries(feeds)) {
      if (!feed.readAt || Date.now() - feed.readAt >= feed.every) read(name);
    }
  });

  OW.data = {
    auth, repo, feeds, limit, paused, finishSignIn, repositories, start, stop, refreshAll, SignedOut, Ended,
    onChange: listener => listeners.add(listener),
  };
})();
