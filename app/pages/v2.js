'use strict';
(() => {
  const { h, icon, time } = OW.ui;
  const isDemo = OW.data.demo;
  const mark = () => h('img', { src: '/app/mark.svg', alt: '', width: 28, height: 28 });

  function initialDemoState() {
    return {
      feedIdx: 0,
      draft: '',
      messages: [
        {
          id: 'm1',
          role: 'user',
          time: '9:12 AM',
          text: 'Add usage-based seat billing. Keep upgrades simple.',
        },
        {
          id: 'm2',
          role: 'wiz',
          time: '9:12 AM',
          text: 'Three quick choices before I draft.',
        },
        {
          id: 'g1',
          role: 'grill',
          specTitle: 'Usage-based seat billing',
          specGoal: 'Charge for active editors with monthly true-up, free viewers, and a 7-day renewal grace window.',
          answered: false,
          questions: [
            { id: 'Q1', prompt: 'When should we charge for new seats?', rec: 0, selected: 0, options: ['At month end', 'Right away'] },
            { id: 'Q2', prompt: 'Should read-only viewers pay?', rec: 0, selected: 0, options: ['Keep viewers free', 'Count all members'] },
            { id: 'Q3', prompt: 'How long before a failed renewal locks edits?', rec: 0, selected: 0, options: ['7 days', '48 hours'] },
          ],
        },
      ],
      cards: [
        {
          id: 'c-spec-1',
          type: 'spec',
          status: 'ready',
          kicker: 'Ready to ship',
          title: 'Magic-link sign-in',
          art: 'email',
          goal: 'Passwordless sign-in with 15-minute links and automatic session refresh.',
          merged: 6,
          total: 6,
          scenes: [
            '0:02 · Enter your email to get a sign-in link.',
            '0:05 · Open the link to start a session.',
            '0:08 · All six tickets merged.',
          ],
          sceneIdx: 0,
          note: '',
        },
        {
          id: 'c-dec-1',
          type: 'decision',
          status: 'pending',
          kicker: 'Needs you',
          title: 'Pricing copy on the checkout banner',
          goal: 'Show annual savings as a percentage or a dollar amount?',
          context: 'Annual plans save $240/yr per 10 seats. The rest of the pricing page uses percentages.',
          rec: 'Show "Save 20%"',
          note: '',
        },
        {
          id: 'c-spec-2',
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
          note: '',
        },
        {
          id: 'c-dec-2',
          type: 'decision',
          status: 'pending',
          kicker: 'Needs you',
          title: 'Retention window for deleted projects',
          goal: 'Keep soft-deleted projects recoverable for 30 days or purge after 7 days?',
          context: 'Storage cost is under $2/mo; 30 days matches standard workspace recovery expectations.',
          rec: '30-day recovery window',
          note: '',
        },
      ],
      settings: {
        host: 'Local workstation',
        effort: 'Balanced',
        models: 'Recommended',
        github: true,
        notifications: false,
        budget: '$25 / day',
        repository: 'Harbor · main',
      },
    };
  }

  const demo = isDemo ? initialDemoState() : null;
  let redraw = () => {};
  let toastTimer;
  let toastEl;
  let dismissToast;
  let chatView;

  function pauseToast() {
    clearTimeout(toastTimer);
  }

  function scheduleToast() {
    pauseToast();
    if (!toastEl.hidden && !toastEl.matches(':hover, :focus-within')) toastTimer = setTimeout(dismissToast, 4500);
  }

  function showToast(text, undo = null) {
    const returnTo = document.activeElement;
    if (!toastEl) {
      toastEl = h('div', { class: 'v2-toast', role: 'status',
        onpointerenter: pauseToast, onpointerleave: scheduleToast,
        onfocusin: pauseToast, onfocusout: () => queueMicrotask(scheduleToast) });
      document.body.append(toastEl);
    }
    dismissToast = () => {
      const focused = toastEl.contains(document.activeElement);
      toastEl.hidden = true;
      pauseToast();
      if (focused) {
        (returnTo?.isConnected && returnTo !== document.body ? returnTo : document.querySelector('.v2-head h1'))?.focus();
      }
    };
    toastEl.replaceChildren(h('span', {}, text), undo ? h('button', {
      type: 'button',
      class: 'v2-btn subtle',
      onclick: () => { dismissToast(); undo(); },
    }, 'Undo') : null);
    toastEl.hidden = false;
    scheduleToast();
  }

  function openSheet(card, opener) {
    const title = h('h2', { id: 'v2-sheet-title' }, 'Change something');
    const input = h('textarea', { rows: 3, required: true, placeholder: 'What should change?', 'aria-label': 'What should change?' });
    input.value = card.note;
    const sheet = h('dialog', { class: 'v2-sheet', 'aria-labelledby': title.id });
    const chips = [
      ['Simplify copy', 'Simplify the copy to one line'],
      ['Make it smaller', 'Split this into a smaller first release'],
    ].map(([label, text]) => h('button', {
      type: 'button',
      class: 'v2-btn',
      onclick: () => { input.value = text; input.focus(); },
    }, label));
    const form = h('form', { onsubmit: event => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return input.focus();
      card.note = text;
      demo.messages.push(
        { role: 'user', time: 'Just now', text: `On “${card.title}”: ${text}` },
        { role: 'wiz', time: 'Just now', text: `I’ll update “${card.title}” and check it again.` });
      sheet.close();
      opener.focus();
      redraw();
      showToast('Change sent');
    } }, title, h('p', {}, card.title), input,
    h('div', { class: 'v2-quick-chips' }, chips),
    h('div', { class: 'v2-sheet-actions' },
      h('button', { type: 'button', class: 'v2-btn subtle', onclick: () => sheet.close() }, 'Cancel'),
      h('button', { type: 'submit', class: 'v2-btn primary' }, 'Send change')));
    sheet.append(form);
    sheet.addEventListener('close', () => {
      sheet.remove();
      if (opener.isConnected) opener.focus();
    }, { once: true });
    document.body.append(sheet);
    sheet.showModal();
    input.focus();
  }

  function completeGrill(grill) {
    if (grill.answered) return;
    grill.answered = true;
    const summary = grill.questions.map(q => q.options[q.selected]).join(' · ');
    demo.messages.push({ id: `u-${Date.now()}`, role: 'user', time: 'Just now', text: summary });
    demo.messages.push({
      id: `w-${Date.now() + 1}`,
      role: 'wiz',
      time: 'Just now',
      text: `“${grill.specTitle}” is now in Feed.`,
      jumpFeed: true,
    });
    demo.cards.push({
      id: `c-new-${Date.now()}`,
      type: 'spec',
      status: 'building',
      kicker: 'Spec · Just started',
      title: grill.specTitle,
      goal: grill.specGoal,
      merged: 1,
      total: 5,
      scenes: [
        '0:02 · Spec drafted from your answers',
        '0:05 · Ticket 1 of 5 merged — data model ready',
        '0:08 · Building checkout and grace banner next',
      ],
      sceneIdx: 0,
      note: '',
    });
    demo.feedIdx = visibleDemoCards().length - 1;
    showToast(`Answers saved · "${grill.specTitle}" added to Feed`);
    redraw();
  }

  function submitChatPrompt(text) {
    const clean = text.trim();
    if (!clean) return;
    const shortTitle = clean.length > 42 ? `${clean.slice(0, 42).replace(/\s+\S*$/, '')}…` : clean;
    demo.messages.push({ id: `u-${Date.now()}`, role: 'user', time: 'Just now', text: clean });
    demo.messages.push({
      id: `g-${Date.now() + 1}`,
      role: 'grill',
      specTitle: shortTitle,
      specGoal: clean,
      answered: false,
      questions: [
        { id: 'Q1', prompt: 'Ship to everyone at once, or roll out to active workspaces first?', rec: 0, selected: 0, options: ['Active workspaces first', 'Everyone at once'] },
        { id: 'Q2', prompt: 'Include an opt-out toggle in workspace settings?', rec: 0, selected: 0, options: ['Yes, one-click toggle', 'Always on'] },
        { id: 'Q3', prompt: 'Should Wiz record a short walkthrough video for the Feed?', rec: 0, selected: 0, options: ['Yes, 10s walkthrough', 'Skip video'] },
      ],
    });
    redraw();
  }

  function renderQuestions(message) {
    const allRecommended = () => message.questions.every(q => q.selected === q.rec);
    const hint = h('p');
    const savedLink = () => h('a', { class: 'v2-btn subtle', href: '#/feed', 'data-focus': `send:${message.id}` },
      icon('check'), 'Answers saved · Open Feed');
    const submit = h('button', { type: 'button', class: 'v2-btn primary', 'data-focus': `send:${message.id}`,
      onclick: () => {
        const focused = document.activeElement === submit;
        const link = savedLink();
        submit.replaceWith(link);
        for (const option of card.querySelectorAll('.v2-q-pill')) option.disabled = true;
        if (focused) link.focus({ preventScroll: true });
        completeGrill(message);
      },
    });
    const sync = () => {
      const recommended = allRecommended();
      const nextHint = recommended ? 'Recommended answers selected' : 'Review your selected answers';
      const nextAction = recommended ? 'Accept all 3' : 'Send 3 answers';
      if (hint.textContent !== nextHint) hint.textContent = nextHint;
      if (submit.textContent !== nextAction) submit.textContent = nextAction;
    };
    const questions = message.questions.map(q => {
      const choices = q.options.map((option, i) => h('button', {
        type: 'button', class: 'v2-q-pill', 'aria-pressed': String(i === q.selected),
        'aria-label': i === q.rec ? `${option} (recommended)` : option,
        disabled: message.answered,
        onclick: () => {
          if (q.selected === i) return;
          choices[q.selected].setAttribute('aria-pressed', 'false');
          q.selected = i;
          choices[i].setAttribute('aria-pressed', 'true');
          sync();
        },
      }, i === q.rec ? icon('check') : null, option));
      return h('div', { class: 'v2-grill-q' }, h('p', {}, q.prompt),
        h('div', { class: 'v2-q-opts', role: 'group', 'aria-label': q.prompt }, choices));
    });
    sync();
    const card = h('article', { class: 'v2-grill', 'aria-label': message.specTitle },
      h('div', { class: 'v2-grill-head' }, h('h2', {}, message.specTitle), hint), questions,
      h('div', { class: 'v2-grill-foot' }, message.answered ? savedLink() : submit));
    return card;
  }

  function renderDemoChat(el) {
    if (!chatView || !el.contains(chatView.scroll)) {
      const scroll = h('div', { class: 'v2-chat-scroll', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' });
      const thread = h('div', { class: 'v2-chat-thread' });
      scroll.append(thread);
      const input = h('input', {
        type: 'text',
        placeholder: 'Tell Wiz what to build or change…',
        'aria-label': 'Tell Wiz what to build or change',
      });
      input.value = demo.draft;
      const send = h('button', { type: 'submit', class: 'v2-send-btn', 'aria-label': 'Send message',
        disabled: !demo.draft.trim() }, icon('up'));
      input.addEventListener('input', () => {
        demo.draft = input.value;
        send.disabled = !demo.draft.trim();
      });
      const composer = h('form', { class: 'v2-composer', onsubmit: event => {
        event.preventDefault();
        const text = input.value;
        if (!text.trim()) return;
        input.value = '';
        demo.draft = '';
        send.disabled = true;
        submitChatPrompt(text);
        input.focus({ preventScroll: true });
      } }, input, send);
      el.replaceChildren(h('div', { class: 'v2-chat-wrap' }, scroll, h('div', { class: 'v2-composer-wrap' }, composer)));
      chatView = { scroll, thread, length: 0 };
    }
    const { scroll, thread, length } = chatView;
    const added = demo.messages.slice(length);
    if (!added.length) return;
    thread.append(...added.map(message => {
      if (message.role === 'grill') return h('div', { class: 'v2-msg questions' }, renderQuestions(message));
      const fromWiz = message.role === 'wiz';
      return h('div', { class: `v2-msg ${fromWiz ? 'wiz' : 'user'}` },
        fromWiz ? h('span', { class: 'v2-avatar' }, mark()) : null,
        h('div', { class: 'v2-bubble' },
          h('div', { class: 'v2-meta' }, `${fromWiz ? 'Wiz' : 'You'} · ${message.time}`),
          h('p', {}, message.text),
          message.jumpFeed ? h('a', { class: 'v2-btn subtle', href: '#/feed', 'data-focus': 'chat-feed' }, 'Open in Feed', icon('right')) : null));
    }));
    chatView.length = demo.messages.length;
    const last = thread.lastElementChild;
    if (length && last.classList.contains('questions')) {
      scroll.scrollTop += last.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 8;
    }
  }

  function renderLiveChat(el) {
    if (el.querySelector('.v2-chat-empty')) return;
    const input = h('input', { type: 'text', disabled: true, placeholder: 'Chat is coming soon', 'aria-label': 'Chat composer' });
    const send = h('button', { type: 'button', class: 'v2-send-btn', disabled: true, 'aria-label': 'Send message' }, icon('up'));
    el.replaceChildren(h('div', { class: 'v2-chat-wrap' },
      h('div', { class: 'v2-chat-scroll' },
        h('div', { class: 'v2-chat-empty' },
          h('h2', {}, 'Chat is coming soon'),
          h('p', {}, 'Review specs and questions from your repository in Feed.'),
          h('a', { class: 'v2-btn primary', href: '#/feed' }, 'Open Feed', icon('right')))),
      h('div', { class: 'v2-composer-wrap' }, h('div', { class: 'v2-composer' }, input, send))));
  }

  function visibleDemoCards() {
    return demo.cards.filter(card => !['shipped', 'decided', 'deferred'].includes(card.status));
  }

  function feedIndex(list, arg) {
    const linked = arg ? list.findIndex(card => card === demo.cards[Number(arg) - 1]) : -1;
    return linked >= 0 ? linked : Math.min(demo.feedIdx, list.length - 1);
  }

  function pager(index, total, go) {
    if (total < 2) return null;
    const button = (label, glyph, next) => h('button', {
      type: 'button', class: 'v2-rail-btn', 'aria-label': label,
      'data-focus': glyph, disabled: next < 0 || next >= total,
      onclick: () => go(next),
    }, icon(glyph), h('span', { class: 'visually-hidden' }, label));
    return h('div', { class: 'v2-feed-rail', role: 'group', 'aria-label': 'Card navigation' },
      button('Previous card', 'up', index - 1),
      h('span', { class: 'v2-rail-count', 'aria-live': 'polite' }, `${index + 1} / ${total}`),
      button('Next card', 'down', index + 1));
  }

  function renderDemoFeed(el, arg, controls) {
    const list = visibleDemoCards();
    if (!list.length) {
      controls.replaceChildren();
      el.replaceChildren(h('div', { class: 'v2-feed-stage v2-empty-stage' },
        h('div', { class: 'v2-clear-card' },
          h('h2', {}, 'All clear'),
          h('p', {}, 'Nothing needs your attention right now.'),
          h('div', { class: 'v2-clear-actions' },
            h('a', { class: 'v2-btn', href: '#/chat' }, 'Open Chat'),
            h('button', { type: 'button', class: 'v2-btn v2-text-btn', onclick: () => {
              demo.cards = initialDemoState().cards;
              demo.feedIdx = 0;
              redraw();
            } }, 'Reset sample feed')))));
      return;
    }

    const index = feedIndex(list, arg);
    const card = list[index];
    const decision = card.type === 'decision';
    const following = list[index + 1];
    const go = next => {
      demo.feedIdx = next;
      const number = demo.cards.indexOf(list[next]) + 1;
      history.replaceState(null, '', number === 1 ? '#/feed' : `#/feed/${number}`);
      redraw();
    };
    const resolve = (status, label) => {
      const previous = card.status;
      card.status = status;
      demo.feedIdx = Math.min(index, Math.max(0, list.length - 2));
      history.replaceState(null, '', '#/feed');
      redraw();
      showToast(`${label} “${card.title}”`, () => {
        card.status = previous;
        demo.feedIdx = index;
        redraw();
      });
    };
    const email = card.art === 'email';
    const poster = decision ? null : h('div', { class: `v2-preview${email ? ' v2-preview-email' : ''}` },
      h('div', { class: 'v2-preview-art', 'aria-hidden': 'true' }),
      email ? h('div', { class: 'v2-envelope', 'aria-hidden': 'true' }, h('span', {}, mark())) : null,
      h('div', { class: 'v2-preview-top' },
        h('span', { class: 'v2-preview-label' }, 'Narrated spec'),
        h('button', { type: 'button', class: 'v2-preview-btn', 'data-focus': 'scene',
          'aria-label': `Next scene, scene ${card.sceneIdx + 1} of ${card.scenes.length}`,
          onclick: () => { card.sceneIdx = (card.sceneIdx + 1) % card.scenes.length; redraw(); },
        }, `Scene ${card.sceneIdx + 1}/${card.scenes.length}`, icon('right'))),
      h('div', { class: 'v2-preview-caption', 'aria-live': 'polite' }, card.scenes[card.sceneIdx]));
    const details = decision
      ? h('div', { class: 'v2-decision-box' },
        h('span', { class: 'v2-label' }, 'Recommendation'),
        h('strong', {}, card.rec),
        h('p', {}, card.context))
      : h('div', { class: 'v2-progress-box' },
        h('p', {}, h('strong', {}, `${card.merged} of ${card.total}`), ' tickets merged'),
        h('div', { class: 'v2-pips', 'aria-hidden': 'true' },
          Array.from({ length: card.total }, (_, i) => h('span', { class: i < card.merged ? 'merged' : '' }))));
    const hero = h('article', { class: 'v2-hero-card' },
      h('div', { class: 'v2-card-top' },
        h('span', { class: 'v2-label' }, card.kicker),
        h('h2', { class: 'v2-card-title', tabindex: '-1' }, card.title),
        h('p', { class: 'v2-card-goal' }, card.goal)),
      poster,
      details,
      card.note ? h('p', { class: 'v2-note' }, 'Requested change: ', card.note) : null,
      h('div', { class: 'v2-card-actions' },
        h('button', { type: 'button', class: 'v2-btn primary', 'data-focus': 'ship',
          onclick: () => resolve(decision ? 'decided' : 'shipped', decision ? 'Approved' : 'Shipped') }, icon('check'), 'Ship it'),
        h('button', { type: 'button', class: 'v2-btn', 'data-focus': 'change',
          onclick: event => openSheet(card, event.currentTarget) }, 'Change something'),
        h('button', { type: 'button', class: 'v2-btn v2-text-btn', 'data-focus': 'defer',
          onclick: () => resolve('deferred', 'Saved for later') }, 'Not now')));
    const navigation = pager(index, list.length, go);
    controls.replaceChildren(...(navigation ? [navigation] : []));
    const next = following ? h('button', { type: 'button', class: 'v2-next-card', 'data-focus': 'next-card',
      onclick: () => {
        go(index + 1);
        el.querySelector('.v2-card-title')?.focus();
      },
    }, h('span', { class: 'v2-next-copy' },
      h('span', { class: 'v2-label' }, `Next · ${following.type === 'decision' ? 'Needs a decision' : 'Spec to watch'}`),
      h('span', {}, following.title)), icon('right')) : null;
    el.replaceChildren(h('div', { class: `v2-feed-stage${decision ? ' v2-decision-stage' : ''}` }, hero, next));
  }

  const settingRow = (label, value) => h('div', { class: 'v2-set-row' }, h('span', {}, label), value);
  const settingsGroup = (title, rows) => h('section', { class: 'v2-settings-group' }, h('h2', { class: 'v2-label' }, title), rows);

  function renderDemoSettings(el) {
    if (el.querySelector('.v2-settings')) return;
    const s = demo.settings;
    const choose = (label, key, values) => {
      const select = h('select', {
        'aria-label': label,
        onchange: () => { s[key] = select.value; },
      }, values.map(value => h('option', { value, selected: value === s[key] }, value)));
      return settingRow(label, h('div', { class: 'v2-set-control' }, select, icon('chevron')));
    };
    const connection = (label, key) => {
      const update = () => {
        button.textContent = s[key] ? 'Connected' : 'Not connected';
        button.setAttribute('aria-checked', String(s[key]));
      };
      const button = h('button', { type: 'button', role: 'switch', 'aria-label': label,
        onclick: () => { s[key] = !s[key]; update(); },
      });
      update();
      return settingRow(label, h('div', { class: 'v2-set-control' }, button, icon('chevron')));
    };
    el.replaceChildren(h('div', { class: 'v2-settings' },
      settingsGroup('Workspace', [
        choose('Where it runs', 'host', ['Local workstation', 'Cloud workspace']),
        choose('Effort', 'effort', ['Balanced', 'Fast', 'Thorough']),
        choose('Models', 'models', ['Recommended', 'Faster', 'Higher accuracy']),
        choose('Budget', 'budget', ['$25 / day', '$50 / day', '$100 / day']),
      ]),
      settingsGroup('Connections', [connection('GitHub', 'github'), connection('Notifications', 'notifications')]),
      settingsGroup('Account', [
        choose('Repository', 'repository', ['Harbor · main', 'Harbor · staging']),
        h('a', { class: 'v2-btn v2-text-btn v2-sign-out', href: '/app/' }, 'Exit sample workspace'),
      ])));
  }

  function renderLiveSettings(el, ctx) {
    let freshness = el.querySelector('.v2-freshness');
    if (!freshness) {
      freshness = h('div', { class: 'v2-freshness' });
      el.replaceChildren(h('div', { class: 'v2-settings' },
        settingsGroup('Workspace', ['Where it runs', 'Effort', 'Models', 'Budget'].map(label =>
          settingRow(label, h('span', { class: 'v2-muted' }, 'Coming soon')))),
        settingsGroup('Connections', [settingRow('GitHub', h('span', { class: 'v2-connected' }, 'Connected'))]),
        settingsGroup('Account', [
          settingRow('Repository', ctx.repoSwitch()),
          h('button', { class: 'v2-btn v2-text-btn v2-sign-out', type: 'button', onclick: ctx.signOut }, 'Sign out'),
        ]),
        settingsGroup('Data freshness', [freshness])));
    }
    freshness.replaceChildren(...ctx.freshnessNodes());
  }

  function renderWelcome(root, { note, demoMode }) {
    const card = h('section', { class: 'v2-welcome-card', 'aria-labelledby': 'v2-welcome-title' },
      h('header', { class: 'v2-welcome-head' },
        h('div', { class: 'v2-welcome-brand' }, mark(), h('span', {}, 'OpenWiz')),
        demoMode ? h('span', { class: 'v2-sample-tag' }, 'Sample data') : null),
      h('h1', { id: 'v2-welcome-title' }, 'Your software factory, in one quiet room.'),
      h('p', { class: 'v2-welcome-copy' }, demoMode
        ? 'Answer a few questions. Watch specs build. Tap Ship it.'
        : 'Review decisions and follow the work in your GitHub repository.'),
      note ? h('div', { class: 'notice bad', role: 'alert' }, icon('warn'), h('span', {}, note)) : null,
      h('a', { class: 'v2-btn primary', href: demoMode ? '#/chat' : '/api/sign-in/start' },
        demoMode ? 'Open Harbor workspace' : 'Continue with GitHub', icon('right')),
      demoMode ? h('a', { class: 'v2-btn v2-text-btn v2-welcome-sign-in', href: '/api/sign-in/start' }, 'Continue with GitHub') : null);
    root.replaceChildren(h('main', { class: 'v2-welcome' }, card));
    document.title = 'OpenWiz';
  }

  function readsPausedNote() {
    return h('p', { class: 'v2-read-pause' }, `GitHub’s rate limit paused reads until ${time(OW.data.limit.pausedUntil)}.`);
  }

  OW.v2 = {
    readsPausedNote,
    setRedraw: fn => { redraw = fn; },
    renderWelcome,
    pager,
    pages(ctx) {
      return [
        {
          id: 'chat',
          title: 'Chat',
          icon: 'chat',
          feeds: [],
          render(el) {
            if (isDemo) OW.factory.redraw(el, () => renderDemoChat(el));
            else renderLiveChat(el);
          },
        },
        {
          id: 'feed',
          title: 'Feed',
          icon: 'feed',
          feeds: isDemo ? [] : ['specs'],
          badge: () => (isDemo ? visibleDemoCards().length : OW.queue.badge()) || null,
          render(el, feeds, arg, controls) {
            if (isDemo) OW.factory.redraw(el.closest('main'), () => renderDemoFeed(el, arg, controls));
            else OW.queue.render(el, feeds, { arg, controls, onCount: ctx.updateBadges });
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
