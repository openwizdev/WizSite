import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE = 'https://openwiz.dev/';
export const ENDPOINT = 'https://api.indexnow.org/indexnow';
const MAX_URLS = 10_000;

const locs = xml => [...xml.matchAll(/<(url|sitemap)>([\s\S]*?)<\/\1>/g)].map(([, , entry]) => ({
  loc: (entry.match(/<loc>\s*([^<\s]+)\s*<\/loc>/) || [])[1],
  lastmod: (entry.match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/) || [])[1] || '',
})).filter(entry => entry.loc);

export async function sitemapUrls(rootUrl, read) {
  const out = new Map();
  const seen = new Set();
  const walk = async url => {
    if (seen.has(url)) return;
    seen.add(url);
    const xml = await read(url);
    if (/<sitemapindex\b/.test(xml)) {
      for (const child of locs(xml)) await walk(child.loc);
    } else {
      for (const { loc, lastmod } of locs(xml)) out.set(loc, lastmod);
    }
  };
  await walk(rootUrl);
  return out;
}

export function changedUrls(now, before) {
  return [...now].filter(([url, lastmod]) => !before.has(url) || before.get(url) !== lastmod).map(([url]) => url).sort();
}

export async function findKey(dist) {
  const found = [];
  for (const name of await readdir(dist)) {
    const match = name.match(/^([0-9a-f]{32})\.txt$/);
    if (match && (await readFile(join(dist, name), 'utf8')).trim() === match[1]) found.push(match[1]);
  }
  if (found.length !== 1) throw new Error(`expected one IndexNow key file in ${dist}, found ${found.length}`);
  return found[0];
}

export function payload(urls, key) {
  const host = new URL(SITE).host;
  if (urls.some(url => new URL(url).host !== host)) throw new Error('every URL must be on ' + host);
  return { host, key, keyLocation: `${SITE}${key}.txt`, urlList: urls.slice(0, MAX_URLS) };
}

export async function submit(urls, key, { endpoint = ENDPOINT, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload(urls, key)),
  });
  return response.status;
}

const fileReader = dist => async url => {
  if (!url.startsWith(SITE)) throw new Error(`sitemap outside the site: ${url}`);
  return readFile(join(dist, url.slice(SITE.length)), 'utf8');
};

export async function main(argv, { fetchImpl = fetch, log = console.log } = {}) {
  const arg = name => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
  const dist = arg('--dist') ?? fileURLToPath(new URL('../dist/', import.meta.url));
  const previous = arg('--previous');
  const dryRun = argv.includes('--dry-run');
  const key = await findKey(dist);
  const now = await sitemapUrls(SITE + 'sitemap.xml', fileReader(dist));
  let before = new Map();
  const live = arg('--live');
  if (live) {
    before = await sitemapUrls(live, async url => {
      const response = await fetchImpl(url);
      if (response.status !== 200) throw new Error(`live sitemap ${url} answered ${response.status}`);
      return response.text();
    });
  } else if (previous) {
    try { before = new Map(Object.entries(JSON.parse(await readFile(previous, 'utf8')))); } catch { before = new Map(); }
  }
  const urls = changedUrls(now, before);
  if (previous && !dryRun) await writeFile(previous, JSON.stringify(Object.fromEntries(now), null, 1) + '\n');
  log(`IndexNow: ${urls.length} changed of ${now.size} URLs`);
  for (const url of urls) log('  ' + url);
  if (urls.length === 0 || dryRun) return 0;
  const status = await submit(urls, key, { endpoint: arg('--endpoint') ?? ENDPOINT, fetchImpl });
  log(`IndexNow answered ${status}`);
  return status === 200 || status === 202 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
