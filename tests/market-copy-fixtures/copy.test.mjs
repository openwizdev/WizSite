import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { launch, open, SITE } from '../v2/browser.mjs';

const markup = await readFile(new URL('index.html', import.meta.url));
const script = await readFile(new URL('../../market/copy.js', import.meta.url)).catch(error => {
  if (error.code === 'ENOENT') return null;
  throw error;
});

test('Install in Wiz copies the associated text exactly and handles a refused write', async () => {
  const browser = await launch();
  try {
    const page = await open(browser, {
      violations: [],
      async answer({ url }) {
        if (url === SITE + '/clipboard-fixture/') return { status: 200, raw: markup, type: 'html' };
        if (url === SITE + '/market/copy.js' && script) return { status: 200, raw: script, type: 'js' };
        return null;
      },
    });
    try {
      await page.go(SITE + '/clipboard-fixture/');
      await page.until("document.readyState === 'complete' && !!document.getElementById('copy-one')", 'clipboard fixture');
      const result = await page.run(`(async () => {
        const byId = id => document.getElementById(id);
        const statuses = () => ['status-one', 'status-two'].map(id => byId(id).textContent);
        const writes = [];
        const clipboard = { writeText: async text => { writes.push(text); } };
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
        byId('copy-broken').click();
        byId('copy-one').click();
        await Promise.resolve();
        const first = statuses();
        byId('copy-two').click();
        await Promise.resolve();
        const second = statuses();

        let finishEarlierWrite;
        clipboard.writeText = () => new Promise(resolve => { finishEarlierWrite = resolve; });
        byId('copy-two').click();
        const pending = statuses();

        clipboard.writeText = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
        byId('copy-two').focus();
        byId('copy-two').click();
        await Promise.resolve();
        finishEarlierWrite?.();
        await Promise.resolve();
        const refused = statuses();
        const keepsFocus = document.activeElement === byId('copy-two');
        const line = byId('line-two').innerText;
        const selectable = getComputedStyle(byId('line-two')).userSelect !== 'none'
          && byId('line-two').getClientRects().length === 1;

        Object.defineProperty(navigator, 'clipboard', { value: undefined });
        byId('copy-one').click();
        return { writes, first, second, pending, refused, keepsFocus, line, selectable, unavailable: statuses() };
      })()`);
      const paste = 'Paste this into your Wiz chat.';
      const manual = 'Select and copy the install line, then paste it into your Wiz chat.';
      assert.deepEqual(result.writes, [
        ' Wiz, install demo-one  from WizMarket! ',
        "Wiz, install demo:two & 'extras' from WizMarket.",
      ], 'each button must copy its own exact install line');
      assert.deepEqual(result.first, [paste, '']);
      assert.deepEqual(result.second, [paste, paste]);
      assert.deepEqual(result.pending, [paste, '']);
      assert.deepEqual(result.refused, [paste, manual]);
      assert.deepEqual(result.unavailable, [manual, manual]);
      assert.equal(result.line, "Wiz, install demo:two & 'extras' from WizMarket.");
      assert.equal(result.selectable, true);
      assert.equal(result.keepsFocus, true);
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
