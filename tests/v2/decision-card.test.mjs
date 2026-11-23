import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SITE, start } from './browser.mjs';

const ROOT = new URL('../../', import.meta.url);
const FORMS = new URL('fixtures/forms/', import.meta.url);
const json = async name => JSON.parse(await readFile(new URL(name, FORMS), 'utf8'));
const KINDS = ['grill_round', 'grill_confirmation', 'spec_confirmation', 'plan_approval'];
const TAPS = { yes: 'Yes', no: 'No' };
const OP = `op-${'a'.repeat(32)}`;

let run;
const page = () => run.page;

before(async () => {
  run = await start();
  for (const file of ['decision.js', 'decision.css']) {
    const data = await readFile(new URL(`app/cards/${file}`, ROOT));
    run.world.site[`/app/cards/${file}`] = () => ({ status: 200, raw: data, type: file.split('.').pop() });
  }
  await run.page.go(`${SITE}/app/`);
  await run.page.until(`document.readyState === 'complete' && window.OW && OW.ui`, 'the app page');
  await run.page.run(`new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = '/app/cards/decision.css';
    document.head.append(link);
    const script = document.createElement('script');
    script.src = '/app/cards/decision.js'; script.onload = resolve; script.onerror = reject;
    document.head.append(script);
  })`);
  await run.page.until(`typeof OW.cards.decision === 'function'`, 'the decision card');
});

after(async () => {
  assert.deepEqual(run.world.violations, [], 'the card broke the app CSP or threw');
  assert.deepEqual(run.world.writes(), [], 'the card sent a request of its own');
  await run.close();
});

async function mount(item, { rows = [], outcomes = [], dryRun = false, enabled = true } = {}) {
  await page().run(`(() => {
    const rows = ${JSON.stringify(rows)};
    const outcomes = ${JSON.stringify(outcomes)};
    const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
    const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
    const fake = window.fake = { calls: [], issued: [], confirms: new Map() };
    OW.records = {
      enabled: () => ${enabled},
      dryRun: () => ${dryRun},
      pending: () => [],
      async compose(action) {
        fake.calls.push({ call: 'compose', action: JSON.parse(JSON.stringify(action)) });
        const row = rows.find(r => same(r.action, action));
        if (!row) return { refused: 'not_a_form' };
        const preview = row.preview;
        fake.issued.push(preview);
        fake.confirms.set(preview, 0);
        return preview;
      },
      confirm(preview, event) {
        const trusted = !!(event && event.isTrusted);
        fake.calls.push({ call: 'confirm', trusted, issued: fake.issued.includes(preview) });
        let n = fake.confirms.get(preview) || 0;
        if (trusted && n < preview.confirms) fake.confirms.set(preview, ++n);
        return { confirmed: n, of: preview.confirms };
      },
      async post(preview) {
        const confirmed = fake.confirms.get(preview) || 0;
        fake.calls.push({ call: 'post', op: preview.op, confirmed, of: preview.confirms, issued: fake.issued.includes(preview) });
        fake.confirms.set(preview, 0);
        if (confirmed < preview.confirms) return { outcome: 'refused', op: preview.op, reason: 'not_confirmed' };
        if (${dryRun}) return { outcome: 'refused', op: preview.op, reason: 'dry_run' };
        return outcomes.shift() || { outcome: 'posted', op: preview.op,
          comment: { id: 9200001, url: preview.url + '#issuecomment-9200001' } };
      },
    };
    document.getElementById('card-under-test')?.remove();
    const el = document.createElement('div');
    el.id = 'card-under-test';
    el.append(document.createElement('p'));
    document.body.prepend(el);
    document.getElementById('app')?.setAttribute('hidden', '');
    window.cardReturned = OW.cards.decision(${JSON.stringify(item)}, el);
  })()`);
}

const calls = kind => page().run(`fake.calls.filter(c => ${kind ? `c.call === ${JSON.stringify(kind)}` : 'true'})`);
const cardText = () => page().run(`document.getElementById('card-under-test').innerText`);
const controls = () => page().run(`[...document.querySelectorAll('#card-under-test button, #card-under-test textarea, #card-under-test input')]
  .filter(e => e.offsetParent !== null).map(e => e.tagName === 'BUTTON' ? e.textContent.trim() : e.tagName.toLowerCase())`);
const shownBody = () => page().run(`(() => { const pre = document.querySelector('#card-under-test [data-preview-body]');
  return pre && pre.offsetParent !== null ? pre.textContent : null; })()`);
const until = (expression, what) => page().until(expression, what, 4000);

function previewFor(input, body, visibility = 'repository') {
  const { item } = input.action;
  const kind = item.subject.kind === 'pull_request' ? 'pull' : 'issues';
  return { op: OP, form: input.action.form, body, repository: item.repository, subject: item.subject,
    url: `https://github.com/${item.repository}/${kind}/${item.subject.number}`, visibility,
    confirms: ['live', 'release', 'publish'].includes(item.request.risk) ? 2 : 1,
    source: { ref: 'issue', digest: 'e'.repeat(64) } };
}

async function answer(input) {
  const { form, words } = input.action;
  const choice = form.split('.')[1];
  if (choice === 'own') {
    assert.ok(await page().run(`!!document.querySelector('#card-under-test textarea')`), 'the card offers no typed reply');
    await page().run(`document.querySelector('#card-under-test textarea').focus()`);
    await page().type(words);
    await page().tap('Preview reply');
  } else {
    await page().tap(TAPS[choice]);
  }
}

for (const choice of ['yes', 'no', 'own']) {
  for (const kind of KINDS) {
    test(`decision.${choice} on ${kind}: previews the fixture's exact body and posts only on confirm`, async () => {
      const input = await json(`decision-${choice}-${kind}.input.json`);
      const body = await json(`decision-${choice}-${kind}.body.json`);
      const preview = previewFor(input, body);
      await mount(input.action.item, { rows: [{ action: input.action, preview }] });
      assert.equal(await page().run('window.cardReturned'), undefined, 'the card returns nothing');
      const text = await cardText();
      assert.ok(text.includes(input.action.item.title), 'the card shows its subject');
      await answer(input);
      await until(`document.querySelector('#card-under-test [data-preview-body]')`, 'the preview');
      assert.deepEqual((await calls('compose')).map(c => c.action), [input.action], 'the tap composed exactly the fixture action');
      assert.equal(await shownBody(), body, 'the preview shows the exact body');
      const shown = await cardText();
      assert.ok(shown.includes(input.action.item.repository), 'the preview names the repository');
      assert.ok(await page().run(`!!document.querySelector('#card-under-test a[href=${JSON.stringify(JSON.stringify(preview.url)).slice(1, -1)}]')`),
        'the preview links where it goes');
      assert.match(shown, /everyone who can read acme\/factory/, 'the preview says who can see it');
      assert.deepEqual(await calls('post'), [], 'nothing posts before the confirm');
      for (let n = 1; n <= preview.confirms; n++) {
        assert.deepEqual(await calls('post'), [], `nothing posts before confirm ${n} of ${preview.confirms}`);
        assert.equal(await shownBody(), body, `confirm ${n} shows the same full preview`);
        await page().tap(n === 1 ? 'Post' : 'Confirm again');
        if (n < preview.confirms) await until(`[...document.querySelectorAll('#card-under-test button')].some(b => b.textContent.trim() === 'Confirm again')`, 'the second confirm');
      }
      await until(`document.querySelector('#card-under-test [data-outcome]')`, 'the outcome');
      const posts = await calls('post');
      assert.equal(posts.length, 1, 'one confirmed preview posts exactly once');
      assert.equal(posts[0].confirmed, preview.confirms, 'post came only after every confirm');
      assert.ok(posts[0].issued, 'post sent the preview compose returned, unchanged');
      assert.ok((await calls('confirm')).every(c => c.trusted && c.issued), 'each confirm is a trusted tap on the issued preview');
    });
  }
}

test('the preview says plainly when the comment is public', async () => {
  const input = await json('decision-yes-spec_confirmation.input.json');
  const body = await json('decision-yes-spec_confirmation.body.json');
  await mount(input.action.item, { rows: [{ action: input.action, preview: previewFor(input, body, 'public') }] });
  await page().tap('Yes');
  await until(`document.querySelector('#card-under-test [data-preview-body]')`, 'the preview');
  assert.match(await cardText(), /Public: anyone can read it/);
});

test('a risky record confirms twice: one confirm posts nothing and asks again', async () => {
  const input = await json('decision-yes-plan_approval.input.json');
  const body = await json('decision-yes-plan_approval.body.json');
  const preview = previewFor(input, body);
  assert.equal(preview.confirms, 2);
  await mount(input.action.item, { rows: [{ action: input.action, preview }] });
  assert.match(await cardText(), /live/i, 'the card shows the risk');
  await page().tap('Yes');
  await until(`document.querySelector('#card-under-test [data-preview-body]')`, 'the preview');
  await page().tap('Post');
  await until(`[...document.querySelectorAll('#card-under-test button')].some(b => b.textContent.trim() === 'Confirm again')`, 'the second confirm');
  assert.deepEqual(await calls('post'), [], 'the first of two confirms posted');
  assert.equal(await shownBody(), body, 'the second confirm shows the same full preview');
  assert.ok(!(await controls()).includes('Post'), 'the first confirm button is gone, so one tap cannot count twice');
  await page().tap('Cancel');
  await until(`!document.querySelector('#card-under-test [data-preview-body]')`, 'the cancelled preview');
  assert.deepEqual(await calls('post'), [], 'cancel posted');
});

test('an untrusted click on Post is not a confirm and posts nothing', async () => {
  const input = await json('decision-yes-grill_confirmation.input.json');
  const body = await json('decision-yes-grill_confirmation.body.json');
  await mount(input.action.item, { rows: [{ action: input.action, preview: previewFor(input, body) }] });
  await page().tap('Yes');
  await until(`document.querySelector('#card-under-test [data-preview-body]')`, 'the preview');
  await page().click('Post');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.deepEqual(await calls('post'), [], 'a synthetic click posted');
  assert.equal(await shownBody(), body, 'the preview stays up');
});

const NO_ANSWER = {
  stale: /newer|stale|changed/i,
  superseded: /superseded/i,
  unreadable: /couldn.t (be )?read/i,
  'risk-unknown': /risk/i,
  'currentness-unknown': /couldn.t check/i,
};
for (const [name, why] of Object.entries(NO_ANSWER)) {
  test(`${name}: shows why and offers no answer`, async () => {
    const input = await json(`refused/${name}.input.json`);
    await mount(input.action.item);
    assert.deepEqual(await controls(), [], 'the card offers an answer');
    assert.match(await cardText(), why, 'the card says why');
    assert.match(await cardText(), /can.t be answered here/i);
    assert.deepEqual(await calls(), [], 'the card called OW.records');
  });
}

test('answers are off when OW.records is not enabled', async () => {
  const input = await json('decision-yes-spec_confirmation.input.json');
  await mount(input.action.item, { enabled: false });
  assert.deepEqual(await controls(), []);
  assert.deepEqual(await calls(), []);
});

test('a typed reply keeps every byte typed', async () => {
  const input = await json('decision-own-spec_confirmation.input.json');
  const words = '  two  spaces,\ta tab,\n\nlaunch-fleet: not parsed ✓ ünï \n';
  const action = { ...input.action, words };
  await mount(input.action.item, { rows: [{ action, preview: previewFor({ action }, 'synthetic body') }] });
  await answer({ action });
  await until(`document.querySelector('#card-under-test [data-preview-body]')`, 'the preview');
  assert.deepEqual((await calls('compose')).map(c => c.action.words), [words]);
});

test('a refused compose shows why and offers no post', async () => {
  const input = await json('decision-own-spec_confirmation.input.json');
  await mount(input.action.item);
  await answer({ action: { ...input.action, words: 'anything' } });
  await until(`document.querySelector('#card-under-test [data-outcome]')`, 'the refusal');
  assert.match(await cardText(), /Not posted/);
  assert.match(await cardText(), /not_a_form/);
  assert.ok(!(await controls()).includes('Post'));
  assert.deepEqual(await calls('post'), []);
});

async function outcome(result) {
  const input = await json('decision-yes-grill_confirmation.input.json');
  const body = await json('decision-yes-grill_confirmation.body.json');
  const preview = previewFor(input, body);
  await mount(input.action.item, { rows: [{ action: input.action, preview }], outcomes: [result] });
  await page().tap('Yes');
  await until(`document.querySelector('#card-under-test [data-preview-body]')`, 'the preview');
  await page().tap('Post');
  await until(`document.querySelector('#card-under-test [data-outcome]')`, 'the outcome');
  return { text: await cardText(), state: await page().run(`document.querySelector('#card-under-test [data-outcome]').dataset.outcome`), preview };
}

test('posted shows a link to the comment', async () => {
  const url = 'https://github.com/acme/factory/pull/7#issuecomment-9200001';
  const { text, state } = await outcome({ outcome: 'posted', op: OP, comment: { id: 9200001, url } });
  assert.equal(state, 'posted');
  assert.match(text, /Posted/);
  assert.ok(await page().run(`!!document.querySelector('#card-under-test [data-outcome] a[href="${url}"]')`), 'no link to the comment');
});

test('refused shows that nothing was posted, and why', async () => {
  const { text, state } = await outcome({ outcome: 'refused', op: OP, reason: 'github' });
  assert.equal(state, 'refused');
  assert.match(text, /Not posted/);
  assert.match(text, /github/i);
  assert.doesNotMatch(text, /\bPosted\b/);
});

test('an unknown outcome is never shown as sent, and checking again needs its confirm again', async () => {
  const { text, state, preview } = await outcome({ outcome: 'unknown', op: OP, reason: 'network' });
  assert.equal(state, 'unknown');
  assert.match(text, /Outcome unknown/);
  assert.doesNotMatch(text, /\bPosted\b|\bSent\b|\bsent\b(?! to)|\bDone\b/, 'unknown read as sent');
  assert.ok(await page().run(`!document.querySelector('#card-under-test [data-outcome] a[href*="issuecomment"]')`), 'unknown linked a comment');
  await page().tap('Check again');
  await until(`[...document.querySelectorAll('#card-under-test button')].some(b => b.textContent.trim() === 'Post')`, 'the confirm again');
  assert.equal(await shownBody(), preview.body, 'checking again shows the same preview');
  assert.equal((await calls('post')).length, 1, 'check again posted without a confirm');
  await page().tap('Post');
  await until(`(fake.calls.filter(c => c.call === 'post').length === 2)`, 'the second post');
  const posts = await calls('post');
  assert.equal(posts[1].op, OP, 'check again reuses the same intent');
  assert.equal((await calls('compose')).length, 1, 'check again composed a new intent');
});

test('dry run shows the preview and says nothing was posted', async () => {
  const input = await json('decision-no-grill_round.input.json');
  const body = await json('decision-no-grill_round.body.json');
  await mount(input.action.item, { rows: [{ action: input.action, preview: previewFor(input, body) }], dryRun: true });
  await page().tap('No');
  await until(`document.querySelector('#card-under-test [data-preview-body]')`, 'the preview');
  assert.equal(await shownBody(), body);
  await page().tap('Post');
  await until(`document.querySelector('#card-under-test [data-outcome]')`, 'the outcome');
  assert.match(await cardText(), /Dry run: nothing was posted/);
});
