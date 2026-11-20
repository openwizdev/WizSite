// FA2 (#1900): the docs index Ask a Wiz answers from (contract openwiz.ask-a-wiz.v1, "The docs index").
// A fixture site and a fixture OpenWiz checkout go in; the exact index comes out. Synthetic values only.
// Run: npm run test:functions
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, checkIndex, checkSnapshot, refreshSnapshot, serialize, snapshotIndex } from '../scripts/ask-index.mjs';

const FIXTURES = fileURLToPath(new URL('./ask-index-fixtures/', import.meta.url));
const site = join(FIXTURES, 'site');
const docs = join(FIXTURES, 'openwiz');
const DOC = 'https://github.com/openwizdev/OpenWiz/blob/main/';

test('a fixture site and docs folder build exactly the expected sources and passages', async () => {
  assert.deepEqual(await buildIndex({ site, docs }), {
    schema: 'openwiz.ask-a-wiz.index.v1',
    sources: [
      { title: 'Synthetic Home — OpenWiz', url: 'https://openwiz.dev/' },
      { title: 'Synthetic Questions', url: 'https://openwiz.dev/faq/' },
      { title: 'OpenWiz README', url: `${DOC}README.md` },
      { title: 'Install', url: `${DOC}docs/install.md` },
    ],
    passages: [
      { source: 0, text: 'Bring your own everything.\nA synthetic landing line & a second clause.\nFirst point\nSecond point' },
      { source: 1, text: 'Questions\nWhat is a synthetic kernel?\nThe small core everything else plugs into.' },
      { source: 1, text: 'What does it cost?\nNothing; it\'s free & open &#x110000;' },
      { source: 2, text: 'Synthetic OpenWiz\nThe synthetic kernel for agent factories. See the install guide.' },
      { source: 2, text: 'Quick start\nRun one line to install it. Notes stay in the private record, never on GitHub.' },
      { source: 3, text: 'Install\nNeed · Why\nGit · Records\nsynthetic install --yes\nStep one\nStep two' },
    ],
  });
});

test('the index holds only public pages and docs: never the app, page chrome, scripts or internal folders', async () => {
  const text = serialize(await buildIndex({ site, docs }));
  for (const kept of ['First point', 'What does it cost?', 'Quick start', 'Step two']) assert.ok(text.includes(kept), `the index must hold: ${kept}`);
  for (const never of ['SYNTHETIC-APP-SHELL', 'SYNTHETIC-FLEET-INTERNAL', 'SYNTHETIC-EVIDENCE-LOG', 'SYNTHETIC-AGENT-RULES',
    'SYNTHETIC-TEXT-NOTE', 'script text', '.x{color', 'Top bar link', 'Footer words', 'Icon title', 'a comment', 'example.invalid', 'synthetic decision', '[private record]']) {
    assert.ok(!text.includes(never), `the index must not hold: ${never}`);
  }
});

test('a long section splits into passages within the limit, keeping every word in order', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ask-index-'));
  try {
    await mkdir(join(dir, 'docs'));
    const sentences = Array.from({ length: 40 }, (_, i) => `Synthetic sentence ${i} says the same short thing about the kernel once more.`);
    const word = 'x'.repeat(2500);
    await writeFile(join(dir, 'README.md'), `# Long\n\n${sentences.join(' ')}\n\n${word}\n`);
    const index = await buildIndex({ docs: dir });
    const texts = index.passages.map(p => p.text);
    assert.ok(texts.length >= 4, 'the long section needs several passages');
    for (const text of texts) assert.ok([...text].length <= 1200 && text.length > 0, `a passage of ${text.length} characters`);
    const squeezed = value => value.replace(/\s+/g, '');
    assert.equal(squeezed(texts.join('')), squeezed(`Long ${sentences.join(' ')} ${word}`), 'no character lost or moved');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the written file escapes every non-ASCII character and parses back to the same index', async () => {
  const index = await buildIndex({ site, docs });
  const text = serialize(index);
  assert.match(text, /^[\x20-\x7e\n]*$/);
  assert.ok(text.includes('Synthetic Home \\u2014 OpenWiz'));
  assert.deepEqual(JSON.parse(text), index);
});

test('the contract\'s own index fixture passes the check, and every broken form is refused', async () => {
  const good = JSON.parse(await readFile(join(FIXTURES, 'contract-index.json'), 'utf8'));
  checkIndex(good);
  const broken = {
    'an extra key': i => { i.extra = 1; },
    'the wrong schema': i => { i.schema = 'openwiz.ask-a-wiz.index.v2'; },
    'no sources': i => { i.sources = []; },
    'no passages': i => { i.passages = []; },
    'a URL off the two prefixes': i => { i.sources[0].url = 'https://example.invalid/'; },
    'a URL twice': i => { i.sources[1].url = i.sources[0].url; },
    'a title over 200 characters': i => { i.sources[0].title = 't'.repeat(201); },
    'an empty title': i => { i.sources[0].title = ''; },
    'a passage over 1200 characters': i => { i.passages[0].text = 'p'.repeat(1201); },
    'an empty passage': i => { i.passages[0].text = ''; },
    'a passage pointing past the sources': i => { i.passages[0].source = 2; },
    'a passage with an extra key': i => { i.passages[0].url = 'https://openwiz.dev/'; },
    'a file over 2,000,000 bytes': i => { i.passages = Array.from({ length: 1700 }, () => ({ source: 0, text: 'p'.repeat(1200) })); },
  };
  for (const [name, change] of Object.entries(broken)) {
    const index = structuredClone(good);
    change(index);
    assert.throws(() => checkIndex(index), /ask index/, `must refuse ${name}`);
  }
});

// The snapshot (ask-docs/): OpenWiz's public README.md and top-level docs/*.md, named by the commit they came from.
const SNAPSHOT = fileURLToPath(new URL('../ask-docs/', import.meta.url));
const COMMIT = 'c0ffee0000000000000000000000000000000001'; // synthetic

test('the shipped snapshot names its OpenWiz commit and passes its own check', async () => {
  assert.match(await readFile(join(SNAPSHOT, 'commit.txt'), 'utf8').catch(() => 'missing'), /^[0-9a-f]{40}\n$/, 'commit.txt names a full commit');
  await checkSnapshot(SNAPSHOT);
  const index = JSON.parse(await snapshotIndex(site, SNAPSHOT));
  assert.ok(index.sources.some(s => s.url === `${DOC}README.md`), 'the index holds the snapshot\'s README');
});

test('a refresh copies only README.md and the top-level docs, without private-record lines, and names the commit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ask-docs-'));
  try {
    const target = join(dir, 'ask-docs');
    await refreshSnapshot(docs, target, COMMIT);
    assert.deepEqual(await listed(target), ['README.md', 'commit.txt', 'docs/install.md']);
    assert.equal(await readFile(join(target, 'commit.txt'), 'utf8'), `${COMMIT}\n`);
    const install = await readFile(join(target, 'docs/install.md'), 'utf8');
    assert.ok(install.includes('Step two') && !install.toLowerCase().includes('private record'), 'the pointer line is dropped, the rest kept');
    const readme = await readFile(join(target, 'README.md'), 'utf8');
    assert.ok(readme.includes('Notes stay in the private record, never on GitHub.'), 'prose naming a private record is no pointer: kept');
    await checkSnapshot(target);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the snapshot check refuses internal folders, AGENTS.md, other files, a private-record line or no commit', async () => {
  const planted = {
    'docs/agents/': ['docs/agents/fleet.md', '# Fleet\n'],
    'docs/evidence/': ['docs/evidence/run.md', '# Run\n'],
    'docs/adr/': ['docs/adr/0001-choice.md', '# Choice\n'],
    'AGENTS.md': ['AGENTS.md', '# Agents\n'],
    'a file that is not Markdown': ['docs/notes.txt', 'notes\n'],
    'a private-record line': ['docs/extra.md', '# Extra\n\nSource: a synthetic decision ([private record](https://github.com/synthetic-records/archive/issues/1)).\n'],
    'a bad commit name': ['commit.txt', 'main\n'],
  };
  for (const [name, [path, text]] of Object.entries(planted)) {
    const dir = await mkdtemp(join(tmpdir(), 'ask-docs-'));
    try {
      await refreshSnapshot(docs, dir, COMMIT);
      await mkdir(join(dir, path, '..'), { recursive: true });
      await writeFile(join(dir, path), text);
      await assert.rejects(checkSnapshot(dir), /ask docs/, `must refuse ${name}`);
      await assert.rejects(snapshotIndex(site, dir), /ask docs/, `the build must stop on ${name}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  const empty = await mkdtemp(join(tmpdir(), 'ask-docs-'));
  try {
    await refreshSnapshot(docs, empty, COMMIT);
    await rm(join(empty, 'commit.txt'));
    await assert.rejects(checkSnapshot(empty), /ask docs/, 'must refuse a snapshot without its commit');
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

async function listed(dir, rel = '') {
  const out = [];
  for (const entry of await readdir(join(dir, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await listed(dir, path)); else out.push(path);
  }
  return out.sort();
}
