import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, start } from './browser.mjs';

async function attachCdp(browser) {
  const { targetInfos } = await browser.send('Target.getTargets');
  const pageTarget = targetInfos.find(t => t.type === 'page' && t.url.startsWith(SITE));
  assert.ok(pageTarget, 'expected an open page target');
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true });
  return (method, params = {}) => browser.send(method, params, sessionId);
}

async function pressRight(cdp, ...held) {
  const modifiers = held.reduce((m, name) => m | { Alt: 1, Ctrl: 2, Meta: 4, Shift: 8 }[name], 0);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers });
}

async function touchPoint(cdp, x, y, holdMs = 40) {
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await new Promise(resolve => setTimeout(resolve, holdMs));
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await new Promise(resolve => setTimeout(resolve, 60));
}

async function openDemoChat(run) {
  await run.page.go(`${SITE}/app/?v2=on&demo=1#/chat`);
  await run.page.until(`document.readyState === 'complete' && document.querySelector('.v2-composer textarea[data-ghost-ready="1"]')`, 'v2 demo composer with ghost text');
  await run.page.run(`document.fonts.ready`);
  return attachCdp(run.browser);
}

async function clearComposer(page) {
  await page.run(`(() => {
    const ta = document.querySelector('.v2-composer textarea');
    ta.focus();
    ta.value = '';
    ta.setSelectionRange(0, 0);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

const getState = page => page.run(`(() => {
  const ta = document.querySelector('.v2-composer textarea');
  const suffix = document.querySelector('.v2-ghost-suffix')?.textContent || '';
  const hint = document.querySelector('.v2-ghost-hint');
  return {
    value: ta.value,
    caret: [ta.selectionStart, ta.selectionEnd],
    suffix,
    full: ta.value + suffix,
    hintVisible: Boolean(hint && !hint.hidden && getComputedStyle(hint).display !== 'none'),
    composerHeight: document.querySelector('.v2-composer').getBoundingClientRect().height,
    taHeight: ta.getBoundingClientRect().height,
  };
})()`);

test('P3: demo composer shows every recall golden case with zero network requests and steady layout', async () => {
  const run = await start();
  try {
    await openDemoChat(run);
    const beforeRequests = run.world.log.length;
    const base = await getState(run.page);

    const cases = [
      ['J1', 'J1 all recs'],
      ['approve #4', 'approve #42 and merge'],
      ['ship magic', 'ship magic-link sign-in'],
      ['all r', 'all recs'],
      ['the seat bil', 'the seat billing spec'],
      ['zzq', 'zzq'],
    ];

    for (const [typed, expectedFull] of cases) {
      await clearComposer(run.page);
      await run.page.type(typed);
      const state = await getState(run.page);
      assert.equal(state.value, typed, `value after typing "${typed}"`);
      assert.equal(state.full, expectedFull, `recall ghost for "${typed}"`);
      assert.deepEqual(state.caret, [typed.length, typed.length], `caret stayed at end for "${typed}"`);
      assert.equal(state.composerHeight, base.composerHeight, `ghost did not resize composer for "${typed}"`);
      assert.equal(state.taHeight, base.taHeight, `ghost did not resize textarea for "${typed}"`);
    }

    // Ghost text uses ~45% alpha of text colour and no motion.
    await clearComposer(run.page);
    await run.page.type('J1');
    const style = await run.page.run(`(() => {
      const s = getComputedStyle(document.querySelector('.v2-ghost-suffix'));
      return { color: s.color, animationName: s.animationName, transitionProperty: s.transitionProperty };
    })()`);
    assert.match(style.color, /rgba?\([^)]*0\.4[0-9]|color\(srgb[^/]*\/\s*0\.45/, `ghost colour should be ~45% alpha, got ${style.color}`);
    assert.equal(style.animationName, 'none');

    // Zero network requests while typing.
    assert.deepEqual(run.world.log.slice(beforeRequests), [], 'typing in demo composer must make zero network requests');
    assert.deepEqual(run.world.violations, [], 'no CSP or runtime errors');
  } finally {
    await run.close();
  }
});

test('P2: Tab, word accept, Esc, typed-through steadiness, Tab hint limit, Enter, Shift+Tab, empty Tab and IME', async () => {
  const run = await start();
  try {
    const cdp = await openDemoChat(run);
    const beforeRequests = run.world.log.length;

    // 1st ghost: Tab hint visible; Tab accepts all.
    await clearComposer(run.page);
    await run.page.type('J1');
    let state = await getState(run.page);
    assert.equal(state.suffix, ' all recs');
    assert.equal(state.hintVisible, true, 'Tab hint visible on 1st ghost');
    await run.page.key('Tab');
    state = await getState(run.page);
    assert.equal(state.value, 'J1 all recs');
    assert.equal(state.suffix, '');
    assert.deepEqual(state.caret, [11, 11]);

    // Enter still sends the message.
    await run.page.key('Enter');
    await run.page.until(`document.querySelector('.v2-chat-thread').textContent.includes('J1 all recs')`, 'Enter submits message');
    state = await getState(run.page);
    assert.equal(state.value, '');

    // 2nd ghost: Tab hint visible; ArrowRight, Ctrl+ArrowRight, Alt+ArrowRight accept one word each.
    await run.page.type('approve #4');
    state = await getState(run.page);
    assert.equal(state.suffix, '2 and merge');
    assert.equal(state.hintVisible, true, 'Tab hint visible on 2nd ghost');
    await pressRight(cdp);
    state = await getState(run.page);
    assert.equal(state.value, 'approve #42');
    assert.equal(state.suffix, ' and merge');
    await pressRight(cdp, 'Ctrl');
    state = await getState(run.page);
    assert.equal(state.value, 'approve #42 and');
    assert.equal(state.suffix, ' merge');
    await pressRight(cdp, 'Alt');
    state = await getState(run.page);
    assert.equal(state.value, 'approve #42 and merge');
    assert.equal(state.suffix, '');

    // 3rd ghost: Tab hint visible; typing through consumes ghost without swapping.
    await clearComposer(run.page);
    await run.page.type('approve #4');
    state = await getState(run.page);
    assert.equal(state.suffix, '2 and merge');
    assert.equal(state.hintVisible, true, 'Tab hint visible on 3rd ghost');
    await run.page.type('2');
    state = await getState(run.page);
    assert.equal(state.value, 'approve #42');
    assert.equal(state.suffix, ' and merge');
    await run.page.type(' a');
    state = await getState(run.page);
    assert.equal(state.value, 'approve #42 a');
    assert.equal(state.suffix, 'nd merge');

    // 4th ghost: Tab hint must NOT appear after the first three ghosts.
    await clearComposer(run.page);
    await run.page.type('ship magic');
    state = await getState(run.page);
    assert.equal(state.suffix, '-link sign-in');
    assert.equal(state.hintVisible, false, 'Tab hint hidden on 4th ghost');

    // Esc dismisses until the next word.
    await clearComposer(run.page);
    await run.page.type('all r');
    state = await getState(run.page);
    assert.equal(state.suffix, 'ecs');
    await run.page.key('Escape');
    state = await getState(run.page);
    assert.equal(state.suffix, '');
    await run.page.type('e');
    state = await getState(run.page);
    assert.equal(state.suffix, '', 'stays dismissed within same word');
    await run.page.type(' J1');
    state = await getState(run.page);
    assert.equal(state.suffix, ' all recs', 'ghost returns on next word');

    // Shift+Tab is untouched (does not accept ghost, moves focus).
    await clearComposer(run.page);
    await run.page.type('J1');
    await run.page.key('Tab', 'Shift');
    state = await getState(run.page);
    assert.equal(state.value, 'J1', 'Shift+Tab must not accept ghost');
    assert.equal(await run.page.run(`document.activeElement !== document.querySelector('.v2-composer textarea')`), true, 'Shift+Tab moves focus');

    // Tab with no ghost moves focus normally.
    await clearComposer(run.page);
    await run.page.type('zzq');
    await run.page.key('Tab');
    assert.equal(await run.page.run(`document.activeElement === document.querySelector('.v2-send-btn')`), true, 'Tab with no ghost moves focus to send button');

    // IME composition is untouched.
    await clearComposer(run.page);
    await run.page.run(`(() => {
      const ta = document.querySelector('.v2-composer textarea');
      ta.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      ta.value = 'J1';
      ta.setSelectionRange(2, 2);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    state = await getState(run.page);
    assert.equal(state.suffix, '', 'no ghost during IME composition');
    await run.page.run(`(() => {
      const ta = document.querySelector('.v2-composer textarea');
      ta.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'J1' }));
    })()`);
    state = await getState(run.page);
    assert.equal(state.suffix, ' all recs', 'ghost resumes after IME composition ends');

    assert.deepEqual(run.world.log.slice(beforeRequests), [], 'zero network requests during key interactions');
    assert.deepEqual(run.world.violations, [], 'no CSP or runtime errors');
  } finally {
    await run.close();
  }
});

test('P2 phone touch: tap ghost accepts next word, long-press accepts all', async () => {
  const run = await start();
  try {
    await run.page.size(390, 844, true);
    const cdp = await openDemoChat(run);
    const beforeRequests = run.world.log.length;

    await clearComposer(run.page);
    await run.page.type('approve #4');
    let state = await getState(run.page);
    assert.equal(state.suffix, '2 and merge');

    const point = () => run.page.run(`(() => {
      const r = document.querySelector('.v2-ghost-suffix').getBoundingClientRect();
      return { x: r.left + Math.min(12, r.width / 2), y: r.top + r.height / 2 };
    })()`);

    // Short tap accepts next word.
    let pt = await point();
    await touchPoint(cdp, pt.x, pt.y, 40);
    state = await getState(run.page);
    assert.equal(state.value, 'approve #42');
    assert.equal(state.suffix, ' and merge');

    // Long press accepts all remaining ghost.
    pt = await point();
    await touchPoint(cdp, pt.x, pt.y, 550);
    state = await getState(run.page);
    assert.equal(state.value, 'approve #42 and merge');
    assert.equal(state.suffix, '');

    assert.deepEqual(run.world.log.slice(beforeRequests), [], 'zero network requests during touch interactions');
    assert.deepEqual(run.world.violations, [], 'no CSP or runtime errors');
  } finally {
    await run.close();
  }
});
