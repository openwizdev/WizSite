import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

// Public fields from hill/team-r2-fixtures. No requests leave the test process.
const fixtures = JSON.parse(readFileSync(new URL('./team-spec-fixtures.json', import.meta.url)));
const site = readFileSync(new URL('../site.js', import.meta.url), 'utf8');
const api = 'https://api.github.com';
const repo = '/repos/openwizdev/OpenWiz/issues';
const searchUrl = '/search/issues?q=repo:openwizdev/OpenWiz+is:issue+in:title+%22spec:%22&sort=updated&per_page=20';
const sub = number => `${repo}/${number}/sub_issues?per_page=20`;
const timeline = number => `${repo}/${number}/timeline?per_page=100`;
const now = Date.parse('2026-11-24T14:34:56Z');
const still = 'Snapshot from GitHub · 24 Nov 2026, 14:33 UTC';
const responses = () => structuredClone({
  [searchUrl]: fixtures.search,
  [sub(2963)]: fixtures.subIssues,
  ...Object.fromEntries(Object.entries(fixtures.timelines).map(([n, events]) => [timeline(n), events])),
});

class Node {
  constructor(tag, text = '', children = []) {
    this.tag = tag;
    this.replaceChildren(...children);
    this.text = text;
  }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(text) { this.text = text; this.children = []; }
  get lastElementChild() { return this.children.at(-1); }
  append(...children) {
    for (const value of children) {
      const child = typeof value === 'string' ? new Node('#text', value) : value;
      child.parentNode = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children) { this.text = ''; this.children = []; this.append(...children); }
  replaceWith(child) {
    const parent = this.parentNode;
    child.parentNode = parent;
    parent.children[parent.children.indexOf(this)] = child;
  }
  querySelector(tag) { return this.children.find(child => child.tag === tag) || null; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  setAttribute() {}
}

async function view({ data = responses(), cache = new Map(), at = now, hidden = false, timeout = false } = {}) {
  const origin = new Node('p');
  origin.textContent = still;
  const heading = new Node('h2', '', [new Node('code'), new Node('a')]);
  const list = new Node('ul');
  const merge = new Node('div', '', [new Node('p', 'Latest merged pull request'), new Node('a'), new Node('p')]);
  const panel = { querySelector: name => ({ heading, tickets: list, merge, origin })[name.slice(11)] };
  const footer = { children: [], setAttribute() {}, removeAttribute() {}, addEventListener() {} };
  const document = Object.assign(new EventTarget(), {
    visibilityState: hidden ? 'hidden' : 'visible',
    querySelector: selector => ({ '.team-spec': panel, '.family': footer, '.landing-footer': footer })[selector] || null,
    querySelectorAll: () => [],
    createElement: tag => new Node(tag),
  });
  const calls = [];
  const changeVisibility = state => {
    document.visibilityState = state;
    document.dispatchEvent(new Event('visibilitychange'));
  };
  runInNewContext(site, {
    document, navigator: {}, window: {}, AbortController, matchMedia: () => ({ matches: false }),
    AbortSignal: {
      any: AbortSignal.any,
      timeout(ms) {
        assert.equal(ms, 5000);
        return timeout ? AbortSignal.abort(new DOMException('Timed out', 'TimeoutError')) : AbortSignal.timeout(ms);
      },
    },
    Date: class extends Date { static now() { return at; } },
    localStorage: { getItem: key => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) },
    async fetch(url, options) {
      calls.push({ url, options, visibility: document.visibilityState });
      options.signal.throwIfAborted();
      const value = data[url.slice(api.length)];
      if (typeof value === 'function') return value(options, changeVisibility);
      return { status: typeof value === 'number' ? value : 200, json: async () => value };
    },
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  return { calls, origin, heading, list, merge, cache, changeVisibility, settle };
}

test('reads the first eligible spec, derives the frozen states and renders the last merge', async () => {
  const result = await view();
  const replay = fixtures.replay[2963];
  const latest = replay.tickets.flatMap(ticket => ticket.pull_requests).sort((a, b) => b.merged.localeCompare(a.merged))[0];
  assert.deepEqual(result.calls.map(call => call.url), [searchUrl, sub(2963), ...replay.tickets.map(t => timeline(t.number))].map(path => api + path));
  for (const { options, visibility } of result.calls) {
    assert.deepEqual(Object.keys(options).sort(), ['cache', 'credentials', 'redirect', 'signal']);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(visibility, 'visible');
  }
  assert.equal(result.heading.querySelector('code').textContent, '#2963');
  assert.equal(result.heading.querySelector('a').textContent, replay.title);
  assert.equal(result.heading.querySelector('a').href, replay.url);
  assert.deepEqual(result.list.children.map(row => row.children[0].textContent), replay.tickets.map(ticket => ticket.title));
  assert.deepEqual(result.list.children.map(row => row.children[1].textContent), ['Merged', 'Merged', 'Merged', 'Merged']);
  assert.equal(result.merge.querySelector('a').href, latest.url);
  assert.equal(result.merge.querySelector('a').textContent, 'openwizdev/WizSite #183 BK2: the booking API (#2966)');
  assert.equal(result.merge.children[0].textContent, 'Latest merged pull request');
  assert.equal(result.merge.lastElementChild.querySelector('time').dateTime, latest.merged);
  assert.equal(result.merge.lastElementChild.querySelector('time').textContent, '24 Nov 2026, 13:00 UTC');
  assert.equal(result.origin.textContent, 'Live from GitHub · read 14:34');
  assert.equal(result.origin.querySelector('time').dateTime, '2026-11-24T14:34:56.000Z');
});

test('ticket rules distinguish waiting, builder note and fleet start, review and completed', async () => {
  const data = responses();
  const finished = fixtures.replay[1927].tickets.find(ticket => ticket.number === 1931);
  const reviewed = finished.pull_requests[0];
  data[timeline(2964)] = [{ event: 'commented', body: 'agent: builder' }];
  data[timeline(2965)] = [{ event: 'commented', body: '<!-- openwiz:status v1 -->\nagent: builder' }];
  data[timeline(2966)] = [{ event: 'cross-referenced', source: { issue: {
    repository_url: `${api}/repos/${reviewed.repo}`,
    html_url: reviewed.url, number: reviewed.number, title: reviewed.title,
    state: 'open', pull_request: { merged_at: null },
  } } }];
  data[sub(2963)][3].state = 'closed';
  data[sub(2963)][3].state_reason = 'completed';
  data[timeline(2967)] = [];
  const result = await view({ data });
  assert.deepEqual(result.list.children.map(row => row.children[1].textContent), ['Waiting', 'Building', 'In review', 'Merged']);
  assert.equal(result.merge.textContent, 'No merged pull request yet');

  data[timeline(2965)] = [fixtures.timelines[2965][0]];
  data[timeline(2965)].push({ event: 'cross-referenced', source: { issue: {
    repository_url: `${api}/repos/someone/else`, state: 'open', pull_request: { merged_at: null },
  } } });
  data[timeline(2966)].push(fixtures.timelines[2966].find(event => event.event === 'cross-referenced'));
  data[timeline(2967)] = data[timeline(2966)].slice(0, 1);
  const mixed = await view({ data });
  assert.deepEqual(mixed.list.children.map(row => row.children[1].textContent), ['Waiting', 'Building', 'In review', 'Merged']);
  assert.equal(mixed.merge.querySelector('a').href, 'https://github.com/openwizdev/WizSite/pull/183');

  data[timeline(2966)][0].source.issue.state = 'closed';
  data[timeline(2966)].push({ event: 'commented', body: 'launch-fleet: started' });
  const closedUnmerged = await view({ data });
  assert.equal(closedUnmerged.list.children[2].children[1].textContent, 'Waiting');
});

test('keeps the still on failure, incomplete data, timeout or request budget', async () => {
  for (const status of [201, 403, 429]) {
    const failed = await view({ data: { ...responses(), [timeline(2967)]: status } });
    assert.equal(failed.origin.textContent, still);
    assert.equal(failed.cache.size, 0);
    assert.equal(failed.calls.length, 6);
  }
  for (const bad of [null, [null], [{ event: 'commented' }], Array(100).fill({ event: 'labeled' })]) {
    const failed = await view({ data: { ...responses(), [timeline(2967)]: bad } });
    assert.equal(failed.origin.textContent, still);
  }
  const timedOut = await view({ timeout: true });
  assert.equal(timedOut.origin.textContent, still);
  assert.equal(timedOut.calls.length, 1);
  const invalidCopy = responses();
  invalidCopy[sub(2963)][0].title = 'Live right now';
  assert.equal((await view({ data: invalidCopy })).origin.textContent, still);
  for (const count of [5, 6]) {
    const data = responses();
    data[searchUrl].items.find(item => item.number === 2963).sub_issues_summary.total = count;
    data[sub(2963)] = Array(count).fill(data[sub(2963)][0]);
    const overBudget = await view({ data });
    assert.equal(overBudget.origin.textContent, still);
    assert.equal(overBudget.calls.length, 2);
  }
});

test('uses the original cached time, never reads while hidden and never retries a failed read', async () => {
  const { cache } = await view();
  const fresh = await view({ cache, at: now + 599_999 });
  assert.equal(fresh.calls.length, 0);
  assert.equal(fresh.origin.textContent, 'Live from GitHub · read 14:34');
  const stale = await view({ cache, at: now + 600_000, data: { [searchUrl]: 429 } });
  assert.equal(stale.calls.length, 1);
  assert.equal(stale.origin.textContent, fresh.origin.textContent);
  stale.changeVisibility('hidden');
  stale.changeVisibility('visible');
  await stale.settle();
  assert.equal(stale.calls.length, 1);

  const hidden = await view({ hidden: true });
  assert.equal(hidden.calls.length, 0);
  assert.equal(hidden.origin.textContent, still);
  hidden.changeVisibility('visible');
  await hidden.settle();
  assert.equal(hidden.calls.length, 6);
  assert.equal(hidden.origin.textContent, fresh.origin.textContent);

  const interrupted = await view({ data: {
    ...responses(),
    [searchUrl]: ({ signal }, setVisible) => {
      setVisible('hidden');
      assert.equal(signal.aborted, true);
      return { status: 200, json: async () => fixtures.search };
    },
  } });
  assert.equal(interrupted.calls.length, 1);
  assert.equal(interrupted.origin.textContent, still);
});
