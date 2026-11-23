import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { installSwitch, readReleases, render, summary, withReleases } from './scripts/changelog.mjs';

const root = new URL('./', import.meta.url);
const output = new URL('dist/', root);
const vendor = ['vendor/gsap-3.15.1.min.js', 'vendor/GSAP-LICENSE.txt', 'vendor/LOBE-ICONS-LICENSE.txt', 'vendor/LUCIDE-LICENSE.txt'];
const art = (await readdir(new URL('art/', root))).filter(name => name.endsWith('.webp')).sort().map(name => `art/${name}`);
const driverLogos = ['drivers/logos/boat-dev.svg', 'drivers/logos/cloudroom.png', 'drivers/logos/monitor.svg', 'drivers/logos/bot.svg'];
const pages = ['index.html', 'changelog/index.html', 'drivers/index.html', 'team/index.html', 'faq/index.html', 'app/index.html'];
const cta = await readFile(new URL('header-cta.html', root), 'utf8');
const withCta = html => {
  const bar = '  </nav>\n</header>';
  if (html.split(bar).length !== 2) throw new Error('a site page needs exactly one top bar');
  return html.replace(bar, cta + bar);
};
const footer = await readFile(new URL('footer.html', root), 'utf8');
const withFooter = html => {
  const slot = '<template data-slot="footer"></template>\n';
  if (html.split(slot).length !== 2) throw new Error('a site page needs exactly one footer slot');
  return html.replace(slot, footer);
};
const faq = await readFile(new URL('faq.html', root), 'utf8');
const faqTop = faq.replace(/<(\/?)h2\b/g, '<$1h1').replace(/<(\/?)h3\b/g, '<$1h2');
const withFaq = html => html.replace('<template data-slot="faq"></template>\n', faq).replace('<template data-slot="faq-h1"></template>\n', faqTop);
const app = ['app/ember.css', 'app/data.js', 'app/records.js', 'app/ui.js', 'app/pages/you.js', 'app/pages/specs.js', 'app/pages/spec.js', 'app/pages/agents.js', 'app/palette.js', 'app/shell.js'];
const npmVendor = { 'app/vendor/dagre-3.1.3.min.js': 'node_modules/@dagrejs/dagre/dist/dagre.min.js', 'app/vendor/dagre-LICENSE.txt': 'node_modules/@dagrejs/dagre/LICENSE' };
const hashed = ['tokens.css', 'site.css', 'site.js', 'faq.js', vendor[0], ...app];
const brand = ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'brand/openwiz-lockup.svg', 'brand/og.png'];
const appBrand = ['app/mark.svg', 'app/icon.svg', 'app/icon.ico', 'app/icon-180.png', 'app/wiz-reviewer.svg'];
const files = ['_headers', 'app/manifest.webmanifest', ...appBrand, ...art, ...driverLogos, 'art/todo-spec.mp4', 'art/todo-spec.vtt', 'art/spec-video.mp4', 'art/spec-video.vtt', ...vendor.slice(1), ...brand, 'fonts/Geist-var.woff2', 'fonts/GeistMono-var.woff2', 'fonts/OFL.txt'];
const releases = await readReleases();
const live = installSwitch(await readFile(new URL('index.html', root), 'utf8')) === 'live';
console.log(`Changelog releases: ${summary(releases, live)}`);
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
  if (page === 'changelog/index.html') html = withReleases(html, render(releases, live));
  await put(page, html);
}
await put('ask-index.json', await (await import('./scripts/ask-index.mjs')).snapshotIndex(output, new URL('ask-docs/', root)));
for (const [file, source] of Object.entries(npmVendor)) await put(file, await readFile(new URL(source, root)));
for (const file of files) {
  await mkdir(new URL('./', new URL(file, output)), { recursive: true });
  await copyFile(new URL(file, root), new URL(file, output));
}
console.log(`Static site: ${pages.length + hashed.length + files.length + Object.keys(npmVendor).length} public files in dist/ (${Object.values(names).join(', ')})`);
