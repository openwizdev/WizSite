// A static export: only the reviewed public assets, without a runtime server. The brand files are the
// logo pack: favicons, the outlined lockup (no live text, no font) and the 1200x630 social card.
// Styles and scripts are fingerprinted (name.<hash>.ext) and both pages are rewritten to use them, so a
// change always gets a new URL: no visitor can pair new HTML with an old cached stylesheet or script.
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('./', import.meta.url);
const output = new URL('dist/', root);
const art = (await readdir(new URL('art/', root))).filter(name => name.endsWith('.webp')).sort().map(name => `art/${name}`);
const pages = ['index.html', 'changelog/index.html', 'app/index.html'];
// The app (openwiz.dev/app): its design system, data layer, page modules and shell, fingerprinted like the site's.
const app = ['app/ember.css', 'app/data.js', 'app/ui.js', 'app/pages/you.js', 'app/pages/specs.js', 'app/pages/agents.js', 'app/shell.js'];
const hashed = ['tokens.css', 'site.css', 'site.js', ...app];
const brand = ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'brand/openwiz-lockup.svg', 'brand/og.png'];
const files = ['_headers', 'app/manifest.webmanifest', ...art, ...brand, 'fonts/Geist-var.woff2', 'fonts/GeistMono-var.woff2', 'fonts/OFL.txt'];
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
  await put(page, html);
}
for (const file of files) {
  await mkdir(new URL('./', new URL(file, output)), { recursive: true });
  await copyFile(new URL(file, root), new URL(file, output));
}
console.log(`Static site: ${pages.length + hashed.length + files.length} public files in dist/ (${Object.values(names).join(', ')})`);
