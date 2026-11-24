import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../site.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../team/index.html', import.meta.url), 'utf8');
const utc = stamp => '2026-11-' + stamp.replace(' ', 'T') + 'Z';
const stamp = iso => `${Number(iso.slice(8, 10))} Nov ${iso.slice(11, 16)}`;
const opened = utc('20 13:38:32');
// Trimmed replay-packet.json, spec #1927. Each row records build, review, close and linked PRs.
const tickets = [
  [1928, '20 15:45:24', '20 15:57:37', '20 19:03:28', ['OpenWiz #1945']],
  [1929, '20 17:45:43', '20 17:58:49', '21 01:27:35', ['WizSkills #212', 'WizSite #118']],
  [1932, '20 17:46:29', '20 17:58:49', '21 01:28:10', ['WizSite #118']],
  [1931, '21 01:32:44', '21 02:00:06', '21 04:36:55', ['WizSkills #229']],
];
const landings = {
  'OpenWiz #1945': '20 19:03:26',
  'WizSkills #212': '21 01:27:33',
  'WizSite #118': '21 01:28:08',
  'WizSkills #229': '21 04:36:53',
};

function playback(reduced = false) {
  const stars = [];
  for (const [, classes, attrs, label, stateText, dateTime, timeText] of html.matchAll(
    /<li class="(team-star[^"]*)"([^>]*)><a [^>]*>([^<]+)<\/a> <span>([^<]+)<\/span> <time datetime="([^"]+)">([^<]+)<\/time><\/li>/g
  )) {
    const dataset = {};
    for (const [, key, value] of attrs.matchAll(/data-([a-z]+)="([^"]+)"/g)) dataset[key] = value;
    const span = { textContent: stateText };
    const time = { dateTime, textContent: timeText };
    stars.push({
      classes,
      label,
      dataset,
      span,
      time,
      querySelector: selector => (selector === 'span' ? span : selector === 'time' ? time : null),
    });
  }
  const links = [];
  for (const [, lit, star] of html.matchAll(/<path class="team-link"( data-lit)? data-star="([^"]+)"[^>]*\/>/g)) {
    const attrs = new Set(lit ? ['data-lit'] : []);
    links.push({
      dataset: { star },
      attrs,
      setAttribute: name => attrs.add(name),
      removeAttribute: name => attrs.delete(name),
    });
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
    querySelector: selector => (selector === '.team-replay-control' ? control : null),
    querySelectorAll: selector => (selector === '.team-star' ? stars : selector === '.team-link' ? links : []),
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
    stars, links, control, motion, timers, replay,
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
  };
}

test('the still sky contains the packet’s ticket transitions and unique pull request landings', () => {
  const run = playback(true);
  assert.equal(run.replay.dataset.teamReplay, opened);
  assert.equal(run.stars.length, tickets.length + Object.keys(landings).length);
  assert.deepEqual(run.stars.slice(0, 4).map(star => Number(star.dataset.star)), tickets.map(([number]) => number));
  for (const [number, build, review, close, linked] of tickets) {
    const star = run.stars.find(item => item.dataset.star === String(number));
    const merged = [close, linked.map(pr => landings[pr]).sort().at(-1)].sort()[0];
    assert.deepEqual([star.dataset.building, star.dataset.review, star.dataset.merged],
      [utc(build), utc(review), utc(merged)]);
    assert.equal(star.dataset.state, 'merged');
    assert.equal(star.span.textContent, 'Merged');
    assert.equal(star.time.dateTime, utc(merged));
    assert.equal(star.time.textContent, stamp(utc(merged)));
  }
  const prStars = run.stars.slice(4);
  assert.deepEqual(prStars.map(star => [star.label, star.dataset.merged, star.time.dateTime, star.time.textContent]),
    Object.entries(landings).map(([label, at]) => [label, utc(at), utc(at), stamp(utc(at))]));
  assert.ok(prStars.at(-1).classes.includes('team-landing'));
  assert.ok(run.links.every(link => link.attrs.has('data-lit')));
  assert.equal(run.timers.size, 0);
  assert.equal(run.control.hidden, true);
  assert.equal(run.reads(), 0);
});

test('replay lights up each star and link in recorded order on a 20-second clock', () => {
  const run = playback();
  assert.equal(run.control.hidden, false);
  assert.equal(run.control.textContent, 'Finish replay');
  assert.ok(run.stars.every(star => star.dataset.state === 'waiting' && star.span.textContent === 'Waiting' && !star.time.dateTime && !star.time.textContent));
  assert.ok(run.links.every(link => !link.attrs.has('data-lit')));

  const states = [['building', 'Building'], ['review', 'In review'], ['merged', 'Merged']];
  const expectedAt = (star, cutoff, inclusive) => {
    let current = ['waiting', 'Waiting', ''];
    for (const [state, label] of states) {
      const iso = star.dataset[state];
      if (iso && (inclusive ? iso <= cutoff : iso < cutoff)) current = [state, label, iso];
    }
    return current;
  };
  const checkAt = (cutoff, inclusive) => {
    for (const star of run.stars) {
      const [state, label, iso] = expectedAt(star, cutoff, inclusive);
      assert.equal(star.dataset.state, state);
      assert.equal(star.span.textContent, label);
      assert.equal(star.time.dateTime, iso);
      assert.equal(star.time.textContent, iso && stamp(iso));
      const link = run.links.find(item => item.dataset.star === star.dataset.star);
      assert.equal(link.attrs.has('data-lit'), state !== 'waiting');
    }
  };

  const times = [...new Set(run.stars.flatMap(star => states.map(([s]) => star.dataset[s]).filter(Boolean)))].sort();
  assert.equal(times.length, 12);
  const start = Date.parse(opened);
  const duration = Date.parse(utc(landings['WizSkills #229'])) - start;
  for (const at of times) {
    const ms = (Date.parse(at) - start) / duration * 20_000;
    run.advanceTo(ms - .01);
    checkAt(at, false);
    run.advanceTo(ms + .01);
    checkAt(at, true);
  }
  assert.ok(run.stars.every(star => star.dataset.state === 'merged' && star.span.textContent === 'Merged' && star.time.dateTime === star.dataset.merged));
  assert.ok(run.links.every(link => link.attrs.has('data-lit')));
  assert.equal(run.timers.size, 0);
  assert.equal(run.control.textContent, 'Play again');
  assert.equal(run.reads(), 0);
});

test('the one control can finish and replay, and enabling reduced motion leaves the full sky', () => {
  const run = playback();
  run.control.click();
  assert.ok(run.stars.every(star => star.dataset.state === 'merged' && star.time.dateTime === star.dataset.merged));
  assert.ok(run.links.every(link => link.attrs.has('data-lit')));
  assert.equal(run.control.textContent, 'Play again');
  run.control.click();
  assert.ok(run.stars.every(star => star.dataset.state === 'waiting' && !star.time.dateTime));
  assert.ok(run.links.every(link => !link.attrs.has('data-lit')));
  assert.equal(run.timers.size, 1);
  run.motion.matches = true;
  run.motion.change();
  assert.ok(run.stars.every(star => star.dataset.state === 'merged' && star.time.dateTime === star.dataset.merged));
  assert.ok(run.links.every(link => link.attrs.has('data-lit')));
  assert.equal(run.control.hidden, true);
  assert.equal(run.timers.size, 0);
});
