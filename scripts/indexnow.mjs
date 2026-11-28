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
  if (urls.length > MAX_URLS) throw new Error(`at most ${MAX_URLS} URLs per request`);
  return { host, key, keyLocation: `${SITE}${key}.txt`, urlList: urls };
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
  if (arg('--live') && previous) {
    log('IndexNow: use --live or --previous, not both: --previous <file> alone carries unsent URLs over to later runs');
    return 2;
  }
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
  const batch = urls.slice(0, MAX_URLS);
  log(`IndexNow: ${urls.length} changed of ${now.size} URLs`);
  for (const url of dryRun ? urls : batch) log('  ' + url);
  if (dryRun) return 0;
  if (urls.length > batch.length && !previous) {
    log(`IndexNow: ${urls.length} changed URLs is over the ${MAX_URLS} per request; run with --previous <file> instead of --live, so the rest go on later runs`);
    return 1;
  }
  if (urls.length > batch.length) log(`IndexNow: sending the first ${batch.length}; the other ${urls.length - batch.length} wait for the next run`);
  const saveBaseline = async sentUrls => {
    if (!previous) return;
    const saved = new Map(before);
    for (const url of sentUrls) saved.set(url, now.get(url));
    for (const url of before.keys()) if (!now.has(url)) saved.delete(url);
    await writeFile(previous, JSON.stringify(Object.fromEntries(saved), null, 1) + '\n');
  };
  if (urls.length === 0) {
    await saveBaseline([]);
    return 0;
  }
  const status = await submit(batch, key, { endpoint: arg('--endpoint') ?? ENDPOINT, fetchImpl });
  log(`IndexNow answered ${status}`);
  const sent = status === 200 || status === 202;
  if (sent) await saveBaseline(batch);
  return sent ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
