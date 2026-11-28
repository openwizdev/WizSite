import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { withDrivers } from './drivers.mjs';

const page = await readFile(new URL('../drivers/index.html', import.meta.url), 'utf8');
const listing = (id, name, extra = {}) => ({
  id, name, summary: `${name} summary.`, tags: ['driver', 'cloud'],
  url: `https://example.invalid/${id}`, plugs_into: 'OpenWiz driver v1', publisher: 'synthetic',
  stage: 'being-built', status: 'listed', login: 'Held by synthetic',
  links: [{ label: 'Work', url: `https://example.invalid/work/${id}` }], ...extra,
});
const proof = { receipt: { url: 'https://example.invalid/receipt', date: '2026-11-01' } };
const registry = { listings: [
  listing('cursor-cloud-agents', 'Cursor Cloud Agents'),
  listing('openhands-cloud', 'OpenHands Cloud'),
  listing('codespaces', 'GitHub Codespaces'),
  listing('github-codespaces', 'GitHub Codespaces alias'),
  listing('devin', 'Devin'),
  listing('local', 'Computer', { stage: 'available', status: 'verified', proof }),
  listing('fly-sprites', 'Fly Sprites'),
  ...Array.from({ length: 12 }, (_, i) => listing(`synthetic-${i}`, `Synthetic ${i}`)),
] };
const shipped = { listings: [
  listing('cursor-cloud-agents', 'Cursor Cloud Agents', { stage: 'available', status: 'verified', proof }),
  listing('openhands-cloud', 'OpenHands Cloud', { stage: 'available', status: 'verified', proof }),
] };

function assess(html) {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  const card = id => html.match(new RegExp(`<article class="driver" id="${id}"[\\s\\S]*?<\\/article>`));
  const cursor = card('cursor');
  const openhands = card('openhands');
  return {
    duplicates,
    shippedCursorPageId: Boolean(cursor),
    shippedCursorLogo: Boolean(cursor && /\/drivers\/logos\/cursor\.svg/.test(cursor[0]) && /data-listing="cursor-cloud-agents"/.test(cursor[0])),
    shippedOpenhandsPageId: Boolean(openhands),
    shippedOpenhandsLogo: Boolean(openhands && /\/drivers\/logos\/openhands\.svg/.test(openhands[0]) && /data-listing="openhands-cloud"/.test(openhands[0])),
    strayMarketId: /\sid="cursor-cloud-agents"/.test(html) || /\sid="openhands-cloud"/.test(html),
  };
}

const iterations = 200;
withDrivers(page, registry);
const started = performance.now();
let html = '';
for (let i = 0; i < iterations; i++) html = withDrivers(page, registry);
const ms = performance.now() - started;
const result = {
  iterations,
  ms: Number(ms.toFixed(2)),
  msPerCall: Number((ms / iterations).toFixed(3)),
  unshippedDuplicates: assess(html).duplicates,
  shipped: assess(withDrivers(page, shipped)),
};
const ok = result.unshippedDuplicates.length === 0
  && result.shipped.duplicates.length === 0
  && result.shipped.shippedCursorPageId
  && result.shipped.shippedCursorLogo
  && result.shipped.shippedOpenhandsPageId
  && result.shipped.shippedOpenhandsLogo
  && result.shipped.strayMarketId === false;
console.log(JSON.stringify({ ...result, ok }));
if (!ok) process.exit(1);
