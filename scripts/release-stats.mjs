import { execFile } from 'node:child_process';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { readReleases, readSnapshot } from './changelog.mjs';

const SNAPSHOT = new URL('../changelog/stats.json', import.meta.url);
const PRODUCTS = ['OpenWiz', 'WizSkills'];
const run = promisify(execFile);
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull, GIT_TERMINAL_PROMPT: '0',
  GIT_NO_LAZY_FETCH: '1', LC_ALL: 'C',
};

const git = async (dir, ...args) => {
  const { stdout } = await run('git', [
    '-c', 'credential.helper=', '-c', `core.hooksPath=${devNull}`, '-c', 'core.fsmonitor=false',
    '-C', dir, ...args,
  ], { env, timeout: args[0] === 'clone' ? 60_000 : 10_000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
};

async function previousTag(dir, commit) {
  const [, parent] = (await git(dir, 'rev-list', '--parents', '-n', '1', commit)).split(' ');
  if (!parent) return null;
  try {
    return await git(dir, 'describe', '--tags', '--abbrev=0', `${commit}^`);
  } catch (error) {
    if (error.code !== 128 || await git(dir, 'tag', '--merged', parent)) throw error;
    return null;
  }
}

async function tagStats(dir, tag) {
  const commit = await git(dir, 'rev-parse', '--verify', `refs/tags/${tag}^{commit}`);
  const prev = await previousTag(dir, commit);
  const base = prev ? `refs/tags/${prev}` : await git(dir, 'hash-object', '-w', '-t', 'tree', devNull);
  const range = prev ? `${base}..${commit}` : commit;
  const commits = Number(await git(dir, 'rev-list', '--count', range));
  const subjects = await git(dir, 'log', '--first-parent', '--format=%s', range);
  const prs = new Set(Array.from(
    subjects.matchAll(/^Merge pull request #(\d+)\b|\(#(\d+)\)$/gm),
    match => match[1] ?? match[2],
  ));
  const diff = await git(dir, 'diff', '--shortstat', base, commit);
  const added = Number(diff.match(/(\d+) insertion/)?.[1] ?? 0);
  const removed = Number(diff.match(/(\d+) deletion/)?.[1] ?? 0);
  return { prev, prs: prs.size, commits, added, removed };
}

async function productStats(product, releases) {
  const temp = await mkdtemp(join(tmpdir(), 'changelog-stats-'));
  try {
    const repo = join(temp, product);
    await git(temp, 'clone', '--bare', '--quiet', '--', `https://github.com/openwizdev/${product}.git`, repo);
    const stats = {};
    for (const { semver } of releases) {
      const tag = `v${semver}`;
      stats[tag] = await tagStats(repo, tag);
    }
    return stats;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function collect(releases) {
  const results = await Promise.allSettled(PRODUCTS.map(product => {
    const list = releases.filter(release => release.product === product);
    return list.length ? productStats(product, list) : {};
  }));
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  return {
    time: new Date().toISOString(),
    products: Object.fromEntries(PRODUCTS.map((product, i) => [product, results[i].value])),
  };
}

export async function releaseStats(releases) {
  if (process.env.CHANGELOG_STATS !== 'snapshot') {
    try {
      const { products } = await collect(releases);
      console.log('Changelog stats: live from GitHub');
      return { products, source: 'live' };
    } catch {
      // The committed snapshot also covers builds with no GitHub access.
    }
  }
  const { products, time } = await readSnapshot();
  console.log(`Changelog stats: snapshot from ${time}`);
  return { products, source: 'snapshot' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const snapshot = await collect(await readReleases());
    const pending = new URL(`./stats.json.${process.pid}.tmp`, SNAPSHOT);
    try {
      await writeFile(pending, JSON.stringify(snapshot, null, 2) + '\n');
      await rename(pending, SNAPSHOT);
    } finally {
      await rm(pending, { force: true });
    }
    console.log(`Updated changelog/stats.json from GitHub at ${snapshot.time}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
