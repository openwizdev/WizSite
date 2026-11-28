import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedUrls, findKey, main, payload, sitemapUrls, submit } from '../scripts/indexnow.mjs';

const fixtures = fileURLToPath(new URL('./indexnow-fixtures/', import.meta.url));
const dist = join(fixtures, 'dist');
const key = '0123456789abcdef0123456789abcdef';
const fakeFetch = status => {
  const calls = [];
  const impl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), method: init.method }); return { status }; };
  return { calls, impl };
};

test('follows a sitemap index into its section sitemaps', async () => {
  const read = async url => readFile(join(dist, url.replace('https://openwiz.dev/', '')), 'utf8');
  const urls = await sitemapUrls('https://openwiz.dev/sitemap.xml', read);
  assert.deepEqual([...urls.keys()].sort(), ['https://openwiz.dev/', 'https://openwiz.dev/faq/', 'https://openwiz.dev/guides/synthetic-answer/']);
});

test('reads a plain sitemap too', async () => {
  const urls = await sitemapUrls('x', async () => readFile(join(fixtures, 'live/plain-sitemap.xml'), 'utf8'));
  assert.equal(urls.get('https://openwiz.dev/'), '2026-11-21');
});

test('lists exactly the new and changed URLs', () => {
  const now = new Map([['https://openwiz.dev/', '2026-11-28'], ['https://openwiz.dev/faq/', '2026-11-20'], ['https://openwiz.dev/new/', '2026-11-28']]);
  const before = new Map([['https://openwiz.dev/', '2026-11-21'], ['https://openwiz.dev/faq/', '2026-11-20']]);
  assert.deepEqual(changedUrls(now, before), ['https://openwiz.dev/', 'https://openwiz.dev/new/']);
});

test('finds the one key file whose content is its name', async () => {
  assert.equal(await findKey(dist), key);
});

test('the payload names the host, key and key location, and refuses another host', () => {
  assert.deepEqual(payload(['https://openwiz.dev/'], key), {
    host: 'openwiz.dev', key, keyLocation: `https://openwiz.dev/${key}.txt`, urlList: ['https://openwiz.dev/'],
  });
  assert.throws(() => payload(['https://example.com/'], key), /every URL must be on openwiz.dev/);
});

test('submit posts JSON to the endpoint and returns the status', async () => {
  const fake = fakeFetch(202);
  assert.equal(await submit(['https://openwiz.dev/'], key, { endpoint: 'https://indexnow.test/indexnow', fetchImpl: fake.impl }), 202);
  assert.equal(fake.calls[0].url, 'https://indexnow.test/indexnow');
  assert.equal(fake.calls[0].method, 'POST');
});

test('a run sends only the changed URLs and records the sitemap for next time', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'indexnow-'));
  const previous = join(dir, 'previous.json');
  await copyFile(join(fixtures, 'previous.json'), previous);
  const fake = fakeFetch(200);
  const lines = [];
  assert.equal(await main(['--dist', dist, '--previous', previous], { fetchImpl: fake.impl, log: line => lines.push(line) }), 0);
  assert.deepEqual(fake.calls[0].body.urlList, ['https://openwiz.dev/', 'https://openwiz.dev/guides/synthetic-answer/']);
  const saved = JSON.parse(await readFile(previous, 'utf8'));
  assert.equal(saved['https://openwiz.dev/'], '2026-11-28');
  const again = fakeFetch(200);
  assert.equal(await main(['--dist', dist, '--previous', previous], { fetchImpl: again.impl, log: () => {} }), 0);
  assert.equal(again.calls.length, 0);
});

test('--dry-run sends nothing; a refused request exits 1', async () => {
  const dry = fakeFetch(200);
  assert.equal(await main(['--dist', dist, '--dry-run'], { fetchImpl: dry.impl, log: () => {} }), 0);
  assert.equal(dry.calls.length, 0);
  const refused = fakeFetch(403);
  const lines = [];
  assert.equal(await main(['--dist', dist], { fetchImpl: refused.impl, log: line => lines.push(line) }), 1);
  assert.match(lines.at(-1), /403/);
});

test('--live compares with the sitemap the site served before the deploy', async () => {
  const live = await readFile(join(fixtures, 'live/plain-sitemap.xml'), 'utf8');
  const posts = [];
  const impl = async (url, init) => {
    if (!init) return { status: 200, text: async () => live };
    posts.push(JSON.parse(init.body));
    return { status: 202 };
  };
  assert.equal(await main(['--dist', dist, '--live', 'https://openwiz.dev/sitemap.xml'], { fetchImpl: impl, log: () => {} }), 0);
  assert.deepEqual(posts[0].urlList, ['https://openwiz.dev/', 'https://openwiz.dev/guides/synthetic-answer/']);
});

test('a refused request keeps the baseline, so the retry sends the same URLs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'indexnow-'));
  const previous = join(dir, 'previous.json');
  await copyFile(join(fixtures, 'previous.json'), previous);
  const refused = fakeFetch(403);
  assert.equal(await main(['--dist', dist, '--previous', previous], { fetchImpl: refused.impl, log: () => {} }), 1);
  const retry = fakeFetch(202);
  assert.equal(await main(['--dist', dist, '--previous', previous], { fetchImpl: retry.impl, log: () => {} }), 0);
  assert.deepEqual(retry.calls[0].body.urlList, ['https://openwiz.dev/', 'https://openwiz.dev/guides/synthetic-answer/']);
});

test('over 10,000 changed URLs: the first 10,000 go now and the rest on the next run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'indexnow-big-'));
  const big = join(dir, 'dist');
  await mkdir(join(big), { recursive: true });
  await copyFile(join(dist, `${key}.txt`), join(big, `${key}.txt`));
  const urls = Array.from({ length: 10_001 }, (_, i) => `  <url><loc>https://openwiz.dev/p/${String(i).padStart(5, '0')}/</loc><lastmod>2026-11-28</lastmod></url>`);
  await writeFile(join(big, 'sitemap.xml'), `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
  const previous = join(dir, 'previous.json');
  const first = fakeFetch(200);
  assert.equal(await main(['--dist', big, '--previous', previous], { fetchImpl: first.impl, log: () => {} }), 0);
  assert.equal(first.calls[0].body.urlList.length, 10_000);
  const second = fakeFetch(200);
  assert.equal(await main(['--dist', big, '--previous', previous], { fetchImpl: second.impl, log: () => {} }), 0);
  assert.deepEqual(second.calls[0].body.urlList, ['https://openwiz.dev/p/10000/']);
});

test('--live with over 10,000 changed URLs sends nothing and says to use --previous; --dry-run lists them all', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'indexnow-live-big-'));
  const big = join(dir, 'dist');
  await mkdir(big, { recursive: true });
  await copyFile(join(dist, `${key}.txt`), join(big, `${key}.txt`));
  const urls = Array.from({ length: 10_001 }, (_, i) => `  <url><loc>https://openwiz.dev/p/${i}/</loc><lastmod>2026-11-28</lastmod></url>`);
  await writeFile(join(big, 'sitemap.xml'), `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
  const empty = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';
  const posts = [];
  const impl = async (url, init) => { if (!init) return { status: 200, text: async () => empty }; posts.push(init); return { status: 200 }; };
  const lines = [];
  assert.equal(await main(['--dist', big, '--live', 'https://openwiz.dev/sitemap.xml'], { fetchImpl: impl, log: line => lines.push(line) }), 1);
  assert.equal(posts.length, 0);
  assert.match(lines.at(-1), /--previous/);
  const listed = [];
  assert.equal(await main(['--dist', big, '--dry-run'], { fetchImpl: impl, log: line => listed.push(line) }), 0);
  assert.equal(listed.filter(line => line.startsWith('  https://')).length, 10_001);
});

test('a deploy that only removes a page updates the baseline, so restoring it is sent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'indexnow-restore-'));
  const site = join(dir, 'dist');
  await mkdir(site, { recursive: true });
  await copyFile(join(dist, `${key}.txt`), join(site, `${key}.txt`));
  const map = pages => `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(p => `  <url><loc>https://openwiz.dev/${p}/</loc><lastmod>2026-11-20</lastmod></url>`).join('\n')}\n</urlset>\n`;
  const previous = join(dir, 'previous.json');
  await writeFile(join(site, 'sitemap.xml'), map(['a', 'b']));
  assert.equal(await main(['--dist', site, '--previous', previous], { fetchImpl: fakeFetch(200).impl, log: () => {} }), 0);
  await writeFile(join(site, 'sitemap.xml'), map(['a']));
  const removed = fakeFetch(200);
  assert.equal(await main(['--dist', site, '--previous', previous], { fetchImpl: removed.impl, log: () => {} }), 0);
  assert.equal(removed.calls.length, 0);
  await writeFile(join(site, 'sitemap.xml'), map(['a', 'b']));
  const restored = fakeFetch(200);
  assert.equal(await main(['--dist', site, '--previous', previous], { fetchImpl: restored.impl, log: () => {} }), 0);
  assert.deepEqual(restored.calls[0].body.urlList, ['https://openwiz.dev/b/']);
});
