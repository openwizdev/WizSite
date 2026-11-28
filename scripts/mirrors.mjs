import { decode } from './ask-index.mjs';

const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const omitted = new Set('script style svg template noscript nav footer'.split(' '));
const containers = new Set('address article aside dd details div dl dt figcaption figure header main p section summary table tbody td th thead tfoot'.split(' '));
const emphasis = new Map([['b', '**'], ['strong', '**'], ['em', '*'], ['i', '*']]);

export function mirrorPath(page) {
  return page === 'index.html' ? 'index.md' : page.replace(/\/index\.html$|\.html$/, '') + '.md';
}

function readMain(html) {
  const root = { children: [] };
  const stack = [root];
  const tokens = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<(\/?)([a-z][\w:-]*)(?=[\s/>])((?:"[^"]*"|'[^']*'|[^'"<>])*)>|[^<]+|</gi;
  for (const [token, raw, closing, name, attributes] of html.matchAll(tokens)) {
    if (raw || token.startsWith('<!--')) continue;
    const parent = stack.at(-1);
    if (!name) {
      if (stack.length > 1) parent.children.push(decode(token));
      continue;
    }
    const tag = name.toLowerCase();
    if (stack.length === 1 && (tag !== 'main' || closing)) continue;
    if (closing) {
      const index = stack.findLastIndex(node => node.tag === tag);
      if (index > 0) stack.length = index;
      continue;
    }
    const attrs = Object.fromEntries([...attributes.matchAll(/([^\s=/'"<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)]
      .map(([, key, double, single, bare]) => [key.toLowerCase(), decode(double ?? single ?? bare ?? '')]));
    const node = { tag, attrs, children: [] };
    parent.children.push(node);
    if (!voidTags.has(tag) && !attributes.endsWith('/')) stack.push(node);
  }
  if (root.children.length !== 1) throw new Error('Expected exactly one <main> for a Markdown copy');
  return root.children[0];
}

const ticks = (text, minimum) => '`'.repeat(Math.max(minimum, ...Array.from(text.matchAll(/`+/g), run => run[0].length + 1)));
const block = text => text.trim() ? '\n\n' + text.trim() + '\n\n' : '';
const literal = text => text.replace(/[\\`*_[\]<>]/g, '\\$&');
const rawText = node => typeof node === 'string' ? node : node.children.map(rawText).join('');

function renderList(node, pageUrl) {
  const ordered = node.tag === 'ol';
  let number = Number.parseInt(node.attrs.start, 10) || 1;
  return node.children.filter(child => child.tag === 'li').map(item => {
    const marker = ordered ? `${number++}. ` : '- ';
    const content = renderChildren(item, pageUrl, list => '\n' + renderList(list, pageUrl) + '\n').trim();
    const indent = ' '.repeat(marker.length);
    return marker + content.replace(/\n([^\n])/g, '\n' + indent + '$1');
  }).join('\n');
}

function renderChildren(node, pageUrl, nestedList) {
  let text = '';
  for (const child of node.children) {
    const next = nestedList && (child.tag === 'ul' || child.tag === 'ol') ? nestedList(child) : render(child, pageUrl);
    if (next.startsWith('\n')) text = text.trimEnd();
    text += /\s$/.test(text) && next.startsWith(' ') ? next.slice(1) : next;
  }
  return text;
}

function render(node, pageUrl) {
  if (typeof node === 'string') return literal(node.replace(/\s+/g, ' '));
  const { tag, attrs, children } = node;
  if (omitted.has(tag) || attrs.role === 'navigation' || attrs['aria-hidden'] === 'true') return '';
  if (tag === 'pre') {
    const code = rawText(node).replace(/^\n/, '').replace(/\n$/, '');
    const language = children.find(child => child.tag === 'code')?.attrs.class?.match(/(?:^|\s)language-([\w+-]+)/)?.[1] ?? '';
    const fence = ticks(code, 3);
    return block(`${fence}${language}\n${code}\n${fence}`);
  }
  if (tag === 'code' || tag === 'kbd') {
    const code = rawText(node).replace(/\s+/g, ' ').trim();
    const fence = ticks(code, 1);
    const value = code.startsWith('`') || code.endsWith('`') ? ` ${code} ` : code;
    return code ? fence + value + fence : '';
  }
  if (tag === 'ul' || tag === 'ol') return block(renderList(node, pageUrl));
  if (tag === 'tr') return block(children.filter(cell => cell.tag === 'th' || cell.tag === 'td')
    .map(cell => renderChildren(cell, pageUrl).trim()).join(' · '));
  const content = renderChildren(node, pageUrl);
  if (tag === 'a' && attrs.href && content.trim()) {
    const url = new URL(attrs.href, pageUrl);
    if (['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol)) {
      const target = url.href.replace(/[()]/g, char => char === '(' ? '%28' : '%29');
      return content.replace(/\S(?:[\s\S]*\S)?/, label => `[${label}](${target})`);
    }
  }
  if (/^h[1-6]$/.test(tag)) return content.trim() ? block('#'.repeat(Number(tag[1])) + ' ' + content.trim()) : '';
  const marker = emphasis.get(tag);
  if (marker) return content.replace(/\S(?:[\s\S]*\S)?/, text => marker + text + marker);
  if (tag === 'blockquote') return block(content.trim().split('\n').map(line => line ? '> ' + line : '>').join('\n'));
  if (tag === 'br') return '\n';
  if (tag === 'hr') return block('---');
  return containers.has(tag) ? block(content) : content;
}

export function toMarkdown(html, pageUrl) {
  const markdown = render(readMain(html), pageUrl).trim();
  if (!markdown) throw new Error(`No <main> text for ${pageUrl}`);
  return markdown + '\n';
}
