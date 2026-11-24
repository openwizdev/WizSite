'use strict';
(() => {
  const { h, icon } = OW.ui;
  const isDemo = OW.data.demo;

  const EFFORT_NOTES = {
    fast: 'Fast: skips extra grill rounds on minor details and sends specs straight to Feed.',
    balanced: 'Balanced: grills once on ambiguous scope, reviews every change before showing it in Feed.',
    thorough: 'Thorough: checks edge cases and runs full verification before marking ready.',
  };

  function initialDemoState() {
    return {
      feedIdx: 0,
      messages: [
        {
          id: 'm1',
          role: 'user',
          time: '9:12 AM',
          text: 'Add usage-based seat billing to Harbor. Keep upgrades painless for small teams.',
        },
        {
          id: 'm2',
          role: 'wiz',
          time: '9:12 AM',
          text: 'Got it. Before I draft the spec and kick off builds, three quick calls — each has a recommendation you can accept in one tap.',
        },
        {
          id: 'g1',
          role: 'grill',
          round: 1,
          specTitle: 'Usage-based seat billing',
          specGoal: 'Charge for active editors with monthly true-up, free viewers, and a 7-day renewal grace window.',
          answered: false,
          questions: [
            { id: 'Q1', prompt: 'Charge for new seats right away, or true-up at month end?', rec: 0, selected: 0, options: ['True-up at month end', 'Charge immediately'] },
            { id: 'Q2', prompt: 'Do read-only viewers count toward paid seats?', rec: 0, selected: 0, options: ['Keep viewers free', 'Count all members'] },
            { id: 'Q3', prompt: 'How long should a failed renewal wait before locking edits?', rec: 0, selected: 0, options: ['7-day grace banner', 'Lock after 48 hours'] },
          ],
        },
      ],
      cards: [
        {
          id: 'c-spec-1',
          type: 'spec',
          status: 'ready',
          kicker: 'Spec · Ready to ship',
          title: 'Magic-link sign-in',
          goal: 'Passwordless sign-in with 15-minute links and automatic session refresh.',
          merged: 6,
          total: 6,
          scenes: [
            '0:02 · Enter email — single field, no password wall',
            '0:05 · One-tap link verified — session cookie rotated',
            '0:08 · All 6 tickets merged · live check green',
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
        hosts: [
          { id: 'mac-mini', name: 'Home Mac Mini', detail: 'Primary · Online · 14 ms', enabled: true },
          { id: 'cloud-burst', name: 'Cloud burst', detail: 'Auto-scale when > 3 specs run', enabled: true },
        ],
        effort: 'balanced',
        models: [
          { role: 'Orchestrator', value: 'Claude Opus 4.5', choices: ['Claude Opus 4.5', 'Claude Sonnet 4.5', 'GPT-5.2'] },
          { role: 'Builder', value: 'Codex 5.2', choices: ['Codex 5.2', 'Claude Sonnet 4.5', 'DeepSeek R2'] },
          { role: 'Reviewer', value: 'Claude Opus 4.5', choices: ['Claude Opus 4.5', 'GPT-5.2', 'Claude Sonnet 4.5'] },
          { role: 'Narrator', value: 'Claude Sonnet 4.5', choices: ['Claude Sonnet 4.5', 'GPT-5 Mini'] },
        ],
        connections: [
          { id: 'github', name: 'GitHub', detail: 'Repo & pull requests', connected: true },
          { id: 'anthropic', name: 'Anthropic', detail: 'Orchestrator & reviewer', connected: true },
          { id: 'openai', name: 'OpenAI', detail: 'Builder fleet', connected: true },
          { id: 'cloudflare', name: 'Cloudflare Tunnel', detail: 'Private home chat link', connected: true },
          { id: 'linear', name: 'Linear', detail: 'Optional issue mirror', connected: false },
        ],
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
  let sheetTargetId = null;

  function ensureChrome() {
    if (!toastEl) {
      const msg = h('span', { class: 'v2-toast-msg' });
      const undo = h('button', {
        type: 'button',
        class: 'v2-toast-undo',
        hidden: true,
        onclick: () => {
          const fn = toastUndo;
          toastUndo = null;
          toastEl.hidden = true;
          clearTimeout(toastTimer);
          if (fn) fn();
        },
      }, 'Undo');
      toastEl = h('div', { class: 'v2-toast', role: 'status', 'aria-live': 'polite', hidden: true }, msg, undo);
      toastEl._msg = msg;
      toastEl._undo = undo;
      document.body.append(toastEl);
    }
    if (!sheetEl) {
      const title = h('h2', { id: 'v2-sheet-title' }, 'Change something');
      const sub = h('p', { class: 'v2-sheet-sub' }, 'One plain sentence is enough. Wiz updates the spec.');
      const input = h('input', { type: 'text', class: 'v2-sheet-input', placeholder: 'What should change?', 'aria-label': 'What should change?' });
      const close = () => {
        sheetEl.hidden = true;
        sheetTargetId = null;
        input.value = '';
      };
      const submit = () => {
        const text = input.value.trim();
        if (!text) return input.focus();
        const card = demo.cards.find(c => c.id === sheetTargetId);
        if (card) {
          card.note = text;
          demo.messages.push({ id: `u-${Date.now()}`, role: 'user', time: 'Just now', text: `On "${card.title}": ${text}` });
          demo.messages.push({ id: `w-${Date.now() + 1}`, role: 'wiz', time: 'Just now', text: `On it. Updating "${card.title}" and re-running checks before it returns to Feed.` });
          showToast(`Change sent for "${card.title}"`);
        }
        close();
        redraw();
      };
      const chips = [
        ['Simplify copy', 'Simplify the copy to one line'],
        ['Make it smaller', 'Split this into a smaller first release'],
        ['Pause spec', 'Pause this spec until next week'],
      ].map(([label, text]) => h('button', {
        type: 'button',
        class: 'v2-qchip',
        onclick: () => { input.value = text; input.focus(); },
      }, label));
      const dialog = h('div', { class: 'v2-sheet' },
        h('div', { class: 'v2-sheet-head' }, title, h('button', { type: 'button', class: 'v2-sheet-close', 'aria-label': 'Close', onclick: close }, '×')),
        sub,
        h('div', { class: 'v2-quick-chips' }, chips),
        input,
        h('div', { class: 'v2-sheet-actions' },
          h('button', { type: 'button', class: 'v2-btn subtle', onclick: close }, 'Cancel'),
          h('button', { type: 'button', class: 'v2-btn primary', onclick: submit }, 'Send change')));
      sheetEl = h('div', {
        class: 'v2-sheet-backdrop',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'v2-sheet-title',
        hidden: true,
        onclick: event => { if (event.target === sheetEl) close(); },
        onkeydown: event => {
          if (event.key === 'Escape') close();
          if (event.key === 'Enter' && document.activeElement === input) submit();
        },
      }, dialog);
      sheetEl._title = title;
      sheetEl._input = input;
      document.body.append(sheetEl);
    }
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

  function openSheet(card) {
    ensureChrome();
    sheetTargetId = card.id;
    sheetEl._title.textContent = `Change "${card.title}"`;
    sheetEl._input.value = '';
    sheetEl.hidden = false;
    sheetEl._input.focus();
  }

  function completeGrill(grill) {
    if (grill.answered) return;
    grill.answered = true;
    const summary = grill.questions.map(q => `${q.id}: ${q.options[q.selected]}`).join(' · ');
    demo.messages.push({ id: `u-${Date.now()}`, role: 'user', time: 'Just now', text: summary });
    demo.messages.push({
      id: `w-${Date.now() + 1}`,
      role: 'wiz',
      time: 'Just now',
      text: `Locked in. "${grill.specTitle}" is now building — watch progress and ship it from Feed when ready.`,
      jumpFeed: true,
    });
    demo.cards.unshift({
      id: `c-new-${Date.now()}`,
      type: 'spec',
      status: 'building',
      kicker: 'Spec · Just started',
      title: grill.specTitle,
      goal: grill.specGoal,
      merged: 1,
      total: 5,
      scenes: [
        '0:02 · Spec drafted from your 3 grill answers',
        '0:05 · Ticket 1 of 5 merged — data model ready',
        '0:08 · Building checkout and grace banner next',
      ],
      sceneIdx: 0,
      note: '',
    });
    demo.feedIdx = 0;
    showToast(`Grill answered · "${grill.specTitle}" added to Feed`);
    redraw();
  }

  function submitChatPrompt(text) {
    const clean = text.trim();
    if (!clean) return;
    const shortTitle = clean.length > 42 ? `${clean.slice(0, 42).replace(/\s+\S*$/, '')}…` : clean;
    const roundNum = demo.messages.filter(m => m.role === 'grill').length + 1;
    demo.messages.push({ id: `u-${Date.now()}`, role: 'user', time: 'Just now', text: clean });
    demo.messages.push({
      id: `g-${Date.now() + 1}`,
      role: 'grill',
      round: roundNum,
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

  function renderDemoChat(el) {
    const scroll = h('div', { class: 'v2-chat-scroll', role: 'log', 'aria-live': 'polite' });
    for (const m of demo.messages) {
      if (m.role === 'user') {
        scroll.append(h('div', { class: 'v2-msg user' },
          h('div', { class: 'v2-bubble' },
            h('div', { class: 'v2-meta' }, `You · ${m.time}`),
            h('div', {}, m.text))));
      } else if (m.role === 'wiz') {
        scroll.append(h('div', { class: 'v2-msg wiz' },
          h('div', { class: 'v2-avatar' }, h('img', { src: '/app/mark.svg', alt: '', width: 20, height: 20 })),
          h('div', { class: 'v2-bubble' },
            h('div', { class: 'v2-meta' }, `Wiz · ${m.time}`),
            h('div', {}, m.text),
            m.jumpFeed ? h('div', { class: 'v2-jump' }, h('a', { class: 'v2-btn subtle', href: '#/feed' }, 'Open in Feed', icon('right'))) : null)));
      } else if (m.role === 'grill') {
        const allRecs = m.questions.every(q => q.selected === q.rec);
        const list = m.questions.map(q => h('div', { class: 'v2-grill-q' },
          h('div', { class: 'v2-grill-q-top' },
            h('span', { class: 'v2-q-num' }, q.id),
            h('span', { class: 'v2-q-text' }, q.prompt)),
          h('div', { class: 'v2-q-opts' }, q.options.map((opt, oi) => h('button', {
            type: 'button',
            class: `v2-q-pill${oi === q.selected ? ' selected' : ''}`,
            'aria-pressed': oi === q.selected ? 'true' : 'false',
            disabled: m.answered,
            onclick: () => {
              if (m.answered) return;
              q.selected = oi;
              redraw();
            },
          }, opt, oi === q.rec ? h('span', { class: 'v2-rec-tag' }, 'Rec') : null)))));
        const foot = m.answered
          ? h('span', { class: 'v2-grill-done' }, icon('check'), 'Answered · Spec queued in Feed')
          : h('button', {
            type: 'button',
            class: 'v2-btn primary',
            onclick: () => completeGrill(m),
          }, allRecs ? 'Accept all 3 recs' : 'Send 3 answers');
        scroll.append(h('div', { class: 'v2-msg wiz' },
          h('div', { class: 'v2-avatar' }, h('img', { src: '/app/mark.svg', alt: '', width: 20, height: 20 })),
          h('div', { class: 'v2-grill' },
            h('div', { class: 'v2-grill-head' },
              h('strong', {}, `Grill round ${m.round} · ${m.specTitle}`),
              h('span', {}, '3 plain questions')),
            ...list,
            h('div', { class: 'v2-grill-foot' }, foot))));
      }
    }
    const input = h('input', {
      type: 'text',
      placeholder: 'Tell Wiz what to build or change…',
      'aria-label': 'Tell Wiz what to build or change',
      onkeydown: event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          submitChatPrompt(input.value);
          input.value = '';
        }
      },
    });
    const send = h('button', {
      type: 'button',
      class: 'v2-send-btn',
      'aria-label': 'Send message',
      onclick: () => {
        submitChatPrompt(input.value);
        input.value = '';
      },
    }, icon('up'));
    el.replaceChildren(h('div', { class: 'v2-chat-wrap' },
      scroll,
      h('div', { class: 'v2-composer-wrap' }, h('div', { class: 'v2-composer' }, input, send))));
    requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
  }

  function renderLiveChat(el) {
    const input = h('input', { type: 'text', disabled: true, placeholder: 'Direct chat opens in OpenWiz 0.02…', 'aria-label': 'Chat composer' });
    const send = h('button', { type: 'button', class: 'v2-send-btn', disabled: true, 'aria-label': 'Send message' }, icon('up'));
    el.replaceChildren(h('div', { class: 'v2-chat-wrap' },
      h('div', { class: 'v2-chat-scroll' },
        h('div', { class: 'v2-chat-empty' },
          h('span', { class: 'v2-engraved-tag' }, 'Coming in 0.02'),
          h('h2', {}, 'Factory chat is next.'),
          h('p', {}, 'Direct conversation with your orchestrator is not wired to GitHub yet. Your live grill rounds and specs are ready in Feed.'),
          h('a', { class: 'v2-btn primary', href: '#/feed' }, 'Open Feed', icon('right')))),
      h('div', { class: 'v2-composer-wrap' }, h('div', { class: 'v2-composer' }, input, send))));
  }

  function visibleDemoCards() {
    return demo.cards.filter(c => c.status !== 'shipped' && c.status !== 'decided' && c.status !== 'deferred');
  }

  function renderDemoFeed(el, arg) {
    const active = visibleDemoCards();
    const all = demo.cards;
    let index = demo.feedIdx;
    if (arg && /^[1-9]\d*$/.test(arg)) {
      const requested = Number(arg) - 1;
      if (requested >= 0 && requested < all.length) {
        index = requested;
        demo.feedIdx = index;
      }
    }
    const showAllClear = active.length === 0 && !(arg && /^[1-9]\d*$/.test(arg));
    if (showAllClear) {
      el.replaceChildren(h('div', { class: 'v2-feed-stage' },
        h('div', { class: 'v2-clear-card' },
          h('span', { class: 'v2-chip done' }, 'All clear'),
          h('h2', {}, 'Nothing waiting on you.'),
          h('p', {}, 'Everything in Harbor is handled. Start something new in Chat whenever you are ready.'),
          h('div', { class: 'v2-clear-actions' },
            h('a', { class: 'v2-btn primary', href: '#/chat' }, 'Open Chat'),
            h('button', {
              type: 'button',
              class: 'v2-btn subtle',
              onclick: () => {
                demo = initialDemoState();
                showToast('Sample feed reset');
                redraw();
              },
            }, 'Reset sample feed')))));
      return;
    }

    const list = arg && /^[1-9]\d*$/.test(arg) ? all : active;
    if (index >= list.length) index = 0;
    if (index < 0) index = 0;
    demo.feedIdx = index;
    const card = list[index];
    const isDecision = card.type === 'decision';
    const isDone = card.status === 'shipped' || card.status === 'decided';
    const chipClass = isDone ? 'v2-chip done' : isDecision ? 'v2-chip decision' : 'v2-chip';
    const chipLabel = card.status === 'shipped' ? 'Shipped' : card.status === 'decided' ? 'Approved' : card.kicker;

    const goCard = nextIdx => {
      const bounded = Math.max(0, Math.min(list.length - 1, nextIdx));
      demo.feedIdx = bounded;
      if (arg) history.replaceState(null, '', `#/feed/${bounded + 1}`);
      redraw();
    };

    const shipCard = () => {
      const prevStatus = card.status;
      card.status = isDecision ? 'decided' : 'shipped';
      if (arg) history.replaceState(null, '', '#/feed');
      demo.feedIdx = 0;
      showToast(`${isDecision ? 'Approved' : 'Shipped'} "${card.title}"`, () => {
        card.status = prevStatus;
        redraw();
      });
      redraw();
    };

    const deferCard = () => {
      const prevStatus = card.status;
      if (list.length > 1) {
        const nextIdx = (index + 1) % list.length;
        card.status = 'deferred';
        if (arg) history.replaceState(null, '', '#/feed');
        demo.feedIdx = Math.min(nextIdx, Math.max(0, visibleDemoCards().length - 1));
      } else {
        card.status = 'deferred';
      }
      showToast(`Saved "${card.title}" for later`, () => {
        card.status = prevStatus;
        redraw();
      });
      redraw();
    };

    const middle = isDecision
      ? h('div', { class: 'v2-decision-box' },
        h('span', { class: 'v2-decision-kicker' }, 'Recommendation'),
        h('div', { class: 'v2-decision-rec' }, card.rec),
        h('div', { class: 'v2-decision-ctx' }, card.context))
      : [
        h('div', { class: 'v2-preview' },
          h('div', { class: 'v2-preview-art', 'aria-hidden': 'true' }),
          h('div', { class: 'v2-preview-dither', 'aria-hidden': 'true' }),
          h('div', { class: 'v2-preview-top' },
            h('span', { class: 'v2-preview-badge' }, 'Narrated spec · 0:09'),
            h('button', {
              type: 'button',
              class: 'v2-preview-btn',
              onclick: () => {
                card.sceneIdx = (card.sceneIdx + 1) % card.scenes.length;
                redraw();
              },
            }, `Scene ${card.sceneIdx + 1} / ${card.scenes.length}`)),
          h('div', { class: 'v2-preview-caption' }, card.scenes[card.sceneIdx])),
        h('div', { class: 'v2-progress-box' },
          h('div', { class: 'v2-progress-head' },
            h('strong', {}, `${card.merged} of ${card.total} tickets merged`),
            h('span', {}, `${Math.round((card.merged / card.total) * 100)}%`)),
          h('div', { class: 'v2-pips', role: 'img', 'aria-label': `${card.merged} of ${card.total} tickets merged` },
            Array.from({ length: card.total }, (_, i) => h('span', { class: i < card.merged ? 'merged' : '' })))),
      ];

    const hero = h('article', { class: `v2-hero-card has-art${isDecision ? '' : ' has-art-spec'}` },
      h('div', { class: 'v2-card-top' },
        h('span', { class: chipClass }, chipLabel),
        h('div', { class: 'v2-card-idx' },
          h('span', {}, `${index + 1} / ${list.length}`),
          h('span', { class: 'v2-phone-nav-btns' },
            h('button', { type: 'button', 'aria-label': 'Previous card', disabled: index === 0, onclick: () => goCard(index - 1) }, icon('up')),
            h('button', { type: 'button', 'aria-label': 'Next card', disabled: index >= list.length - 1, onclick: () => goCard(index + 1) }, icon('down'))))),
      h('h2', { class: 'v2-card-title' }, card.title),
      h('p', { class: 'v2-card-goal' }, card.goal),
      ...(Array.isArray(middle) ? middle : [middle]),
      card.note ? h('div', { class: 'v2-note-pill' }, `Requested change: ${card.note}`) : null,
      h('div', { class: 'v2-card-actions' },
        h('button', { type: 'button', class: 'v2-act-btn ship', disabled: isDone, onclick: shipCard }, icon('check'), isDone ? 'Done' : 'Ship it'),
        h('button', { type: 'button', class: 'v2-act-btn', disabled: isDone, onclick: () => openSheet(card) }, icon('edit'), 'Change something'),
        h('button', { type: 'button', class: 'v2-act-btn notnow', disabled: isDone, onclick: deferCard }, icon('down'), 'Not now')));

    const rail = h('div', { class: 'v2-feed-rail', 'aria-label': 'Card navigation' },
      h('button', { type: 'button', class: 'v2-rail-btn', 'aria-label': 'Previous card', disabled: index === 0, onclick: () => goCard(index - 1) }, icon('up')),
      h('span', { class: 'v2-rail-count' }, `${index + 1} / ${list.length}`),
      h('button', { type: 'button', class: 'v2-rail-btn', 'aria-label': 'Next card', disabled: index >= list.length - 1, onclick: () => goCard(index + 1) }, icon('down')));

    el.replaceChildren(h('div', { class: 'v2-feed-stage' }, hero, rail));
  }

  function renderDemoSettings(el) {
    const s = demo.settings;
    const hostsPanel = h('section', { class: 'v2-panel' },
      h('div', { class: 'v2-panel-head' },
        h('h2', {}, 'Where it runs'),
        h('span', { class: 'v2-engraved-tag' }, `${s.hosts.filter(x => x.enabled).length} active`)),
      h('div', { class: 'v2-row-list' }, s.hosts.map(host => h('div', { class: 'v2-set-row' },
        h('div', { class: 'v2-set-info' }, h('strong', {}, host.name), h('span', {}, host.detail)),
        h('button', {
          type: 'button',
          class: `v2-toggle${host.enabled ? ' on' : ''}`,
          role: 'switch',
          'aria-checked': host.enabled ? 'true' : 'false',
          'aria-label': `Toggle ${host.name}`,
          onclick: () => {
            host.enabled = !host.enabled;
            showToast(`${host.name} ${host.enabled ? 'enabled' : 'paused'}`);
            redraw();
          },
        })))));

    const effortPanel = h('section', { class: 'v2-panel' },
      h('div', { class: 'v2-panel-head' },
        h('h2', {}, 'Effort'),
        h('span', { class: 'v2-panel-hint' }, 'How hard the factory thinks')),
      h('div', { class: 'v2-seg-control', role: 'radiogroup', 'aria-label': 'Factory effort level' },
        ['fast', 'balanced', 'thorough'].map(level => h('button', {
          type: 'button',
          class: `v2-seg${s.effort === level ? ' active' : ''}`,
          role: 'radio',
          'aria-checked': s.effort === level ? 'true' : 'false',
          onclick: () => {
            s.effort = level;
            showToast(`Effort set to ${level[0].toUpperCase()}${level.slice(1)}`);
            redraw();
          },
        }, `${level[0].toUpperCase()}${level.slice(1)}`))),
      h('p', { class: 'v2-panel-note' }, EFFORT_NOTES[s.effort]));

    const modelsPanel = h('section', { class: 'v2-panel' },
      h('div', { class: 'v2-panel-head' },
        h('h2', {}, 'Models'),
        h('span', { class: 'v2-panel-hint' }, 'Defaults tuned for speed and cost')),
      h('div', { class: 'v2-row-list' }, s.models.map(m => h('div', { class: 'v2-set-row' },
        h('div', { class: 'v2-set-info' }, h('strong', {}, m.role)),
        h('select', {
          class: 'v2-select',
          'aria-label': `${m.role} model`,
          onchange: event => {
            m.value = event.target.value;
            showToast(`${m.role} set to ${m.value}`);
          },
        }, m.choices.map(c => h('option', { value: c, selected: c === m.value }, c)))))));

    const connPanel = h('section', { class: 'v2-panel' },
      h('div', { class: 'v2-panel-head' },
        h('h2', {}, 'Connections'),
        h('span', { class: 'v2-panel-hint' }, 'Stored locally on host')),
      h('div', { class: 'v2-row-list' }, s.connections.map(conn => h('div', { class: 'v2-set-row' },
        h('div', { class: 'v2-set-info' }, h('strong', {}, conn.name), h('span', {}, conn.detail)),
        h('button', {
          type: 'button',
          class: `v2-conn-pill${conn.connected ? ' connected' : ''}`,
          onclick: () => {
            conn.connected = !conn.connected;
            showToast(`${conn.name} ${conn.connected ? 'connected' : 'disconnected'}`);
            redraw();
          },
        }, conn.connected ? 'Connected' : 'Not connected')))));

    const budgetPanel = h('section', { class: 'v2-panel v2-panel-wide' },
      h('div', { class: 'v2-panel-head' },
        h('h2', {}, 'Budget'),
        h('span', { class: 'v2-engraved-tag' }, `$${s.spendToday.toFixed(2)} spent today`)),
      h('div', { class: 'v2-budget-grid' },
        h('div', {},
          h('div', { class: 'v2-budget-top' },
            h('label', { for: 'v2-daily-cap' }, 'Daily cap'),
            h('strong', {}, `$${s.dailyCap} / day`)),
          h('input', {
            id: 'v2-daily-cap',
            class: 'v2-range',
            type: 'range',
            min: 10,
            max: 100,
            step: 5,
            value: s.dailyCap,
            oninput: event => { s.dailyCap = Number(event.target.value); redraw(); },
          }),
          h('progress', { class: 'v2-meter', max: s.dailyCap, value: Math.min(s.dailyCap, s.spendToday) })),
        h('div', {},
          h('div', { class: 'v2-budget-top' },
            h('label', { for: 'v2-monthly-cap' }, 'Monthly cap'),
            h('strong', {}, `$${s.monthlyCap} / mo`)),
          h('input', {
            id: 'v2-monthly-cap',
            class: 'v2-range',
            type: 'range',
            min: 100,
            max: 1500,
            step: 50,
            value: s.monthlyCap,
            oninput: event => { s.monthlyCap = Number(event.target.value); redraw(); },
          }),
          h('div', { class: 'v2-budget-foot' },
            h('span', {}, 'Pause new builds automatically at cap'),
            h('button', {
              type: 'button',
              class: `v2-toggle${s.pauseAtCap ? ' on' : ''}`,
              role: 'switch',
              'aria-checked': s.pauseAtCap ? 'true' : 'false',
              'aria-label': 'Pause new builds at cap',
              onclick: () => { s.pauseAtCap = !s.pauseAtCap; redraw(); },
            })))));

    const repoPanel = h('section', { class: 'v2-panel v2-panel-wide' },
      h('div', { class: 'v2-panel-head' },
        h('h2', {}, 'Repository & session'),
        h('span', { class: 'v2-sample-tag' }, 'Sample data')),
      h('div', { class: 'v2-session-row' },
        h('div', { class: 'v2-freshness' },
          h('div', {}, 'Workspace: ', h('b', {}, 'Harbor · main')),
          h('div', {}, 'Offline sample workspace. No GitHub requests are made.')),
        h('div', { class: 'v2-session-actions' },
          h('a', { class: 'v2-btn subtle', href: '#/welcome' }, 'Sign out'))));

    el.replaceChildren(h('div', { class: 'v2-settings-scroll' },
      h('div', { class: 'v2-settings-grid' }, hostsPanel, effortPanel, modelsPanel, connPanel, budgetPanel, repoPanel)));
  }

  function renderLiveSettings(el, ctx) {
    const repoPanel = h('section', { class: 'v2-panel v2-panel-wide' },
      h('div', { class: 'v2-panel-head' },
        h('h2', {}, 'Repository & data freshness'),
        h('span', { class: 'v2-engraved-tag' }, ctx.repoFull)),
      ctx.repoSwitch(),
      h('div', { class: 'v2-session-row' },
        h('div', { class: 'v2-freshness' }, ctx.freshnessNodes()),
        h('div', { class: 'v2-session-actions' },
          h('button', {
            type: 'button',
            class: 'v2-btn',
            disabled: OW.data.paused(),
            onclick: () => OW.data.refreshAll(),
          }, icon('refresh'), 'Refresh now'),
          h('button', {
            type: 'button',
            class: 'v2-btn subtle',
            onclick: ctx.signOut,
          }, 'Sign out'))));

    const coming = (title, hint, rows) => h('section', { class: 'v2-panel' },
      h('div', { class: 'v2-panel-head' }, h('h2', {}, title), h('span', { class: 'v2-panel-hint' }, hint)),
      h('div', { class: 'v2-row-list' }, rows.map(([name, detail, badge, isConn]) => h('div', { class: 'v2-set-row' },
        h('div', { class: 'v2-set-info' }, h('strong', {}, name), h('span', {}, detail)),
        h('span', { class: `v2-conn-pill${isConn ? ' connected' : ''}` }, badge)))));

    el.replaceChildren(h('div', { class: 'v2-settings-scroll' },
      h('div', { class: 'v2-settings-grid' },
        repoPanel,
        coming('Where it runs', 'Coming in 0.02', [
          ['Local host', 'Configure from your OpenWiz CLI', 'Managed locally', false],
          ['Cloud burst', 'Overflow runners', 'Coming soon', false],
        ]),
        coming('Connections', 'GitHub active', [
          ['GitHub', 'Repository records & decisions', 'Connected', true],
          ['Model providers', 'Configured on your host', 'Coming soon', false],
        ]),
        coming('Effort & budget', 'Coming in 0.02', [
          ['Effort', 'Balanced default on host', 'Balanced', false],
          ['Budget caps', 'Set daily and monthly limits', 'Coming soon', false],
        ]))));
  }

  function renderWelcome(root, { note, demoMode }) {
    const cta = demoMode
      ? h('a', { class: 'v2-btn primary', href: '#/chat' }, 'Open Harbor workspace', icon('right'))
      : h('a', { class: 'v2-btn primary', href: '/api/sign-in/start' }, 'Sign in with GitHub', icon('right'));
    const foot = demoMode
      ? 'Sample workspace · Harbor. No network requests or GitHub sign-in required.'
      : 'On the repositories you choose, it posts only the comments you see and confirm. Your sign-in stays in this browser; the app talks only to GitHub.';
    const card = h('div', { class: 'v2-welcome-card' },
      h('div', { class: 'v2-welcome-head' },
        h('div', { class: 'v2-welcome-brand' }, h('img', { src: '/app/mark.svg', alt: '', width: 28, height: 28 }), h('span', {}, 'OpenWiz')),
        demoMode ? h('span', { class: 'v2-sample-tag' }, 'Sample data') : h('span', { class: 'v2-engraved-tag' }, '0.02')),
      h('h1', {}, 'Run your software factory.'),
      h('p', { class: 'v2-welcome-copy' }, 'Answer three plain questions, watch specs build, and decide when to ship.'),
      h('div', { class: 'v2-welcome-steps' },
        h('div', { class: 'v2-welcome-step' }, h('strong', {}, 'Grill'), h('span', {}, '3 quick calls')),
        h('div', { class: 'v2-welcome-step' }, h('strong', {}, 'Watch'), h('span', {}, 'Specs & progress')),
        h('div', { class: 'v2-welcome-step' }, h('strong', {}, 'Decide'), h('span', {}, 'Ship or steer'))),
      note ? h('div', { class: 'notices' }, h('div', { class: 'notice bad', role: 'alert' }, icon('warn'), h('span', {}, note))) : null,
      cta,
      h('p', { class: 'v2-welcome-foot' }, foot));
    root.replaceChildren(
      h('div', { class: 'v2-backdrop', 'aria-hidden': 'true' }),
      h('div', { class: 'v2-veil', 'aria-hidden': 'true' }),
      h('div', { class: 'v2-welcome-stage' }, card));
    document.title = 'OpenWiz';
  }

  function chatBadge() {
    if (!isDemo) return null;
    const open = demo.messages.filter(m => m.role === 'grill' && !m.answered).length;
    return open ? `${open * 3} Qs` : null;
  }

  function chatTabBadge() {
    if (!isDemo) return null;
    const open = demo.messages.filter(m => m.role === 'grill' && !m.answered).length;
    return open ? String(open * 3) : null;
  }

  function feedBadge(feeds) {
    if (isDemo) {
      const pending = demo.cards.filter(c => c.type === 'decision' && c.status === 'pending').length;
      return pending || null;
    }
    return OW.queue?.badge?.(feeds) || null;
  }

  OW.v2 = {
    setRedraw: fn => { redraw = fn; },
    renderWelcome,
    pages(ctx) {
      return [
        {
          id: 'chat',
          title: 'Chat',
          sub: 'Grill, steer, or start something new. Three plain questions at a time.',
          icon: 'chat',
          feeds: [],
          badge: chatBadge,
          tabBadge: chatTabBadge,
          render(el) {
            if (isDemo) renderDemoChat(el);
            else renderLiveChat(el);
          },
        },
        {
          id: 'feed',
          title: 'Feed',
          sub: 'One spec or decision at a time.',
          icon: 'feed',
          feeds: isDemo ? [] : ['specs'],
          badge: feedBadge,
          hotBadge: true,
          render(el, feeds, arg) {
            if (isDemo) {
              renderDemoFeed(el, arg);
            } else {
              let wrap = el.querySelector('.v2-live-feed');
              if (!wrap) {
                wrap = h('div', { class: 'v2-live-feed' });
                el.replaceChildren(wrap);
              }
              OW.queue.render(wrap, feeds);
            }
          },
        },
        {
          id: 'settings',
          title: 'Settings',
          sub: 'Sensible defaults are already chosen. Change only what you care about.',
          icon: 'settings',
          feeds: isDemo ? [] : ['specs'],
          bottom: true,
          showPhoneHead: true,
          render(el) {
            if (isDemo) renderDemoSettings(el);
            else renderLiveSettings(el, ctx);
          },
        },
      ];
    },
  };
})();
