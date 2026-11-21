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
      nodes { number title url updatedAt labels(first: 20) { nodes { name } } issueDependenciesSummary { blockedBy } }
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
  const PULLS = `closedByPullRequestsReferences(first: 5, includeClosedPrs: true) { totalCount nodes { url state isDraft reviewDecision
          commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } }`;
  const AGENTS = `query Agents($owner: String!, $name: String!, $since: DateTime!, $after: String) {
  rateLimit { limit remaining resetAt }
  repository(owner: $owner, name: $name) {
    issues(first: 50, after: $after, filterBy: {since: $since}, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount pageInfo { hasNextPage endCursor }
      nodes { number title url state updatedAt
        comments(first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) { totalCount nodes { databaseId body createdAt updatedAt author { login } } }
        ${PULLS} }
    }
    fleet: object(expression: "HEAD:docs/agents/fleet.md") { ... on Blob { text } }
  }
}`;
  const PULL_REFRESH = 50;
  const DAY = 24 * 60 * 60 * 1000;
  const SKEW = 5 * 60 * 1000;
  const FULL_EVERY = 30 * 60 * 1000;
  const AGENT_PAGES = 40;
  const RESERVE = 500;
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
    agents: { label: 'Agents', every: 2 * 60 * 1000, run: agentsRead },
  };
  for (const feed of Object.values(feeds)) Object.assign(feed, { state: 'loading', data: null, readAt: null, failedAt: null, timer: null, busy: false });


  function place(errors, nodes) {
    const loose = [];
    for (const error of Array.isArray(errors) ? errors : []) {
      const path = Array.isArray(error?.path) ? error.path : [];
      const at = path[0] === 'repository' && path[1] === 'issues' && path[2] === 'nodes' && Number.isSafeInteger(path[3]) ? path[3] : -1;
      const issue = at >= 0 ? nodes[at] : undefined;
      if (issue === null) continue;
      if (issue && path.length > 4) (issue.errors ||= []).push(path.slice(4));
      else loose.push(error);
    }
    return loose;
  }
  async function agentsRead(feed, picked, mine) {
    const now = Date.now();
    const kept = feed.kept?.repo === picked.full ? feed.kept : null;
    const full = !kept || !kept.complete || feed.forceFull || now - kept.fullAt >= FULL_EVERY;
    feed.forceFull = false;
    const since = new Date(full ? now - DAY - SKEW : kept.startedAt - SKEW).toISOString();
    const issues = full ? new Map() : new Map(kept.issues);
    const unread = [];
    const fetched = new Set();
    const errors = [];
    let after = null;
    let total = null;
    let read = 0;
    let fleet;
    let complete = false;
    let stop = null;
    for (let page = 0; page < AGENT_PAGES; page += 1) {
      if (page && (paused() || (limit.remaining !== null && limit.remaining < RESERVE))) { stop = 'limit'; break; }
      let response;
      let answer;
      try {
        response = await github('POST', '/graphql', { query: AGENTS, variables: { owner: picked.owner, name: picked.name, since, after } });
        answer = await response.json().catch(() => null);
      } catch (error) {
        if (!page || error instanceof Ended || error instanceof SignedOut) throw error;
        errors.push({ message: 'a page of the read failed' });
        stop = 'failed';
        break;
      }
      if (mine !== generation) return null;
      noteLimit(answer?.data?.rateLimit, response);
      const list = answer?.data?.repository?.issues;
      if (!response.ok || !Array.isArray(list?.nodes)) {
        if (!page) throw new Error(`GitHub answered ${response.status}`);
        errors.push({ message: `GitHub answered ${response.status}` });
        stop = 'failed';
        break;
      }
      if (!page) {
        fleet = answer.data.repository.fleet;
        total = list.totalCount ?? null;
      }
      errors.push(...place(answer.errors, list.nodes));
      for (const issue of list.nodes) {
        read += 1;
        if (issue && Number.isSafeInteger(issue.number)) { issues.set(issue.number, issue); fetched.add(issue.number); }
        else unread.push(null);
      }
      if (!list.pageInfo) { complete = (list.totalCount ?? read) <= read; if (!complete) stop = 'failed'; break; }
      if (!list.pageInfo.hasNextPage) { complete = true; break; }
      if (typeof list.pageInfo.endCursor !== 'string') { stop = 'failed'; break; }
      after = list.pageInfo.endCursor;
      if (!feed.data || feed.data.issues?.reading) {
        feed.data = { issues: { totalCount: total, nodes: [...issues.values()], reading: true }, fleet };
        changed();
      }
    }
    if (!complete && !stop) stop = 'limit';
    for (const number of fetched) {
      if (issues.get(number).closedByPullRequestsReferences == null) errors.push({ message: `#${number}'s pull requests couldn't be read` });
    }
    if (!full && !stop) {
      const stale = [...issues.values()].filter(issue => !fetched.has(issue.number)
        && (issue.closedByPullRequestsReferences?.nodes || []).some(pr => pr?.state === 'OPEN')).slice(0, PULL_REFRESH);
      if (stale.length && !paused()) {
        const ok = await pullsRead(stale, picked, mine, errors);
        if (ok === null) return null;
      }
    }
    for (const [number, issue] of issues) if (Date.parse(issue.updatedAt) < now - DAY - SKEW) issues.delete(number);
    const nodes = [...issues.values()].sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
    feed.kept = { repo: picked.full, issues, startedAt: now, fullAt: full ? now : kept.fullAt, complete: complete && !errors.length };
    const count = nodes.length + unread.length;
    const short = complete ? null : { why: stop, read, total: Math.max(read + 1, total ?? 0), scope: full ? 'day' : 'since' };
    return {
      data: { issues: { totalCount: short ? count + short.total - short.read : count, nodes: [...nodes, ...unread], short }, fleet },
      errors,
    };
  }

  async function pullsRead(stale, picked, mine, errors) {
    const query = `query AgentPulls($owner: String!, $name: String!) {
  rateLimit { limit remaining resetAt }
  repository(owner: $owner, name: $name) {${stale.map(issue => `
    i${issue.number}: issue(number: ${issue.number}) { ${PULLS} }`).join('')}
  }
}`;
    try {
      const response = await github('POST', '/graphql', { query, variables: { owner: picked.owner, name: picked.name } });
      const answer = await response.json().catch(() => null);
      if (mine !== generation) return null;
      noteLimit(answer?.data?.rateLimit, response);
      const repository = answer?.data?.repository;
      if (!response.ok || !repository) {
        for (const issue of stale) issue.closedByPullRequestsReferences = null;
        errors.push({ message: `GitHub answered ${response.status}` });
        return false;
      }
      for (const issue of stale) {
        const got = repository[`i${issue.number}`];
        const placed = (answer.errors || []).filter(e => Array.isArray(e?.path) && e.path[1] === `i${issue.number}`).map(e => e.path.slice(2));
        if (!got?.closedByPullRequestsReferences) {
          issue.closedByPullRequestsReferences = null;
          errors.push({ message: `#${issue.number}'s pull requests couldn't be read` });
          continue;
        }
        issue.closedByPullRequestsReferences = got.closedByPullRequestsReferences;
        issue.errors = [...(issue.errors || []).filter(path => path[0] !== 'closedByPullRequestsReferences'), ...placed];
      }
      errors.push(...(answer.errors || []).filter(e => !(Array.isArray(e?.path) && /^i\d+$/.test(e.path[1] || ''))));
      return true;
    } catch (error) {
      if (error instanceof Ended || error instanceof SignedOut) throw error;
      if (mine !== generation) return null;
      for (const issue of stale) issue.closedByPullRequestsReferences = null;
      errors.push({ message: 'the pull request read failed' });
      return false;
    }
  }

  async function issueComments(picked, number) {
    const items = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await github('GET', `/repos/${encodeURIComponent(picked.owner)}/${encodeURIComponent(picked.name)}/issues/${number}/comments?per_page=100&page=${page}`);
      const body = response.ok ? await response.json().catch(() => null) : null;
      if (!Array.isArray(body)) return { items, complete: false };
      items.push(...body);
      if (!/rel="next"/.test(response.headers.get('Link') || '')) return { items, complete: true };
    }
    return { items, complete: false };
  }
  async function moreComments(specs, picked) {
    for (const detail of Object.values(specs || {})) {
      const list = detail?.comments;
      if (!list || !Number.isSafeInteger(detail.number) || (list.totalCount ?? 0) <= (list.nodes || []).length || paused()) continue;
      try {
        const got = await issueComments(picked, detail.number);
        if (!got.complete) continue;
        const nodes = got.items.filter(c => Number.isSafeInteger(c?.id)).map(c => ({ databaseId: c.id, body: c.body ?? '', url: c.html_url,
          createdAt: c.created_at, updatedAt: c.updated_at, author: typeof c.user?.login === 'string' ? { login: c.user.login } : null }));
        detail.comments = { totalCount: got.items.length, nodes };
      } catch (error) {
        if (error instanceof Ended || error instanceof SignedOut) throw error;
      }
    }
  }

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
      if (feed.run) {
        const done = await feed.run(feed, picked, mine);
        if (!done || mine !== generation) return;
        feed.data = done.data;
        feed.state = done.errors.length ? 'partial' : 'ok';
        feed.errors = done.errors;
        feed.readAt = Date.now();
        feed.failedAt = null;
        return;
      }
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
            if (second.ok && extra?.data?.repository) {
              data.specs = extra.data.repository;
              await moreComments(data.specs, picked);
              if (mine !== generation) return;
            }
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
      Object.assign(feed, { state: 'loading', data: null, readAt: null, failedAt: null, busy: false, kept: null });
    }
  }
  function refreshAll() {
    if (paused()) return;
    feeds.agents.forceFull = true;
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
