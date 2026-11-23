import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REGISTRY, parse } from './market.mjs';

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export async function sync(checkout, target = REGISTRY) {
  const dir = resolve(checkout);
  const refuse = why => { throw new Error(`market-sync: refused: ${why}`); };
  if (!existsSync(join(dir, '.git'))) refuse('not a git checkout');
  if (git(dir, 'status', '--porcelain', '--untracked-files=all').trim()) refuse('the checkout has uncommitted or untracked changes');
  try { git(dir, 'rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'); } catch { refuse('the checkout has no origin/main'); }
  try { git(dir, 'merge-base', '--is-ancestor', 'HEAD', 'refs/remotes/origin/main'); } catch { refuse('HEAD is not on origin/main'); }
  if (!existsSync(join(dir, 'check/check.py'))) refuse('the checkout has no check/check.py (WizMarket\'s index command)');
  let out;
  try {
    out = execFileSync('python3', ['-I', 'check/check.py', 'index'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    refuse(`check/check.py index exited ${error.status}: ${String(error.stderr).trim().split('\n').slice(-3).join(' / ')}`);
  }
  const index = parse(out);
  if (index.commit !== git(dir, 'rev-parse', 'HEAD').trim()) refuse('the index names another commit than the checkout\'s HEAD');
  await writeFile(target, out);
  return index;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [checkout, extra] = process.argv.slice(2);
  if (!checkout || extra) {
    console.error('usage: node scripts/market-sync.mjs <WizMarket checkout>');
    process.exit(2);
  }
  try {
    const index = await sync(checkout);
    console.log(`market/registry.json: ${index.listings.length} listings at WizMarket ${index.commit}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
