// FA2 (#1900): the docs index Ask a Wiz answers from, as contract openwiz.ask-a-wiz.v1 fixes it ("The docs index").
// It gathers the built site's public pages (every index.html but the app's) and OpenWiz's public docs (README.md and
// the top-level docs/*.md of an OpenWiz checkout) into short plain-text passages, each pointing at its source page.
// Plain text only, no embeddings and no dependency: the function scores these passages by keyword.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SCHEMA = 'openwiz.ask-a-wiz.index.v1';
const SITE = 'https://openwiz.dev/';
const DOCS = 'https://github.com/openwizdev/OpenWiz/blob/main/';
const PREFIXES = [SITE, 'https://github.com/openwizdev/'];
const MAX_PASSAGE = 1200; // code points
const MAX_FIELD = 200;
const MAX_BYTES = 2_000_000;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', middot: '·', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = text => text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (all, name) =>
  name[0] === '#' ? String.fromCodePoint(parseInt(name.slice(1).replace(/^x/i, '0x'))) : ENTITIES[name.toLowerCase()] ?? all);
const squash = text => text.replace(/\s+/g, ' ').trim();
const length = text => [...text].length;
const cut = (text, max) => [...text].slice(0, max).join('');

// A page's blocks: its <main> (or <body>) without scripts, styles, pictures and page chrome; headings marked.
function htmlBlocks(html) {
  const main = html.match(/<main\b[^>]*>([\s\S]*)<\/main>/i)?.[1] ?? html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? '';
  const text = main
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|svg|template|noscript|nav|header|footer)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<h[1-6]\b[^>]*>/gi, '\n\u0001')
    .replace(/<\/?(?:p|div|section|article|aside|li|ul|ol|dl|dt|dd|h[1-6]|br|tr|td|th|table|blockquote|pre|figure|figcaption|details|summary)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return text.split('\n').map(line => ({ heading: line.startsWith('\u0001'), text: squash(decode(line.replace('\u0001', ''))) }));
}

// A Markdown file's blocks: headings, paragraphs, list items, table rows and code lines, as plain text.
function markdownBlocks(markdown) {
  const inline = line => squash(decode(line
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|`)/g, '')));
  const blocks = [];
  let fenced = false, open = false;
  for (const line of markdown.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; open = false; continue; }
    if (fenced) { blocks.push({ heading: false, text: squash(line) }); open = false; continue; }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) { blocks.push({ heading: true, text: inline(heading[1].replace(/\s#+\s*$/, '')) }); open = false; continue; }
    if (/^\s*\|?\s*:?-{3,}/.test(line) && line.includes('|')) continue; // a table's separator row
    if (/^\s*\|/.test(line)) {
      blocks.push({ heading: false, text: line.trim().replace(/^\||\|$/g, '').split('|').map(inline).join(' · ') });
      open = false;
      continue;
    }
    const item = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
    if (item) { blocks.push({ heading: false, text: inline(item[1]) }); open = true; continue; }
    if (!line.trim()) { open = false; continue; }
    if (open) blocks[blocks.length - 1].text = squash(`${blocks[blocks.length - 1].text} ${inline(line)}`);
    else { blocks.push({ heading: false, text: inline(line) }); open = true; }
  }
  return blocks;
}

// A block too long for one passage, split at sentence ends, then at spaces, then anywhere.
function pieces(text) {
  if (length(text) <= MAX_PASSAGE) return [text];
  const out = [];
  let rest = text;
  while (length(rest) > MAX_PASSAGE) {
    const head = cut(rest, MAX_PASSAGE + 1);
    const at = Math.max(head.lastIndexOf('. ') + 1, head.lastIndexOf('? ') + 1, head.lastIndexOf('! ') + 1);
    const end = at > 0 ? at : head.lastIndexOf(' ') > 0 ? head.lastIndexOf(' ') : cut(rest, MAX_PASSAGE).length;
    out.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// Blocks into passages: each heading starts one (unless the passage so far is only headings), and a passage
// never passes MAX_PASSAGE code points.
function passages(blocks) {
  const out = [];
  let current = '', body = false;
  const flush = () => { if (current) out.push(current); current = ''; body = false; };
  for (const block of blocks) {
    if (!block.text) continue;
    if (block.heading && body) flush();
    for (const piece of pieces(block.text)) {
      if (current && length(current) + 1 + length(piece) > MAX_PASSAGE) flush();
      current = current ? `${current}\n${piece}` : piece;
    }
    if (!block.heading) body = true;
  }
  flush();
  return out;
}

async function files(dir, keep, rel = '') {
  const found = [];
  for (const entry of (await readdir(join(dir, rel), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await files(dir, keep, path));
    else if (entry.isFile() && keep(path)) found.push(path);
  }
  return found;
}

// The index of `site` (a built site folder) and `docs` (an OpenWiz checkout); either may be left out.
export async function buildIndex({ site, docs } = {}) {
  const pages = [];
  if (site) {
    const html = await files(site, path => /(^|\/)index\.html$/.test(path) && !path.startsWith('app/'));
    for (const path of html.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))) {
      const text = await readFile(join(site, path), 'utf8');
      const title = squash(decode(text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''));
      const url = SITE + path.replace(/index\.html$/, '');
      pages.push({ title: title || url, url, blocks: htmlBlocks(text) });
    }
  }
  if (docs) {
    const markdown = ['README.md', ...(await readdir(join(docs, 'docs')).catch(() => []))
      .filter(name => name.endsWith('.md')).sort().map(name => `docs/${name}`)];
    for (const path of markdown) {
      const text = await readFile(join(docs, path), 'utf8').catch(() => null);
      if (text === null) continue;
      const blocks = markdownBlocks(text);
      // README's top heading is a picture, so it has a fixed title; each doc is titled by its first heading.
      const title = path === 'README.md' ? 'OpenWiz README' : blocks.find(b => b.heading && b.text)?.text || path;
      pages.push({ title, url: DOCS + path, blocks });
    }
  }
  const index = { schema: SCHEMA, sources: [], passages: [] };
  for (const page of pages) {
    const texts = passages(page.blocks);
    if (!texts.length) continue;
    const source = index.sources.push({ title: cut(page.title, MAX_FIELD), url: page.url }) - 1;
    for (const text of texts) index.passages.push({ source, text });
  }
  checkIndex(index);
  return index;
}

// Throws unless `index` is exactly the contract's form.
export function checkIndex(index) {
  const fail = why => { throw new Error(`ask index: ${why}`); };
  const keys = (value, want) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === want;
  if (!keys(index, 'passages,schema,sources') || index.schema !== SCHEMA) fail('wrong keys or schema');
  if (!Array.isArray(index.sources) || !index.sources.length) fail('no sources');
  if (!Array.isArray(index.passages) || !index.passages.length) fail('no passages');
  const urls = new Set();
  for (const source of index.sources) {
    if (!keys(source, 'title,url') || typeof source.title !== 'string' || typeof source.url !== 'string') fail('a bad source');
    if (!(length(source.title) >= 1 && length(source.title) <= MAX_FIELD && length(source.url) >= 1 && length(source.url) <= MAX_FIELD)) fail(`a bad source: ${source.url}`);
    if (!PREFIXES.some(prefix => source.url.startsWith(prefix))) fail(`a source off the site and repositories: ${source.url}`);
    if (urls.has(source.url)) fail(`a source twice: ${source.url}`);
    urls.add(source.url);
  }
  for (const passage of index.passages) {
    if (!keys(passage, 'source,text') || !Number.isInteger(passage.source) || passage.source < 0 || passage.source >= index.sources.length) fail('a bad passage');
    if (typeof passage.text !== 'string' || length(passage.text) < 1 || length(passage.text) > MAX_PASSAGE) fail('a passage of the wrong length');
  }
  if (Buffer.byteLength(serialize(index)) > MAX_BYTES) fail(`over ${MAX_BYTES} bytes`);
}

// The file's text: JSON with every non-ASCII character escaped, so it reads the same in any encoding.
export const serialize = index => JSON.stringify(index).replace(/[\u007f-￿]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

// Stubs for the snapshot's red run.
export async function checkSnapshot() {}
export async function refreshSnapshot(checkout, target) { await (await import("node:fs/promises")).mkdir(target, { recursive: true }); }
export const snapshotIndex = async site => serialize(await buildIndex({ site }));
