import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API, SITE, signIn, start } from './browser.mjs';

test('the harness answers GitHub from recordings, signs in and logs every request', async () => {
  const run = await start();
  try {
    run.world.github['GET /synthetic-probe'] = () => ({ status: 200, json: { recorded: true } });
    await run.page.go(`${SITE}/app/`);
    await run.page.until(`document.readyState === 'complete'`, 'the app page');
    assert.deepEqual(await run.page.run(`fetch('${API}/synthetic-probe').then(r => r.json())`), { recorded: true });
    assert.equal(await run.page.run(`fetch('${API}/not-recorded').then(r => r.status)`), 404);
    await signIn(run.page);
    assert.ok((await run.page.text()).includes('acme/site'));
    assert.ok(run.world.log.some(r => r.path === '/user/installations'), 'the sign-in read was not logged');
    assert.ok(run.world.log.every(r => r.origin === SITE || r.origin === API));
    assert.deepEqual(run.world.writes(), [], 'signing in wrote something');
    assert.deepEqual(run.world.violations, []);
  } finally {
    await run.close();
  }
});
