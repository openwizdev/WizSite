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
    run.world.record({ 'GET /repos/acme/factory/pulls?state=open&per_page=100&page=1': { status: 200, json: [{ number: 7 }] } });
    assert.deepEqual(await run.page.run(`fetch('${API}/repos/acme/factory/pulls?state=open&per_page=100&page=1').then(r => r.json())`), [{ number: 7 }]);
    assert.equal(await run.page.run(`fetch('${API}/repos/acme/factory/pulls?state=open&per_page=100&page=2').then(r => r.status)`), 404);
    await run.page.run(`(() => { const b = document.createElement('button'); b.textContent = 'Synthetic tap';
      b.onclick = e => { window.tapped = e.isTrusted; }; document.body.prepend(b); })()`);
    await run.page.click('Synthetic tap');
    assert.equal(await run.page.run('window.tapped'), false, 'page.click is not a trusted event');
    await run.page.tap('Synthetic tap');
    assert.equal(await run.page.run('window.tapped'), true, 'page.tap is a trusted event');
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
