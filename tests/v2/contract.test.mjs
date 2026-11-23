import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

const ROOT = new URL('../../', import.meta.url);
const FORMS = new URL('tests/v2/fixtures/forms/', ROOT);
const REFUSED = new URL('refused/', FORMS);
const read = async url => readFile(url, 'utf8');
const json = async url => JSON.parse(await read(url));
const contract = await read(new URL('contracts/app-records.v1.md', ROOT)).catch(() => '');

function section(heading) {
  const lines = contract.split('\n');
  const start = lines.findIndex(line => line === heading);
  assert.ok(start >= 0, `the contract has no "${heading}" section`);
  const level = heading.match(/^#+/)[0].length;
  const end = lines.findIndex((line, i) => i > start && /^#+ /.test(line) && line.match(/^#+/)[0].length <= level);
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
  const from = Object.fromEntries(table('### Context values').map(r => [code(r.Key)[0], code(r.From)]));
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
function refusedLine(body) {
  const markers = table('### Refused forms').map(r => ({ marker: code(r.Marker)[0], where: r.Where }));
  return markers.some(({ marker, where }) => (where === 'anywhere' ? body.includes(marker)
    : body.split(/\r\n|\r|\n/).some(line => line.replace(/^[ \t]+/, '').startsWith(marker))));
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
};
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

test('the operation id worked example matches its fixture', async () => {
  const text = section('### Operation id').join('\n');
  const [, name, op] = text.match(/fixture `([a-z_-]+)` has the operation id `(op-[0-9a-f]{32})`/) || [];
  assert.ok(name, 'no worked example');
  const { action } = await json(new URL(`${name}.input.json`, FORMS));
  const body = await json(new URL(`${name}.body.json`, FORMS));
  const { repository, subject } = action.item;
  const hash = createHash('sha256').update(`${repository}\n${subject.kind}\n${subject.number}\n${body}`, 'utf8').digest('hex');
  assert.equal(op, `op-${hash.slice(0, 32)}`);
});

test('fixtures are synthetic: only the synthetic acme repositories and example numbers', async () => {
  for (const dir of [FORMS, REFUSED]) {
    for (const name of (await readdir(dir)).filter(n => n.endsWith('.json'))) {
      const text = await read(new URL(name, dir));
      for (const repo of text.matchAll(/github\.com\/([^/"\s]+)\//g)) assert.equal(repo[1], 'acme', `${name}: ${repo[0]}`);
      for (const id of text.matchAll(/"comment_id": (\d+)/g)) assert.match(id[1], /^91000\d\d$/, name);
    }
  }
});
