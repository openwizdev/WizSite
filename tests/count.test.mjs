import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest } from '../functions/api/count.js';

const url = 'https://example.test/api/count';
const actions = ['install-copy', 'github', 'star', 'book-call', 'market', 'drivers', 'docs', 'x'];
const request = (body, init = {}) => new Request(url, { method: 'POST', body, ...init });

function emptyResponse(response) {
  assert.equal(response.status, 204);
  assert.equal(response.body, null);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.has('Set-Cookie'), false);
}

function recorder() {
  const calls = [];
  return { calls, env: { WIZ_CLICKS: { writeDataPoint: (...args) => calls.push(args) } } };
}

test('writes exactly one action and a count for each allowed body', async () => {
  const { calls, env } = recorder();
  for (const action of actions) {
    emptyResponse(await onRequest({
      request: request(action, { headers: {
        'User-Agent': 'test browser', Referer: 'https://example.test/',
        'CF-Connecting-IP': '192.0.2.1', 'CF-IPCountry': 'XX', Cookie: 'test=value',
      } }),
      env,
    }));
  }
  assert.deepEqual(calls, actions.map(action => [{ blobs: [action], doubles: [1], indexes: [action] }]));
});

test('ignores unknown, malformed, oversized, and missing bodies', async () => {
  const { calls, env } = recorder();
  for (const body of [null, '', 'unknown', 'Github', 'github ', 'github\n', '\ufeffstar',
    '"star"', 'star=1', 'a'.repeat(33), 'é'.repeat(17), Uint8Array.of(0xff)]) {
    emptyResponse(await onRequest({ request: request(body), env }));
  }
  assert.deepEqual(calls, []);
});

test('limits streamed bodies without relying on Content-Length', async () => {
  const { calls, env } = recorder();
  const encode = new TextEncoder();
  const stream = chunks => new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encode.encode(chunk));
      controller.close();
    },
  });
  emptyResponse(await onRequest({ request: request(stream(['git', 'hub']), { duplex: 'half' }), env }));
  emptyResponse(await onRequest({
    request: request(stream(['github', 'x'.repeat(27)]), { duplex: 'half', headers: { 'Content-Length': '6' } }),
    env,
  }));
  assert.deepEqual(calls, [[{ blobs: ['github'], doubles: [1], indexes: ['github'] }]]);
});

test('ignores every non-POST method', async () => {
  const { calls, env } = recorder();
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE']) {
    const body = ['GET', 'HEAD'].includes(method) ? undefined : 'star';
    emptyResponse(await onRequest({ request: request(body, { method }), env }));
  }
  assert.deepEqual(calls, []);
});

test('returns the same response with no binding, a failing binding, or an unreadable body', async () => {
  for (const env of [undefined, {}, { WIZ_CLICKS: {} },
    { WIZ_CLICKS: { writeDataPoint() { throw new Error('unavailable'); } } },
    { WIZ_CLICKS: { async writeDataPoint() { throw new Error('unavailable'); } } }]) {
    emptyResponse(await onRequest({ request: request('star'), env }));
  }
  const { calls, env } = recorder();
  const consumed = request('star');
  await consumed.text();
  emptyResponse(await onRequest({ request: consumed, env }));
  assert.deepEqual(calls, []);
});
