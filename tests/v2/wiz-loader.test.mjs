import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SITE, STATE, start } from './browser.mjs';

const DIST = new URL('../../dist/', import.meta.url);
const FLEET = JSON.parse(await readFile(new URL('fixtures/queue/grill-round.json', import.meta.url), 'utf8')).fleet;

async function v2ScriptAsset() {
  const html = await readFile(new URL('app/index.html', DIST), 'utf8');
  const match = html.match(/data-v2-script="([^"]+)"/);
  assert.ok(match, 'dist/app/index.html missing data-v2-script');
  const path = match[1];
  const raw = await readFile(new URL(path.replace(/^\/+/, ''), DIST));
  return { path, raw };
}

async function loaderScriptPath() {
  const html = await readFile(new URL('app/index.html', DIST), 'utf8');
  const match = html.match(/src="(\/wiz-loader\/wiz-loader\.[^"]+\.js)"/);
  assert.ok(match, 'dist/app/index.html missing hashed wiz-loader.js');
  return match[1];
}

test('v2 boot shows the full Wiz loader until data-v2-script loads, with fade-in and no violations', async () => {
  const { path, raw } = await v2ScriptAsset();
  const run = await start();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    run.world.site[path] = async () => {
      await gate;
      return { status: 200, raw, type: 'js' };
    };
    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/welcome`);
    await run.page.until(`Boolean(document.querySelector('#app > .wiz-loader[data-wiz-loader] .wl-sr'))`, 'v2 boot Wiz loader');
    const boot = await run.page.run(`(() => {
      const box = document.querySelector('#app > .wiz-loader[data-wiz-loader]');
      const style = getComputedStyle(box);
      const rect = box.getBoundingClientRect();
      return {
        v2Attr: document.documentElement.dataset.v2 ?? null,
        role: box.getAttribute('role'),
        line: box.querySelector('.wiz-loader-line')?.textContent,
        sr: box.querySelector('.wl-sr')?.textContent,
        wizCount: box.querySelectorAll('.wl-wiz').length,
        animName: style.animationName,
        animDelay: style.animationDelay,
        height: rect.height,
        innerHeight: window.innerHeight,
      };
    })()`);
    assert.equal(boot.v2Attr, null);
    assert.equal(boot.role, 'status');
    assert.equal(boot.line, 'Opening OpenWiz');
    assert.equal(boot.sr, 'Opening OpenWiz');
    assert.equal(boot.wizCount, 1);
    assert.equal(boot.animName, 'wl-show');
    assert.equal(boot.animDelay, '0.35s');
    assert.ok(boot.height >= boot.innerHeight, `expected full-height loader (${boot.height} >= ${boot.innerHeight})`);

    release();
    await run.page.until(`document.documentElement.dataset.v2 === '1' && document.body.innerText.includes('Run your software factory from here.')`, 'v2 welcome after boot');
    assert.equal(await run.page.run(`document.querySelector('.wiz-loader')`), null);
    assert.deepEqual(run.world.violations, []);
  } finally {
    release();
    await run.close();
  }
});

test('v2 Syncing card and Settings first read show the compact Wiz loader while GitHub reads are slow', async () => {
  const run = await start();
  let releaseSpecs;
  const specsGate = new Promise(resolve => { releaseSpecs = resolve; });
  const emptySpecs = {
    data: {
      rateLimit: { limit: 5000, remaining: 4800, resetAt: '2099-01-01T00:00:00Z' },
      specSearch: { totalCount: 0, nodes: [] },
      repository: { issues: { totalCount: 0, nodes: [] }, youIssues: { totalCount: 0, nodes: [] }, fleet: { text: FLEET } },
    },
  };
  try {
    run.world.graphql.Specs = async () => {
      await specsGate;
      return { status: 200, json: emptySpecs };
    };
    run.world.github['GET /repos/acme/factory/pulls'] = () => ({ status: 200, json: [] });

    await run.page.go(`${SITE}/app/?v2=dry-run&code=c0de&state=${STATE}`);
    await run.page.until(`document.body.innerText.includes('acme/factory')`, 'v2 repository picker');
    await run.page.click('acme/factory');

    await run.page.until(`Boolean(document.querySelector('.v2-state-card [data-wiz-loader="compact"] .wl-wiz'))`, 'v2 Syncing card compact loader');
    const syncing = await run.page.run(`(() => {
      const card = document.querySelector('.v2-state-card');
      const loader = card.querySelector('[data-wiz-loader="compact"]');
      const style = getComputedStyle(loader);
      return {
        role: card.getAttribute('role'),
        label: card.querySelector('.v2-label')?.textContent,
        heading: card.querySelector('h2')?.textContent,
        headingClass: card.querySelector('h2')?.className,
        line: loader.querySelector('.wiz-loader-line')?.textContent,
        loaderHidden: loader.getAttribute('aria-hidden'),
        animName: style.animationName,
        animDelay: style.animationDelay,
      };
    })()`);
    assert.equal(syncing.role, 'status');
    assert.equal(syncing.label, 'Syncing');
    assert.equal(syncing.heading, 'Reading GitHub…');
    assert.equal(syncing.headingClass, 'visually-hidden');
    assert.equal(syncing.line, 'Reading GitHub…');
    assert.equal(syncing.loaderHidden, 'true');
    assert.equal(syncing.animName, 'wl-show');
    assert.equal(syncing.animDelay, '0.35s');

    await run.page.click('Settings');
    await run.page.until(`Boolean(document.querySelector('.v2-freshness [data-wiz-loader="compact"] .wl-wiz'))`, 'v2 Settings freshness compact loader');
    const settingsLine = await run.page.run(`document.querySelector('.v2-freshness [data-wiz-loader="compact"] .wiz-loader-line')?.textContent`);
    assert.equal(settingsLine, 'Specs: reading…');

    releaseSpecs();
    await run.page.until(`!document.querySelector('.v2-freshness [data-wiz-loader="compact"]') && document.querySelector('.v2-freshness')?.textContent.includes('Specs read')`, 'Settings freshness after read');
    await run.page.click('Feed');
    await run.page.until(`document.querySelector('.v2-clear-card h2')?.textContent === 'All clear.'`, 'Feed all clear after read');
    assert.deepEqual(run.world.violations, []);
  } finally {
    releaseSpecs();
    await run.close();
  }
});

test('v2 Wiz loader uses a gentle fade under prefers-reduced-motion: reduce', async () => {
  const { path, raw } = await v2ScriptAsset();
  const run = await start();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    await run.page.media([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    run.world.site[path] = async () => {
      await gate;
      return { status: 200, raw, type: 'js' };
    };
    await run.page.go(`${SITE}/app/?v2=dry-run&demo=1#/welcome`);
    await run.page.until(`Boolean(document.querySelector('#app > .wiz-loader[data-wiz-loader] .wl-sr'))`, 'reduced-motion boot loader');
    const reduced = await run.page.run(`(() => {
      const box = document.querySelector('#app > .wiz-loader[data-wiz-loader]');
      return {
        wizAnim: getComputedStyle(box.querySelector('.wl-wiz')).animationName,
        hatAnim: getComputedStyle(box.querySelector('.wl-hat')).animationName,
        showerDisplay: getComputedStyle(box.querySelector('.wl-shower')).display,
      };
    })()`);
    assert.equal(reduced.wizAnim, 'wl-fade');
    assert.equal(reduced.hatAnim, 'none');
    assert.equal(reduced.showerDisplay, 'none');

    release();
    await run.page.until(`document.documentElement.dataset.v2 === '1'`, 'v2 ready after reduced-motion boot');
    assert.deepEqual(run.world.violations, []);
  } finally {
    release();
    await run.close();
  }
});

test('GitHub sign-in falls back to text status and completes when wiz-loader.js returns 404', async () => {
  const loaderPath = await loaderScriptPath();
  const run = await start();
  let releaseToken;
  const tokenGate = new Promise(resolve => { releaseToken = resolve; });
  const baseAnswer = run.world.answer.bind(run.world);
  run.world.answer = async request => {
    if (new URL(request.url).pathname === '/api/sign-in/token') await tokenGate;
    return baseAnswer(request);
  };
  try {
    run.world.site[loaderPath] = () => ({ status: 404, raw: Buffer.from('not found'), type: 'txt' });
    await run.page.go(`${SITE}/app/?v2=dry-run&code=c0de&state=${STATE}`);
    await run.page.until(`document.querySelector('h1')?.textContent === 'Signing in…'`, 'text fallback while signing in', 5000);
    const during = await run.page.run(`({
      loaderType: typeof window.WizLoader,
      hasWizLoader: Boolean(document.querySelector('.wiz-loader')),
      heading: document.querySelector('h1')?.textContent,
      body: document.body.innerText,
    })`);
    assert.equal(during.loaderType, 'undefined');
    assert.equal(during.hasWizLoader, false);
    assert.equal(during.heading, 'Signing in…');
    assert.ok(during.body.includes('Finishing your GitHub sign-in.'));
    assert.deepEqual(run.world.violations, []);

    releaseToken();
    await run.page.until(`document.body.innerText.includes('acme/factory')`, 'v2 repository picker after sign-in without loader', 5000);
    assert.equal(run.world.log.filter(r => r.path === '/api/sign-in/token' && r.method === 'POST').length, 1);
    assert.deepEqual(run.world.violations, []);
  } finally {
    releaseToken();
    await run.close();
  }
});

test('fast repository-switcher reads, mid-read close, and mid-swap removal dispose WizLoader timers without detached DOM mutations', async () => {
  const run = await start();
  let releaseRepos = () => {};
  const emptySpecs = {
    data: {
      rateLimit: { limit: 5000, remaining: 4800, resetAt: '2099-01-01T00:00:00Z' },
      specSearch: { totalCount: 0, nodes: [] },
      repository: { issues: { totalCount: 0, nodes: [] }, youIssues: { totalCount: 0, nodes: [] }, fleet: { text: FLEET } },
    },
  };
  try {
    run.world.graphql.Specs = () => ({ status: 200, json: emptySpecs });
    run.world.github['GET /repos/acme/factory/pulls'] = () => ({ status: 200, json: [] });

    await run.page.go(`${SITE}/app/?v2=dry-run&code=c0de&state=${STATE}`);
    await run.page.until(`document.body.innerText.includes('acme/factory')`, 'v2 repository picker');
    await run.page.click('acme/factory');
    await run.page.until(`document.querySelector('.v2-clear-card h2')?.textContent === 'All clear.'`, 'Feed ready');
    await run.page.click('Settings');
    await run.page.until(`Boolean(document.querySelector('.v2-settings button.repo'))`, 'Settings repo switcher');

    await run.page.run(`(() => {
      const state = { intervals: new Set(), timeouts: new Set(), boxes: [], detachedMutations: 0 };
      let depth = 0;
      const rawSI = window.setInterval.bind(window);
      const rawCI = window.clearInterval.bind(window);
      const rawST = window.setTimeout.bind(window);
      const rawCT = window.clearTimeout.bind(window);
      const wrap = fn => function (...args) {
        depth++;
        try { return fn.apply(this, args); } finally { depth--; }
      };
      window.setInterval = (fn, ms, ...args) => {
        const tracked = depth > 0;
        const id = rawSI(tracked ? wrap(fn) : fn, ms, ...args);
        if (tracked) state.intervals.add(id);
        return id;
      };
      window.clearInterval = id => { state.intervals.delete(id); return rawCI(id); };
      window.setTimeout = (fn, ms, ...args) => {
        const tracked = depth > 0;
        const wrapped = tracked ? function (...a) {
          state.timeouts.delete(id);
          return wrap(fn).apply(this, a);
        } : fn;
        const id = rawST(wrapped, ms, ...args);
        if (tracked) state.timeouts.add(id);
        return id;
      };
      window.clearTimeout = id => { state.timeouts.delete(id); return rawCT(id); };
      const rawMount = window.WizLoader.mount;
      window.WizLoader.mount = (box, options) => {
        const fresh = !box._wl;
        depth++;
        let handle;
        try { handle = rawMount(box, options); } finally { depth--; }
        if (fresh) {
          const observer = new MutationObserver(() => {
            if (!box.isConnected) state.detachedMutations++;
          });
          observer.observe(box, { attributes: true, childList: true, subtree: true, characterData: true });
          state.boxes.push(box);
        }
        return handle;
      };
      window.__wlProbe = state;
    })()`);

    for (let i = 0; i < 3; i++) {
      await run.page.run(`document.querySelector('.v2-settings button.repo').click()`);
      await run.page.until(`Boolean(document.querySelector('.v2-settings .repo-list button[aria-current="true"]'))`, `repo switcher read ${i + 1}`);
      await run.page.run(`document.querySelector('.v2-settings button.repo').click()`);
      await run.page.until(`document.querySelector('.v2-settings .repo-list').hidden`, `repo switcher closed ${i + 1}`);
    }

    const afterQuick = await run.page.run(`({
      mounted: window.__wlProbe.boxes.length,
      connected: window.__wlProbe.boxes.filter(b => b.isConnected).length,
      stillMounted: window.__wlProbe.boxes.filter(b => b._wl).length,
      intervals: window.__wlProbe.intervals.size,
      timeouts: window.__wlProbe.timeouts.size,
    })`);
    assert.equal(afterQuick.mounted, 3);
    assert.equal(afterQuick.connected, 0);
    assert.equal(afterQuick.stillMounted, 0);
    assert.equal(afterQuick.intervals, 0);
    assert.equal(afterQuick.timeouts, 0);

    const repoGate = new Promise(resolve => { releaseRepos = resolve; });
    const baseAnswer = run.world.answer.bind(run.world);
    run.world.answer = async request => {
      if (new URL(request.url).pathname === '/user/installations/1001/repositories') await repoGate;
      return baseAnswer(request);
    };
    await run.page.run(`document.querySelector('.v2-settings button.repo').click()`);
    await run.page.until(`Boolean(document.querySelector('.v2-settings .repo-list [data-wiz-loader="compact"]'))`, 'switcher loader during gated read');
    await run.page.run(`document.querySelector('.v2-settings button.repo').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await run.page.until(`document.querySelector('.v2-settings .repo-list').hidden`, 'switcher closed on Escape');
    const afterClose = await run.page.run(`({
      empty: document.querySelector('.v2-settings .repo-list').children.length === 0,
      intervals: window.__wlProbe.intervals.size,
      timeouts: window.__wlProbe.timeouts.size,
    })`);
    assert.equal(afterClose.empty, true);
    assert.equal(afterClose.intervals, 0);
    assert.equal(afterClose.timeouts, 0);
    releaseRepos();

    await run.page.run(`(() => {
      const box = window.WizLoader.markup(true);
      window.WizLoader.mount(box, { lines: ['First line', 'Second line'] });
      document.body.append(box);
      window.__swapBox = box;
    })()`);
    await run.page.until(`window.__swapBox.querySelector('.wiz-loader-line').classList.contains('wl-out')`, 'pending text swap armed', 4500);
    const duringSwap = await run.page.run(`(() => {
      const before = window.__swapBox.querySelector('.wiz-loader-line').textContent;
      const timeoutsBefore = window.__wlProbe.timeouts.size;
      window.__swapBox.remove();
      return { before, timeoutsBefore };
    })()`);
    assert.equal(duringSwap.timeoutsBefore, 1);

    const afterRemove = await run.page.run(`({
      intervals: window.__wlProbe.intervals.size,
      timeouts: window.__wlProbe.timeouts.size,
      handle: window.__swapBox._wl,
    })`);
    assert.equal(afterRemove.intervals, 0);
    assert.equal(afterRemove.timeouts, 0);
    assert.equal(afterRemove.handle, null);

    await new Promise(resolve => setTimeout(resolve, 500));
    const settled = await run.page.run(`({
      line: window.__swapBox.querySelector('.wiz-loader-line').textContent,
      stillOut: window.__swapBox.querySelector('.wiz-loader-line').classList.contains('wl-out'),
      detachedMutations: window.__wlProbe.detachedMutations,
      intervals: window.__wlProbe.intervals.size,
      timeouts: window.__wlProbe.timeouts.size,
    })`);
    assert.equal(settled.line, duringSwap.before);
    assert.equal(settled.stillOut, true);
    assert.equal(settled.detachedMutations, 0);
    assert.equal(settled.intervals, 0);
    assert.equal(settled.timeouts, 0);
    assert.deepEqual(run.world.violations, []);
  } finally {
    releaseRepos();
    await run.close();
  }
});
