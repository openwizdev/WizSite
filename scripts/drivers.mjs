import { readFile } from 'node:fs/promises';
import { clickLinkAttribute } from './count-links.mjs';

export const KINDS = {
  host: { title: 'Hosts', sub: 'Where your agents run. Each host has its own driver.' },
  harness: { title: 'Harnesses', sub: 'Which agent you already use. Each runs on the local driver, on your computer or a VPS.' },
};
export const STATES = ['shipped', 'live', 'merged', 'review', 'planned', 'held', 'parked'];
export const FILTERS = [['shipped'], ['live'], ['merged'], ['review'], ['planned'], ['held', 'parked']];
export const MEANINGS = {
  shipped: 'In the release. Its driver passed the five-check test on its real host.',
  live: 'Passed the five-check test on its real host. Merged, not in a release yet.',
  merged: 'On OpenWiz main, waiting on its live check. Not in a release yet.',
  review: 'An open pull request.',
  planned: 'A ticket, not built yet.',
  held: 'Stopped until the reason on its row is solved.',
  parked: 'Set aside: the host lacks something every driver needs.',
};
export const LINK_LABELS = { kit: { shipped: 'Kit run', live: 'Live check receipt' }, pull: 'Pull request', issues: 'Ticket', docs: 'Docs' };
const LOCKUPS = new Set(['boat-dev.svg']);
const ICONS = new Set(['monitor.svg']);

export function badge(state, release) {
  return { shipped: `Shipped in ${release}`, live: 'Live-checked', merged: 'Merged', review: 'In review', planned: 'Planned', held: 'Held', parked: 'Parked' }[state];
}

export function filterLabel(states, release) {
  return states.length > 1 ? 'Held or parked' : badge(states[0], release);
}

export function evidenceLabel(url) {
  return /\/pull\/\d+$/.test(url) ? LINK_LABELS.pull : LINK_LABELS.issues;
}

export function logoAlt(entry) {
  return ICONS.has(entry.logo) ? 'Computer icon' : LOCKUPS.has(entry.logo) ? entry.name : `${entry.name} logo`;
}

export async function readDrivers(root = new URL('../', import.meta.url)) {
  return JSON.parse(await readFile(new URL('drivers/drivers.json', root), 'utf8'));
}

const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const anchor = (url, label) => `<a href="${esc(url)}"${clickLinkAttribute(url)}>${label}</a>`;

export function ordered(entries) {
  return Object.keys(KINDS).flatMap(kind => STATES.flatMap(state => entries.filter(e => e.kind === kind && e.state === state)));
}

function mark(entry) {
  if (entry.mark) return `<span class="row-mark">${entry.mark}</span>`;
  if (!entry.logo || LOCKUPS.has(entry.logo)) return '';
  const icon = ICONS.has(entry.logo) ? ' class="row-icon"' : '';
  return `<span class="row-mark"><img${icon} src="/drivers/logos/${entry.logo}" alt="${esc(logoAlt(entry))}" width="28" height="28" loading="lazy"></span>`;
}

function name(entry) {
  if (!LOCKUPS.has(entry.logo)) return esc(entry.name);
  return `<img class="row-lockup" src="/drivers/logos/${entry.logo}" alt="${esc(logoAlt(entry))}" width="390" height="109" loading="lazy">`;
}

function links(entry) {
  const found = [];
  if (entry.kit) found.push(`<a href="${esc(entry.kit.url)}"${clickLinkAttribute(entry.kit.url)}>${LINK_LABELS.kit[entry.state]}, <time datetime="${entry.kit.date}">${entry.kit.date}</time></a>`);
  if (entry.evidence) found.push(anchor(entry.evidence, evidenceLabel(entry.evidence)));
  if (entry.docs) found.push(anchor(entry.docs, LINK_LABELS.docs));
  return found.length ? `<p class="row-links">${found.join('')}</p>` : '';
}

export function row(entry, release) {
  const lines = [
    entry.login ? `<p class="row-login">Login: ${esc(entry.login)}</p>` : '',
    entry.reason ? `<p class="row-reason">${esc(entry.reason)}</p>` : '',
    entry.note ? `<p class="row-note">${esc(entry.note)}</p>` : '',
  ].join('');
  const wide = LOCKUPS.has(entry.logo) || !(entry.mark || entry.logo) ? ' no-mark' : '';
  return `<li class="row${wide}" id="${esc(entry.id)}" data-kind="${entry.kind}" data-state="${entry.state}" data-name="${esc(entry.name.toLowerCase())}">`
    + `${mark(entry)}<div class="row-body"><div class="row-head"><h4 class="row-name">${name(entry)}</h4>`
    + `<p class="badge" data-state="${entry.state}">${badge(entry.state, release)}</p></div>${lines}${links(entry)}</div></li>`;
}

function tools(entries, release) {
  const count = filter => entries.filter(filter).length;
  const kinds = [['all', 'All', count(() => true)], ...Object.entries(KINDS).map(([kind, { title }]) => [kind, title, count(e => e.kind === kind)])];
  const kindButtons = kinds.map(([kind, label, n], i) =>
    `<button type="button" data-kind="${kind}" aria-pressed="${i === 0}" disabled>${label} <span>${n}</span></button>`).join('');
  const stateButtons = FILTERS.map(states => [states, count(e => states.includes(e.state))]).filter(([, n]) => n).map(([states, n]) =>
    `<button type="button" data-states="${states.join(' ')}" aria-pressed="false" disabled><i class="dot" data-state="${states[0]}"></i>${filterLabel(states, release)} <span>${n}</span></button>`).join('');
  return '<div class="dir-tools">'
    + '<label class="dir-search"><span class="sr-only">Search hosts and harnesses by name</span>'
    + '<input type="search" name="driver-search" placeholder="Search by name" autocomplete="off" spellcheck="false" disabled></label>'
    + `<div class="dir-kinds" role="group" aria-label="Show">${kindButtons}</div>`
    + `<div class="dir-states" role="group" aria-label="State">${stateButtons}</div>`
    + '<p class="dir-showing" aria-live="polite"></p></div>';
}

function group(kind, entries, release) {
  const rows = ordered(entries).filter(e => e.kind === kind);
  const id = `${kind}s`;
  return `<div class="dir-group" id="${id}" data-kind="${kind}">`
    + `<h3 class="dir-title" id="${id}-title">${KINDS[kind].title} <span class="dir-count">${rows.length}</span></h3>`
    + `<p class="dir-sub">${KINDS[kind].sub}</p>`
    + `<ul class="rows" aria-labelledby="${id}-title">${rows.map(e => row(e, release)).join('')}</ul></div>`;
}

function key(entries, release, read) {
  const used = STATES.filter(state => entries.some(e => e.state === state));
  return '<div class="dir-key"><h3 class="dir-key-title">What each state means</h3><dl>'
    + used.map(state => `<div><dt><span class="badge" data-state="${state}">${badge(state, release)}</span></dt><dd>${MEANINGS[state]}</dd></div>`).join('')
    + `</dl><p class="dir-read">States as of <time datetime="${read.date}">${read.date}</time>, read from OpenWiz, its pull requests and its tickets.</p></div>`;
}

export function directory(data) {
  const { entries, release, read } = data;
  return tools(entries, release) + '<div class="dir-groups">'
    + Object.keys(KINDS).map(kind => group(kind, entries, release)).join('')
    + '</div>' + key(entries, release, read);
}

export function withDrivers(page, data) {
  const slot = '<template data-slot="drivers-directory"></template>';
  if (page.split(slot).length !== 2) throw new Error('the Drivers page needs exactly one directory slot');
  return page.replace(slot, () => directory(data));
}
