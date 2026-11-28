import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pages } from './discovery.mjs';

export const FILE = new URL('../counters/daily.json', import.meta.url);
export const PAGE = 'counters/index.html';
export const START = '<!-- counters:start -->';
export const END = '<!-- counters:end -->';
const SLOT = '<template data-slot="counters"></template>';
const PLATFORM = 'https://api.cloudflare.com/client/v4/';
const RELEASES = 'https://api.github.com/repos/openwizdev/OpenWiz/releases';
const SETTINGS = ['WIZ_COUNTERS_TOKEN', 'WIZ_COUNTERS_ACCOUNT', 'WIZ_COUNTERS_SITE', 'WIZ_COUNTERS_DATASET'];
const DAYS = 7;
const GROUP_LIMIT = 10000;
const PER_PAGE = 100;
const DOWNLOADS = 'downloads';
const CLICKS = { 'install-in-wiz': 'click:install-in-wiz', 'install-copy': 'click:install-copy' };
const VIEWS_QUERY = `query Counters($account: string!, $site: string!, $since: Date!, $until: Date!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      rumPageloadEventsAdaptiveGroups(limit: ${GROUP_LIMIT}, filter: { siteTag: $site, date_geq: $since, date_leq: $until }) {
        count
        dimensions { date requestPath }
      }
    }
  }
}`;

const sitePaths = new Set(Object.entries(pages).filter(([, [, , robots]]) => !robots).map(([page]) => '/' + page.replace(/index\.html$/, '')));
const isDocs = page => page === '/docs/' || /^\/docs\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*\/$/.test(page) && page.length <= 200;
const isView = page => sitePaths.has(page) || isDocs(page);
const isPage = page => isView(page) || page === DOWNLOADS || Object.values(CLICKS).includes(page);
const isDate = text => typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(text + 'T00:00:00Z').toISOString().startsWith(text);
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const day = (date, shift = 0) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + shift)).toISOString().slice(0, 10);
const sorted = rows => [...rows].sort((a, b) => a.date.localeCompare(b.date) || (a.page < b.page ? -1 : a.page > b.page ? 1 : 0));

function servedPath(path) {
  if (typeof path !== 'string') return;
  const page = path.endsWith('/') || path === '' ? path : path + '/';
  return isView(page) ? page : undefined;
}

function folded(entries) {
  const counts = new Map();
  for (const [date, page, count] of entries) {
    const key = `${date} ${page}`;
    counts.set(key, (counts.get(key) ?? 0) + count);
  }
  return sorted([...counts].filter(([, count]) => count > 0).map(([key, count]) => {
    const [date, page] = key.split(' ');
    return { date, page, count };
  }));
}

export function validate(rows) {
  const refuse = why => { throw new Error(`counters/daily.json: ${why}`); };
  if (!Array.isArray(rows)) refuse('expected a list of rows');
  const seen = new Set();
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) refuse(`row ${index + 1} is not a row`);
    if (Object.keys(row).sort().join() !== 'count,date,page') refuse(`row ${index + 1} must hold exactly date, page and count`);
    if (!isDate(row.date)) refuse(`row ${index + 1} has no real date`);
    if (typeof row.page !== 'string' || !isPage(row.page)) refuse(`row ${index + 1} names no page, install click or downloads`);
    if (!isCount(row.count)) refuse(`row ${index + 1} has no whole count`);
    const key = `${row.date} ${row.page}`;
    if (seen.has(key)) refuse(`row ${index + 1} repeats a date and page`);
    seen.add(key);
  });
  return rows;
}

export function pageViews(answer) {
  const refuse = why => { throw new Error(`Counters: the platform's answer for page views ${why}`); };
  if (answer?.errors?.length) refuse('carries errors');
  const accounts = answer?.data?.viewer?.accounts;
  const groups = Array.isArray(accounts) && accounts.length === 1 ? accounts[0]?.rumPageloadEventsAdaptiveGroups : undefined;
  if (!Array.isArray(groups)) refuse('has no groups for one account');
  if (groups.length >= GROUP_LIMIT) refuse(`is full at ${GROUP_LIMIT} groups, so some would be missing`);
  return folded(groups.flatMap(group => {
    const { date, requestPath } = group?.dimensions ?? {};
    if (!isDate(date) || !isCount(group.count)) refuse('holds a group without a date and a whole count');
    const page = servedPath(requestPath);
    return page ? [[date, page, group.count]] : [];
  }));
}

export function clicks(answer) {
  const refuse = why => { throw new Error(`Counters: the platform's answer for clicks ${why}`); };
  if (!Array.isArray(answer?.data)) refuse('has no rows');
  return folded(answer.data.flatMap(row => {
    const count = typeof row?.count === 'string' && /^\d+$/.test(row.count) ? Number(row.count) : row?.count;
    if (!isDate(row?.date) || typeof row.action !== 'string' || !isCount(count)) refuse('holds a row without a date, an action and a whole count');
    return Object.hasOwn(CLICKS, row.action) ? [[row.date, CLICKS[row.action], count]] : [];
  }));
}

export function downloads(releases) {
  const refuse = why => { throw new Error(`Counters: GitHub's answer for release downloads ${why}`); };
  if (!Array.isArray(releases)) refuse('is not a list of releases');
  let total = 0;
  for (const release of releases) {
    if (!Array.isArray(release?.assets)) refuse('holds a release without its assets');
    for (const asset of release.assets) {
      if (!isCount(asset?.download_count)) refuse('holds an asset without a whole download count');
      total += asset.download_count;
    }
  }
  return total;
}

export function merge(before, fresh, { since, until, today, downloads: total }) {
  const reread = row => row.page === DOWNLOADS ? row.date === today : row.date >= since && row.date <= until;
  const kept = before.filter(row => !reread(row));
  const counted = kept.filter(row => row.page === DOWNLOADS).reduce((sum, row) => sum + row.count, 0);
  const added = total > counted ? [{ date: today, page: DOWNLOADS, count: total - counted }] : [];
  return validate(sorted([...kept, ...fresh, ...added]));
}

async function ask(fetch, what, url, init) {
  let response, answer;
  try {
    response = await fetch(url, init);
    answer = response.ok ? await response.json() : undefined;
  } catch {
    throw new Error(`Counters: could not read ${what}`);
  }
  if (!response.ok) throw new Error(`Counters: could not read ${what}: status ${response.status}`);
  return answer;
}

async function collect({ settings, fetch, since, until, today }) {
  const [token, account, site, dataset] = settings;
  const platform = body => ({ method: 'POST', headers: { Authorization: `Bearer ${token}`, ...body.headers }, body: body.text });
  const views = await ask(fetch, 'page views', PLATFORM + 'graphql', platform({
    headers: { 'Content-Type': 'application/json' },
    text: JSON.stringify({ query: VIEWS_QUERY, variables: { account, site, since, until } }),
  }));
  const sql = `SELECT formatDateTime(timestamp, '%Y-%m-%d') AS date, blob1 AS action, SUM(_sample_interval * double1) AS count FROM ${dataset}`
    + ` WHERE timestamp >= toDateTime('${since} 00:00:00') AND timestamp < toDateTime('${today} 00:00:00') GROUP BY date, action FORMAT JSON`;
  const clicked = await ask(fetch, 'clicks', `${PLATFORM}accounts/${encodeURIComponent(account)}/analytics_engine/sql`, platform({ headers: { 'Content-Type': 'text/plain' }, text: sql }));
  const releases = [];
  for (let page = 1; ; page += 1) {
    const some = await ask(fetch, 'release downloads', `${RELEASES}?per_page=${PER_PAGE}&page=${page}`,
      { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'wizsite-counters' } });
    if (!Array.isArray(some)) throw new Error("Counters: GitHub's answer for release downloads is not a list of releases");
    releases.push(...some);
    if (some.length < PER_PAGE) break;
  }
  return { fresh: [...pageViews(views), ...clicks(clicked)], total: downloads(releases) };
}

export async function readDaily(file = FILE) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return validate(JSON.parse(text));
}

export async function run({ env, fetch, now = new Date(), file = FILE, log = console.log }) {
  const missing = SETTINGS.filter(name => !env[name]);
  if (missing.length) throw new Error(`Counters: set ${missing.join(', ')} in the environment`);
  const settings = SETTINGS.map(name => env[name]);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(settings[3])) throw new Error('Counters: WIZ_COUNTERS_DATASET must be a plain dataset name');
  const window = { since: day(now, -DAYS), until: day(now, -1), today: day(now) };
  const { fresh, total } = await collect({ settings, fetch, ...window });
  const rows = merge(await readDaily(file), fresh, { ...window, downloads: total });
  const path = file instanceof URL ? fileURLToPath(file) : file;
  await writeFile(path + '.tmp', JSON.stringify(rows, null, 2) + '\n');
  await rename(path + '.tmp', path);
  log(summary(rows));
  return rows;
}

export function totals(rows) {
  const sum = keep => rows.filter(row => keep(row.page)).reduce((total, row) => total + row.count, 0);
  const dates = rows.map(row => row.date).sort();
  return {
    site: sum(page => page.startsWith('/') && !isDocs(page)), docs: sum(isDocs),
    installInWiz: sum(page => page === CLICKS['install-in-wiz']), installCopy: sum(page => page === CLICKS['install-copy']),
    downloads: sum(page => page === DOWNLOADS), since: dates[0] ?? null, until: dates.at(-1) ?? null,
  };
}

export const summary = rows => rows.length
  ? `Counters: ${rows.length} row${rows.length === 1 ? '' : 's'}, ${totals(rows).since} to ${totals(rows).until}`
  : 'Counters: no counts yet';

export function render(rows) {
  const total = totals(rows);
  const line = (label, count) => `<li>${label}: <strong>${count.toLocaleString('en-US')}</strong></li>`;
  const span = total.since ? `Counted from <time datetime="${total.since}">${total.since}</time> to <time datetime="${total.until}">${total.until}</time>.` : 'No counts yet.';
  return '<ul>' + line('Site page views', total.site) + line('Docs page views', total.docs) + line('“Install in Wiz” clicks', total.installInWiz)
    + line('Install line copies', total.installCopy) + line('Release downloads', total.downloads) + `</ul><p>${span}</p>`;
}

export function withCounters(page, section) {
  if (page.includes(START) || page.split(SLOT).length !== 2) throw new Error('counters page: expected one counters slot and no generated section');
  return page.replace(SLOT, () => `${START}${section}${END}`);
}

async function main(args) {
  const options = {};
  for (let at = 0; at < args.length; at += 2) {
    if (!['--fixtures', '--out', '--today'].includes(args[at]) || args[at + 1] === undefined) {
      throw new Error('Counters: usage: node scripts/counters.mjs [--fixtures <folder>] [--out <file>] [--today <YYYY-MM-DD>]');
    }
    options[args[at].slice(2)] = args[at + 1];
  }
  if (options.today !== undefined && !isDate(options.today)) throw new Error('Counters: --today needs a real date, YYYY-MM-DD');
  const saved = name => async () => new Response(await readFile(new URL(name, pathToFileURL(options.fixtures + '/'))), { status: 200 });
  const answers = { 'api.github.com': saved('releases.json'), graphql: saved('pageviews.json'), sql: saved('clicks.json') };
  const fromFixtures = url => (answers[new URL(url).hostname] ?? answers[new URL(url).pathname.split('/').at(-1)])();
  await run({
    env: process.env, fetch: options.fixtures ? fromFixtures : globalThis.fetch,
    now: options.today ? new Date(options.today + 'T00:00:00Z') : new Date(), file: options.out ?? FILE,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
