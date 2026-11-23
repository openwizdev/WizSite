import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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
  assert.equal(Object.keys(broken).length, 27, 'the broken fixtures are there');
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
    ['summary-password.json', /looks like a token/],
  ]) {
    const { code, stderr } = build(bytes(`broken/${name}`));
    assert.notEqual(code, 0, `${name}: the build passed`);
    assert.match(stderr, why, `${name}: says why (${stderr.trim().split('\n').at(-1)})`);
    assert.doesNotMatch(stderr, /example-not-a-real-one/, `${name}: the refusal never prints the value`);
  }
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

function wizmarket(index) {
  const dir = mkdtempSync(join(tmpdir(), 'market-sync-'));
  const canonical = join(dir, 'canonical.git');
  const origin = join(dir, 'fork.git');
  const work = join(dir, 'work');
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: work, stdio: 'pipe', encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', canonical]);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  mkdirSync(join(work, 'check'), { recursive: true });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(work, 'check/check.py'), 'import sys\nopen(".ran", "w").close()\nsys.stdout.write(open("index.out").read().replace("HEAD", open(".head").read().strip()))\n');
  writeFileSync(join(work, 'index.out'), index);
  writeFileSync(join(work, '.gitignore'), '.head\n.ran\n');
  git('add', '.');
  git('commit', '-q', '-m', 'registry');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  git('push', '-q', canonical, 'main');
  writeFileSync(join(work, '.head'), git('rev-parse', 'HEAD'));
  return { dir, work, git, canonical, ran: () => existsSync(join(work, '.ran')) };
}

function sync(work, canonical) {
  const site = siteCopy();
  const env = { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${canonical}.insteadOf`, GIT_CONFIG_VALUE_0: 'https://github.com/openwizdev/WizMarket' };
  const run = spawnSync(process.execPath, ['scripts/market-sync.mjs', work], { cwd: site, encoding: 'utf8', env });
  const out = existsSync(join(site, 'market/registry.json')) ? readFileSync(join(site, 'market/registry.json'), 'utf8') : null;
  rmSync(site, { recursive: true, force: true });
  return { ...run, out };
}

const atHead = JSON.stringify({ commit: 'HEAD', contract: 'listing.v1', listings: JSON.parse(fixture('contract-index.json')).listings
  .map(l => l.proof?.receipt ? { ...l, proof: { ...l.proof, receipt: { ...l.proof.receipt, url: l.proof.receipt.url.replace(C, 'HEAD') } } } : l) }, null, 2) + '\n';

test('market-sync writes the index of a clean checkout on canonical WizMarket main, byte for byte', () => {
  const repo = wizmarket(atHead);
  const head = repo.git('rev-parse', 'HEAD').trim();
  const { status, stderr, stdout, out } = sync(repo.work, repo.canonical);
  rmSync(repo.dir, { recursive: true, force: true });
  assert.equal(status, 0, stderr);
  assert.equal(out, atHead.replaceAll('HEAD', head), 'market/registry.json is the index output exactly');
  assert.match(stdout, new RegExp(`6 listings at WizMarket ${head}`));
});

test('market-sync refuses a checkout the index would not read, and a malformed index', () => {
  const publish = repo => { repo.git('push', '-q', 'origin', 'main'); repo.git('push', '-q', repo.canonical, 'main'); writeFileSync(join(repo.work, '.head'), repo.git('rev-parse', 'HEAD')); };
  const cases = {
    'uncommitted or untracked changes': [repo => writeFileSync(join(repo.work, 'listings.json'), '{}'), false],
    'HEAD is not on canonical WizMarket main': [repo => repo.git('commit', '-q', '--allow-empty', '-m', 'local only'), false],
    'HEAD is not on canonical WizMarket main ': [repo => { repo.git('commit', '-q', '--allow-empty', '-m', 'a fork only'); repo.git('push', '-q', 'origin', 'main'); }, false],
    'could not fetch canonical WizMarket main': [repo => rmSync(repo.canonical, { recursive: true, force: true }), false],
    'no check/check.py': [repo => { repo.git('rm', '-q', 'check/check.py'); repo.git('commit', '-q', '-m', 'drop'); publish(repo); }, false],
    'market/registry.json: the index: contract is not listing.v1': [repo => {
      writeFileSync(join(repo.work, 'index.out'), atHead.replace('"listing.v1"', '"listing.v2"'));
      repo.git('commit', '-q', '-am', 'v2'); publish(repo);
    }, true],
    'index names another commit': [repo => writeFileSync(join(repo.work, '.head'), 'e'.repeat(40)), true],
  };
  for (const [name, [spoil, runs]] of Object.entries(cases)) {
    const why = name.trim();
    const repo = wizmarket(atHead);
    spoil(repo);
    const { status, stderr, out } = sync(repo.work, repo.canonical);
    const ran = repo.ran();
    rmSync(repo.dir, { recursive: true, force: true });
    assert.equal(status, 1, `${name}: exit 1`);
    assert.ok(stderr.includes(why), `${name}: says why (${stderr.trim()})`);
    assert.equal(ran, runs, `${name}: the checkout's index command ${runs ? 'ran' : 'never ran'}`);
    assert.equal(out, readFileSync(join(ROOT, 'market/registry.json'), 'utf8'), `${name}: the snapshot is untouched`);
  }
});
