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
