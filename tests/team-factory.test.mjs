import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const { replay, rest } = JSON.parse(read('./fixtures/team-factory.json'));
const html = read('../team/index.html');
const site = read('../site.js');
const script = site.slice(site.indexOf('const ticketStates'), site.indexOf('function showHero'))
  + site.slice(site.indexOf('function initTeamFactory'), site.indexOf('\nenableCopy();\naskAWiz();'))
  + '\ninitTeamFactory();';
const search = 'https://api.github.com/search/issues?q=repo:openwizdev/OpenWiz+is:issue+in:title+%22spec:%22&sort=updated&per_page=20';
const project = 'https://api.github.com/repos/openwizdev/OpenWiz/issues/';
const paths = [search, project + '2963/sub_issues?per_page=20',
  ...[2964, 2965, 2966, 2967].map(number => project + number + '/timeline?per_page=100')];
const responses = new Map(paths.map((path, i) => [path, Object.values(rest)[i]]));
const readAt = Date.parse('2026-11-24T14:33:00Z');
const settle = () => new Promise(resolve => setImmediate(resolve));

function element(textContent = '') {
  return {
    textContent, dataset: {}, children: [], nodes: {}, listeners: {},
    querySelector(selector) { return this.nodes[selector]; },
    querySelectorAll(selector) { return this.nodes[selector]; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    removeAttribute(name) { if (name === 'datetime') this.dateTime = ''; },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    remove() { this.removed = true; },
  };
}

function boot({ reduced = true, fixtures = responses, visible = true, cache = null, fail, present = true } = {}) {
  const rows = [...html.matchAll(/<li data-building="([^"]+)" data-review="([^"]+)">.*?<time datetime="([^"]+)">([^<]+)<\/time><\/span><\/li>/g)]
    .map(([, building, review, dateTime, shown]) => {
      const row = element();
      row.dataset = { building, review };
      row.nodes = { strong: element('Merged'), time: { ...element(shown), dateTime } };
      return row;
    });
  const lastPull = element();
  lastPull.nodes.time = { dateTime: html.match(/<p class="team-landing">.*?<time datetime="([^"]+)"/)[1] };
  const playback = element();
  const header = element();
  playback.nodes = { '.team-landing': lastPull, '.team-tickets li': rows, '.team-replay-header': header };
  const factory = element();
  const label = element();
  const labelTime = { ...element('24 Nov 2026, 14:33 UTC'), dateTime: '2026-11-24T14:33:00Z' };
  label.append('Snapshot · ', labelTime);
  factory.nodes = { '.team-source': label, time: labelTime, '.team-spec a': element('#2963'), '.team-tickets': element() };
  const panel = element();
  panel.nodes = { '.team-replay': playback, '.team-now': factory };
  const visibility = new Set();
  const document = {
    visibilityState: visible ? 'visible' : 'hidden',
    querySelector: () => present ? panel : null,
    createElement: () => element(),
    addEventListener: (_, listener) => visibility.add(listener),
    removeEventListener: (_, listener) => visibility.delete(listener),
  };
  const motion = { matches: reduced, addEventListener: (_, listener) => { motion.change = listener; } };
  const calls = [];
  const timeouts = [];
  const timers = new Map();
  let timerId = 0;
  const context = {
    document, window: { matchMedia: () => motion },
    Date: class extends Date { static now() { return readAt; } },
    AbortController,
    AbortSignal: { any: AbortSignal.any, timeout(ms) {
      assert.equal(ms, 5_000);
      const controller = new AbortController();
      timeouts.push(() => controller.abort(new DOMException('Timed out', 'TimeoutError')));
      return controller.signal;
    } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (fail) return fail(url, options);
      assert.ok(fixtures.has(url), url);
      return { status: 200, json: async () => fixtures.get(url) };
    },
    localStorage: { getItem: () => JSON.stringify(cache), setItem: (_, value) => { cache = JSON.parse(value); } },
    setTimeout: (fire, delay) => { timers.set(++timerId, { fire, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
  };
  runInNewContext(script, context);
  return {
    rows, lastPull, header, motion, label, labelTime, calls, timers, timeouts,
    get cache() { return cache; },
    get spec() { return factory.nodes['.team-spec a']; },
    get states() { return factory.nodes['.team-tickets'].children.map(row => row.children[1].children[0].textContent); },
    setVisible(visible) {
      document.visibilityState = visible ? 'visible' : 'hidden';
      for (const listener of [...visibility]) listener();
    },
  };
}

test('the baked replay uses the packet and ends on its last pull request', () => {
  const page = boot({ reduced: false, visible: false });
  const finalTimes = replay.tickets.map(ticket => [ticket.merged_at, ticket.all_pulls_merged_at].sort()[0]);
  assert.ok(html.includes(`href="${replay.url}">#1927 ${replay.title}`));
  assert.ok(html.includes(`href="${replay.lastPull.url}">WizSkills #229 · ${replay.lastPull.title.replaceAll("'", '’')}`));
  assert.equal(page.lastPull.nodes.time.dateTime, replay.lastPull.merged);
  assert.equal(page.lastPull.inert, true);
  const observed = page.rows.map(row => [[row.nodes.strong.textContent, row.nodes.time.dateTime]]);
  for (const { fire, delay } of page.timers.values()) {
    assert.ok(delay <= 12_000);
    fire();
    page.rows.forEach((row, i) => {
      const state = [row.nodes.strong.textContent, row.nodes.time.dateTime];
      if (state[0] !== observed[i].at(-1)[0]) observed[i].push(state);
    });
  }
  replay.tickets.forEach((ticket, i) => {
    assert.ok(html.includes(`href="${ticket.url}">#${ticket.number} ${ticket.title.replaceAll("'", '’')}`));
    assert.deepEqual(observed[i], [
      ['Waiting', ''], ['Building', ticket.building_at], ['In review', ticket.review_at], ['Merged', finalTimes[i]],
    ]);
  });
  assert.equal(page.lastPull.inert, false);
  assert.equal(page.header.children[0].textContent, 'Replay again');
  page.header.children[0].listeners.click();
  assert.equal(page.header.children[0].textContent, 'Skip replay');
  page.header.children[0].listeners.click();
  assert.equal(page.timers.size, 0);
  assert.equal(page.calls.length, 0);
  const reduced = boot({ visible: false });
  assert.equal(reduced.timers.size, 0);
  assert.equal(reduced.header.children.length, 0);
  assert.deepEqual(reduced.rows.map(row => row.nodes.time.dateTime), finalTimes);
  assert.equal(reduced.rows.at(-1).nodes.time.textContent, '21 Nov · 01:28:08 UTC');
});

test('a visible page reads the frozen REST responses once and reuses a fresh cache', async () => {
  const page = boot({ visible: false });
  assert.equal(page.calls.length, 0);
  assert.equal(page.label.children[0], 'Snapshot · ');
  page.setVisible(true);
  await settle();
  assert.deepEqual(page.calls.map(call => call.url), paths);
  assert.ok(page.calls.every(call => call.options.credentials === 'omit' && !call.options.headers));
  assert.equal(page.label.children[0], 'Live from GitHub · read ');
  assert.equal(page.labelTime.textContent, '14:33');
  assert.equal(page.spec.href, rest.search.items.at(-1).html_url);
  assert.equal(page.spec.textContent, '#2963 spec: openwiz.dev/book, our own booking page for the team call');
  assert.deepEqual(page.states, ['Merged', 'Merged', 'Merged', 'Merged']);
  const refresh = boot({ cache: page.cache });
  assert.equal(refresh.calls.length, 0);
  assert.equal(refresh.labelTime.textContent, '14:33');
  assert.equal(boot({ present: false }).calls.length, 0);
});

test('classification uses completed issues, linked PRs and both builder markers', async () => {
  const fixtures = new Map(responses);
  const completed = { ...rest['sub_issues-2963'][0], state: 'closed', state_reason: 'completed' };
  fixtures.set(paths[1], [completed, ...rest['sub_issues-2963'].slice(1)]);
  const pull = (state, merged_at, owner = 'openwizdev') => ({
    event: 'cross-referenced', source: { issue: { state, pull_request: {
      html_url: `https://github.com/${owner}/WizSite/pull/179`, merged_at,
    } } },
  });
  fixtures.set(paths[2], [pull('open', null)]);
  fixtures.set(paths[3], [pull('closed', '2026-11-24T12:00:00Z'), pull('open', null)]);
  fixtures.set(paths[4], [{ event: 'commented', body: '<!-- openwiz:status v1 -->\nagent: builder' }, pull('open', null, 'other')]);
  fixtures.set(paths[5], [{ event: 'commented', body: 'agent: builder' }, pull('closed', null)]);
  const page = boot({ fixtures });
  await settle();
  assert.deepEqual(page.states, ['Merged', 'In review', 'Building', 'Waiting']);
  fixtures.set(paths[4], [{ event: 'commented', body: 'launch-fleet: started' }]);
  fixtures.set(paths[5], [{ event: 'commented', body: 'launch-fleet: started' }, pull('closed', null)]);
  const fleet = boot({ fixtures });
  await settle();
  assert.deepEqual(fleet.states, ['Merged', 'In review', 'Building', 'Waiting']);
});

test('failed or unaffordable reads keep the snapshot or last read without retrying', async () => {
  const first = boot();
  await settle();
  const stale = { ...first.cache, readAt: readAt - 600_000 };
  const limited = boot({ cache: stale, fail: async () => ({ status: 429 }) });
  await settle();
  limited.setVisible(false);
  limited.setVisible(true);
  assert.equal(limited.calls.length, 1);
  assert.equal(limited.labelTime.textContent, '14:23');
  assert.equal(limited.cache.readAt, stale.readAt);
  const fixtures = new Map(responses);
  fixtures.set(paths[3], { message: 'bad shape' });
  const bad = boot({ fixtures });
  await settle();
  assert.equal(bad.label.children[0], 'Snapshot · ');
  assert.equal(bad.cache, null);
  const stalled = (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const timedOut = boot({ fail: stalled });
  timedOut.timeouts[0]();
  await settle();
  assert.equal(timedOut.calls.length, 1);
  assert.equal(timedOut.calls[0].options.signal.reason.name, 'TimeoutError');
  assert.equal(timedOut.label.children[0], 'Snapshot · ');
  const hidden = boot({ fail: stalled });
  hidden.setVisible(false);
  await settle();
  assert.equal(hidden.calls[0].options.signal.aborted, true);
  assert.equal(hidden.label.children[0], 'Snapshot · ');
  for (const total of [5, 6]) {
    const item = { ...rest.search.items.at(-1), sub_issues_summary: { total } };
    fixtures.set(search, { items: [item, rest.search.items.at(-1)] });
    const oversized = boot({ fixtures });
    await settle();
    assert.equal(oversized.calls.length, 1);
    assert.equal(oversized.label.children[0], 'Snapshot · ');
  }
});
