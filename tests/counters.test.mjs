import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  START, END, clicks, downloads, merge, pageViews, readDaily, render, run, totals, validate, withCounters,
} from '../scripts/counters.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixtures = join(root, 'counters/fixtures');
const fixture = async name => JSON.parse(await readFile(join(fixtures, name), 'utf8'));
const token = 'planted-analytics-token-5f1c9a';
const env = { WIZ_COUNTERS_TOKEN: token, WIZ_COUNTERS_ACCOUNT: 'account-tag-1', WIZ_COUNTERS_SITE: 'site-tag-1', WIZ_COUNTERS_DATASET: 'wiz_clicks' };
const now = new Date('2031-03-03T05:00:00Z');
const expected = [
  { date: '2031-03-01', page: '/', count: 42 },
  { date: '2031-03-01', page: '/docs/', count: 5 },
  { date: '2031-03-01', page: '/docs/install/', count: 3 },
  { date: '2031-03-01', page: '/market/', count: 7 },
  { date: '2031-03-01', page: 'click:install-copy', count: 4 },
  { date: '2031-03-01', page: 'click:install-in-wiz', count: 3 },
  { date: '2031-03-02', page: '/', count: 11 },
  { date: '2031-03-02', page: '/faq/', count: 6 },
  { date: '2031-03-02', page: 'click:install-copy', count: 1 },
  { date: '2031-03-03', page: 'downloads', count: 200 },
];

globalThis.fetch = () => { throw new Error('a counters test reached for the network'); };

function fakePlatform(answers, calls = []) {
  return async (url, init = {}) => {
    const { hostname, pathname } = new URL(url);
    const headers = new Headers(init.headers);
    calls.push({ url: String(url), method: init.method ?? 'GET', authorization: headers.get('Authorization'), body: init.body ?? '' });
    const answer = hostname === 'api.github.com' ? answers.releases
      : pathname.endsWith('/graphql') ? answers.pageviews
      : pathname.endsWith('/analytics_engine/sql') ? answers.clicks : undefined;
    if (answer === undefined) throw new Error(`unexpected request: ${url}`);
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

async function answers() {
  return { pageviews: await fixture('pageviews.json'), clicks: await fixture('clicks.json'), releases: await fixture('releases.json') };
}

async function scratch(t) {
  const folder = await mkdtemp(join(tmpdir(), 'counters-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

test('reads the platform aggregates and the release downloads into date, page and count', async t => {
  const file = join(await scratch(t), 'daily.json');
  const calls = [];
  const lines = [];
  await run({ env, fetch: fakePlatform(await answers(), calls), now, file, log: line => lines.push(line) });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), expected);
  assert.deepEqual(await readDaily(file), expected);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Counters: 10 rows, 2031-03-01 to 2031-03-03$/);
});

test('keeps only pages the site serves, folded to one row a day, and only the two install clicks', async () => {
  const { pageviews, clicks: clickAnswer, releases } = await answers();
  const views = pageViews(pageviews);
  assert.deepEqual(views.filter(row => row.date === '2031-03-01').map(row => [row.page, row.count]).sort(),
    [['/', 42], ['/docs/', 5], ['/docs/install/', 3], ['/market/', 7]]);
  assert.deepEqual(clicks(clickAnswer).map(row => row.page).sort(), ['click:install-copy', 'click:install-copy', 'click:install-in-wiz']);
  assert.equal(downloads(releases), 200);
});

test('sends the token to the platform only, and asks GitHub without one', async t => {
  const file = join(await scratch(t), 'daily.json');
  const calls = [];
  await run({ env, fetch: fakePlatform(await answers(), calls), now, file, log: () => {} });
  assert.equal(calls.length, 3);
  for (const call of calls) {
    const host = new URL(call.url).hostname;
    assert.ok(['api.cloudflare.com', 'api.github.com'].includes(host), call.url);
    assert.equal(call.authorization, host === 'api.cloudflare.com' ? `Bearer ${token}` : null);
    assert.ok(!call.url.includes(token) && !String(call.body).includes(token));
  }
  const graphql = calls.find(call => call.url.endsWith('/graphql'));
  assert.deepEqual(JSON.parse(graphql.body).variables, { account: 'account-tag-1', site: 'site-tag-1', since: '2031-02-24', until: '2031-03-02' });
});

test('the token never reaches the output, the log or an error', async t => {
  const folder = await scratch(t);
  const file = join(folder, 'daily.json');
  const lines = [];
  await run({ env, fetch: fakePlatform(await answers()), now, file, log: line => lines.push(line) });
  assert.ok(!(await readFile(file, 'utf8')).includes(token) && !lines.join('\n').includes(token));

  const leaky = {
    'refuses with the token in its answer': async () => new Response(JSON.stringify({ errors: [{ message: `bad token ${token}` }] }), { status: 403 }),
    'throws with the token in its message': async (url, init) => { throw new Error(`connect failed with ${new Headers(init.headers).get('Authorization')}`); },
    'answers with errors that repeat the token': async () => new Response(JSON.stringify({ data: null, errors: [{ message: token }] }), { status: 200 }),
  };
  for (const [name, fetch] of Object.entries(leaky)) {
    const failed = join(folder, 'failed.json');
    const error = await run({ env, fetch, now, file: failed, log: line => lines.push(line) }).then(() => null, error => error);
    assert.ok(error instanceof Error, name);
    assert.ok(!`${error.message}\n${error.stack}\n${String(error.cause ?? '')}`.includes(token), name);
    assert.ok(!existsSync(failed), `${name}: a failed read writes nothing`);
  }
  assert.ok(!lines.join('\n').includes(token));
  await assert.rejects(run({ env: { ...env, WIZ_COUNTERS_TOKEN: '' }, fetch: fakePlatform(await answers()), now, file, log: () => {} }), /WIZ_COUNTERS_TOKEN/);
});

test('the command line run on fixtures prints and writes nothing that holds the token, with the network cut', async t => {
  const file = join(await scratch(t), 'daily.json');
  const cut = 'data:text/javascript,globalThis.fetch=()=>{throw new Error("network cut")}';
  const result = spawnSync(process.execPath, ['--import', cut, 'scripts/counters.mjs', '--fixtures', fixtures, '--out', file, '--today', '2031-03-03'],
    { cwd: root, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), expected);
  assert.equal(result.stdout, 'Counters: 10 rows, 2031-03-01 to 2031-03-03\n');
  assert.ok(!`${result.stdout}${result.stderr}${await readFile(file, 'utf8')}`.includes(token));

  const live = spawnSync(process.execPath, ['--import', cut, 'scripts/counters.mjs', '--out', file],
    { cwd: root, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
  assert.notEqual(live.status, 0);
  assert.ok(!`${live.stdout}${live.stderr}`.includes(token));

  const missing = spawnSync(process.execPath, ['--import', cut, 'scripts/counters.mjs', '--fixtures', fixtures, '--out', file],
    { cwd: root, env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /WIZ_COUNTERS_TOKEN/);
});

test('a later run replaces the days it reads again, keeps older days, and adds only new downloads', async () => {
  const kept = { date: '2031-02-01', page: '/', count: 9 };
  const before = [kept, { date: '2031-03-01', page: '/', count: 1 }, { date: '2031-03-01', page: '/team/', count: 2 },
    { date: '2031-02-20', page: 'downloads', count: 150 }, { date: '2031-03-03', page: 'downloads', count: 20 }];
  const fresh = [{ date: '2031-03-01', page: '/', count: 42 }];
  assert.deepEqual(merge(before, fresh, { since: '2031-02-24', until: '2031-03-02', today: '2031-03-03', downloads: 200 }), [
    kept, { date: '2031-02-20', page: 'downloads', count: 150 }, { date: '2031-03-01', page: '/', count: 42 },
    { date: '2031-03-03', page: 'downloads', count: 50 },
  ]);
  assert.deepEqual(merge([{ date: '2031-02-20', page: 'downloads', count: 150 }], [], { since: '2031-02-24', until: '2031-03-02', today: '2031-03-03', downloads: 140 }),
    [{ date: '2031-02-20', page: 'downloads', count: 150 }]);
});

test('daily.json holds only date, page and count', async () => {
  const rows = await readDaily();
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ['count', 'date', 'page']);
  const good = { date: '2031-03-01', page: '/', count: 1 };
  assert.deepEqual(validate([good]), [good]);
  for (const bad of [
    { ...good, ip: '192.0.2.1' }, { ...good, userAgent: 'test browser' }, { ...good, login: 'someone' }, { ...good, id: 7 },
    { date: '2031-03-01', page: '/' }, { ...good, count: -1 }, { ...good, count: 1.5 }, { ...good, count: '1' },
    { ...good, date: '2031-3-1' }, { ...good, date: '2031-02-30' }, { ...good, page: '/?visitor=7' }, { ...good, page: '/docs/Someone@Example.test/' },
    { ...good, page: 'click:star' }, { ...good, page: '/wp-login.php' }, 'row', null,
  ]) assert.throws(() => validate([bad]), /daily\.json/, JSON.stringify(bad));
  assert.throws(() => validate({ rows: [good] }), /daily\.json/);
  assert.throws(() => validate([good, good]), /daily\.json/);
});

test('refuses an answer it cannot read, and a full answer it could not have read whole', async () => {
  const { pageviews, clicks: clickAnswer } = await answers();
  assert.throws(() => pageViews({ data: { viewer: { accounts: [] } } }), /page views/);
  assert.throws(() => pageViews({ data: pageviews.data, errors: [{ message: 'no' }] }), /page views/);
  const group = pageviews.data.viewer.accounts[0].rumPageloadEventsAdaptiveGroups[0];
  assert.throws(() => pageViews({ data: { viewer: { accounts: [{ rumPageloadEventsAdaptiveGroups: Array(10000).fill(group) }] } } }), /page views/);
  assert.throws(() => clicks({ data: [{ date: '2031-03-01', action: 'install-copy', count: 'many' }] }), /clicks/);
  assert.throws(() => clicks({ ...clickAnswer, data: undefined }), /clicks/);
  assert.throws(() => downloads({ message: 'rate limited' }), /downloads/);
  assert.throws(() => downloads([{ assets: [{ download_count: '5' }] }]), /downloads/);
});

test('the counters page shows totals only, never a row per visitor', () => {
  assert.deepEqual(totals(expected), { site: 66, docs: 8, installInWiz: 3, installCopy: 5, downloads: 200, since: '2031-03-01', until: '2031-03-03' });
  const section = render([...expected, { date: '2031-03-04', page: '/', count: 1234 }]);
  for (const text of ['Site page views: <strong>1,300</strong>', 'Docs page views: <strong>8</strong>', '“Install in Wiz” clicks: <strong>3</strong>',
    'Install line copies: <strong>5</strong>', 'Release downloads: <strong>200</strong>', '2031-03-01 to 2031-03-04']) assert.ok(section.includes(text), text);
  assert.equal(section.split('<li>').length - 1, 5);
  assert.ok(render([]).includes('No counts yet.'));
  const page = withCounters('<main><template data-slot="counters"></template></main>', section);
  assert.equal(page, `<main>${START}${section}${END}</main>`);
  assert.throws(() => withCounters('<main></main>', section), /counters page/);
  assert.throws(() => withCounters(page, section), /counters page/);
});

test('the built site serves the counters page, unindexed, and no page sets a cookie or loads a tracker script', async () => {
  const dist = join(root, 'dist');
  if (!existsSync(join(dist, 'index.html'))) execFileSync(process.execPath, ['build.mjs'], { cwd: root, stdio: 'ignore' });
  const built = (await readdir(dist, { recursive: true })).filter(name => /\.(html|js)$/.test(name)).sort();
  const html = built.filter(name => name.endsWith('.html'));
  assert.ok(html.includes('counters/index.html') && html.includes('index.html') && html.length >= 12, html.join(', '));
  const trackers = /google-analytics|googletagmanager|gtag\(|cloudflareinsights|plausible\.io|usefathom|matomo|mixpanel|segment\.(?:com|io)|hotjar|posthog|clarity\.ms|doubleclick|facebook\.net|fingerprintjs/i;
  for (const name of built) {
    const text = await readFile(join(dist, name), 'utf8');
    assert.ok(!/document\s*\.\s*cookie|cookieStore|http-equiv\s*=\s*["']?set-cookie/i.test(text), `${name} sets a cookie`);
    assert.ok(!trackers.test(text), `${name} names a tracker`);
    if (!name.endsWith('.html')) continue;
    for (const [, attributes] of text.matchAll(/<script\b([^>]*)>/g)) {
      const src = attributes.match(/\bsrc\s*=\s*["']?([^"'\s>]+)/)?.[1];
      assert.ok(src === undefined || /^\/(?!\/)/.test(src), `${name} loads a script from outside the site: ${src}`);
    }
  }
  assert.ok(!/^\s*Set-Cookie\s*:/im.test(await readFile(join(dist, '_headers'), 'utf8')), '_headers sets a cookie');
  const counters = await readFile(join(dist, 'counters/index.html'), 'utf8');
  assert.match(counters, /<meta name="robots" content="noindex">/);
  assert.equal(counters.split(START).length, 2);
  assert.ok(counters.includes(render(await readDaily())));
  assert.ok(!(await readFile(join(dist, 'sitemap.xml'), 'utf8')).includes('/counters/'));
});
