// FA2 (#1900): the docs index Ask a Wiz answers from (contract openwiz.ask-a-wiz.v1, "The docs index").
// A fixture site and a fixture OpenWiz checkout go in; the exact index comes out. Synthetic values only.
// Run: npm run test:functions
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, checkIndex, serialize } from '../scripts/ask-index.mjs';

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
      { title: 'Synthetic OpenWiz', url: `${DOC}README.md` },
      { title: 'Install', url: `${DOC}docs/install.md` },
    ],
    passages: [
      { source: 0, text: 'Bring your own everything.\nA synthetic landing line & a second clause.\nFirst point\nSecond point' },
      { source: 1, text: 'Questions\nWhat is a synthetic kernel?\nThe small core everything else plugs into.' },
      { source: 1, text: 'What does it cost?\nNothing; it\'s free & open.' },
      { source: 2, text: 'Synthetic OpenWiz\nThe synthetic kernel for agent factories. See the install guide.' },
      { source: 2, text: 'Quick start\nRun one line to install it.' },
      { source: 3, text: 'Install\nNeed · Why\nGit · Records\nsynthetic install --yes\nStep one\nStep two' },
    ],
  });
});

test('the index holds only public pages and docs: never the app, page chrome, scripts or internal folders', async () => {
  const text = serialize(await buildIndex({ site, docs }));
  for (const kept of ['First point', 'What does it cost?', 'Quick start', 'Step two']) assert.ok(text.includes(kept), `the index must hold: ${kept}`);
  for (const never of ['SYNTHETIC-APP-SHELL', 'SYNTHETIC-FLEET-INTERNAL', 'SYNTHETIC-EVIDENCE-LOG', 'SYNTHETIC-AGENT-RULES',
    'SYNTHETIC-TEXT-NOTE', 'script text', '.x{color', 'Top bar link', 'Footer words', 'Icon title', 'a comment', 'example.invalid']) {
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
