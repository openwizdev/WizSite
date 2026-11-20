// The Changelog's entries (#78): one short entry per public release, newest first, from one data file per release in
// changelog/releases/ (public name, semver, date, headline, bullets, notes URL). Nothing is read from the network.
// The entries sit behind the landing install box's switch (data-install in index.html, which RL2 flips when
// OpenWiz 0.1.0 publishes): until it reads live, the page shows no entry, only one line pointing at the pre-releases
// on GitHub, so it never claims an unreleased version. scripts/check.py checks the data and the built section.
//
//   node scripts/changelog.mjs [--releases DIR] [--switch live|coming-soon] [PAGE]
// prints the generated section, or PAGE with it inserted. Defaults: changelog/releases and the landing's switch.
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
export const START = '<!-- releases:start -->';
export const END = '<!-- releases:end -->';
export const PRE_RELEASES = 'https://github.com/openwizdev/OpenWiz/releases';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const version = semver => String(semver).split('.').map(Number);
const newer = (a, b) => { const [x, y] = [version(a.semver), version(b.semver)]; return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; };
// "2026-11-21" as "Nov 21, 2026", the same in every locale and time zone.
export const day = iso => { const [y, m, d] = String(iso).split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };

// Every release file in DIR, newest first by semver.
export async function readReleases(dir = new URL('changelog/releases/', ROOT)) {
  const names = (await readdir(dir)).filter(name => name.endsWith('.json')).sort();
  const list = await Promise.all(names.map(async name => JSON.parse(await readFile(new URL(name, dir), 'utf8'))));
  return list.sort(newer);
}

// The landing install box's switch: "live" once OpenWiz 0.1.0 is published (RL2), "coming-soon" before.
export function installSwitch(landing) {
  const found = landing.match(/<div class="install-box" data-install="([^"]*)"/g) || [];
  if (found.length !== 1) throw new Error('the landing needs exactly one install box switch');
  return /data-install="([^"]*)"/.exec(found[0])[1];
}

const entry = release => {
  const id = `v${release.name.replaceAll('.', '-')}`;
  return `<article class="release" aria-labelledby="${id}"><h2 id="${id}">${esc(release.name)} <small>· <time datetime="${esc(release.date)}">${day(release.date)}</time> (${esc(release.semver)})</small></h2>`
    + `<p class="headline">${esc(release.headline)}</p>`
    + `<ul>${release.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`
    + `<p class="notes"><a href="${esc(release.notes)}">Full notes on GitHub</a></p></article>`;
};

// The section: every entry when the switch reads live, then the pre-releases line; before that, the line alone.
export function render(list, live) {
  const shown = live ? list : [];
  const pre = shown.length
    ? `<p class="pre">Earlier pre-releases are on <a href="${PRE_RELEASES}">GitHub</a>.</p>`
    : `<p class="pre">No public release yet. The pre-releases are on <a href="${PRE_RELEASES}">GitHub</a>.</p>`;
  return `<section class="releases" aria-label="Releases">${shown.map(entry).join('')}${pre}</section>`;
}

export function withReleases(page, section) {
  if (page.includes(START) || page.split('</main>').length !== 2) throw new Error('changelog page: expected one </main> and no generated section');
  return page.replace('</main>', () => `${START}${section}${END}</main>`); // a function: copy with $& or $$ stays as written
}

export const summary = (list, live) => live ? `${list.length} release${list.length === 1 ? '' : 's'}` : `none shown until the install switch reads live (${list.length} waiting)`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let dir, sw, page;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--releases') dir = pathToFileURL(args.shift().replace(/\/?$/, '/'));
    else if (arg === '--switch') sw = args.shift();
    else page = arg;
  }
  sw ??= installSwitch(await readFile(new URL('index.html', ROOT), 'utf8'));
  const section = render(await readReleases(dir), sw === 'live');
  process.stdout.write(page ? withReleases(await readFile(page, 'utf8'), section) : section);
}
