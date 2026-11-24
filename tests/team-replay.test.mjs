import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../site.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../team/index.html', import.meta.url), 'utf8');
const utc = stamp => '2026-11-' + stamp.replace(' ', 'T') + 'Z';
const opened = utc('20 13:38:32');
// Trimmed replay-packet.json, spec #1927. Each row records build, review, close and linked PRs.
const tickets = [
  [1928, '20 15:45:24', '20 15:57:37', '20 19:03:28', ['OpenWiz #1945']],
  [1929, '20 17:45:43', '20 17:58:49', '21 01:27:35', ['WizSkills #212', 'WizSite #118']],
  [1931, '21 01:32:44', '21 02:00:06', '21 04:36:55', ['WizSkills #229']],
  [1932, '20 17:46:29', '20 17:58:49', '21 01:28:10', ['WizSite #118']],
];
const landings = {
  'OpenWiz #1945': '20 19:03:26',
  'WizSkills #212': '21 01:27:33',
  'WizSite #118': '21 01:28:08',
  'WizSkills #229': '21 04:36:53',
};

function playback(reduced = false) {
  const tracks = [];
  const events = [];
  function event(markup, label, track) {
    const [, dateTime] = markup.match(/datetime="([^"]+)"/);
    const attrs = new Set(markup.includes('aria-current="step"') ? ['aria-current'] : []);
    const node = {
      label, attrs, dateTime,
      closest: () => track,
      querySelector: () => ({ dateTime }),
      setAttribute: name => attrs.add(name),
      removeAttribute: name => attrs.delete(name),
    };
    events.push(node);
    return node;
  }
  for (const [, number, steps] of html.matchAll(/issues\/(\d+)"[^>]*><code>WD\d+<\/code> [^<]+<\/a>\n\s*<div class="team-timeline" data-replay-stages>([\s\S]*?)\n\s*<\/div>\n\s*<\/li>/g)) {
    const stages = [];
    const track = {
      number: Number(number), stages,
      prepend(waiting) { this.waiting = waiting; },
      querySelector(selector) {
        if (selector === '.team-waiting') return this.waiting;
        return stages.find(stage => stage.attrs.has('aria-current'));
      },
    };
    for (const [markup, label] of steps.matchAll(/<div data-replay-event[^>]*><span>([^<]+)<\/span> <time[^>]*>[^<]+<\/time><\/div>/g)) {
      stages.push(event(markup, label, track));
    }
    tracks.push(track);
  }
  for (const [markup, label] of html.matchAll(/<li data-replay-event><a [^>]*>([^<]+)<\/a> <time[^>]*>[^<]+<\/time><\/li>/g)) {
    event(markup, label);
  }
  const control = {
    textContent: html.match(/<button class="team-replay-control"[^>]*>([^<]+)/)[1],
    hidden: true,
    addEventListener(_type, click) { this.click = click; },
  };
  const motion = {
    matches: reduced,
    addEventListener(_type, change) { this.change = change; },
  };
  const replay = {
    dataset: { teamReplay: html.match(/data-team-replay="([^"]+)"/)[1] },
    querySelector: () => control,
    querySelectorAll: selector => selector === '[data-replay-event]' ? events : tracks,
  };
  const timers = new Map();
  let now = 0;
  let id = 0;
  let reads = 0;
  const family = { children: [], setAttribute() {}, removeAttribute() {} };
  const footer = { addEventListener() {} };
  const selectors = { '[data-team-replay]': replay, '.family': family, '.landing-footer': footer };
  runInNewContext(script, {
    document: {
      querySelector: selector => selectors[selector] || null,
      querySelectorAll: () => [],
      createElement: () => ({ setAttribute() {} }),
    },
    window: {}, navigator: {},
    matchMedia: query => {
      if (query === '(prefers-reduced-motion: no-preference)') return { matches: !reduced };
      assert.equal(query, '(prefers-reduced-motion: reduce)');
      return motion;
    },
    performance: { now: () => now },
    setTimeout(callback, ms) {
      timers.set(++id, { callback, at: now + ms });
      return id;
    },
    clearTimeout: token => timers.delete(token),
    fetch() { reads++; throw new Error('unexpected read'); },
  });
  return {
    tracks, events, control, motion, timers, replay,
    reads: () => reads,
    advanceTo(time) {
      for (const [token, timer] of timers) {
        if (timer.at > time) break;
        now = timer.at;
        timers.delete(token);
        timer.callback();
      }
      now = time;
    },
    shown: () => events.filter(node => !node.attrs.has('data-replay-pending')),
  };
}

test('the still contains the packet’s ticket transitions and unique pull request landings', () => {
  const run = playback(true);
  assert.equal(run.replay.dataset.teamReplay, opened);
  assert.deepEqual(run.tracks.map(track => track.number), tickets.map(([number]) => number));
  for (const [number, build, review, close, linked] of tickets) {
    const { stages } = run.tracks.find(track => track.number === number);
    const merged = [close, linked.map(pr => landings[pr]).sort().at(-1)].sort()[0];
    assert.deepEqual(stages.map(stage => [stage.label, stage.dateTime]),
      [['Building', utc(build)], ['In review', utc(review)], ['Merged', utc(merged)]]);
    assert.ok(stages[2].attrs.has('aria-current'));
  }
  assert.deepEqual(run.events.slice(-4).map(node => [node.label, node.dateTime]),
    Object.entries(landings).map(([label, at]) => [label, utc(at)]));
  assert.equal(run.shown().length, 16);
  assert.equal('running' in run.replay.dataset, false);
  assert.equal(run.timers.size, 0);
  assert.equal(run.control.hidden, true);
  assert.equal(run.reads(), 0);
});

test('replay reveals the recorded events in order on a 20-second clock', () => {
  const run = playback();
  assert.ok(run.tracks.every(track => !track.waiting.hidden && track.waiting.textContent === 'Waiting'));
  assert.equal(run.control.textContent, 'Finish replay');
  assert.equal('running' in run.replay.dataset, true);
  assert.equal(run.shown().length, 0);
  const start = Date.parse(opened);
  const duration = Date.parse(utc(landings['WizSkills #229'])) - start;
  for (const at of [...new Set(run.events.map(node => node.dateTime))].sort()) {
    const ms = (Date.parse(at) - start) / duration * 20_000;
    run.advanceTo(ms - .01);
    assert.deepEqual(run.shown(), run.events.filter(node => node.dateTime < at));
    run.advanceTo(ms + .01);
    assert.deepEqual(run.shown(), run.events.filter(node => node.dateTime <= at));
  }
  assert.ok(run.tracks.every(track => track.waiting.hidden && track.querySelector('[aria-current]').label === 'Merged'));
  assert.equal('running' in run.replay.dataset, false);
  assert.equal(run.timers.size, 0);
  assert.equal(run.control.textContent, 'Play again');
  assert.equal(run.reads(), 0);
});

test('the one control can finish and replay, and enabling reduced motion leaves the full still', () => {
  const run = playback();
  assert.equal('running' in run.replay.dataset, true);
  run.control.click();
  assert.equal(run.shown().length, 16);
  assert.equal('running' in run.replay.dataset, false);
  assert.equal(run.control.textContent, 'Play again');
  run.control.click();
  assert.equal(run.shown().length, 0);
  assert.equal('running' in run.replay.dataset, true);
  assert.equal(run.timers.size, 1);
  run.motion.matches = true;
  run.motion.change();
  assert.equal(run.shown().length, 16);
  assert.equal('running' in run.replay.dataset, false);
  assert.equal(run.control.hidden, true);
  assert.equal(run.timers.size, 0);
});
