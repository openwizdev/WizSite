import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
export const START = '<!-- supporters:start -->';
export const END = '<!-- supporters:end -->';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FIELDS = 'github,name,since';
const NAME_MAX = 80;
const GITHUB_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const SINCE_RE = /^20\d\d-(0[1-9]|1[0-2])$/;
const ULTRA_RE = /\bultra\b/i;
const PUBLIC_WIZ = /^(?:OpenWiz|WizBar|WizLoops|WizPlugins|WizSite|WizSkills)+(?:[a-z][A-Za-z]*)?$/;

const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const month = ym => { const [y, m] = String(ym).split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };

export function validateSupporters(data) {
  if (!Array.isArray(data)) throw new Error('supporters.json: must be a JSON list');
  const seenNames = new Set();
  const seenGithub = new Set();
  for (const entry of data) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('each supporter is an object');
    if (Object.keys(entry).sort().join() !== FIELDS) throw new Error(`unexpected supporter fields: ${Object.keys(entry).sort().join(', ')}`);
    const { name, github, since } = entry;
    if (typeof name !== 'string' || !name.trim() || name !== name.trim()) throw new Error('supporter name must be non-empty trimmed text');
    if ([...name].length > NAME_MAX || /[\r\n]/.test(name)) throw new Error(`supporter name over ${NAME_MAX} characters or multi-line`);
    if (github !== null && (typeof github !== 'string' || !GITHUB_RE.test(github))) throw new Error(`invalid GitHub login: ${github}`);
    if (typeof since !== 'string' || !SINCE_RE.test(since)) throw new Error(`supporter since must be YYYY-MM: ${since}`);
    if (ULTRA_RE.test(name)) throw new Error('supporter name mentions Ultra');
    for (const wiz of name.match(/\bWiz[A-Z][A-Za-z]*/g) || []) {
      if (!PUBLIC_WIZ.test(wiz)) throw new Error(`a private repository is named: ${wiz}`);
    }
    const lowName = name.toLowerCase();
    if (seenNames.has(lowName)) throw new Error(`duplicate supporter name: ${name}`);
    seenNames.add(lowName);
    if (github !== null) {
      const lowGithub = github.toLowerCase();
      if (seenGithub.has(lowGithub)) throw new Error(`duplicate supporter GitHub login: ${github}`);
      seenGithub.add(lowGithub);
    }
  }
  return data;
}

export async function readSupporters(file = new URL('supporters/supporters.json', ROOT)) {
  let data;
  try {
    data = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`supporters.json: not JSON: ${error.message}`);
  }
  return validateSupporters(data);
}

const entry = supporter => {
  const label = esc(supporter.name);
  const name = supporter.github
    ? `<a href="https://github.com/${esc(supporter.github)}" rel="noreferrer">${label}</a>`
    : `<span>${label}</span>`;
  return `<li>${name}<time datetime="${esc(supporter.since)}">${month(supporter.since)}</time></li>`;
};

export function render(list) {
  validateSupporters(list);
  if (!list.length) {
    return '<section class="supporters-list" aria-label="Supporters"><p class="supporters-empty">No supporters yet. <a href="/pro/">Be the first.</a></p></section>';
  }
  return `<section class="supporters-list" aria-label="Supporters"><ul>${list.map(entry).join('')}</ul></section>`;
}

export function withSupporters(page, section) {
  if (page.includes(START) || page.split('</main>').length !== 2) throw new Error('supporters page: expected one </main> and no generated section');
  return page.replace('</main>', () => `${START}${section}${END}</main>`);
}

export const summary = list => `${list.length} supporter${list.length === 1 ? '' : 's'}`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let file, page;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--supporters') file = pathToFileURL(args.shift());
    else page = arg;
  }
  const section = render(await readSupporters(file));
  process.stdout.write(page ? withSupporters(await readFile(page, 'utf8'), section) : section);
}
