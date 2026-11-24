import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { handle as slotsHandle } from '../functions/api/book/slots.js';
import { handle as bookHandle } from '../functions/api/book/index.js';
import { handle as cancelHandle } from '../functions/api/book/cancel.js';
import { handle as feedHandle } from '../functions/api/book/feed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.join(ROOT, 'dist');
const HOST = '127.0.0.1';
const DEFAULT_PORT = 8801;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.vtt': 'text/vtt; charset=utf-8',
};

function parsePort(argv) {
  let port = DEFAULT_PORT;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' && i + 1 < argv.length) {
      port = Number(argv[++i]);
    } else if (arg.startsWith('--port=')) {
      port = Number(arg.slice(7));
    }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}`);
  }
  return port;
}

function createMemoryD1() {
  const db = new DatabaseSync(':memory:');
  const exec = (sql, values) => {
    const stmt = db.prepare(sql);
    return stmt.columns().length ? stmt.all(...values).map(row => ({ ...row })) : (stmt.run(...values), []);
  };
  const statement = (sql, values = []) => ({
    sql,
    values,
    bind: (...more) => statement(sql, more),
    all: async () => ({ success: true, results: exec(sql, values), meta: {} }),
    first: async column => {
      const row = exec(sql, values)[0] ?? null;
      return column && row ? row[column] : row;
    },
    run: async () => ({ success: true, results: exec(sql, values), meta: {} }),
  });
  return {
    prepare: sql => statement(sql),
    batch: async statements => {
      db.exec('BEGIN');
      try {
        const out = statements.map(s => ({ success: true, results: exec(s.sql, s.values), meta: {} }));
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    exec: async sql => {
      db.exec(sql);
      return { count: 1 };
    },
  };
}

async function readNodeBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function toFetchRequest(req, port) {
  const host = req.headers.host || `${HOST}:${port}`;
  const url = `http://${host}${req.url || '/'}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) headers.append(k, item);
    } else {
      headers.set(k, v);
    }
  }
  if (!headers.has('CF-Connecting-IP')) {
    headers.set('CF-Connecting-IP', req.socket.remoteAddress || HOST);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const body = hasBody ? await readNodeBody(req) : undefined;
  return new Request(url, { method: req.method, headers, body });
}

async function writeFetchResponse(res, response) {
  const headers = {};
  for (const [k, v] of response.headers.entries()) headers[k] = v;
  res.writeHead(response.status, headers);
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}

async function serveStatic(pathname, res) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }
  const candidate = path.resolve(DIST_DIR, `.${decoded}`);
  if (candidate !== DIST_DIR && !candidate.startsWith(`${DIST_DIR}${path.sep}`)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  let target = candidate;
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = path.join(target, 'index.html');
    const data = await readFile(target);
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}

const port = parsePort(process.argv.slice(2));
const env = {
  ...process.env,
  BOOK_MODE: process.env.BOOK_MODE || 'fake',
  BOOK_DB: createMemoryD1(),
};

const ROUTES = new Map([
  ['/api/book/slots', slotsHandle],
  ['/api/book', bookHandle],
  ['/api/book/', bookHandle],
  ['/api/book/cancel', cancelHandle],
  ['/api/book/feed', feedHandle],
]);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${HOST}:${port}`);
    const handler = ROUTES.get(url.pathname);
    if (handler) {
      const fetchReq = await toFetchRequest(req, port);
      const response = await handler(fetchReq, env);
      await writeFetchResponse(res, response);
      return;
    }
    await serveStatic(url.pathname, res);
  } catch {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'unavailable', message: 'Internal error.' }));
  }
});

server.listen(port, HOST, () => {
  process.stdout.write(`book-dev listening on http://${HOST}:${port} (BOOK_MODE=${env.BOOK_MODE})\n`);
});
