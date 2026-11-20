// The changelog generator (#1364). At WizSite's build it reads each versioned repository's published releases on
// GitHub (WizSkills' release notes are its Changesets notes) and renders one part per repository on /changelog/,
// newest first, patches included. Nothing here is written by hand. A read that fails, or an answer that isn't
// exactly a list of releases, shows its part as missing; only a list with no release from 0.1.0 on says
// "No release yet". An OpenWiz entry lists the versions it ships with, read from its notes' "Ships with" list.
//
//   node scripts/changelog.mjs [--fixtures DIR | --api URL] [PAGE]
// prints the generated section, or PAGE with it inserted. --fixtures reads DIR/<Repository>.json (tests only).
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const REPOS = ['OpenWiz', 'WizSkills', 'WizLoops'];
const OWNER = 'openwizdev';
const FIRST = [0, 1, 0]; // releases before 0.1.0 stay on GitHub (J209)
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
export const START = '<!-- releases:start -->';
export const END = '<!-- releases:end -->';

const esc = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// One repository's GitHub answer (every page joined) as its published releases from 0.1.0 on, newest first; null
// when it can't be trusted. Each release must have the fields this reads, each of its own type. A published
// release whose tag isn't a plain version fails the whole part closed rather than vanishing from the history.
export function releases(answer) {
  if (!Array.isArray(answer)) return null;
  const out = [];
  for (const release of answer) {
    if (!isObject(release) || typeof release.tag_name !== 'string' || typeof release.draft !== 'boolean' || typeof release.prerelease !== 'boolean') return null;
    if (release.draft || release.prerelease) continue;
    const tag = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(release.tag_name);
    const day = typeof release.published_at === 'string' && /^(\d{4}-\d{2}-\d{2})T/.exec(release.published_at);
    if (!tag || !day || !(release.body === null || typeof release.body === 'string')) return null;
    if (!(release.name === undefined || release.name === null || typeof release.name === 'string')) return null;
    const version = tag.slice(1, 4).map(Number);
    if (compare(version, FIRST) >= 0) out.push({ version, day: day[1], body: release.body ?? '', name: release.name ?? '' });
  }
  return out.sort((a, b) => compare(b.version, a.version));
}

// The lines of a release's own notes. A cumulative body (one "## X.Y.Z" heading per version) gives only its own
// version's section, so an entry never repeats an older one.
function ownNotes(body, version) {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const heading = line => /^#{1,6}\s+v?(\d+\.\d+\.\d+)\b/.exec(line)?.[1];
  const at = lines.findIndex(line => heading(line) === version.join('.'));
  if (at < 0) return lines;
  const next = lines.findIndex((line, i) => i > at && heading(line));
  return lines.slice(at + 1, next < 0 ? lines.length : next);
}

// The "Ships with" list: a line reading Ships with (as a heading or in bold), then its list items. Returns the
// items (null when the notes have no such list) and the notes without it.
function shipsWith(lines) {
  const at = lines.findIndex(line => /^(?:#{1,6}\s*)?(?:\*\*)?\s*ships with:?\s*(?:\*\*)?:?\s*$/i.test(line.trim()));
  if (at < 0) return { ships: null, rest: lines };
  let end = at + 1;
  const items = [];
  for (; end < lines.length; end++) {
    const item = /^\s*[-*]\s+(.+)$/.exec(lines[end]);
    if (item) items.push(item[1].trim());
    else if (lines[end].trim()) break;
  }
  return { ships: items.length ? items : null, rest: [...lines.slice(0, at), ...lines.slice(end)] };
}

// Notes are text: everything is escaped; `code` and **bold** keep their look, and a link keeps only its words.
function inline(text) {
  return text.split(/(`[^`]+`)/).map(part => /^`[^`]+`$/.test(part)
    ? `<code>${esc(part.slice(1, -1))}</code>`
    : esc(part.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')).join('');
}

function notes(lines) {
  const blocks = [];
  for (const line of lines) {
    const text = line.trim();
    const item = /^[-*]\s+(.+)$/.exec(text);
    const head = /^#{1,6}\s+(.+)$/.exec(text) || /^\*\*([^*]+)\*\*$/.exec(text);
    const last = blocks.at(-1);
    if (!text || /^\[[^\]]*\]\([^)]*\)$/.test(text)) blocks.push(null); // a blank, or a line that is only a link
    else if (head) blocks.push({ kind: 'head', text: head[1] });
    else if (item) last?.kind === 'list' ? last.items.push(item[1]) : blocks.push({ kind: 'list', items: [item[1]] });
    else if (last?.kind === 'list' && /^\s/.test(line)) last.items[last.items.length - 1] += ` ${text}`;
    else if (last?.kind === 'text') last.text += ` ${text}`;
    else blocks.push({ kind: 'text', text });
  }
  return blocks.filter(Boolean).map(block => block.kind === 'list'
    ? `<ul>${block.items.map(item => `<li>${inline(item)}</li>`).join('')}</ul>`
    : `<p${block.kind === 'head' ? ' class="notes-head"' : ''}>${inline(block.text)}</p>`).join('');
}

function entry(repo, release) {
  const version = release.version.join('.');
  const { ships, rest } = shipsWith(ownNotes(release.body, release.version));
  const shipped = repo !== 'OpenWiz' ? ''
    : ships ? `<div class="ships"><p>Ships with</p><ul>${ships.map(item => `<li>${inline(item)}</li>`).join('')}</ul></div>`
      : '<p class="ships missing">Its notes don’t list the versions it ships with.</p>';
  // A public name (J264): an OpenWiz release named exactly "OpenWiz 0.NN" is headlined by that name, with its
  // semver small beside it; every other release keeps its semver headline.
  const named = repo === 'OpenWiz' && /^OpenWiz 0\.\d{2}$/.test(release.name);
  const headline = named ? `${esc(release.name)} <small class="semver">${version}</small>` : `${repo} ${version}`;
  return `<article class="release"><h4>${headline}</h4><p class="released">Released <time datetime="${release.day}">${release.day}</time></p>${shipped}<div class="notes">${notes(rest)}</div></article>`;
}

// The generated section. `found` maps each repository to its releases, or null for a read that failed.
export function render(found) {
  const parts = REPOS.map(repo => {
    const id = repo.toLowerCase();
    const list = found[repo];
    const body = !Array.isArray(list)
      ? `<p class="missing read">Missing: ${repo}’s releases couldn’t be read when this page was built. Its published releases are on GitHub.</p>`
      : list.length ? list.map(release => entry(repo, release)).join('') : '<p class="no-release">No release yet.</p>';
    return `<section class="release-part" id="${id}-releases" data-repo="${repo}" aria-labelledby="${id}-releases-h"><h3 id="${id}-releases-h">${repo} <span>${OWNER}/${repo}</span></h3>${body}</section>`;
  });
  return `<section class="releases" id="releases" aria-labelledby="releases-h"><h2 id="releases-h">Releases</h2><p class="note">Generated when this page is built, from each release’s own published notes. Every release from 0.1.0 on, patches included, newest first.</p>${parts.join('')}</section>`;
}

// The page with the generated section placed last in its main, after What exists today. The page is otherwise
// unchanged.
export function withReleases(page, section) {
  if (page.includes(START) || page.split('</main>').length !== 2) throw new Error('changelog page: expected one </main> and no generated section');
  return page.replace('</main>', `${START}${section}${END}</main>`);
}

// Every page of one repository's releases from the GitHub API, or null on any failure.
export async function fetchReleases(repo, api = 'https://api.github.com') {
  const answer = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let list;
    try {
      const response = await fetch(`${api}/repos/${OWNER}/${repo}/releases?per_page=${PAGE_SIZE}&page=${page}`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'wizsite-build', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(15000),
      });
      if (response.status !== 200) return null;
      list = await response.json();
    } catch {
      return null;
    }
    if (!Array.isArray(list)) return null;
    answer.push(...list);
    if (list.length < PAGE_SIZE) return releases(answer);
  }
  return null; // more pages than this reads: never show a cut-off history
}

async function fixture(dir, repo) {
  try {
    return releases(JSON.parse(await readFile(`${dir}/${repo}.json`, 'utf8')));
  } catch {
    return null;
  }
}

// What the build uses: each repository's releases, read live unless a fixture directory is given.
export async function readAll({ fixtures, api } = {}) {
  const lists = await Promise.all(REPOS.map(repo => fixtures ? fixture(fixtures, repo) : fetchReleases(repo, api)));
  return Object.fromEntries(REPOS.map((repo, i) => [repo, lists[i]]));
}

export const summary = found => REPOS.map(repo => `${repo} ${!found[repo] ? 'missing' : found[repo].length ? `${found[repo].length} releases` : 'no release yet'}`).join(', ');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const options = {};
  let page;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--fixtures' || arg === '--api') options[arg.slice(2)] = args.shift();
    else page = arg;
  }
  const section = render(await readAll(options));
  process.stdout.write(page ? withReleases(await readFile(page, 'utf8'), section) : section);
}
