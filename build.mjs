// A static export: only the reviewed public assets, without a runtime server.
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const output = new URL('dist/', root);
const art = (await readdir(new URL('art/', root))).filter(name => name.endsWith('.webp')).sort().map(name => `art/${name}`);
const files = ['index.html', 'changelog/index.html', 'tokens.css', 'site.css', 'site.js', '_headers', ...art, 'fonts/Geist-var.woff2', 'fonts/GeistMono-var.woff2', 'fonts/OFL.txt'];
await rm(output, { recursive: true, force: true });
for (const file of files) {
  const target = new URL(file, output);
  await mkdir(new URL('./', target), { recursive: true });
  await copyFile(new URL(file, root), target);
}
console.log(`Static site: ${files.length} public files in dist/`);
