'use strict';
(() => {
  const { h, icon, time } = OW.ui;

  const EFFORT_NOTES = {
    fast: 'Fast: skips extra grill rounds on minor details and moves straight to Feed.',
    balanced: 'Balanced: grills once on ambiguous scope and reviews every change before showing it in Feed.',
    thorough: 'Thorough: double-checks edge cases and runs full end-to-end checks before marking ready.',
  };

  function toggleRow(name, detail, on, disabled, onClick) {
    return h('div', { class: 'v2-set-row' },
      h('div', { class: 'v2-set-info' },
        h('strong', {}, name),
        detail ? h('span', {}, detail) : null),
      h('button', {
        type: 'button',
        class: `v2-switch${on ? ' on' : ''}`,
        role: 'switch',
        'aria-checked': String(Boolean(on)),
        'aria-label': `Toggle ${name}`,
        disabled: Boolean(disabled),
        onclick: onClick || null,
      }, h('span', { class: 'v2-switch-thumb' })));
  }

  function renderDemo(el) {
    const s = OW.demo.state.settings;
    const pct = Math.min(100, Math.round((s.spendToday / s.dailyCap) * 100));

    const hostsCard = h('section', { class: 'v2-set-card' },
      h('div', { class: 'v2-set-head' },
        h('h2', {}, 'Where it runs'),
        h('span', { class: 'v2-pill v2-mono' }, `${s.hosts.filter(x => x.enabled).length} active`)),
      h('div', { class: 'v2-set-list' }, s.hosts.map(host => toggleRow(host.name, host.detail, host.enabled, false, () => {
        host.enabled = !host.enabled;
        OW.demo.toast(`${host.name} ${host.enabled ? 'enabled' : 'paused'}`);
      }))));

    const effortCard = h('section', { class: 'v2-set-card' },
      h('div', { class: 'v2-set-head' },
        h('h2', {}, 'Effort'),
        h('span', { class: 'v2-muted' }, 'How hard the factory thinks')),
      h('div', { class: 'v2-segmented', role: 'radiogroup', 'aria-label': 'Effort level' },
        ['fast', 'balanced', 'thorough'].map(level => h('button', {
          type: 'button',
          role: 'radio',
          class: `v2-seg-btn${s.effort === level ? ' active' : ''}`,
          'aria-checked': String(s.effort === level),
          onclick: () => { s.effort = level; OW.demo.notify(); },
        }, level[0].toUpperCase() + level.slice(1)))),
      h('p', { class: 'v2-set-note' }, EFFORT_NOTES[s.effort]));

    const modelsCard = h('section', { class: 'v2-set-card' },
      h('div', { class: 'v2-set-head' },
        h('h2', {}, 'Models'),
        h('span', { class: 'v2-muted' }, 'Defaults tuned for speed and cost')),
      h('div', { class: 'v2-set-list' }, s.models.map(m => {
        const select = h('select', {
          class: 'v2-select',
          'aria-label': `${m.role} model`,
          onchange: event => {
            m.value = event.target.value;
            OW.demo.toast(`${m.role} set to ${m.value}`);
          },
        }, m.choices.map(ch => h('option', { value: ch, selected: ch === m.value }, ch)));
        return h('div', { class: 'v2-set-row' },
          h('div', { class: 'v2-set-info' }, h('strong', {}, m.role)),
          select);
      })));

    const connectionsCard = h('section', { class: 'v2-set-card' },
      h('div', { class: 'v2-set-head' },
        h('h2', {}, 'Connections'),
        h('span', { class: 'v2-muted' }, 'Stored locally on host')),
      h('div', { class: 'v2-set-list' }, s.connections.map(conn => h('div', { class: 'v2-set-row' },
        h('div', { class: 'v2-set-info' },
          h('strong', {}, conn.name),
          h('span', {}, conn.detail)),
        h('button', {
          type: 'button',
          class: `v2-conn-pill${conn.connected ? ' connected' : ''}`,
          onclick: () => {
            conn.connected = !conn.connected;
            OW.demo.toast(`${conn.name}: ${conn.connected ? 'Connected' : 'Not connected'}`);
          },
        }, conn.connected ? 'Connected' : 'Not connected')))));

    const dailyInput = h('input', {
      type: 'range',
      min: 5,
      max: 100,
      step: 5,
      value: s.dailyCap,
      class: 'v2-range',
      'aria-label': 'Daily budget cap',
      oninput: event => { s.dailyCap = Number(event.target.value); OW.demo.notify(); },
    });
    const monthlyInput = h('input', {
      type: 'range',
      min: 50,
      max: 1000,
      step: 25,
      value: s.monthlyCap,
      class: 'v2-range',
      'aria-label': 'Monthly budget cap',
      oninput: event => { s.monthlyCap = Number(event.target.value); OW.demo.notify(); },
    });
    const spendFill = h('span', { class: 'v2-meter-fill' });
    spendFill.style.width = `${pct}%`;

    const budgetCard = h('section', { class: 'v2-set-card v2-set-wide' },
      h('div', { class: 'v2-set-head' },
        h('h2', {}, 'Budget'),
        h('span', { class: 'v2-pill v2-mono' }, `$${s.spendToday.toFixed(2)} spent today`)),
      h('div', { class: 'v2-budget-grid' },
        h('div', { class: 'v2-budget-col' },
          h('div', { class: 'v2-budget-top' },
            h('span', {}, 'Daily cap'),
            h('strong', { class: 'v2-mono' }, `$${s.dailyCap} / day`)),
          dailyInput,
          h('div', { class: 'v2-meter' }, spendFill)),
        h('div', { class: 'v2-budget-col' },
          h('div', { class: 'v2-budget-top' },
            h('span', {}, 'Monthly cap'),
            h('strong', { class: 'v2-mono' }, `$${s.monthlyCap} / mo`)),
          monthlyInput)),
      toggleRow('Pause new builds automatically at cap', 'Stops starting new tickets until tomorrow', s.pauseAtCap, false, () => {
        s.pauseAtCap = !s.pauseAtCap;
        OW.demo.notify();
      }));

    const repoCard = h('section', { class: 'v2-set-card v2-set-wide' },
      h('div', { class: 'v2-set-head' },
        h('h2', {}, 'Repository & session'),
        h('span', { class: 'v2-pill v2-mono' }, 'Sample data')),
      h('div', { class: 'v2-set-list' },
        h('div', { class: 'v2-set-row' },
          h('div', { class: 'v2-set-info' },
            h('strong', {}, `${OW.demo.state.workspace} · ${OW.demo.state.branch}`),
            h('span', {}, 'Interactive preview — makes no network requests and no writes.')),
          h('a', { class: 'v2-btn', href: '#/welcome' }, 'View welcome screen'))));

    el.replaceChildren(
      h('div', { class: 'v2-settings-layout' },
        h('header', { class: 'v2-page-head' },
          h('div', {},
            h('h1', { class: 'v2-h1', tabindex: '-1' }, 'Settings'),
            h('p', { class: 'v2-sub' }, 'Sensible defaults are already chosen. Change only what you care about.'))),
        h('div', { class: 'v2-settings-grid' },
          hostsCard, effortCard, modelsCard, connectionsCard, budgetCard, repoCard)));
  }

  function freshnessLine(feed) {
    if (feed.state === 'loading') return `${feed.label}: reading…`;
    if (feed.state === 'unknown') return `${feed.label}: unknown (failed at ${time(feed.failedAt)})`;
    return `${feed.label} read ${time(feed.readAt)}${feed.state === 'stale' ? ' · last read failed' : ''}`;
  }

  function renderReal(el, feeds) {
    const repo = OW.data.repo.get();
    const limit = OW.data.limit;
    const limitLine = limit.remaining === null ? 'GitHub API limit: not read yet' : `GitHub API limit: ${limit.remaining.toLocaleString()} left`;

    const repoCard = h('section', { class: 'v2-set-card v2-set-wide' },
      h('div', { class: 'v2-set-head' },
        h('h2', {}, 'Repository & data freshness'),
        h('span', { class: 'v2-pill v2-mono' }, OW.data.v2.get() === 'on' ? 'v2 on' : 'v2 dry-run')),
      h('div', { class: 'v2-set-list' },
        h('div', { class: 'v2-set-row' },
          h('div', { class: 'v2-set-info' },
            h('strong', {}, repo ? repo.full : 'No repository picked'),
            h('span', {}, `${Object.values(feeds).map(freshnessLine).join(' · ')} · ${limitLine}`)),
          h('div', { class: 'v2-row-actions' },
            h('button', {
              type: 'button',
              class: 'v2-btn',
              disabled: OW.data.paused(),
              onclick: () => OW.data.refreshAll(),
            }, icon('refresh'), 'Refresh now'),
            h('button', {
              type: 'button',
              class: 'v2-btn',
              onclick: () => { OW.data.repo.forget(); OW.onRepoReset?.(); },
            }, 'Switch repository'),
            h('button', {
              type: 'button',
              class: 'v2-btn v2-btn-ghost',
              onclick: () => { OW.data.auth.signOut(); OW.onSignedOut?.(); },
            }, 'Sign out')))));

    const connectionsCard = h('section', { class: 'v2-set-card' },
      h('div', { class: 'v2-set-head' },
        h('h2', {}, 'Connections'),
        h('span', { class: 'v2-muted' }, 'Current status')),
      h('div', { class: 'v2-set-list' },
        h('div', { class: 'v2-set-row' },
          h('div', { class: 'v2-set-info' }, h('strong', {}, 'GitHub'), h('span', {}, 'Repository and pull requests')),
          h('span', { class: 'v2-conn-pill connected' }, 'Connected')),
        h('div', { class: 'v2-set-row' },
          h('div', { class: 'v2-set-info' }, h('strong', {}, 'Model providers'), h('span', {}, 'Configured on your host in 0.02')),
          h('span', { class: 'v2-conn-pill' }, 'Not connected'))));

    const comingCard = h('section', { class: 'v2-set-card' },
      h('div', { class: 'v2-set-head' },
        h('h2', {}, 'Factory defaults'),
        h('span', { class: 'v2-mono v2-muted' }, 'Coming in 0.02')),
      h('p', { class: 'v2-set-note' }, 'Hosts, effort level, model roles, and daily budgets are managed from the 0.02 host service once connected.'));

    el.replaceChildren(
      h('div', { class: 'v2-settings-layout' },
        h('header', { class: 'v2-page-head' },
          h('div', {},
            h('h1', { class: 'v2-h1', tabindex: '-1' }, 'Settings'),
            h('p', { class: 'v2-sub' }, 'Repository, data freshness, connections, and account.'))),
        h('div', { class: 'v2-settings-grid' }, repoCard, connectionsCard, comingCard)));
  }

  OW.page({
    id: 'settings',
    title: 'Settings',
    icon: 'settings',
    v2Shell: true,
    pinnedBottom: true,
    feeds: ['specs', 'agents'],
    render(el, feeds) {
      if (OW.data.demo()) renderDemo(el);
      else renderReal(el, feeds);
    },
  });
})();
