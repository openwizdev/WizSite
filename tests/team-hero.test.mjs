import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

// Public fields from hill/team-r2-fixtures. No requests leave the test process.
const fixtures = JSON.parse(readFileSync(new URL('./team-spec-fixtures.json', import.meta.url)));
const site = readFileSync(new URL('../site.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../team/index.html', import.meta.url), 'utf8');
const figure = html.match(/ {2}<figure class="team-replay"[\s\S]*?\n {2}<\/figure>/)[0];
const api = 'https://api.github.com';
const repo = '/repos/openwizdev/OpenWiz/issues';
const searchUrl = '/search/issues?q=repo:openwizdev/OpenWiz+is:issue+in:title+%22spec:%22&sort=updated&per_page=20';
const sub = number => `${repo}/${number}/sub_issues?per_page=20`;
const timeline = number => `${repo}/${number}/timeline?per_page=100`;
const now = Date.parse('2026-11-24T14:34:56Z');
const liveOrigin = 'Live from GitHub · read 14:34 UTC';
const nowLine = 'Now: spec: openwiz.dev/book, our own booking page for the team call · all tickets merged · read 14:34 UTC';
const responses = () => structuredClone({
  [searchUrl]: fixtures.search,
  [sub(2963)]: fixtures.subIssues,
  ...Object.fromEntries(Object.entries(fixtures.timelines).map(([n, events]) => [timeline(n), events])),
});
// The frozen read with BK2 back in review: a spec that is still moving.
const moving = () => {
  const data = responses();
  const pull = data[timeline(2966)].find(event => event.source?.issue?.pull_request).source.issue;
  Object.assign(pull, { state: 'open', pull_request: { merged_at: null } });
  data[sub(2963)].find(issue => issue.number === 2966).state = 'open';
  return data;
};

// A small DOM: enough for the team part of site.js, built from the real baked markup.
class Node {
  constructor(tag, text = '') {
    this.tag = tag;
    this.text = text;
    this.attrs = new Map();
    this.children = [];
    this.parentNode = null;
  }
  get textContent() { return this.tag === '#text' ? this.text : this.children.map(child => child.textContent).join(''); }
  set textContent(text) { this.replaceChildren(String(text)); }
  get className() { return this.attrs.get('class') ?? ''; }
  set className(value) { this.attrs.set('class', value); }
  get id() { return this.attrs.get('id') ?? ''; }
  set id(value) { this.attrs.set('id', value); }
  get href() { return this.attrs.get('href') ?? ''; }
  set href(value) { this.attrs.set('href', value); }
  get dateTime() { return this.attrs.get('datetime') ?? ''; }
  set dateTime(value) { this.attrs.set('datetime', value); }
  get hidden() { return this.attrs.has('hidden'); }
  set hidden(value) { if (value) this.attrs.set('hidden', ''); else this.attrs.delete('hidden'); }
  get dataset() { return { teamReplay: this.attrs.get('data-team-replay') }; }
  get elements() { return this.children.filter(child => child.tag !== '#text'); }
  get lastElementChild() { return this.elements.at(-1) ?? null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }
  hasAttribute(name) { return this.attrs.has(name); }
  adopt(value) {
    const child = typeof value === 'string' ? new Node('#text', value) : value;
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    return child;
  }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
  append(...values) { for (const value of values) this.children.push(this.adopt(value)); }
  prepend(value) { this.children.unshift(this.adopt(value)); }
  insertBefore(value, before) {
    const child = this.adopt(value);
    this.children.splice(this.children.indexOf(before), 0, child);
  }
  replaceChildren(...values) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...values);
  }
  replaceWith(value) {
    const parent = this.parentNode;
    const index = parent.children.indexOf(this);
    const child = parent.adopt(value);
    parent.children.splice(parent.children.indexOf(this), 1);
    parent.children.splice(index, 0, child);
    this.parentNode = null;
  }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  matches(selector) {
    const attr = /^\[([\w-]+)\]$/.exec(selector);
    if (attr) return this.attrs.has(attr[1]);
    if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
    return this.tag === selector;
  }
  closest(selector) {
    for (let node = this; node; node = node.parentNode) if (node.matches(selector)) return node;
    return null;
  }
  querySelectorAll(selector) {
    const [outer, ...inner] = selector.split(' ');
    if (inner.length) return [...new Set(this.querySelectorAll(outer).flatMap(node => node.querySelectorAll(inner.join(' '))))];
    return this.elements.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  focus() { this.owner.activeElement = this; }
  addEventListener(type, listener) { (this.listeners ??= {})[type] = listener; }
  dispatch(type) { this.listeners[type](); }
}

function parse(markup) {
  const root = new Node('div');
  let open = root;
  for (const [, close, tag, attrs, text] of markup.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/g)) {
    if (text !== undefined) {
      if (text.trim()) open.append(text);
    } else if (close) {
      assert.equal(open.tag, tag);
      open = open.parentNode;
    } else {
      const node = new Node(tag);
      for (const [, name, value = ''] of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) node.attrs.set(name, value);
      open.append(node);
      open = node;
    }
  }
  assert.equal(open, root);
  return root;
}

const text = node => node.textContent.replace(/\s+/g, ' ').trim();
const stamp = clock => clock.stage.querySelector('.team-replay-meta');

async function view({ data = responses(), cache = new Map(), at = now, hidden = false, timeout = false, reduced = false } = {}) {
  const stage = parse(figure);
  const doc = Object.assign(new EventTarget(), { activeElement: null });
  const own = node => { node.owner = doc; for (const child of node.children) own(child); return node; };
  own(stage);
  const stubs = {
    '.family': { children: [], setAttribute() {}, removeAttribute() {}, addEventListener() {} },
    '.landing-footer': { addEventListener() {} },
  };
  Object.assign(doc, {
    visibilityState: hidden ? 'hidden' : 'visible',
    querySelector: selector => stubs[selector] ?? stage.querySelector(selector),
    querySelectorAll: () => [],
    createElement: tag => Object.assign(new Node(tag), { owner: doc }),
  });
  const motion = { matches: reduced, addEventListener(_type, change) { this.change = change; } };
  const timers = new Map();
  let clock = 0;
  let token = 0;
  const calls = [];
  const changeVisibility = state => {
    doc.visibilityState = state;
    doc.dispatchEvent(new Event('visibilitychange'));
  };
  runInNewContext(site, {
    document: doc, navigator: {}, window: {}, AbortController,
    matchMedia: query => query === '(prefers-reduced-motion: reduce)' ? motion : { matches: !reduced, addEventListener() {} },
    performance: { now: () => clock },
    setTimeout(callback, ms) { timers.set(++token, { callback, at: clock + ms }); return token; },
    clearTimeout: id => timers.delete(id),
    AbortSignal: {
      any: AbortSignal.any,
      timeout(ms) {
        assert.equal(ms, 5000);
        return timeout ? AbortSignal.abort(new DOMException('Timed out', 'TimeoutError')) : new AbortController().signal;
      },
    },
    Date: class extends Date { static now() { return at; } },
    localStorage: { getItem: key => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) },
    async fetch(url, options) {
      calls.push({ url, options, visibility: doc.visibilityState });
      options.signal.throwIfAborted();
      const value = data[url.slice(api.length)];
      if (typeof value === 'function') return value(options, changeVisibility, stage);
      return { status: typeof value === 'number' ? value : 200, json: async () => value };
    },
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  const events = () => stage.querySelectorAll('[data-replay-event]');
  return {
    stage, doc, calls, cache, motion, timers, changeVisibility, settle, events,
    panel: () => { assert.equal(stage.elements.length, 1, 'one panel at a time'); return stage.elements[0]; },
    control: () => stage.querySelector('.team-replay-control'),
    now: () => stage.querySelector('.team-replay-now'),
    shown: () => events().filter(node => !node.hasAttribute('data-replay-pending')),
    advanceTo(time) {
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > time) break;
        clock = timer.at;
        timers.delete(id);
        timer.callback();
      }
      clock = time;
    },
  };
}

test('the baked replay holds the packet’s transitions and landings, finished, with no current-spec line', () => {
  const stage = parse(figure);
  const packet = fixtures.replay[1927];
  const tickets = stage.querySelectorAll('li').filter(li => li.querySelector('[data-replay-stages]'));
  assert.equal(stage.querySelector('figure').dataset.teamReplay, packet.opened);
  assert.match(text(stage.querySelector('.team-replay-meta')), /^Replay of a real run · spec #1927 · 20–21 Nov 2026$/);
  assert.equal(stage.querySelector('.team-replay-title a').href, packet.url);
  assert.deepEqual(tickets.map(li => li.querySelector('a').href), packet.tickets.map(ticket => ticket.url));
  for (const [i, ticket] of packet.tickets.entries()) {
    const stages = tickets[i].querySelectorAll('[data-replay-event]');
    // A ticket shows Merged when its last pull request lands, which can be seconds before GitHub closes it.
    const merged = [ticket.merged_at, ticket.pull_requests.map(pull => pull.merged).sort().at(-1)].sort()[0];
    assert.deepEqual(stages.map(node => [text(node.querySelector('span')), node.querySelector('time').dateTime]),
      [['Building', ticket.building_at], ['In review', ticket.review_at], ['Merged', merged]]);
    assert.deepEqual(stages.map(node => node.hasAttribute('aria-current')), [false, false, true]);
  }
  const pulls = new Map(packet.tickets.flatMap(ticket => ticket.pull_requests).map(pull => [pull.url, pull.merged]));
  assert.deepEqual(stage.querySelectorAll('.team-landings li').map(li => [li.querySelector('a').href, li.querySelector('time').dateTime]),
    [...pulls].sort((a, b) => a[1].localeCompare(b[1])));
  assert.equal(stage.querySelector('.team-replay-control').hidden, true);
  assert.equal(stage.querySelector('.team-replay-now'), null);
  assert.equal(stage.querySelector('.team-spec'), null);
});

test('a frozen read whose tickets are all merged keeps the replay and adds the read current-spec line', async () => {
  const result = await view();
  assert.deepEqual(result.calls.map(call => call.url), [searchUrl, sub(2963), ...[2964, 2965, 2966, 2967].map(timeline)].map(path => api + path));
  for (const { options, visibility } of result.calls) {
    assert.deepEqual(Object.keys(options).sort(), ['cache', 'credentials', 'redirect', 'signal']);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(visibility, 'visible');
  }
  assert.equal(result.panel().tag, 'figure');
  assert.equal(text(result.now()), nowLine);
  assert.equal(result.now().querySelector('a').href, 'https://github.com/openwizdev/OpenWiz/issues/2963');
  assert.equal(result.now().querySelector('time').dateTime, '2026-11-24T14:34:56.000Z');
  assert.equal(result.now().parentNode.elements.at(-1), result.control(), 'the line sits above the replay control');
  assert.equal(result.control().hidden, false);
  assert.equal(text(result.control()), 'Finish replay');
  assert.equal(result.shown().length, 0);
  assert.equal(JSON.parse(result.cache.get('openwiz-team-spec-v1')).readAt, now);
});

test('a moving spec replaces the replay with the live panel and its read time', async () => {
  const result = await view({ data: moving() });
  const panel = result.panel();
  assert.equal(panel.className, 'team-spec');
  assert.equal(result.stage.querySelector('[data-team-replay]'), null);
  assert.equal(text(panel.querySelector('.team-spec-origin')), liveOrigin);
  assert.equal(panel.querySelector('.team-spec-origin').querySelector('time').dateTime, '2026-11-24T14:34:56.000Z');
  assert.equal(panel.querySelector('.team-spec-heading').tag, 'h2');
  assert.equal(text(panel.querySelector('code')), '#2963');
  assert.equal(panel.querySelector('.team-spec-heading a').href, fixtures.replay[2963].url);
  assert.equal(text(panel.querySelector('.team-spec-heading a')), fixtures.replay[2963].title);
  const rows = panel.querySelector('.team-spec-tickets').elements;
  assert.deepEqual(rows.map(row => text(row.elements[0])), fixtures.replay[2963].tickets.map(ticket => ticket.title));
  assert.deepEqual(rows.map(row => text(row.elements[1])), ['Merged', 'Merged', 'In review', 'Merged']);
  assert.deepEqual(rows.map(row => row.elements[1].className), ['merged', 'merged', 'review', 'merged'].map(s => `team-spec-state ${s}`));
  const merge = panel.querySelector('.team-spec-merge');
  assert.equal(text(merge.elements[0]), 'Latest merged pull request');
  assert.equal(merge.querySelector('a').href, 'https://github.com/openwizdev/WizSite/pull/192');
  assert.equal(text(merge.querySelector('a')), 'openwizdev/WizSite #192 Fix BK4 slot reload check and month label size');
  assert.equal(text(merge.querySelector('.team-spec-meta')), 'Merged24 Nov 2026, 12:55 UTC');
  assert.equal(result.timers.size, 0, 'the replay does not run behind the live panel');
});

test('ticket rules distinguish waiting, builder note and fleet start, review and completed', async () => {
  const data = responses();
  const reviewed = fixtures.replay[1927].tickets.find(ticket => ticket.number === 1931).pull_requests[0];
  data[timeline(2964)] = [{ event: 'commented', body: 'agent: builder' }];
  data[timeline(2965)] = [{ event: 'commented', body: '<!-- openwiz:status v1 -->\nagent: builder' }];
  data[timeline(2966)] = [{ event: 'cross-referenced', source: { issue: {
    repository_url: `${api}/repos/${reviewed.repo}`, html_url: reviewed.url, number: reviewed.number, title: reviewed.title,
    state: 'open', pull_request: { merged_at: null },
  } } }];
  for (const n of [2964, 2965, 2966]) data[sub(2963)].find(issue => issue.number === n).state = 'open';
  Object.assign(data[sub(2963)].find(issue => issue.number === 2967), { state: 'closed', state_reason: 'completed' });
  data[timeline(2967)] = [];
  const states = result => result.panel().querySelector('.team-spec-tickets').elements.map(row => text(row.elements[1]));
  const result = await view({ data });
  assert.deepEqual(states(result), ['Waiting', 'Building', 'In review', 'Merged']);
  assert.equal(text(result.panel().querySelector('.team-spec-merge')), 'No merged pull request yet');

  data[timeline(2965)] = [fixtures.timelines[2965][0], { event: 'cross-referenced', source: { issue: {
    repository_url: `${api}/repos/someone/else`, state: 'open', pull_request: { merged_at: null },
  } } }];
  data[timeline(2966)].push(fixtures.timelines[2966].find(event => event.source?.issue?.pull_request));
  const mixed = await view({ data });
  assert.deepEqual(states(mixed), ['Waiting', 'Building', 'In review', 'Merged']);
  assert.equal(mixed.panel().querySelector('.team-spec-merge a').href, 'https://github.com/openwizdev/WizSite/pull/183');

  data[timeline(2966)][0].source.issue.state = 'closed';
  data[timeline(2966)].push({ event: 'commented', body: 'launch-fleet: started' });
  assert.equal(states(await view({ data }))[2], 'Waiting');
});

test('any failed read leaves only the replay, playing, with no live or current-spec wording', async () => {
  const replayOnly = (result, calls) => {
    assert.equal(result.panel().tag, 'figure');
    assert.equal(result.now(), null);
    // The WD1 ticket’s public title says “live lessons”; nothing else may say live or now.
    assert.doesNotMatch(text(result.stage).replace(fixtures.replay[1927].tickets[0].title, ''), /\b(?:live|now)\b/i);
    assert.equal(result.cache.size, 0);
    assert.equal(text(result.control()), 'Finish replay');
    if (calls !== undefined) assert.equal(result.calls.length, calls);
  };
  for (const status of [201, 403, 429]) {
    replayOnly(await view({ data: { ...moving(), [searchUrl]: status } }), 1);
    replayOnly(await view({ data: { ...moving(), [timeline(2967)]: status } }), 6);
  }
  for (const bad of [null, [null], [{ event: 'commented' }], Array(100).fill({ event: 'labeled' })]) {
    replayOnly(await view({ data: { ...moving(), [timeline(2967)]: bad } }));
  }
  replayOnly(await view({ data: moving(), timeout: true }), 1);
  const invalidCopy = moving();
  invalidCopy[sub(2963)][0].title = 'Live right now';
  replayOnly(await view({ data: invalidCopy }), 2);
  for (const count of [5, 6]) {
    const data = moving();
    data[searchUrl].items.find(item => item.number === 2963).sub_issues_summary.total = count;
    data[sub(2963)] = Array(count).fill(data[sub(2963)][0]);
    replayOnly(await view({ data }), 2);
  }
});

test('uses the original cached time, switches panels on a fresh read and never retries a failed read', async () => {
  const { cache } = await view({ data: moving() });
  const fresh = await view({ cache, at: now + 599_999 });
  assert.equal(fresh.calls.length, 0);
  assert.equal(text(fresh.panel().querySelector('.team-spec-origin')), liveOrigin);

  const stale = await view({ cache, at: now + 600_000, data: { [searchUrl]: 429 } });
  assert.equal(stale.calls.length, 1);
  assert.equal(text(stale.panel().querySelector('.team-spec-origin')), liveOrigin);
  stale.changeVisibility('hidden');
  stale.changeVisibility('visible');
  await stale.settle();
  assert.equal(stale.calls.length, 1);

  // A stale live read shows first; the fresh read finds every ticket merged, so the replay returns.
  let first;
  const finished = await view({ cache: new Map(cache), at: now + 600_000, data: {
    ...responses(),
    [searchUrl]: (_options, _visible, stage) => {
      first = stage.elements.map(node => node.className);
      return { status: 200, json: async () => fixtures.search };
    },
  } });
  assert.deepEqual(first, ['team-spec']);
  assert.equal(finished.panel().tag, 'figure');
  assert.equal(text(finished.now()), nowLine.replace('14:34', '14:44'));
  assert.equal(JSON.parse(finished.cache.get('openwiz-team-spec-v1')).readAt, now + 600_000);

  const cachedDone = await view({ cache: finished.cache, at: now + 600_000 + 1 });
  assert.equal(cachedDone.calls.length, 0);
  assert.equal(cachedDone.panel().tag, 'figure');
  assert.equal(text(cachedDone.now()), nowLine.replace('14:34', '14:44'));
});

test('a panel swap keeps keyboard focus on the page', async () => {
  const { cache } = await view({ data: moving() });
  const result = await view({ cache, at: now + 600_000, data: {
    ...responses(),
    [searchUrl]: (_options, _visible, stage) => {
      stage.querySelector('.team-spec-heading a').focus();
      return { status: 200, json: async () => fixtures.search };
    },
  } });
  assert.equal(result.panel().tag, 'figure');
  assert.equal(result.doc.activeElement, result.stage.querySelector('.team-replay-title a'));
});

test('never reads while hidden and starts nothing until the page is visible', async () => {
  const hidden = await view({ hidden: true, data: moving() });
  assert.equal(hidden.calls.length, 0);
  assert.equal(hidden.panel().tag, 'figure');
  assert.equal(hidden.control().hidden, true);
  assert.equal(hidden.shown().length, 16);
  hidden.changeVisibility('visible');
  await hidden.settle();
  assert.equal(hidden.calls.length, 6);
  assert.equal(hidden.panel().className, 'team-spec');

  const interrupted = await view({ data: {
    ...moving(),
    [searchUrl]: ({ signal }, setVisible) => {
      setVisible('hidden');
      assert.equal(signal.aborted, true);
      return { status: 200, json: async () => fixtures.search };
    },
  } });
  assert.equal(interrupted.calls.length, 1);
  assert.equal(interrupted.panel().tag, 'figure');
  assert.equal(interrupted.now(), null);
});

test('the replay reveals the recorded events in order on a 20-second clock', async () => {
  const run = await view({ data: { [searchUrl]: 403 } });
  const tracks = run.stage.querySelectorAll('[data-replay-stages]');
  assert.ok(tracks.every(track => !track.querySelector('.team-waiting').hidden && text(track.querySelector('.team-waiting')) === 'Waiting'));
  const start = Date.parse(fixtures.replay[1927].opened);
  const times = run.events().map(node => node.querySelector('time').dateTime);
  const duration = Date.parse(times.sort().at(-1)) - start;
  const at = node => node.querySelector('time').dateTime;
  for (const moment of [...new Set(times)].sort()) {
    const ms = (Date.parse(moment) - start) / duration * 20_000;
    run.advanceTo(ms - .01);
    assert.deepEqual(run.shown(), run.events().filter(node => at(node) < moment));
    run.advanceTo(ms + .01);
    assert.deepEqual(run.shown(), run.events().filter(node => at(node) <= moment));
  }
  assert.ok(tracks.every(track => track.querySelector('.team-waiting').hidden &&
    text(track.querySelector('[aria-current]').querySelector('span')) === 'Merged'));
  assert.equal(run.timers.size, 0);
  assert.equal(text(run.control()), 'Play again');
  assert.equal(stamp(run).textContent, 'Replay of a real run · spec #1927 · 20–21 Nov 2026');
});

test('the one control finishes and replays; reduced motion keeps the finished still', async () => {
  const run = await view({ data: { [searchUrl]: 403 } });
  const click = () => run.control().dispatch('click');
  click();
  assert.equal(run.shown().length, 16);
  assert.equal(text(run.control()), 'Play again');
  click();
  assert.equal(run.shown().length, 0);
  assert.equal(run.timers.size, 1);
  run.motion.matches = true;
  run.motion.change();
  assert.equal(run.shown().length, 16);
  assert.equal(run.control().hidden, true);
  assert.equal(run.timers.size, 0);

  const calm = await view({ reduced: true });
  assert.equal(calm.panel().tag, 'figure');
  assert.equal(text(calm.now()), nowLine);
  assert.equal(calm.control().hidden, true);
  assert.equal(calm.shown().length, 16);
  assert.equal(calm.timers.size, 0);
});
