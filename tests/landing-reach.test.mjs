import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collect } from '../scripts/landing-sync.mjs';
import { LOGOS, groups, parse, readReach, render } from '../scripts/reach.mjs';
import { readRegistry } from '../scripts/market.mjs';

const ROOT = new URL('../', import.meta.url);

test('rendered reach section matches landing/reach.json snapshot and logo rules', async () => {
  const reach = await readReach();
  const registry = await readRegistry();
  const html = render(reach, registry);
  const { agents, hosts, coming } = groups(reach);

  assert.equal(agents.length, 14);
  assert.equal(hosts.length, 7);
  assert.ok(coming.length > 0);

  // Every item in the snapshot renders with its exact name and data-reach key.
  for (const item of reach.items) {
    assert.ok(html.includes(`data-reach="${item.kind}:${item.id}"`), `missing ${item.kind}:${item.id}`);
    assert.ok(html.includes(item.name), `missing name ${item.name}`);
  }

  // No harness or host on main ever shows as coming.
  const todayKeys = new Set(reach.items.filter(i => i.tier === 'today').map(i => `${i.kind}:${i.id}`));
  for (const item of coming) {
    assert.ok(!todayKeys.has(`${item.kind}:${item.id}`), `${item.kind}:${item.id} is both today and coming`);
  }

  // Sprites and Codespaces are coming (README only on main, no driver file).
  assert.ok(!todayKeys.has('host:sprites'));
  assert.ok(!todayKeys.has('host:codespaces'));
  assert.ok(coming.some(i => i.kind === 'host' && i.id === 'sprites'));
  assert.ok(coming.some(i => i.kind === 'host' && i.id === 'codespaces'));

  // Every <img> is a lazy SVG from /drivers/logos/ with explicit dimensions.
  const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map(m => m[0]);
  assert.equal(imgs.length, Object.keys(LOGOS).length);
  for (const img of imgs) {
    assert.match(img, /\bloading="lazy"/);
    assert.match(img, /\bdecoding="async"/);
    assert.match(img, /\bwidth="18"/);
    assert.match(img, /\bheight="18"/);
    const src = img.match(/\bsrc="([^"]+)"/)?.[1];
    assert.match(src ?? '', /^\/drivers\/logos\/[a-z0-9-]+\.svg$/);
    assert.ok(existsSync(new URL(src.slice(1), ROOT)), `missing logo file ${src}`);
  }
});

test('parse refuses a harness or host that is both today and coming', () => {
  const base = {
    openwiz: { commit: 'a'.repeat(40), date: '2026-11-25' },
    synced: '2026-11-25',
    items: [
      { id: 'claude', name: 'Claude Code', kind: 'agent', tier: 'today' },
      { id: 'claude', name: 'Claude Code', kind: 'agent', tier: 'coming', prs: [{ number: 1, url: 'https://github.com/openwizdev/OpenWiz/pull/1' }] },
    ],
  };
  assert.throws(() => parse(base), /bad or repeated item|cannot be coming/);
});

test('collect excludes main items from coming and requires a driver file for today hosts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openwiz-sync-test-'));
  try {
    mkdirSync(join(dir, 'adapters/local/harnesses/amp'), { recursive: true });
    writeFileSync(join(dir, 'adapters/local/harnesses/amp/row.json'), '{"id":"amp"}\n');
    mkdirSync(join(dir, 'adapters/local'), { recursive: true });
    writeFileSync(join(dir, 'adapters/local/driver'), '#!/bin/sh\n');
    mkdirSync(join(dir, 'adapters/sprites'), { recursive: true });
    writeFileSync(join(dir, 'adapters/sprites/README.md'), '# Sprites\n');

    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@example.com', 'add', '.'], { cwd: dir });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@example.com', 'commit', '-qm', 'init'], { cwd: dir });

    const prs = [
      { number: 100, title: 'Amp tweak', url: 'https://github.com/openwizdev/OpenWiz/pull/100', headRefName: 'amp', files: [{ path: 'adapters/local/harnesses/amp/row.json' }] },
      { number: 101, title: 'OpenCode', url: 'https://github.com/openwizdev/OpenWiz/pull/101', headRefName: 'opencode', files: [{ path: 'adapters/local/harnesses/opencode/row.json' }] },
      { number: 102, title: 'Sprites driver', url: 'https://github.com/openwizdev/OpenWiz/pull/102', headRefName: 'sprites', files: [{ path: 'adapters/sprites/driver' }] },
    ];
    const reach = collect(dir, prs);
    const key = i => `${i.tier}:${i.kind}:${i.id}`;
    const keys = new Set(reach.items.map(key));

    assert.ok(keys.has('today:agent:amp'));
    assert.ok(!keys.has('coming:agent:amp'), 'amp is on main, must not be coming');
    assert.ok(keys.has('coming:agent:opencode'));
    assert.ok(!keys.has('today:host:sprites'), 'sprites has no driver file on main');
    assert.ok(keys.has('coming:host:sprites'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('render handles empty and non-empty WizMarket registry counts', async () => {
  const reach = await readReach();
  const emptyHtml = render(reach, { listings: [] });
  assert.ok(emptyHtml.includes('Browse WizMarket'));
  assert.ok(!emptyHtml.includes('on WizMarket'));

  const fullHtml = render(reach, { listings: new Array(42).fill({}) });
  assert.ok(fullHtml.includes('<strong>42</strong> on WizMarket'));
  assert.ok(fullHtml.includes('+42 more on WizMarket'));
});

test('built dist/index.html contains all snapshot names when dist exists', async () => {
  const distIndex = new URL('dist/index.html', ROOT);
  if (!existsSync(distIndex)) return;
  const html = readFileSync(distIndex, 'utf8');
  const reach = await readReach();
  for (const item of reach.items) {
    assert.ok(html.includes(`data-reach="${item.kind}:${item.id}"`), `dist/index.html missing ${item.kind}:${item.id}`);
  }
});
