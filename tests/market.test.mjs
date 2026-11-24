import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const FIXTURES = join(ROOT, 'tests/market-fixtures');
const C = 'd'.repeat(40);
const RECEIPT = id => `https://github.com/openwizdev/WizMarket/blob/${C}/receipts/${id}/2026-11-01-aaaaaaaaaaaa.txt`;
const SKILL = `https://github.com/example-owner/example-skills/tree/${'c'.repeat(40)}`;

const CONTRACT_LISTINGS = {
  'example-driver': { name: 'Example driver', status: 'verified', tags: ['driver', 'example-host'], proofs: [RECEIPT('example-driver')],
    stage: 'available', url: 'https://example.com/example-driver' },
  'example-driver-kit': { name: 'Example driver kit', status: 'verified', tags: ['driver', 'skill'], proofs: [RECEIPT('example-driver-kit'), SKILL],
    stage: 'available', url: 'https://example.com/example-driver-kit' },
  'example-harness': { name: 'Example harness', status: 'listed', tags: ['harness', 'cli'], proofs: [],
    stage: 'being-built', work: 'https://github.com/example-owner/example-harness/pull/1', url: 'https://example.com/example-harness' },
  'example-skill': { name: 'Example skill', status: 'verified', tags: ['skill', 'example'], proofs: [SKILL],
    stage: 'available', url: 'https://example.com/example-skill' },
  'example-tool': { name: 'Example tool', status: 'listed', tags: ['mcp-server'], proofs: [], stage: 'available', url: 'https://example.com/example-tool' },
  'example-tracker-harness': { name: 'Example tracker harness', status: 'listed', tags: ['harness'], proofs: [], stage: 'being-built',
    work: 'https://tracker.example.com/example-owner/example-harness/-/issues/1?view=full#note-2', url: 'https://example.com/example-tracker-harness',
    more: ['https://github.com/example-owner/example-harness/issues/1#issuecomment-2'] },
};

function siteCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'market-test-'));
  const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  for (const name of tracked.split('\0').filter(name => name && existsSync(join(ROOT, name)))) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    cpSync(join(ROOT, name), join(dir, name));
  }
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  return dir;
}

function build(registry, after = () => null) {
  const dir = siteCopy();
  mkdirSync(join(dir, 'market'), { recursive: true });
  writeFileSync(join(dir, 'market/registry.json'), registry);
  const run = spawnSync(process.execPath, ['build.mjs'], { cwd: dir, encoding: 'utf8' });
  const page = join(dir, 'dist/market/index.html');
  const html = existsSync(page) ? readFileSync(page, 'utf8') : null;
  const checked = run.status === 0 ? after(dir) : null;
  rmSync(dir, { recursive: true, force: true });
  return { code: run.status, stderr: run.stderr, html, checked };
}

const checkSite = dir => spawnSync('python3', ['-B', '-c', 'import sys; sys.path.insert(0, "scripts"); from pathlib import Path; from check import check_site; check_site(Path("dist").resolve(), Path("market/registry.json"))'], { cwd: dir, encoding: 'utf8' });

const fixture = name => readFileSync(join(FIXTURES, name), 'utf8');
const bytes = name => readFileSync(join(FIXTURES, name));
const ids = html => [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const decode = text => text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const text = html => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const hrefs = html => [...html.matchAll(/<a [^>]*href="([^"]*)"/g)].map(m => decode(m[1]));
const main = html => html.match(/<main\b[\s\S]*?<\/main>/)?.[0] ?? '';

function cards(html) {
  assert.ok(html, 'the build wrote no market page (dist/market/index.html)');
  const found = {};
  for (const [card, id] of main(html).matchAll(/<article class="market-card" id="listing-([a-z0-9-]+)"[\s\S]*?<\/article>/g)) found[id] = card;
  return found;
}

test('every listing of the fixture snapshot renders with its status, tags and links', () => {
  const { code, stderr, html } = build(fixture('contract-index.json'));
  assert.equal(code, 0, stderr);
  const found = cards(html);
  assert.deepEqual(Object.keys(found), Object.keys(CONTRACT_LISTINGS), 'one card per listing, sorted by id');
  for (const [id, want] of Object.entries(CONTRACT_LISTINGS)) {
    const card = found[id];
    const links = hrefs(card);
    assert.match(card, new RegExp(`<h3 id="name-${id}">${want.name}</h3>`), `${id}: its name`);
    assert.match(card, new RegExp(`data-status="${want.status}"`), `${id}: its status`);
    assert.ok(text(card).includes(want.status === 'verified' ? 'Verified' : 'Listed A link, not proven.'), `${id}: its status in words`);
    for (const tag of want.tags) assert.ok(links.includes(`#tag-${tag}`), `${id}: its tag ${tag} links to the tag`);
    assert.equal((card.match(/<ul class="market-tags"[\s\S]*?<\/ul>/)[0].match(/<li>/g) || []).length, want.tags.length, `${id}: only its own tags`);
    for (const proof of want.proofs) assert.ok(links.includes(proof), `${id}: a link to its proof ${proof}`);
    assert.equal(links.filter(href => href.includes('/receipts/') || href.includes('/tree/')).length, want.proofs.length, `${id}: no other proof link`);
    assert.match(card, new RegExp(`data-stage="${want.stage}"`), `${id}: its stage`);
    if (want.work) assert.ok(text(card).includes('Being built:') && links.includes(want.work), `${id}: its being-built link`);
    assert.ok(links.includes(want.url), `${id}: its URL`);
    for (const more of want.more ?? []) assert.ok(links.includes(more), `${id}: its other links`);
  }
  assert.ok(text(found['example-driver']).includes('Kit receipt: 5 of 5 checks on its real host, 2026-11-01'), 'a receipt names its date');
  assert.ok(text(found['example-skill']).includes(`Its check passed at example-owner/example-skills@${'c'.repeat(12)}`), 'a skill names its pinned source');
});

test('a non-verified listing never shows verified', () => {
  const { code, stderr, html } = build(fixture('edge-index.json'));
  assert.equal(code, 0, stderr);
  const found = cards(html);
  assert.deepEqual(Object.keys(found), ['example-listed-driver', 'example-listed-skill']);
  for (const [id, card] of Object.entries(found)) {
    assert.match(card, /data-status="listed"/, `${id}: listed`);
    assert.doesNotMatch(card, /data-status="verified"|>Verified</, `${id}: no verified badge`);
    assert.ok(!hrefs(card).some(href => href.includes('/receipts/') || href.includes('/tree/')), `${id}: no proof link`);
  }
  const byTag = main(html).match(/<section class="market-by-tag"[\s\S]*<\/section>/)[0];
  assert.doesNotMatch(byTag, /Verified/, 'the tag lists say listed too');
  assert.match(found['example-listed-driver'], /Example &lt;b&gt;listed&lt;\/b&gt; driver &amp; co/, 'names are escaped, not markup');
  assert.ok(hrefs(found['example-listed-driver']).includes('https://example.com/listed-driver?a=1&b=2'), 'URLs are kept exactly as written');
  assert.ok(text(found['example-listed-skill']).includes('Being built: Ticket'), 'the first link is the work link');
});

test('a malformed snapshot fails the build', () => {
  const broken = Object.fromEntries(readdirSync(join(FIXTURES, 'broken')).filter(name => name.endsWith('.json')).sort().map(name => [name, bytes(`broken/${name}`)]));
  assert.equal(Object.keys(broken).length, 30, 'the broken fixtures are there');
  const valid = bytes('contract-index.json');
  const at = valid.indexOf('Example driver');
  broken['invalid UTF-8'] = Buffer.concat([valid.subarray(0, at), Buffer.from([0xc3, 0x28]), valid.subarray(at)]);
  broken['a byte-order mark'] = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), valid]);
  for (const [name, data] of Object.entries(broken)) {
    const { code, stderr, html } = build(data);
    assert.notEqual(code, 0, `${name}: the build passed`);
    assert.match(stderr, /market\/registry\.json: /, `${name}: the build names the snapshot as the reason`);
    assert.equal(html, null, `${name}: no market page was written`);
  }
});

test('the build refuses what WizMarket refuses: repeated keys, bad text, impossible dates, credentials', () => {
  for (const [name, why] of [
    ['repeated-status.json', /key status twice/],
    ['repeated-key-escaped.json', /key status twice/],
    ['unpaired-surrogate.json', /unpaired surrogate/],
    ['receipt-date-impossible.json', /date is not a calendar date/],
    ['receipt-date-year-zero.json', /date is not a calendar date/],
    ['repeated-key-private.json', /key \(not shown\) twice/],
    ['summary-password.json', /looks like a token/],
    ['summary-password-long-s.json', /looks like a token/],
  ]) {
    const { code, stderr } = build(bytes(`broken/${name}`));
    assert.notEqual(code, 0, `${name}: the build passed`);
    assert.match(stderr, why, `${name}: says why (${stderr.trim().split('\n').at(-1)})`);
    assert.doesNotMatch(stderr, /example[-_]not[-_]a[-_]real[-_]one/, `${name}: the refusal never prints the value`);
  }
});

test('the privacy scan refuses exactly what WizMarket\'s own scan refuses, every BMP code point at every probe position', async () => {
  const { PRIVATE_SOURCE, parse, privateKind, validate } = await import('../scripts/market.mjs');
  const run = spawnSync('python3', ['-I', join(FIXTURES, 'private-parity.py')], { encoding: 'utf8', maxBuffer: 1 << 28 });
  assert.equal(run.status, 0, run.stderr);
  const { unicode, word, patterns, cases } = JSON.parse(run.stdout);
  assert.deepEqual(PRIVATE_SOURCE.map(([label, source]) => [label, source]), patterns.map(([label, source, ignorecase]) => [label, ignorecase === source.startsWith('(?i)') ? source : `${source} (ignorecase set by flag)`]),
    'the site scans with WizMarket\'s patterns, character for character');
  assert.throws(() => validate(['A synthetic driver. paſsword: example']), /holds what looks like a token/, 'validate uses the same scan');
  const cafe = fixture('contract-index.json').replace('A synthetic driver that ships its own skill.', 'See https://example.com/café/home/examples/ for more.');
  assert.doesNotThrow(() => parse(cafe), 'a non-ASCII letter before /home/ is a word character, as in Python, so no machine path');
  assert.throws(() => parse(cafe.replace('café/home', 'café /home')), /holds what looks like a machine path/, 'a real machine path is still refused');
  assert.ok(cases.length > 400, 'the probes ran');
  const hex = point => `U+${point.toString(16).toUpperCase().padStart(4, '0')}`;
  const mismatches = [];
  for (const [probe, at, ranges] of cases) {
    const python = new Set(ranges.flatMap(([first, last]) => Array.from({ length: last - first + 1 }, (_, i) => first + i)));
    for (let point = 0; point < 0x10000 && mismatches.length < 20; point++) {
      if (point >= 0xd800 && point < 0xe000) continue;
      const site = privateKind(probe.slice(0, at) + String.fromCharCode(point) + probe.slice(at + 1)) !== null;
      if (site !== python.has(point)) mismatches.push(`${JSON.stringify(probe)} at ${at}: ${hex(point)} ${site ? 'refused by the site only' : 'refused by WizMarket only'}`);
    }
  }
  assert.deepEqual(mismatches, [], 'strings one scan refuses and the other accepts');
  const python = new Set(word);
  const words = [];
  for (let point = 0; point < 0x110000 && words.length < 20; point++) {
    if (point >= 0xd800 && point < 0xe000) continue;
    const site = privateKind(String.fromCodePoint(point) + 'password: x') === null;
    if (site === python.has(point)) continue;
    if (unicode !== '14.0.0' && point > 0xffff && !site) continue;
    words.push(`${hex(point)} before password: ${site ? 'a word character on the site only' : 'a word character in Python only'}`);
  }
  assert.deepEqual(words, [], `Python's Unicode word characters and boundaries, every code point (Python's Unicode ${unicode}; WizMarket's Python 3.11 is 14.0.0)`);
});

test('any tag set builds and passes the site checker: distinct ids, registry links in generated markup only', () => {
  const { code, stderr, html, checked } = build(fixture('check-index.json'), checkSite);
  assert.equal(code, 0, stderr);
  const all = ids(html);
  assert.equal(new Set(all).size, all.length, `duplicate ids: ${all.filter((id, i) => all.indexOf(id) !== i)}`);
  for (const tag of ['driver', 'driver-name']) assert.ok(main(html).includes(`href="#tag-${tag}"`), `browse links to ${tag}`);
  assert.equal(checked.status, 0, `scripts/check.py check_site: ${checked.stderr.trim().split('\n').at(-1)}`);
});

test('an empty registry shows an honest empty state that points to publishing your own', () => {
  const { code, stderr, html } = build(fixture('empty-index.json'));
  assert.equal(code, 0, stderr);
  const body = main(html);
  assert.deepEqual(Object.keys(cards(html)), []);
  const empty = body.match(/<p class="market-empty">[\s\S]*?<\/p>/);
  assert.ok(empty, 'an empty-state paragraph');
  assert.match(text(empty[0]), /No listings yet/);
  assert.ok(hrefs(empty[0]).includes('#publish'), 'it points to Publish your own');
  assert.doesNotMatch(body, /Browse by tag|market-by-tag|data-status="verified"/, 'no empty tag lists and no verified claim');
});

test('the page reads without JavaScript: plain anchors, every target on the page, one publish paragraph', () => {
  const { html } = build(fixture('contract-index.json'));
  cards(html);
  const body = main(html);
  assert.doesNotMatch(body, /<script|<template|\shidden[\s>=]|onclick/i, 'nothing in main waits for a script');
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  const local = hrefs(body).filter(href => href.startsWith('#'));
  assert.ok(local.length > 0);
  for (const href of local) assert.ok(ids.has(href.slice(1)), `missing anchor target ${href}`);
  for (const tag of ['cli', 'driver', 'example', 'example-host', 'harness', 'mcp-server', 'skill']) {
    const section = body.match(new RegExp(`<section class="market-tag" id="tag-${tag}"[\\s\\S]*?</section>`));
    assert.ok(section, `a section for the tag ${tag}`);
    const listed = hrefs(section[0]).map(href => href.replace('#listing-', '')).sort();
    const want = Object.entries(CONTRACT_LISTINGS).filter(([, l]) => l.tags.includes(tag)).map(([id]) => id).sort();
    assert.deepEqual(listed, want, `the ${tag} section lists exactly its listings`);
  }
  const publish = body.match(/<section class="market-publish"[\s\S]*?<\/section>/g) ?? [];
  assert.equal(publish.length, 1, 'one Publish your own paragraph');
  assert.ok(hrefs(publish[0]).includes('https://github.com/openwizdev/WizMarket'), 'it links WizMarket');
  assert.ok(hrefs(publish[0]).includes('https://github.com/openwizdev/WizMarket/blob/main/contracts/listing.v1.md'), 'it links the merged contract');
  assert.ok(!hrefs(body).some(href => href.includes('pull_request_template')), 'no link to a template main does not hold yet');
  assert.match(html, /<footer class="landing-footer">[\s\S]*<a href="\/market\/">Market<\/a>/, 'the site footer, with its Market link');
});

test('the site builds its market page from the real snapshot', () => {
  const registry = readFileSync(join(ROOT, 'market/registry.json'), 'utf8');
  const { code, stderr, html } = build(registry);
  assert.equal(code, 0, stderr);
  const index = JSON.parse(registry);
  assert.deepEqual(Object.keys(cards(html)), index.listings.map(listing => listing.id), 'one card for every listing in market/registry.json');
  assert.notEqual(registry, fixture('contract-index.json'), 'the deployed snapshot is not the synthetic fixture');
  assert.notEqual(index.commit, C, 'the deployed snapshot is not at the synthetic commit');
});

const atHead = JSON.stringify({ commit: 'HEAD', contract: 'listing.v1', listings: JSON.parse(fixture('contract-index.json')).listings
  .map(l => l.proof?.receipt ? { ...l, proof: { ...l.proof, receipt: { ...l.proof.receipt, url: l.proof.receipt.url.replace(C, 'HEAD') } } } : l) }, null, 2) + '\n';

function trusted() {
  const dir = mkdtempSync(join(tmpdir(), 'market-trust-'));
  const canonical = join(dir, 'WizMarket');
  const fork = join(dir, 'fork.git');
  const work = join(dir, 'work');
  const ran = join(dir, 'ran');
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: work, stdio: 'pipe', encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', canonical]);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', fork]);
  mkdirSync(join(work, 'check'), { recursive: true });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(work, 'check/check.py'), `${fixture('wizmarket-private.py')}\nimport os\nimport subprocess\nimport sys\n\nif __name__ == "__main__":\n    open(${JSON.stringify(ran)}, "a").write(os.getcwd() + "\\n")\n`
    + '    head = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()\n    sys.stdout.write(open("index.out").read().replace("HEAD", head))\n');
  writeFileSync(join(work, 'index.out'), atHead);
  git('add', '.');
  git('commit', '-q', '-m', 'registry');
  git('push', '-q', canonical, 'main');
  git('push', '-q', fork, 'main');
  return { dir, work, git, canonical, fork, ran: () => existsSync(ran) ? readFileSync(ran, 'utf8').trim().split('\n') : [] };
}

function trustedSync(repo, env = {}) {
  const site = siteCopy();
  const code = `const { cli } = await import(${JSON.stringify(pathToFileURL(join(site, 'scripts/market-sync.mjs')).href)}); process.exitCode = await cli([${JSON.stringify(repo.work)}], ${JSON.stringify(repo.canonical)});`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: site, encoding: 'utf8', env: { ...process.env, ...env } });
  const out = existsSync(join(site, 'market/registry.json')) ? readFileSync(join(site, 'market/registry.json'), 'utf8') : null;
  rmSync(site, { recursive: true, force: true });
  return { ...run, out };
}

test('market-sync writes the index of a commit on canonical WizMarket main, byte for byte', () => {
  const repo = trusted();
  const head = repo.git('rev-parse', 'HEAD').trim();
  writeFileSync(join(repo.work, 'untracked.json'), '{}');
  const { status, stderr, stdout, out } = trustedSync(repo);
  rmSync(repo.dir, { recursive: true, force: true });
  assert.equal(status, 0, stderr);
  assert.equal(out, atHead.replaceAll('HEAD', head), 'market/registry.json is the index output exactly');
  assert.match(stdout, new RegExp(`6 listings at WizMarket ${head}`));
});

test('market-sync refuses a commit the index would not read, and a malformed index', () => {
  const publish = repo => repo.git('push', '-q', repo.canonical, 'main');
  const commit = (repo, file, text) => { writeFileSync(join(repo.work, file), text); repo.git('commit', '-q', '-am', file); publish(repo); };
  const cases = {
    'HEAD is not on canonical WizMarket main': [repo => repo.git('commit', '-q', '--allow-empty', '-m', 'local only'), false],
    'HEAD is not on canonical WizMarket main ': [repo => { repo.git('commit', '-q', '--allow-empty', '-m', 'a fork only'); repo.git('push', '-q', repo.fork, 'main'); }, false],
    'could not fetch canonical WizMarket main': [repo => rmSync(repo.canonical, { recursive: true, force: true }), false],
    'no check/check.py': [repo => { repo.git('rm', '-q', 'check/check.py'); repo.git('commit', '-q', '-m', 'drop'); publish(repo); }, false],
    'WizMarket\'s privacy patterns differ from the site\'s port': [repo => commit(repo, 'check/check.py', readFileSync(join(repo.work, 'check/check.py'), 'utf8').replace('passwd|', '')), false],
    'market/registry.json: the index: contract is not listing.v1': [repo => commit(repo, 'index.out', atHead.replace('"listing.v1"', '"listing.v2"')), true],
    'index names another commit': [repo => commit(repo, 'index.out', JSON.stringify({ commit: 'e'.repeat(40), contract: 'listing.v1', listings: [] })), true],
  };
  for (const [name, [spoil, runs]] of Object.entries(cases)) {
    const why = name.trim();
    const repo = trusted();
    spoil(repo);
    const { status, stderr, out } = trustedSync(repo);
    const ran = repo.ran().length > 0;
    rmSync(repo.dir, { recursive: true, force: true });
    assert.equal(status, 1, `${name}: exit 1 (${stderr.trim()})`);
    assert.ok(stderr.includes(why), `${name}: says why (${stderr.trim()})`);
    assert.equal(ran, runs, `${name}: the index command ${runs ? 'ran' : 'never ran'}`);
    assert.equal(out, readFileSync(join(ROOT, 'market/registry.json'), 'utf8'), `${name}: the snapshot is untouched`);
  }
});

test('market-sync takes canonical main from git config it controls, never from the checkout\'s', () => {
  const snapshot = readFileSync(join(ROOT, 'market/registry.json'), 'utf8');
  const repo = trusted();
  repo.git('commit', '-q', '--allow-empty', '-m', 'a fork only');
  repo.git('push', '-q', repo.fork, 'main');
  const home = join(repo.dir, 'home');
  mkdirSync(home);
  writeFileSync(join(home, '.gitconfig'), `[url "${repo.fork}"]\n\tinsteadOf = ${repo.canonical}\n`);
  for (const [where, env] of [
    ['the checkout\'s own config', {}],
    ['global config', { HOME: home, XDG_CONFIG_HOME: join(home, '.config') }],
    ['the environment', { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${repo.fork}.insteadOf`, GIT_CONFIG_VALUE_0: repo.canonical }],
  ]) {
    if (!Object.keys(env).length) repo.git('config', `url.${repo.fork}.insteadOf`, repo.canonical);
    else spawnSync('git', ['config', '--unset-all', `url.${repo.fork}.insteadOf`], { cwd: repo.work });
    const { status, stderr, out } = trustedSync(repo, env);
    assert.equal(status, 1, `an insteadOf rule in ${where} chose the fork as canonical main: ${stderr.trim()}`);
    assert.match(stderr, /HEAD is not on canonical WizMarket main/, where);
    assert.deepEqual(repo.ran(), [], `${where}: the fork's index command never ran`);
    assert.equal(out, snapshot, `${where}: the snapshot is untouched`);
  }
  rmSync(repo.dir, { recursive: true, force: true });
});

test('market-sync reads only the checkout\'s HEAD ref, so a missing object never fetches from the checkout\'s promisor remote', () => {
  const repo = trusted();
  const head = repo.git('rev-parse', 'HEAD').trim();
  const fetched = join(repo.dir, 'fetched');
  writeFileSync(join(repo.dir, 'upload-pack.sh'), `#!/bin/sh\ntouch ${JSON.stringify(fetched)}\nexit 1\n`, { mode: 0o755 });
  for (const [key, value] of [['core.repositoryformatversion', '1'], ['extensions.partialClone', 'origin'], ['remote.origin.url', repo.fork],
    ['remote.origin.promisor', 'true'], ['remote.origin.uploadpack', join(repo.dir, 'upload-pack.sh')]]) repo.git('config', key, value);
  rmSync(join(repo.work, '.git/objects', head.slice(0, 2), head.slice(2)));
  const { status, stderr, out } = trustedSync(repo);
  const lazy = existsSync(fetched);
  rmSync(repo.dir, { recursive: true, force: true });
  assert.equal(lazy, false, 'git fetched from the checkout\'s promisor remote before the commit was trusted');
  assert.equal(status, 0, stderr);
  assert.equal(out, atHead.replaceAll('HEAD', head), 'the commit and its index come from canonical main');
});

test('market-sync runs no code from the checkout and reads its commit, not its working tree', () => {
  const repo = trusted();
  const head = repo.git('rev-parse', 'HEAD').trim();
  const hook = join(repo.dir, 'hook-ran');
  writeFileSync(join(repo.dir, 'fsmonitor.sh'), `#!/bin/sh\ntouch ${JSON.stringify(hook)}\nexit 1\n`, { mode: 0o755 });
  writeFileSync(join(repo.work, 'index.out'), atHead.replace('Example driver', 'Example changed driver'));
  repo.git('update-index', '--assume-unchanged', 'index.out');
  repo.git('config', 'core.fsmonitor', join(repo.dir, 'fsmonitor.sh'));
  const { status, stderr, out } = trustedSync(repo);
  const ran = repo.ran();
  const hooked = existsSync(hook);
  rmSync(repo.dir, { recursive: true, force: true });
  assert.equal(status, 0, stderr);
  assert.equal(hooked, false, 'git ran the checkout\'s core.fsmonitor command');
  assert.equal(out, atHead.replaceAll('HEAD', head), 'the snapshot is the commit\'s index, not the working tree\'s');
  assert.equal(ran.length, 1, 'the index command ran once');
  assert.ok(!ran[0].startsWith(repo.work), `the index command ran outside the checkout, not in ${ran[0]}`);
});
