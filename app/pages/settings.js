'use strict';
(() => {
  const { h, icon, time } = OW.ui;

  function row(label, value, detail) {
    if (!detail) return h('div', { class: 'v2-setting-row' }, h('strong', {}, label), value);
    return h('details', { class: 'v2-setting' },
      h('summary', { class: 'v2-setting-row' }, h('strong', {}, label), value, icon('chevron')),
      h('div', { class: 'v2-setting-detail' }, detail));
  }

  function button(text, onclick) {
    return h('button', { type: 'button', class: 'v2-btn', onclick }, text);
  }

  function setting(text, current, apply) {
    return h('label', { class: 'v2-check-row' },
      h('span', {}, text),
      h('input', { type: 'checkbox', checked: current, onchange: e => apply(e.target.checked) }));
  }

  function connection(name, connected) {
    return h('div', { class: 'v2-connection' }, h('strong', {}, name),
      h('span', { class: `v2-conn-pill${connected ? ' connected' : ''}` }, connected ? 'Connected' : 'Not connected'));
  }

  function demoSettings() {
    const { state } = OW.demo;
    const s = state.settings;
    const hostValue = h('span', {}, s.hosts.filter(host => host.enabled).map(host => host.name).join(', ') || 'No host selected');
    const effortValue = h('span', { class: 'v2-capitalize' }, s.effort);
    const capValue = h('span', {}, `$${s.dailyCap} / day`);
    const cap = (label, key, min, max, step, unit) => {
      const output = h('strong', { class: 'v2-mono' }, `$${s[key]} / ${unit}`);
      const input = h('input', {
        type: 'range', min, max, step, value: s[key],
        oninput: event => {
          s[key] = Number(event.target.value);
          output.textContent = `$${s[key]} / ${unit}`;
          capValue.textContent = `$${s.dailyCap} / day`;
        },
      });
      return h('label', { class: 'v2-budget-cap' }, h('span', {}, label, output), input);
    };
    const effort = h('fieldset', { class: 'v2-segmented' },
      h('legend', { class: 'visually-hidden' }, 'Effort'),
      ['Fast', 'Balanced', 'Thorough'].map(label => h('label', {},
        h('input', {
          type: 'radio', name: 'effort', value: label.toLowerCase(), checked: label.toLowerCase() === s.effort,
          onchange: e => { s.effort = e.target.value; effortValue.textContent = label; },
        }), h('span', {}, label))));
    return [
      row('Where it runs', hostValue, s.hosts.map(host => setting(host.name, host.enabled, enabled => {
        host.enabled = enabled;
        hostValue.textContent = s.hosts.filter(item => item.enabled).map(item => item.name).join(', ') || 'No host selected';
      }))),
      row('Effort', effortValue, effort),
      row('Models', h('span', {}, 'Recommended')),
      row('Connections', h('span', { class: 'v2-conn-pill connected' }, 'GitHub connected'),
        s.connections.map(conn => connection(conn.name, conn.connected))),
      row('Budget', capValue, [
        h('p', { class: 'v2-muted' }, `$${s.spendToday.toFixed(2)} spent today`),
        cap('Daily cap', 'dailyCap', 5, 100, 5, 'day'),
        cap('Monthly cap', 'monthlyCap', 50, 1000, 25, 'mo'),
        setting('Pause new builds at the cap', s.pauseAtCap, enabled => { s.pauseAtCap = enabled; }),
      ]),
      row('Repository', h('span', {}, `${state.workspace} · ${state.branch}`)),
      h('a', { class: 'v2-inline-link v2-settings-exit', href: '#/welcome' }, 'Exit sample workspace'),
    ];
  }

  function realSettings() {
    const repo = OW.data.repo.get();
    const soon = label => row(label, h('span', { class: 'v2-muted' }, 'Coming soon'));
    return [
      soon('Where it runs'), soon('Effort'), soon('Models'),
      row('Connections', h('span', { class: 'v2-conn-pill connected' }, 'GitHub connected'), connection('GitHub', true)),
      soon('Budget'),
      row('Repository', h('span', {}, repo.full),
        button('Switch repository', () => { OW.data.repo.forget(); OW.onRepoReset?.(); })),
      row('Data freshness', h('span', {}, 'GitHub'),
        [h('ul', { class: 'v2-freshness' }), button('Refresh now', () => OW.data.refreshAll())]),
      h('button', {
        type: 'button', class: 'v2-inline-link v2-settings-exit',
        onclick: () => { OW.data.auth.signOut(); OW.onSignedOut?.(false); },
      }, 'Sign out'),
    ];
  }

  function freshness(feed) {
    if (feed.state === 'loading') return `${feed.label}: reading…`;
    if (feed.state === 'unknown') return `${feed.label}: unavailable (last tried ${time(feed.failedAt)})`;
    const detail = feed.state === 'stale' ? ' · last read failed' : feed.state === 'partial' ? ' · partial' : '';
    return `${feed.label} read ${time(feed.readAt)}${detail}`;
  }

  function render(el, feeds) {
    const demo = OW.data.demo();
    if (!el.firstElementChild) {
      el.replaceChildren(h('div', { class: 'v2-settings' },
        h('header', { class: 'v2-page-head' }, h('h1', { class: 'v2-h1', tabindex: '-1' }, 'Settings')),
        h('div', { class: 'v2-settings-list' }, demo ? demoSettings() : realSettings())));
    }
    if (demo) return;
    const limit = OW.data.limit;
    const limitLine = OW.data.paused() ? `GitHub reads resume at ${time(limit.pausedUntil)}`
      : limit.remaining === null ? 'GitHub API limit has not been read yet' : `GitHub API limit: ${limit.remaining.toLocaleString()} left`;
    el.querySelector('.v2-freshness').replaceChildren(...[freshness(feeds.specs), limitLine].map(text => h('li', {}, text)));
  }

  OW.page({ id: 'settings', title: 'Settings', icon: 'settings', pinnedBottom: true, feeds: [], render });
})();
