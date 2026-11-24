'use strict';
(() => {
  const { h, icon, STATES } = OW.ui;
  const isDemo = OW.data.demo;
  const mark = () => h('img', { src: '/app/mark.svg', alt: '', width: 28, height: 28 });
  const avatar = () => h('span', { class: 'v2-avatar' }, mark());

  const ghostReady = (() => {
    if (OW.ghost) return Promise.resolve(OW.ghost);
    const { ghostStyle, ghostScript } = document.querySelector('script[data-ghost-script]')?.dataset || {};
    if (!ghostStyle || !ghostScript) return Promise.resolve(null);
    const load = el => new Promise((resolve, reject) => {
      el.addEventListener('load', resolve, { once: true });
      el.addEventListener('error', reject, { once: true });
      document.head.append(el);
    });
    return Promise.all([
      load(h('link', { rel: 'stylesheet', href: ghostStyle })),
      load(h('script', { src: ghostScript })),
    ]).then(() => OW.ghost || null, () => null);
  })();

  function initialDemoState() {
    return {
      draft: '',
      messages: [
        {
          role: 'user',
          time: '9:12 AM',
          text: 'Add usage-based seat billing. Keep upgrades simple for small teams.',
        },
        {
          role: 'wiz',
          time: '9:12 AM',
          text: 'Three quick choices before I draft the spec.',
        },
        {
          role: 'grill',
          specTitle: 'Usage-based seat billing',
          plan: 'billing',
          answered: false,
          questions: [
            { prompt: 'When should we charge for new seats?', rec: 0, selected: 0, options: ['At month end', 'Right away'] },
            { prompt: 'Should read-only viewers pay?', rec: 0, selected: 0, options: ['Viewers free', 'Count everyone'] },
            { prompt: 'How long before a failed renewal locks edits?', rec: 0, selected: 0, options: ['7 days', '48 hours'] },
          ],
        },
      ],
      cards: [
        {
          id: 'magic',
          type: 'spec',
          status: 'ready',
          spec: 211,
          title: 'Magic-link sign-in',
          goal: 'A simpler way into Harbor.',
          scenes: [
            '0:02 · Request a sign-in link.',
            '0:05 · Open the link to sign in.',
            '0:08 · All six tickets merged.',
          ],
          sceneIdx: 0,
        },
        {
          id: 'free',
          type: 'decision',
          status: 'pending',
          title: 'Keep the free plan?',
          goal: 'Harbor’s free plan costs about $40 a month to run.',
          rec: 'Keep it, cap at 3 seats',
        },
        {
          id: 'retention',
          type: 'decision',
          status: 'pending',
          title: 'Retention window for deleted projects',
          goal: 'Deleted projects can stay recoverable for 7 or 30 days.',
          rec: 'Allow recovery for 30 days',
        },
      ],
      nextSpec: 231,
      specs: [
        { number: 201, title: 'Audit log export', tickets: [
          { n: 202, title: 'Event schema', state: 'merged', blockers: [], min: 310, notes: ['Merged with every check passing.'] },
          { n: 203, title: 'Record events', state: 'merged', blockers: [202], min: 240, notes: ['Merged with every check passing.'] },
          { n: 204, title: 'CSV export', state: 'merged', blockers: [202], min: 190, notes: ['Merged with every check passing.', 'Large exports now stream row by row.'] },
          { n: 205, title: 'Member filter', state: 'merged', blockers: [202], min: 150, notes: ['Merged with every check passing.'] },
          { n: 206, title: 'Download page', state: 'merged', blockers: [203, 204], min: 62, notes: ['Merged with every check passing.'] },
          { n: 207, title: 'Email when ready', state: 'building', blockers: [204], min: 4, notes: ['Sending a test export to a sample inbox.', 'Drafted the email.'] },
          { n: 208, title: 'Retention rules', card: 'retention', blockers: [205], min: 9, notes: ['How long should deleted projects stay recoverable?'] },
        ] },
        { number: 221, title: 'Project activity digest', tickets: [
          { n: 222, title: 'Collect activity', state: 'merged', blockers: [], min: 280, notes: ['Merged with every check passing.'] },
          { n: 223, title: 'Weekly summary', state: 'merged', blockers: [222], min: 120, notes: ['Merged with every check passing.'] },
          { n: 224, title: 'Digest email', state: 'review', blockers: [223], min: 12, notes: ['Checking the layout on small screens.', 'Built the first version.'] },
          { n: 225, title: 'Free plan limits', card: 'free', blockers: [222], min: 16, notes: ['Should the free plan stay, and with what limit?'] },
        ] },
        { number: 211, title: 'Magic-link sign-in', tickets: [
          { n: 212, title: 'Sign-in email', state: 'merged', blockers: [], min: 420, notes: ['Merged with every check passing.'] },
          { n: 213, title: 'One-time links', state: 'merged', blockers: [], min: 400, notes: ['Merged with every check passing.'] },
          { n: 214, title: 'Request page', state: 'merged', blockers: [212], min: 330, notes: ['Merged with every check passing.'] },
          { n: 215, title: 'Open the link', state: 'merged', blockers: [213], min: 300, notes: ['Merged with every check passing.'] },
          { n: 216, title: 'Expired links', state: 'merged', blockers: [213], min: 210, notes: ['Merged with every check passing.'] },
          { n: 217, title: 'Welcome back', state: 'merged', blockers: [214, 215], min: 95, notes: ['Merged with every check passing.'] },
        ] },
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

  const PLAN_TITLES = {
    billing: ['Count seats', 'Price per seat', 'Viewer rules', 'Upgrade flow', 'Failed renewals'],
    general: ['First version', 'Settings toggle', 'Rollout', 'Help page', 'Walkthrough video'],
  };
  function planSpec(title, plan) {
    const number = demo.nextSpec;
    demo.nextSpec += 10;
    const before = [[], [1], [1], [2, 3], [2]];
    demo.specs.unshift({ number, title, tickets: PLAN_TITLES[plan].map((name, i) => ({
      n: number + i + 1, title: name, state: i ? 'waiting' : 'building', blockers: before[i].map(b => number + b), min: 0,
      notes: i ? [] : ['Getting started.'],
    })) });
  }

  const KEY = n => `harbor#${n}`;
  function sampleTicket(t, now) {
    const card = t.card && demo.cards.find(c => c.id === t.card);
    const state = !t.card ? t.state : card?.status === 'pending' ? 'you' : card?.status === 'deferred' ? 'waiting' : 'building';
    const steps = !t.card || state === 'you' ? t.notes : [state === 'waiting' ? 'Set aside until you decide.' : 'Your decision is in. Building it now.'];
    const at = now - t.min * 60000;
    const doing = { merged: ['done', 'builder'], you: ['asking', 'builder'], review: ['working', 'reviewer'], building: ['working', 'builder'] };
    const [status, agent] = doing[state] || ['lapsed', 'builder'];
    const notes = steps.map((step, i) => ({ kind: 'note', status: i ? 'done' : status,
      row: { at: at - i * 38 * 60000, note: { agent: i ? 'builder' : agent, step } } }));
    return { key: KEY(t.n), number: t.n, title: t.title, url: null, href: state === 'you' ? cardHref(card) : null, state,
      gap: false, outside: false, missing: 0, blockers: t.blockers.map(KEY), blocks: [], lead: null,
      members: [...notes, { kind: 'ticket', labels: [] }], you: state === 'you', working: state === 'building', activity: notes.length ? at : 0 };
  }
  function sampleSheet(spec, now) {
    const tickets = spec.tickets.map(t => sampleTicket(t, now));
    for (const t of tickets) for (const key of t.blockers) tickets.find(x => x.key === key)?.blocks.push(t.key);
    const card = demo.cards.find(c => c.spec === spec.number);
    const ready = card?.status === 'ready';
    const done = tickets.filter(t => t.state === 'merged').length;
    const you = tickets.filter(t => t.you).length + (ready ? 1 : 0);
    return { number: spec.number, title: spec.title, url: null, total: tickets.length, done, read: true, unknown: 0, tickets,
      decisions: ready ? [{ kind: 'ship', number: spec.number, href: cardHref(card) }] : [],
      counts: { you }, activity: now, quiet: !you && done === tickets.length };
  }
  function sampleCanvas(now = Date.now()) {
    const sheets = demo.specs.map(spec => sampleSheet(spec, now));
    const inbox = pendingDemoCards().map(card => {
      const sheet = sheets.find(s => s.number === card.spec) || sheets.find(s => s.tickets.some(t => t.href === cardHref(card)));
      const ticket = sheet?.tickets.find(t => t.href === cardHref(card)) || null;
      return { kind: 'feed', sheet: sheet?.number ?? null, ticket: ticket?.key ?? null, number: ticket?.number ?? card.spec,
        text: card.type === 'spec' ? `Ship ${card.title}` : card.title, href: cardHref(card), url: null, at: 0 };
    });
    return { sheets, inbox, gaps: [], partial: false };
  }
  const sampleSpec = number => sampleCanvas().sheets.find(sheet => sheet.number === number);
  const sampleBuilding = () => sampleCanvas().sheets.filter(sheet => sheet.done < sheet.total);

  const demo = isDemo ? initialDemoState() : null;
  if (isDemo && location.hash === '#/feed/clear') demo.cards = [];
  let redraw = () => {};
  let toastTimer;
  let toastEl;
  let toastStatus;
  let dismissToast;
  let chatView;

  function scheduleToast() {
    clearTimeout(toastTimer);
    if (!toastEl.hidden && !toastEl.matches(':hover, :focus-within')) {
      toastTimer = setTimeout(dismissToast, 4500);
    }
  }

  function showToast(text, undo = null) {
    const returnTo = document.activeElement;
    if (!toastEl) {
      toastEl = h('div', { class: 'v2-toast', hidden: true,
        onpointerenter: () => clearTimeout(toastTimer),
        onpointerleave: () => queueMicrotask(scheduleToast),
        onfocusin: () => clearTimeout(toastTimer),
        onfocusout: () => queueMicrotask(scheduleToast),
      });
      toastStatus = h('span', { class: 'visually-hidden', role: 'status' });
      document.body.append(toastEl, toastStatus);
    }
    dismissToast = () => {
      clearTimeout(toastTimer);
      const hadFocus = toastEl.contains(document.activeElement);
      toastEl.hidden = true;
      if (hadFocus) {
        (returnTo?.isConnected && returnTo !== document.body ? returnTo : document.querySelector('.v2-head h1'))?.focus();
      }
    };
    toastEl.replaceChildren(...[h('span', { 'aria-hidden': 'true' }, text), undo ? h('button', {
      type: 'button',
      class: 'v2-btn subtle',
      onclick: () => { dismissToast(); undo(); },
    }, 'Undo') : null].filter(Boolean));
    toastEl.hidden = false;
    toastStatus.textContent = text;
    scheduleToast();
  }

  function openSheet(card, opener, onSend) {
    const title = h('h2', { id: 'v2-sheet-title' }, 'Change something');
    const input = h('textarea', { rows: 3, required: true, placeholder: 'What should change?', 'aria-label': 'What should change?' });
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
      const sent = [
        { role: 'user', time: 'Just now', text: `On “${card.title}”: ${text}` },
        { role: 'wiz', time: 'Just now', text: `I’ll update “${card.title}” and check it again.` },
      ];
      demo.messages.push(...sent);
      sheet.close();
      opener.focus();
      onSend(() => { demo.messages = demo.messages.filter(message => !sent.includes(message)); });
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
    demo.messages.push({ role: 'user', time: 'Just now', text: summary });
    demo.messages.push({
      role: 'wiz',
      time: 'Just now',
      text: `“${grill.specTitle}” is now in Feed.`,
      jumpFeed: true,
    });
    planSpec(grill.specTitle, grill.plan || 'general');
    showToast(`Answers saved · "${grill.specTitle}" added to Feed`);
    redraw();
  }

  function submitChatPrompt(text) {
    const clean = text.trim();
    if (!clean) return;
    const shortTitle = clean.length > 42 ? `${clean.slice(0, 42).replace(/\s+\S*$/, '')}…` : clean;
    demo.messages.push({ role: 'user', time: 'Just now', text: clean });
    demo.messages.push({
      role: 'grill',
      specTitle: shortTitle,
      answered: false,
      questions: [
        { prompt: 'Ship to everyone at once, or roll out to active workspaces first?', rec: 0, selected: 0, options: ['Active first', 'Everyone'] },
        { prompt: 'Include an opt-out toggle in workspace settings?', rec: 0, selected: 0, options: ['Yes, a toggle', 'Always on'] },
        { prompt: 'Should Wiz record a short walkthrough video for the Feed?', rec: 0, selected: 0, options: ['Yes, 10 seconds', 'Skip video'] },
      ],
    });
    redraw();
  }

  function renderQuestions(message) {
    const description = h('p');
    const saved = h('a', { class: 'v2-btn subtle', href: '#/feed' }, icon('check'), 'Answers saved · Open Feed');
    const submit = h('button', { type: 'button', class: 'v2-btn primary', onclick: () => {
      const hadFocus = document.activeElement === submit;
      submit.replaceWith(saved);
      groups.forEach(group => group.querySelectorAll('button').forEach(button => { button.disabled = true; }));
      completeGrill(message);
      if (hadFocus) saved.focus({ preventScroll: true });
    } });
    const updateSummary = () => {
      const allRecommended = message.questions.every(q => q.selected === q.rec);
      const hint = allRecommended ? 'Recommended answers selected' : 'Review your selected answers';
      const action = allRecommended ? 'Accept all 3' : 'Send 3 answers';
      if (description.textContent !== hint) description.textContent = hint;
      if (submit.textContent !== action) submit.textContent = action;
    };
    const groups = message.questions.map(q => {
      const choices = q.options.map((option, i) => h('button', {
        type: 'button', class: 'v2-q-pill', disabled: message.answered,
        'aria-pressed': String(i === q.selected),
        'aria-label': i === q.rec ? `${option} (recommended)` : option,
        onclick: () => {
          if (i === q.selected) return;
          choices[q.selected].setAttribute('aria-pressed', 'false');
          choices[i].setAttribute('aria-pressed', 'true');
          q.selected = i;
          updateSummary();
        },
      }, i === q.rec ? icon('check') : null, option));
      return h('div', { class: 'v2-grill-q' }, h('p', {}, q.prompt),
        h('div', { class: 'v2-q-opts', role: 'group', 'aria-label': q.prompt }, choices));
    });
    updateSummary();
    return h('article', { class: 'v2-grill', 'aria-label': message.specTitle },
      h('div', { class: 'v2-grill-head' }, h('h2', {}, message.specTitle), description),
      groups, h('div', { class: 'v2-grill-foot' }, message.answered ? saved : submit));
  }

  function renderDemoChat(el) {
    if (!chatView || !el.contains(chatView.scroll)) {
      const scroll = h('div', { class: 'v2-chat-scroll', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' });
      const thread = h('div', { class: 'v2-chat-thread' });
      scroll.append(thread);
      const input = h('textarea', {
        rows: 1,
        placeholder: 'Tell Wiz what to build or change…',
        'aria-label': 'Tell Wiz what to build or change',
      });
      input.value = demo.draft;
      let ghost = null;
      let composing = false;
      const send = () => {
        const text = input.value;
        if (!text.trim()) return;
        input.value = '';
        demo.draft = '';
        ghost?.clear();
        submitChatPrompt(text);
        input.focus({ preventScroll: true });
      };
      input.addEventListener('compositionstart', () => { composing = true; });
      input.addEventListener('compositionend', () => { composing = false; });
      input.addEventListener('keydown', event => {
        if (!composing && !event.isComposing && event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          send();
        }
      });
      const composer = h('form', { class: 'v2-composer', onsubmit: event => {
        event.preventDefault();
        send();
      } }, input, h('button', { type: 'submit', class: 'v2-send-btn', 'aria-label': 'Send message' }, icon('up')));
      el.replaceChildren(h('div', { class: 'v2-chat-wrap' }, scroll, h('div', { class: 'v2-composer-wrap' }, composer)));
      const wireGhost = mod => {
        if (!mod || !input.isConnected || ghost) return;
        ghost = mod.attach(input, { onInput: value => { demo.draft = value; } });
        if (input.value && document.activeElement === input) ghost.sync();
      };
      if (OW.ghost) wireGhost(OW.ghost);
      else {
        input.addEventListener('input', () => { demo.draft = input.value; });
        ghostReady.then(wireGhost);
      }
      chatView = { scroll, thread, length: 0 };
    }
    const { scroll, thread, length } = chatView;
    if (length === demo.messages.length) return;
    const top = scroll.scrollTop;
    thread.append(...demo.messages.slice(length).map(message => {
      if (message.role === 'grill') return h('div', { class: 'v2-msg questions' }, renderQuestions(message));
      const fromWiz = message.role === 'wiz';
      return h('div', { class: `v2-msg ${fromWiz ? 'wiz' : 'user'}` },
        fromWiz ? avatar() : null,
        h('div', { class: 'v2-bubble' },
          h('div', { class: 'v2-meta' }, `${fromWiz ? 'Wiz' : 'You'} · ${message.time}`),
          h('p', {}, message.text),
          message.jumpFeed ? h('a', { class: 'v2-btn subtle', href: '#/feed', 'data-focus': 'chat-feed' }, 'Open in Feed', icon('right')) : null));
    }));
    chatView.length = demo.messages.length;
    if (length && length < chatView.length) {
      const last = thread.lastElementChild;
      if (last.classList.contains('questions')) scroll.scrollTop += last.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 8;
      else scroll.scrollTop = top;
    } else scroll.scrollTop = top;
  }

  function renderLiveChat(el) {
    if (el.querySelector('.v2-chat-empty')) return;
    const input = h('input', { type: 'text', disabled: true, placeholder: 'Chat is coming soon', 'aria-label': 'Chat composer' });
    const send = h('button', { type: 'button', class: 'v2-send-btn', disabled: true, 'aria-label': 'Send message' }, icon('up'));
    el.replaceChildren(h('div', { class: 'v2-chat-wrap' },
      h('div', { class: 'v2-chat-scroll' },
        h('article', { class: 'v2-chat-empty' },
          h('span', { class: 'v2-label' }, 'Coming soon'),
          h('h2', {}, 'Start work from here'),
          h('p', {}, 'Describe what to build and answer quick questions before a spec starts.'),
          h('a', { class: 'v2-btn primary', href: '#/feed' }, 'Open Feed', icon('right')))),
      h('div', { class: 'v2-composer-wrap' }, h('div', { class: 'v2-composer is-disabled' }, input, send))));
  }

  function pendingDemoCards() {
    return demo.cards.filter(card => card.status === 'ready' || card.status === 'pending');
  }

  function cardHref(card) {
    if (!card) return '#/feed/clear';
    const number = demo.cards.indexOf(card) + 1;
    return number === 1 ? '#/feed' : `#/feed/${number}`;
  }

  function pager(index, total, go) {
    if (total < 2) return null;
    const button = (label, glyph, next) => h('button', {
      type: 'button', class: 'v2-rail-btn', 'aria-label': label,
      'data-focus': `pager:${glyph}`, disabled: next < 0 || next >= total,
      onclick: () => go(next),
    }, icon(glyph), h('span', { class: 'visually-hidden' }, label));
    return h('div', { class: 'v2-feed-rail', role: 'group', 'aria-label': 'Card navigation' },
      button('Previous card', 'up', index - 1),
      h('span', { class: 'v2-rail-count', 'aria-live': 'polite' }, `${index + 1} of ${total}`),
      button('Next card', 'down', index + 1));
  }

  function allClear(message) {
    const line = (d, attrs = {}) => h('path', { d, ...attrs });
    const lighthouse = h('svg', { class: 'v2-lighthouse', viewBox: '0 0 176 112', 'aria-hidden': 'true',
      fill: 'none', stroke: 'currentColor', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
      line('M80 80 84 36h13l5 44M82 36h17v-5H82zm2-5V19h13v12M82 19l8.5-8 8.5 8M90.5 11V7', { fill: '#2b2723' }),
      line('M88 19v12m5-12v12m-9 20h15m-16 3h16m-17 13h18m-18 3h19M89 78v-7h5v8', { opacity: '.82' }),
      line('M76 26 49 23m27 6-39 2m67-5 23-3m-23 6 37 2', { opacity: '.4', 'stroke-dasharray': '1 3' }),
      line('m44 88 12-4 8 1 14-6 11 1 12-3 12 6 12-1 10 6Z', { fill: '#322c25' }),
      line('m60 88 17-5 7 1m11 1 7-4 12 7m-7-2 9-1 9 3M22 92h132m-117 4h38m8 0h55m-77 4h54m-41 4h27', { opacity: '.66' }),
      line('M47 90h85m-85 5h78m-59 7h47', { opacity: '.55', 'stroke-dasharray': '1 2' }));
    return h('div', { class: 'v2-clear-card' }, lighthouse, h('h2', { tabindex: '-1' }, 'All clear.'), h('p', {}, message));
  }

  function buildingSection(sheets) {
    if (!sheets.length) return null;
    const { blocks, sheetLine, plainRows } = OW.canvas;
    return h('section', { class: 'v2-building', 'aria-labelledby': 'v2-building-title' },
      h('h2', { id: 'v2-building-title' }, 'Building'),
      h('div', { class: 'v2-build-cards' }, sheets.map(sheet => h('a', { class: 'v2-build-card', href: `#/canvas/${sheet.number}`, 'data-focus': `building:${sheet.number}` },
        h('span', { class: 'v2-build-name' }, sheet.title), icon('right'), blocks(sheet), h('span', { class: 'cv-sheet-line' }, sheetLine(sheet))))),
      h('div', { class: 'v2-build-rows' }, sheets.map(sheet => plainRows(sheet, 'h3'))));
  }

  function nextPreview(card, go) {
    if (!card) return null;
    const href = cardHref(card);
    return h('a', { class: 'v2-next-preview', href, onclick: event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      go(href);
    } },
      h('span', { class: 'v2-label' }, 'Next'),
      h('span', { class: 'v2-next-title' }, card.title),
      h('span', { class: 'v2-next-task' }, card.type === 'decision' ? 'Decision' : 'Review'),
      icon('right'));
  }

  function specPreview(card) {
    const envelope = h('svg', { class: 'v2-envelope', viewBox: '0 0 240 144', 'aria-hidden': 'true',
      fill: 'none', stroke: 'currentColor', 'stroke-linejoin': 'round' },
      h('path', { d: 'M36 28h168v94H36Z', fill: '#1f1b17', 'stroke-width': '1.5' }),
      h('path', { d: 'm37 121 66-52m100 52-66-52M36 29l68 52a26 26 0 0 0 32 0l68-52', 'stroke-width': '1.5' }),
      h('path', { d: 'M41 35v79m158-79v79M44 32h150M44 118h152m-154-6 56-43m100 43-56-43M46 41l60 45a23 23 0 0 0 28 0l60-45',
        opacity: '.68', 'stroke-dasharray': '1 2' }),
      h('path', { d: 'M45 106h19m-18-4h24m-24-4h29m-29-4h35m-34-4h39m-40-4h45m52 0h55m-49 4h49m-43 4h43m-38 4h38m-32 4h32m-27 4h27',
        opacity: '.48', 'stroke-dasharray': '.6 2' }),
      h('circle', { cx: 120, cy: 76, r: 15, fill: '#352d24', 'stroke-width': '1.5' }),
      h('circle', { cx: 120, cy: 76, r: 11, opacity: '.65', 'stroke-dasharray': '1 2' }),
      h('path', { d: 'M115 77q3-4 6 0t6 0m-12 4q3-4 6 0t6 0' }));
    return h('div', { class: 'v2-preview' },
      h('div', { class: 'v2-preview-art', 'aria-hidden': 'true' }, envelope),
      h('div', { class: 'v2-preview-top' }, h('span', { class: 'v2-preview-label' }, 'Narrated spec')),
      h('div', { class: 'v2-preview-caption' },
        h('button', { type: 'button', class: 'v2-preview-btn', 'data-focus': 'scene',
          'aria-label': `Next scene, scene ${card.sceneIdx + 1} of ${card.scenes.length}`,
          onclick: () => { card.sceneIdx = (card.sceneIdx + 1) % card.scenes.length; redraw(); },
        }, icon('right')),
        h('span', { 'aria-live': 'polite' }, card.scenes[card.sceneIdx])));
  }

  function renderDemoFeed(el, arg, controls) {
    const list = pendingDemoCards();
    if (arg === 'clear' || !list.length) {
      controls.replaceChildren();
      el.replaceChildren(h('div', { class: 'v2-feed-stage v2-feed-clear' },
        allClear('Wiz is building. You’ll hear when something needs you.'),
        buildingSection(sampleBuilding())));
      return;
    }

    const index = Math.max(0, list.indexOf(demo.cards[Number(arg) - 1]));
    const card = list[index];
    const next = list[index + 1];
    const decision = card.type === 'decision';
    const go = href => {
      if (href !== location.hash) dismissToast?.();
      history.replaceState(null, '', href);
      el.closest('.v2-view').scrollTop = 0;
      redraw();
    };
    const focusCard = () => el.querySelector('.v2-hero-card h2, .v2-clear-card h2')?.focus({ preventScroll: true });
    const resolve = (status, label, { revision, undoChange } = {}) => {
      const previous = card.status;
      card.status = status;
      if (revision) {
        const { tickets } = demo.specs.find(spec => spec.number === card.spec);
        tickets.push({ n: tickets.at(-1).n + 1, title: 'Requested change', state: 'building', blockers: [tickets.at(-1).n], min: 0, notes: [revision] });
      }
      go(cardHref(next || list[index - 1]));
      focusCard();
      showToast(label, revision ? null : () => {
        undoChange?.();
        card.status = previous;
        go(cardHref(card));
        focusCard();
      });
    };
    const spec = decision ? null : sampleSpec(card.spec);
    const details = spec && h('div', { class: 'v2-progress-box' },
      h('p', {}, h('strong', {}, `${spec.done} of ${spec.total}`), ' tickets merged'),
      OW.canvas.blocks(spec));
    const primaryAction = h('button', { type: 'button', class: 'v2-btn primary', 'data-focus': 'ship',
      onclick: () => resolve(decision ? 'decided' : 'shipped', `${decision ? 'Approved' : 'Shipped'} “${card.title}”`) }, icon('check'), decision ? card.rec : 'Ship it');
    const hero = h('article', { class: 'v2-hero-card' },
      h('div', { class: 'v2-card-top' },
        h('span', { class: 'pill', '--c': STATES.you.colour }, decision ? 'Needs you' : 'Ready to ship'),
        h('h2', { class: 'v2-card-title', tabindex: '-1' }, card.title),
        h('p', { class: 'v2-card-goal' }, card.goal)),
      decision ? null : specPreview(card),
      details,
      h('div', { class: 'v2-card-actions' },
        decision ? h('div', { class: 'v2-primary-slot' }, h('span', { class: 'v2-label v2-rec-tag' }, 'Recommended'), primaryAction) : primaryAction,
        h('button', { type: 'button', class: 'v2-btn v2-change', 'data-focus': 'change',
          onclick: event => openSheet(card, event.currentTarget, undoChange => resolve('changing', 'Change sent', decision
            ? { undoChange } : { revision: 'Working on your change.' })) }, 'Change something'),
        h('button', { type: 'button', class: 'v2-btn subtle v2-defer', 'data-focus': 'defer',
          onclick: () => resolve('deferred', `Saved “${card.title}” for later`) }, 'Not now')));
    const navigation = pager(index, list.length, i => go(cardHref(list[i])));
    controls.replaceChildren(...(navigation ? [navigation] : []));
    el.replaceChildren(h('div', { class: 'v2-feed-stage' },
      hero, nextPreview(next, href => { go(href); focusCard(); }), buildingSection(sampleBuilding())));
  }

  const settingIcons = {
    host: 'M5 5h14v11H5zM5 16l-3 4h20l-3-4',
    effort: 'M4 6h16M9 4v4M4 12h16M15 10v4M4 18h16M11 16v4',
    models: 'm3 8 9-5 9 5-9 5-9-5Zm0 4 9 5 9-5m-18 4 9 5 9-5',
    connections: 'm10 14 4-4m-6 6-2 2a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m4 4a3 3 0 0 0 4 0l4-4a3 3 0 0 0-4-4l-2 2',
    budget: 'M4 7c0 2 4 3 8 3s8-1 8-3-4-4-8-4-8 2-8 4Zm0 0v10c0 2 4 4 8 4s8-2 8-4V7M4 12c0 2 4 3 8 3s8-1 8-3',
    repository: 'm8 6-6 6 6 6m8-12 6 6-6 6',
    exit: 'M9 4H4v16h5m0-8h12m-5-5 5 5-5 5',
  };
  const settingLabel = (key, label) => [
    h('svg', { class: 'ic v2-setting-icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('path', { d: settingIcons[key] })),
    h('span', { class: 'v2-setting-label' }, label),
  ];

  function openSetting(opener, key, label, content, updateValue) {
    const phone = matchMedia('(max-width: 760px)').matches;
    const popover = !phone && typeof HTMLElement.prototype.showPopover === 'function';
    const title = h('h2', { id: `v2-setting-${key}` }, label);
    const panel = h(popover ? 'div' : 'dialog', {
      class: `v2-setting-panel ${popover ? 'v2-setting-popover' : 'v2-sheet'}`,
      popover: popover ? 'auto' : null, role: popover ? 'dialog' : null, 'aria-labelledby': title.id,
    });
    const reset = () => opener.setAttribute('aria-expanded', 'false');
    const close = () => {
      reset();
      if (popover) panel.hidePopover();
      else panel.close();
    };
    const save = apply => {
      apply();
      updateValue();
      close();
      opener.focus({ preventScroll: true });
      showToast('Saved');
    };
    const closeButton = h('button', {
      type: 'button', class: 'v2-btn subtle v2-setting-close', 'aria-label': `Close ${label}`, onclick: close,
    }, '×');
    panel.append(h('header', { class: 'v2-setting-head' }, title, closeButton), content(save));
    const remove = () => {
      reset();
      if (panel.contains(document.activeElement)) opener.focus({ preventScroll: true });
      panel.remove();
    };
    if (popover) {
      panel.addEventListener('beforetoggle', event => { if (event.newState === 'closed') reset(); });
      panel.addEventListener('toggle', event => { if (event.newState === 'closed') remove(); });
    } else {
      panel.addEventListener('close', remove, { once: true });
    }
    opener.closest('.v2-settings').append(panel);
    opener.setAttribute('aria-expanded', 'true');
    if (popover) panel.showPopover({ source: opener });
    else panel.showModal();
    (panel.querySelector('[aria-pressed="true"]') ?? panel.querySelector('.v2-setting-option') ?? closeButton).focus();
    return close;
  }

  const settingOption = (label, selected, action, status) => h('button', {
    class: 'v2-setting-option', type: 'button', 'aria-pressed': String(selected), onclick: action,
  }, h('span', {}, label), status ? [' ', h('span', { class: 'v2-setting-status' }, status)] : null,
  h('span', { class: 'v2-setting-check', 'aria-hidden': 'true' }, selected ? icon('check') : null));

  function renderDemoSettings(el) {
    if (el.querySelector('.v2-settings')) return;
    const s = demo.settings;
    const row = (key, label, current, content) => {
      const value = h('span', { class: 'v2-setting-value' }, current());
      let close;
      const opener = h('button', {
        type: 'button', class: 'v2-set-row v2-setting-trigger', 'aria-haspopup': 'dialog', 'aria-expanded': 'false',
        onclick: () => {
          if (opener.getAttribute('aria-expanded') === 'true') return close();
          close = openSetting(opener, key, label, content, () => { value.textContent = current(); });
        },
      }, settingLabel(key, label), ' ', value, icon('chevron'));
      return opener;
    };
    const choose = (key, label, values) => row(key, label, () => s[key], save =>
      h('div', { class: 'v2-setting-choices' },
        values.map(value => settingOption(value, value === s[key], () => save(() => { s[key] = value; })))));
    const connectionSummary = () => {
      if (s.github && s.notifications) return '2 connected';
      if (s.github) return 'GitHub connected';
      return s.notifications ? 'Notifications connected' : 'Not connected';
    };
    const connectionChoices = save => h('div', { class: 'v2-setting-choices' },
      Object.entries({ github: 'GitHub', notifications: 'Notifications' }).map(([key, label]) =>
        settingOption(label, s[key], () => save(() => { s[key] = !s[key]; }), s[key] ? 'Connected' : 'Not connected')));
    el.replaceChildren(h('div', { class: 'v2-settings' },
      choose('host', 'Where it runs', ['Local workstation', 'Cloud workspace']),
      choose('effort', 'Effort', ['Fast', 'Balanced', 'Thorough']),
      choose('models', 'Models', ['Recommended', 'Faster', 'Higher accuracy']),
      row('connections', 'Connections', connectionSummary, connectionChoices),
      choose('budget', 'Budget', ['$25 / day', '$50 / day', '$100 / day']),
      choose('repository', 'Repository', ['Harbor · main', 'Harbor · staging']),
      h('a', { class: 'v2-set-row v2-sign-out', href: '/app/' }, settingLabel('exit', 'Exit sample workspace'))));
  }

  function renderLiveSettings(el, ctx) {
    let freshness = el.querySelector('.v2-freshness');
    if (!freshness) {
      const readOnly = (key, label, value, className = '') => h('div', { class: 'v2-set-row' },
        settingLabel(key, label), ' ', h('span', { class: `v2-setting-value ${className}` }, value));
      freshness = h('div', { class: 'v2-freshness' });
      el.replaceChildren(h('div', { class: 'v2-settings' },
        readOnly('host', 'Where it runs', 'Coming soon'),
        readOnly('effort', 'Effort', 'Coming soon'),
        readOnly('models', 'Models', 'Coming soon'),
        readOnly('connections', 'GitHub', 'Connected', 'v2-connected'),
        readOnly('budget', 'Budget', 'Coming soon'),
        h('div', { class: 'v2-set-row' }, settingLabel('repository', 'Repository'), ctx.repoSwitch()),
        h('button', { class: 'v2-set-row v2-sign-out', type: 'button', onclick: ctx.signOut }, settingLabel('exit', 'Sign out')),
        h('section', { class: 'v2-settings-freshness' }, h('h2', { class: 'v2-label' }, 'Data freshness'), freshness)));
    }
    freshness.replaceChildren(...ctx.freshnessNodes());
  }

  function stateCard(kind, text) {
    if (kind === 'pause') return h('div', { class: 'v2-pause-note', role: 'status' }, icon('pause'), h('span', {}, text));
    if (kind === 'reading') {
      return h('div', { class: 'placeholder v2-state-card', role: 'status' },
        h('span', { class: 'v2-label' }, 'Syncing'),
        h('h2', {}, text),
        h('p', {}, 'Checking your repository for open specs and decisions.'));
    }
    const labels = { failed: 'Read failed', stale: 'Showing earlier read', partial: 'Partial read' };
    return h('div', { class: 'unknown v2-state-card v2-state-warn', role: 'status' },
      h('div', { class: 'v2-state-head' }, icon('warn'), h('span', { class: 'v2-label' }, labels[kind] || 'Unknown')),
      h('p', {}, text));
  }

  function renderWelcome(root, { note, demoMode }) {
    const card = h('div', { class: 'v2-welcome-card' },
      h('h1', {}, 'Run your software factory from here.'),
      h('p', { class: 'v2-welcome-sub' }, 'Answer a few questions. Watch it build. Ship it.'),
      note ? h('div', { class: 'notice bad', role: 'alert' }, icon('warn'), h('span', {}, note)) : null,
      h('a', { class: 'v2-btn primary v2-welcome-primary', href: demoMode ? '#/chat' : '/api/sign-in/start' },
        demoMode ? 'Open Harbor workspace' : 'Continue with GitHub', icon('right')),
      h('a', { class: 'v2-btn subtle v2-welcome-sample', href: demoMode ? (OW.data.auth.signedIn() ? '/app/' : '/api/sign-in/start') : '/app/?demo=1#/chat' },
        demoMode ? 'Continue with GitHub' : 'See a sample factory'));
    card.prepend(h('header', { class: 'v2-welcome-head' },
      h('div', { class: 'v2-welcome-brand' }, mark(), h('span', {}, 'OpenWiz')),
      demoMode ? h('span', { class: 'v2-sample-tag' }, 'Sample data') : null));
    root.replaceChildren(h('main', { class: 'v2-welcome' }, card));
    document.title = 'OpenWiz';
  }

  OW.v2 = {
    setRedraw: fn => { redraw = fn; },
    renderWelcome,
    allClear,
    sampleCanvas,
    stateCard,
    dismissToast: () => dismissToast?.(),
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
          badge: () => (isDemo ? pendingDemoCards().length : OW.queue.badge()) || null,
          render(el, feeds, arg, controls) {
            if (isDemo) OW.factory.redraw(el.closest('main'), () => renderDemoFeed(el, arg, controls));
            else OW.queue.render(el, feeds, { arg, controls, onCount: ctx.updateBadges });
          },
        },
        ctx.canvas && { ...ctx.canvas, feeds: isDemo ? [] : ctx.canvas.feeds },
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
      ].filter(Boolean);
    },
  };
})();
