import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SITE, start } from './browser.mjs';

const ROOT = new URL('../../', import.meta.url);
const FORMS = new URL('fixtures/forms/', import.meta.url);
const form = async name => JSON.parse(await readFile(new URL(name, FORMS), 'utf8'));
const source = path => readFile(new URL(path, ROOT));

const GRAPH = {
  tickets: [
    { key: 'acme/factory#42', number: 42, title: 'Synthetic ticket: the list', url: 'https://github.com/acme/factory/issues/42',
      state: 'merged', gap: false, outside: false, blockers: [], missing: 0 },
    { key: 'acme/factory#43', number: 43, title: 'Synthetic ticket: done notes', url: 'https://github.com/acme/factory/issues/43',
      state: 'building', gap: false, outside: false, blockers: ['acme/factory#42'], missing: 0 },
  ],
  unknown: 0,
};

const FAKE = `(() => {
  const calls = window.calls = [];
  const issued = new WeakSet();
  let n = 0;
  const outcomes = window.outcomes = [];
  window.bodies = window.bodies || {};
  OW.records = {
    enabled: () => true,
    dryRun: () => false,
    pending: () => [],
    async compose(action) {
      calls.push({ call: 'compose', action: JSON.parse(JSON.stringify(action)) });
      const body = action.form === 'spec.change' ? action.words : window.bodies[action.form];
      const preview = { op: 'op-' + String(++n).padStart(32, '0'), form: action.form, body, repository: action.item.repository,
        subject: action.item.subject, url: action.item.url, visibility: 'repository', confirms: 1, source: null };
      issued.add(preview);
      return preview;
    },
    confirm(preview, event) {
      calls.push({ call: 'confirm', op: preview.op, trusted: !!event && event.isTrusted === true, issued: issued.has(preview) });
      return { confirmed: 1, of: 1 };
    },
    async post(preview) {
      calls.push({ call: 'post', op: preview.op, body: preview.body, issued: issued.has(preview) });
      return { op: preview.op, ...(outcomes.shift() || { outcome: 'posted', comment: { id: 9001, url: preview.url + '#issuecomment-9001' } }) };
    },
  };
})()`;

async function card(run, item, { width = 1280, height = 900, below = false } = {}) {
  for (const path of ['app/cards/spec.js', 'app/cards/spec.css']) {
    run.world.site[`/${path}`] = async () => ({ status: 200, raw: await source(path), type: path.split('.').pop() });
  }
  await run.page.size(width, height, width < 500);
  await run.page.go(`${SITE}/app/`);
  await run.page.until(`window.OW && OW.ui && window.dagre && document.readyState === 'complete'`, 'the app scripts');
  await run.page.run(`new Promise((resolve, reject) => {
    const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/app/cards/spec.css';
    document.head.append(style);
    const script = document.createElement('script'); script.src = '/app/cards/spec.js'; script.onload = resolve; script.onerror = reject;
    document.head.append(script);
  })`);
  await run.page.run(FAKE);
  const bodies = {};
  for (const [name, file] of [['spec.ship', 'spec-ship'], ['spec.not_now', 'spec-not_now']]) bodies[name] = await form(`${file}.body.json`);
  await run.page.run(`window.bodies = ${JSON.stringify(bodies)}`);
  await run.page.run(`(() => {
    const el = document.createElement('section'); el.id = 'under-test';
    const spacer = Object.assign(document.createElement('div'), { style: 'height:2000px' });
    document.body.replaceChildren(...(${below} ? [spacer] : []), el);
    OW.cards.spec(${JSON.stringify(item)}, el);
  })()`);
}

const VIDEO = `(() => {
  const v = document.querySelector('#under-test video');
  return v && { src: v.currentSrc || v.getAttribute('src'), preload: v.getAttribute('preload'), autoplay: v.hasAttribute('autoplay'),
    poster: !!v.getAttribute('poster'), muted: v.muted, playsinline: v.hasAttribute('playsinline'), playing: !v.paused && !v.ended,
    time: v.currentTime };
})()`;
const PLAN = `(() => {
  const plan = document.querySelector('#under-test [data-plan]');
  return plan && plan.getClientRects().length > 0 ? [...plan.querySelectorAll('[data-ticket]')].map(e => e.getAttribute('data-ticket')) : null;
})()`;
const LINK = url => `[...document.querySelectorAll('#under-test a[href]')].some(a => a.href === ${JSON.stringify(url)} && a.offsetParent !== null)`;

async function itemOf(file, extra = {}) {
  return { ...(await form(file)).action.item, ...extra };
}

test('a spec with a same-origin video plays it on its card, lazily and muted, behind a poster', async () => {
  const run = await start();
  try {
    const item = await itemOf('spec-ship.input.json', { graph: GRAPH });
    await card(run, item, { width: 1280, height: 600, below: true });
    const before = await run.page.run(VIDEO);
    assert.ok(before, 'the card shows no video');
    assert.equal(before.src, item.video.url);
    assert.equal(before.preload, 'none');
    assert.equal(before.autoplay, false, 'the video has an autoplay attribute');
    assert.ok(before.poster && before.muted && before.playsinline, 'the video is not poster-first, muted and inline');
    assert.equal(before.playing, false, 'the video plays before it is in view');
    assert.ok(!run.world.log.some(r => r.path === '/art/todo-spec.mp4'), 'the video loads before it is near the view');
    assert.equal(await run.page.run(PLAN), null, 'the plan picture shows beside a playable video');
    assert.ok(await run.page.run(LINK(item.video.url)), 'no plain link to the video');
    await run.page.run(`document.querySelector('#under-test video').scrollIntoView({ block: 'center' }), true`);
    await run.page.until(`(${VIDEO}).playing && (${VIDEO}).muted`, 'the video playing muted in view', 10000);
    assert.ok(run.world.log.some(r => r.path === '/art/todo-spec.mp4'), 'in view, the video never loaded');
    await run.page.run('scrollTo(0, 0), true');
    await run.page.until(`!(${VIDEO}).playing`, 'the video pausing out of view');
    await run.page.tap('Play with sound');
    await run.page.until(`(${VIDEO}).playing && !(${VIDEO}).muted`, 'the video playing with sound');
    assert.deepEqual(run.world.violations, []);
    assert.deepEqual(run.world.writes(), []);
  } finally {
    await run.close();
  }
});

test('a spec without a video, or with an off-site one, shows its plan picture and never plays', async () => {
  const run = await start();
  try {
    for (const video of [null, { url: 'https://videos.example.com/spec.mp4' }]) {
      const item = await itemOf('spec-ship.input.json', { video, graph: GRAPH });
      await card(run, item, { width: 390, height: 844 });
      assert.equal(await run.page.run(VIDEO), null, `a video element shows for ${JSON.stringify(video)}`);
      assert.deepEqual(await run.page.run(PLAN), ['42', '43'], `no plan picture for ${JSON.stringify(video)}`);
      if (video) assert.ok(await run.page.run(LINK(video.url)), 'the off-site video has no plain link');
      assert.equal(await run.page.run('document.documentElement.scrollWidth > innerWidth'), false, 'the card scrolls sideways on a phone');
    }
    const unread = await itemOf('spec-ship.input.json', { video: null, graph: null });
    await card(run, unread);
    assert.match(await run.page.text(), /plan picture couldn.t be read/i);
    assert.ok(!run.world.log.some(r => /videos\.example\.com/.test(r.url)), 'the off-site video was requested');
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});

for (const [button, file] of [['Ship it', 'spec-ship'], ['Not now', 'spec-not_now']]) {
  test(`${button} previews the fixture's exact body and posts only on a separate confirm`, async () => {
    const run = await start();
    try {
      const fixture = await form(`${file}.input.json`);
      const body = await form(`${file}.body.json`);
      await card(run, fixture.action.item);
      await run.page.tap(button);
      await run.page.until(`document.querySelector('#under-test [data-preview]')`, 'the preview');
      const calls = await run.page.run('calls');
      assert.deepEqual(calls, [{ call: 'compose', action: fixture.action }]);
      assert.equal(await run.page.run(`document.querySelector('#under-test [data-preview] [data-body]').textContent`), body);
      const text = await run.page.text();
      assert.match(text, /acme\/factory#41/);
      assert.match(text, /everyone who can read acme\/factory/);
      assert.ok(!/Posted/.test(text), 'the card says posted before any confirm');
      await run.page.tap('Cancel');
      await run.page.until(`!document.querySelector('#under-test [data-preview]')`, 'the preview closing');
      assert.deepEqual((await run.page.run('calls')).map(c => c.call), ['compose'], 'cancel confirmed or posted');
      await run.page.tap(button);
      await run.page.until(`document.querySelector('#under-test [data-preview]')`, 'the second preview');
      await run.page.tap('Post it');
      await run.page.until(`calls.some(c => c.call === 'post')`, 'the post');
      const after = await run.page.run('calls');
      assert.deepEqual(after.map(c => c.call), ['compose', 'compose', 'confirm', 'post']);
      assert.equal(after[2].trusted, true, 'the confirm did not pass the trusted tap');
      assert.equal(after[2].op, after[3].op);
      assert.ok(after[2].issued && after[3].issued, 'the card passed a copy, not the preview compose returned');
      assert.equal(after[3].body, body);
      await run.page.until(`document.querySelector('#under-test [data-outcome="posted"]')`, 'the posted outcome');
      assert.ok(await run.page.run(LINK('https://github.com/acme/factory/issues/41#issuecomment-9001')), 'no link to the posted comment');
      assert.deepEqual(run.world.writes(), []);
    } finally {
      await run.close();
    }
  });
}

test('Change something keeps every byte typed, and an unknown outcome is never shown as sent', async () => {
  const run = await start();
  try {
    const fixture = await form('spec-change.input.json');
    await card(run, fixture.action.item);
    await run.page.run(`outcomes.push({ outcome: 'unknown', reason: 'network' }, { outcome: 'refused', reason: 'github' })`);
    await run.page.tap('Change something');
    await run.page.until(`document.querySelector('#under-test textarea')`, 'the typed box');
    await run.page.run(`document.querySelector('#under-test textarea').focus()`);
    const typed = `  ${fixture.action.words}\n\t<b>reset</b> &amp; "quotes" é\u{1F600}  \n`;
    await run.page.type(typed);
    await run.page.tap('Preview');
    await run.page.until(`document.querySelector('#under-test [data-preview]')`, 'the preview');
    const [compose] = await run.page.run('calls');
    assert.equal(compose.action.form, 'spec.change');
    assert.equal(compose.action.words, typed, 'the typed words changed on the way to compose');
    assert.deepEqual(Object.keys(compose.action).sort(), ['form', 'item', 'words']);
    assert.equal(await run.page.run(`document.querySelector('#under-test [data-preview] [data-body]').textContent`), typed);
    await run.page.tap('Post it');
    await run.page.until(`document.querySelector('#under-test [data-outcome="unknown"]')`, 'the unknown outcome');
    let text = await run.page.text();
    assert.match(text, /may or may not have posted/i);
    assert.ok(!/\b(Posted|Sent)\b/.test(text), `an unknown outcome reads as sent: ${text}`);
    await run.page.tap('Check again');
    await run.page.until(`document.querySelector('#under-test [data-preview]')`, 'the preview again');
    assert.equal((await run.page.run('calls')).filter(c => c.call === 'post').length, 1, 'check again posted without a confirm');
    await run.page.tap('Post it');
    await run.page.until(`document.querySelector('#under-test [data-outcome="refused"]')`, 'the refused outcome');
    const calls = await run.page.run('calls');
    const posts = calls.filter(c => c.call === 'post');
    assert.equal(posts.length, 2);
    assert.equal(posts[0].op, posts[1].op, 'check again composed a new intent');
    text = await run.page.text();
    assert.match(text, /Not posted/);
    assert.ok(!/\b(Posted|Sent)\b/.test(text));
    assert.deepEqual(run.world.writes(), []);
  } finally {
    await run.close();
  }
});

test('a refused compose says why and offers no confirm', async () => {
  const run = await start();
  try {
    const fixture = await form('spec-change.input.json');
    await card(run, fixture.action.item);
    await run.page.run(`OW.records.compose = async action => (calls.push({ call: 'compose', action }), { refused: 'refused_form' })`);
    await run.page.tap('Change something');
    await run.page.until(`document.querySelector('#under-test textarea')`, 'the typed box');
    await run.page.run(`document.querySelector('#under-test textarea').focus()`);
    await run.page.type('launch-fleet: start #1');
    await run.page.tap('Preview');
    await run.page.until(`document.querySelector('#under-test [data-outcome="refused"]')`, 'the refusal');
    assert.match(await run.page.text(), /can.t write/i);
    assert.equal(await run.page.run(`[...document.querySelectorAll('#under-test button')].some(b => b.textContent.trim() === 'Post it')`), false);
    assert.equal(await run.page.run(`document.querySelector('#under-test textarea').value`), 'launch-fleet: start #1', 'the typed words were lost');
  } finally {
    await run.close();
  }
});

test('a steer still unknown after a reload shows on its card, and a pending refusal shows that steer to check', async () => {
  const run = await start();
  try {
    const fixture = await form('spec-not_now.input.json');
    const body = await form('spec-not_now.body.json');
    const waiting = { op: 'op-' + 'a'.repeat(32), form: 'spec.not_now', body, repository: 'acme/factory', subject: { kind: 'issue', number: 41 },
      url: fixture.action.item.url, visibility: 'repository', confirms: 1, source: null };
    await card(run, fixture.action.item);
    await run.page.run(`window.waiting = ${JSON.stringify(waiting)}`);
    await run.page.run(`OW.records.pending = () => [window.waiting]; OW.cards.spec(${JSON.stringify(fixture.action.item)}, document.querySelector('#under-test'))`);
    await run.page.until(`document.querySelector('#under-test [data-outcome="unknown"]')`, 'the restored unknown steer');
    assert.equal(await run.page.run(`document.querySelector('#under-test [data-body]').textContent`), body);
    await run.page.run(`OW.records.pending = () => []; OW.cards.spec(${JSON.stringify(fixture.action.item)}, document.querySelector('#under-test'))`);
    await run.page.run(`outcomes.push({ outcome: 'refused', reason: 'pending' })`);
    await run.page.tap('Ship it');
    await run.page.until(`document.querySelector('#under-test [data-preview]')`, 'the preview');
    await run.page.run(`OW.records.pending = () => [window.waiting]`);
    await run.page.tap('Post it');
    await run.page.until(`document.querySelector('#under-test [data-outcome="unknown"]')`, 'the waiting steer after a pending refusal');
    assert.match(await run.page.text(), /another steer on this spec still has an unknown outcome/i);
    assert.equal(await run.page.run(`document.querySelector('#under-test [data-body]').textContent`), body, 'the waiting steer is not the one shown');
    await run.page.tap('Check again');
    await run.page.until(`document.querySelector('#under-test [data-preview]')`, 'the waiting steer to confirm again');
    await run.page.tap('Post it');
    await run.page.until(`calls.filter(c => c.call === 'post').length === 2`, 'the check again post');
    assert.equal((await run.page.run('calls')).filter(c => c.call === 'post')[1].op, waiting.op, 'check again posted a different intent');
  } finally {
    await run.close();
  }
});
