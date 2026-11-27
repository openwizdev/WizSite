import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const ROOT = new URL('../', import.meta.url);
export const START = '<!-- releases:start -->';
export const END = '<!-- releases:end -->';
export const REPO = 'openwizdev/OpenWiz';
export const PRE_RELEASES = `https://github.com/${REPO}/releases`;
export const RELEASE_DIR = new URL('changelog/releases/', ROOT);
export const STATS_FILE = new URL('changelog/stats.json', ROOT);
export const STAT_FIELDS = ['published', 'previous', 'prs', 'commits', 'added', 'removed', 'changes', 'security'];
const COUNTS = STAT_FIELDS.slice(2);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const version = semver => String(semver).split('.').map(Number);
const order = (a, b) => { const [x, y] = [version(a), version(b)]; return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; };
const newer = (a, b) => order(a.semver, b.semver);
const count = n => n.toLocaleString('en-US');
const plural = (n, one, many) => `${count(n)} ${n === 1 ? one : many}`;
export const tag = release => `v${release.semver}`;
export const anchor = release => `v${release.name.replaceAll('.', '-')}`;
export const day = iso => { const [y, m, d] = String(iso).split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };

function checkStats(key, stats, release) {
  const where = `changelog stats ${key}`;
  if (!release) throw new Error(`${where}: no release data file has this tag`);
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) throw new Error(`${where}: one object per tag`);
  const extra = Object.keys(stats).filter(field => !STAT_FIELDS.includes(field));
  if (extra.length) throw new Error(`${where}: unexpected fields ${extra.join(', ')}`);
  for (const field of COUNTS) {
    if (field in stats && !(Number.isInteger(stats[field]) && stats[field] >= 0)) throw new Error(`${where}: ${field} is a whole number`);
  }
  if ('published' in stats) {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(String(stats.published))) throw new Error(`${where}: published is a UTC time like 2026-11-21T08:00:18Z`);
    if (stats.published.slice(0, 10) !== release.date) throw new Error(`${where}: published on ${stats.published.slice(0, 10)}, but the data file says ${release.date}`);
  }
  if ('previous' in stats && stats.previous !== null && !/^v\d+\.\d+\.\d+$/.test(String(stats.previous))) throw new Error(`${where}: previous is a tag like v0.0.12, or null`);
  if (('added' in stats) !== ('removed' in stats)) throw new Error(`${where}: added and removed come together`);
}

export async function readStats(file = STATS_FILE) {
  if (!file) return {};
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

export async function readReleases(dir = RELEASE_DIR, statsFile = String(dir) === String(RELEASE_DIR) ? STATS_FILE : null) {
  const names = (await readdir(dir)).filter(name => name.endsWith('.json')).sort();
  const list = await Promise.all(names.map(async name => JSON.parse(await readFile(new URL(name, dir), 'utf8'))));
  const stats = await readStats(statsFile);
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) throw new Error('changelog stats: one object, keyed by release tag');
  const byTag = new Map(list.map(release => [tag(release), release]));
  for (const [key, value] of Object.entries(stats)) checkStats(key, value, byTag.get(key));
  return list.map(release => ({ ...release, stats: stats[tag(release)] || {} })).sort(newer);
}

export function installSwitch(landing) {
  const found = landing.match(/<div class="install-box" data-install="([^"]*)"/g) || [];
  if (found.length !== 1) throw new Error('the landing needs exactly one install box switch');
  return /data-install="([^"]*)"/.exec(found[0])[1];
}

export function facts(stats = {}) {
  const parts = [];
  if (stats.published) parts.push(`${stats.published.slice(11, 16)} UTC`);
  if (Number.isInteger(stats.prs)) parts.push(`${plural(stats.prs, 'PR', 'PRs')} merged`);
  if (Number.isInteger(stats.commits)) parts.push(plural(stats.commits, 'commit', 'commits'));
  if (Number.isInteger(stats.added) && Number.isInteger(stats.removed)) parts.push(`+${count(stats.added)} \u2212${count(stats.removed)} lines`);
  return parts.join(' \u00b7 ');
}

export const picked = release => Number.isInteger(release.stats?.changes) && release.stats.changes > release.bullets.length
  ? `Top ${release.bullets.length} of ${count(release.stats.changes)} changes` : '';

const entry = release => {
  const id = anchor(release);
  const row = facts(release.stats);
  const top = picked(release);
  return `<article class="release" aria-labelledby="${id}"><h2 id="${id}">${esc(release.name)} <small>· <time datetime="${esc(release.date)}">${day(release.date)}</time> (${esc(release.semver)})</small></h2>`
    + (row ? `<p class="facts">${esc(row)}</p>` : '')
    + `<p class="headline">${esc(release.headline)}</p>`
    + (top ? `<p class="picked">${esc(top)}</p>` : '')
    + `<ul>${release.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`
    + (release.stats?.security > 0 ? '<p class="security">Also includes security fixes.</p>' : '')
    + `<p class="notes"><a href="${esc(release.notes)}" data-count="github">Full release on GitHub</a></p></article>`;
};

export function render(list, live) {
  const shown = live ? list : [];
  const pre = shown.length
    ? `<p class="pre">Earlier pre-releases are on <a href="${PRE_RELEASES}" data-count="github">GitHub</a>.</p>`
    : `<p class="pre">No public release yet. The pre-releases are on <a href="${PRE_RELEASES}" data-count="github">GitHub</a>.</p>`;
  return `<section class="releases" aria-label="Releases">${shown.map(entry).join('')}${pre}</section>`;
}

export function withReleases(page, section) {
  if (page.includes(START) || page.split('</main>').length !== 2) throw new Error('changelog page: expected one </main> and no generated section');
  return page.replace('</main>', () => `${START}${section}${END}</main>`);
}

export const summary = (list, live) => live ? `${list.length} release${list.length === 1 ? '' : 's'}` : `none shown until the install switch reads live (${list.length} waiting)`;

export function previousTag(releases, current) {
  const semver = name => /^v(\d+\.\d+\.\d+)$/.exec(name)?.[1];
  const mine = semver(current);
  const older = releases.filter(r => !r.draft && semver(r.tag) && order(semver(r.tag), mine) > 0).map(r => semver(r.tag)).sort(order);
  return older.length ? `v${older[0]}` : null;
}

export function noteCounts(body) {
  let changes = 0, security = 0, inSecurity = false;
  for (const line of String(body || '').split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line) || /^\*\*([^*]+)\*\*\s*$/.exec(line.trim());
    if (heading) inSecurity = /^security\b/i.test(heading[1].trim());
    else if (/^(?:[-*+]|\d+[.)])\s+\S/.test(line)) {
      changes += 1;
      if (inSecurity) security += 1;
    }
  }
  return { changes, security };
}

export const shortstat = text => {
  const n = pattern => Number(pattern.exec(text)?.[1] || 0);
  return { added: n(/(\d+) insertions?\(\+\)/), removed: n(/(\d+) deletions?\(-\)/) };
};

const run = promisify(execFile);
const output = async (command, args, options = {}) => (await run(command, args, { maxBuffer: 1 << 28, ...options })).stdout;

export async function rangeStats(gitDir, previous, current, mergeCommits) {
  const git = (...args) => output('git', ['--git-dir', gitDir, ...args]);
  const range = previous ? [`${previous}..${current}`] : [current];
  const shas = new Set((await git('rev-list', ...range)).split('\n').filter(Boolean));
  const base = previous ? (await git('merge-base', previous, current)).trim() : EMPTY_TREE;
  const lines = shortstat(await git('diff', '-l0', '--shortstat', base, current));
  return { prs: [...mergeCommits].filter(sha => shas.has(sha)).length, commits: shas.size, ...lines };
}

async function refreshStats(file = STATS_FILE) {
  const gh = async (...args) => (await output('gh', ['api', '--paginate', ...args])).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const releases = await gh(`repos/${REPO}/releases?per_page=100`, '--jq', '.[] | {tag: .tag_name, draft, published: .published_at, body} | @json');
  const merged = new Set((await gh(`repos/${REPO}/pulls?state=closed&per_page=100`, '--jq', '.[] | select(.merged_at != null) | .merge_commit_sha | @json')));
  const work = await mkdtemp(join(tmpdir(), 'changelog-stats-'));
  try {
    const gitDir = join(work, 'repo.git');
    await output('git', ['clone', '--quiet', '--bare', `https://github.com/${REPO}.git`, gitDir], { timeout: 300_000 });
    const out = {};
    const list = await readReleases(RELEASE_DIR, null);
    for (const release of list) {
      const published = releases.find(r => r.tag === tag(release) && !r.draft);
      if (!published) throw new Error(`${tag(release)} has no published release on GitHub`);
      const previous = previousTag(releases, tag(release));
      out[tag(release)] = {
        published: published.published.replace(/\.\d+Z$/, 'Z'),
        previous,
        ...await rangeStats(gitDir, previous, tag(release), merged),
        ...noteCounts(published.body),
      };
      checkStats(tag(release), out[tag(release)], release);
      console.error(`${tag(release)}: ${facts(out[tag(release)])} (since ${previous || 'the first commit'})`);
    }
    await writeFile(file, `${JSON.stringify(out, null, 2)}\n`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let dir, statsFile, sw, page, refresh = false;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--releases') dir = pathToFileURL(args.shift().replace(/\/?$/, '/'));
    else if (arg === '--stats') statsFile = pathToFileURL(args.shift());
    else if (arg === '--switch') sw = args.shift();
    else if (arg === '--refresh-stats') refresh = true;
    else page = arg;
  }
  if (refresh) {
    await refreshStats(statsFile);
  } else {
    sw ??= installSwitch(await readFile(new URL('index.html', ROOT), 'utf8'));
    const section = render(await readReleases(dir || RELEASE_DIR, statsFile), sw === 'live');
    process.stdout.write(page ? withReleases(await readFile(page, 'utf8'), section) : section);
  }
}
