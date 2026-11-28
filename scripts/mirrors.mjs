import { decode } from './ask-index.mjs';

const site = 'https://openwiz.dev/';
const plainText = text => decode(text).replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const mirrorPath = page => page === 'index.html' ? 'index.md' : page.replace(/\/index\.html$/, '.md');

const inline = html => {
  const tokens = [];
  const hold = value => {
    tokens.push(value);
    return `\u0001${tokens.length - 1}\u0001`;
  };
  const restore = text => text.replace(/\u0001(\d+)\u0001/g, (_, i) => tokens[Number(i)]);
  const stripped = html
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/g, (_, code) => hold('`' + decode(code.replace(/<[^>]*>/g, '')) + '`'))
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/g, '**$2**')
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/g, '*$2*')
    .replace(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, url, label) => {
      const text = restore(plainText(label.replace(/<[^>]*>/g, ''))).replace(/\s+/g, ' ').trim();
      return text ? hold(`[${text}](${new URL(decode(url), site)})`) : '';
    })
    .replace(/<\/(span|div|td|th|dt|dd)>/g, ' ')
    .replace(/<[^>]*>/g, '');
  return restore(plainText(stripped)).replace(/\s+/g, ' ').trim();
};

export function pageMarkdown(html) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/);
  if (!main) throw new Error('a page needs one <main> for its Markdown copy');
  let body = main[1]
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|template|svg|noscript|form|video|audio|picture|figure|dialog)\b[\s\S]*?<\/\1>/g, '')
    .replace(/<(\w+)\b[^>]*\b(hidden|aria-hidden="true")[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/(<h[1-6]\b[^>]*>)\s*<button\b[^>]*>([\s\S]*?)<\/button>\s*(<\/h[1-6]>)/g, '$1$2$3')
    .replace(/<button\b[^>]*>([\s\S]*?)<\/button>/g, '')
    .replace(/<code\b[^>]*class="[^"]*install-line[^"]*"[^>]*>([\s\S]*?)<\/code>/g, '<p><code>$1</code></p>');
  const blocks = [];
  const pre = [];
  body = body.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/g, (_, code) => {
    pre.push('```\n' + decode(code.replace(/<[^>]*>/g, '')).replace(/\n+$/, '') + '\n```');
    return `<p>\u0000${pre.length - 1}\u0000</p>`;
  });
  const token = /<(h[1-6]|p|li|blockquote|dt|dd|td|th|figcaption)\b[^>]*>([\s\S]*?)<\/\1>/g;
  for (const [, tag, inner] of body.matchAll(token)) {
    const fence = inner.match(/^\u0000(\d+)\u0000$/);
    if (fence) { blocks.push(pre[Number(fence[1])]); continue; }
    if (/<(p|li|h[1-6])\b/.test(inner)) continue;
    const text = inline(inner);
    if (!text || /^[\d\s.,%#]*$/.test(text)) continue;
    if (tag[0] === 'h') blocks.push('#'.repeat(Number(tag[1])) + ' ' + text);
    else if (tag === 'li') blocks.push('- ' + text);
    else if (tag === 'blockquote') blocks.push('> ' + text);
    else blocks.push(text);
  }
  return blocks.reduce((out, block, i) => out + (i === 0 ? '' : (block.startsWith('- ') && blocks[i - 1].startsWith('- ') ? '\n' : '\n\n')) + block, '') + '\n';
}

export function mirrorFile(page, title, html) {
  const url = site + page.replace(/index\.html$/, '');
  const text = pageMarkdown(html);
  const heading = text.startsWith('# ') ? '' : `# ${title}\n\n`;
  return `${heading}${text}\nSource: ${url}\n`;
}

export const mirrorLink = page => `<link rel="alternate" type="text/markdown" href="/${mirrorPath(page)}">`;
