import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
export const START = '<!-- supporters:start -->';
export const END = '<!-- supporters:end -->';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const month = ym => { const [y, m] = String(ym).split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };

export async function readSupporters(file = new URL('supporters/supporters.json', ROOT)) {
  return JSON.parse(await readFile(file, 'utf8'));
}

const entry = supporter => {
  const label = esc(supporter.name);
  const name = supporter.github
    ? `<a href="https://github.com/${esc(supporter.github)}" rel="noreferrer">${label}</a>`
    : `<span>${label}</span>`;
  return `<li>${name}<time datetime="${esc(supporter.since)}">${month(supporter.since)}</time></li>`;
};

export function render(list) {
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
