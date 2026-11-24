'use strict';
(() => {
  const { h, icon } = OW.ui;
  const CHIPS = ['Simplify the copy', 'Keep the current default', 'Break into smaller steps'];

  function renderChangeSheet(card) {
    const input = h('textarea', {
      class: 'v2-sheet-input',
      rows: 3,
      placeholder: 'Tell Wiz what should change…',
      'aria-label': 'What should change',
    });
    input.value = card.note || '';

    const submit = () => {
      if (!input.value.trim()) {
        input.focus();
        return;
      }
      OW.demo.submitChange(card.id, input.value);
    };

    return h('div', {
      class: 'v2-sheet-backdrop',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': `Change ${card.title}`,
      onclick: event => { if (event.target === event.currentTarget) OW.demo.closeChange(); },
    },
    h('div', { class: 'v2-sheet' },
      h('div', { class: 'v2-sheet-head' },
        h('div', {},
          h('span', { class: 'v2-mono v2-kicker' }, 'Change something'),
          h('h2', {}, card.title)),
        h('button', { type: 'button', class: 'v2-icon-btn', 'aria-label': 'Close', onclick: () => OW.demo.closeChange() }, icon('close'))),
      h('div', { class: 'v2-chips' }, CHIPS.map(text => h('button', {
        type: 'button',
        class: 'v2-chip',
        onclick: () => { input.value = text; input.focus(); },
      }, text))),
      input,
      h('div', { class: 'v2-sheet-actions' },
        h('button', { type: 'button', class: 'v2-btn', onclick: () => OW.demo.closeChange() }, 'Cancel'),
        h('button', { type: 'button', class: 'v2-btn v2-btn-primary', onclick: submit }, 'Send change'))));
  }

  function renderSpecCard(card, idx, total) {
    const pct = Math.round((card.merged / card.total) * 100);
    const done = card.status === 'shipped';
    const chipLabel = done ? 'Shipped' : card.status === 'snoozed' ? 'Snoozed' : card.kicker;

    return h('article', { class: 'v2-feed-card', 'data-card-id': card.id },
      h('div', { class: 'v2-poster' },
        h('div', { class: `v2-painted-layer ${card.art}`, 'aria-hidden': 'true' }),
        h('div', { class: 'v2-dither-layer', 'aria-hidden': 'true' }),
        h('div', { class: 'v2-poster-top' },
          h('span', { class: 'v2-poster-badge v2-mono' }, 'NARRATED · 0:09'),
          h('div', { class: 'v2-poster-controls' },
            h('button', {
              type: 'button',
              class: 'v2-poster-btn',
              onclick: () => OW.demo.stepScene(card.id),
            }, 'Next'),
            h('button', {
              type: 'button',
              class: 'v2-poster-btn',
              onclick: () => OW.demo.toggleScene(card.id),
            }, card.paused ? 'Play' : 'Pause'))),
        h('div', { class: 'v2-poster-caption' },
          h('span', { class: 'v2-mono' }, card.scenes[card.sceneIdx]))),
      h('div', { class: 'v2-feed-card-body' },
        h('div', { class: 'v2-card-meta' },
          h('span', { class: `v2-status-pill${done ? ' ok' : ''}` }, chipLabel)),
        h('h2', { class: 'v2-card-title' }, card.title),
        h('p', { class: 'v2-card-goal' }, card.goal),
        h('div', { class: 'v2-progress-box' },
          h('div', { class: 'v2-progress-head' },
            h('strong', {}, `${card.merged} of ${card.total} tickets merged`),
            h('span', { class: 'v2-mono' }, `${pct}%`)),
          h('div', { class: 'v2-segments', role: 'img', 'aria-label': `${card.merged} of ${card.total} tickets merged` },
            Array.from({ length: card.total }, (_, i) => h('span', { class: i < card.merged ? 'v2-seg filled' : 'v2-seg' })))),
        card.note ? h('div', { class: 'v2-note-pill' }, `Change requested: "${card.note}"`) : null),
      h('div', { class: 'v2-card-actions' },
        h('button', {
          type: 'button',
          class: 'v2-btn v2-btn-primary',
          disabled: done,
          onclick: () => OW.demo.cardAction(card.id, 'ship'),
        }, icon('check'), done ? 'Shipped' : 'Ship it'),
        h('button', {
          type: 'button',
          class: 'v2-btn',
          onclick: () => OW.demo.cardAction(card.id, 'change'),
        }, icon('edit'), 'Change something'),
        h('button', {
          type: 'button',
          class: 'v2-btn v2-btn-ghost',
          onclick: () => OW.demo.cardAction(card.id, 'notnow'),
        }, icon('arrowDown'), 'Not now')));
  }

  function renderDecisionCard(card, idx, total) {
    const done = card.status === 'decided';
    const chipLabel = done ? 'Decided' : card.status === 'snoozed' ? 'Snoozed' : card.kicker;

    return h('article', { class: 'v2-feed-card v2-feed-decision', 'data-card-id': card.id },
      h('div', { class: 'v2-decision-strip' },
        h('div', { class: `v2-painted-layer ${card.art}`, 'aria-hidden': 'true' }),
        h('div', { class: 'v2-dither-layer', 'aria-hidden': 'true' }),
        h('div', { class: 'v2-card-meta' },
          h('span', { class: `v2-status-pill${done ? ' ok' : ' attention'}` }, chipLabel))),
      h('div', { class: 'v2-feed-card-body' },
        h('h2', { class: 'v2-card-title' }, card.title),
        h('p', { class: 'v2-card-goal' }, card.goal),
        h('div', { class: 'v2-rec-box' },
          h('span', { class: 'v2-mono v2-kicker' }, 'Recommendation'),
          h('strong', { class: 'v2-rec-title' }, card.rec),
          h('p', { class: 'v2-rec-ctx' }, card.context)),
        card.note ? h('div', { class: 'v2-note-pill' }, `Change requested: "${card.note}"`) : null),
      h('div', { class: 'v2-card-actions' },
        h('button', {
          type: 'button',
          class: 'v2-btn v2-btn-primary',
          disabled: done,
          onclick: () => OW.demo.cardAction(card.id, 'ship'),
        }, icon('check'), done ? 'Decided' : 'Ship it'),
        h('button', {
          type: 'button',
          class: 'v2-btn',
          onclick: () => OW.demo.cardAction(card.id, 'change'),
        }, icon('edit'), 'Change something'),
        h('button', {
          type: 'button',
          class: 'v2-btn v2-btn-ghost',
          onclick: () => OW.demo.cardAction(card.id, 'notnow'),
        }, icon('arrowDown'), 'Not now')));
  }

  function renderDemo(el, arg) {
    const state = OW.demo.state;
    const allCards = state.cards;
    let cards = OW.demo.visibleCards();
    let idx = state.feedIndex;

    if (arg && /^[1-9]\d*$/.test(arg)) {
      const requested = Number(arg) - 1;
      if (requested >= 0 && requested < allCards.length) {
        cards = allCards;
        idx = requested;
        state.feedIndex = idx;
      }
    }

    if (!cards.length) {
      el.replaceChildren(
        h('div', { class: 'v2-feed-layout' },
          h('header', { class: 'v2-page-head' },
            h('h1', { class: 'v2-h1', tabindex: '-1' }, 'Feed'),
            h('span', { class: 'v2-mono v2-muted' }, '0 waiting')),
          h('section', { class: 'v2-all-clear' },
            h('div', { class: 'v2-clear-art' },
              h('div', { class: 'v2-painted-layer art-sea', 'aria-hidden': 'true' }),
              h('div', { class: 'v2-dither-layer', 'aria-hidden': 'true' })),
            h('h2', {}, 'All clear'),
            h('p', {}, 'Nothing needs your call right now. New specs and decisions appear here when ready.'),
            h('div', { class: 'v2-clear-actions' },
              h('a', { class: 'v2-btn v2-btn-primary', href: '#/chat' }, 'Back to Chat'),
              h('button', {
                type: 'button',
                class: 'v2-btn',
                onclick: () => { state.showCompleted = true; state.feedIndex = 0; OW.demo.notify(); },
              }, 'Review completed')))));
      return;
    }

    idx = Math.max(0, Math.min(idx, cards.length - 1));
    state.feedIndex = idx;
    const card = cards[idx];
    const go = next => {
      const clamped = Math.max(0, Math.min(next, cards.length - 1));
      state.feedIndex = clamped;
      history.replaceState(null, '', clamped === 0 ? '#/feed' : `#/feed/${clamped + 1}`);
      OW.demo.notify();
    };

    const sheetCard = state.changeTarget ? allCards.find(c => c.id === state.changeTarget) : null;

    el.replaceChildren(
      h('div', { class: 'v2-feed-layout' },
        h('header', { class: 'v2-page-head' },
          h('div', {},
            h('h1', { class: 'v2-h1', tabindex: '-1' }, 'Feed'),
            h('p', { class: 'v2-sub' }, 'One card at a time. Ship it, change something, or defer.')),
          h('div', { class: 'v2-feed-pager', role: 'group', 'aria-label': 'Card navigation' },
            h('button', {
              type: 'button',
              class: 'v2-icon-btn',
              disabled: idx <= 0,
              'aria-label': 'Previous card',
              onclick: () => go(idx - 1),
            }, icon('arrowUp')),
            h('span', { class: 'v2-mono v2-pager-count' }, `${idx + 1} / ${cards.length}`),
            h('button', {
              type: 'button',
              class: 'v2-icon-btn',
              disabled: idx >= cards.length - 1,
              'aria-label': 'Next card',
              onclick: () => go(idx + 1),
            }, icon('arrowDown')))),
        h('div', { class: 'v2-feed-stage' },
          card.type === 'decision' ? renderDecisionCard(card, idx, cards.length) : renderSpecCard(card, idx, cards.length)),
        sheetCard ? renderChangeSheet(sheetCard) : null));
  }

  function renderReal(el, feeds) {
    const queueSlot = h('div', { class: 'v2-real-queue' });
    el.replaceChildren(
      h('div', { class: 'v2-feed-layout v2-feed-real' },
        h('header', { class: 'v2-page-head' },
          h('div', {},
            h('h1', { class: 'v2-h1', tabindex: '-1' }, 'Feed'),
            h('p', { class: 'v2-sub' }, 'Open decisions and specs from your repository.'))),
        queueSlot));
    OW.queue.render(queueSlot, feeds);
  }

  OW.page({
    id: 'feed',
    title: 'Feed',
    icon: 'feed',
    v2Shell: true,
    feeds: ['specs'],
    badge: () => (OW.data.demo() ? OW.demo.pendingFeedCount() : OW.queue?.count?.() || null),
    render(el, feeds, arg) {
      if (OW.data.demo()) renderDemo(el, arg);
      else renderReal(el, feeds);
    },
  });
})();
