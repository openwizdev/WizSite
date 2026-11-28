import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { devNull } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REACH, NAMES, PLATFORM, parse } from './reach.mjs';

const USAGE = 'usage: node scripts/landing-sync.mjs <OpenWiz checkout> <open-PRs JSON from: gh pr list -R openwizdev/OpenWiz --state open --limit 300 --json number,title,url,headRefName,files>';
const PR_URL = /^https:\/\/github\.com\/openwizdev\/OpenWiz\/pull\/(\d+)$/;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

const git = (dir, ...args) => execFileSync('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'core.fsmonitor=false', '-C', dir, ...args],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const nameOf = (kind, id, warn) => {
  const name = NAMES[kind][id];
  if (!name) warn(`no display name for ${kind} ${id}: add it to NAMES in scripts/reach.mjs`);
  return name ?? id;
};

export function collect(checkout, prs, warn = () => {}) {
  const dir = resolve(checkout);
  const refuse = why => { throw new Error(`landing-sync: refused: ${why}`); };
  if (!existsSync(join(dir, '.git')) || !existsSync(join(dir, 'adapters/local/harnesses'))) refuse('not an OpenWiz checkout');
  const commit = git(dir, 'rev-parse', 'HEAD');
  if (!/^[0-9a-f]{40}$/.test(commit)) refuse('the checkout\'s HEAD is not a 40-hex commit');
  const date = git(dir, 'show', '-s', '--format=%cs', 'HEAD');
  const folders = path => readdirSync(join(dir, path), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
  const rows = folders('adapters/local/harnesses').filter(id => existsSync(join(dir, 'adapters/local/harnesses', id, 'row.json')));
  const drivers = folders('adapters').filter(id => id !== 'template' && existsSync(join(dir, 'adapters', id, 'driver')));
  for (const id of rows) JSON.parse(readFileSync(join(dir, 'adapters/local/harnesses', id, 'row.json'), 'utf8'));
  const agents = ['claude', 'codex', ...rows.filter(id => id !== 'claude' && id !== 'codex')];
  const items = [
    ...agents.map(id => ({ id, name: nameOf('agent', id, warn), kind: 'agent', tier: 'today' })),
    ...drivers.map(id => ({ id, name: nameOf('host', id, warn), kind: 'host', tier: 'today' })),
  ];
  const onMain = { agent: new Set(agents), host: new Set(drivers) };
  if (!Array.isArray(prs)) refuse('the PR list is not a JSON array');
  const seen = new Set();
  const platform = [];
  for (const pr of [...prs].sort((a, b) => a.number - b.number)) {
    const match = PR_URL.exec(pr?.url ?? '');
    if (!match || Number(match[1]) !== pr.number || !Array.isArray(pr.files)) refuse(`PR entry ${JSON.stringify(pr?.number)} is not an open OpenWiz PR with its files`);
    if (PLATFORM.prs.includes(pr.number)) platform.push({ number: pr.number, url: pr.url });
    for (const { path } of pr.files) {
      const row = /^adapters\/local\/harnesses\/([^/]+)\/row\.json$/.exec(path);
      const driver = /^adapters\/([^/]+)\/driver$/.exec(path);
      const [kind, id] = row ? ['agent', row[1]] : driver && driver[1] !== 'template' ? ['host', driver[1]] : [];
      if (!kind || onMain[kind].has(id) || seen.has(`${kind}:${id}`)) continue;
      if (!ID.test(id)) refuse(`PR #${pr.number} adds an unexpected folder name`);
      seen.add(`${kind}:${id}`);
      items.push({ id, name: nameOf(kind, id, warn), kind, tier: 'coming', prs: [{ number: pr.number, url: pr.url }] });
    }
  }
  if (platform.length) items.push({ id: PLATFORM.id, name: PLATFORM.name, kind: 'platform', tier: 'coming', prs: platform });
  return parse({ openwiz: { commit, date }, synced: new Date().toISOString().slice(0, 10), items });
}

export async function cli(args) {
  const [checkout, file, extra] = args;
  if (!checkout || !file || extra) {
    console.error(USAGE);
    return 2;
  }
  try {
    const reach = collect(checkout, JSON.parse(readFileSync(file, 'utf8')), message => console.error(`landing-sync: ${message}`));
    await writeFile(REACH, JSON.stringify(reach, null, 2) + '\n');
    const count = tier => reach.items.filter(item => item.tier === tier).length;
    console.log(`landing/reach.json: ${count('today')} today, ${count('coming')} coming, at OpenWiz ${reach.openwiz.commit}`);
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await cli(process.argv.slice(2));
