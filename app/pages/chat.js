'use strict';
(() => {
  const { h, icon } = OW.ui;

  function questions(message) {
    const { id, questions: choices, answered } = message;
    const recommended = choices.every(q => q.selected === q.rec);
    const list = choices.map((q, qi) => h('div', { class: 'v2-question' },
      h('span', { class: 'v2-question-text', id: `${id}-q-${qi}` }, q.prompt),
      h('div', { class: 'v2-options', role: 'group', 'aria-labelledby': `${id}-q-${qi}` },
        q.options.map((opt, oi) => h('button', {
          type: 'button',
          class: 'v2-opt',
          'aria-pressed': String(oi === q.selected),
          'aria-label': oi === q.rec ? `${opt}, recommended` : opt,
          'data-focus': `${id}:${qi}:${oi}`,
          disabled: answered,
          onclick: () => OW.demo.pickOption(id, qi, oi),
        }, oi === q.rec ? icon('check') : null, opt)))));

    return h('article', { class: 'v2-questions' },
      h('h2', {}, message.specTitle),
      list,
      h('div', { class: 'v2-question-foot' },
        answered
          ? h('p', { class: 'v2-muted' }, icon('check'), 'Answered · Spec queued in Feed')
          : h('p', { class: 'v2-muted' }, recommended ? 'Recommended answers selected' : 'Answers updated'),
        answered
          ? h('a', { class: 'v2-inline-link', href: '#/feed', 'data-focus': id }, 'Open Feed')
          : h('button', {
            type: 'button', class: 'v2-btn v2-btn-primary', 'data-focus': id,
            onclick: () => OW.demo.completeGrill(id),
          }, recommended ? 'Accept all 3' : 'Send 3 answers')));
  }

  function demoMessage(message) {
    if (message.role === 'grill') return questions(message);
    return h('div', { class: `v2-message v2-message-${message.role}` },
      h('span', { class: 'v2-mono v2-muted' }, message.role === 'user' ? 'You' : 'Wiz'),
      h('p', {}, message.text),
      message.jumpFeed ? h('a', { class: 'v2-inline-link', href: '#/feed', 'data-focus': message.id }, 'Open in Feed') : null);
  }

  function render(el) {
    const demo = OW.data.demo();
    let layout = el.querySelector('.v2-chat');
    if (!layout) {
      const input = h('input', {
        type: 'text',
        class: 'v2-composer-input',
        placeholder: 'Tell Wiz what to build or change…',
        'aria-label': 'Tell Wiz what to build or change',
        disabled: !demo,
        oninput: demo ? event => { OW.demo.state.draft = event.target.value; } : null,
      });
      if (demo) input.value = OW.demo.state.draft;
      const form = h('form', {
        class: 'v2-composer',
        onsubmit: event => {
          event.preventDefault();
          if (!demo || !input.value.trim()) return;
          const text = input.value;
          input.value = '';
          OW.demo.state.draft = '';
          OW.demo.sendChat(text);
          input.focus();
        },
      }, input, h('button', {
        type: 'submit', class: 'v2-icon-btn', 'aria-label': 'Send message', disabled: !demo,
      }, icon('arrowRight')));
      const stream = h('div', { class: 'v2-chat-stream' });
      layout = h('div', { class: 'v2-chat' },
        h('header', { class: 'v2-page-head' }, h('h1', { class: 'v2-h1', tabindex: '-1' }, 'Chat')),
        h('div', { class: 'v2-chat-scroll' }, stream),
        h('div', { class: 'v2-composer-wrap' }, form));
      el.replaceChildren(layout);
      if (!demo) {
        stream.append(h('div', { class: 'v2-empty-card' },
          h('h2', {}, 'Chat is coming soon'),
          h('p', {}, 'Open Feed to review specs and decisions from your repository.'),
          h('a', { class: 'v2-btn v2-btn-primary', href: '#/feed' }, 'Open Feed')));
      }
    }
    if (!demo) return;
    const stream = layout.querySelector('.v2-chat-stream');
    const { messages } = OW.demo.state;
    const follow = stream.childElementCount > 0 && messages.length > stream.childElementCount;
    OW.factory.redraw(stream, () => stream.replaceChildren(...messages.map(demoMessage)));
    if (follow) stream.lastElementChild?.scrollIntoView({ block: 'end' });
  }

  OW.page({
    id: 'chat', title: 'Chat', icon: 'chat',
    badge: () => (OW.data.demo() ? OW.demo.openQuestionsCount() : null),
    render,
  });
})();
