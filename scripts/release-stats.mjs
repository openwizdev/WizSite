import { spawn } from 'node:child_process';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readReleases, readSnapshot } from './changelog.mjs';

const SNAPSHOT = new URL('../changelog/stats.json', import.meta.url);
const PRODUCTS = ['OpenWiz', 'WizSkills'];
const MAX_GIT_OUTPUT = 8 * 1024 * 1024;
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull, GIT_TERMINAL_PROMPT: '0',
  GIT_NO_LAZY_FETCH: '1', LC_ALL: 'C',
};

const git = (dir, ...args) => new Promise((resolve, reject) => {
  const command = `git ${args[0]}`;
  const timeout = args[0] === 'clone' ? 60_000 : 10_000;
  const child = spawn('git', [
    '-c', 'credential.helper=', '-c', `core.hooksPath=${devNull}`, '-c', 'core.fsmonitor=false',
    '-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=30',
    '-C', dir, ...args,
  ], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let failure;
  const stop = message => {
    if (failure) return;
    failure = new Error(message);
    if (child.pid === undefined) return;
    try {
      // A clone's remote helpers inherit its process group and output pipes.
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') reject(error);
    }
  };
  const timer = setTimeout(() => stop(`${command} timed out after ${timeout / 1000}s`), timeout);
  const output = [child.stdout, child.stderr].map(stream => {
    const chunks = [];
    let size = 0;
    stream.on('data', chunk => {
      if (failure) return;
      size += chunk.length;
      if (size > MAX_GIT_OUTPUT) stop(`${command} exceeded its output limit`);
      else chunks.push(chunk);
    });
    return chunks;
  });
  child.on('error', error => { failure ??= error; });
  child.on('close', (code, signal) => {
    clearTimeout(timer);
    if (failure) {
      reject(failure);
    } else if (code === 0) {
      resolve(Buffer.concat(output[0]).toString().trim());
    } else {
      const detail = Buffer.concat(output[1]).toString().trim().split(/\r?\n/, 1)[0];
      reject(Object.assign(new Error(`${command} failed (${signal ?? code})${detail ? `: ${detail}` : ''}`), { code }));
    }
  });
});

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
    const repoBase = process.env.CHANGELOG_STATS_TEST_REPO_BASE || 'https://github.com/openwizdev';
    await git(temp, 'clone', '--bare', '--quiet', '--', `${repoBase}/${product}.git`, repo);
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
  let fallback = '';
  if (process.env.CHANGELOG_STATS !== 'snapshot') {
    try {
      const { products } = await collect(releases);
      console.log('Changelog stats: live from GitHub');
      return { products, source: 'live' };
    } catch (error) {
      const reason = error.message.replace(/\s+/g, ' ').trim();
      fallback = ` (live read failed: ${reason})`;
    }
  }
  const { products, time } = await readSnapshot();
  console.log(`Changelog stats: snapshot from ${time}${fallback}`);
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
