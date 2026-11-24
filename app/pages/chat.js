'use strict';
(() => {
  const { h, icon } = OW.ui;

  function renderGrill(m) {
    const allRecs = m.questions.every(q => q.selected === q.rec);
    const list = m.questions.map((q, qi) => h('div', { class: 'v2-grill-q' },
      h('div', { class: 'v2-grill-q-head' },
        h('span', { class: 'v2-mono v2-q-id' }, q.id),
        h('span', { class: 'v2-q-prompt' }, q.prompt)),
      h('div', { class: 'v2-q-opts', role: 'group', 'aria-label': q.prompt },
        q.options.map((opt, oi) => {
          const isRec = oi === q.rec;
          const isSel = oi === q.selected;
          return h('button', {
            type: 'button',
            class: `v2-opt${isSel ? ' selected' : ''}${isRec ? ' rec' : ''}`,
            'aria-pressed': String(isSel),
            disabled: m.answered,
            onclick: () => OW.demo.pickOption(m.id, qi, oi),
          },
          h('span', {}, opt),
          isRec ? h('span', { class: 'v2-rec-tag v2-mono' }, 'REC') : null);
        }))));

    const foot = m.answered
      ? h('div', { class: 'v2-grill-done' },
        icon('check'),
        h('span', {}, 'Answered · Spec queued in Feed'),
        h('a', { class: 'v2-inline-link', href: '#/feed' }, 'Open Feed'))
      : h('button', {
        type: 'button',
        class: 'v2-btn v2-btn-primary v2-btn-full',
        onclick: () => OW.demo.completeGrill(m.id),
      }, allRecs ? 'Accept all 3 recs' : 'Send 3 answers');

    return h('div', { class: 'v2-msg v2-msg-wiz' },
      h('div', { class: 'v2-avatar', 'aria-hidden': 'true' }, h('img', { src: '/app/mark.svg', alt: '', width: 20, height: 20 })),
      h('article', { class: 'v2-grill-card' },
        h('div', { class: 'v2-grill-head' },
          h('strong', {}, `Grill round ${m.round} · ${m.specTitle}`),
          h('span', { class: 'v2-mono' }, `${m.questions.length} plain questions`)),
        h('div', { class: 'v2-grill-body' }, list),
        h('div', { class: 'v2-grill-foot' }, foot)));
  }

  function renderDemo(el) {
    const state = OW.demo.state;
    const input = h('input', {
      type: 'text',
      class: 'v2-composer-input',
      placeholder: 'Tell Wiz what to build or change…',
      'aria-label': 'Tell Wiz what to build or change',
    });
    const form = h('form', {
      class: 'v2-composer',
      onsubmit: event => {
        event.preventDefault();
        if (!input.value.trim()) return;
        OW.demo.sendChat(input.value);
        input.value = '';
      },
    },
    input,
    h('button', { type: 'submit', class: 'v2-composer-send', 'aria-label': 'Send message' }, icon('arrowUp')));

    const stream = h('div', { class: 'v2-chat-stream' }, state.messages.map(m => {
      if (m.role === 'user') {
        return h('div', { class: 'v2-msg v2-msg-user' },
          h('div', { class: 'v2-bubble v2-bubble-user' },
            h('div', { class: 'v2-bubble-meta v2-mono' }, `You · ${m.time}`),
            h('p', {}, m.text)));
      }
      if (m.role === 'wiz') {
        return h('div', { class: 'v2-msg v2-msg-wiz' },
          h('div', { class: 'v2-avatar', 'aria-hidden': 'true' }, h('img', { src: '/app/mark.svg', alt: '', width: 20, height: 20 })),
          h('div', { class: 'v2-bubble' },
            h('div', { class: 'v2-bubble-meta v2-mono' }, `Wiz · ${m.time}`),
            h('p', {}, m.text),
            m.jumpFeed ? h('a', { class: 'v2-btn v2-btn-subtle v2-jump-btn', href: '#/feed' }, 'Open in Feed', icon('arrowRight')) : null));
      }
      return renderGrill(m);
    }));

    el.replaceChildren(
      h('div', { class: 'v2-chat-layout' },
        h('header', { class: 'v2-chat-band' },
          h('div', { class: 'v2-painted-layer art-sea', 'aria-hidden': 'true' }),
          h('div', { class: 'v2-dither-layer', 'aria-hidden': 'true' }),
          h('div', { class: 'v2-chat-band-inner' },
            h('div', {},
              h('h1', { class: 'v2-h1', tabindex: '-1' }, 'Chat'),
              h('p', { class: 'v2-sub' }, 'Three plain questions at a time. Recommendations pre-picked.')),
            h('span', { class: 'v2-pill v2-mono' }, `${state.workspace} · ${state.branch}`))),
        h('div', { class: 'v2-chat-scroll' }, stream),
        h('div', { class: 'v2-composer-wrap' }, form)));
  }

  function renderReal(el, feeds) {
    const repo = OW.data.repo.get();
    const grills = (OW.queue?.items?.() || []).filter(item => item.type === 'decision' && item.request?.kind === 'grill_round');
    const items = grills.length
      ? grills.map(item => h('a', { class: 'v2-real-row', href: '#/feed' },
        h('span', { class: 'v2-mono v2-kicker' }, `Grill round · #${item.subject.number}`),
        h('strong', {}, item.title),
        h('span', { class: 'v2-muted' }, 'Open in Feed to review and answer.')))
      : [h('div', { class: 'v2-empty-card' },
        h('h2', {}, 'Direct chat is coming in 0.02'),
        h('p', {}, 'Your connected repository does not expose a live chat backend yet. Active specs and decision requests are ready in Feed.'),
        h('a', { class: 'v2-btn v2-btn-primary', href: '#/feed' }, 'Open Feed'))];

    el.replaceChildren(
      h('div', { class: 'v2-chat-layout' },
        h('header', { class: 'v2-chat-band' },
          h('div', { class: 'v2-painted-layer art-sea', 'aria-hidden': 'true' }),
          h('div', { class: 'v2-dither-layer', 'aria-hidden': 'true' }),
          h('div', { class: 'v2-chat-band-inner' },
            h('div', {},
              h('h1', { class: 'v2-h1', tabindex: '-1' }, 'Chat'),
              h('p', { class: 'v2-sub' }, 'Grill, steer, or start something new.')),
            repo ? h('span', { class: 'v2-pill v2-mono' }, repo.full) : null)),
        h('div', { class: 'v2-chat-scroll' }, h('div', { class: 'v2-chat-stream' }, items)),
        h('div', { class: 'v2-composer-wrap' },
          h('div', { class: 'v2-composer v2-composer-disabled' },
            h('input', {
              type: 'text',
              class: 'v2-composer-input',
              disabled: true,
              placeholder: 'Free-text chat is coming in 0.02…',
              'aria-label': 'Free-text chat is coming in 0.02',
            }),
            h('button', { type: 'button', class: 'v2-composer-send', disabled: true, 'aria-label': 'Send message' }, icon('arrowUp'))))));
  }

  OW.page({
    id: 'chat',
    title: 'Chat',
    icon: 'chat',
    v2Shell: true,
    feeds: ['specs'],
    badge: () => (OW.data.demo() ? OW.demo.openQuestionsCount() : null),
    render(el, feeds) {
      if (OW.data.demo()) renderDemo(el);
      else renderReal(el, feeds);
    },
  });
})();
