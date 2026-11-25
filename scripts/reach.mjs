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

// SVG marks reused from /drivers/logos/ (SVG over PNG; text-only chip when no SVG exists or brand rules forbid a mark).
export const LOGOS = {
  'agent:agy': 'antigravity.svg',
  'agent:amp': 'amp.svg',
  'agent:auggie': 'augment.svg',
  'agent:gemini': 'gemini-cli.svg',
  'agent:kilo': 'kilo-code.svg',
  'agent:kimi': 'kimi-code.svg',
  'agent:oz': 'warp.svg',
  'agent:pi': 'pi.svg',
  'agent:qwen': 'qwen-code.svg',
  'host:local': 'monitor.svg',
  'host:boat': 'boat-dev.svg',
  'host:devin': 'devin.svg',
  'host:factory': 'factory.svg',
  'host:openclaw': 'openclaw.svg',
};

const INLINE_MARKS = {
  'agent:claude': '<svg aria-hidden="true" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" fill="#D97757" fill-rule="nonzero"></path></svg>',
  'agent:codex': '<svg aria-hidden="true" fill="currentColor" fill-rule="evenodd" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path clip-rule="evenodd" d="M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z"></path></svg>',
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

function markFor(item) {
  const key = `${item.kind}:${item.id}`;
  if (INLINE_MARKS[key]) return INLINE_MARKS[key];
  const file = LOGOS[key];
  if (!file) return '';
  return `<img src="/drivers/logos/${file}" alt="" width="18" height="18" loading="lazy" decoding="async">`;
}

export function render(reach, registry) {
  const { agents, hosts, coming } = groups(reach);
  const today = agents.length + hosts.length;
  const market = registry.listings.length;
  const stats = [`<strong>${today}</strong> agents and hosts today`];
  if (coming.length) stats.push(`<strong>${coming.length}</strong> coming`);
  if (market) stats.push(`<strong>${market}</strong> on WizMarket`);
  const group = (title, items) => `<div class="reach-group"><h4>${title} <span>${items.length}</span></h4><ul class="reach-grid">`
    + items.map(item => `<li data-reach="${item.kind}:${item.id}">${markFor(item)}${esc(item.name)}</li>`).join('')
    + '</ul></div>';
  const preview = coming.slice(0, 2).map(item => `<span>${esc(item.name)}</span>`).join('');
  const more = coming.length > 2 ? `<b class="reach-more">+${coming.length - 2} more</b>` : '';
  const comingItem = item => `<li data-reach="${item.kind}:${item.id}">${esc(item.name)} `
    + item.prs.map(pr => link(pr.url, `#${pr.number}`)).join(' ') + '</li>';
  const marketLabel = market ? `+${market} more on WizMarket` : 'Browse WizMarket';
  return '<div class="reach-head"><h2 id="agents-title">Bring any agent</h2>'
    + '<p class="reach-lead">OpenWiz never asks for your logins. Bring your own agents, subscriptions and machines.</p>'
    + `<p class="reach-hero">${stats.join(', ')}</p></div>`
    + '<div class="reach-tier"><h3 class="reach-label">Today</h3><div class="reach-groups">'
    + group('Agents', agents) + group('Where they run', hosts) + '</div></div>'
    + (coming.length ? `<details class="reach-coming"><summary><span class="reach-label">Coming</span><span class="reach-preview">${preview}${more}</span></summary>`
      + `<ul class="reach-coming-list">${coming.map(comingItem).join('')}</ul></details>` : '')
    + `<div class="reach-tail"><a href="/market/">${marketLabel}</a><a href="/drivers/">See every driver</a></div>`;
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
