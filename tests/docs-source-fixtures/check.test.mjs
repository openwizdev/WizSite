import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { posix } from 'node:path';
import { test } from 'node:test';

const fixture = new URL('./', import.meta.url);
const read = (path) => readFile(new URL(path, fixture), 'utf8');
const readJson = async (path) => JSON.parse(await read(path));
const readSource = (path) => read(`source/${path}`);

test('synthetic docs sources agree with the golden link cases', async () => {
  const { repository, revision, pages, missingSource, unimportedSource } =
    await readJson('cases.json');
  const { links, shellFence } = await readJson('expected.json');

  assert.equal(repository, 'synthetic-docs-fixture/example-manual');
  assert.match(revision, /^[0-9a-f]{40}$/);
  assert.equal(revision, '0123456789abcdef0123456789abcdef01234567');

  const routes = new Map(pages.map(({ source, route }) => [source, route]));
  assert.equal(routes.size, pages.length);
  assert.ok(routes.has('README.md'));
  assert.ok(new Set(pages.map(({ source }) => posix.dirname(source)).filter(
    (directory) => directory !== '.',
  )).size >= 2);
  assert.ok(!routes.has(unimportedSource));
  assert.ok(await readSource(unimportedSource));
  await assert.rejects(stat(new URL(`source/${missingSource}`, fixture)), { code: 'ENOENT' });

  const sources = new Map();
  for (const { source, route } of pages) {
    assert.match(route, /^\/docs\//);
    sources.set(source, await readSource(source));
  }

  const foundLinks = [];
  for (const [source, markdown] of sources) {
    const prose = markdown.replace(/^```[^\n]*\n[\s\S]*?^```$/gm, '');
    for (const [, href] of prose.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
      const [path, fragment] = href.split('#');
      const target = path ? posix.normalize(posix.join(posix.dirname(source), path)) : source;
      const route = routes.get(target);
      if (!route) assert.equal(target, unimportedSource);
      if (fragment) {
        const headings = [...sources.get(target).matchAll(/^#+ (.+)$/gm)];
        assert.ok(headings.some(([, heading]) => heading.toLowerCase().replaceAll(' ', '-') === fragment));
      }
      const destination = route
        ? (path ? route : '') + (fragment ? `#${fragment}` : '')
        : `https://github.com/${repository}/blob/${revision}/${target}`;
      foundLinks.push({ source, href, destination });
    }
  }
  assert.deepEqual(foundLinks, links);
  assert.ok(links.some(({ source, href }) => source === 'README.md' && href.startsWith('#')));
  assert.ok(links.some(({ href }) => href.startsWith('../') && href.includes('#')));
  assert.ok(links.some(({ destination }) => destination.startsWith('https://github.com/')));

  assert.equal(shellFence.source, 'README.md');
  const fences = [...sources.get(shellFence.source).matchAll(/^```sh\n([^\n]+)\n^```$/gm)];
  assert.deepEqual(fences.map(([, command]) => command), [shellFence.command]);
  assert.match(shellFence.command, /^printf /);
});
