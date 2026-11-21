// Cmd-K (Ctrl-K elsewhere), a keyboard-first command palette (AP15, #1327), and the `?` list of every shortcut.
//
// The palette is a modal dialog: a search field (a combobox) over a list of results (a listbox). It finds every page,
// spec, ticket and agent the app shows, from the feeds the pages already read, and runs the app's view actions: open
// on GitHub, copy a link, filter, refresh. It never writes to GitHub: anything that changes work is something an
// agent does through GitHub, and the palette only links to it. The shell mounts it (OW.palette) and its keys.
//
// Function only (J196): no new look. It uses Ember's panel, tokens and focus ring; extra layout is set through the
// CSSOM (the page's CSP allows no style attributes), as the pages do.
'use strict';
(() => {
  const { h, STATES } = OW.ui;
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
  const PALETTE_KEY = MAC ? '⌘ K' : 'Ctrl K';
  const MAX = 60; // results drawn at once; typing narrows the rest
  const KINDS = { page: 'Page', action: 'Action', spec: 'Spec', ticket: 'Ticket', agent: 'Agent' };
  const FILTERS = { page: 'pages', spec: 'specs', ticket: 'tickets', agent: 'agents' };
  const css = (el, props) => { for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v); return el; };
  const GITHUB = url => typeof url === 'string' && url.startsWith('https://github.com/');

  // ---- What the palette finds: the app's pages, its actions, and what the feeds hold ----

  // {kind, id, title, detail, go (an app route), focus (a selector to focus there), url (on GitHub), run (an action)}
  function results() {
    const feeds = OW.data.feeds;
    const home = OW.data.repo.get()?.full;
    const out = [];
    OW.pages.forEach((page, i) => out.push({ kind: 'page', id: `page:${page.id}`, title: page.title, detail: `Press ${i + 1}`, go: `#/${page.id}` }));
    out.push(...actions());
    const seen = OW.factory.model(feeds);
    const tickets = new Map();
    const ticket = (t, spec, where) => ({ kind: 'ticket', id: `ticket:${t.key}`, title: `#${t.number} ${t.title}`,
      detail: `${STATES[t.state]?.word || 'Unknown'} · ${where} #${spec.number} ${spec.title}`, go: `#/specs/${spec.number}`,
      focus: `main .graph [data-focus="${CSS.escape(`ticket:${t.key}`)}"]`, url: t.url });
    for (const spec of seen?.specs || []) {
      out.push({ kind: 'spec', id: `spec:${spec.number}`, title: `#${spec.number} ${spec.title}`,
        detail: spec.total ? `${spec.done} of ${spec.total} tickets done` : '', go: `#/specs/${spec.number}`, focus: 'main .spec-title', url: spec.url });
      for (const t of spec.graph?.tickets || []) if (!t.outside && !tickets.has(t.key)) tickets.set(t.key, ticket(t, spec, 'in'));
    }
    // A readable blocker a graph draws outside its spec, when no spec holds it (its own spec wins); never a placeholder.
    for (const spec of seen?.specs || []) {
      for (const t of spec.graph?.tickets || []) if (t.outside && !t.gap && !tickets.has(t.key)) tickets.set(t.key, ticket(t, spec, 'outside'));
    }
    // Tickets marked for the user that no spec's graph holds: their card on You. (An agent's ticket is its agent's
    // result: Enter goes to its card, Shift Enter opens the ticket.)
    for (const item of seen?.you || []) {
      const key = `${home}#${item.number}`;
      if (item.kind !== 'ticket' || tickets.has(key)) continue;
      tickets.set(key, { kind: 'ticket', id: `ticket:${key}`, title: `#${item.number} ${item.title}`, detail: 'Marked for you', go: '#/you',
        focus: `main [data-focus="${CSS.escape(`item:${item.url}`)}"]`, url: item.url });
    }
    const agents = OW.agents.picture(feeds.agents, home);
    const rows = agents?.broken ? [] : [...(agents?.now || []), ...(agents?.day || [])];
    out.push(...tickets.values());
    for (const row of rows) {
      const who = row.unknown ? 'Unknown agent' : `${row.note.agent[0].toUpperCase()}${row.note.agent.slice(1)}`;
      out.push({ kind: 'agent', id: `agent:${row.id}`, title: `${who} on #${row.issue.number} ${row.issue.title}`,
        detail: row.unknown ? 'Unknown' : `${row.note.state}${row.holds ? '' : ' · in the last day'} · ${OW.ui.agentName(row.note.harness, row.note.model)}`,
        go: '#/agents', focus: `main [data-focus="${CSS.escape(`ticket:${row.key}:${row.id}`)}"]`, url: row.issue.url });
    }
    return out;
  }

  function actions() {
    const home = OW.data.repo.get()?.full;
    const spec = /^#\/specs\/(\d+)$/.exec(location.hash)?.[1];
    const specUrl = spec && OW.factory.model(OW.data.feeds)?.specs.find(s => String(s.number) === spec)?.url;
    const list = [
      { kind: 'action', id: 'refresh', title: 'Refresh now', detail: 'Read GitHub again', run: refresh },
      { kind: 'action', id: 'copy', title: 'Copy a link to this page', detail: 'This page of the app', run: () => copy(location.href, 'this page') },
      { kind: 'action', id: 'github', title: 'Open this page on GitHub', detail: specUrl ? `Spec #${spec}` : home ? `${home}'s issues` : '',
        run: () => openOnGitHub(specUrl || (home ? `https://github.com/${home}/issues` : null)) },
      ...Object.entries(FILTERS).map(([kind, words]) => ({ kind: 'action', id: `filter:${kind}`, title: `Show only ${words}`, detail: 'Filter the palette',
        run: () => { filter = kind; input.value = ''; draw(); } })),
      { kind: 'action', id: 'shortcuts', title: 'Show keyboard shortcuts', detail: 'Press ?', run: () => { close(true); shortcuts(); } },
    ];
    return list;
  }

  // Every word typed must appear in the result's kind, title or detail; titles that start with it come first.
  function match(list, query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = [];
    list.forEach((item, order) => {
      if (filter && item.kind !== filter) return;
      const title = item.title.toLowerCase();
      const all = `${KINDS[item.kind]} ${title} ${item.detail || ''}`.toLowerCase();
      let score = 0;
      for (const word of words) {
        if (!all.includes(word)) return;
        score += title.startsWith(word) ? 3 : title.includes(` ${word}`) || title.includes(`#${word}`) ? 2 : title.includes(word) ? 1 : 0;
      }
      scored.push({ item, score, order });
    });
    return scored.sort((a, b) => b.score - a.score || a.order - b.order).map(s => s.item);
  }

  // ---- What a result does ----

  function refresh() {
    close(true);
    OW.data.refreshAll(); // the shell says when GitHub's limit pauses reads
  }

  function copy(text, what) {
    navigator.clipboard.writeText(text).then(() => say(`Copied the link to ${what}.`), () => say('Couldn\'t copy: this browser refused the clipboard.'));
  }

  function openOnGitHub(url) {
    if (!GITHUB(url)) return say('This has no page on GitHub.');
    close(true);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // Go to the result's place in the app, then focus it there (its card), or open it on GitHub when it has none.
  function go(item) {
    if (item.run) return item.run();
    if (!item.go) return openOnGitHub(item.url);
    close(false);
    // Its card when the page draws it; otherwise the page keeps the focus the shell gave it, or its heading gets it.
    const land = () => {
      const target = item.focus && document.querySelector(item.focus);
      if (target) target.focus();
      else if (!document.querySelector('main')?.contains(document.activeElement)) document.querySelector('main h1')?.focus();
    };
    if (location.hash === item.go) return land();
    window.addEventListener('hashchange', () => setTimeout(land), { once: true }); // after the shell has drawn the page
    location.hash = item.go;
  }

  // ---- The dialogs ----

  let dialog = null;
  let input = null;
  let list = null;
  let status = null;
  let help = null;
  let shown = [];
  let active = 0;
  let filter = null;
  let back = null; // where focus goes when a dialog closes

  const say = text => { if (status) status.textContent = text; };

  // Tab and Shift+Tab stay inside an open dialog: the page behind it is inert.
  function trap(event, box) {
    if (event.key !== 'Tab') return;
    const stops = [...box.querySelectorAll('input, button, a[href]')].filter(el => !el.disabled);
    event.preventDefault();
    if (!stops.length) return;
    const at = stops.indexOf(document.activeElement);
    stops[(at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
  }

  function build() {
    input = h('input', { type: 'text', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-results', 'aria-autocomplete': 'list',
      'aria-label': 'Find a page, spec, ticket or agent, or an action', placeholder: 'Find a page, spec, ticket or agent…', autocomplete: 'off', spellcheck: 'false' });
    css(input, { width: '100%', 'min-height': 'var(--em-tap)', padding: '0 14px', 'font-size': '17px', color: 'var(--em-text)',
      background: 'var(--em-bg)', border: '1px solid var(--em-line)', 'border-radius': 'var(--em-radius-sm)' });
    list = css(h('ul', { id: 'palette-results', role: 'listbox', 'aria-label': 'Results' }),
      { 'list-style': 'none', margin: '12px 0 0', padding: '0', 'max-height': 'min(52vh, 460px)', 'overflow-y': 'auto' });
    status = css(h('p', { class: 'small', role: 'status' }), { margin: '10px 0 0' });
    const hint = css(h('p', { class: 'small', 'aria-hidden': 'true' }, '↑ ↓ choose · Enter go · Shift Enter open on GitHub · Alt Enter copy its link · Esc close'),
      { margin: '6px 0 0' });
    dialog = h('dialog', { class: 'panel', 'aria-label': 'Command palette' }, input, list, status, hint);
    css(dialog, { border: 'none', color: 'var(--em-text)', margin: 'min(12vh, 96px) auto auto', 'max-width': 'calc(100% - 24px)', padding: '18px' });
    input.addEventListener('input', () => { say(''); draw(); });
    dialog.addEventListener('keydown', event => {
      trap(event, dialog);
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation(); // the spec page's Esc (back to all specs) waits until the palette is closed
        return close(true);
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (shown.length) choose((active + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length);
        return;
      }
      if (event.key === 'Backspace' && filter && input.value === '') {
        event.preventDefault();
        filter = null;
        return draw();
      }
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        const item = shown[active];
        if (!item) return;
        if (event.shiftKey) return item.url ? openOnGitHub(item.url) : say('This has no page on GitHub.');
        if (event.altKey) return item.url || item.go ? copy(item.url || new URL(item.go, location.href).href, item.title) : say('This has no link.');
        go(item);
      }
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(true); });
    document.body.append(dialog);
  }

  function option(item, i) {
    const el = h('li', { id: `palette-option-${i}`, role: 'option', 'aria-selected': 'false', onclick: () => { active = i; go(item); } },
      css(h('span', { class: 'num' }, KINDS[item.kind]), { flex: 'none', 'min-width': '58px', font: '400 14px var(--em-mono)', color: 'var(--em-muted)' }), ' ',
      css(h('span', {}, h('span', {}, item.title), item.detail ? css(h('span', {}, ` · ${item.detail}`), { color: 'var(--em-muted)' }) : null),
        { 'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }));
    return css(el, { display: 'flex', gap: '10px', 'align-items': 'baseline', padding: '9px 12px', 'border-radius': 'var(--em-radius-sm)', cursor: 'pointer' });
  }

  function choose(i) {
    const options = list.children;
    if (options[active]) {
      options[active].setAttribute('aria-selected', 'false');
      css(options[active], { background: 'transparent', 'box-shadow': 'none' });
    }
    active = i;
    const el = options[active];
    if (!el || el.getAttribute('role') !== 'option') return input.removeAttribute('aria-activedescendant');
    el.setAttribute('aria-selected', 'true');
    css(el, { background: 'var(--em-card-hover)', 'box-shadow': 'inset 3px 0 0 var(--em-amber)' });
    input.setAttribute('aria-activedescendant', el.id);
    el.scrollIntoView({ block: 'nearest' });
  }

  // Draw the results for what is typed, choosing the first; a refresh (`keep`) keeps the chosen one where it can.
  function draw(keep = false) {
    const was = keep ? shown[active]?.id : null;
    const found = match(results(), input.value);
    shown = found.slice(0, MAX);
    input.placeholder = filter ? `Find ${FILTERS[filter]}… (Backspace shows everything)` : 'Find a page, spec, ticket or agent…';
    const more = found.length - shown.length;
    const empty = filter ? `No ${FILTERS[filter].slice(0, -1)} matches. Backspace in the empty field shows everything.` : 'No match. Try a page, a spec or ticket number, or an agent\'s ticket.';
    list.replaceChildren(...(shown.length ? shown.map(option) : [css(h('li', { class: 'small' }, empty), { padding: '9px 12px', color: 'var(--em-muted)' })]),
      ...(more > 0 ? [css(h('li', { class: 'small', 'aria-hidden': 'true' }, `${more} more: type to narrow`), { padding: '9px 12px', color: 'var(--em-muted)' })] : []));
    active = 0;
    choose(Math.max(0, shown.findIndex(item => item.id === was)));
  }

  function open() {
    if (!dialog) build();
    if (dialog.open) return;
    const was = help?.open ? back : document.activeElement; // from the shortcut list, focus still goes back to the page
    if (help?.open) close(false);
    back = was;
    filter = null;
    input.value = '';
    shown = [];
    say('');
    draw();
    dialog.showModal();
    input.focus();
  }

  // Close whichever dialog is open; `restore` gives focus back to where it was (Esc), not when going somewhere.
  function close(restore) {
    const was = back;
    for (const box of [dialog, help]) if (box?.open) box.close();
    back = null;
    if (!restore) return;
    if (was && was.isConnected && was !== document.body) was.focus();
    else document.querySelector('main h1')?.focus();
  }

  // ---- `?`: every shortcut ----

  const SHORTCUTS = () => [
    ['Anywhere', [
      [PALETTE_KEY, 'Open the command palette: go to any page, spec, ticket or agent, or run an action'],
      ...OW.pages.map((page, i) => [String(i + 1), `Go to ${page.title}`]),
      ['?', 'Show these shortcuts'],
      ['Tab, Shift Tab', 'Move between links and buttons; Enter opens the focused one'],
      ['Esc', 'Close the palette or this list; on a spec\'s page, back to all specs'],
    ]],
    ['In the palette', [
      ['↑ ↓', 'Choose a result (Up and Down)'],
      ['Enter', 'Go there: its page, or its card on the page'],
      ['Shift Enter', 'Open it on GitHub, in a new tab'],
      ['Alt Enter', 'Copy its link'],
      ['Backspace', 'In the empty field, end a filter and show everything'],
    ]],
  ];

  function shortcuts() {
    if (dialog?.open) close(false);
    if (help?.open) return;
    if (!back) back = document.activeElement;
    const done = h('button', { class: 'btn', type: 'button', onclick: () => close(true) }, 'Close');
    // One table row per shortcut: its keys, then what it does.
    const groups = SHORTCUTS().map(([title, rows]) => [
      css(h('h3', {}, title), { margin: '18px 0 8px', 'font-size': '16px', color: 'var(--em-text-2)' }),
      css(h('table', {}, h('tbody', {}, rows.map(([keys, does]) => h('tr', {},
        css(h('th', { scope: 'row' }, css(h('kbd', {}, keys), { font: '500 13px/1 var(--em-mono)', border: '1px solid var(--em-line)', 'border-radius': '5px', padding: '3px 6px', 'white-space': 'nowrap' })),
          { 'text-align': 'left', 'font-weight': '400', padding: '5px 16px 5px 0', 'vertical-align': 'baseline' }),
        css(h('td', {}, does), { color: 'var(--em-text-2)', padding: '5px 0', 'vertical-align': 'baseline' }))))),
      { 'border-collapse': 'collapse' })]);
    help = h('dialog', { class: 'panel', 'aria-labelledby': 'shortcuts-title' },
      css(h('h2', { id: 'shortcuts-title' }, 'Keyboard shortcuts'), { margin: '0', 'font-size': '22px' }), ...groups.flat(),
      css(h('p', { class: 'actions' }, done), { margin: '22px 0 0' }));
    css(help, { border: 'none', color: 'var(--em-text)', margin: 'auto', 'max-width': 'calc(100% - 24px)',
      'max-height': 'calc(100% - 24px)', 'overflow-y': 'auto' });
    help.addEventListener('keydown', event => {
      trap(event, help);
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    });
    help.addEventListener('cancel', event => { event.preventDefault(); close(true); });
    help.addEventListener('close', () => help.remove());
    document.body.append(help);
    help.showModal();
    done.focus();
  }

  // A refresh while the palette is open redraws its results from the new read.
  OW.data.onChange(() => { if (dialog?.open) draw(true); });

  OW.palette = {
    open,
    toggle: () => (dialog?.open ? close(true) : open()),
    shortcuts,
    close: () => close(false),
    shown: () => Boolean(dialog?.open || help?.open),
  };
})();
