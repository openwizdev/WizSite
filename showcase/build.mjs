import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function buildShowcase(put) {
  let html = await readFile(new URL('index.html', import.meta.url), 'utf8');
  for (const file of ['showcase.css', 'showcase.js']) {
    const data = await readFile(new URL(file, import.meta.url));
    const hash = createHash('sha256').update(data).digest('hex').slice(0, 10);
    const name = file.replace('.', `.${hash}.`);
    await put(`showcase/${name}`, data);
    html = html.replace(`"/showcase/${file}"`, `"/showcase/${name}"`);
  }
  await put('showcase/index.html', html);
}
