import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { devNull, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PRIVATE_SOURCE, REGISTRY, WIZMARKET, decode, parse } from './market.mjs';

const ISOLATED = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull, GIT_TERMINAL_PROMPT: '0',
};
const git = (dir, ...args) => execFileSync('git', ['-c', 'credential.helper=', '-c', `core.hooksPath=${devNull}`, '-c', 'core.fsmonitor=false', '-C', dir, ...args],
  { encoding: 'utf8', env: ISOLATED, stdio: ['ignore', 'pipe', 'pipe'] });
const PATTERNS = 'import json, re, sys; sys.path.insert(0, "check"); import check; print(json.dumps([[label, pattern.pattern, bool(pattern.flags & re.I)] for label, pattern in check.PRIVATE]))';

export async function sync(checkout, target = REGISTRY, canonical = WIZMARKET) {
  const dir = resolve(checkout);
  const refuse = why => { throw new Error(`market-sync: refused: ${why}`); };
  if (!existsSync(join(dir, '.git'))) refuse('not a git checkout');
  let head;
  try { head = git(dir, 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}').trim(); } catch { refuse('the checkout has no HEAD commit'); }
  if (!/^[0-9a-f]{40}$/.test(head)) refuse('the checkout\'s HEAD is not a 40-hex commit');
  const temp = mkdtempSync(join(tmpdir(), 'market-sync-'));
  try {
    const main = join(temp, 'WizMarket');
    try { git(temp, 'clone', '--quiet', '--no-checkout', '--no-tags', '--single-branch', '--branch', 'main', '--', canonical, main); } catch { refuse(`could not fetch canonical WizMarket main from ${canonical}`); }
    try { git(main, 'merge-base', '--is-ancestor', head, 'refs/remotes/origin/main'); } catch { refuse(`HEAD is not on canonical WizMarket main (${canonical})`); }
    git(main, 'checkout', '--quiet', '--detach', head);
    if (!existsSync(join(main, 'check/check.py'))) refuse('the commit has no check/check.py (WizMarket\'s index command)');
    const python = (...args) => execFileSync('python3', ['-I', '-B', ...args], { cwd: main, env: ISOLATED, stdio: ['ignore', 'pipe', 'pipe'] });
    let patterns;
    try { patterns = JSON.parse(python('-c', PATTERNS)); } catch { refuse('could not read WizMarket\'s privacy patterns from check/check.py'); }
    const ours = PRIVATE_SOURCE.map(([label, source]) => [label, source, source.startsWith('(?i)')]);
    if (JSON.stringify(patterns) !== JSON.stringify(ours)) refuse('WizMarket\'s privacy patterns differ from the site\'s port; update PRIVATE_SOURCE in scripts/market.mjs and tests/market-fixtures/wizmarket-private.py first');
    let out;
    try {
      out = python('check/check.py', 'index');
    } catch (error) {
      refuse(`check/check.py index exited ${error.status}: ${String(error.stderr).trim().split('\n').slice(-3).join(' / ')}`);
    }
    const index = parse(decode(out));
    if (index.commit !== head) refuse('the index names another commit than the checkout\'s HEAD');
    await writeFile(target, out);
    return index;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export async function cli(args, canonical = WIZMARKET) {
  const [checkout, extra] = args;
  if (!checkout || extra) {
    console.error('usage: node scripts/market-sync.mjs <WizMarket checkout>');
    return 2;
  }
  try {
    const index = await sync(checkout, REGISTRY, canonical);
    console.log(`market/registry.json: ${index.listings.length} listings at WizMarket ${index.commit}`);
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await cli(process.argv.slice(2));
