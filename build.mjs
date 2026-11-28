import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { installSwitch, readReleases, render, summary, withReleases } from './scripts/changelog.mjs';
import { readRegistry, render as renderMarket, summary as marketSummary, withMarket } from './scripts/market.mjs';
import { readReach, render as renderReach, summary as reachSummary, withReach } from './scripts/reach.mjs';
import { withDrivers } from './scripts/drivers.mjs';
import { aboutPage, crawlerFiles, guidePage, withMetadata } from './scripts/discovery.mjs';
import { withCheckout } from './scripts/pricing.mjs';
import { pageFile, siteRegistry } from './scripts/registry.mjs';
import { sitemapFiles } from './scripts/sitemap.mjs';

const root = new URL('./', import.meta.url);
const output = new URL('dist/', root);
const pageRegistry = siteRegistry();
const vendor = ['vendor/gsap-3.15.1.min.js', 'vendor/GSAP-LICENSE.txt', 'vendor/LOBE-ICONS-LICENSE.txt', 'vendor/LUCIDE-LICENSE.txt'];
const art = (await readdir(new URL('art/', root))).filter(name => /\.(webp|avif)$/.test(name)).sort().map(name => `art/${name}`);
const driverLogos = ['drivers/logos/boat-dev.svg', 'drivers/logos/cloudroom.png', 'drivers/logos/monitor.svg', 'drivers/logos/amp.svg', 'drivers/logos/antigravity.svg', 'drivers/logos/augment.svg', 'drivers/logos/capy.svg', 'drivers/logos/cline.svg', 'drivers/logos/conductor.svg', 'drivers/logos/crush.png', 'drivers/logos/cursor.svg', 'drivers/logos/devin.svg', 'drivers/logos/factory.svg', 'drivers/logos/gemini-cli.svg', 'drivers/logos/goose.png', 'drivers/logos/hermes.png', 'drivers/logos/kilo-code.svg', 'drivers/logos/kimi-code.svg', 'drivers/logos/kiro.svg', 'drivers/logos/ona.svg', 'drivers/logos/openclaw.svg', 'drivers/logos/opencode.svg', 'drivers/logos/openhands.svg', 'drivers/logos/pane.svg', 'drivers/logos/pi.svg', 'drivers/logos/qwen-code.svg', 'drivers/logos/sculptor.svg', 'drivers/logos/tembo.svg', 'drivers/logos/warp.svg'];
const landing = await readFile(new URL('index.html', root), 'utf8');
const topBar = landing.match(/<header class="landing-nav [^"]*">[\s\S]*?<\/header>/)[0];
const live = installSwitch(landing) === 'live';
const install = live ? 'Paste this line into your coding agent.' : 'Public installation is coming soon. This is the line to paste into your coding agent when it is available.';
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
const appFolder = async folder => (await readdir(new URL(`${folder}/`, root)).catch(() => [])).filter(name => /\.(js|css)$/.test(name)).sort().map(name => `${folder}/${name}`);
const app = ['app/ember.css', 'app/data.js', 'app/records.js', 'app/ui.js', ...await appFolder('app/pages'), ...await appFolder('app/cards'), 'app/palette.js', 'app/shell.js'];
const npmHashed = { 'vendor/gsap-3.15.1.min.js': 'node_modules/gsap/dist/gsap.min.js' };
const npmVendor = { 'app/vendor/dagre-3.1.3.min.js': 'node_modules/@dagrejs/dagre/dist/dagre.min.js', 'app/vendor/dagre-LICENSE.txt': 'node_modules/@dagrejs/dagre/LICENSE' };
const fonts = ['fonts/Geist-var.woff2', 'fonts/GeistMono-var.woff2'];
const loader = ['wiz-loader/wiz-loader.css', 'wiz-loader/wiz-loader.js'];
const hashed = ['tokens.css', 'site.css', 'changelog/changelog.css', 'market/market.css', ...loader, 'site.js', 'faq.js', vendor[0], ...app];
const brand = ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'brand/openwiz-lockup.svg', 'brand/og.png'];
const appBrand = ['app/mark.svg', 'app/icon.svg', 'app/icon.ico', 'app/icon-180.png', 'app/icon-light.svg', 'app/icon-light-180.png', 'app/icon-light-192.png', 'app/icon-light-512.png', 'app/wiz-reviewer.svg'];
const files = ['_headers', '.well-known/security.txt', 'SKILL.md', 'c76a1a01e62d088edd3789d30d6a4d29.txt', 'app/manifest.webmanifest', ...appBrand, ...art, ...driverLogos, 'art/todo-spec.mp4', 'art/todo-spec.vtt', 'art/launch-video.mp4', 'art/launch-video.vtt', ...vendor.slice(1), ...brand, 'fonts/OFL.txt'];
const releases = await readReleases();
console.log(`Changelog releases: ${summary(releases, live)}`);
const registry = await readRegistry();
console.log(`Market: ${marketSummary(registry)}`);
const reach = await readReach();
console.log(`Reach: ${reachSummary(reach)}`);
await rm(output, { recursive: true, force: true });
const put = async (name, data) => {
  const target = new URL(name, output);
  await mkdir(new URL('./', target), { recursive: true });
  await writeFile(target, data);
};
const names = {};
for (const file of fonts) {
  const data = await readFile(new URL(file, root));
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 10);
  names[file] = file.replace(/\.woff2$/, `.${hash}.woff2`);
  await put(names[file], data);
}
for (const file of hashed) {
  let data = await readFile(new URL(npmHashed[file] ?? file, root));
  if (file.endsWith('.css')) {
    let text = data.toString('utf8');
    for (const font of fonts) text = text.replaceAll(`'/${font}'`, `'/${names[font]}'`).replaceAll(`"/${font}"`, `"/${names[font]}"`);
    data = Buffer.from(text, 'utf8');
  }
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 10);
  names[file] = file.replace(/\.(css|js)$/, `.${hash}.$1`);
  await put(names[file], data);
}
let about, guide;
const pages = [...pageRegistry.values()];
for (const entry of pages) {
  const page = pageFile(entry.path);
  let html = await readFile(new URL(page, root), 'utf8');
  if (page === aboutPage || page === guidePage || page === '404.html') {
    html = html.replace('<template data-slot="top-bar"></template>', () => topBar);
  }
  if (page === guidePage) guide = html;
  if (page === aboutPage) {
    html = html.replace('<template data-slot="install-instructions"></template>', `<p>${install}</p>`);
    about = html;
  }
  html = withMetadata(page, entry, html, faq);
  for (const [file, name] of Object.entries(names)) html = html.replaceAll(`"/${file}"`, `"/${name}"`);
  if (page !== 'app/index.html') html = withFaq(withFooter(withCta(html)));
  if (page === 'index.html') html = withReach(html, renderReach(reach, registry));
  if (page === 'changelog/index.html') html = withReleases(html, render(releases, live));
  if (page === 'market/index.html') html = withMarket(html, renderMarket(registry));
  if (page === 'drivers/index.html') html = withDrivers(html, registry);
  if (page === 'pricing/index.html') html = withCheckout(html);
  await put(page, html);
}
const discovery = { ...crawlerFiles(about, faq, guide), ...sitemapFiles(pageRegistry) };
for (const [file, data] of Object.entries(discovery)) await put(file, data);
await put('ask-index.json', await (await import('./scripts/ask-index.mjs')).snapshotIndex(output, new URL('ask-docs/', root)));
for (const [file, source] of Object.entries(npmVendor)) await put(file, await readFile(new URL(source, root)));
for (const file of files) {
  await mkdir(new URL('./', new URL(file, output)), { recursive: true });
  await copyFile(new URL(file, root), new URL(file, output));
}
execFileSync('python3', ['-B', 'scripts/check.py', '--discovery-only'], { cwd: root, stdio: 'inherit' });
console.log(`Static site: ${pages.length + fonts.length + hashed.length + files.length + Object.keys(npmVendor).length + Object.keys(discovery).length + 1} public files in dist/ (${Object.values(names).join(', ')})`);
