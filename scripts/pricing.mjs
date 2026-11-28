import { readFileSync } from 'node:fs';

const checkoutFile = new URL('../pricing/checkout.json', import.meta.url);
const tiersFile = new URL('../pricing/tiers.json', import.meta.url);
const TIER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_TIER_KEYS = new Set(['id', 'name', 'price', 'period', 'checkoutKey', 'cta', 'perks']);

export function parseCheckout(value) {
  if (typeof value !== 'string') throw new Error('pricing/checkout.json checkout URL must be a string');
  const url = value.trim();
  if (!url) return '';
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('pricing/checkout.json checkout URL must be an https URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname) {
    throw new Error('pricing/checkout.json checkout URL must be an https URL with no username or password');
  }
  return url;
}

export function readTiers(text = readFileSync(tiersFile, 'utf8')) {
  const data = JSON.parse(text);
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('pricing/tiers.json must be a non-empty array');
  }
  const seenIds = new Set();
  const seenCheckoutKeys = new Set();
  return data.map((tier, index) => {
    if (!tier || typeof tier !== 'object' || Array.isArray(tier)) {
      throw new Error(`pricing/tiers.json entry ${index} must be an object`);
    }
    for (const key of Object.keys(tier)) {
      if (!ALLOWED_TIER_KEYS.has(key)) {
        throw new Error(`pricing/tiers.json entry ${index} has unknown field ${key}`);
      }
    }
    const { id, name, price, period, checkoutKey, cta, perks } = tier;
    if (typeof id !== 'string' || !TIER_ID.test(id) || seenIds.has(id)) {
      throw new Error(`pricing/tiers.json entry ${index} needs a unique slug id`);
    }
    seenIds.add(id);
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error(`pricing/tiers.json ${id} needs a non-empty name`);
    }
    if (!Number.isInteger(price) || price < 0) {
      throw new Error(`pricing/tiers.json ${id} price must be a non-negative integer`);
    }
    if (!Array.isArray(perks) || perks.length === 0 || perks.some(p => typeof p !== 'string' || !p.trim())) {
      throw new Error(`pricing/tiers.json ${id} perks must be a non-empty array of strings`);
    }
    if (price === 0) {
      if (period !== null || checkoutKey !== null) {
        throw new Error(`pricing/tiers.json free tier ${id} must have null period and checkoutKey`);
      }
      if (!cta || typeof cta !== 'object' || Array.isArray(cta) ||
          typeof cta.label !== 'string' || !cta.label.trim() ||
          typeof cta.href !== 'string' || !cta.href.startsWith('/') || cta.href.startsWith('//')) {
        throw new Error(`pricing/tiers.json free tier ${id} needs a relative cta {label, href}`);
      }
      return { id, name: name.trim(), price, period: null, checkoutKey: null, cta: { label: cta.label.trim(), href: cta.href }, perks: perks.map(p => p.trim()) };
    }
    if (period !== 'month') {
      throw new Error(`pricing/tiers.json paid tier ${id} period must be "month"`);
    }
    if (typeof checkoutKey !== 'string' || !checkoutKey.trim() || seenCheckoutKeys.has(checkoutKey.trim())) {
      throw new Error(`pricing/tiers.json paid tier ${id} needs a unique non-empty checkoutKey`);
    }
    if (cta !== undefined) {
      throw new Error(`pricing/tiers.json paid tier ${id} must not define cta`);
    }
    seenCheckoutKeys.add(checkoutKey.trim());
    return { id, name: name.trim(), price, period, checkoutKey: checkoutKey.trim(), perks: perks.map(p => p.trim()) };
  });
}

export function readCheckout(text = readFileSync(checkoutFile, 'utf8'), expectedKeys = null) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('pricing/checkout.json must be an object mapping tier keys to https URLs');
  }
  const keys = Object.keys(data);
  if (keys.length === 0) {
    throw new Error('pricing/checkout.json must not be empty');
  }
  const result = {};
  for (const key of keys) {
    if (!key.trim()) throw new Error('pricing/checkout.json keys must be non-empty');
    result[key] = parseCheckout(data[key]);
  }
  if (expectedKeys !== null) {
    const actualSorted = [...keys].sort().join(',');
    const expectedSorted = [...expectedKeys].sort().join(',');
    if (actualSorted !== expectedSorted) {
      throw new Error(`pricing/checkout.json keys (${actualSorted}) must match paid tiers (${expectedSorted})`);
    }
  }
  return result;
}

function escapeHtml(value) {
  return value.replace(/[&"<>]/g, char => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[char]);
}

export function checkoutControl(url, tierKey = '') {
  const href = parseCheckout(url);
  const tierAttr = tierKey ? ` data-tier="${escapeHtml(tierKey)}"` : '';
  if (!href) {
    return `<button class="price-subscribe" type="button" disabled data-checkout${tierAttr}>Coming with 0.2.0</button>`;
  }
  return `<a class="price-subscribe" href="${escapeHtml(href)}" rel="noreferrer" data-checkout${tierAttr}>Subscribe</a>`;
}

export function renderTiers(tiers = readTiers(), checkout = readCheckout()) {
  const paidKeys = tiers.filter(t => t.price > 0).map(t => t.checkoutKey);
  const checkoutKeys = Object.keys(checkout);
  if ([...paidKeys].sort().join(',') !== [...checkoutKeys].sort().join(',')) {
    throw new Error('pricing/checkout.json keys must match the paid tiers in pricing/tiers.json');
  }
  return tiers.map(tier => {
    const cardClass = tier.price > 0 ? 'price-card price-supporter' : 'price-card';
    const headingId = `price-${escapeHtml(tier.id)}`;
    const amount = tier.price === 0
      ? `<p class="price-amount"><b>$0</b></p>`
      : `<p class="price-amount"><b>$${tier.price}</b> <span>/ ${escapeHtml(tier.period)}</span></p>`;
    const items = tier.perks.map(perk => `          <li>${escapeHtml(perk)}</li>`).join('\n');
    const action = tier.price === 0
      ? `<a class="price-get" href="${escapeHtml(tier.cta.href)}">${escapeHtml(tier.cta.label)}</a>`
      : checkoutControl(checkout[tier.checkoutKey], tier.checkoutKey);
    return [
      `      <article class="${cardClass}" aria-labelledby="${headingId}">`,
      `        <h2 id="${headingId}">${escapeHtml(tier.name)}</h2>`,
      `        ${amount}`,
      '        <ul>',
      items,
      '        </ul>',
      `        ${action}`,
      '      </article>',
    ].join('\n');
  }).join('\n');
}

export function withCheckout(html, checkout = readCheckout(), tiers = readTiers()) {
  const slot = '<template data-slot="checkout"></template>';
  if (html.split(slot).length !== 2) throw new Error('the pricing page needs one checkout slot');
  return html.replace(slot, renderTiers(tiers, checkout));
}
