import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { World, start, signIn, SITE, API } from '../tests/v2/browser.mjs';

export const PAGES = ['You', 'Specs', 'Agents', 'Canvas', 'Models'];
export const DUMMY_TOKEN = 'ghu_LIVECHECK_DUMMY_000000000000000000000';

const LAPSE_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const SPEC_CHUNK = 6;
const CHUNK_TICKETS = 60;
const SPEC_DETAILS = 60;
const SPEC_TITLE = /(^|\s)spec:\s/i;
const STATUS_MARKER = '<!-- openwiz:status v1 -->';
const STATUS_KINDS = ['builder', 'reviewer', 'fleet'];
const STATUS_TEXT = /^[^\u0000-\u001f\u007f"\u201c\u201d>][^\u0000-\u001f\u007f"\u201c\u201d]*$/;
const SKILL_RE = '[a-z0-9]+(?:-[a-z0-9]+)*@[0-9]+\\.[0-9]+\\.[0-9]+';
const STATUS_RULES = {
  agent: v => STATUS_KINDS.includes(v),
  state: v => /^(working|asking|done|stopped|stopped \([^()\u0000-\u001f\u007f"\u201c\u201d]{1,100}\))$/.test(v),
  harness: v => v.length <= 60,
  model: v => v.length <= 60,
  skills: v => new RegExp(`^${SKILL_RE}(?:, ${SKILL_RE})*$`).test(v),
  step: () => true,
  time: v => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v) && !Number.isNaN(Date.parse(v)),
  pr: v => /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(v),
  preview: v => /^https:\/\/(?![^/:]*\.(?:local|internal|lan|localhost)(?:[:/]|$))(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(?::[0-9]{1,5})?(?:\/[^\s"<>?#@\\]*)?$/.test(v),
};
const STATUS_FIELDS = Object.keys(STATUS_RULES);
const DECISION_FENCE = /^```json\n([\s\S]*?)\n```$/gm;
const DECISION_COMMON = ['schema', 'kind', 'id', 'status', 'fingerprint', 'risk'];
const DECISION_KEYS = {
  spec_confirmation: [...DECISION_COMMON, 'spec', 'summary', 'headline', 'tickets', 'graph'],
  plan_approval: [...DECISION_COMMON, 'spec', 'summary', 'headline', 'tickets', 'graph'],
  grill_round: [...DECISION_COMMON, 'grill_file', 'round', 'questions', 'answered'],
  grill_confirmation: [...DECISION_COMMON, 'grill_file', 'summary'],
};

const MODEL_ROLES = [
  ['orchestrator', 'Orchestrator'],
  ['builder', 'Builder'],
  ['reviewer', 'Reviewer'],
  ['small_builder', 'Small builder'],
  ['fixer', 'Fixer'],
];
const MODEL_HEADER = ['Role', 'Harness', 'Model', 'Effort', '`room-cli thread spawn` flags'].join('|');
const OLDER_TABLES = ['Builder', 'Builder for small tickets', 'Reviewer for Claude-built', 'Reviewer for GPT-built', 'Fixer'];
const FAMILY = { 'claude-code': 'claude', codex: 'gpt' };

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const positiveInt = n => Number.isSafeInteger(n) && n > 0;
const nonEmptyStr = v => typeof v === 'string' && v.length > 0;
const exactKeys = (o, keys) => isPlainObject(o) && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));

export function isReadOnlyRequest(method, url, body = '') {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.origin !== API || parsed.username || parsed.password || parsed.hash) return false;
  const upper = String(method || '').toUpperCase();
  if (upper === 'GET') return !body;
  if (upper === 'POST' && parsed.pathname === '/graphql') {
    let payload;
    try {
      payload = JSON.parse(body || '');
    } catch {
      return false;
    }
    if (!isPlainObject(payload)) return false;
    if (!Object.keys(payload).every(k => k === 'query' || k === 'variables')) return false;
    if (typeof payload.query !== 'string') return false;
    if (!/^\s*query\b/.test(payload.query)) return false;
    if (/\b(mutation|subscription)\b/i.test(payload.query)) return false;
    if (payload.variables !== undefined && !isPlainObject(payload.variables)) return false;
    return true;
  }
  return false;
}

export class LiveWorld extends World {
  constructor({ owner, name, token, prod = false, githubFetch = fetch, siteTransform = null } = {}) {
    super();
    this.owner = owner;
    this.name = name;
    this.token = token || '';
    this.prod = Boolean(prod);
    this.githubFetch = githubFetch;
    this.siteTransform = siteTransform;
    this.refusedWrites = [];
    this.browserSawRealToken = false;
  }

  checkTokenLeak(request) {
    if (!this.token) return;
    if (request.url.includes(this.token)) this.browserSawRealToken = true;
    if ((request.postData || '').includes(this.token)) this.browserSawRealToken = true;
    for (const value of Object.values(request.headers || {})) {
      if (String(value).includes(this.token)) this.browserSawRealToken = true;
    }
  }

  async answer(request) {
    this.checkTokenLeak(request);
    const url = new URL(request.url);
    const method = (request.method || 'GET').toUpperCase();

    if (url.origin === SITE) {
      if (url.pathname === '/api/sign-in/token' && method === 'POST') {
        return { status: 200, json: { access_token: DUMMY_TOKEN, token_type: 'bearer', expires_in: 28800 } };
      }
      if (url.pathname.startsWith('/api/') || method !== 'GET') {
        this.refusedWrites.push({ method, url: request.url });
        return { status: 403, json: { message: 'live checker is read-only' } };
      }
      let reply;
      if (this.prod) {
        const res = await fetch(request.url);
        const headers = {};
        for (const k of ['content-security-policy', 'cache-control']) {
          if (res.headers.get(k)) headers[k] = res.headers.get(k);
        }
        const type = url.pathname.endsWith('/') ? 'html' : url.pathname.split('.').pop();
        reply = { status: res.status, raw: Buffer.from(await res.arrayBuffer()), type, headers };
      } else {
        reply = await super.answer(request);
      }
      return this.siteTransform && reply ? this.siteTransform(url.pathname, reply) : reply;
    }

    if (url.origin !== API) return null;

    if (method === 'OPTIONS') {
      return {
        status: 204,
        raw: Buffer.alloc(0),
        headers: {
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
          'Access-Control-Allow-Headers': 'Authorization, Accept, Content-Type',
        },
      };
    }

    if (method === 'GET' && url.pathname === '/user/installations') {
      return { status: 200, json: { total_count: 1, installations: [{ id: 1001, account: { login: this.owner } }] } };
    }
    if (method === 'GET' && url.pathname === '/user/installations/1001/repositories') {
      return { status: 200, json: { total_count: 1, repositories: [{ full_name: `${this.owner}/${this.name}`, private: false }] } };
    }
    if (method === 'GET' && url.pathname === '/user') {
      return { status: 200, json: { id: 1, login: this.owner } };
    }

    if (!isReadOnlyRequest(method, request.url, request.postData || '')) {
      this.refusedWrites.push({ method, url: request.url });
      return { status: 403, json: { message: 'live checker is read-only' } };
    }

    const res = await this.githubFetch(request.url, {
      method,
      body: method === 'GET' ? undefined : request.postData,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    const raw = Buffer.from(await res.arrayBuffer());
    const headers = {};
    for (const k of ['link', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-ratelimit-resource', 'retry-after']) {
      if (res.headers.get(k)) headers[k] = res.headers.get(k);
    }
    return { status: res.status, raw, type: 'json', headers };
  }
}

function recordAuthors(text) {
  if (typeof text !== 'string') return null;
  const section = text.replace(/\r\n/g, '\n').split(/^## /m).find(part => part.startsWith('GitHub identity\n'));
  const row = section?.split('\n').find(line => /^\|\s*Record authors\s*\|/.test(line));
  if (!row) return null;
  const value = row.split('|')[2] || '';
  const logins = [...value.matchAll(/`([^`]*)`/g)].map(m => m[1]);
  if (!logins.length || !logins.every(login => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/.test(login))) return null;
  return new Set(logins.map(login => login.toLowerCase()));
}

function readStatusNote(body) {
  const lines = String(body ?? '').replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  if (lines[0] !== STATUS_MARKER) {
    const other = lines[0].match(/^<!-- openwiz:status v(\d+) -->$/);
    return other ? { unknown: true } : null;
  }
  const fields = {};
  let at = 0;
  for (const line of lines.slice(1)) {
    const m = line.match(/^([a-z]+): (.*)$/);
    const index = m ? STATUS_FIELDS.indexOf(m[1], at) : -1;
    if (index < 0) return { unknown: true };
    const value = m[2];
    if (value.length < 1 || value.length > 300 || !STATUS_TEXT.test(value) || !STATUS_RULES[m[1]](value)) {
      return { unknown: true };
    }
    fields[m[1]] = value;
    at = index + 1;
  }
  if (!STATUS_FIELDS.slice(0, 7).every(name => name in fields)) return { unknown: true };
  const stopped = fields.state.match(/^stopped \((.*)\)$/);
  return { ...fields, state: stopped ? 'stopped' : fields.state };
}

function repeatsKeys(json) {
  const stack = [];
  for (const token of json.match(/"(?:[^"\\]|\\.)*"|[{}[\]:,]/g) || []) {
    const top = stack[stack.length - 1];
    if (token === '{') stack.push({ keys: new Set(), expectKey: true });
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',') { if (top) top.expectKey = true; }
    else if (token !== ':' && top?.expectKey) {
      const name = JSON.parse(token);
      if (top.keys.has(name)) return true;
      top.keys.add(name);
      top.expectKey = false;
    }
  }
  return false;
}

function readDecisionRecord(body, specNumber) {
  const raw = String(body ?? '').replace(/\r\n/g, '\n');
  const blocks = [...raw.matchAll(DECISION_FENCE)].map(m => m[1]);
  const parsed = blocks.map(block => { try { return JSON.parse(block); } catch { return undefined; } });
  const marked = raw.includes('openwiz.decisions.') || parsed.some(p => typeof p?.schema === 'string' && p.schema.startsWith('openwiz.decisions.'));
  if (!marked) return null;
  if (blocks.length !== 1 || parsed[0] === undefined || repeatsKeys(blocks[0])) return { malformed: true };
  const r = parsed[0];
  const keys = typeof r?.kind === 'string' && Object.hasOwn(DECISION_KEYS, r.kind) ? DECISION_KEYS[r.kind] : null;
  const ok = keys && exactKeys(r, keys) && r.schema === 'openwiz.decisions.v1'
    && typeof r.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(r.id)
    && ['open', 'resolved', 'superseded'].includes(r.status)
    && typeof r.fingerprint === 'string' && /^[0-9a-f]{64}$/.test(r.fingerprint)
    && ['ordinary', 'live', 'release', 'publish', 'unknown'].includes(r.risk);
  if (!ok) return { malformed: true };
  if (r.kind !== 'spec_confirmation' && r.kind !== 'plan_approval') return { record: r };
  const summary = Array.isArray(r.summary) && r.summary.length >= 1 && r.summary.length <= 10
    && r.summary.every(line => nonEmptyStr(line) && !/[\r\n]/.test(line));
  const tickets = Array.isArray(r.tickets) && (r.kind === 'spec_confirmation' ? r.tickets.length === 0
    : r.tickets.every((t, i) => exactKeys(t, ['number', 'title', 'blockers']) && positiveInt(t.number) && nonEmptyStr(t.title)
      && (i === 0 || r.tickets[i - 1].number < t.number) && Array.isArray(t.blockers)
      && t.blockers.every((b, j) => positiveInt(b) && b !== t.number && (j === 0 || t.blockers[j - 1] < b))));
  const graphOk = Array.isArray(r.graph) && (r.kind === 'spec_confirmation' ? r.graph.length === 0
    : r.graph.every(e => exactKeys(e, ['blocker', 'ticket']) && positiveInt(e.blocker) && positiveInt(e.ticket)));
  if (r.spec !== specNumber || !summary || !nonEmptyStr(r.headline) || !tickets || !graphOk) return { malformed: true };
  return { record: r };
}

function parseFleetModels(text) {
  if (typeof text !== 'string') return { hasFleet: false, roles: null };
  const lines = text.split(/\r?\n/);
  const isId = w => typeof w === 'string' && /^[A-Za-z0-9._-]+$/.test(w);
  const isModel = w => typeof w === 'string' && w.split('/').every(isId);
  const cells = line => (line.length > 1 && line.startsWith('|') && line.endsWith('|') ? line.slice(1, -1).split('|').map(c => c.trim()) : null);
  const findSection = name => {
    const at = lines.flatMap((line, i) => (line === `## ${name}` ? [i] : []));
    if (at.length !== 1) return null;
    const end = lines.findIndex((line, i) => i > at[0] && line.startsWith('## '));
    return lines.slice(at[0] + 1, end === -1 ? lines.length : end);
  };
  const parseFlags = cell => {
    const words = /^`(.*)`$/.exec(cell)?.[1].split(' ');
    if (!words || words.length !== 6 || words[0] !== '--provider' || words[2] !== '--model' || words[4] !== '--reasoning-level'
      || !isId(words[1]) || !isModel(words[3]) || !isId(words[5])) return null;
    return { provider: words[1], model: words[3], effort: words[5], family: FAMILY[words[1]] ?? null };
  };
  const modelsSec = findSection('Models');
  if (modelsSec) {
    const start = modelsSec.findIndex(line => line.startsWith('|'));
    if (start === -1) return { hasFleet: true, roles: null };
    const end = modelsSec.findIndex((line, i) => i > start && !line.startsWith('|'));
    const rows = modelsSec.slice(start, end === -1 ? modelsSec.length : end).map(cells);
    if (rows.some(r => !r) || rows.length < 2 || rows[0].join('|') !== MODEL_HEADER || rows[1].join('|') !== '---|---|---|---|---') {
      return { hasFleet: true, roles: null };
    }
    const roles = {};
    let next = 0;
    for (const r of rows.slice(2)) {
      if (r.length !== 5) return { hasFleet: true, roles: null };
      const at = MODEL_ROLES.findIndex(([, word], i) => i >= next && word === r[0]);
      if (at === -1 || (at > next && next < 3)) return { hasFleet: true, roles: null };
      if (r[1] === 'follows Builder' && r.slice(2).every(c => c === '')) {
        if (at < 3) return { hasFleet: true, roles: null };
        roles[MODEL_ROLES[at][0]] = { follows: true, choice: null };
      } else {
        const parsed = parseFlags(r[4]);
        if (!parsed || !r[1] || !r[2] || !r[3]) return { hasFleet: true, roles: null };
        roles[MODEL_ROLES[at][0]] = { follows: false, choice: parsed };
      }
      next = at + 1;
    }
    if (next < 3) return { hasFleet: true, roles: null };
    for (const [key] of MODEL_ROLES.slice(3)) roles[key] ||= { follows: true, choice: null };
    for (const role of Object.values(roles)) if (role.follows) role.choice = roles.builder.choice;
    return {
      hasFleet: true,
      roles: Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, `${v.choice.provider} ${v.choice.model} ${v.choice.effort}`])),
    };
  }
  const olderPresent = OLDER_TABLES.some(name => lines.includes(`## ${name}`));
  if (!olderPresent) return { hasFleet: true, roles: null };
  const settingTable = sec => {
    if (!sec) return null;
    const rows = sec.filter(line => line.startsWith('|')).map(cells);
    if (rows.some(r => !r)) return null;
    const ids = [];
    for (const [i, [setting, flag]] of [['Harness', '--provider'], ['Model', '--model'], ['Effort', '--reasoning-level']].entries()) {
      const r = rows[i + 2];
      const value = r?.length === 3 && r[0] === setting ? new RegExp(`^\`${flag} (.*)\`$`).exec(r[2])?.[1] : null;
      if (value == null || !(i === 1 ? isModel(value) : isId(value))) return null;
      ids.push(value);
    }
    return { provider: ids[0], model: ids[1], effort: ids[2], family: FAMILY[ids[0]] ?? null };
  };
  const tables = OLDER_TABLES.slice(0, 4).map(name => settingTable(findSection(name)));
  if (tables.some(t => !t)) return { hasFleet: true, roles: null };
  const builder = tables[0];
  const at = { claude: 0, gpt: 1 }[builder.family];
  const fixerHeads = lines.filter(line => line === '## Fixer').length;
  if (fixerHeads > 1) return { hasFleet: true, roles: null };
  let fixer = null;
  if (fixerHeads === 1) {
    const fixerRows = findSection('Fixer').map(cells).filter(Boolean);
    const fixers = ['Claude', 'GPT'].map(family => {
      const r = fixerRows.find(c => c.length === 5 && c[0] === family);
      return r ? parseFlags(r[4]) : null;
    });
    if (fixers.some(f => !f)) return { hasFleet: true, roles: null };
    fixer = at != null ? fixers[at] : null;
  }
  let reviewer = at != null ? tables[2 + at] : null;
  if (reviewer == null && (builder.provider === 'antigravity' || builder.provider === 'gemini-cli')) {
    const geminiHeads = lines.filter(line => line === '## Reviewer for Gemini-built').length;
    if (geminiHeads > 1) return { hasFleet: true, roles: null };
    if (geminiHeads === 1) {
      reviewer = settingTable(findSection('Reviewer for Gemini-built'));
      if (!reviewer) return { hasFleet: true, roles: null };
    }
  }
  if (reviewer == null) reviewer = [tables[3], tables[2]].find(r => r.provider !== builder.provider) ?? null;
  if (!reviewer) return { hasFleet: true, roles: null };
  const chosen = {
    orchestrator: builder,
    builder,
    reviewer,
    small_builder: tables[1],
    fixer,
  };
  return {
    hasFleet: true,
    roles: Object.fromEntries(Object.entries(chosen).map(([k, v]) => [k, v ? `${v.provider} ${v.model} ${v.effort}` : ''])),
  };
}

const SPECS_QUERY = `query Specs($owner: String!, $name: String!, $specs: String!) {
  rateLimit { limit remaining resetAt }
  specSearch: search(query: $specs, type: ISSUE_ADVANCED, first: 100) {
    totalCount: issueCount
    nodes { ... on Issue { number title url updatedAt labels(first: 20) { nodes { name } } subIssuesSummary { total completed } } }
  }
  repository(owner: $owner, name: $name) {
    youIssues: issues(first: 50, states: OPEN, labels: ["needs-info"], orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      nodes { number title url updatedAt labels(first: 20) { nodes { name } } issueDependenciesSummary { blockedBy } }
    }
    peopleIssues: issues(first: 50, states: OPEN, labels: ["ready-for-human"], orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      nodes { number title url updatedAt labels(first: 20) { nodes { name } } issueDependenciesSummary { blockedBy } }
    }
    fleet: object(expression: "HEAD:docs/agents/fleet.md") { ... on Blob { text } }
  }
}`;

const TICKET_FIELDS = 'number title url state stateReason repository { nameWithOwner }';
function specTicketsQuery(numbers) {
  return `query SpecTickets($owner: String!, $name: String!) {
  rateLimit { limit remaining resetAt }
  repository(owner: $owner, name: $name) {${numbers.map(n => `
    s${n}: issue(number: ${n}) { number
      comments(first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) { totalCount nodes { databaseId body url createdAt updatedAt author { login } } }
      subIssues(first: 50) { totalCount nodes { ${TICKET_FIELDS} labels(first: 20) { nodes { name } }
        blockedBy(first: 10) { totalCount nodes { ${TICKET_FIELDS} } }
        closedByPullRequestsReferences(first: 5) { totalCount nodes { url state isDraft reviewDecision } }
        comments(first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) { totalCount nodes { databaseId body createdAt updatedAt author { login } } } } } }`).join('')}
  }
}`;
}

const AGENTS_QUERY = `query Agents($owner: String!, $name: String!, $since: DateTime!, $after: String) {
  rateLimit { limit remaining resetAt }
  repository(owner: $owner, name: $name) {
    issues(first: 50, after: $after, filterBy: {since: $since}, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount pageInfo { hasNextPage endCursor }
      nodes { number title url state updatedAt
        comments(first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) { totalCount nodes { databaseId body createdAt updatedAt author { login } } }
        closedByPullRequestsReferences(first: 5, includeClosedPrs: true) { totalCount nodes { url state isDraft reviewDecision
          commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } }
    }
    fleet: object(expression: "HEAD:docs/agents/fleet.md") { ... on Blob { text } }
  }
}`;

function chunksOf(specs) {
  const out = [];
  let chunk = [];
  let tickets = 0;
  for (const spec of specs) {
    if (chunk.length && (chunk.length >= SPEC_CHUNK || tickets + spec.tickets > CHUNK_TICKETS)) {
      out.push(chunk);
      chunk = [];
      tickets = 0;
    }
    chunk.push(spec.n);
    tickets += spec.tickets;
  }
  if (chunk.length) out.push(chunk);
  return out;
}

const recent = (at, now) => at - now <= CLOCK_SKEW_MS && now - at < LAPSE_MS;
const labelNames = issue => (issue?.labels?.nodes || []).filter(Boolean).map(l => l.name);

function issueClaims(issue, authors, now) {
  const out = { builder: null, reviewer: null, fleet: null, uncertain: false };
  const comments = issue?.comments;
  const nodes = comments?.nodes || [];
  if (!comments || nodes.some(c => !c)) out.uncertain = true;
  const live = [];
  for (const comment of nodes) {
    if (!comment) continue;
    const note = readStatusNote(comment.body);
    if (!note) continue;
    const at = Date.parse(comment.updatedAt) || 0;
    const login = comment.author?.login;
    const by = authors && typeof login === 'string' ? authors.has(login.toLowerCase()) : null;
    if (by === false) continue;
    if (by === null || note.unknown || !Number.isSafeInteger(comment.databaseId)) {
      if (recent(at, now)) out.uncertain = true;
      continue;
    }
    if ((note.state === 'working' || note.state === 'asking') && recent(at, now)) live.push({ ...note, id: comment.databaseId });
  }
  for (const kind of STATUS_KINDS) {
    out[kind] = live.filter(n => n.agent === kind).sort((a, b) => a.id - b.id)[0] || null;
  }
  return out;
}

function ticketState(issue, authors, now) {
  if (!issue) return 'unknown';
  if (issue.state === 'CLOSED') return issue.stateReason === 'COMPLETED' ? 'merged' : 'held';
  const labels = labelNames(issue);
  if (labels.includes('held')) return 'held';
  if (labels.includes('needs-info') || labels.includes('ready-for-human')) return 'you';
  const claims = issueClaims(issue, authors, now);
  if (STATUS_KINDS.some(kind => claims[kind]?.state === 'asking')) return 'you';
  const prs = issue.closedByPullRequestsReferences;
  const open = (prs?.nodes || []).filter(pr => pr && pr.state === 'OPEN');
  if (open.length || (prs?.totalCount ?? 0) > 0) {
    return open.some(pr => pr.isDraft || pr.reviewDecision === 'CHANGES_REQUESTED') ? 'building' : 'review';
  }
  if (claims.reviewer?.state === 'working') return 'review';
  if (claims.builder?.state === 'working') return 'building';
  if (claims.uncertain || !prs) return 'unknown';
  return labels.includes('ready-for-agent') ? 'ready' : 'waiting';
}

async function gql(githubFetch, token, query, variables) {
  const res = await githubFetch(`${API}/graphql`, {
    method: 'POST',
    body: JSON.stringify({ query, variables }),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`GitHub GraphQL answered ${res.status}`);
  return json;
}

export async function fetchGitHubTruth({ owner, name, token, githubFetch = fetch, now = Date.now() }) {
  const full = `${owner}/${name}`;
  const specSearchQuery = `repo:${full} is:issue state:open (has:sub-issue OR label:spec OR in:title spec) -label:wayfind:map sort:updated-desc`;
  const specsAnswer = await gql(githubFetch, token, SPECS_QUERY, { owner, name, specs: specSearchQuery });
  const repo = specsAnswer.data?.repository || {};
  const fleetText = repo.fleet?.text ?? null;
  const authors = recordAuthors(fleetText);
  const rawSpecs = (specsAnswer.data?.specSearch?.nodes || [])
    .filter(issue => Number.isSafeInteger(issue?.number))
    .filter(issue => {
      const labels = labelNames(issue);
      return !labels.includes('wayfind:map')
        && (issue.subIssuesSummary?.total > 0 || labels.includes('spec') || SPEC_TITLE.test(issue.title || ''));
    });

  const details = {};
  const queue = chunksOf(rawSpecs.slice(0, SPEC_DETAILS).map(s => ({ n: s.number, tickets: Math.min(50, s.subIssuesSummary?.total ?? 50) })));
  while (queue.length) {
    const chunk = queue.shift();
    const ans = await gql(githubFetch, token, specTicketsQuery(chunk), { owner, name });
    const heavy = (ans.errors || []).some(e => e?.type === 'RESOURCE_LIMITS_EXCEEDED');
    if (heavy && chunk.length > 1) {
      queue.unshift(...chunk.map(n => [n]));
      continue;
    }
    const got = ans.data?.repository || {};
    for (const n of chunk) {
      if (got[`s${n}`]) details[`s${n}`] = got[`s${n}`];
    }
  }

  let building = 0;
  let review = 0;
  let merged = 0;
  let openDecisions = 0;
  let unreadableDecisions = 0;
  const liveAskTickets = new Set();

  const specs = rawSpecs.map(issue => {
    const detail = details[`s${issue.number}`] || null;
    const total = issue.subIssuesSummary?.total ?? 0;
    const done = issue.subIssuesSummary?.completed ?? 0;
    merged += done;
    let specOpenDecisions = 0;
    let specUnreadableDecisions = 0;
    for (const comment of detail?.comments?.nodes || []) {
      if (!comment) continue;
      const login = comment.author?.login;
      const by = authors && typeof login === 'string' ? authors.has(login.toLowerCase()) : null;
      if (by === false) continue;
      const read = readDecisionRecord(comment.body, issue.number);
      if (!read) continue;
      if (by === null || read.malformed) specUnreadableDecisions += 1;
      else if (read.record.status === 'open' && (read.record.kind === 'spec_confirmation' || read.record.kind === 'plan_approval')) {
        specOpenDecisions += 1;
      }
    }
    openDecisions += specOpenDecisions;
    unreadableDecisions += specUnreadableDecisions;
    const subNodes = (detail?.subIssues?.nodes || []).filter(Boolean);
    for (const sub of subNodes) {
      const state = ticketState(sub, authors, now);
      if (state === 'building') building += 1;
      if (state === 'review') review += 1;
      const claims = issueClaims(sub, authors, now);
      if (STATUS_KINDS.some(kind => claims[kind]?.state === 'asking')) liveAskTickets.add(sub.number);
    }
    return {
      number: issue.number,
      title: issue.title,
      total,
      done,
      listedSubIssues: subNodes.length,
      openDecisions: specOpenDecisions,
      unreadableDecisions: specUnreadableDecisions,
    };
  });

  const needsInfoIssues = (repo.youIssues?.nodes || []).filter(Boolean)
    .filter(issue => !(labelNames(issue).includes('ready-for-human') && !labelNames(issue).includes('needs-info')));
  const needsInfoNumbers = new Set(needsInfoIssues.map(i => i.number));
  const canvasYouTickets = new Set([...needsInfoNumbers, ...liveAskTickets]);

  const since = new Date(now - DAY_MS - CLOCK_SKEW_MS).toISOString();
  const agentIssues = [];
  let after = null;
  for (let page = 0; page < 40; page += 1) {
    const ans = await gql(githubFetch, token, AGENTS_QUERY, { owner, name, since, after });
    const list = ans.data?.repository?.issues;
    if (!Array.isArray(list?.nodes)) break;
    for (const issue of list.nodes) if (issue) agentIssues.push(issue);
    if (!list.pageInfo?.hasNextPage || typeof list.pageInfo.endCursor !== 'string') break;
    after = list.pageInfo.endCursor;
  }

  let agentsWorkingNow = 0;
  let agentsInLastDay = 0;
  for (const issue of agentIssues) {
    const notes = [];
    for (const comment of issue.comments?.nodes || []) {
      if (!comment) continue;
      const note = readStatusNote(comment.body);
      if (!note) continue;
      const login = comment.author?.login;
      const by = authors && typeof login === 'string' ? authors.has(login.toLowerCase()) : null;
      if (by === false) continue;
      const at = Date.parse(comment.updatedAt) || 0;
      if (by === null || note.unknown || !Number.isSafeInteger(comment.databaseId)) {
        notes.push({ at, holds: false, live: false });
      } else {
        const live = (note.state === 'working' || note.state === 'asking') && recent(at, now);
        notes.push({ at, id: comment.databaseId, agent: note.agent, holds: false, live });
      }
    }
    for (const kind of STATUS_KINDS) {
      const live = notes.filter(n => n.live && n.agent === kind).sort((a, b) => a.id - b.id);
      if (live[0]) live[0].holds = true;
    }
    for (const n of notes) {
      if (n.holds) agentsWorkingNow += 1;
      else if (now - n.at < DAY_MS) agentsInLastDay += 1;
    }
  }

  const needsYou = canvasYouTickets.size + openDecisions;

  return {
    specs,
    needsYou,
    canvasNeedsYou: needsYou + unreadableDecisions,
    building,
    review,
    merged,
    agentsWorkingNow,
    agentsInLastDay,
    models: parseFleetModels(fleetText),
  };
}

async function waitForFeeds(page, waitMs) {
  const end = Date.now() + waitMs;
  while (Date.now() < end) {
    const done = await page.run(`(() => {
      const feeds = Object.values(window.OW?.data?.feeds || {});
      return feeds.length >= 3 && feeds.every(f => f.state !== 'loading' && !f.busy);
    })()`);
    if (done) return;
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('timed out waiting for app feeds to finish loading');
}

async function checkYou(page, truth, pageWaitMs) {
  await page.go(`${SITE}/app/#/you`);
  await page.until(`document.querySelector('main h1')?.textContent.trim() === 'You' && document.querySelectorAll('main .tile').length === 4`, 'You page', pageWaitMs);
  const data = await page.run(`(() => {
    const tiles = Object.fromEntries([...document.querySelectorAll('main .tile')].map(t => [
      t.querySelector('.k')?.textContent.trim() || '',
      t.querySelector('.v')?.textContent.trim() || '',
    ]));
    return { tiles, text: document.querySelector('main')?.innerText || '' };
  })()`);
  const reasons = [];
  const parseTile = raw => Number(String(raw || '').replace(/\+$/, ''));
  const expected = {
    'Needs you': truth.needsYou,
    Building: truth.building,
    'In review': truth.review,
    Merged: truth.merged,
  };
  for (const [label, want] of Object.entries(expected)) {
    const got = parseTile(data.tiles[label]);
    if (got !== want) reasons.push(`${label} shows ${data.tiles[label]} (GitHub expects ${want})`);
  }
  if (/\b(undefined|NaN)\b/.test(data.text)) reasons.push('page leaks undefined or NaN');
  return {
    page: 'You',
    pass: reasons.length === 0,
    detail: reasons.length
      ? reasons.join('; ')
      : `Needs you=${truth.needsYou}, Building=${truth.building}, In review=${truth.review}, Merged=${truth.merged}`,
    reasons,
  };
}

async function checkSpecs(page, truth, pageWaitMs) {
  await page.go(`${SITE}/app/#/specs`);
  await page.until(`document.querySelector('main h1')?.textContent.trim() === 'Specs'`, 'Specs page', pageWaitMs);
  const cards = await page.run(`[...document.querySelectorAll('main .cards a.card[href^="#/specs/"]')].map(a => ({
    number: Number(a.getAttribute('href').replace('#/specs/', '')),
    text: a.innerText,
  }))`);
  const reasons = [];
  if (cards.length !== truth.specs.length) {
    reasons.push(`shows ${cards.length} specs (GitHub has ${truth.specs.length})`);
  }
  const byNum = new Map(cards.map(c => [c.number, c.text]));
  for (const spec of truth.specs) {
    const text = byNum.get(spec.number);
    if (!text) {
      reasons.push(`spec #${spec.number} is missing`);
      continue;
    }
    if (spec.total > 0) {
      if (/no tickets yet/i.test(text)) reasons.push(`spec #${spec.number} shows "No tickets yet" while GitHub counts ${spec.total} tickets`);
      else if (!text.includes(`${spec.done} of ${spec.total} tickets done`)) {
        reasons.push(`spec #${spec.number} does not show "${spec.done} of ${spec.total} tickets done"`);
      }
    }
  }
  return {
    page: 'Specs',
    pass: reasons.length === 0,
    detail: reasons.length ? reasons.join('; ') : `${truth.specs.length} specs match GitHub`,
    reasons,
  };
}

async function checkAgents(page, truth, pageWaitMs) {
  await page.go(`${SITE}/app/#/agents`);
  await page.until(`document.querySelector('main h1')?.textContent.trim() === 'Agents' && document.querySelectorAll('main h2').length >= 2`, 'Agents page', pageWaitMs);
  const sections = await page.run(`(() => {
    const out = {};
    for (const h2 of document.querySelectorAll('main h2')) {
      const next = h2.nextElementSibling;
      out[h2.textContent.trim()] = next?.classList.contains('cards') ? next.querySelectorAll('article.card').length : 0;
    }
    return out;
  })()`);
  const reasons = [];
  if ((sections['Working now'] ?? 0) !== truth.agentsWorkingNow) {
    reasons.push(`Working now shows ${sections['Working now'] ?? 0} (GitHub has ${truth.agentsWorkingNow})`);
  }
  if ((sections['In the last day'] ?? 0) !== truth.agentsInLastDay) {
    reasons.push(`In the last day shows ${sections['In the last day'] ?? 0} (GitHub has ${truth.agentsInLastDay})`);
  }
  return {
    page: 'Agents',
    pass: reasons.length === 0,
    detail: reasons.length ? reasons.join('; ') : `${truth.agentsWorkingNow} working now, ${truth.agentsInLastDay} in the last day`,
    reasons,
  };
}

async function checkCanvas(page, truth, pageWaitMs) {
  await page.go(`${SITE}/app/#/canvas`);
  await page.until(`document.querySelector('main h1')?.textContent.trim() === 'Canvas' && document.querySelector('main .cv')`, 'Canvas page', pageWaitMs);
  const hasQuiet = await page.run(`Boolean(document.querySelector('.cv-rail button.cv-quiet'))`);
  if (hasQuiet) {
    await page.run(`document.querySelector('.cv-rail button.cv-quiet').click()`);
  }
  const overview = await page.run(`(() => {
    const inboxEl = document.querySelector('.cv-inbox');
    const inboxLabel = document.querySelector('.cv-inbox-label')?.textContent.trim() || '';
    const sheets = [...document.querySelectorAll('.cv-rail a.cv-sheet[data-sheet]')].map(a => ({
      number: Number(a.dataset.sheet),
      line: a.querySelector('.cv-sheet-line')?.textContent.trim() || '',
    }));
    return { inboxText: inboxEl?.innerText.trim() || '', inboxLabel, sheets };
  })()`);
  const reasons = [];
  if (truth.canvasNeedsYou > 0) {
    const want = `Needs you · ${truth.canvasNeedsYou}`;
    if (!overview.inboxLabel.includes(want)) {
      reasons.push(`Needs you strip shows "${overview.inboxLabel || overview.inboxText}" (GitHub expects "${want}")`);
    }
  } else if (/Needs you\s*·\s*[1-9]/.test(overview.inboxLabel)) {
    reasons.push(`Needs you strip shows "${overview.inboxLabel}" (GitHub expects 0)`);
  }
  if (overview.sheets.length !== truth.specs.length) {
    reasons.push(`rail shows ${overview.sheets.length} sheets (GitHub has ${truth.specs.length} specs)`);
  }
  const sheetByNum = new Map(overview.sheets.map(s => [s.number, s.line]));
  for (const spec of truth.specs) {
    const line = sheetByNum.get(spec.number);
    if (line === undefined) {
      reasons.push(`sheet #${spec.number} is missing from rail`);
      continue;
    }
    if (spec.total > 0) {
      if (/no tickets/i.test(line)) reasons.push(`rail sheet #${spec.number} says "${line}" while GitHub counts ${spec.total} tickets`);
      else if (!line.includes(`${spec.done} of ${spec.total} done`)) {
        reasons.push(`rail sheet #${spec.number} line "${line}" disagrees with "${spec.done} of ${spec.total} done"`);
      }
    }
  }
  for (const spec of truth.specs.filter(s => s.total > 0).slice(0, 5)) {
    await page.go(`${SITE}/app/#/canvas/${spec.number}`);
    await page.until(`document.querySelector('.cv-title')?.innerText.includes('#${spec.number}')`, `Canvas sheet #${spec.number}`, pageWaitMs);
    const stage = await page.run(`(() => ({
      text: document.querySelector('.cv-stage')?.innerText || '',
      stacks: document.querySelectorAll('.cv-board .cv-stack:not(.outside)').length,
    }))()`);
    if (/no tickets yet/i.test(stage.text)) {
      reasons.push(`spec #${spec.number} shows "No tickets yet" while GitHub counts ${spec.total} tickets`);
    } else if (spec.listedSubIssues > 0 && stage.stacks !== spec.listedSubIssues) {
      reasons.push(`spec #${spec.number} board renders ${stage.stacks} tickets (GitHub lists ${spec.listedSubIssues})`);
    }
  }
  return {
    page: 'Canvas',
    pass: reasons.length === 0,
    detail: reasons.length ? reasons.join('; ') : `${truth.specs.length} sheets, Needs you=${truth.canvasNeedsYou}, boards match GitHub`,
    reasons,
  };
}

async function checkModels(page, truth, pageWaitMs) {
  await page.go(`${SITE}/app/#/models`);
  await page.until(`document.querySelector('main h1')?.textContent.trim() === 'Models' && !document.querySelector('main')?.innerText.includes('Reading GitHub')`, 'Models page', pageWaitMs);
  const view = await page.run(`(() => ({
    text: document.querySelector('main')?.innerText || '',
    roles: Object.fromEntries([...document.querySelectorAll('.models .cards .card')].map(card => {
      const key = [...card.classList].find(c => c !== 'card') || '';
      return [key, card.querySelector('.num')?.textContent.trim() || ''];
    })),
  }))()`);
  const reasons = [];
  if (!truth.models.hasFleet) {
    if (!/no docs\/agents\/fleet\.md/i.test(view.text)) reasons.push('missing fleet.md did not show unknown notice');
  } else if (truth.models.roles) {
    for (const [role, want] of Object.entries(truth.models.roles)) {
      const got = view.roles[role];
      if (got !== want) reasons.push(`role ${role} shows "${got || 'missing'}" (fleet.md has "${want}")`);
    }
  } else if (!/couldn't be read/i.test(view.text)) {
    reasons.push('unreadable fleet.md models did not show unknown notice');
  }
  return {
    page: 'Models',
    pass: reasons.length === 0,
    detail: reasons.length ? reasons.join('; ') : (truth.models.roles ? '5 roles match docs/agents/fleet.md' : 'fleet.md state matches GitHub'),
    reasons,
  };
}

export function formatResults(result) {
  return result.pages.map(p => `${p.pass ? 'PASS' : 'FAIL'} ${p.page}: ${p.detail}`).join('\n');
}

export async function runLiveCheck({
  repo,
  token,
  prod = false,
  waitMs = 45000,
  pageWaitMs = 8000,
  githubFetch = fetch,
  siteTransform = null,
  onPage = null,
} = {}) {
  const [owner, name] = String(repo || '').split('/');
  if (!owner || !name) throw new Error('repo must be owner/name');
  if (!token) throw new Error('token is required (set GH_TOKEN or GITHUB_TOKEN)');

  const truth = await fetchGitHubTruth({ owner, name, token, githubFetch });
  const world = new LiveWorld({ owner, name, token, prod, githubFetch, siteTransform });
  const run = await start(world);
  const pages = [];
  let tokenLeaked = false;

  try {
    await signIn(run.page).catch(() => {});
    await run.page.until(`document.body.innerText.includes(${JSON.stringify(`${owner}/${name}`)})`, 'repository picker', 15000);
    await run.page.click(`${owner}/${name}`);
    await run.page.until(`document.querySelector('nav a[aria-current="page"]')`, 'app shell', 15000);
    await waitForFeeds(run.page, waitMs);

    const checkers = [
      ['You', checkYou],
      ['Specs', checkSpecs],
      ['Agents', checkAgents],
      ['Canvas', checkCanvas],
      ['Models', checkModels],
    ];
    for (const [pageName, fn] of checkers) {
      let res;
      try {
        res = await fn(run.page, truth, pageWaitMs);
        if (onPage) await onPage(run.page, pageName, res);
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        const detail = raw.split('\n')[0].trim();
        res = { page: pageName, pass: false, detail, reasons: [detail] };
      }
      pages.push(res);
    }

    const storageDump = await run.page.run(`JSON.stringify({
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
      cookie: document.cookie,
    })`);
    if (storageDump.includes(token) || world.browserSawRealToken) tokenLeaked = true;
  } finally {
    await run.close();
  }

  const ok = pages.every(p => p.pass) && !tokenLeaked && world.violations.length === 0;
  return {
    ok,
    repo: `${owner}/${name}`,
    pages,
    refusedWrites: world.refusedWrites,
    violations: world.violations,
    tokenLeaked,
    truth,
  };
}

function parseArgs(argv) {
  const opts = {
    repo: process.env.REPO || '',
    prod: Boolean(process.env.PROD),
    waitMs: Number(process.env.WAIT || 45000),
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo' && argv[i + 1]) opts.repo = argv[++i];
    else if (arg === '--prod') opts.prod = true;
    else if (arg === '--wait' && argv[i + 1]) opts.waitMs = Number(argv[++i]);
    else if (arg === '--json') opts.json = true;
  }
  return opts;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const result = await runLiveCheck({ ...opts, token });
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatResults(result));
  if (result.tokenLeaked) console.error('FAIL security: real token leaked to browser');
  if (result.violations.length) console.error(`FAIL violations: ${result.violations.join(' | ')}`);
  process.exit(result.ok ? 0 : 1);
}
