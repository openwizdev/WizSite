import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { API, SITE, World, launch, open } from '../../tests/v2/browser.mjs';

const path = '/repos/openwizdev/WizSite/contents/showcase/data.json';
const feed = `${API}${path}?ref=showcase-data`;
const fixture = async name => JSON.parse(await readFile(
  new URL(`../../scripts/showcase-fixtures/${name}.json`, import.meta.url), 'utf8'));
const none = Array(4).fill('Unavailable');

test('the built showcase renders only fresh, validated counts and makes one credential-free data request', { timeout: 60000 }, async () => {
  const source = await fixture('valid');
  const readTime = Date.parse(source.read_at);
  const fresh = readTime + 15 * 60000;
  const values = ['21', '3', '5', '0'];
  const browser = await launch();
  try {
    async function render(name, reply, at, expected, reason, widths = []) {
      const world = new World();
      world.github[`GET ${path}`] = () => reply;
      const originalAnswer = world.answer.bind(world);
      world.answer = async request => {
        const response = await originalAnswer(request);
        if (request.url === `${SITE}/showcase/`) {
          const injection = '<script defer src="https://static.cloudflareinsights.com/beacon.min.js"></script>';
          response.raw = Buffer.from(response.raw.toString().replace('</body>', injection + '</body>'));
        }
        return response;
      };
      let session;
      browser.on(message => {
        if (message.method === 'Target.attachedToTarget' && message.params.targetInfo.url === 'about:blank') {
          session = message.params.sessionId;
        }
      });
      const page = await open(browser, world);
      try {
        await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `Date.now = () => ${at};` }, session);
        await page.go(`${SITE}/showcase/`);
        await page.until('document.querySelector("dl")?.getAttribute("aria-busy") === "false"', 'settled showcase');
        const rendered = await page.run(`[...document.querySelectorAll('[data-count]')].map(node => node.textContent)`);
        assert.deepEqual(rendered, expected, `${name}: visible counts`);
        assert.ok((await page.text()).includes(reason), `${name}: visible reason or read time`);
        const requests = world.log.filter(request => request.origin !== SITE || ![
          '/showcase/', '/showcase/showcase.css', '/showcase/showcase.js',
        ].includes(request.path));
        assert.deepEqual(requests.map(request => [request.method, request.url]), [['GET', feed]]);
        assert.equal(requests[0].headers.Accept, 'application/vnd.github.raw+json');
        assert.equal(await page.run('document.cookie'), '');
        assert.ok(world.violations.some(message => message.includes('static.cloudflareinsights.com')),
          'the page blocks an injected analytics script');
        assert.equal(world.violations.filter(message => !message.includes('static.cloudflareinsights.com')).length, 0);
        for (const width of widths) {
          for (const theme of ['light', 'dark']) {
            const height = width === 390 ? 844 : 900;
            await page.size(width, height, false);
            await page.media([{ name: 'prefers-color-scheme', value: theme }]);
            assert.equal(await page.run('document.documentElement.scrollWidth'), width, `${theme} at ${width}px`);
            if (process.env.SHOWCASE_SHOTS) {
              await page.shot(join(process.env.SHOWCASE_SHOTS, `${width}-${theme}.png`), width, height, false);
            }
          }
        }
      } finally {
        await page.close();
      }
    }

    const valid = { status: 200, json: source };
    await render('stale', valid, readTime + 7200001, none, 'more than two hours ago');
    await render('valid', valid, fresh, values, 'read 15 minutes ago', [390, 1440]);
    await render('two-hour boundary', valid, readTime + 7200000, values, 'read 120 minutes ago');
    await render('missing', { status: 404 }, fresh, none, 'file is missing');
    await render('offline', { abort: true }, fresh, none, 'could not be loaded');
    await render('rate-limited', { status: 403 }, fresh, none, 'could not be loaded');
    await render('all-null', { status: 200, json: await fixture('all-null') },
      fresh, none, 'count was unavailable');
    await render('mixed', { status: 200, json: { ...source, prs_merged_7d: null } },
      fresh, ['21', 'Unavailable', '5', '0'], 'count was unavailable');

    for (const name of ['extra-field', 'string-field', 'negative', 'bad-time']) {
      await render(name, { status: 200, json: await fixture(name) }, fresh, none, 'file is invalid');
    }
    await render('impossible date', { status: 200, json: { ...source, read_at: '2030-02-30T12:00:00Z' } },
      fresh, none, 'file is invalid');
    await render('duplicate key', { status: 200, raw: Buffer.from(JSON.stringify(source).replace('{', '{"schema":"other",')) },
      fresh, none, 'file is invalid');
    await render('malformed JSON', { status: 200, raw: Buffer.from('{') }, fresh, none, 'file is invalid');
  } finally {
    await browser.close();
  }
});
