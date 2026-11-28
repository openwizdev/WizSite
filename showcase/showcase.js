const DATA_URL = 'https://api.github.com/repos/openwizdev/WizSite/contents/showcase/data.json?ref=showcase-data';
const COUNT_FIELDS = ['prs_merged_total', 'prs_merged_7d', 'drivers_verified', 'agents_running'];
const UTC_TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;
const MINUTE = 60_000;

export function parseShowcase(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const keys = Object.keys(data);
  const keyTokens = [...text.matchAll(/"(?:[^"\\]|\\.)*"(\s*:)?/g)].filter(match => match[1]);
  if (keys.length !== 6 || keyTokens.length !== keys.length || data.schema !== 'openwiz.showcase.v1') return null;
  if (!COUNT_FIELDS.every(key => Object.hasOwn(data, key) &&
      (data[key] === null || (Number.isInteger(data[key]) && data[key] >= 0)))) return null;
  const time = data.read_at;
  if (typeof time !== 'string' || time.length !== 20 || !UTC_TIME.test(time) || time.startsWith('0000')) return null;

  const parsed = new Date(time);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== time.replace('Z', '.000Z')) return null;
  return data;
}

export async function readShowcase() {
  let response;
  let text;
  try {
    response = await fetch(DATA_URL, {
      headers: { Accept: 'application/vnd.github.raw+json' },
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return { reason: 'The showcase data file is missing.' };
    if (!response.ok) return { reason: 'The showcase data could not be loaded.' };
    text = await response.text();
  } catch {
    return { reason: 'The showcase data could not be loaded.' };
  }
  try {
    const data = parseShowcase(text);
    if (data) return { data };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  return { reason: 'The showcase data file is invalid.' };
}

function paint(list, result) {
  const age = result.data ? Date.now() - Date.parse(result.data.read_at) : 0;
  const minutes = Math.max(0, Math.floor(age / MINUTE));
  for (const cell of list.querySelectorAll('[data-count]')) {
    const count = result.data?.[cell.dataset.count];
    const reason = result.reason ?? (count === null ? 'This count was unavailable at the last read.' : null);
    const detail = cell.parentElement.querySelector('[data-detail]');
    cell.textContent = reason ? 'Unavailable' : count.toLocaleString('en-US');
    const message = reason ?? `read ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    if (detail.textContent !== message) detail.textContent = message;
  }
  list.setAttribute('aria-busy', 'false');
}

const list = globalThis.document?.querySelector('main dl');
if (list) {
  const result = await readShowcase();
  paint(list, result);
}
