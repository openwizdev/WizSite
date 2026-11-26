import { readFileSync } from 'node:fs';

const file = new URL('../pricing/checkout.json', import.meta.url);

export function parseCheckout(value) {
  if (typeof value !== 'string') throw new Error('pricing/checkout.json checkoutUrl must be a string');
  const url = value.trim();
  if (!url) return '';
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('pricing/checkout.json checkoutUrl must be an https URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname) {
    throw new Error('pricing/checkout.json checkoutUrl must be an https URL with no username or password');
  }
  return url;
}

export function readCheckout(text = readFileSync(file, 'utf8')) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).join() !== 'checkoutUrl') {
    throw new Error('pricing/checkout.json has one field, checkoutUrl');
  }
  return parseCheckout(data.checkoutUrl);
}

function escapeAttr(value) {
  return value.replace(/[&"<>]/g, char => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[char]);
}

export function checkoutControl(url) {
  const href = parseCheckout(url);
  if (!href) {
    return '<button class="price-subscribe" type="button" disabled data-checkout aria-describedby="price-wait">Coming soon</button><p class="price-wait" id="price-wait">Supporter checkout is not open yet.</p>';
  }
  return `<a class="price-subscribe" href="${escapeAttr(href)}" rel="noreferrer" data-checkout>Subscribe</a>`;
}

export function withCheckout(html, url = readCheckout()) {
  const start = '<!-- checkout:start -->';
  const end = '<!-- checkout:end -->';
  const parts = html.split(start);
  if (parts.length !== 2 || parts[1].split(end).length !== 2) throw new Error('the pricing page needs one checkout slot');
  const [, after] = parts[1].split(end);
  return parts[0] + start + checkoutControl(url) + end + after;
}
