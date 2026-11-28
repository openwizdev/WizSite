'use strict';
(() => {
  const { h, icon, time } = OW.ui;
  const CHIPS = ['Simplify the copy', 'Keep the current default', 'Break into smaller steps'];

  function showDialog(opener, title, contents) {
    const dialog = h('dialog', { class: 'v2-dialog', 'aria-label': title },
      h('header', { class: 'v2-dialog-head' },
        h('h2', {}, title),
        h('button', { type: 'button', class: 'v2-icon-btn', 'aria-label': 'Close', onclick: () => dialog.close() }, icon('close'))),
      contents(() => dialog.close()));
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (opener.isConnected) opener.focus();
    }, { once: true });
    document.querySelector('.v2-shell').append(dialog);
    dialog.showModal();
  }

  function change(card, opener) {
    showDialog(opener, 'Change something', close => {
      const input = h('textarea', {
        rows: 3, class: 'v2-sheet-input', autofocus: true,
        placeholder: 'Tell Wiz what should change…', 'aria-label': 'What should change',
      });
      input.value = card.note || '';
      return h('form', { onsubmit: event => {
        event.preventDefault();
        if (!input.value.trim()) return input.focus();
        close();
        opener.focus();
        OW.demo.submitChange(card.id, input.value);
      } },
      h('p', { class: 'v2-muted v2-dialog-context' }, card.title),
      h('div', { class: 'v2-chips' }, CHIPS.map(text => h('button', {
        type: 'button', class: 'v2-btn', onclick: () => { input.value = text; input.focus(); },
      }, text))),
      input,
      h('div', { class: 'v2-sheet-actions' },
        h('button', { type: 'button', class: 'v2-btn', onclick: close }, 'Cancel'),
        h('button', { type: 'submit', class: 'v2-btn v2-btn-primary' }, 'Send change')));
    });
  }

  function preview(card) {
    return h('button', {
      type: 'button', class: 'v2-poster', 'aria-label': 'Read narrated spec preview', 'data-focus': 'preview',
      onclick: event => showDialog(event.currentTarget, 'Narrated spec preview', () =>
        h('ol', { class: 'v2-transcript' }, card.scenes.map(scene => h('li', {}, scene)))),
    },
    h('span', { class: `v2-painted-layer ${card.art}`, 'aria-hidden': 'true' }),
    h('span', { class: 'v2-poster-caption' }, h('span', {}, 'Narrated spec'), h('span', {}, '0:09', icon('arrowRight'))));
  }

  function progress(card) {
    const { merged, total } = card;
    return h('div', { class: 'v2-progress' },
      h('strong', { class: 'v2-mono' }, `${merged} of ${total} tickets merged`),
      h('div', { class: 'v2-segments', 'aria-hidden': 'true' },
        Array.from({ length: total }, (_, i) => h('span', { class: i < merged ? 'filled' : '' },
          i < merged ? icon('check') : null))));
  }

  function demoCard(card) {
    const decision = card.type === 'decision';
    const done = card.status === 'shipped' || card.status === 'decided';
    const act = action => {
      const { state, visibleCards } = OW.demo;
      const cards = visibleCards();
      const index = cards.indexOf(card);
      const next = cards[index + 1] || cards[index - 1];
      const hash = next ? `#/feed/${state.cards.indexOf(next) + 1}` : '#/feed';
      history.replaceState(null, '', hash);
      OW.demo.cardAction(card.id, action);
    };
    const label = done ? (decision ? 'Decided' : 'Shipped') : card.status === 'snoozed' ? 'Snoozed' : card.kicker;
    return h('article', { class: 'v2-feed-card', 'data-card-id': card.id },
      h('span', { class: 'v2-card-label v2-mono' }, label),
      h('h2', { class: 'v2-card-title' }, card.title),
      h('p', { class: 'v2-card-goal' }, card.goal),
      decision
        ? h('div', { class: 'v2-decision-strip', 'aria-hidden': 'true' },
          h('div', { class: `v2-painted-layer ${card.art}` }))
        : preview(card),
      decision
        ? h('div', { class: 'v2-rec-box' },
          h('strong', {}, h('span', { class: 'v2-muted' }, 'Recommended · '), card.rec),
          h('p', {}, card.context))
        : progress(card),
      card.note ? h('p', { class: 'v2-note' }, `Change requested: "${card.note}"`) : null,
      h('div', { class: 'v2-card-actions' },
        h('button', {
          type: 'button', class: 'v2-btn v2-btn-primary', disabled: done, 'data-focus': 'ship',
          onclick: () => act('ship'),
        }, icon('check'), done ? label : 'Ship it'),
        h('button', {
          type: 'button', class: 'v2-btn', 'data-focus': 'change', onclick: event => change(card, event.currentTarget),
        }, 'Change something'),
        h('button', {
          type: 'button', class: 'v2-btn v2-btn-ghost', 'data-focus': 'defer', onclick: () => act('notnow'),
        }, 'Not now')));
  }

  function pager(index, total, go) {
    const button = (label, step, disabled) => h('button', {
      type: 'button', class: 'v2-icon-btn', 'aria-label': label, 'aria-disabled': String(disabled),
      'data-focus': step < 0 ? 'previous' : 'next',
      onclick: () => { if (!disabled) go(index + step); },
    }, icon(step < 0 ? 'arrowUp' : 'arrowDown'));
    return h('div', { class: 'v2-feed-pager', role: 'group', 'aria-label': 'Card navigation' },
      button('Previous card', -1, index === 0),
      h('span', { class: 'v2-mono v2-muted', role: 'status' }, `${index + 1} of ${total}`),
      button('Next card', 1, index >= total - 1));
  }

  function makeLayout(title, ...actions) {
    const stage = h('div', { class: 'v2-feed-stage' });
    return h('div', { class: 'v2-feed' },
      h('header', { class: 'v2-page-head' },
        h('h1', { class: 'v2-h1', tabindex: '-1' }, title), ...actions),
      stage);
  }

  function renderDemo(el, arg) {
    let layout = el.querySelector('.v2-feed');
    if (!layout) {
      layout = makeLayout('Feed');
      el.replaceChildren(layout);
    }
    const stage = layout.lastElementChild;
    const { state, visibleCards, notify } = OW.demo;
    if (document.querySelector('.v2-dialog[open]')) return;
    const requested = arg ? state.cards[Number(arg) - 1] : null;
    const visible = visibleCards();
    const cards = requested && !visible.includes(requested) ? state.cards : visible;
    const index = requested ? Math.max(0, cards.indexOf(requested)) : 0;
    const go = next => {
      history.replaceState(null, '', `#/feed/${state.cards.indexOf(cards[next]) + 1}`);
      notify();
    };
    if (!cards.length) {
      OW.factory.redraw(stage, () => stage.replaceChildren(h('section', { class: 'v2-all-clear' },
        h('div', { class: 'v2-clear-art', 'aria-hidden': 'true' }, h('div', { class: 'v2-painted-layer art-sea' })),
        h('h2', {}, 'All clear'),
        h('p', {}, 'Nothing needs your call right now.'),
        h('button', {
          type: 'button', class: 'v2-inline-link',
          onclick: () => { state.showCompleted = true; notify(); },
        }, 'Review completed'))));
      return;
    }
    OW.factory.redraw(stage, () => stage.replaceChildren(demoCard(cards[index]), pager(index, cards.length, go)));
  }

  function renderReal(el, feeds, arg, queue = false) {
    let layout = el.querySelector('.v2-feed');
    if (!layout) {
      layout = makeLayout(queue ? 'Queue' : 'Feed', h('button', {
        class: 'v2-btn v2-btn-ghost v2-refresh', type: 'button', onclick: () => OW.data.refreshAll(),
      }, icon('refresh'), 'Refresh now'));
      layout.lastElementChild.append(h('div', { class: 'v2-feed-note', role: 'status' }), h('div', { class: 'v2-real-queue' }));
      el.replaceChildren(layout);
    }
    const paused = OW.data.paused();
    layout.querySelector('.v2-refresh').setAttribute('aria-disabled', String(paused));
    const specs = feeds.specs;
    const parts = [];
    if (paused) parts.push(`GitHub’s limit is low. GitHub reads resume at ${time(OW.data.limit.pausedUntil)}.`);
    if (specs.state === 'unknown') {
      parts.push(paused ? 'Couldn’t read Specs from GitHub.' : 'Couldn’t read Specs from GitHub. Press Refresh now to try again.');
    } else if (specs.state === 'stale') {
      parts.push("Couldn't read Specs from GitHub. Showing the last successful read.");
    } else if (specs.state === 'partial') {
      parts.push('Some specs could not be read.');
    }
    const message = parts.join(' ');
    const note = layout.querySelector('.v2-feed-note');
    if (note.textContent !== message) note.textContent = message;
    const slot = layout.querySelector('.v2-real-queue');
    const present = queue ? undefined : deck => {
      const cards = [...deck.children];
      const route = arg || '1';
      const selected = deck.dataset.route === route ? cards.findIndex(card => card.dataset.key === deck.dataset.selected) : -1;
      const index = selected >= 0 ? selected : Math.min(Number(route) - 1, cards.length - 1);
      deck.dataset.route = route;
      deck.dataset.selected = cards[index]?.dataset.key || '';
      cards.forEach((item, i) => { item.hidden = index !== i; });
      const go = next => {
        const hash = next === 0 ? '#/feed' : `#/feed/${next + 1}`;
        if (location.hash !== hash) location.hash = hash;
        else {
          deck.dataset.selected = cards[next].dataset.key;
          OW.queue.render(slot, feeds, present);
        }
      };
      return cards.length > 1 ? pager(index, cards.length, go) : null;
    };
    OW.queue.render(slot, feeds, present);
  }

  OW.feed = { real: renderReal };
  OW.page({
    id: 'feed', title: 'Feed', icon: 'feed', feeds: ['specs'],
    badge: () => OW.data.demo() ? OW.demo.pendingFeedCount() : OW.queue.count(),
    render(el, feeds, arg) {
      if (OW.data.demo()) renderDemo(el, arg);
      else renderReal(el, feeds, arg);
    },
  });
})();
