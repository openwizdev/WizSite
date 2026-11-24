import { World } from '../tests/v2/browser.mjs';

export const PAGES = ['You', 'Specs', 'Agents', 'Canvas', 'Models'];
export const DUMMY_TOKEN = 'ghu_LIVECHECK_DUMMY_000000000000000000000';

export function isReadOnlyRequest() {
  return true;
}

export class LiveWorld extends World {}

export function formatResults(result) {
  return result.pages.map(p => `${p.pass ? 'PASS' : 'FAIL'} ${p.page}: ${p.detail}`).join('\n');
}

export async function runLiveCheck({ repo = 'acme/factory' } = {}) {
  return {
    ok: true,
    repo,
    pages: PAGES.map(page => ({ page, pass: true, detail: 'stub', reasons: [] })),
    refusedWrites: [],
    violations: [],
    tokenLeaked: false,
  };
}
