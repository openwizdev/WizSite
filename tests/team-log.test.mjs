import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../site.js', import.meta.url), 'utf8');
const script = source.slice(source.indexOf('function teamFactoryLog()'), source.lastIndexOf('\nenableCopy();'));
const html = readFileSync(new URL('../team/index.html', import.meta.url), 'utf8');
// Relevant fields from hill/team-r2/rest on the frozen fixtures branch.
const fixture = JSON.parse(readFileSync(new URL('./team-log-fixture.json', import.meta.url), 'utf8'));
const snapshot = 'Snapshot · 24 Nov 2026, 14:33 UTC';
const readAt = Date.parse('2026-11-24T14:45:00Z');

class Element extends EventTarget {
  children = [];
  dataset = {};
  attributes = {};
  text = '';
  get textContent() { return this.text + this.children.map(child => child.textContent ?? child).join(''); }
  set textContent(value) { this.text = value; this.children = []; }
  get childNodes() { return this.children; }
  append(...children) {
    for (const child of children) if (child instanceof Element) child.parent = this;
    this.children.push(...children);
  }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
  setAttribute(name, value) { this.attributes[name] = value; }
  cloneNode() { return Object.assign(new Element(), this); }
}

function setup({ response, cache = null, visibility = 'visible', team = true } = {}) {
  const calls = [], deadlines = [], writes = [];
  const spec = Object.assign(new Element(), { href: 'https://github.com/openwizdev/OpenWiz/issues/2963', textContent: 'Snapshot spec' });
  const tickets = new Element(), events = new Element(), status = new Element();
  status.textContent = snapshot;
  status.after = actions => { status.actions = actions; };
  const elements = { '.team-log-heading a': spec, '.team-log-tickets': tickets, '.team-log-events': events, '.team-log-status': status };
  const log = { querySelector: selector => elements[selector] };
  const document = Object.assign(new EventTarget(), {
    visibilityState: visibility, querySelector: selector => team && selector === '.team-log' ? log : null,
    createElement: () => new Element(),
  });
  class ReadDate extends Date { static now() { return readAt; } }
  const localStorage = { getItem: () => JSON.stringify(cache), setItem: (_, value) => writes.push(JSON.parse(value)) };
  const abortSignal = {
    any: AbortSignal.any,
    timeout(ms) { deadlines.push(ms); return AbortSignal.timeout(ms); },
  };
  async function fetch(url, options) {
    calls.push({ url, options });
    const pathname = new URL(url).pathname;
    const key = pathname.endsWith('/search/issues') ? 'search'
      : pathname.endsWith('/sub_issues') ? 'sub_issues-2963' : 'timeline-' + pathname.split('/').at(-2);
    return response?.(key, options) ?? { status: 200, json: async () => structuredClone(fixture[key]) };
  }
  runInNewContext(script + '\nteamFactoryLog();', {
    document, localStorage, fetch, URL, AbortController, AbortSignal: abortSignal, Date: ReadDate,
  });
  const show = visibilityState => {
    document.visibilityState = visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const click = index => status.actions.children[index].dispatchEvent(new Event('click'));
  const states = () => tickets.children.map(item => item.children[0].title);
  return { calls, deadlines, writes, spec, tickets, events, status, states, show, click };
}

test('fixture read matches every baked line, timestamp, URL and state with six credential-free requests', async () => {
  const page = setup({ visibility: 'hidden' });
  assert.equal(page.calls.length, 0);
  assert.equal(page.status.textContent, snapshot);
  page.show('visible');
  await setImmediate();
  assert.equal(page.calls.length, 6);
  assert.equal(page.calls[0].url, 'https://api.github.com/search/issues?q=repo:openwizdev/OpenWiz+is:issue+in:title+%22spec:%22&sort=updated&per_page=20');
  assert.equal(new URL(page.calls[1].url).pathname, '/repos/openwizdev/OpenWiz/issues/2963/sub_issues');
  assert.ok(page.calls.slice(2).every(call => call.url.endsWith('/timeline?per_page=100')));
  assert.ok(page.calls.every(call => call.options.credentials === 'omit'));
  assert.deepEqual(page.deadlines, Array(6).fill(5000));
  assert.equal(page.status.textContent, 'Live from GitHub · read 14:45');
  assert.equal(page.spec.textContent, fixture.search.items.find(item => item.number === 2963).title);
  const expected = [...html.matchAll(/<time datetime="([^"]+)">([^<]+)<\/time> <span>([^<]+)<\/span> <span>pull request <a href="([^"]+)">(#[^<]+)<\/a> (\w+)<\/span>/g)];
  assert.equal(expected.length, 8);
  assert.deepEqual(page.events.children.map(row => [row.children[0].dateTime, row.children[0].textContent, row.children[2].textContent,
    row.children[4].children[1].href, row.children[4].children[1].textContent, row.children[4].children[2].trim()]), expected.map(match => match.slice(1)));
  assert.deepEqual(page.states(), ['Merged', 'Merged', 'Merged', 'Merged']);
  const fresh = setup({ cache: page.writes[0] });
  assert.equal(fresh.calls.length, 0);
  assert.equal(fresh.status.textContent, 'Live from GitHub · read 14:45');
  const stale = setup({ cache: { ...page.writes[0], readAt: readAt - 600_000 }, response: () => ({ status: 429 }) });
  await setImmediate();
  assert.equal(stale.calls.length, 1);
  assert.equal(stale.status.textContent, 'Live from GitHub · read 14:35');
});

test('ticket rules use builder notes, organisation PRs, and completed closes', async () => {
  const page = setup({ response(key) {
    if (key === 'sub_issues-2963') {
      const tickets = structuredClone(fixture[key]);
      Object.assign(tickets.find(ticket => ticket.number === 2965), {
        state: 'closed', state_reason: 'completed', closed_at: '2026-11-24T13:45:00Z',
      });
      return { status: 200, json: async () => tickets };
    }
    if (!key.startsWith('timeline')) return;
    const timeline = structuredClone(fixture[key]);
    const ref = timeline.find(event => event.event === 'cross-referenced' && event.source.issue.pull_request);
    ref.source.issue.state = 'open';
    ref.source.issue.pull_request.merged_at = null;
    const events = {
      'timeline-2964': [{ event: 'commented', created_at: '2026-11-24T11:25:30Z', body: '<!-- openwiz:status v1 -->\nagent: builder' }],
      'timeline-2966': [ref],
      'timeline-2965': [{ event: 'closed', created_at: '2026-11-24T13:45:00Z' }, ref],
      'timeline-2967': [{ ...ref, source: { issue: { ...ref.source.issue, html_url: 'https://github.com/another-org/repo/pull/181' } } }],
    };
    return { status: 200, json: async () => events[key] };
  } });
  await setImmediate();
  assert.deepEqual(page.states(), ['Building', 'In review', 'Merged', 'Waiting']);
  assert.equal(page.events.children[0].textContent, '13:45 BK3 ticket closed');
  assert.equal(page.events.children.at(-1).textContent, '11:25 BK1 builder started');
});

test('non-200, invalid data, timeout and oversized specs preserve the snapshot and do not retry', async () => {
  for (const response of [
    () => ({ status: 403 }), () => ({ status: 429 }),
    () => ({ status: 200, json: async () => ({ items: null }) }),
    () => ({ status: 200, json: async () => ({ items: [{
      ...fixture.search.items.find(item => item.number === 2963), sub_issues_summary: { total: 6 },
    }] }) }),
    (_, { signal }) => ({ status: 200, json: async () => {
      assert.ok(signal instanceof AbortSignal);
      throw new DOMException('Timed out', 'TimeoutError');
    } }),
  ]) {
    const page = setup({ response });
    await setImmediate();
    page.show('hidden');
    page.show('visible');
    assert.equal(page.status.textContent, snapshot);
    assert.equal(page.calls.length, 1);
    assert.equal(page.writes.length, 0);
  }
  const hidden = setup();
  hidden.show('hidden');
  await setImmediate();
  assert.equal(hidden.calls.length, 1);
  assert.ok(hidden.calls[0].options.signal.aborted);
  assert.equal(hidden.status.textContent, snapshot);
  assert.equal(setup({ team: false }).calls.length, 0);
});

test('the dated replay steps through builder, review, and merge and returns to the snapshot', async () => {
  const page = setup({ response: () => ({ status: 403 }) });
  page.click(0);
  assert.equal(page.spec.href, 'https://github.com/openwizdev/OpenWiz/issues/1927');
  assert.equal(page.status.textContent, 'Replay of a real run · 20–21 Nov 2026 UTC');
  assert.equal(page.events.children[0].textContent, '20 15:45 WD1 builder started');
  assert.equal(page.states()[0], 'Building');
  page.click(1);
  assert.equal(page.events.children[0].textContent, '20 15:57 WD1 pull request #1945 opened');
  assert.equal(page.states()[0], 'In review');
  for (let step = 0; step < 20; step++) page.click(1);
  assert.equal(page.status.textContent, 'Replay of a real run · 20–21 Nov 2026 UTC · Complete');
  assert.equal(page.events.children[0].textContent, '21 04:36 WD3 ticket closed');
  assert.equal(page.events.children[1].textContent, '21 04:36 WD3 pull request #229 merged');
  assert.deepEqual(page.states(), ['Merged', 'Merged', 'Merged', 'Merged']);
  assert.equal(page.events.children.length, 8);
  page.click(0);
  assert.equal(page.status.textContent, snapshot);
  assert.equal(page.calls.length, 1);
});
