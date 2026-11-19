// The changelog generator (#1364). Stub before the build: it renders nothing yet.
import { readFile } from 'node:fs/promises';
const args = process.argv.slice(2);
const page = args.find((a, i) => i % 2 === 0 && !a.startsWith('--') && args[i - 1] !== '--fixtures');
process.stdout.write(page ? await readFile(page, 'utf8') : '');
