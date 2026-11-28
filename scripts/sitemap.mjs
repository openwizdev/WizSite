// The sitemap index and one sitemap per section (contracts/discovery.v1.md, SO1 of spec openwizdev/OpenWiz#3513).
import { SECTIONS, SITE, urlFor } from './registry.mjs';

const xml = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

export function sitemapFiles(entries) {
  const files = {};
  const index = [];
  for (const section of SECTIONS) {
    const pages = entries.filter(entry => entry.indexable && entry.section === section);
    if (pages.length === 0) continue;
    if (pages.length > 50000) throw new Error(`the ${section} sitemap has more than 50,000 URLs`);
    const name = `sitemaps/${section}.xml`;
    files[name] = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...pages.map(entry => `  <url><loc>${xml(urlFor(entry.path))}</loc><lastmod>${entry.lastmod}</lastmod></url>`), '</urlset>', ''].join('\n');
    const newest = pages.map(entry => entry.lastmod).sort().at(-1);
    index.push(`  <sitemap><loc>${SITE}${name}</loc><lastmod>${newest}</lastmod></sitemap>`);
  }
  files['sitemap.xml'] = ['<?xml version="1.0" encoding="UTF-8"?>', '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...index, '</sitemapindex>', ''].join('\n');
  return files;
}
