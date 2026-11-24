import { clickLinkAttribute } from './count-links.mjs';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// The landing's "Bring any agent" section: what you can bring today, what is coming, and WizMarket's long tail.
// Data comes only from landing/reach.json (written by scripts/landing-sync.mjs) and market/registry.json.
const ROOT = new URL('../', import.meta.url);
export const REACH = new URL('landing/reach.json', ROOT);
export const SLOT = '<template data-slot="reach"></template>';
export const START = '<!-- reach:start -->';
export const END = '<!-- reach:end -->';

// Names as their makers write them, keyed by OpenWiz's folder name (harness row or driver).
export const NAMES = {
  agent: {
    claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity', amp: 'Amp', auggie: 'Auggie', copilot: 'GitHub Copilot CLI',
    gemini: 'Gemini CLI', goose: 'goose', junie: 'Junie', kilo: 'Kilo Code', kimi: 'Kimi Code', oz: 'Warp', pi: 'Pi',
    qwen: 'Qwen Code', opencode: 'OpenCode', cursor: 'Cursor CLI', crush: 'Crush', kiro: 'Kiro CLI', vibe: 'Mistral Vibe',
    cline: 'Cline',
  },
  host: {
    local: 'Your computer or VPS', boat: 'boat.dev', cloudroom: 'Cloudroom', codespaces: 'GitHub Codespaces', devin: 'Devin',
    factory: 'Factory', hermes: 'Hermes', openclaw: 'OpenClaw', sprites: 'Fly Sprites', cursor: 'Cursor cloud agents',
    conductor: 'Conductor', pane: 'Pane', ona: 'Ona', tembo: 'Tembo', capy: 'Capy', openhands: 'OpenHands Cloud',
    'warp-oz': 'Warp Oz',
  },
};
// The move of every driver into its own package and repository (OpenWiz's driver package contract and per-folder driver lists).
export const PLATFORM = { id: 'driver-packages', name: 'Every driver in its own package and repo', prs: [3053, 3113] };

const KINDS = new Set(['agent', 'host', 'platform']);
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PR = /^https:\/\/github\.com\/openwizdev\/OpenWiz\/pull\/(\d+)$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 .'-]{0,47}$/;

export function parse(reach) {
  const fail = why => { throw new Error(`landing/reach.json: ${why}`); };
  if (!/^[0-9a-f]{40}$/.test(reach?.openwiz?.commit ?? '')) fail('openwiz.commit must be a 40-hex commit');
  for (const date of [reach.openwiz.date, reach.synced]) if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) fail('dates must be YYYY-MM-DD');
  if (!Array.isArray(reach.items) || !reach.items.length) fail('items must be a non-empty list');
  const keys = new Set();
  for (const item of reach.items) {
    const key = `${item.kind}:${item.id}`;
    if (!KINDS.has(item.kind) || !ID.test(item.id ?? '') || !NAME.test(item.name ?? '') || keys.has(key)) fail(`bad or repeated item ${JSON.stringify(item?.id)}`);
    keys.add(key);
    if (item.tier === 'today' ? item.kind === 'platform' || 'prs' in item : item.tier !== 'coming') fail(`${item.id}: today items are agents or hosts with no PR`);
    if (item.tier === 'coming' && (!Array.isArray(item.prs) || !item.prs.length
      || item.prs.some(pr => PR.exec(pr?.url ?? '')?.[1] !== String(pr.number)))) fail(`${item.id}: a coming item links its OpenWiz PRs`);
  }
  for (const item of reach.items) {
    if (item.tier === 'coming' && item.kind !== 'platform' && reach.items.some(t => t.tier === 'today' && t.kind === item.kind && t.id === item.id)) {
      fail(`${item.id} is on OpenWiz main, so it cannot be coming`);
    }
  }
  return reach;
}

export const readReach = async (file = REACH) => parse(JSON.parse(await readFile(file, 'utf8')));

const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
const first = ids => (a, b) => (ids.includes(b.id) - ids.includes(a.id)) || (ids.indexOf(a.id) - ids.indexOf(b.id)) || byName(a, b);
const link = (url, label) => `<a href="${esc(url)}"${clickLinkAttribute(url)}>${label}</a>`;

export function groups(reach) {
  const of = (tier, kind) => reach.items.filter(item => item.tier === tier && item.kind === kind);
  return {
    agents: of('today', 'agent').sort(first(['claude', 'codex'])),
    hosts: of('today', 'host').sort(first(['local'])),
    coming: [...of('coming', 'agent').sort(byName), ...of('coming', 'host').sort(byName), ...of('coming', 'platform')],
  };
}

export function render(reach, registry) {
  const { agents, hosts, coming } = groups(reach);
  const today = agents.length + hosts.length;
  const market = registry.listings.length;
  const index = (title, items, n) => `<div class="reach-group"><h4>${title} <span>${items.length}</span></h4><ol>`
    + items.map((item, i) => `<li data-reach="${item.kind}:${item.id}"><span class="reach-no" aria-hidden="true">${String(n + i + 1).padStart(2, '0')}</span>${esc(item.name)}</li>`).join('')
    + '</ol></div>';
  const kind = { agent: 'agent', host: 'host', platform: 'drivers' };
  const comingItem = item => `<li data-reach="${item.kind}:${item.id}">${esc(item.name)} <span class="reach-kind">${kind[item.kind]}</span> `
    + item.prs.map(pr => link(pr.url, `#${pr.number}`)).join(' ') + '</li>';
  const shown = coming.slice(0, 3).map(item => esc(item.name)).join(', ');
  const more = coming.length > 3 ? ` <span class="reach-more">+${coming.length - 3} more</span>` : '';
  const plate = [`<span><b>${today}</b> agents and hosts today</span>`];
  if (coming.length) plate.push(`<span><b>${coming.length}</b> coming</span>`);
  if (market) plate.push(`<span><b>${market}</b> on WizMarket</span>`);
  return '<div class="reach-head"><h2 id="agents-title">Bring any agent</h2>'
    + '<p class="reach-lead">OpenWiz never asks for your logins. Bring your own agents, subscriptions and machines.</p></div>'
    + `<p class="reach-plate">${plate.join('')}</p>`
    + '<div class="reach-today"><h3 class="reach-tier">Today</h3><div class="reach-cols">'
    + index('Agents', agents, 0) + index('Where they run', hosts, agents.length) + '</div></div>'
    + (coming.length ? `<details class="reach-coming"><summary><span class="reach-tier">Coming</span> <span class="reach-next">${shown}</span>${more}</summary>`
      + `<ul>${coming.map(comingItem).join('')}</ul></details>` : '')
    + `<p class="reach-tail"><a href="/market/">${market ? `+${market} more on WizMarket` : 'More on WizMarket'}</a><a href="/drivers/">See every driver</a></p>`
    + `<p class="reach-src">From OpenWiz main at <code>${reach.openwiz.commit.slice(0, 7)}</code> and its open pull requests.</p>`;
}

export function withReach(page, section) {
  if (page.includes(START) || page.split(SLOT).length !== 2) throw new Error('landing: expected one reach slot and no generated section');
  return page.replace(SLOT, () => `${START}${section}${END}`);
}

export const summary = reach => {
  const { agents, hosts, coming } = groups(reach);
  return `${agents.length} agents and ${hosts.length} hosts today, ${coming.length} coming, at OpenWiz ${reach.openwiz.commit.slice(0, 12)}`;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { readRegistry } = await import('./market.mjs');
  process.stdout.write(render(await readReach(), await readRegistry()));
}
