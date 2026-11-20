// FA2 (#1900): the docs index Ask a Wiz answers from. Stub for the red run: builds nothing, checks nothing.
export async function buildIndex() {
  return { schema: 'openwiz.ask-a-wiz.index.v1', sources: [], passages: [] };
}
export function checkIndex() {}
export const serialize = index => JSON.stringify(index);
