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
export const day = iso => { const [y, m, d] = String(iso).split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };

export async function readShip(file = new URL('release.json', ROOT)) {
  const refuse = why => { throw new Error(`release.json: ${why}`); };
  let data;
  try { data = JSON.parse(await readFile(file, 'utf8')); } catch (error) { refuse(`not readable as JSON: ${error.message}`); }
  const held = data && !Array.isArray(data) && typeof data === 'object' ? data.changelog ?? {} : refuse('one object');
  if (!held || Array.isArray(held) || typeof held !== 'object') refuse('changelog maps a semver to on or off');
  for (const [semver, state] of Object.entries(held)) {
    if (!/^\d+\.\d+\.\d+$/.test(semver) || !['on', 'off'].includes(state)) refuse(`changelog maps a semver to on or off, not ${semver}: ${JSON.stringify(state)}`);
  }
  return held;
}

export async function readReleases(dir = new URL('changelog/releases/', ROOT), ship) {
  ship ??= await readShip();
  const names = (await readdir(dir)).filter(name => name.endsWith('.json')).sort();
  const list = await Promise.all(names.map(async name => JSON.parse(await readFile(new URL(name, dir), 'utf8'))));
  return list.filter(release => ship[release.semver] !== 'off').sort(newer);
}

const plain = text => text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replaceAll('`', '').trim();

export function fromNotes(notes, semver, name) {
  const parts = notes.split(/^## /m).filter(part => part.startsWith(`${semver} · `));
  if (parts.length !== 1) throw new Error(`the release notes need exactly one "## ${semver} · <date>" section`);
  const [heading, ...lines] = parts[0].split('\n');
  const areas = [];
  let headline, link;
  for (const line of lines) {
    const bold = /^\*\*(.+)\*\*$/.exec(line);
    if (bold && headline === undefined) headline = plain(bold[1]).replace(new RegExp(`^\\S+ ${name.replace('.', '\\.')}: `), '');
    else if (bold) areas.push({ name: plain(bold[1]), bullets: [] });
    else if (line.startsWith('- ') && areas.length) areas.at(-1).bullets.push(plain(line.slice(2)));
    else if (line.startsWith('- ')) throw new Error(`a line before the first area: ${line}`);
    else link = /^\[Full release on GitHub\]\((\S+)\)$/.exec(line)?.[1] ?? link;
  }
  if (!headline || !link) throw new Error(`the ${semver} notes need a bold headline and a "Full release on GitHub" link`);
  headline = headline[0].toUpperCase() + headline.slice(1) + (/[.!?]$/.test(headline) ? '' : '.');
  const text = JSON.stringify({ name, semver, date: heading.slice(semver.length + 3).trim(), headline, areas: areas.filter(area => area.bullets.length), notes: link }, null, 2);
  return text.replace(/\{\n {6}("name": .*,)\n {6}("bullets": \[)/g, '{$1 $2').replace(/\n {6}\]\n {4}\}/g, '\n    ]}').replace(/^ {8}"/gm, '      "') + '\n';
}

export function installSwitch(landing) {
  const found = landing.match(/<div class="install-box" data-install="([^"]*)"/g) || [];
  if (found.length !== 1) throw new Error('the landing needs exactly one install box switch');
  return /data-install="([^"]*)"/.exec(found[0])[1];
}

const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const list = bullets => `<ul>${bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`;

const entry = release => {
  const id = `v${release.name.replaceAll('.', '-')}`;
  const lines = release.areas
    ? release.areas.map(area => `<h3 id="${id}-${slug(area.name)}">${esc(area.name)}</h3>${list(area.bullets)}`).join('')
    : list(release.bullets);
  return `<article class="release" aria-labelledby="${id}"><h2 id="${id}">${esc(release.name)} <small>· <time datetime="${esc(release.date)}">${day(release.date)}</time> (${esc(release.semver)})</small></h2>`
    + `<p class="headline">${esc(release.headline)}</p>`
    + lines
    + `<p class="notes"><a href="${esc(release.notes)}" data-count="github">Full notes on GitHub</a></p></article>`;
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let dir, sw, page, ship, notes, semver, name;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--releases') dir = pathToFileURL(args.shift().replace(/\/?$/, '/'));
    else if (arg === '--switch') sw = args.shift();
    else if (arg === '--ship') ship = pathToFileURL(args.shift());
    else if (arg === '--from-notes') notes = args.shift();
    else if (arg === '--version') semver = args.shift();
    else if (arg === '--name') name = args.shift();
    else page = arg;
  }
  if (notes) {
    process.stdout.write(fromNotes(await readFile(notes, 'utf8'), semver, name));
    process.exit(0);
  }
  sw ??= installSwitch(await readFile(new URL('index.html', ROOT), 'utf8'));
  const section = render(await readReleases(dir, await readShip(ship)), sw === 'live');
  process.stdout.write(page ? withReleases(await readFile(page, 'utf8'), section) : section);
}
