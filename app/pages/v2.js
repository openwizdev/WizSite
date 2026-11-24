'use strict';
(() => {
  const { h, icon } = OW.ui;
  const isDemo = OW.data.demo;
  const button = (label, cls, onclick, attrs = {}) => h('button', { type: 'button', class: `v2-btn ${cls}`, onclick, ...attrs }, label);
  const question = (prompt, ...options) => ({ prompt, options, selected: 0 });
  const questions = (title, goal, list) => ({ role: 'questions', title, goal, list, answered: false });
  const message = (role, text, jumpFeed = false) => ({ role, text, jumpFeed });
  const spec = (title, goal, merged, total, scenes, art) => ({
    title, goal, merged, total, scenes, art, status: merged === total ? 'Ready to ship' : 'In progress',
  });
  const decision = (title, goal, recommendation) => ({ title, goal, recommendation, status: 'Needs you' });
  const demo = {
    messages: [
      message('user', 'Let’s add seat billing to Harbor.'),
      message('wiz', 'Three quick choices.'),
      questions('Seat billing', 'Bill for active editors, with free viewers and time to fix a failed payment.', [
        question('When should new seats be charged?', 'Month end', 'Immediately'),
        question('Should viewers pay?', 'Keep viewers free', 'Count everyone'),
        question('How long before edits are locked?', '7 days', '48 hours'),
      ]),
    ],
    cards: [
      spec('Magic-link sign-in', 'A simpler way into Harbor.', 6, 6, [
        'Enter your email to get a sign-in link.',
        'Open the link to sign in without a password.',
        'Each link expires after 15 minutes.',
      ], 'envelope'),
      decision('Keep the free plan?', 'Harbor’s free plan costs about $40 a month to run.', 'Keep it, cap at 3 seats'),
      spec('CSV export for audit log', 'Download up to 90 days of workspace activity.', 5, 7, [
        'Choose a date range.',
        'Download the activity as a CSV.',
        'Two tickets remain for downloads and rate limits.',
      ], 'sea'),
      decision('How long should deleted projects stay recoverable?', 'Give teams time to recover a project after deleting it.', 'Keep projects for 30 days'),
    ],
    settings: {
      host: 'Home computer', effort: 'Balanced', monthlyCap: 400, dailyCap: 25,
      pauseAtCap: true, repository: 'harbor/app',
    },
  };
  let redraw = () => {};
  let toast = null;
  let toastTimer;
  let draft = '';

  function showToast(text, undo) {
    clearTimeout(toastTimer);
    if (!toast) {
      toast = h('div', { class: 'v2-toast', role: 'status' });
      document.body.append(toast);
    }
    const dismiss = () => { toast.hidden = true; };
    toast.hidden = false;
    toast.replaceChildren(h('span', {}, text),
      undo ? button('Undo', 'text', () => { dismiss(); undo(); }, {
        onblur: () => { toastTimer = setTimeout(dismiss, 4500); },
        onfocus: () => clearTimeout(toastTimer),
      }) : null);
    toastTimer = setTimeout(dismiss, 4500);
  }

  function finishQuestions(round) {
    round.answered = true;
    demo.messages.push(message('user', round.list.map(q => q.options[q.selected]).join(' · ')),
      message('wiz', `I’ve added “${round.title}” to Feed.`, true));
    demo.cards.unshift(spec(round.title, round.goal, 0, 5, [
      'The spec is ready to review.',
      'The plan includes your three answers.',
      'Follow the tickets here as they merge.',
    ], 'sea'));
    showToast('Answers sent');
    redraw();
  }

  function sendPrompt(text) {
    const clean = text.trim();
    if (!clean) return;
    demo.messages.push(message('user', clean),
      questions(clean.length > 48 ? `${clean.slice(0, 45).trimEnd()}…` : clean, clean, [
        question('Who gets it first?', 'Active workspaces', 'Everyone'),
        question('Can people turn it off?', 'Include a toggle', 'Keep it on'),
        question('Add a short walkthrough?', 'Include a preview', 'Skip it'),
      ]));
    redraw();
  }

  function renderQuestions(round, index) {
    const recommended = round.list.every(q => q.selected === 0);
    const title = `v2-questions-${index}`;
    return h('article', { class: 'v2-grill', 'aria-labelledby': title },
      h('header', { class: 'v2-grill-head' }, h('h2', { id: title }, round.title), h('span', { class: 'v2-mono' }, '3 questions')),
      round.list.map((q, row) => h('div', { class: 'v2-grill-q' },
        h('span', { class: 'v2-q-text' }, q.prompt),
        h('div', { class: 'v2-q-opts', role: 'group', 'aria-label': q.prompt }, q.options.map((opt, i) => h('button', {
          type: 'button',
          class: 'v2-q-pill',
          'aria-pressed': q.selected === i ? 'true' : 'false',
          'aria-label': i === 0 ? `${opt}, recommended` : null,
          'data-focus': `answer-${index}-${row}-${i}`,
          disabled: round.answered,
          onclick: () => { q.selected = i; redraw(); },
        }, q.selected === i ? icon('check') : null, opt))))),
      h('footer', { class: 'v2-grill-foot' },
        h('span', { class: 'v2-mono' }, round.answered ? 'Answers sent' : recommended ? 'Recommended answers selected' : 'Review your choices'),
        round.answered
          ? h('a', { class: 'v2-btn text', href: '#/feed', 'data-focus': `accept-${index}` }, 'Open Feed', icon('right'))
          : button(recommended ? 'Accept all 3' : 'Send 3 answers', 'primary', () => finishQuestions(round), {
            'data-focus': `accept-${index}`,
          })));
  }

  function renderChat(el) {
    let wrap = el.querySelector('.v2-chat-wrap');
    if (!wrap) {
      const scroll = h('div', { class: 'v2-chat-scroll' },
        h('div', { class: 'v2-chat-thread', role: 'log', 'aria-label': 'Conversation' }));
      const input = h('input', {
        type: 'text', placeholder: 'Tell Wiz what to build or change…', 'aria-label': 'Tell Wiz what to build or change',
        value: isDemo ? draft : '', disabled: !isDemo, oninput: event => { draft = event.target.value; },
      });
      const composer = h('form', {
        class: 'v2-composer',
        onsubmit: event => {
          event.preventDefault();
          if (!isDemo || !input.value.trim()) return;
          const text = input.value;
          input.value = draft = '';
          sendPrompt(text);
        },
      }, input, h('button', { type: 'submit', class: 'v2-send-btn', disabled: !isDemo, 'aria-label': 'Send message' }, icon('right')));
      wrap = h('div', { class: 'v2-chat-wrap' }, scroll, h('div', { class: 'v2-composer-wrap' }, composer));
      el.replaceChildren(wrap);
      if (!isDemo) scroll.firstElementChild.append(h('div', { class: 'v2-chat-empty' },
        h('h2', {}, 'Direct chat is coming soon'),
        h('p', {}, 'See decisions and specs from your repository in Feed.'),
        h('a', { class: 'v2-btn', href: '#/feed' }, 'Open Feed', icon('right'))));
    }
    if (!isDemo) return;

    const scroll = wrap.querySelector('.v2-chat-scroll');
    const thread = scroll.firstElementChild;
    const count = thread.children.length;
    const top = scroll.scrollTop;
    const earlier = new Set([...thread.querySelectorAll('.v2-earlier[open]')].map(details => Number(details.dataset.message)));
    const last = demo.messages.findLastIndex(m => m.role === 'questions' && !m.answered);
    OW.factory.redraw(thread, () => thread.replaceChildren(...demo.messages.map((m, i) => {
      if (m.role === 'questions') {
        if (i !== last && !m.answered) {
          return h('details', { class: 'v2-earlier', 'data-message': i, open: earlier.has(i) },
            h('summary', { 'data-focus': `earlier-${i}` }, m.title), renderQuestions(m, i));
        }
        return renderQuestions(m, i);
      }
      return h('div', { class: `v2-msg ${m.role}` },
        m.role === 'wiz' ? h('img', { src: '/app/mark.svg', alt: '', width: 24, height: 24 }) : null,
        h('div', {}, m.text, m.jumpFeed && h('a', { href: '#/feed', class: 'v2-btn text' }, 'Watch in Feed', icon('right'))));
    })));
    scroll.scrollTop = count && count < demo.messages.length ? scroll.scrollHeight : top;
  }

  function openChange(card, opener) {
    const input = h('textarea', { rows: 3, placeholder: 'What should change?', 'aria-label': 'What should change?', autofocus: true });
    input.value = card.note || '';
    const presets = ['Simplify the copy', 'Make the first release smaller', 'Keep the current default'];
    const dialog = h('dialog', { class: 'v2-sheet', 'aria-labelledby': 'v2-sheet-title' },
      h('h2', { id: 'v2-sheet-title' }, 'Change something'),
      h('p', {}, card.title),
      input,
      h('div', { class: 'v2-quick-chips' }, presets.map(text => button(text, '', () => { input.value = text; input.focus(); }))),
      h('div', { class: 'v2-sheet-actions' },
        button('Cancel', 'text', () => dialog.close()),
        button('Send change', 'primary', () => {
          const text = input.value.trim();
          if (!text) return input.focus();
          card.note = text;
          demo.messages.push(message('user', `On “${card.title}”: ${text}`), message('wiz', 'I’ve added your change to the spec.'));
          showToast('Change sent');
          dialog.close('sent');
        })));
    dialog.addEventListener('keydown', event => event.stopPropagation());
    dialog.addEventListener('close', () => {
      dialog.remove();
      opener.focus();
      if (dialog.returnValue === 'sent') redraw();
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  }

  function renderPreview(card) {
    const copy = h('p', { class: 'v2-preview-caption', role: 'status', hidden: true });
    let scene = -1;
    const play = button(h('span', { class: 'v2-play-time' }, '0:09'), 'v2-play', () => {
      scene = (scene + 1) % card.scenes.length;
      copy.hidden = false;
      copy.textContent = card.scenes[scene];
      play.setAttribute('aria-label', 'Next preview scene');
      play.lastElementChild.textContent = `${scene + 1} / ${card.scenes.length}`;
    }, { 'aria-label': 'Read the narrated spec preview' });
    return h('div', { class: `v2-preview ${card.art}` },
      h('div', { class: 'v2-preview-art', 'aria-hidden': 'true' }),
      card.art === 'envelope' ? h('div', { class: 'v2-envelope', 'aria-hidden': 'true' }, h('i')) : null,
      h('span', { class: 'v2-preview-label v2-mono' }, 'Narrated spec'),
      h('div', { class: 'v2-preview-controls' }, play, copy));
  }

  function progress(merged, total, label = 'merged') {
    return h('div', { class: 'v2-progress' },
      h('span', { class: 'v2-mono' }, `${merged} of ${total} tickets ${label}`),
      total <= 12 ? h('div', { class: 'v2-pips', 'aria-hidden': 'true' },
        Array.from({ length: total }, (_, i) => h('span', {}, i < merged ? icon('check') : null))) : null);
  }

  function allClear(copy) {
    return h('section', { class: 'v2-clear' },
      h('span', { class: 'v2-clear-mark', 'aria-hidden': 'true' }, icon('check')),
      h('h2', {}, 'All clear.'),
      h('p', {}, copy));
  }

  const activeCards = () => demo.cards.filter(card => !card.done);
  const feedPath = index => index ? `#/feed/${index + 1}` : '#/feed';
  const feedIndex = (arg, total) => Math.min(total - 1, arg ? Number(arg) - 1 : 0);

  function demoFeed(el, arg, ctx) {
    const cards = activeCards();
    const index = feedIndex(arg, cards.length);
    ctx.pager(index, cards.length);
    if (!cards.length) return el.replaceChildren(allClear('Nothing needs your call right now.'));

    const card = cards[index];
    const finish = (skip = false) => {
      card.done = true;
      history.replaceState(null, '', feedPath(Math.min(index, Math.max(0, cards.length - 2))));
      showToast(skip ? 'Set aside' : card.recommendation ? 'Decision approved' : 'Spec shipped', () => {
        card.done = false;
        if (el.isConnected && el.dataset.page === 'feed') {
          history.replaceState(null, '', feedPath(index));
          redraw();
          el.querySelector('.v2-card-title')?.focus();
        } else {
          redraw();
        }
      });
      redraw();
    };
    OW.factory.redraw(el, () => el.replaceChildren(h('article', { class: 'v2-hero-card', 'data-kind': card.recommendation ? 'decision' : 'spec' },
      h('header', {},
        h('div', { class: 'v2-card-kicker v2-mono' }, card.status),
        h('h2', { class: 'v2-card-title', tabindex: '-1' }, card.title),
        h('p', { class: 'v2-card-goal' }, card.goal)),
      card.recommendation ? h('p', { class: 'v2-recommendation' }, 'Recommended: ', h('strong', {}, card.recommendation)) : renderPreview(card),
      card.recommendation ? null : progress(card.merged, card.total),
      card.note ? h('p', { class: 'v2-card-note' }, 'Requested change: ', card.note) : null,
      h('div', { class: 'v2-card-actions' },
        button('Ship it', 'primary', () => finish(), {
          'data-focus': 'ship', disabled: !card.recommendation && card.merged < card.total,
        }),
        button('Change something', '', event => openChange(card, event.currentTarget), { 'data-focus': 'change' }),
        button('Not now', 'text', () => finish(true), { 'data-focus': 'defer' })))));
  }

  function liveFeed(el, feeds, arg, ctx) {
    let queue = el.querySelector('.v2-live-feed');
    if (!queue) {
      queue = h('div', { class: 'v2-live-feed' });
      el.replaceChildren(queue);
    }
    OW.queue.render(queue, feeds, (missing, cards, empty) => {
      const index = feedIndex(arg, cards.length);
      ctx.pager(index, cards.length);
      cards.forEach((card, i) => { card.hidden = i !== index; });
      if (!cards.length) {
        queue.replaceChildren(...[missing || empty].filter(Boolean));
      } else {
        const list = queue.querySelector('.queue') || h('div', { class: 'queue' });
        if (!list.isConnected) queue.replaceChildren(list);
        queue.querySelector(':scope > .unknown')?.remove();
        if (missing) queue.prepend(missing);
        const kept = new Set(cards);
        for (const child of [...list.children]) if (!kept.has(child)) child.remove();
        cards.forEach((card, i) => {
          const at = list.children[i] || null;
          if (at !== card) list.insertBefore(card, at);
        });
      }
      ctx.syncNav();
    });
  }

  function settingsValue(value) {
    return h('span', { class: 'v2-setting-value' }, value);
  }

  function settingRow(label, value, content) {
    const heading = h('span', { class: 'v2-setting-label' }, label);
    if (!content) return h('div', { class: 'v2-setting-row' }, heading, settingsValue(value));
    return h('details', { class: 'v2-setting' },
      h('summary', { class: 'v2-setting-row' }, heading, settingsValue(value), icon('chevron')),
      h('div', { class: 'v2-setting-detail' }, content));
  }

  function demoSettings() {
    const s = demo.settings;
    const choices = (key, label, values) => h('div', { class: 'v2-choices', role: 'group', 'aria-label': label }, values.map(value =>
      button(value, '', event => {
        s[key] = value;
        const group = event.currentTarget.parentElement;
        for (const choice of group.children) choice.setAttribute('aria-pressed', String(choice === event.currentTarget));
        group.closest('details').querySelector('.v2-setting-value').textContent = value;
      }, { 'aria-pressed': String(value === s[key]) })));
    const daily = h('output', {}, `$${s.dailyCap} / day`);
    const monthly = h('output', {}, `$${s.monthlyCap} / month`);
    const cap = (id, label, display, value, min, max, step, change) => h('div', { class: 'v2-cap' },
      h('label', { for: id }, label), display,
      h('input', { id, type: 'range', min, max, step, value, oninput: change }));
    return [
      settingRow('Where it runs', s.host, choices('host', 'Where it runs', ['Home computer', 'Cloud workspace'])),
      settingRow('Effort', s.effort, choices('effort', 'Effort', ['Fast', 'Balanced', 'Thorough'])),
      settingRow('Models', 'Recommended'),
      settingRow('Connections', 'GitHub connected', [
        h('p', {}, 'GitHub · Connected'),
        h('p', {}, 'Model provider · Not connected'),
      ]),
      settingRow('Budget', daily.textContent, [
        cap('daily-cap', 'Daily cap', daily, s.dailyCap, 10, 100, 5, event => {
          s.dailyCap = Number(event.target.value);
          daily.value = `$${s.dailyCap} / day`;
          event.target.closest('details').querySelector('.v2-setting-value').textContent = daily.value;
        }),
        cap('monthly-cap', 'Monthly cap', monthly, s.monthlyCap, 100, 1000, 25, event => {
          s.monthlyCap = Number(event.target.value);
          monthly.value = `$${s.monthlyCap} / month`;
        }),
        h('label', { class: 'v2-cap-pause' },
          h('input', { type: 'checkbox', checked: s.pauseAtCap, onchange: event => { s.pauseAtCap = event.target.checked; } }),
          'Pause builds at the cap'),
      ]),
      settingRow('Repository', s.repository),
      h('a', { class: 'v2-btn text v2-sign-out', href: '#/welcome' }, 'Sign out'),
    ];
  }

  function liveSettings(ctx) {
    const soon = 'Coming soon';
    return [
      h('div', { class: 'v2-setting-row v2-repository' }, h('span', { class: 'v2-setting-label' }, 'Repository'), ctx.repoSwitch()),
      settingRow('Connections', 'GitHub connected'),
      settingRow('Where it runs', soon),
      settingRow('Effort', soon),
      settingRow('Models', soon),
      settingRow('Budget', soon),
      settingRow('Data freshness', null, h('div', { class: 'v2-freshness' })),
      button('Sign out', 'text v2-sign-out', ctx.signOut),
    ];
  }

  function renderSettings(el, ctx) {
    if (!el.querySelector('.v2-settings')) {
      el.replaceChildren(h('div', { class: 'v2-settings' }, isDemo ? demoSettings() : liveSettings(ctx)));
    }
    const freshness = el.querySelector('.v2-freshness');
    if (freshness) freshness.replaceChildren(...ctx.freshnessNodes());
  }

  function renderWelcome(root, { note, demoMode }) {
    const cta = demoMode
      ? h('a', { class: 'v2-btn primary', href: '#/chat' }, 'Open Harbor workspace', icon('right'))
      : h('a', { class: 'v2-btn primary', href: '/api/sign-in/start' }, 'Continue with GitHub', icon('right'));
    const card = h('section', { class: 'v2-welcome-card' },
      h('header', { class: 'v2-welcome-head' },
        h('div', { class: 'v2-welcome-brand' }, h('img', { src: '/app/mark.svg', alt: '', width: 28, height: 28 }), 'OpenWiz'),
        demoMode ? h('span', { class: 'v2-sample-tag' }, 'Sample data') : null),
      h('h1', {}, 'Run your software factory from here.'),
      note ? h('div', { class: 'notice bad', role: 'alert' }, icon('warn'), h('span', {}, note)) : null,
      cta,
      demoMode ? null : h('a', { class: 'v2-btn text v2-sample-link', href: '/app/?demo=1#/welcome' }, 'See a sample factory'));
    root.replaceChildren(
      h('div', { class: 'v2-backdrop welcome', 'aria-hidden': 'true' }),
      h('main', { class: 'v2-welcome-stage' }, card));
    document.title = 'OpenWiz';
  }

  OW.v2 = {
    setRedraw: fn => { redraw = fn; },
    renderWelcome,
    allClear,
    progress,
    pages(ctx) {
      return [
        { id: 'chat', title: 'Chat', icon: 'chat', feeds: [], render: renderChat },
        { id: 'feed', title: 'Feed', icon: 'feed', feeds: isDemo ? [] : ['specs'],
          badge: feeds => isDemo ? activeCards().length : OW.queue.badge(feeds),
          render: (el, feeds, arg) => isDemo ? demoFeed(el, arg, ctx) : liveFeed(el, feeds, arg, ctx) },
        { id: 'settings', title: 'Settings', icon: 'settings', feeds: [], bottom: true,
          render: el => renderSettings(el, ctx) },
      ];
    },
  };
})();
