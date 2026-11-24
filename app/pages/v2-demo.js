'use strict';
(() => {
  const OW = (window.OW = window.OW || {});
  const listeners = new Set();
  const notify = () => { for (const fn of listeners) fn(); };

  const state = {
    workspace: 'Harbor',
    branch: 'main',
    feedIndex: 0,
    showCompleted: false,
    toast: null,
    changeTarget: null,
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
        text: 'Got it. Before I draft the spec and start builds, three quick calls — each has a recommendation you can accept in one tap.',
      },
      {
        id: 'g1',
        role: 'grill',
        round: 1,
        specTitle: 'Usage-based seat billing',
        specGoal: 'Charge for active editors with monthly true-up, free viewers, and a 7-day renewal grace window.',
        answered: false,
        questions: [
          {
            id: 'Q1',
            prompt: 'Charge for new seats right away, or true-up at month end?',
            rec: 0,
            selected: 0,
            options: ['True-up at month end', 'Charge immediately'],
          },
          {
            id: 'Q2',
            prompt: 'Do read-only viewers count toward paid seats?',
            rec: 0,
            selected: 0,
            options: ['Keep viewers free', 'Count all members'],
          },
          {
            id: 'Q3',
            prompt: 'How long should a failed renewal wait before locking edits?',
            rec: 0,
            selected: 0,
            options: ['7-day grace banner', 'Lock after 48 hours'],
          },
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
        art: 'art-boat',
        scenes: [
          '0:02 · Enter email — single field, no password wall',
          '0:05 · One-tap link verified — session cookie rotated',
          '0:08 · All 6 tickets merged · checks green',
        ],
        sceneIdx: 0,
        paused: false,
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
        art: 'art-grill',
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
        art: 'art-sea',
        scenes: [
          '0:02 · Pick date range (7d / 30d / 90d)',
          '0:05 · Streams rows without memory spikes',
          '0:08 · 2 tickets left: signed download and rate limit',
        ],
        sceneIdx: 0,
        paused: false,
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
        art: 'art-grill',
        note: '',
      },
    ],
    settings: {
      hosts: [
        { id: 'mac-mini', name: 'Home Mac Mini', detail: 'Primary · Online · 14 ms', enabled: true },
        { id: 'cloud-burst', name: 'Cloud burst', detail: 'Auto-scale when more than 3 specs run', enabled: true },
      ],
      effort: 'balanced',
      models: [
        { role: 'Orchestrator', value: 'Claude Opus 4.5', choices: ['Claude Opus 4.5', 'Claude Sonnet 4.5', 'GPT-5.2'] },
        { role: 'Builder', value: 'Codex 5.2', choices: ['Codex 5.2', 'Claude Sonnet 4.5', 'DeepSeek R2'] },
        { role: 'Reviewer', value: 'Claude Opus 4.5', choices: ['Claude Opus 4.5', 'GPT-5.2', 'Claude Sonnet 4.5'] },
        { role: 'Narrator', value: 'Claude Sonnet 4.5', choices: ['Claude Sonnet 4.5', 'GPT-5 Mini'] },
      ],
      connections: [
        { id: 'github', name: 'GitHub', detail: 'Repository and pull requests', connected: true },
        { id: 'anthropic', name: 'Anthropic', detail: 'Orchestrator and reviewer', connected: true },
        { id: 'openai', name: 'OpenAI', detail: 'Builder fleet', connected: true },
        { id: 'tunnel', name: 'Cloudflare Tunnel', detail: 'Private home chat link', connected: true },
        { id: 'linear', name: 'Linear', detail: 'Optional issue mirror', connected: false },
      ],
      dailyCap: 25,
      monthlyCap: 400,
      spendToday: 6.4,
      pauseAtCap: true,
    },
  };

  let toastTimer = null;
  function toast(message, undo) {
    clearTimeout(toastTimer);
    state.toast = { message, undo: undo || null };
    notify();
    toastTimer = setTimeout(() => {
      state.toast = null;
      notify();
    }, 4500);
  }
  function clearToast() {
    clearTimeout(toastTimer);
    state.toast = null;
    notify();
  }

  function pickOption(grillId, qi, oi) {
    const grill = state.messages.find(m => m.id === grillId);
    if (!grill || grill.answered) return;
    grill.questions[qi].selected = oi;
    notify();
  }

  function completeGrill(grillId) {
    const grill = state.messages.find(m => m.id === grillId);
    if (!grill || grill.answered) return;
    grill.answered = true;
    const summary = grill.questions.map(q => `${q.id}: ${q.options[q.selected]}`).join(' · ');
    const now = 'Just now';
    state.messages.push({ id: `u-${Date.now()}`, role: 'user', time: now, text: summary });
    state.messages.push({
      id: `w-${Date.now() + 1}`,
      role: 'wiz',
      time: now,
      text: `Locked in. "${grill.specTitle}" is now building — watch progress and ship it from Feed when ready.`,
      jumpFeed: true,
    });
    state.cards.unshift({
      id: `c-new-${Date.now()}`,
      type: 'spec',
      status: 'building',
      kicker: 'Spec · Just started',
      title: grill.specTitle,
      goal: grill.specGoal,
      merged: 1,
      total: 5,
      art: 'art-boat',
      scenes: [
        '0:02 · Spec drafted from your 3 grill answers',
        '0:05 · Ticket 1 of 5 merged — data model ready',
        '0:08 · Building checkout and grace banner next',
      ],
      sceneIdx: 0,
      paused: false,
      note: '',
    });
    state.feedIndex = 0;
    state.showCompleted = false;
    toast(`Grill answered · "${grill.specTitle}" added to Feed`);
  }

  function sendChat(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    state.messages.push({ id: `u-${Date.now()}`, role: 'user', time: 'Just now', text: trimmed });
    const shortTitle = trimmed.length > 42 ? `${trimmed.slice(0, 42).replace(/\s+\S*$/, '')}…` : trimmed;
    const round = state.messages.filter(m => m.role === 'grill').length + 1;
    state.messages.push({
      id: `g-${Date.now() + 1}`,
      role: 'grill',
      round,
      specTitle: shortTitle,
      specGoal: trimmed,
      answered: false,
      questions: [
        { id: 'Q1', prompt: 'Ship to everyone at once, or roll out to active workspaces first?', rec: 0, selected: 0, options: ['Active workspaces first', 'Everyone at once'] },
        { id: 'Q2', prompt: 'Include an opt-out toggle in workspace settings?', rec: 0, selected: 0, options: ['Yes, one-click toggle', 'Always on'] },
        { id: 'Q3', prompt: 'Record a short narrated spec walkthrough for Feed?', rec: 0, selected: 0, options: ['Yes, 10s walkthrough', 'Skip walkthrough'] },
      ],
    });
    notify();
  }

  const isActiveCard = c => c.status !== 'shipped' && c.status !== 'decided' && c.status !== 'snoozed';
  function visibleCards() {
    if (state.showCompleted) return state.cards;
    return state.cards.filter(isActiveCard);
  }

  function cardAction(cardId, action) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;
    if (action === 'change') {
      state.changeTarget = card.id;
      notify();
      return;
    }
    const prev = card.status;
    if (action === 'ship') {
      card.status = card.type === 'decision' ? 'decided' : 'shipped';
      const list = visibleCards();
      state.feedIndex = Math.min(state.feedIndex, Math.max(0, list.length - 1));
      toast(card.type === 'decision' ? `Accepted · ${card.rec}` : `Shipped · ${card.title}`, () => {
        card.status = prev;
        notify();
      });
      return;
    }
    if (action === 'notnow') {
      card.status = 'snoozed';
      const list = visibleCards();
      state.feedIndex = Math.min(state.feedIndex, Math.max(0, list.length - 1));
      toast(`Snoozed · ${card.title}`, () => {
        card.status = prev;
        notify();
      });
    }
  }

  function submitChange(cardId, note) {
    const card = state.cards.find(c => c.id === cardId);
    const trimmed = String(note || '').trim();
    if (!card || !trimmed) return;
    card.note = trimmed;
    state.changeTarget = null;
    toast(`Change sent · ${card.title}`);
  }

  function closeChange() {
    state.changeTarget = null;
    notify();
  }

  function toggleScene(cardId) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card || card.type !== 'spec') return;
    card.paused = !card.paused;
    notify();
  }

  function stepScene(cardId) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card || card.type !== 'spec') return;
    card.sceneIdx = (card.sceneIdx + 1) % card.scenes.length;
    notify();
  }

  function openQuestionsCount() {
    return state.messages.filter(m => m.role === 'grill' && !m.answered).reduce((n, g) => n + g.questions.length, 0) || null;
  }

  function pendingFeedCount() {
    return state.cards.filter(isActiveCard).length || null;
  }

  OW.demo = {
    state,
    onChange: fn => listeners.add(fn),
    notify,
    toast,
    clearToast,
    pickOption,
    completeGrill,
    sendChat,
    visibleCards,
    cardAction,
    submitChange,
    closeChange,
    toggleScene,
    stepScene,
    openQuestionsCount,
    pendingFeedCount,
  };
})();
