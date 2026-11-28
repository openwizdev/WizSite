const actions = new Set(['install-copy', 'github', 'star', 'book-call', 'help-setup', 'market', 'drivers', 'docs', 'x']);
const maxBytes = 32;

async function readAction(body) {
  const reader = body.getReader();
  const bytes = new Uint8Array(maxBytes);
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (length + value.byteLength > maxBytes) {
      void reader.cancel().catch(() => {});
      return;
    }
    bytes.set(value, length);
    length += value.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length));
}

export async function onRequest({ request, env }) {
  try {
    const dataset = env?.WIZ_CLICKS;
    if (request.method === 'POST' && request.body && dataset) {
      const action = await readAction(request.body);
      if (actions.has(action)) {
        await dataset.writeDataPoint({ blobs: [action], doubles: [1], indexes: [action] });
      }
    }
  } catch {}
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
