import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breadcrumbData, createRegistry } from '../scripts/registry.mjs';
import { sitemapFiles } from '../scripts/sitemap.mjs';
import { crawlerFiles, registry as siteRegistry, withMetadata } from '../scripts/discovery.mjs';

const home = { path: 'index.html', title: 'OpenWiz, the synthetic home', description: 'A synthetic home.', section: 'pages', trail: [], lastmod: '2026-11-20' };
const page = (path, title, section = 'pages', lastmod = '2026-11-21') => ({
  path, title, description: `About ${title}.`, section, lastmod, trail: [{ name: title, path }],
});

test('refuses a second path, title or description, and bad fields', () => {
  const registry = createRegistry();
  registry.add(home);
  assert.throws(() => registry.add(home), /registered twice/);
  assert.throws(() => registry.add({ ...page('a/index.html', 'A OpenWiz'), title: home.title }), /duplicate title/);
  assert.throws(() => registry.add({ ...page('b/index.html', 'B OpenWiz'), description: home.description }), /duplicate description/);
  assert.throws(() => registry.add(page('c/index.html', 'No name here')), /name OpenWiz/);
  assert.throws(() => registry.add(page('d/index.html', 'D OpenWiz ' + 'x'.repeat(60))), /1 to 60/);
  assert.throws(() => registry.add(page('e/index.html', 'E OpenWiz', 'blog')), /unknown section/);
  assert.throws(() => registry.add({ ...page('f/index.html', 'F OpenWiz'), lastmod: 'yesterday' }), /YYYY-MM-DD/);
  assert.throws(() => registry.add({ ...page('h/index.html', 'H OpenWiz'), lastmod: '2026-02-31' }), /real YYYY-MM-DD/);
  assert.throws(() => registry.add({ ...page('g/index.html', 'G OpenWiz'), trail: [] }), /trail/);
});

test('a breadcrumb runs from the home to the page; none for the home or a noindex page', () => {
  const registry = createRegistry();
  registry.add(home);
  const faq = registry.add(page('faq/index.html', 'FAQ OpenWiz'));
  const hidden = registry.add({ ...page('app/index.html', 'App OpenWiz'), indexable: false });
  assert.equal(breadcrumbData(registry.get('index.html')), null);
  assert.equal(breadcrumbData(hidden), null);
  assert.deepEqual(breadcrumbData(faq).itemListElement, [
    { '@type': 'ListItem', position: 1, name: 'OpenWiz', item: 'https://openwiz.dev/' },
    { '@type': 'ListItem', position: 2, name: 'FAQ OpenWiz', item: 'https://openwiz.dev/faq/' },
  ]);
});

test('one section sitemap per section with pages, under one index with the newest lastmod', () => {
  const registry = createRegistry();
  registry.add(home);
  registry.add(page('faq/index.html', 'FAQ OpenWiz'));
  registry.add(page('guides/x/index.html', 'X OpenWiz', 'answers', '2026-11-25'));
  registry.add({ ...page('app/index.html', 'App OpenWiz'), indexable: false });
  const files = sitemapFiles(registry.all());
  assert.deepEqual(Object.keys(files).sort(), ['sitemap-answers.xml', 'sitemap-pages.xml', 'sitemap.xml']);
  assert.match(files['sitemap.xml'], /<sitemap><loc>https:\/\/openwiz\.dev\/sitemap-pages\.xml<\/loc><lastmod>2026-11-21<\/lastmod><\/sitemap>/);
  assert.match(files['sitemap.xml'], /sitemap-answers\.xml<\/loc><lastmod>2026-11-25</);
  assert.equal((files['sitemap-pages.xml'].match(/<url>/g) || []).length, 2);
  assert.doesNotMatch(files['sitemap-pages.xml'], /app\//);
});

test('a trail step must be a registered page', () => {
  const registry = createRegistry();
  registry.add(home);
  registry.add({ ...page('docs/a/index.html', 'Docs A OpenWiz', 'docs'), trail: [{ name: 'Docs', path: 'docs/index.html' }, { name: 'A', path: 'docs/a/index.html' }] });
  assert.throws(() => registry.verified(), /docs\/index\.html, which is not registered/);
  registry.add(page('docs/index.html', 'Docs OpenWiz', 'docs'));
  assert.equal(registry.verified().length, 3);
});

test('a page added with registry.add gets its metadata, breadcrumb and section sitemap', () => {
  siteRegistry.add({ path: 'docs/index.html', title: 'Docs: OpenWiz synthetic', description: 'Synthetic docs home.', section: 'docs', lastmod: '2026-11-28', trail: [{ name: 'Docs', path: 'docs/index.html' }] });
  siteRegistry.add({
    path: 'docs/synthetic/index.html', title: 'Synthetic page: OpenWiz docs', description: 'A synthetic docs page.', section: 'docs', lastmod: '2026-11-28',
    trail: [{ name: 'Docs', path: 'docs/index.html' }, { name: 'Synthetic page', path: 'docs/synthetic/index.html' }],
  });
  const html = withMetadata('docs/synthetic/index.html', '<head><template data-slot="page-metadata"></template></head><main></main>');
  assert.match(html, /<title>Synthetic page: OpenWiz docs<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/openwiz\.dev\/docs\/synthetic\/">/);
  assert.match(html, /"@type": "BreadcrumbList"/);
  const files = sitemapFiles(siteRegistry.verified());
  assert.match(files['sitemap-docs.xml'], /https:\/\/openwiz\.dev\/docs\/synthetic\//);
  assert.match(files['sitemap.xml'], /sitemap-docs\.xml/);
  assert.throws(() => withMetadata('docs/unregistered/index.html', ''), /not in the page registry/);
});

test('an indexable page is index.html in its own folder; a noindex page may be another file', () => {
  const registry = createRegistry();
  registry.add(home);
  assert.throws(() => registry.add(page('docs/first-run.html', 'First run OpenWiz', 'docs')), /index\.html in its own folder/);
  registry.add({ ...page('404.html', 'Not found OpenWiz'), indexable: false });
});
