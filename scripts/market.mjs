import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
export const REGISTRY = new URL('market/registry.json', ROOT);
export const START = '<!-- market:start -->';
export const END = '<!-- market:end -->';
export const WIZMARKET = 'https://github.com/openwizdev/WizMarket';
export const CONTRACT = `${WIZMARKET}/blob/main/contracts/listing.v1.md`;

const ID = /^[a-z0-9-]{2,40}$/;
const TAG = /^[a-z0-9-]+$/;
const HEX40 = /^[0-9a-f]{40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO = /^([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})\/([A-Za-z0-9._-]{1,100})$/;
const FIELDS = { name: true, summary: true, tags: true, url: true, plugs_into: true, publisher: true, stage: true, status: true, login: false, links: false, proof: false };
const RECEIPT_KINDS = ['driver', 'harness'];
const PRIVATE = [
  ['a token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|npm_[A-Za-z0-9]{30,}|(?:AKIA|ASIA)[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.)/],
  ['a token', /-----BEGIN [A-Z ]*PRIVATE KEY-----|[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/],
  ['a token', /\b(?:password|passwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token|access[_-]?token)\b\s*[:=]\s*\S|\bbearer\s+[A-Za-z0-9._~+/-]{16,}/i],
  ['a private id', /\bthr[_][A-Za-z0-9]|\b(?:proj|prj|mch|usr|acct|auto|sess?|sbx)_[A-Za-z0-9]|\bcr_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}|\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/],
  ['a machine path', /(?<![\w.~%/-])\/(?:home|Users|root|tmp|var\/folders|private\/var)\/|(?<![A-Za-z0-9])[A-Za-z]:\\/],
];

const fail = (where, why) => { throw new Error(`market/registry.json: ${where}: ${why}`); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys, where) => {
  if (!isObject(value)) fail(where, 'not an object');
  const extra = Object.keys(value).filter(key => !keys.includes(key));
  if (extra.length) fail(where, `unknown field ${extra.join(', ')}`);
};
const oneLine = (value, where) => {
  if (typeof value !== 'string' || !value.length || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)) fail(where, 'not one line');
  return value;
};

export function isUrl(value) {
  if (typeof value !== 'string') return false;
  const match = /^https:\/\/([^/?#:]+)(?::([0-9]+))?([/?#][\x21-\x7e]*)?$/.exec(value);
  if (!match) return false;
  const [, host, port] = match;
  const labels = host.split('.');
  if (host.length > 253 || labels.length < 2 || !/^[A-Za-z]/.test(labels.at(-1))) return false;
  if (!labels.every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))) return false;
  return port === undefined || (/^[1-9][0-9]*$/.test(port) && Number(port) <= 65535);
}

const calendarDate = value => typeof value === 'string' && DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const url = (value, where) => isUrl(value) ? value : fail(where, 'not an https URL in the contract\'s grammar');

function checkProof(listing, commit, where) {
  const kinds = [];
  if (listing.tags.some(tag => RECEIPT_KINDS.includes(tag))) kinds.push('receipt');
  if (listing.tags.includes('skill')) kinds.push('skill');
  if (listing.status === 'listed') {
    if ('proof' in listing) fail(where, 'a listed listing has a proof');
    return;
  }
  if (!kinds.length) fail(where, 'verified, but no tag has a test (driver, harness or skill)');
  exactKeys(listing.proof, kinds, `${where}.proof`);
  for (const kind of kinds) if (!(kind in listing.proof)) fail(`${where}.proof`, `verified without its ${kind} proof`);
  if (listing.proof.receipt) {
    const receipt = listing.proof.receipt;
    exactKeys(receipt, ['path', 'date', 'url'], `${where}.proof.receipt`);
    if (!calendarDate(receipt.date)) fail(`${where}.proof.receipt`, 'date is not a calendar date, YYYY-MM-DD');
    const path = new RegExp(`^receipts/${listing.id}/${receipt.date}-[0-9a-f]{12}\\.txt$`);
    if (typeof receipt.path !== 'string' || !path.test(receipt.path)) fail(`${where}.proof.receipt`, 'path is not receipts/<id>/<date>-<commit>.txt');
    if (receipt.url !== `${WIZMARKET}/blob/${commit}/${receipt.path}`) fail(`${where}.proof.receipt`, 'url is not the receipt at the index\'s commit');
  }
  if (listing.proof.skill) {
    const skill = listing.proof.skill;
    exactKeys(skill, ['source', 'check', 'url'], `${where}.proof.skill`);
    const [repo, at, ...rest] = typeof skill.source === 'string' ? skill.source.split('@') : [];
    if (rest.length || !REPO.test(repo ?? '') || !HEX40.test(at ?? '')) fail(`${where}.proof.skill`, 'source is not <owner>/<repo>@<40-hex commit>');
    oneLine(skill.check, `${where}.proof.skill.check`);
    if (skill.url !== `https://github.com/${repo}/tree/${at}`) fail(`${where}.proof.skill`, 'url is not the source at its commit');
  }
}

function checkListing(listing, commit, where) {
  exactKeys(listing, ['id', ...Object.keys(FIELDS)], where);
  for (const [field, required] of Object.entries(FIELDS)) if (required && !(field in listing)) fail(where, `missing ${field}`);
  if (typeof listing.id !== 'string' || !ID.test(listing.id)) fail(where, 'id is not 2 to 40 lowercase letters, digits or hyphens');
  where = `listing ${listing.id}`;
  oneLine(listing.name, `${where}.name`);
  if ([...oneLine(listing.summary, `${where}.summary`)].length > 140) fail(`${where}.summary`, 'over 140 characters');
  oneLine(listing.plugs_into, `${where}.plugs_into`);
  if (typeof listing.publisher !== 'string' || !LOGIN.test(listing.publisher)) fail(`${where}.publisher`, 'not a GitHub login');
  if ('login' in listing) oneLine(listing.login, `${where}.login`);
  const tags = listing.tags;
  if (!Array.isArray(tags) || tags.length < 1 || tags.length > 8) fail(`${where}.tags`, 'not 1 to 8 tags');
  if (!tags.every(tag => typeof tag === 'string' && TAG.test(tag)) || new Set(tags).size !== tags.length) fail(`${where}.tags`, 'a tag is not lowercase letters, digits and hyphens, or appears twice');
  url(listing.url, `${where}.url`);
  if ('links' in listing) {
    if (!Array.isArray(listing.links) || !listing.links.length) fail(`${where}.links`, 'not a list of at least one link');
    listing.links.forEach((link, i) => {
      exactKeys(link, ['label', 'url'], `${where}.links[${i}]`);
      oneLine(link.label, `${where}.links[${i}].label`);
      url(link.url, `${where}.links[${i}].url`);
    });
  }
  if (!['available', 'being-built'].includes(listing.stage)) fail(`${where}.stage`, 'not available or being-built');
  if (listing.stage === 'being-built' && !listing.links) fail(where, 'being-built without its work link');
  if (!['listed', 'verified'].includes(listing.status)) fail(`${where}.status`, 'not listed or verified');
  checkProof(listing, commit, where);
}

function* strings(value, where) {
  if (typeof value === 'string') yield [where, value];
  else if (Array.isArray(value)) for (const [i, item] of value.entries()) yield* strings(item, `${where}[${i}]`);
  else if (isObject(value)) for (const [key, item] of Object.entries(value)) { yield [`${where} key`, key]; yield* strings(item, `${where}.${key}`); }
}

function repeatedKey(text) {
  const objects = [];
  let previous;
  for (const [token] of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}[\],:]|[^\s{}[\],:"]+/g)) {
    if (token === '{') objects.push(new Set());
    else if (token === '[') objects.push(null);
    else if (token === '}' || token === ']') objects.pop();
    else if (token[0] === '"' && objects.at(-1) && (previous === '{' || previous === ',')) {
      const key = JSON.parse(token);
      if (objects.at(-1).has(key)) return key;
      objects.at(-1).add(key);
    }
    previous = token;
  }
  return null;
}

export function validate(index) {
  for (const [where, text] of strings(index, 'the index')) {
    if (!text.isWellFormed()) fail(where, 'holds an unpaired surrogate, which is not UTF-8 text');
    const found = PRIVATE.find(([, pattern]) => pattern.test(text));
    if (found) fail(where, `holds what looks like ${found[0]}; listings are public`);
  }
  exactKeys(index, ['commit', 'contract', 'listings'], 'the index');
  if (index.contract !== 'listing.v1') fail('the index', 'contract is not listing.v1');
  if (typeof index.commit !== 'string' || !HEX40.test(index.commit)) fail('the index', 'commit is not 40 lowercase hex');
  if (!Array.isArray(index.listings)) fail('the index', 'listings is not a list');
  index.listings.forEach((listing, i) => {
    checkListing(listing, index.commit, `listing ${i + 1}`);
    if (i && !(index.listings[i - 1].id < listing.id)) fail(`listing ${listing.id}`, 'listings are not sorted by id, each once');
  });
  return index;
}

export function decode(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail('the index', 'not UTF-8 text'); }
}

export function parse(text) {
  let index;
  try { index = JSON.parse(text); } catch { fail('the index', 'not JSON'); }
  const key = repeatedKey(text);
  if (key !== null) fail('the index', `has the key ${/^[a-z_]{1,40}$/.test(key) ? key : '(not shown)'} twice in one object`);
  return validate(index);
}

export async function readRegistry(file = REGISTRY) {
  return parse(decode(await readFile(file)));
}

const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const link = (href, text) => `<a href="${esc(href)}"${href.startsWith('#') ? '' : ' rel="noreferrer"'}>${esc(text)}</a>`;
export const tagsOf = index => [...new Set(index.listings.flatMap(listing => listing.tags))].sort();

function status(listing) {
  if (listing.status !== 'verified') {
    return '<p class="market-status" data-status="listed"><span class="market-badge">Listed</span> A link, not proven.</p>';
  }
  const proofs = [];
  const { receipt, skill } = listing.proof;
  if (receipt) proofs.push(link(receipt.url, `Kit receipt: 5 of 5 checks on its real host, ${receipt.date}`));
  if (skill) proofs.push(link(skill.url, `Its check passed at ${skill.source.split('@')[0]}@${skill.source.split('@')[1].slice(0, 12)}`));
  return `<p class="market-status" data-status="verified"><span class="market-badge">Verified</span> ${proofs.join('; ')}</p>`;
}

function stage(listing) {
  if (listing.stage !== 'being-built') return '<p class="market-stage" data-stage="available">Available</p>';
  const work = listing.links[0];
  return `<p class="market-stage" data-stage="being-built">Being built: ${link(work.url, work.label)}</p>`;
}

function card(listing) {
  const tags = listing.tags.map(tag => `<li>${link(`#tag-${tag}`, tag)}</li>`).join('');
  const extra = (listing.links ?? []).slice(listing.stage === 'being-built' ? 1 : 0);
  return `<article class="market-card" id="listing-${listing.id}" data-listing="${listing.id}" aria-labelledby="name-${listing.id}">`
    + `<h3 id="name-${listing.id}">${esc(listing.name)}</h3>`
    + `<p class="market-summary">${esc(listing.summary)}</p>`
    + status(listing) + stage(listing)
    + `<dl><dt>Plugs into</dt><dd>${esc(listing.plugs_into)}</dd>`
    + (listing.login ? `<dt>Login</dt><dd>${esc(listing.login)}</dd>` : '')
    + `<dt>Publisher</dt><dd>${esc(listing.publisher)}</dd></dl>`
    + `<ul class="market-tags" aria-label="Tags">${tags}</ul>`
    + `<p class="market-links">${[link(listing.url, 'Get it'), ...extra.map(l => link(l.url, l.label))].join(' · ')}</p>`
    + '</article>';
}

export function render(index) {
  if (!index.listings.length) {
    return '<section class="market-all" aria-labelledby="all-listings"><h2 id="all-listings">Every listing</h2>'
      + `<p class="market-count">0 listings, from WizMarket at commit <code>${index.commit.slice(0, 12)}</code>.</p>`
      + '<p class="market-empty">No listings yet. Anyone can be the first: <a href="#publish">publish your own</a>.</p></section>';
  }
  const tags = tagsOf(index);
  const count = tag => index.listings.filter(listing => listing.tags.includes(tag)).length;
  const verified = index.listings.filter(listing => listing.status === 'verified').length;
  const browse = `<nav class="market-browse" aria-label="Browse by tag"><h2>Browse by tag</h2><ul>${tags.map(tag => `<li>${link(`#tag-${tag}`, `${tag} (${count(tag)})`)}</li>`).join('')}</ul></nav>`;
  const all = `<section class="market-all" aria-labelledby="all-listings"><h2 id="all-listings">Every listing</h2>`
    + `<p class="market-count">${index.listings.length} listing${index.listings.length === 1 ? '' : 's'}, ${verified} verified, from WizMarket at commit <code>${index.commit.slice(0, 12)}</code>.</p>`
    + `<div class="market-cards">${index.listings.map(card).join('')}</div></section>`;
  const byTag = `<section class="market-by-tag" aria-labelledby="by-tag"><h2 id="by-tag">By tag</h2>${tags.map(tag => `<section class="market-tag" id="tag-${tag}" aria-labelledby="heading-tag-${tag}"><h3 id="heading-tag-${tag}">${esc(tag)}</h3><ul>`
    + index.listings.filter(listing => listing.tags.includes(tag)).map(listing => `<li>${link(`#listing-${listing.id}`, listing.name)} <span>${listing.status === 'verified' ? 'Verified' : 'Listed'}</span></li>`).join('')
    + '</ul></section>').join('')}</section>`;
  return browse + all + byTag;
}

export function withMarket(page, section) {
  if (page.includes(START) || page.split('<template data-slot="market"></template>').length !== 2) throw new Error('market page: expected one market slot and no generated section');
  return page.replace('<template data-slot="market"></template>', () => `${START}${section}${END}`);
}

export const summary = index => `${index.listings.length} listing${index.listings.length === 1 ? '' : 's'} at WizMarket ${index.commit.slice(0, 12)}`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, page] = process.argv.slice(2);
  const section = render(await readRegistry(file ? pathToFileURL(file) : REGISTRY));
  process.stdout.write(page ? withMarket(await readFile(page, 'utf8'), section) : section);
}
