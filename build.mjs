// A static export: only the reviewed public assets, without a runtime server. The brand files are the
// logo pack: favicons, the outlined lockup (no live text, no font) and the 1200x630 social card.
// Styles and scripts are fingerprinted (name.<hash>.ext) and both pages are rewritten to use them, so a
// change always gets a new URL: no visitor can pair new HTML with an old cached stylesheet or script.
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readAll, render, summary, withReleases } from './scripts/changelog.mjs';

const root = new URL('./', import.meta.url);
const output = new URL('dist/', root);
const vendor = ['vendor/gsap-3.15.1.min.js', 'vendor/GSAP-LICENSE.txt', 'vendor/LOBE-ICONS-LICENSE.txt', 'vendor/LUCIDE-LICENSE.txt'];
const art = (await readdir(new URL('art/', root))).filter(name => name.endsWith('.webp')).sort().map(name => `art/${name}`);
// The drivers page's logos (#62): each host's official mark, unaltered, and Lucide's generic icons (ISC: monitor, #62; bot, #66), served same-origin.
const driverLogos = ['drivers/logos/boat-dev.svg', 'drivers/logos/cloudroom.png', 'drivers/logos/monitor.svg', 'drivers/logos/bot.svg'];
const pages = ['index.html', 'changelog/index.html', 'drivers/index.html', 'team/index.html', 'faq/index.html', 'app/index.html'];
// The header's one buy button (#63), from one snippet, added to every site page's top bar (not the app's), so no page
// owns a copy of it.
const cta = await readFile(new URL('header-cta.html', root), 'utf8');
const withCta = html => {
  const bar = '  </nav>\n</header>';
  if (html.split(bar).length !== 2) throw new Error('a site page needs exactly one top bar');
  return html.replace(bar, cta + bar);
};
// The site footer (#73): one snippet, added at each site page's one footer slot, so no page keeps its own copy.
const footer = await readFile(new URL('footer.html', root), 'utf8');
const withFooter = html => {
  const slot = '<!-- footer.html -->\n';
  if (html.split(slot).length !== 2) throw new Error('a site page needs exactly one footer slot');
  return html.replace(slot, footer);
};
// The Questions (#76): one snippet, faq.html, added at the landing's and /team's faq slot and at /faq's top slot, where
// it is the page's own heading: its title becomes the h1 and each question an h2.
const faq = await readFile(new URL('faq.html', root), 'utf8');
const faqTop = faq.replace(/<(\/?)h2\b/g, '<$1h1').replace(/<(\/?)h3\b/g, '<$1h2');
const withFaq = html => html.replace('<!-- faq.html -->\n', faq).replace('<!-- faq.html h1 -->\n', faqTop);
// The app (openwiz.dev/app): its design system, data layer, page modules and shell, fingerprinted like the site's.
const app = ['app/ember.css', 'app/data.js', 'app/ui.js', 'app/pages/you.js', 'app/pages/specs.js', 'app/pages/spec.js', 'app/pages/agents.js', 'app/pages/models.js', 'app/palette.js', 'app/shell.js'];
// Pinned npm dependencies (package.json, exact version), copied from node_modules with their licence; the version is in
// the name, so a new version always gets a new URL. Dagre lays out a spec's ticket graph (AP6).
const npmVendor = { 'app/vendor/dagre-3.1.3.min.js': 'node_modules/@dagrejs/dagre/dist/dagre.min.js', 'app/vendor/dagre-LICENSE.txt': 'node_modules/@dagrejs/dagre/LICENSE' };
const hashed = ['tokens.css', 'site.css', 'site.js', 'faq.js', vendor[0], ...app];
const brand = ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'brand/openwiz-lockup.svg', 'brand/og.png'];
// The app's own mark and icons, cream on charcoal (J194, #1326): the brand mark, its favicons and a Wiz of the family.
const appBrand = ['app/mark.svg', 'app/icon.svg', 'app/icon.ico', 'app/icon-180.png', 'app/wiz-reviewer.svg'];
const files = ['_headers', 'app/manifest.webmanifest', ...appBrand, ...art, ...driverLogos, 'art/spec-demo.webm', 'art/spec-video.mp4', 'art/spec-video.vtt', 'art/spec-poster.webp', ...vendor.slice(1), ...brand, 'fonts/Geist-var.woff2', 'fonts/GeistMono-var.woff2', 'fonts/OFL.txt'];
// The Changelog's release parts (#1364), generated from each release's published notes on GitHub at this build.
// A failed read shows its part as missing; the build never fails on it.
const releases = await readAll();
console.log(`Changelog releases: ${summary(releases)}`);
await rm(output, { recursive: true, force: true });
const put = async (name, data) => {
  const target = new URL(name, output);
  await mkdir(new URL('./', target), { recursive: true });
  await writeFile(target, data);
};
const names = {};
for (const file of hashed) {
  const data = await readFile(new URL(file, root));
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 10);
  names[file] = file.replace(/\.(css|js)$/, `.${hash}.$1`);
  await put(names[file], data);
}
for (const page of pages) {
  let html = await readFile(new URL(page, root), 'utf8');
  for (const [file, name] of Object.entries(names)) html = html.replaceAll(`"/${file}"`, `"/${name}"`);
  if (page !== 'app/index.html') html = withFaq(withFooter(withCta(html)));
  if (page === 'changelog/index.html') html = withReleases(html, render(releases));
  await put(page, html);
}
for (const [file, source] of Object.entries(npmVendor)) await put(file, await readFile(new URL(source, root)));
for (const file of files) {
  await mkdir(new URL('./', new URL(file, output)), { recursive: true });
  await copyFile(new URL(file, root), new URL(file, output));
}
console.log(`Static site: ${pages.length + hashed.length + files.length + Object.keys(npmVendor).length} public files in dist/ (${Object.values(names).join(', ')})`);
