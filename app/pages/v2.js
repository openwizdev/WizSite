'use strict';
(() => {
  const { h, icon } = OW.ui;
  const isDemo = OW.data.demo;

  const focusKey = key => ({ 'data-focus': key });
  const mark = () => h('img', { src: '/app/mark.svg', alt: '', width: 24, height: 24 });

  function steps(current) {
    return h('ol', { class: 'v2-steps', 'aria-label': 'Sample walkthrough' },
      ['Grill', 'Watch', 'Decide'].map((step, i) => h('li', {
        'aria-current': step === current ? 'step' : null,
      }, h('span', { 'aria-hidden': 'true' }, String(i + 1)), step)));
  }

  function initialDemoState() {
    return {
      draft: '',
      messages: [
        {
          role: 'user',
          text: 'Add usage-based seat billing to Harbor.',
        },
        {
          role: 'wiz',
          text: 'Three quick choices before I draft the spec.',
        },
        {
          role: 'grill',
          specTitle: 'Usage-based seat billing',
          answered: false,
          questions: [
            { prompt: 'When should we charge for new seats?', rec: 0, selected: 0, options: ['At month end', 'Right away'] },
            { prompt: 'Should read-only seats be free?', rec: 0, selected: 0, options: ['Free for viewers', 'Charge for all'] },
            { prompt: 'How long can teams edit after a failed renewal?', rec: 0, selected: 0, options: ['7-day grace', '48-hour grace'] },
          ],
        },
      ],
      cards: [
        {
          type: 'spec',
          status: 'ready',
          kicker: 'Spec · Ready to ship',
          title: 'Magic-link sign-in',
          goal: 'Let people sign in without passwords using 15-minute email links.',
          merged: 6,
          total: 6,
          scenes: [
            '0:02 · Enter your email to get a sign-in link.',
            '0:05 · Open the link to sign in.',
            '0:08 · Pick up where you left off.',
          ],
          sceneIdx: 0,
        },
        {
          type: 'decision',
          status: 'pending',
          kicker: 'Needs you',
          title: 'Pricing copy on the checkout banner',
          goal: 'Show annual savings as a percentage or a dollar amount?',
          context: 'The rest of the pricing page uses percentages, so customers can compare plans at a glance.',
          rec: 'Show "Save 20%"',
        },
        {
          type: 'spec',
          status: 'building',
          kicker: 'Spec · Building',
          title: 'CSV export for audit log',
          goal: 'Export up to 90 days of workspace events as a streaming CSV file.',
          merged: 5,
          total: 7,
          scenes: [
            '0:02 · Pick date range (7d / 30d / 90d)',
            '0:05 · Streams rows without memory spikes',
            '0:08 · 2 tickets left: signed download + rate limit',
          ],
          sceneIdx: 0,
        },
        {
          type: 'decision',
          status: 'pending',
          kicker: 'Needs you',
          title: 'Retention window for deleted projects',
          goal: 'Keep soft-deleted projects recoverable for 30 days or purge after 7 days?',
          context: 'Storage cost is under $2/mo; 30 days matches standard workspace recovery expectations.',
          rec: '30-day recovery window',
        },
      ],
      settings: {
        host: 'Local computer',
        effort: 'Balanced',
        dailyCap: 25,
        monthlyCap: 400,
        spendToday: 6.4,
        pauseAtCap: true,
      },
    };
  }

  let demo = initialDemoState();
  let redraw = () => {};
  let toastTimer = null;
  let toastUndo = null;
  let toastEl = null;
  let sheetEl = null;
  let sheetCard = null;
  let sheetOpener = null;

  function ensureChrome() {
    if (toastEl) return;
    const msg = h('span');
    const undo = h('button', {
      type: 'button', class: 'v2-text-btn', hidden: true,
      onclick: () => {
        toastEl.hidden = true;
        clearTimeout(toastTimer);
        toastUndo?.();
        toastUndo = null;
      },
    }, 'Undo');
    toastEl = h('div', { class: 'v2-toast', role: 'status', hidden: true }, msg, undo);
    toastEl._msg = msg;
    toastEl._undo = undo;
    document.body.append(toastEl);

    const title = h('h2', { id: 'v2-sheet-title' }, 'Change something');
    const input = h('input', {
      type: 'text', class: 'v2-sheet-input', placeholder: 'What should change?',
      'aria-label': 'What should change?', required: true, autofocus: true,
    });
    const close = () => sheetEl.close();
    const submit = event => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return input.focus();
      sheetCard.note = text;
      demo.messages.push({ role: 'user', text: `On “${sheetCard.title}”: ${text}` });
      showToast('Change requested');
      close();
      sheetOpener?.focus();
      redraw();
    };
    sheetEl = h('dialog', { class: 'v2-sheet', 'aria-labelledby': 'v2-sheet-title' },
      h('form', { onsubmit: submit },
        title,
        h('p', { class: 'v2-sheet-sub' }),
        input,
        h('button', {
          type: 'button', class: 'v2-q-pill',
          onclick: () => { input.value = 'Split this into a smaller first release.'; input.focus(); },
        }, 'Make it smaller'),
        h('div', { class: 'v2-sheet-actions' },
          h('button', { type: 'button', class: 'v2-btn', onclick: close }, 'Cancel'),
          h('button', { type: 'submit', class: 'v2-btn primary' }, 'Send change'))));
    sheetEl.addEventListener('close', () => sheetOpener?.focus());
    document.body.append(sheetEl);
  }

  function showToast(text, undoFn = null) {
    ensureChrome();
    toastEl._msg.textContent = text;
    toastUndo = undoFn;
    toastEl._undo.hidden = !undoFn;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4500);
  }

  function openSheet(card, opener) {
    ensureChrome();
    sheetCard = card;
    sheetOpener = opener;
    sheetEl.querySelector('p').textContent = card.title;
    sheetEl.querySelector('input').value = '';
    sheetEl.showModal();
  }

  function completeGrill(round) {
    if (round.answered) return;
    round.answered = true;
    const answers = round.questions.map(q => q.options[q.selected]);
    demo.cards.unshift({
      type: 'spec',
      status: 'ready',
      kicker: 'Spec · Ready to ship',
      title: round.specTitle,
      goal: round.specGoal || `New seats: ${answers[0].toLowerCase()}. ${answers[1]}. ${answers[2]}.`,
      merged: 5,
      total: 5,
      scenes: answers.map((answer, i) => `0:0${2 + i * 3} · ${answer}`),
      sceneIdx: 0,
    });
    if (location.hash === '#/feed') redraw();
    else location.hash = '#/feed';
    showToast('Your answers are in. The spec is ready to review.');
  }

  function submitChatPrompt(text) {
    const clean = text.trim();
    if (!clean) return;
    demo.messages.push({ role: 'user', text: clean }, {
      role: 'grill',
      specTitle: clean.length > 56 ? `${clean.slice(0, 55)}…` : clean,
      specGoal: clean,
      answered: false,
      questions: [
        { prompt: 'Who should get this first?', rec: 0, selected: 0, options: ['A small group', 'Everyone'] },
        { prompt: 'Should people be able to switch it off?', rec: 0, selected: 0, options: ['Add a toggle', 'Always on'] },
        { prompt: 'Would a quick walkthrough help?', rec: 0, selected: 0, options: ['Show a preview', 'Skip preview'] },
      ],
    });
    demo.draft = '';
    redraw();
    const scroll = document.querySelector('.v2-chat-scroll');
    scroll.scrollTop = scroll.scrollHeight;
  }

  function grillCard(round) {
    const label = () => round.questions.every(q => q.selected === q.rec) ? 'Accept all 3' : 'Send 3 answers';
    const submit = h('button', { type: 'button', class: 'v2-btn primary', onclick: () => completeGrill(round) }, label(), icon('right'));
    const hint = h('p', { class: 'v2-grill-hint' }, 'Recommended answers selected');
    const questions = round.questions.map((q, i) => {
      const id = `v2-question-${demo.messages.indexOf(round)}-${i}`;
      const buttons = q.options.map((option, index) => h('button', {
        type: 'button',
        class: 'v2-q-pill',
        'aria-pressed': q.selected === index ? 'true' : 'false',
        'aria-label': q.rec === index ? `${option}, recommended` : null,
        disabled: round.answered,
        onclick: () => {
          q.selected = index;
          buttons.forEach((button, n) => button.setAttribute('aria-pressed', String(n === index)));
          submit.firstChild.textContent = label();
          hint.textContent = label() === 'Accept all 3' ? 'Recommended answers selected' : 'Answers ready to send';
        },
      }, option, q.rec === index ? icon('check') : null));
      return h('div', { class: 'v2-grill-q', role: 'group', 'aria-labelledby': id },
        h('p', { id }, q.prompt), h('div', { class: 'v2-q-opts' }, buttons));
    });
    return h('section', { class: 'v2-grill' },
      h('header', { class: 'v2-grill-head' }, h('h2', {}, round.specTitle), round.answered ? null : hint),
      questions,
      h('div', { class: 'v2-grill-foot' }, round.answered
        ? h('a', { class: 'v2-text-btn', href: '#/feed' }, icon('check'), 'Answers sent · View Feed')
        : submit));
  }

  function renderDemoChat(el) {
    const oldScroll = el.querySelector('.v2-chat-scroll');
    const scroll = h('div', { class: 'v2-chat-scroll' },
      h('div', { class: 'v2-thread' }, steps('Grill'),
        demo.messages.map(m => m.role === 'grill' ? grillCard(m)
          : h('div', { class: `v2-msg ${m.role}` },
            m.role === 'wiz' ? mark() : null,
            h('p', { class: 'v2-bubble' }, m.text)))));
    const composer = el.querySelector('.v2-composer-wrap');
    if (composer) {
      oldScroll.replaceWith(scroll);
      scroll.scrollTop = oldScroll.scrollTop;
      composer.querySelector('input').value = demo.draft;
      return;
    }
    const input = h('input', {
      type: 'text',
      placeholder: 'Tell Wiz what to build or change…',
      'aria-label': 'Tell Wiz what to build or change',
      value: demo.draft,
      oninput: event => { demo.draft = event.target.value; },
    });
    const send = h('button', {
      type: 'submit', class: 'v2-send-btn', 'aria-label': 'Send message',
    }, icon('up'));
    const form = h('form', { class: 'v2-composer', onsubmit: event => {
      event.preventDefault();
      submitChatPrompt(input.value);
    } }, input, send);
    el.replaceChildren(h('div', { class: 'v2-chat-wrap' },
      scroll, h('div', { class: 'v2-composer-wrap' }, form)));
  }

  function renderLiveChat(el) {
    if (el.firstChild) return;
    const input = h('input', { type: 'text', disabled: true, placeholder: 'Tell Wiz what to build or change…', 'aria-label': 'Chat composer' });
    el.replaceChildren(h('div', { class: 'v2-chat-wrap' },
      h('div', { class: 'v2-chat-scroll' },
        h('div', { class: 'v2-chat-empty' },
          h('h2', {}, 'Chat is coming soon'),
          h('p', {}, 'Your specs and decisions are in Feed.'),
          h('a', { class: 'v2-btn primary', href: '#/feed' }, 'Open Feed', icon('right')))),
      h('div', { class: 'v2-composer-wrap' }, h('div', { class: 'v2-composer' }, input))));
  }

  function visibleDemoCards() {
    return demo.cards.filter(c => c.status !== 'shipped' && c.status !== 'decided' && c.status !== 'deferred');
  }

  function renderDemoFeed(el, arg) {
    const list = visibleDemoCards();
    if (!list.length) {
      el.replaceChildren(h('div', { class: 'v2-feed-stage' },
        h('div', { class: 'v2-clear-card' },
          h('h2', {}, 'All clear'),
          h('p', {}, 'Nothing is waiting on you.'),
          h('a', { class: 'v2-btn primary', href: '#/chat' }, 'Open Chat'),
          h('button', { type: 'button', class: 'v2-text-btn', onclick: () => {
            demo = initialDemoState();
            if (arg) location.hash = '#/feed';
            else redraw();
          } }, 'Restart sample'))));
      return;
    }

    const index = Math.min(list.length - 1, Number(arg || 1) - 1);
    const card = list[index];
    const decision = card.type === 'decision';
    const finish = (status, message) => {
      const was = card.status;
      card.status = status;
      if (index >= visibleDemoCards().length && arg) history.replaceState(null, '', '#/feed');
      showToast(message, () => {
        card.status = was;
        redraw();
        el.querySelector('.v2-card-title')?.focus();
      });
      redraw();
    };

    const art = h('div', { class: `v2-preview${decision ? ' v2-decision-preview' : ''}` },
      h('div', { class: 'v2-preview-art', 'aria-hidden': 'true' }),
      h('div', { class: 'v2-preview-dither', 'aria-hidden': 'true' }),
      decision ? null : h('div', { class: 'v2-preview-top' },
        h('span', {}, 'Narrated spec · 0:09'),
        h('button', { type: 'button', class: 'v2-preview-btn', 'aria-label': 'Next scene', onclick: event => {
          card.sceneIdx = (card.sceneIdx + 1) % card.scenes.length;
          event.currentTarget.textContent = `Scene ${card.sceneIdx + 1} / ${card.scenes.length}`;
          el.querySelector('.v2-preview-caption').textContent = card.scenes[card.sceneIdx];
        } }, `Scene ${card.sceneIdx + 1} / ${card.scenes.length}`)),
      decision ? null : h('p', { class: 'v2-preview-caption', 'aria-live': 'polite' }, card.scenes[card.sceneIdx]));
    const detail = decision
      ? h('div', { class: 'v2-decision-box' },
        h('span', { class: 'v2-label' }, 'Recommendation'),
        h('strong', {}, card.rec),
        h('p', {}, card.context))
      : h('div', { class: 'v2-progress-box' },
        h('strong', {}, `${card.merged} of ${card.total} tickets merged`),
        h('div', { class: 'v2-pips', 'aria-hidden': 'true' },
          Array.from({ length: card.total }, (_, i) => h('span', { class: i < card.merged ? 'merged' : '' }))));
    const actions = h('div', { class: 'v2-card-actions' },
      h('button', {
        type: 'button', class: 'v2-btn primary ship', disabled: card.status === 'building',
        onclick: () => finish(decision ? 'decided' : 'shipped', decision ? 'Decision approved' : 'Spec shipped'),
      }, icon('check'), 'Ship it'),
      h('button', { type: 'button', class: 'v2-btn', ...focusKey('change'), onclick: event => openSheet(card, event.currentTarget) }, 'Change something'),
      h('button', { type: 'button', class: 'v2-btn', onclick: () => finish('deferred', 'Saved for later') }, 'Not now'));

    el.replaceChildren(h('div', { class: 'v2-feed-stage' },
      h('div', { class: 'v2-feed-toolbar' },
        steps(decision ? 'Decide' : 'Watch'),
        pager(index, list.length, n => { location.hash = n ? `#/feed/${n + 1}` : '#/feed'; })),
      h('article', { class: 'v2-hero-card' },
        h('header', { class: 'v2-card-head' },
          h('span', { class: 'v2-label' }, card.kicker),
          h('h2', { class: 'v2-card-title', tabindex: '-1' }, card.title),
          h('p', { class: 'v2-card-goal' }, card.goal)),
        art, detail,
        card.note ? h('p', { class: 'v2-note-pill' }, `Requested change: ${card.note}`) : null,
        actions)));
  }

  function pager(index, count, go) {
    return h('div', { class: 'v2-feed-rail', 'aria-label': 'Card navigation' },
      h('button', { type: 'button', class: 'v2-rail-btn', ...focusKey('previous'), 'aria-label': 'Previous card', disabled: index === 0, onclick: () => go(index - 1) }, icon('up')),
      h('span', { class: 'v2-rail-count', 'aria-live': 'polite' }, `${index + 1} / ${count}`),
      h('button', { type: 'button', class: 'v2-rail-btn', ...focusKey('next'), 'aria-label': 'Next card', disabled: index >= count - 1, onclick: () => go(index + 1) }, icon('down')));
  }

  function panel(title, ...content) {
    return h('section', { class: 'v2-panel' }, h('h2', {}, title), content.flat());
  }

  const row = (label, value) => h('div', { class: 'v2-set-row' }, h('span', {}, label), value);
  const value = (text, className = 'v2-setting-value') => h('span', { class: className }, text);

  function chooseSetting(label, setting, choices) {
    return h('select', { 'aria-label': label, onchange: event => { demo.settings[setting] = event.target.value; } },
      choices.map(choice => h('option', { selected: demo.settings[setting] === choice }, choice)));
  }

  function capInput(label, setting, min, max, step, unit) {
    const id = `v2-${setting}`;
    const text = () => `$${demo.settings[setting]} / ${unit}`;
    const output = h('output', { for: id }, text());
    return h('div', { class: 'v2-cap' },
      h('div', {}, h('label', { for: id }, label), output),
      h('input', { id, type: 'range', min, max, step, value: demo.settings[setting], oninput: event => {
        demo.settings[setting] = Number(event.target.value);
        output.textContent = text();
      } }));
  }

  function renderDemoSettings(el) {
    if (el.firstChild) return;
    const s = demo.settings;
    el.replaceChildren(h('div', { class: 'v2-settings-scroll' },
      h('div', { class: 'v2-settings-grid' },
        panel('Factory',
          row('Where it runs', chooseSetting('Where it runs', 'host', ['Local computer', 'Cloud'])),
          row('Effort', chooseSetting('Effort', 'effort', ['Fast', 'Balanced', 'Thorough'])),
          row('Models', value('Recommended'))),
        panel('Connections',
          row('GitHub', value('Connected', 'v2-status connected')),
          row('Model provider', value('Connected', 'v2-status connected')),
          row('Issue tracker', value('Not connected', 'v2-status'))),
        panel('Budget',
          h('p', { class: 'v2-panel-note' }, `$${s.spendToday.toFixed(2)} spent today`),
          capInput('Daily cap', 'dailyCap', 10, 100, 5, 'day'),
          capInput('Monthly cap', 'monthlyCap', 100, 1500, 50, 'month'),
          h('label', { class: 'v2-budget-check' }, h('input', {
            type: 'checkbox', checked: s.pauseAtCap, onchange: event => { s.pauseAtCap = event.target.checked; },
          }), 'Pause new builds at the cap')),
        panel('Repository',
          row('Workspace', value('Harbor')),
          h('a', { class: 'v2-text-btn', href: '#/welcome' }, 'Sign out')))));
  }

  function renderLiveSettings(el, ctx) {
    if (!el.firstChild) {
      el.replaceChildren(h('div', { class: 'v2-settings-scroll' },
        h('div', { class: 'v2-settings-grid' },
          panel('Repository',
            ctx.repoSwitch(),
            h('button', { type: 'button', class: 'v2-text-btn', onclick: ctx.signOut }, 'Sign out')),
          panel('Connections', row('GitHub', value('Connected', 'v2-status connected'))),
          panel('Factory', ['Where it runs', 'Effort', 'Models', 'Budget'].map(label => row(label, value('Coming soon')))),
          panel('Data freshness', h('div', { class: 'v2-freshness' })))));
    }
    el.querySelector('.v2-freshness').replaceChildren(...ctx.freshnessNodes());
  }

  function renderWelcome(root, { note, demoMode }) {
    root.replaceChildren(h('main', { class: 'v2-welcome-stage' },
      h('header', { class: 'v2-welcome-head' },
        h('span', { class: 'v2-welcome-brand' }, mark(), 'OpenWiz'),
        demoMode ? value('Sample data', 'v2-sample-tag') : null),
      h('div', { class: 'v2-welcome-card' },
        h('h1', {}, 'Run your software factory from here.'),
        h('p', {}, demoMode ? 'Answer three quick questions. Watch a spec take shape. Tap Ship it.' : 'See your specs, follow progress, and find the decisions waiting on you.'),
        note ? h('div', { class: 'notice bad', role: 'alert' }, icon('warn'), h('span', {}, note)) : null,
        h('div', { class: 'v2-welcome-actions' },
          h('a', { class: 'v2-btn primary', href: demoMode ? '#/chat' : '/api/sign-in/start' },
            demoMode ? 'Open Harbor workspace' : 'Continue with GitHub', icon('right')),
          demoMode ? null : h('a', { class: 'v2-text-btn', href: '?demo=1#/chat' }, 'See a sample factory')))));
    document.title = 'OpenWiz';
  }

  OW.v2 = {
    pager,
    setRedraw: fn => { redraw = fn; },
    renderWelcome,
    pages(ctx) {
      return [
        {
          id: 'chat',
          title: 'Chat',
          icon: 'chat',
          feeds: [],
          render(el) {
            if (isDemo) renderDemoChat(el);
            else renderLiveChat(el);
          },
        },
        {
          id: 'feed',
          title: 'Feed',
          icon: 'feed',
          feeds: isDemo ? [] : ['specs'],
          badge: feeds => isDemo ? visibleDemoCards().length : OW.queue.badge(feeds),
          render(el, feeds, arg) {
            if (isDemo) {
              renderDemoFeed(el, arg);
            } else {
              let wrap = el.querySelector('.v2-live-feed');
              if (!wrap) {
                wrap = h('div', { class: 'v2-live-feed' });
                el.replaceChildren(wrap);
              }
              OW.queue.render(wrap, feeds, arg);
            }
          },
        },
        {
          id: 'settings',
          title: 'Settings',
          icon: 'settings',
          feeds: [],
          bottom: true,
          render(el) {
            if (isDemo) renderDemoSettings(el);
            else renderLiveSettings(el, ctx);
          },
        },
      ];
    },
  };
})();
