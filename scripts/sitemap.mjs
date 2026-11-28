import { sections, site } from './registry.mjs';

const namespace = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const xml = (tag, entries) => [
  '<?xml version="1.0" encoding="UTF-8"?>', `<${tag} xmlns="${namespace}">`,
  ...entries, `</${tag}>`, '',
].join('\n');

export function sitemapFiles(registry) {
  const bySection = new Map(sections.map(section => [section, []]));
  for (const { path, section, lastmod, indexable } of registry.values()) {
    if (indexable) {
      bySection.get(section).push(`  <url><loc>${new URL(path, site).href}</loc><lastmod>${lastmod}</lastmod></url>`);
    }
  }
  const files = {};
  const index = [];
  for (const [section, entries] of bySection) {
    if (entries.length === 0) continue;
    const file = `sitemaps/${section}.xml`;
    files[file] = xml('urlset', entries);
    index.push(`  <sitemap><loc>${site}${file}</loc></sitemap>`);
  }
  files['sitemap.xml'] = xml('sitemapindex', index);
  return files;
}
