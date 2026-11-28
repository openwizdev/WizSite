import { execFileSync } from 'node:child_process';
import { readDrivers } from './drivers.mjs';

const REPO = 'openwizdev/OpenWiz';
const gh = args => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const tryGh = args => { try { return gh(args); } catch { return null; } };
const number = url => url.match(/\/(?:pull|issues)\/(\d+)/)[1];
const treePath = url => url.match(/\/tree\/([^/]+)\/(.+)$/);

const data = await readDrivers();
const problems = [];
const latest = gh(['api', `repos/${REPO}/releases/latest`]).tag_name;
if (latest !== 'v0.1.0') problems.push(`release: GitHub's latest is ${latest}, the page says ${data.release} (v0.1.0)`);
const head = gh(['api', `repos/${REPO}/commits/main`]).sha;
if (head !== data.read.openwiz) console.log(`note: OpenWiz main is ${head.slice(0, 12)}, the data was read at ${data.read.openwiz.slice(0, 12)}`);

for (const entry of data.entries) {
  if (entry.evidence) {
    const n = number(entry.evidence);
    if (entry.evidence.includes('/pull/')) {
      const { state } = gh(['pr', 'view', n, '-R', REPO, '--json', 'state']);
      const want = entry.state === 'merged' ? 'MERGED' : 'OPEN';
      if (state !== want) problems.push(`${entry.id}: pull request #${n} is ${state}, the page says ${entry.state}`);
    } else {
      const { state } = gh(['issue', 'view', n, '-R', REPO, '--json', 'state']);
      if (state !== 'OPEN') problems.push(`${entry.id}: ticket #${n} is ${state}, the page says ${entry.state}`);
    }
  }
  if (entry.docs) {
    const [, ref, path] = treePath(entry.docs);
    if (!tryGh(['api', `repos/${REPO}/contents/${path}?ref=${ref}`])) problems.push(`${entry.id}: ${path} is missing at ${ref}`);
  }
}

for (const problem of problems) console.log(`STALE ${problem}`);
console.log(`drivers data: ${data.entries.length} entries checked against GitHub, ${problems.length} stale`);
process.exitCode = problems.length ? 1 : 0;
