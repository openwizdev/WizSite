import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
export const START = '<!-- releases:start -->';
export const END = '<!-- releases:end -->';
export const PRE_RELEASES = 'https://github.com/openwizdev/OpenWiz/releases';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SNAPSHOT = new URL('changelog/stats.json', ROOT);
const count = new Intl.NumberFormat('en-US');
const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const shownReleases = (list, live) => list.filter(release => live || release.product === 'WizSkills');

function releaseTime(published) {
  const [y, m, d] = published.slice(0, 10).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y} · ${published.slice(11, 16)} UTC`;
}

export async function readReleases(dir = new URL('changelog/releases/', ROOT)) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const files = entries.filter(entry => entry.isFile() && entry.name.endsWith('.json'));
  const list = await Promise.all(files.map(async file => JSON.parse(await readFile(`${file.parentPath}/${file.name}`, 'utf8'))));
  return list.sort((a, b) => b.published.localeCompare(a.published) || a.product.localeCompare(b.product) || a.semver.localeCompare(b.semver));
}

export const readSnapshot = async (path = SNAPSHOT) => JSON.parse(await readFile(path, 'utf8'));

export function installSwitch(landing) {
  const found = landing.match(/<div class="install-box" data-install="([^"]*)"/g) || [];
  if (found.length !== 1) throw new Error('the landing needs exactly one install box switch');
  return /data-install="([^"]*)"/.exec(found[0])[1];
}

function statsBlock(stats) {
  if (!stats) return '<p class="release-scope">Release stats unavailable.</p>';
  const added = count.format(stats.added);
  const removed = count.format(stats.removed);
  return '<div class="release-metrics"><dl class="release-stats">'
    + `<div><dt>Pull requests merged</dt><dd>${count.format(stats.prs)}</dd></div>`
    + `<div><dt>Commits</dt><dd>${count.format(stats.commits)}</dd></div>`
    + '<div><dt>Lines changed</dt><dd class="release-lines">'
    + `<span class="release-added" aria-hidden="true">+${added}</span> <span class="release-removed" aria-hidden="true">−${removed}</span>`
    + `<span class="release-sr">${added} lines added, ${removed} removed</span></dd></div></dl>`
    + (stats.prev === null ? '<p class="release-scope">since the first commit</p>' : '')
    + '</div>';
}

function entry(release, stats) {
  const tag = `v${release.semver}`;
  const id = `release-${release.product.toLowerCase()}-${release.name.replaceAll('.', '-')}`;
  return `<article class="release" aria-labelledby="${esc(id)}"><div class="release-band"><div class="release-version">`
    + `<h2 id="${esc(id)}"><span class="release-product">${esc(release.product)}</span> <span class="release-number">${esc(release.name)}</span></h2>`
    + `<p class="release-date"><time datetime="${esc(release.published)}">${releaseTime(release.published)}</time> · ${esc(tag)}</p></div>`
    + statsBlock(stats) + '</div><div class="release-copy">'
    + `<p class="headline">${esc(release.headline)}</p>`
    + `<ul>${release.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`
    + `<p class="notes"><a href="${esc(release.notes)}">Full notes on GitHub</a></p></div></article>`;
}

export function render(list, live, { products, source }) {
  const shown = shownReleases(list, live);
  const pre = shown.some(release => release.product === 'OpenWiz')
    ? `<p class="pre">Earlier OpenWiz pre-releases are on <a href="${PRE_RELEASES}">GitHub</a>.</p>`
    : `<p class="pre">No public OpenWiz release yet. The pre-releases are on <a href="${PRE_RELEASES}">GitHub</a>.</p>`;
  const cards = shown.map(release => entry(release, products[release.product]?.[`v${release.semver}`])).join('');
  return `<section class="releases" aria-label="Releases" data-stats-source="${source}">${cards}${pre}</section>`;
}

export function withReleases(page, section) {
  if (page.includes(START) || page.split('</main>').length !== 2) throw new Error('changelog page: expected one </main> and no generated section');
  return page.replace('</main>', () => `${START}${section}${END}</main>`);
}

export function summary(list, live) {
  const shown = shownReleases(list, live).length;
  return `${shown} release${shown === 1 ? '' : 's'}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let dir, sw, page, stats;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--releases') dir = pathToFileURL(args.shift());
    else if (arg === '--switch') sw = args.shift();
    else if (arg === '--stats') stats = pathToFileURL(args.shift());
    else page = arg;
  }
  sw ??= installSwitch(await readFile(new URL('index.html', ROOT), 'utf8'));
  const section = render(await readReleases(dir), sw === 'live', { ...await readSnapshot(stats), source: 'snapshot' });
  process.stdout.write(page ? withReleases(await readFile(page, 'utf8'), section) : section);
}
