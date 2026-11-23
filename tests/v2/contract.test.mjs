import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

const ROOT = new URL('../../', import.meta.url);
const FORMS = new URL('tests/v2/fixtures/forms/', ROOT);
const REFUSED = new URL('refused/', FORMS);
const ACCEPTED = new URL('accepted/', FORMS);
const QUEUE = new URL('tests/v2/fixtures/queue/', ROOT);
const POSTS = new URL('tests/v2/fixtures/posts/', ROOT);
const read = async url => readFile(url, 'utf8');
const json = async url => JSON.parse(await read(url));
const contract = await read(new URL('contracts/app-records.v1.md', ROOT)).catch(() => '');

function section(heading) {
  const lines = contract.split('\n');
  const start = lines.findIndex(line => line === heading);
  assert.ok(start >= 0, `the contract has no "${heading}" section`);
  const end = lines.findIndex((line, i) => i > start && /^#+ /.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}
function table(heading) {
  const rows = section(heading).filter(line => line.startsWith('|'));
  assert.ok(rows.length > 2, `the contract's "${heading}" section has no table`);
  const cells = line => line.slice(1, -1).split(' | ').map(cell => cell.trim());
  const head = cells(rows[0]);
  return rows.slice(2).map(line => Object.fromEntries(cells(line).map((cell, i) => [head[i], cell])));
}
const code = cell => [...cell.matchAll(/`([^`]+)`/g)].map(m => m[1]);
function block(heading) {
  const text = section(heading).join('\n');
  const found = text.match(/```text\n([\s\S]*?)\n```/);
  assert.ok(found, `the contract's "${heading}" section has no text block`);
  return found[1];
}

const decisionForms = () => table('### Decision answers');
const steerForms = () => table('### Spec steers');
const formNames = () => [...new Set([...decisionForms(), ...steerForms()].map(row => code(row.Form)[0]))];
const fixtureName = form => form.replace('.', '-');

function path(value, from) {
  return from.split('.').reduce((at, key) => at?.[key], value);
}
function context(action) {
  const kind = action.item.request.kind;
  const row = table('### Context line').find(r => code(r['Request kind'])[0] === kind);
  assert.ok(row, `no context line for ${kind}`);
  const from = Object.fromEntries(table('### Context values').map(r => [code(r.Key)[0], code(r.From).filter(s => s.startsWith('action.'))]));
  const out = {};
  for (const key of code(row['Keys, in order'])) {
    assert.ok(from[key], `no source for context key ${key}`);
    const sources = from[key];
    out[key] = sources.length === 1 ? path({ action }, sources[0])
      : Object.fromEntries(sources.map(s => [s.split('.').pop(), path({ action }, s)]));
  }
  return JSON.stringify(out);
}
function fill(template, action) {
  return template.replace(/<(question_id|spec|words)>/g, (_, name) => String(
    name === 'question_id' ? action.question_id : name === 'spec' ? action.item.request.spec : action.words));
}
function bodyOf(action) {
  if (action.item.type === 'spec') return fill(code(steerForms().find(r => code(r.Form)[0] === action.form).Body)[0], action);
  const row = decisionForms().find(r => code(r.Form)[0] === action.form && code(r['Request kind'])[0] === action.item.request.kind);
  const segment = fill(code(row['Answer segment'])[0], action);
  return block('### Decision answers').replace('<context>', context(action)).replace('<answer segment>', segment);
}

function fieldsOf(action) {
  const row = table('### Action fields').find(r => code(r.Form).includes(action.form));
  if (!row) return null;
  const fields = code(row.Fields);
  return action.item?.request?.kind === 'grill_round' && code(row['For grill_round']).length
    ? [...fields, ...code(row['For grill_round'])] : fields;
}
function tokens(body) {
  const out = [];
  for (let at = body.indexOf('"'); at >= 0; at = body.indexOf('"', at + 1)) {
    const found = body.slice(at).match(/^"(?:[^"\\\u0000-\u001f]|\\[^])*"/);
    if (found) out.push(found[0]);
  }
  return out;
}
const SHORT = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
function decoded(token) {
  try { return JSON.parse(token); } catch {
    return token.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|[^])/g, (all, e) => e.length === 5 ? String.fromCharCode(parseInt(e.slice(1), 16)) : SHORT[e] ?? all);
  }
}
function refusedLine(body) {
  const markers = table('### Refused forms').map(r => ({ marker: code(r.Marker)[0], where: r.Where }));
  return markers.some(({ marker, where }) => (where.startsWith('anywhere') ? body.includes(marker)
    : body.split(/\r\n|\r|\n/).some(line => line.replace(/^[ \t]+/, '').startsWith(marker)))
    || (where.includes('in a decoded string') && tokens(body).some(token => decoded(token).startsWith(marker))));
}
const RISKS = ['ordinary', 'live', 'release', 'publish'];
function limit() {
  const row = table('## Refusals').find(r => code(r.Reason)[0] === 'too_long');
  return Number(row.When.match(/(\d[\d,]*) /)[1].replace(/,/g, ''));
}
const CHECKS = {
  not_a_form: ({ action }) => {
    const card = action.form?.split('.')[0];
    const fields = formNames().includes(action.form) ? fieldsOf(action) : null;
    return !fields || card !== action.item?.type || Object.keys(action).sort().join() !== [...fields].sort().join();
  },
  other_repository: ({ action, picked }) => action.item.repository !== picked.full,
  unreadable: ({ action }) => action.item.type === 'decision' && !action.item.request,
  not_open: ({ action }) => action.item.type === 'decision' && action.item.request.status !== 'open',
  not_current: ({ action }) => action.item.type === 'decision' && action.item.current !== true,
  risk_unknown: ({ action }) => action.item.type === 'decision' && !RISKS.includes(action.item.request.risk),
  answered: ({ action }) => {
    const request = action.item.request;
    if (request?.kind !== 'grill_round') return false;
    return !request.questions.some(q => q.id === action.question_id) || request.answered.includes(action.question_id);
  },
  empty: ({ action }) => 'words' in action && (typeof action.words !== 'string' || !/\S/.test(action.words)),
  refused_form: ({ action }) => refusedLine(bodyOf(action)),
  too_long: ({ action }) => bodyOf(action).length > limit(),
  source_changed: input => input.action.item.type === 'decision' && sourceOf(input).result === 'changed',
  source_unchecked: input => input.action.item.type === 'decision' && sourceOf(input).result === 'unchecked',
};
// Recorded GitHub answers: keys are `METHOD /path?query`, exactly as the app asks.
function recorded(github) {
  const world = { requests: 0, github };
  world.get = path => {
    world.requests += 1;
    const reply = world.github[`GET ${path}`];
    return reply ? { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: reply.json, next: !!reply.next }
      : { ok: false, status: 404 };
  };
  return world;
}
function pages(world, path) {
  const items = [];
  for (let page = 1; page <= 10; page += 1) {
    const got = world.get(`${path}&page=${page}`);
    if (!got.ok || !Array.isArray(got.json)) return { items, complete: false };
    items.push(...got.json);
    if (!got.next) return { items, complete: true };
  }
  return { items, complete: false };
}
const sha256 = text => createHash('sha256').update(text).digest('hex');
const AUTHORS = new Set(['factory-bot[bot]']);
function recordAuthors(text) {
  const section = String(text).split(/^## /m).find(part => part.startsWith('GitHub identity\n'));
  const row = section?.split('\n').find(line => /^\|\s*Record authors\s*\|/.test(line));
  return row ? new Set([...row.split('|')[2].matchAll(/`([^`]*)`/g)].map(m => m[1].toLowerCase())) : null;
}

// decisions.v1 request records, with the grill variants this contract's grill read adds.
const QUESTION = /^[A-Z]{1,2}[1-9][0-9]*$/;
const GRILL_FILE = /^docs\/grills\/[A-Za-z0-9][A-Za-z0-9_.-]*\.md$/;
const COMMON = ['schema', 'kind', 'id', 'status', 'fingerprint', 'risk'];
const KEYS = {
  grill_round: [...COMMON, 'grill_file', 'round', 'questions', 'answered'],
  grill_confirmation: [...COMMON, 'grill_file', 'summary'],
  spec_confirmation: [...COMMON, 'spec', 'summary', 'headline', 'tickets', 'graph'],
  plan_approval: [...COMMON, 'spec', 'summary', 'headline', 'tickets', 'graph'],
};
const exactly = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join() === [...keys].sort().join();
const text = value => typeof value === 'string' && value.length > 0;
const lines = value => Array.isArray(value) && value.length >= 1 && value.length <= 10 && value.every(l => text(l) && !/[\r\n]/.test(l));
function readRecord(body) {
  const raw = String(body);
  const blocks = [...raw.matchAll(/^```json\n([\s\S]*?)\n```$/gm)].map(m => m[1]);
  const marked = raw.includes('openwiz.decisions.') || tokens(raw).some(t => decoded(t).startsWith('openwiz.decisions.'));
  if (!marked) return null;
  let r;
  try { r = blocks.length === 1 ? JSON.parse(blocks[0]) : undefined; } catch { r = undefined; }
  const keys = typeof r?.kind === 'string' && Object.hasOwn(KEYS, r.kind) ? KEYS[r.kind] : null;
  if (!keys || !exactly(r, keys) || r.schema !== 'openwiz.decisions.v1' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(r.id)
    || !['open', 'resolved', 'superseded'].includes(r.status) || !/^[0-9a-f]{64}$/.test(r.fingerprint)
    || ![...RISKS, 'unknown'].includes(r.risk)) return { malformed: true };
  if (r.kind === 'grill_round') {
    const ids = Array.isArray(r.questions) ? r.questions.map(q => q?.id) : [];
    const ok = GRILL_FILE.test(r.grill_file) && Number.isSafeInteger(r.round) && r.round > 0 && ids.length >= 1 && ids.length <= 3
      && r.questions.every(q => exactly(q, ['id', 'decides', 'context', 'recommendation']) && QUESTION.test(q.id)
        && text(q.decides) && text(q.context) && text(q.recommendation))
      && new Set(ids).size === ids.length && Array.isArray(r.answered)
      && r.answered.every((id, i) => ids.includes(id) && (i === 0 || ids.indexOf(r.answered[i - 1]) < ids.indexOf(id)));
    return ok ? { record: r } : { malformed: true };
  }
  if (r.kind === 'grill_confirmation') return GRILL_FILE.test(r.grill_file) && lines(r.summary) ? { record: r } : { malformed: true };
  return Number.isSafeInteger(r.spec) && lines(r.summary) && text(r.headline) && Array.isArray(r.tickets) && Array.isArray(r.graph)
    ? { record: r } : { malformed: true };
}

// grill's latest() (skills/grill/scripts/records.py in WizSkills): the saved proposal a grill request must equal.
function latest(source) {
  if (!source.startsWith('# Grill: ') || source.includes('\r')) throw new Error('unreadable saved grill');
  let selected = null;
  let previous = 0;
  for (const section of source.split(/^## /m).slice(1)) {
    const [heading, ...rest] = section.split('\n');
    if (heading.startsWith('Round ')) {
      const m = heading.match(/^Round ([1-9][0-9]*)$/);
      if (!m || Number(m[1]) <= previous) throw new Error('unreadable saved round order');
      previous = Number(m[1]);
      selected = { kind: 'grill_round', round: previous, rest };
    } else if (heading.startsWith('Summary')) {
      if (!/^Summary(?:, corrected)?(?: \(shown to .+ for confirmation\))?$/.test(heading)) throw new Error('unreadable saved summary heading');
      selected = { kind: 'grill_confirmation', rest };
    }
  }
  if (!selected || !selected.rest.length) throw new Error('no saved round or summary');
  const first = selected.rest[0];
  const risk = first.startsWith('Risk: ') && RISKS.includes(first.slice(6)) ? first.slice(6) : 'unknown';
  const wording = first.startsWith('Risk:') ? selected.rest.slice(1) : selected.rest;
  if (wording.some(l => /^(Risk:|```|~~~)/.test(l.trimStart()))) throw new Error('ambiguous saved risk or wording');
  const proposal = [];
  for (const line of wording) { if (line.startsWith('**') && line.endsWith(':**')) break; proposal.push(line); }
  if (selected.kind === 'grill_confirmation') {
    const summary = [];
    for (const line of proposal.filter(Boolean)) {
      const prefix = `${summary.length + 1}. `;
      if (!line.startsWith(prefix) || line.length === prefix.length) throw new Error('unreadable saved summary');
      summary.push(line.slice(prefix.length));
    }
    return { kind: selected.kind, risk, summary };
  }
  const questions = [];
  let pending = null;
  for (const line of proposal) {
    if (!pending) {
      if (!line) continue;
      const m = line.match(/^\*\*([A-Z]{1,2}[1-9][0-9]*)(?:, re-asked)? - (.+?)\*\* (.*)$/);
      if (!m) throw new Error('unreadable saved question');
      pending = { id: m[1], decides: m[2], context: m[3] };
    } else if (line.startsWith('➡️ ')) {
      questions.push({ ...pending, recommendation: line.slice(3) });
      pending = null;
    } else pending.context += `\n${line}`;
  }
  if (pending || questions.length < 1 || questions.length > 3) throw new Error('expected one to three saved questions');
  return { kind: selected.kind, risk, round: selected.round, questions };
}

// revision-v2 text, as skills/to-tickets/revision.sh in WizSkills prints it.
const untick = body => `${body}\n`.split('\n').map(l => l.replace(/^([ \t]*[-*+][ \t]+)\[[xX]\]$/, '$1[ ]')
  .replace(/^([ \t]*[-*+][ \t]+)\[[xX]\]([ \t\r])/, '$1[ ]$2')).join('\n');
const headline = body => {
  const section = String(body ?? '').split(/^## /m).find(part => part.startsWith('Changelog headline\n'));
  return section?.split('\n').slice(1).find(line => line.trim()) ?? null;
};

function sourceCheck(item, world, authors) {
  const R = `/repos/${item.repository}`;
  const r = item.request;
  const comment = world.get(`${R}/issues/comments/${item.comment_id}`);
  if (!comment.ok) return { result: 'unchecked' };
  let fine = comment.json.issue_url?.endsWith(`/issues/${item.subject.number}`)
    && authors.has(String(comment.json.user?.login).toLowerCase());
  const read = readRecord(comment.json.body);
  fine = fine && !!read?.record && assertDeep(read.record, r);
  let binding;
  if (r.kind === 'grill_round' || r.kind === 'grill_confirmation') {
    const pull = world.get(`${R}/pulls/${item.subject.number}`);
    if (!pull.ok) return { result: 'unchecked' };
    const file = world.get(`${R}/contents/${r.grill_file}?ref=${pull.json.head.sha}`);
    if (!file.ok || file.json.encoding !== 'base64') return { result: 'unchecked' };
    const bytes = Buffer.from(file.json.content, 'base64');
    let saved;
    try { saved = latest(bytes.toString('utf8')); } catch { return { result: 'unchecked' }; }
    const want = r.kind === 'grill_round' ? { kind: r.kind, risk: r.risk, round: r.round, questions: r.questions }
      : { kind: r.kind, risk: r.risk, summary: r.summary };
    fine = fine && pull.json.state === 'open' && pull.json.head.repo.full_name === item.repository && assertDeep(saved, want);
    binding = { ref: pull.json.head.sha, digest: sha256(bytes) };
  } else {
    const spec = world.get(`${R}/issues/${r.spec}`);
    if (!spec.ok) return { result: 'unchecked' };
    fine = fine && spec.json.state === 'open' && headline(spec.json.body) === r.headline;
    binding = { ref: 'issue', digest: sha256(spec.json.body) };
    if (r.kind === 'plan_approval') {
      const subs = pages(world, `${R}/issues/${r.spec}/sub_issues?per_page=100`);
      if (!subs.complete) return { result: 'unchecked' };
      const tickets = [];
      for (const t of [...subs.items].sort((a, b) => a.number - b.number)) {
        const by = pages(world, `${R}/issues/${t.number}/dependencies/blocked_by?per_page=100`);
        if (!by.complete) return { result: 'unchecked' };
        tickets.push({ ...t, blockers: by.items.map(b => b.number).sort((a, b) => a - b) });
      }
      const revision = ['plan-graph revision v2', `spec #${r.spec} body sha256 ${sha256(untick(spec.json.body))}`,
        ...tickets.map(t => `ticket #${t.number} blocked-by ${t.blockers.map(b => `#${b}`).join(' ') || 'none'} body sha256 ${sha256(untick(t.body))} title ${t.title}`)]
        .join('\n') + '\n';
      fine = fine && assertDeep(tickets.map(({ number, title, blockers }) => ({ number, title, blockers })), r.tickets)
        && sha256(revision) === r.fingerprint;
      binding = { ref: 'revision-v2', digest: sha256(revision) };
    }
  }
  return fine ? { result: 'matched', binding } : { result: 'changed' };
}
function assertDeep(a, b) {
  try { assert.deepStrictEqual(a, b); return true; } catch { return false; }
}
const checked = new WeakMap();
function sourceOf(input) {
  if (!checked.has(input)) checked.set(input, sourceCheck(input.action.item, recorded(input.github || {}), AUTHORS));
  return checked.get(input);
}

function compose(input) {
  for (const row of table('## Refusals')) {
    const reason = code(row.Reason)[0];
    assert.ok(CHECKS[reason], `the contract names a refusal this test can't check: ${reason}`);
    if (CHECKS[reason](input)) return { refused: reason };
  }
  return { body: bodyOf(input.action) };
}

const names = async url => (await readdir(url)).filter(n => n.endsWith('.input.json')).map(n => n.slice(0, -'.input.json'.length)).sort();

test('every card action in the contract has exactly one form with its source cited', () => {
  const rows = [...decisionForms(), ...steerForms()];
  const keys = rows.map(r => `${code(r.Form)[0]} ${code(r['Request kind'] || '')[0] || ''}`);
  assert.equal(new Set(keys).size, keys.length, 'a form is listed twice');
  for (const r of rows) assert.ok(r.Source && r.Source.length > 3, `no source for ${r.Form}`);
  for (const r of steerForms()) assert.ok(r['Goes on'], `no subject for ${r.Form}`);
  const kinds = ['grill_round', 'grill_confirmation', 'spec_confirmation', 'plan_approval'];
  for (const form of ['decision.yes', 'decision.no', 'decision.own']) {
    assert.deepEqual(decisionForms().filter(r => code(r.Form)[0] === form).map(r => code(r['Request kind'])[0]).sort(), [...kinds].sort(), form);
  }
  assert.deepEqual(steerForms().map(r => code(r.Form)[0]).sort(), ['spec.change', 'spec.not_now', 'spec.ship']);
});

test('every form has one fixture, and every fixture body matches the forms table byte for byte', async () => {
  const fixtures = await names(FORMS);
  const expected = [...decisionForms().map(r => `${fixtureName(code(r.Form)[0])}-${code(r['Request kind'])[0]}`),
    ...steerForms().map(r => fixtureName(code(r.Form)[0]))].sort();
  assert.deepEqual(fixtures, expected);
  for (const name of fixtures) {
    const input = await json(new URL(`${name}.input.json`, FORMS));
    const body = await json(new URL(`${name}.body.json`, FORMS));
    assert.deepEqual(compose(input), { body }, name);
  }
});

test('every refused fixture is refused for the reason the contract gives, first in its order', async () => {
  const fixtures = await names(REFUSED);
  assert.ok(fixtures.length > 0, 'no refused fixtures');
  const reasons = new Set();
  for (const name of fixtures) {
    const input = await json(new URL(`${name}.input.json`, REFUSED));
    const reason = await json(new URL(`${name}.refused.json`, REFUSED));
    assert.deepEqual(compose(input), { refused: reason }, name);
    reasons.add(reason);
  }
  table('## Refusals').forEach((row, i) => assert.equal(row.Order, String(i + 1), `refusal ${row.Reason} is out of order`));
  for (const row of table('## Refusals')) assert.ok(reasons.has(code(row.Reason)[0]), `no refused fixture for ${row.Reason}`);
  const marked = table('### Refused forms').map(r => code(r.Marker)[0]);
  for (const marker of marked) {
    let seen = false;
    for (const name of fixtures) {
      const { action } = await json(new URL(`${name}.input.json`, REFUSED));
      if (typeof action.words === 'string' && action.words.includes(marker)) seen = true;
    }
    assert.ok(seen, `no refused fixture writes ${marker}`);
  }
});

test('fixtures are synthetic: only the synthetic acme repositories and example numbers', async () => {
  for (const dir of [FORMS, REFUSED, ACCEPTED, QUEUE, POSTS]) {
    for (const name of (await readdir(dir)).filter(n => n.endsWith('.json'))) {
      const text = await read(new URL(name, dir));
      for (const repo of text.matchAll(/(?<!api\.)github\.com\/([^/"\s]+)\//g)) assert.equal(repo[1], 'acme', `${name}: ${repo[0]}`);
      for (const repo of text.matchAll(/(?:api\.github\.com|"GET |"POST )\/repos\/([^/"\s]+)\//g)) assert.equal(repo[1], 'acme', `${name}: ${repo[0]}`);
      for (const id of text.matchAll(/"(?:comment_id|id)": (\d{6,})/g)) assert.match(id[1], /^91000\d\d$/, name);
      for (const login of text.matchAll(/"login": "([^"]+)"/g)) assert.match(login[1], /^(acme-[a-z]+|factory-bot\[bot\]|helpful-collaborator)$/, name);
    }
  }
});

test('accepted bodies with JSON escapes are written verbatim, never decoded', async () => {
  const fixtures = await names(ACCEPTED);
  assert.ok(fixtures.length > 0, 'no accepted fixtures');
  for (const name of fixtures) {
    const input = await json(new URL(`${name}.input.json`, ACCEPTED));
    const body = await json(new URL(`${name}.body.json`, ACCEPTED));
    assert.ok(body.includes('\\'), `${name} has no escape to keep`);
    assert.deepEqual(compose(input), { body }, name);
  }
});

// The grill pull request read ("### Grill pull requests") and the queue's currentness, over recorded answers.
function grillQueue(fx, world, now) {
  assert.ok(section('### Grill pull requests').length > 3, 'the contract names no grill pull request read');
  const repository = fx.picked.full;
  const authors = recordAuthors(fx.fleet);
  const items = [];
  const gaps = new Set();
  const pulls = pages(world, `/repos/${repository}/pulls?state=open&per_page=100`);
  if (!pulls.complete) gaps.add('pulls');
  for (const pull of pulls.items.filter(p => p.head?.repo?.full_name === repository)) {
    const comments = pages(world, `/repos/${repository}/issues/${pull.number}/comments?per_page=100`);
    if (!comments.complete) gaps.add(pull.number);
    const records = [];
    for (const c of comments.items) {
      if (authors && !authors.has(String(c.user?.login).toLowerCase())) continue;
      const read = readRecord(c.body);
      if (!read) continue;
      const grill = read.record && (read.record.kind === 'grill_round' || read.record.kind === 'grill_confirmation');
      records.push({ c, request: authors && grill ? read.record : null });
    }
    for (const { c, request } of records) {
      const item = { type: 'decision', key: `decision:${repository}#${pull.number}:${c.id}`, repository,
        subject: { kind: 'pull_request', number: pull.number }, title: pull.title, url: c.html_url, comment_id: c.id,
        at: Date.parse(c.created_at), current: null, checked_at: null, request };
      const later = request && records.some(o => o.request && Date.parse(o.c.created_at) > item.at && o.request.kind === request.kind
        && o.request.grill_file === request.grill_file);
      if (request && later) item.current = false;
      else if (request && comments.complete && request.status === 'open') {
        const check = sourceCheck(item, world, authors);
        if (check.result === 'unchecked') gaps.add(pull.number);
        else Object.assign(item, { current: check.result === 'matched', checked_at: now });
      }
      items.push(item);
    }
  }
  items.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1));
  return { items, gaps: [...gaps] };
}

test('the queue reads grill pull requests, and current rests on a fresh source check in the latest refresh', async () => {
  const cases = (await readdir(QUEUE)).filter(n => n.endsWith('.json'));
  for (const want of ['grill-round.json', 'grill-summary.json', 'grill-round-edited.json', 'grill-refresh-failed.json']) assert.ok(cases.includes(want), want);
  assert.match(section('### Items').join('\n'), /A failed refresh never keeps an earlier `true`/);
  for (const name of cases) {
    const fx = await json(new URL(name, QUEUE));
    for (const [i, refresh] of fx.refreshes.entries()) {
      const world = recorded(refresh.github);
      assert.deepEqual(grillQueue(fx, world, fx.now), { items: refresh.items, gaps: refresh.gaps }, `${name}, refresh ${i + 1}`);
      const keys = [...block('### Items').match(/^\{ type: 'decision'[\s\S]*?\}$/m)[0].replace(/\{ kind[^}]*\}|<[^>]*>/g, '')
        .matchAll(/(?:^\s*|[{,]\s*)([a-z_]+)\b/gm)].map(m => m[1]).filter(k => k !== 'type');
      for (const item of refresh.items) assert.deepEqual(Object.keys(item).filter(k => k !== 'type').sort(), [...new Set(keys)].sort(), `${name}: item keys`);
    }
  }
});

// OW.records as the contract's "Interfaces" section specifies it, run over recorded post sequences.
function confirmsFor(preview, item) {
  const rows = table('### Confirmation');
  const row = item.type === 'spec' ? rows.find(r => r.Risk === 'a spec steer') : rows.find(r => code(r.Risk).includes(item.request.risk));
  return Number(row['Confirms before the send'].match(/^\d/)[0]);
}
function storageKey(id) {
  const found = section('### Operation id').join('\n').match(/`(openwiz\.app\.v2\.receipts\.)<user id>`/);
  assert.ok(found, 'the contract names no per-account receipts key');
  return `${found[1]}${id}`;
}
function makeRecords({ browser, account, picked, world }) {
  const issued = new WeakMap();
  const used = new WeakSet();
  const inflight = new Map();
  const key = storageKey(account.id);
  const all = () => JSON.parse(browser.storage.get(key) || '{}');
  const save = (op, receipt) => browser.storage.set(key, JSON.stringify({ ...all(), [op]: receipt }));
  const refused = (op, reason) => ({ outcome: 'refused', op, reason });
  const issue = (preview, item) => { issued.set(preview, { snapshot: JSON.stringify(preview), item, confirmed: 0 }); return preview; };
  async function send(preview, state) {
    const receipt = all()[preview.op];
    const path = `/repos/${preview.repository}/issues/${preview.subject.number}/comments`;
    if (receipt?.state === 'unknown') {
      const list = pages(world, `${path}?per_page=100`);
      const claimed = new Set(Object.values(all()).map(r => r.comment?.id).filter(Boolean));
      const found = list.items.find(c => c.user?.id === account.id && c.body === preview.body && !claimed.has(c.id)
        && Date.parse(c.created_at) >= receipt.sent_at - 5 * 60 * 1000);
      if (found) {
        const outcome = { outcome: 'posted', op: preview.op, comment: { id: found.id, url: found.html_url } };
        save(preview.op, { ...receipt, state: 'posted', comment: outcome.comment });
        return outcome;
      }
      if (!list.complete) return { outcome: 'unknown', op: preview.op, reason: 'incomplete' };
    }
    const sent_at = world.now;
    save(preview.op, { op: preview.op, body: preview.body, repository: preview.repository, subject: preview.subject, source: preview.source,
      item: state.item, preview, state: 'sending', sent_at });
    const answer = world.post(path, preview.body, account);
    if (answer.ok) {
      const comment = { id: answer.json.id, url: answer.json.html_url };
      save(preview.op, { ...all()[preview.op], state: 'posted', comment });
      return { outcome: 'posted', op: preview.op, comment };
    }
    if (answer.status >= 400 && answer.status < 500) {
      save(preview.op, { ...all()[preview.op], state: 'refused' });
      return refused(preview.op, 'github');
    }
    save(preview.op, { ...all()[preview.op], state: 'unknown' });
    return { outcome: 'unknown', op: preview.op, reason: 'network' };
  }
  return {
    compose(action) {
      const input = { picked, action, github: world.github };
      for (const row of table('## Refusals')) {
        const reason = code(row.Reason)[0];
        if (CHECKS[reason](input)) return { refused: reason };
      }
      const { item } = action;
      const preview = { op: `op-${randomBytes(16).toString('hex')}`, form: action.form, body: bodyOf(action), repository: item.repository,
        subject: item.subject, url: item.url.replace(/#.*$/, ''), visibility: picked.private ? 'repository' : 'public', confirms: 0,
        source: item.type === 'decision' ? sourceOf(input).binding : null };
      preview.confirms = confirmsFor(preview, item);
      return issue(preview, item);
    },
    confirm(preview, event) {
      const state = issued.get(preview);
      if (state && event?.isTrusted === true && !used.has(event) && state.confirmed < preview.confirms) {
        used.add(event);
        state.confirmed += 1;
      }
      return { confirmed: state?.confirmed ?? 0, of: preview.confirms };
    },
    post(preview) {
      const state = issued.get(preview);
      if (!state || state.snapshot !== JSON.stringify(preview)) return Promise.resolve(refused(preview.op, 'not_composed'));
      if (inflight.has(preview.op)) return inflight.get(preview.op);
      const saved = all()[preview.op];
      if (saved?.state === 'posted') return Promise.resolve({ outcome: 'posted', op: preview.op, comment: saved.comment });
      if (state.confirmed < preview.confirms) return Promise.resolve(refused(preview.op, 'not_confirmed'));
      state.confirmed = 0;
      const other = Object.values(all()).find(r => r.op !== preview.op && ['sending', 'unknown'].includes(r.state)
        && r.repository === preview.repository && assertDeep(r.subject, preview.subject));
      if (other) return Promise.resolve(refused(preview.op, 'pending'));
      if (state.item.type === 'decision') {
        const check = sourceCheck(state.item, world, AUTHORS);
        if (check.result !== 'matched') return Promise.resolve(refused(preview.op, `source_${check.result === 'changed' ? 'changed' : 'unchecked'}`));
        if (!assertDeep(check.binding, preview.source)) return Promise.resolve(refused(preview.op, 'source_changed'));
      }
      const promise = send(preview, state).finally(() => inflight.delete(preview.op));
      inflight.set(preview.op, promise);
      return promise;
    },
    pending() {
      return Object.values(all()).filter(r => ['sending', 'unknown'].includes(r.state)).map(r => issue({ ...r.preview }, r.item));
    },
  };
}
function postWorld(fx) {
  const world = recorded(structuredClone(fx.github));
  const comments = structuredClone(fx.comments);
  let next = 9100050;
  world.now = 1894000100000;
  world.writes = 0;
  world.mode = 'ok';
  const list = number => (comments[number] ||= []);
  const base = world.get;
  world.get = path => {
    const m = path.match(/^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments\?per_page=100&page=(\d+)$/);
    if (!m) return base(path);
    world.requests += 1;
    return { ok: true, status: 200, json: m[2] === '1' ? list(m[1]).map(c => ({ html_url: `https://github.com/acme/factory/issues/${m[1]}#issuecomment-${c.id}`, ...c })) : [] };
  };
  world.post = (path, body, account) => {
    world.requests += 1;
    world.writes += 1;
    world.now += 1000;
    const number = path.match(/\/issues\/(\d+)\/comments$/)[1];
    const comment = { id: next++, user: { login: account.login, id: account.id }, body, created_at: new Date(world.now).toISOString(),
      html_url: `https://github.com/acme/factory/issues/${number}#issuecomment-${next - 1}` };
    if (world.mode === 'dropped') return { ok: false, status: 0 };
    list(number).push(comment);
    return world.mode === 'lost' ? { ok: false, status: 0 } : { ok: true, status: 201, json: comment };
  };
  return world;
}

test('post sequences: recorded confirms gate every write, ids are per intent, receipts per account', async () => {
  const cases = (await readdir(POSTS)).filter(n => n.endsWith('.json'));
  assert.ok(cases.length >= 10, 'too few post sequences');
  const reasons = code(table('### `OW.records`').find(r => r.Outcome === 'refused').Means);
  for (const name of cases) {
    const fx = await json(new URL(name, POSTS));
    const world = postWorld(fx);
    const browser = { storage: new Map() };
    let records = makeRecords({ browser, account: fx.account, picked: fx.picked, world });
    const previews = {};
    const taps = {};
    let afterCompose = 0;
    for (const [i, step] of fx.steps.entries()) {
      const at = `${name}, step ${i + 1}`;
      if (step.compose) {
        const { action } = await json(new URL(`${step.compose}.input.json`, FORMS));
        const preview = await records.compose(action);
        assert.ok(preview.op, `${at}: ${JSON.stringify(preview)}`);
        assert.match(preview.op, /^op-[0-9a-f]{32}$/, at);
        previews[step.as] = preview;
        afterCompose = world.requests;
      } else if (step.confirm) {
        taps[step.tap] ||= { isTrusted: !step.untrusted };
        records.confirm(previews[step.confirm], taps[step.tap]);
      } else if (step.edit) {
        world.github = structuredClone(step.edit);
      } else if (step.reload) {
        records = makeRecords({ browser, account: step.reload, picked: fx.picked, world });
      } else if (step.pending) {
        const restored = records.pending();
        assert.deepEqual(restored.map(p => p.op), step.pending.map(n => previews[n].op), at);
        for (const [j, n] of step.pending.entries()) previews[n] = restored[j];
      } else if (step.post) {
        world.mode = step.write || 'ok';
        const first = records.post(previews[step.post]);
        if (step.twice) assert.equal(records.post(previews[step.post]), first, `${at}: a double tap made a second post`);
        const outcome = await first;
        assert.equal(outcome.outcome, step.expect.outcome, `${at}: ${JSON.stringify(outcome)}`);
        if (step.expect.reason) {
          assert.ok(reasons.includes(step.expect.reason), `${at}: the contract lists no refusal ${step.expect.reason}`);
          assert.equal(outcome.reason, step.expect.reason, at);
        }
        assert.equal(outcome.op, previews[step.post].op, at);
      }
    }
    assert.equal(world.writes, fx.writes, `${name}: write requests`);
    if ('requests_after_compose' in fx) assert.equal(world.requests - afterCompose, fx.requests_after_compose, `${name}: requests after compose`);
    if (fx.distinct) assert.equal(new Set(fx.distinct.map(n => previews[n].op)).size, fx.distinct.length, `${name}: ids`);
  }
});
