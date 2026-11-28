'use strict';
(() => {
  const OW = (window.OW = window.OW || {});
  const listeners = new Set();
  const notify = () => { for (const fn of listeners) fn(); };

  const state = {
    workspace: 'Harbor',
    branch: 'main',
    showCompleted: false,
    toast: null,
    draft: '',
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
        text: 'Three quick choices before I draft the spec.',
      },
      {
        id: 'g1',
        role: 'grill',
        specTitle: 'Usage-based seat billing',
        specGoal: 'Charge for active editors with monthly true-up, free viewers, and a 7-day renewal grace window.',
        answered: false,
        questions: [
          {
            id: 'Q1',
            prompt: 'When should new seats be charged?',
            rec: 0,
            selected: 0,
            options: ['At month end', 'Immediately'],
          },
          {
            id: 'Q2',
            prompt: 'Should viewers pay?',
            rec: 0,
            selected: 0,
            options: ['Keep viewers free', 'Count all members'],
          },
          {
            id: 'Q3',
            prompt: 'When should edits lock after a missed payment?',
            rec: 0,
            selected: 0,
            options: ['Give 7 days', 'After 48 hours'],
          },
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
        goal: 'Sign in without a password using a 15-minute email link.',
        merged: 6,
        total: 6,
        art: 'art-boat',
        scenes: [
          '0:02 · Enter your email to get a sign-in link',
          '0:05 · Open the link to sign in',
          '0:08 · All six tickets merged and checks passed',
        ],
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
        { name: 'Home computer', enabled: true },
        { name: 'Cloud backup', enabled: false },
      ],
      effort: 'balanced',
      connections: [
        { name: 'GitHub', connected: true },
        { name: 'Model provider', connected: true },
        { name: 'Issue tracker', connected: false },
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
        '0:02 · Spec drafted from your three answers',
        '0:05 · Ticket 1 of 5 merged — data model ready',
        '0:08 · Building checkout and grace banner next',
      ],
      note: '',
    });
    state.showCompleted = false;
    toast(`Answers sent · "${grill.specTitle}" added to Feed`);
  }

  function sendChat(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    state.messages.push({ id: `u-${Date.now()}`, role: 'user', time: 'Just now', text: trimmed });
    const shortTitle = trimmed.length > 42 ? `${trimmed.slice(0, 42).replace(/\s+\S*$/, '')}…` : trimmed;
    state.messages.push({
      id: `g-${Date.now() + 1}`,
      role: 'grill',
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
    const prev = card.status;
    if (action === 'ship') {
      card.status = card.type === 'decision' ? 'decided' : 'shipped';
      toast(card.type === 'decision' ? `Accepted · ${card.rec}` : `Shipped · ${card.title}`, () => {
        card.status = prev;
        notify();
      });
      return;
    }
    if (action === 'notnow') {
      card.status = 'snoozed';
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
    toast(`Change sent · ${card.title}`);
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
    openQuestionsCount,
    pendingFeedCount,
  };
})();
