'use strict';
(() => {
  const { h, STATES, time } = OW.ui;
  const SVG = 'http://www.w3.org/2000/svg';
  const DAY = 24 * 60 * 60 * 1000;
  const QUIET = 3 * DAY;
  const NODE = { width: 260, height: 128 };
  const PLAIN_NODE = { width: 236, height: 92 };
  const nodeSize = () => (OW.v2 ? PLAIN_NODE : NODE);
  const ZOOM = { min: 0.25, max: 1.6, far: 0.6 };
  const PHONE = matchMedia('(max-width: 760px)');

  const css = (el, props) => { for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v); return el; };
  const svg = (tag, attrs = {}) => {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  };
  const ago = (at, now) => {
    const min = Math.max(0, Math.round((now - at) / 60000));
    return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : min < 48 * 60 ? `${Math.floor(min / 60)} h ago` : `${Math.floor(min / 1440)} days ago`;
  };
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const RANK = row => (row.unknown ? 3 : row.holds ? (row.note.state === 'asking' ? 0 : 1) : row.live ? 2 : 4);
  function rowsOf(entry, now) {
    return (entry?.notes || []).filter(r => r.unknown || r.holds || r.live || now - r.at < DAY)
      .sort((a, b) => RANK(a) - RANK(b) || b.at - a.at);
  }

  function ticketOf(t, spec, notes, now, home) {
    if (t.gap) {
      return { key: t.key, number: null, title: t.title, url: t.url, state: 'unknown', gap: true, outside: true, blockers: [], blocks: [],
        members: [], you: false, working: false, activity: 0, lead: null };
    }
    const sub = (spec.detail?.subIssues?.nodes || []).find(issue => issue && `${issue.repository?.nameWithOwner || home}#${issue.number}` === t.key);
    const entry = notes.get(t.key);
    const issue = entry?.issue || sub || null;
    const rows = t.outside ? [] : rowsOf(entry, now);
    const members = rows.map(row => ({ kind: 'note', id: row.id, row, status: OW.agents.status(row) }));
    const lead = members[0] || null;
    const pr = issue && !t.outside ? OW.agents.pullRequest({ issue, note: lead?.row.note || null }) : null;
    if (pr) members.push({ kind: 'pr', pr });
    if (!t.outside) members.push({ kind: 'ticket', labels: (sub?.labels?.nodes || []).filter(Boolean).map(l => l.name) });
    return {
      key: t.key, number: t.number, title: t.title, url: t.url, state: t.state, gap: false, outside: t.outside,
      blockers: t.blockers.filter(b => !b.startsWith('gap-')), missing: t.missing || 0, blocks: [],
      members, lead: lead ? lead.status : null,
      you: t.state === 'you' || members.some(m => m.kind === 'note' && m.status === 'asking'),
      working: members.some(m => m.kind === 'note' && m.status === 'working'),
      activity: Math.max(0, ...rows.map(r => r.at)),
    };
  }

  function sheetOf(spec, seen, notes, now, home) {
    const decisions = seen.you.filter(item => item.number === spec.number && (item.kind === 'spec_confirmation' || item.kind === 'plan_approval'));
    const tickets = spec.graph ? spec.graph.tickets.map(t => ticketOf(t, spec, notes, now, home)) : [];
    const byKey = new Map(tickets.map(t => [t.key, t]));
    for (const t of tickets) for (const b of t.blockers) byKey.get(b)?.blocks.push(t.key);
    const own = tickets.filter(t => !t.outside);
    const count = state => own.filter(t => t.state === state).length;
    const said = (spec.detail?.comments?.nodes || []).filter(Boolean).map(c => Date.parse(c.updatedAt) || 0);
    const activity = Math.max(0, ...own.map(t => t.activity), ...said);
    const you = own.filter(t => t.you).length + decisions.length;
    const working = own.filter(t => t.working).length;
    const finished = spec.total > 0 && spec.done === spec.total;
    const idle = activity > 0 && now - activity > QUIET;
    const empty = spec.total === 0 && !decisions.length;
    return {
      number: spec.number, title: spec.title, url: spec.url, total: spec.total, done: spec.done,
      read: Boolean(spec.graph), unknown: spec.graph?.unknown || 0, tickets, decisions,
      counts: { you, working, review: count('review'), building: count('building'), merged: count('merged') },
      activity, quiet: !you && !working && (finished || idle || empty),
    };
  }

  function model(seen, notes, now, home) {
    if (!seen) return null;
    const keyOf = n => `${home}#${n}`;
    const sheets = seen.specs.map(spec => sheetOf(spec, seen, notes, now, home));
    const group = s => (s.quiet ? 3 : s.counts.you ? 0 : s.counts.working ? 1 : 2);
    sheets.sort((a, b) => group(a) - group(b) || b.activity - a.activity || b.number - a.number);
    const sheetFor = new Map();
    for (const s of sheets) for (const t of s.tickets) if (!t.outside && !t.gap && !sheetFor.has(t.key)) sheetFor.set(t.key, s.number);
    const inbox = [];
    const asked = new Map();
    for (const s of sheets) {
      for (const t of s.tickets) {
        if (t.outside) continue;
        const note = t.members.find(m => m.kind === 'note' && m.status === 'asking');
        if (note) asked.set(t.key, { t, note, sheet: s.number });
      }
    }
    for (const item of seen.you) {
      const ticket = item.kind === 'ticket' ? keyOf(item.number) : null;
      const ask = ticket ? asked.get(ticket) : null;
      if (ask) asked.delete(ticket);
      inbox.push({ kind: ask ? 'asking' : item.kind, sheet: ticket ? sheetFor.get(ticket) ?? null : item.number, ticket, number: item.number,
        title: item.title, url: item.url, at: ask ? Math.max(item.at || 0, ask.note.row.at) : item.at || 0,
        step: ask ? ask.note.row.note.step : null, agent: ask ? ask.note.row.note.agent : null });
    }
    for (const [key, { t, note, sheet }] of asked) {
      inbox.push({ kind: 'asking', sheet, ticket: key, number: t.number, title: t.title, url: t.url, at: note.row.at,
        step: note.row.note.step, agent: note.row.note.agent });
    }
    inbox.sort((a, b) => b.at - a.at);
    return { sheets, inbox, gaps: seen.gaps.slice(), partial: seen.partialSpecs };
  }
  function read(feeds, now) {
    if (OW.data.demo && OW.canvas.source) return OW.canvas.source(now);
    return model(OW.factory.model(feeds), OW.agents.notes(now), now, home());
  }
  const view = { place: 'page', sheet: null, cams: new Map(), mode: 'board', focus: null, spread: null, query: '', quietOpen: false, over: 0, aim: null, inboxAll: false };
  let last = null;
  let shown = null;
  const home = () => OW.data.repo.get()?.full;

  const PLAIN = {
    you: ['Needs you', STATES.you.colour],
    building: ['Building', STATES.building.colour],
    review: ['In review', STATES.review.colour],
    merged: ['Done', STATES.merged.colour],
    ready: ['Up next', STATES.ready.colour],
    waiting: ['Waiting', STATES.waiting.colour],
    held: ['On hold', STATES.held.colour],
    unknown: ['Unknown', STATES.unknown.colour],
  };
  function plainOf(t) {
    if (t.you) return 'you';
    if (t.state === 'merged' || t.state === 'review' || t.state === 'held') return t.state;
    if (t.lead === 'stopped') return 'held';
    if (t.working) return 'building';
    return PLAIN[t.state] ? t.state : 'unknown';
  }
  const pillOf = t => (OW.v2 ? h('span', { class: 'pill', '--c': PLAIN[plainOf(t)][1] }, PLAIN[plainOf(t)][0]) : OW.ui.pill(t.state));
  const colourOf = t => (OW.v2 ? PLAIN[plainOf(t)][1] : t.lead ? OW.agents.WORDS[t.lead][1] : STATES[t.state]?.colour || STATES.unknown.colour);
  const wordOf = t => (OW.v2 ? PLAIN[plainOf(t)][0] : t.lead ? OW.agents.WORDS[t.lead][0] : STATES[t.state]?.word || 'Unknown');
  const dot = (colour, ring) => h('span', { class: `cv-dot${ring ? ' ring' : ''}`, '--c': colour, 'aria-hidden': 'true' });

  function layout(sheet, phone) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: phone ? 'TB' : 'LR', nodesep: phone ? 24 : 36, ranksep: view.place === 'embed' ? 72 : phone || OW.v2 ? 56 : 84, marginx: OW.v2 ? 16 : 32, marginy: OW.v2 ? 24 : 40 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const t of sheet.tickets) g.setNode(t.key, { ...nodeSize() });
    for (const t of sheet.tickets) for (const b of t.blockers) if (g.hasNode(b)) g.setEdge(b, t.key);
    dagre.layout(g);
    return g;
  }

  function plainCard(t) {
    return h('div', { class: 'cv-card cv-plain', '--c': colourOf(t) },
      h('div', { class: 'cv-plain-top' }, h('span', { class: 'num' }, t.number ? `#${t.number}` : 'Blocked by'), pillOf(t)),
      h('h3', {}, t.title));
  }
  function plainNote(m, now) {
    const row = m.row;
    return h('div', { class: 'cv-card', '--c': PLAIN[m.status === 'asking' ? 'you' : m.status === 'working' ? 'building' : m.status === 'done' ? 'merged' : 'waiting'][1] },
      h('p', { class: 'cv-step' }, row.unknown ? 'An update that couldn\'t be read.' : row.note.step),
      h('p', { class: 'cv-meta' }, ago(row.unknown ? row.at : Date.parse(row.note.time) || row.at, now)));
  }

  function memberCard(m, t, now, front) {
    if (m.kind === 'note') {
      const [word, colour] = OW.agents.WORDS[m.status];
      const row = m.row;
      if (row.unknown) {
        return h('div', { class: 'cv-card', '--c': colour }, h('div', { class: 'num' }, 'Unknown agent'),
          front ? h('h3', {}, `#${t.number} ${t.title}`) : null,
          h('p', {}, `This ticket has ${row.unknown}.`), h('p', { class: 'cv-meta' }, h('span', { class: 'pill', '--c': colour }, word), ` · ${ago(row.at, now)}`));
      }
      const n = row.note;
      return h('div', { class: 'cv-card', '--c': colour },
        h('div', { class: 'num' }, `${OW.agents.KIND[n.agent]} · ${OW.ui.agentName(n.harness, n.model)}`),
        front ? h('h3', {}, `#${t.number} ${t.title}`) : null,
        h('p', { class: 'cv-step' }, n.step),
        h('p', { class: 'cv-meta' }, h('span', { class: 'pill', '--c': colour }, n.why ? `${word}: ${n.why}` : word), ` · ${ago(Date.parse(n.time) || row.at, now)}`));
    }
    if (m.kind === 'pr') {
      return h('div', { class: 'cv-card', '--c': STATES.review.colour },
        h('div', { class: 'num' }, m.pr.number ? `Pull request #${m.pr.number}` : 'Pull request'),
        front ? h('h3', {}, `#${t.number} ${t.title}`) : null, h('p', { class: 'cv-step' }, m.pr.facts));
    }
    const waits = t.blockers.length ? `Waits for ${t.blockers.map(k => `#${k.split('#').pop()}`).join(', ')}` : 'Waits for nothing';
    const blocks = t.blocks.length ? ` · blocks ${t.blocks.map(k => `#${k.split('#').pop()}`).join(', ')}` : '';
    return h('div', { class: 'cv-card', '--c': STATES[t.state]?.colour },
      h('div', { class: 'num' }, `Ticket #${t.number}`),
      front ? h('h3', {}, t.title) : null,
      h('p', { class: 'cv-step' }, `${waits}${blocks}`),
      h('p', { class: 'cv-meta' }, OW.ui.pill(t.state), m.labels?.length ? ` · ${m.labels.join(', ')}` : ''));
  }

  function stackEl(t, now) {
    const colour = colourOf(t);
    if (OW.v2) return plainStack(t, colour);
    if (t.gap || t.outside) {
      return h('div', { class: 'cv-stack outside', 'data-ticket': t.key, 'data-state': t.state, '--c': colour },
        h('div', { class: 'cv-card', '--c': colour }, h('div', { class: 'num' }, t.gap ? 'Blocked by' : `#${t.number} · outside this spec`),
          h('h3', {}, t.title), h('p', { class: 'cv-meta' }, OW.ui.pill(t.state))));
    }
    const spread = view.spread === t.key;
    const [front, ...behind] = t.members;
    const label = `#${t.number} ${t.title}: ${wordOf(t)}. ${plural(t.members.length, 'card')}. Space spreads, Enter opens.`;
    const el = h('div', { class: `cv-stack${t.you ? ' you' : ''}${spread ? ' spread' : ''}`, 'data-ticket': t.key, 'data-state': t.state,
      'data-lead': t.lead || '', 'data-focus': `stack:${t.key}`, tabindex: '0', role: 'button', 'aria-expanded': behind.length ? String(spread) : null,
      'aria-label': label, '--c': colour },
    behind.length ? h('span', { class: 'cv-count', 'aria-hidden': 'true' }, String(t.members.length)) : null,
    h('div', { class: 'cv-front' }, memberCard(front, t, now, true)),
    h('div', { class: 'cv-tile', 'aria-hidden': 'true' }, dot(colour, t.state === 'waiting' || t.state === 'ready'), h('b', {}, `#${t.number}`), h('span', {}, t.title)),
    behind.length ? h('div', { class: 'cv-behind' }, behind.map(m => memberCard(m, t, now, false))) : null);
    el.addEventListener('click', event => {
      if (event.target.closest('a')) return;
      if (event.detail > 1) return open(t.key);
      spreadToggle(t.key);
    });
    el.addEventListener('keydown', event => {
      if (event.key === ' ') { event.preventDefault(); spreadToggle(t.key); }
      if (event.key === 'Enter') { event.preventDefault(); open(t.key); }
    });
    return el;
  }

  function plainStack(t, colour) {
    if (t.gap || t.outside) {
      return h('div', { class: 'cv-stack outside', 'data-ticket': t.key, 'data-state': t.state, '--c': colour }, h('div', { class: 'cv-front' }, plainCard(t)));
    }
    const layers = Math.min(2, t.members.filter(m => m.kind !== 'ticket').length);
    const el = h('div', { class: `cv-stack${t.you ? ' you' : ''}`, 'data-ticket': t.key, 'data-state': t.state, 'data-lead': t.lead || '',
      'data-focus': `stack:${t.key}`, tabindex: '0', role: 'button', 'aria-label': `#${t.number} ${t.title}: ${wordOf(t)}`, '--c': colour },
    h('div', { class: 'cv-front' }, plainCard(t)),
    h('div', { class: 'cv-tile', 'aria-hidden': 'true' }, dot(colour, t.state === 'waiting' || t.state === 'ready'), h('b', {}, `#${t.number}`), h('span', {}, t.title)),
    layers ? h('div', { class: 'cv-behind', 'aria-hidden': 'true' }, Array.from({ length: layers }, () => h('div', { class: 'cv-card' }))) : null);
    const choose = () => {
      if (view.place === 'embed' && t.href) location.hash = t.href;
      else open(t.key);
    };
    el.addEventListener('click', choose);
    el.addEventListener('keydown', event => {
      if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); choose(); }
    });
    return el;
  }

  function spreadToggle(key) {
    view.spread = view.spread === key ? null : key;
    rerender();
  }
  function open(key) {
    view.focus = key;
    view.spread = null;
    rerender();
  }

  function camOf(number) { return view.cams.get(number); }
  function apply(board) {
    const cam = camOf(board.sheet.number);
    if (!cam) return;
    board.world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
    board.root.classList.toggle('far', cam.z < ZOOM.far);
    board.zoom.textContent = `${Math.round(cam.z * 100)}%`;
    if (board.mini) {
      const r = board.viewport.getBoundingClientRect();
      const s = board.mini.scale;
      const { width, height } = board.size;
      const x0 = Math.max(0, -cam.x / cam.z);
      const y0 = Math.max(0, -cam.y / cam.z);
      const x1 = Math.min(width, (r.width - cam.x) / cam.z);
      const y1 = Math.min(height, (r.height - cam.y) / cam.z);
      board.mini.frame.hidden = x1 <= x0 || y1 <= y0;
      css(board.mini.frame, { left: `${x0 * s}px`, top: `${y0 * s}px`, width: `${(x1 - x0) * s}px`, height: `${(y1 - y0) * s}px` });
    }
  }
  function fit(board) {
    const r = board.viewport.getBoundingClientRect();
    const { width, height } = board.size;
    const TOP = view.place === 'embed' ? 0 : OW.v2 ? 72 : 56;
    const across = (r.width - 24) / width;
    const z = Math.max(ZOOM.min, Math.min(1, PHONE.matches ? across : Math.min(across, (r.height - TOP - 24) / height)));
    const cam = { z, x: (r.width - width * z) / 2, y: PHONE.matches ? TOP : Math.max(TOP, (r.height - height * z) / 2 + (OW.v2 ? 0 : TOP / 2)) };
    view.cams.set(board.sheet.number, cam);
    if (PHONE.matches) css(board.root, { height: `${Math.max(380, Math.ceil(height * z + TOP + 24))}px` });
    fitted.set(board.sheet.number, { ...cam });
    apply(board);
  }
  const fitted = new Map();
  function stillFitted(number) {
    const cam = camOf(number);
    const at = fitted.get(number);
    return !!cam && !!at && cam.x === at.x && cam.y === at.y && cam.z === at.z;
  }
  function refitOnResize(board) {
    let width = 0;
    let height = 0;
    const watch = new ResizeObserver(([entry]) => {
      if (!board.viewport.isConnected) return watch.disconnect();
      const { width: w, height: ht } = entry.contentRect;
      if (w === width && ht === height) return;
      [width, height] = [w, ht];
      if (w && ht && stillFitted(board.sheet.number)) fit(board);
    });
    watch.observe(board.viewport);
  }
  function zoomAt(board, factor, px, py) {
    const cam = camOf(board.sheet.number);
    const z = Math.max(ZOOM.min, Math.min(ZOOM.max, cam.z * factor));
    const k = z / cam.z;
    Object.assign(cam, { x: px - (px - cam.x) * k, y: py - (py - cam.y) * k, z });
    apply(board);
  }
  function centre(board, key, atLeast = 0.85) {
    const node = board.g.node(key);
    if (!node) return;
    const r = board.viewport.getBoundingClientRect();
    const cam = camOf(board.sheet.number);
    const z = Math.max(cam.z, Math.min(1, atLeast));
    Object.assign(cam, { z, x: r.width / 2 - node.x * z, y: r.height / 2 - node.y * z });
    apply(board);
  }

  function boardOf(sheet, now) {
    const embedded = view.place === 'embed';
    const size = nodeSize();
    const g = layout(sheet, PHONE.matches || embedded);
    const { width, height } = g.graph();
    const lines = svg('svg', { class: 'cv-lines', width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' });
    const marker = svg('marker', { id: 'cv-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    marker.append(svg('path', { d: 'M0 0 10 5 0 10Z', class: 'cv-arrowhead' }));
    lines.append(svg('defs'));
    lines.firstChild.append(marker);
    const byKey = new Map(sheet.tickets.map(t => [t.key, t]));
    for (const e of g.edges()) {
      const p = g.edge(e).points;
      const d = p.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' ');
      const from = byKey.get(e.v);
      lines.append(css(svg('path', { d, 'marker-end': 'url(#cv-arrow)', 'data-from': e.v, 'data-to': e.w, class: 'cv-line' }),
        { stroke: from?.state === 'merged' ? STATES.merged.colour : 'var(--em-muted)' }));
    }
    const world = css(h('div', { class: 'cv-world' }, lines), { width: `${width}px`, height: `${height}px` });
    for (const t of sheet.tickets) {
      const at = g.node(t.key);
      world.append(css(stackEl(t, now), { left: `${at.x - size.width / 2}px`, top: `${at.y - size.height / 2}px`, width: `${size.width}px` }));
    }
    const viewport = h('div', { class: 'cv-view', 'aria-label': `Board of spec #${sheet.number}`, role: 'group' }, world);
    const zoom = h('span', { class: 'cv-zoom', 'aria-live': 'polite' });
    const root = h('div', { class: 'cv-board' });
    const board = { sheet, g, size: { width, height }, world, viewport, zoom, root, mini: null };
    if (embedded) {
      root.append(viewport);
      refitOnResize(board);
      return board;
    }
    const button = (text, label, onclick) => h('button', { class: 'btn cv-tool', type: 'button', 'aria-label': label, onclick }, text);
    const tools = h('div', { class: 'cv-tools' },
      button('−', 'Zoom out', () => { const r = viewport.getBoundingClientRect(); zoomAt(board, 1 / 1.25, r.width / 2, r.height / 2); }),
      zoom,
      button('+', 'Zoom in', () => { const r = viewport.getBoundingClientRect(); zoomAt(board, 1.25, r.width / 2, r.height / 2); }),
      button('Fit', 'Fit the board', () => fit(board)),
      button('Sheets', 'Show every sheet (L)', () => { view.mode = 'over'; view.over = Math.max(0, visibleSheets().findIndex(s => s.number === sheet.number)); rerender(); }));
    root.append(tools, viewport, minimap(board), legend());
    wirePan(board);
    refitOnResize(board);
    return board;
  }

  function minimap(board) {
    const { width, height } = board.size;
    const size = nodeSize();
    const scale = Math.min(150 / width, 96 / height);
    const frame = h('span', { class: 'cv-mini-frame' });
    const el = css(h('div', { class: 'cv-mini', 'aria-hidden': 'true' }), { width: `${width * scale}px`, height: `${height * scale}px` });
    for (const t of board.sheet.tickets) {
      const n = board.g.node(t.key);
      el.append(css(h('i', { '--c': colourOf(t) }), { left: `${(n.x - size.width / 2) * scale}px`, top: `${(n.y - size.height / 2) * scale}px`,
        width: `${size.width * scale}px`, height: `${size.height * scale}px` }));
    }
    el.append(frame);
    el.addEventListener('pointerdown', event => {
      const r = el.getBoundingClientRect();
      const v = board.viewport.getBoundingClientRect();
      const cam = camOf(board.sheet.number);
      const wx = (event.clientX - r.left) / scale;
      const wy = (event.clientY - r.top) / scale;
      Object.assign(cam, { x: v.width / 2 - wx * cam.z, y: v.height / 2 - wy * cam.z });
      apply(board);
    });
    board.mini = { scale, frame };
    return el;
  }

  function legend() {
    const W = OW.agents.WORDS;
    if (OW.v2) {
      return h('p', { class: 'cv-legend', 'aria-hidden': 'true' },
        ['you', 'building', 'review', 'merged', 'waiting'].map(state => h('span', {}, dot(PLAIN[state][1], state === 'waiting'), PLAIN[state][0])));
    }
    return h('p', { class: 'cv-legend', 'aria-hidden': 'true' },
      ...[['working', W.working], ['asking', [STATES.you.word, STATES.you.colour]], ['review', [STATES.review.word, STATES.review.colour]],
        ['merged', [STATES.merged.word, STATES.merged.colour]], ['stopped', W.stopped]]
        .map(([, [word, colour]]) => h('span', {}, dot(colour), word)));
  }

  function wirePan(board) {
    const v = board.viewport;
    const points = new Map();
    let pinch = null;
    v.addEventListener('pointerdown', event => {
      if (event.target.closest('.cv-stack, button, a, input')) return;
      v.setPointerCapture(event.pointerId);
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      v.classList.add('grabbing');
    });
    v.addEventListener('pointermove', event => {
      const was = points.get(event.pointerId);
      if (!was) return;
      const cam = camOf(board.sheet.number);
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (points.size === 2) {
        const [a, b] = [...points.values()];
        const r = v.getBoundingClientRect();
        const span = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
        if (pinch) zoomAt(board, span / pinch, mid.x, mid.y);
        pinch = span;
        return;
      }
      cam.x += event.clientX - was.x;
      if (!PHONE.matches) cam.y += event.clientY - was.y;
      apply(board);
    });
    const up = event => {
      points.delete(event.pointerId);
      if (points.size < 2) pinch = null;
      if (!points.size) v.classList.remove('grabbing');
    };
    v.addEventListener('pointerup', up);
    v.addEventListener('pointercancel', up);
    v.addEventListener('wheel', event => {
      event.preventDefault();
      const r = v.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) return zoomAt(board, Math.exp(-event.deltaY * 0.01), event.clientX - r.left, event.clientY - r.top);
      const cam = camOf(board.sheet.number);
      cam.x -= event.deltaX;
      cam.y -= event.deltaY;
      apply(board);
    }, { passive: false });
  }

  function visibleSheets() {
    const all = shown?.sheets || [];
    return all.filter(s => !s.quiet || view.quietOpen || s.number === view.sheet);
  }

  function blocks(sheet) {
    const own = sheet.tickets.filter(t => !t.outside && !t.gap);
    return h('span', { class: 'cv-blocks', 'aria-hidden': 'true' },
      own.map(t => h('i', { '--c': colourOf(t), class: t.working ? 'on' : t.state === 'waiting' || t.state === 'ready' ? 'off' : '' })));
  }
  function sheetLine(sheet) {
    const c = sheet.counts;
    const parts = [];
    if (c.you) parts.push(`${c.you} need${c.you === 1 ? 's' : ''} you`);
    const building = OW.v2 ? sheet.tickets.filter(t => !t.outside && plainOf(t) === 'building').length : c.working;
    if (building) parts.push(`${building} ${OW.v2 ? 'building' : 'working'}`);
    if (!sheet.read) parts.push('tickets unknown');
    else if (sheet.total === 0) parts.push(sheet.decisions.length ? 'no tickets yet' : 'no tickets');
    else if (sheet.total) parts.push(`${sheet.done} of ${sheet.total} done`);
    return parts.join(' · ');
  }

  function rail(m) {
    const items = [];
    const quiet = m.sheets.filter(s => s.quiet);
    for (const s of m.sheets.filter(x => !x.quiet || view.quietOpen || x.number === view.sheet)) {
      const hits = view.query ? matches(s).length : null;
      items.push(h('a', { class: `cv-sheet${s.number === view.sheet ? ' on' : ''}${s.counts.you ? ' you' : ''}${s.quiet ? ' quiet' : ''}`,
        href: `#/canvas/${s.number}`, 'data-sheet': s.number, 'data-focus': `sheet:${s.number}`, 'aria-current': s.number === view.sheet ? 'page' : null },
      h('span', { class: 'cv-sheet-name' }, `#${s.number} ${s.title}`), blocks(s),
      h('span', { class: 'cv-sheet-line' }, hits === null ? sheetLine(s) : `${plural(hits, 'match', 'matches')}`)));
    }
    if (quiet.length) {
      items.push(h('button', { class: 'cv-sheet cv-quiet', type: 'button', 'aria-expanded': String(view.quietOpen), 'data-focus': 'quiet',
        onclick: () => { view.quietOpen = !view.quietOpen; rerender(); } },
      h('span', { class: 'cv-sheet-name' }, `Quiet · ${quiet.length}`),
      h('span', { class: 'cv-sheet-line' }, view.quietOpen ? 'Fold them away' : 'Finished, or no activity for 3 days')));
    }
    return h('nav', { class: 'cv-rail', 'aria-label': 'Sheets' }, items);
  }

  const INBOX_SHOWN = 6;
  const INBOX_WORDS = {
    asking: item => `${OW.v2 ? 'Question' : item.agent ? `${OW.agents.KIND[item.agent]} asks` : 'Asking you'}: ${item.step}`,
    feed: item => item.title,
    ticket: () => (OW.v2 ? 'Ticket waiting on you' : 'Ticket marked for you'),
    spec_confirmation: () => 'Spec to confirm',
    plan_approval: () => 'Plan to approve',
    unreadable: () => 'A decision record that couldn\'t be read',
  };
  function inbox(m) {
    if (!m.inbox.length) {
      return h('p', { class: 'cv-inbox calm' }, m.gaps.length ? 'Nothing needs you in what GitHub gave; part of the read is missing, so this may change.'
        : 'Nothing needs you right now.');
    }
    if (OW.v2 && m.inbox.every(item => item.href)) {
      const label = [dot(STATES.you.colour), `Needs you · ${m.inbox.length}`];
      if (PHONE.matches) return h('a', { class: 'cv-inbox cv-inbox-link', href: m.inbox[0].href, 'data-focus': 'inbox:0' }, h('span', { class: 'cv-inbox-label' }, label), OW.ui.icon('right'));
      return h('div', { class: 'cv-inbox', role: 'list', 'aria-label': 'Needs you' }, h('span', { class: 'cv-inbox-label' }, label),
        m.inbox.map((item, i) => h('span', { class: 'cv-chip', role: 'listitem' },
          h('a', { class: 'cv-chip-go', href: item.href, 'data-focus': `inbox:${i}`, 'data-item': item.kind }, h('span', { class: 'cv-chip-text' }, INBOX_WORDS[item.kind](item))))));
    }
    return h('div', { class: 'cv-inbox', role: 'list', 'aria-label': 'Needs you' },
      h('span', { class: 'cv-inbox-label' }, dot(STATES.you.colour), `Needs you · ${m.inbox.length}`),
      (view.inboxAll ? m.inbox : m.inbox.slice(0, INBOX_SHOWN)).map((item, i) => h('span', { class: 'cv-chip', role: 'listitem' },
        h('button', { type: 'button', class: 'cv-chip-go', 'data-focus': `inbox:${i}`, 'data-item': item.kind,
          disabled: item.sheet === null ? true : null, onclick: () => goTo(item) },
        h('span', { class: 'num' }, item.ticket ? `#${item.number}` : `spec #${item.number}`), h('span', { class: 'cv-chip-text' }, INBOX_WORDS[item.kind](item))),
        h('a', { href: item.url, rel: 'noreferrer', target: '_blank', 'aria-label': `Open #${item.number} on GitHub`, 'data-focus': `inbox-link:${i}` }, 'GitHub ↗'))),
      m.inbox.length > INBOX_SHOWN ? h('button', { type: 'button', class: 'cv-more-items', 'data-focus': 'inbox-more', 'aria-expanded': String(Boolean(view.inboxAll)),
        onclick: () => { view.inboxAll = !view.inboxAll; rerender(); } }, view.inboxAll ? 'Show fewer' : `${m.inbox.length - INBOX_SHOWN} more`) : null);
  }

  function goTo(item) {
    view.mode = 'board';
    view.focus = null;
    view.spread = null;
    view.aim = item.ticket;
    go(item.sheet);
  }
  function go(number) {
    if (view.sheet === number && location.hash === `#/canvas/${number}`) return rerender();
    location.hash = `#/canvas/${number}`;
  }

  function matches(sheet) {
    const q = view.query.trim().toLowerCase().replace(/^#/, '');
    if (!q) return [];
    return sheet.tickets.filter(t => !t.outside && !t.gap && (String(t.number) === q || t.title.toLowerCase().includes(q)
      || t.members.some(mb => mb.kind === 'note' && !mb.row.unknown && mb.row.note.step.toLowerCase().includes(q))));
  }
  function search(m) {
    const input = h('input', { type: 'search', class: 'cv-search', placeholder: 'Find a ticket  /', 'aria-label': 'Find a ticket by number, title or step',
      'data-focus': 'search', value: view.query, autocomplete: 'off' });
    input.addEventListener('input', () => {
      view.query = input.value;
      mark();
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.stopPropagation(); input.value = ''; view.query = ''; mark(); input.blur(); }
      if (event.key === 'Enter') {
        event.preventDefault();
        const here = m.sheets.find(s => s.number === view.sheet);
        const local = here && matches(here)[0];
        if (local) { view.aim = local.key; return rerender(); }
        const other = m.sheets.find(s => matches(s).length);
        if (other) { view.aim = matches(other)[0].key; go(other.number); }
      }
    });
    return input;
  }
  function mark() {
    const root = last?.[0];
    if (!root || !shown) return;
    const here = shown.sheets.find(s => s.number === view.sheet);
    const hits = new Set(here ? matches(here).map(t => t.key) : []);
    root.querySelectorAll('.cv-stack[data-ticket]').forEach(el => {
      el.classList.toggle('dim', Boolean(view.query.trim()) && !hits.has(el.dataset.ticket));
      el.classList.toggle('hit', hits.has(el.dataset.ticket));
    });
    root.querySelectorAll('.cv-sheet[data-sheet]').forEach(el => {
      const s = shown.sheets.find(x => String(x.number) === el.dataset.sheet);
      el.querySelector('.cv-sheet-line').textContent = view.query.trim() ? plural(matches(s).length, 'match', 'matches') : sheetLine(s);
    });
  }

  function plainFocus(sheet, t, now) {
    const back = () => { view.focus = null; view.aim = t.key; rerender(); };
    const notes = t.members.filter(m => m.kind === 'note');
    const names = keys => (keys.length ? keys.map(k => {
      const other = sheet.tickets.find(x => x.key === k);
      return h('span', { class: 'cv-fact-ticket' }, `#${k.split('#').pop()} ${other?.title ?? ''}`, other ? pillOf(other) : null);
    }) : 'Nothing');
    const pane = h('section', { class: 'cv-focus', 'aria-label': `Ticket #${t.number}`, '--c': colourOf(t) },
      h('div', { class: 'cv-focus-head' },
        h('h3', { tabindex: '-1', 'data-focus': 'focus-title' }, h('span', { class: 'num' }, `#${t.number}`), ` ${t.title}`), pillOf(t),
        h('span', { class: 'cv-gap' }),
        t.href ? h('a', { class: 'v2-btn primary', href: t.href, 'data-focus': 'focus-decide' }, 'Decide in Feed') : null,
        t.url ? h('a', { class: 'v2-btn', href: t.url, rel: 'noreferrer', target: '_blank', 'data-focus': 'focus-ticket' }, 'Open the ticket ↗') : null,
        h('button', { class: 'v2-btn', type: 'button', onclick: back, 'aria-keyshortcuts': 'Escape', 'data-focus': 'focus-back' }, 'Back')),
      h('div', { class: 'cv-focus-body' },
        h('div', { class: 'cv-focus-notes' },
          notes.length ? notes.map(m => plainNote(m, now)) : h('p', { class: 'cv-calm' }, 'No updates in the last day.')),
        h('dl', { class: 'cv-facts' },
          h('dt', {}, 'Spec'), h('dd', {}, sheet.title),
          h('dt', {}, 'Waits for'), h('dd', {}, names(t.blockers), t.missing ? ` ${plural(t.missing, 'ticket')} couldn't be read` : ''),
          h('dt', {}, 'Unblocks'), h('dd', {}, names(t.blocks)))));
    if (view.place === 'embed') {
      pane.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.stopPropagation(); back(); }
      });
    }
    return pane;
  }

  function focusPane(sheet, t, now) {
    if (OW.v2) return plainFocus(sheet, t, now);
    const back = () => { view.focus = null; view.aim = t.key; rerender(); };
    const notes = t.members.filter(m => m.kind === 'note');
    const pr = t.members.find(m => m.kind === 'pr')?.pr;
    const ticket = t.members.find(m => m.kind === 'ticket');
    const list = keys => (keys.length ? keys.map(k => {
      const other = sheet.tickets.find(x => x.key === k);
      return `#${k.split('#').pop()}${other ? ` ${other.title} (${STATES[other.state]?.word.toLowerCase() || 'unknown'})` : ''}`;
    }).join(', ') : 'nothing');
    return h('section', { class: 'cv-focus', 'aria-label': `Ticket #${t.number}`, '--c': colourOf(t) },
      h('div', { class: 'cv-focus-head' },
        dot(colourOf(t)), h('h3', { tabindex: '-1', 'data-focus': 'focus-title' }, `#${t.number} ${t.title}`), OW.ui.pill(t.state),
        h('span', { class: 'cv-gap' }),
        h('a', { class: 'btn', href: t.url, rel: 'noreferrer', target: '_blank', 'data-focus': 'focus-ticket' }, 'Open the ticket ↗'),
        pr?.url ? h('a', { class: 'btn', href: pr.url, rel: 'noreferrer', target: '_blank', 'data-focus': 'focus-pr' }, `Pull request #${pr.number} ↗`) : null,
        h('button', { class: 'btn', type: 'button', onclick: back, 'aria-keyshortcuts': 'Escape', 'data-focus': 'focus-back' }, 'Back · Esc')),
      h('div', { class: 'cv-focus-body' },
        h('div', { class: 'cv-focus-notes' },
          notes.length ? notes.map(m => memberCard(m, t, now, false)) : h('p', { class: 'cv-calm' }, 'No agent has a note on this ticket in the last day.'),
          h('p', { class: 'cv-calm' }, 'The canvas shows what the agents\' notes say. To answer one, reply on the ticket.')),
        h('dl', { class: 'cv-facts' },
          h('dt', {}, 'Spec'), h('dd', {}, `#${sheet.number} ${sheet.title}`),
          h('dt', {}, 'State'), h('dd', {}, STATES[t.state]?.word || 'Unknown'),
          h('dt', {}, 'Labels'), h('dd', {}, ticket?.labels?.length ? ticket.labels.join(', ') : 'none read'),
          h('dt', {}, 'Waits for'), h('dd', {}, list(t.blockers) + (t.missing ? `, and ${plural(t.missing, 'ticket')} GitHub couldn't read` : '')),
          h('dt', {}, 'Blocks'), h('dd', {}, list(t.blocks)),
          h('dt', {}, 'Pull request'), h('dd', {}, pr ? `${pr.number ? `#${pr.number}: ` : ''}${pr.facts}` : 'none yet'))));
  }

  function overview(m) {
    const sheets = visibleSheets();
    view.over = Math.max(0, Math.min(view.over, sheets.length - 1));
    const at = view.over;
    const close = () => { view.mode = 'board'; rerender(); };
    const pick = i => { view.over = i; rerender(); };
    const openAt = i => { view.mode = 'board'; go(sheets[i].number); };
    const slat = (s, i, offset) => {
      const el = h('button', { type: 'button', class: `cv-slat${s.counts.you ? ' you' : ''}`, 'data-sheet': s.number, 'data-offset': String(offset),
        'data-focus': `slat:${s.number}`, 'aria-label': `#${s.number} ${s.title}: ${sheetLine(s)}`, onclick: () => pick(i) },
      h('span', { class: 'cv-sheet-name' }, `#${s.number} ${s.title}`), blocks(s), h('span', { class: 'cv-sheet-line' }, sheetLine(s)));
      return el;
    };
    const s = sheets[at];
    const above = sheets.slice(Math.max(0, at - 3), at).map((x, j, arr) => slat(x, at - arr.length + j, j - arr.length));
    const below = sheets.slice(at + 1, at + 4).map((x, j) => slat(x, at + 1 + j, j + 1));
    const more = (n, where) => (n > 0 ? h('p', { class: 'cv-more' }, `${plural(n, 'more sheet')} ${where}`) : null);
    const tiles = s ? s.tickets.filter(t => !t.outside && !t.gap).map(t => h('span', { class: 'cv-otile' }, dot(colourOf(t)), h('b', {}, `#${t.number}`), h('span', {}, t.title))) : [];
    const open = s ? h('button', { type: 'button', class: `cv-open${s.counts.you ? ' you' : ''}`, 'data-sheet': s.number, 'data-focus': `open:${s.number}`,
      'aria-label': `Open #${s.number} ${s.title}`, onclick: () => openAt(at) },
    h('span', { class: 'cv-open-head' }, h('span', { class: 'cv-sheet-name' }, `${String(at + 1).padStart(2, '0')} · #${s.number} ${s.title}`), h('span', { class: 'cv-sheet-line' }, sheetLine(s))),
    tiles.length ? h('span', { class: 'cv-otiles' }, tiles) : h('span', { class: 'cv-calm' }, s.read ? 'No tickets yet.' : 'Its tickets couldn\'t be read.')) : null;
    const el = h('section', { class: 'cv-over', 'aria-label': 'Every sheet', tabindex: '-1', 'data-focus': 'over' },
      more(Math.max(0, at - 3), 'above'),
      h('div', { class: 'cv-acc' }, ...above, open, ...below),
      more(Math.max(0, sheets.length - at - 4), 'below'),
      h('p', { class: 'cv-hint' }, '↑ ↓ choose a sheet · Enter opens it · Esc or L goes back'));
    el.addEventListener('keydown', event => {
      if (event.key === 'ArrowUp' && at > 0) { event.preventDefault(); pick(at - 1); }
      if (event.key === 'ArrowDown' && at < sheets.length - 1) { event.preventDefault(); pick(at + 1); }
      if (event.key === 'Enter' && !event.target.closest('button')) { event.preventDefault(); openAt(at); }
      if (event.key === 'Escape') { event.preventDefault(); close(); }
    });
    return el;
  }

  function notices(m, sheet) {
    const out = [];
    if (m.gaps.length) out.push(OW.ui.unknown(`GitHub gave only part of ${m.gaps.join(', ')}, so a sheet or stack may be missing. The app tries again on its own.`));
    if (sheet && !sheet.read) out.push(OW.ui.unknown(`Spec #${sheet.number}'s tickets couldn't be read from GitHub, so its board is unknown.`));
    if (sheet?.unknown) out.push(OW.ui.unknown(`${plural(sheet.unknown, 'ticket')} of #${sheet.number} couldn't be read, so ${sheet.unknown === 1 ? 'it shows' : 'they show'} as unknown.`));
    return out.map(n => css(n, { margin: '0 0 12px' }));
  }

  function draw(el, feeds, arg) {
    const now = Date.now();
    const m = read(feeds, now);
    if (!m) return el.replaceChildren(OW.ui.placeholder('Reading GitHub…'));
    shown = m;
    const asked = arg ? Number(arg) : view.sheet;
    const sheet = m.sheets.find(s => s.number === asked) || (arg ? null : m.sheets.find(s => !s.quiet) || m.sheets[0] || null);
    if (view.sheet !== (sheet?.number ?? null)) { view.focus = null; view.spread = null; }
    view.sheet = sheet?.number ?? null;
    const head = h('div', { class: 'cv-head' }, inbox(m), search(m));
    if (!m.sheets.length) {
      return el.replaceChildren(h('div', { class: 'cv' }, ...notices(m, null), head,
        OW.ui.placeholder(OW.v2 ? 'Nothing is building yet. A spec shows here once it has tickets.'
          : 'No open spec yet. When a spec has a plan graph, its fleet shows here as a sheet.')));
    }
    if (!sheet) {
      return el.replaceChildren(h('div', { class: 'cv' }, ...notices(m, null), head, h('div', { class: 'cv-area' }, rail(m),
        OW.ui.unknown(`Spec #${arg} isn't among the open specs GitHub gave this read.`))));
    }
    const title = h('div', { class: 'cv-title' },
      h('h2', {}, !sheet.url ? sheet.title : h('a', { href: sheet.url, rel: 'noreferrer', target: '_blank', 'data-focus': 'sheet-link' }, `#${sheet.number} ${sheet.title}`)),
      h('span', { class: 'cv-sheet-line' }, sheetLine(sheet)),
      ...sheet.decisions.map(d => h('a', { class: 'pill', '--c': STATES.you.colour, href: d.url, rel: 'noreferrer', target: '_blank' },
        d.kind === 'plan_approval' ? 'Plan to approve' : 'Spec to confirm')));
    let stage;
    let board = null;
    if (view.mode === 'over') stage = overview(m);
    else if (view.focus && sheet.tickets.find(t => t.key === view.focus)) stage = focusPane(sheet, sheet.tickets.find(t => t.key === view.focus), now);
    else if (!sheet.read || !sheet.tickets.length) {
      stage = h('div', { class: 'cv-empty' }, sheet.read ? OW.ui.placeholder(sheet.decisions.length
        ? 'No tickets yet: its spec or plan waits on you. Open it from the strip above.'
        : OW.v2 ? 'No tickets yet. They show here once the plan is written.' : 'No tickets yet: its plan graph isn\'t written.') : null);
    } else {
      board = boardOf(sheet, now);
      stage = board.root;
    }
    el.replaceChildren(h('div', { class: 'cv' }, ...notices(m, sheet), head, h('div', { class: 'cv-area' }, rail(m), h('div', { class: 'cv-stage' }, title, stage))));
    settle(el, board, sheet);
    if (view.mode === 'over') (el.querySelector('.cv-open') || el.querySelector('.cv-over'))?.focus({ preventScroll: true });
    mark();
  }

  function settle(el, board, sheet) {
    if (board) {
      if (!camOf(sheet.number)) fit(board);
      else apply(board);
      if (view.aim && board.g.node(view.aim)) {
        if (view.place !== 'embed') centre(board, view.aim);
        const target = board.world.querySelector(`[data-ticket="${CSS.escape(view.aim)}"]`);
        target?.classList.add('flash');
        target?.focus({ preventScroll: true });
      }
    }
    view.aim = null;
    if (view.focus && !board) el.querySelector('[data-focus="focus-title"]')?.focus({ preventScroll: true });
  }

  function enter(place) {
    if (view.place === place) return;
    Object.assign(view, { place, focus: null, spread: null, aim: null, query: '', mode: 'board' });
    view.cams.clear();
    fitted.clear();
  }
  function embed(el, feeds, number) {
    enter('embed');
    last = [el, feeds, null, number];
    const now = Date.now();
    const m = read(feeds, now);
    const sheet = m?.sheets.find(s => s.number === number);
    if (!sheet) return el.replaceChildren();
    if (view.sheet !== number) Object.assign(view, { sheet: number, focus: null, aim: null });
    const t = view.focus && sheet.tickets.find(x => x.key === view.focus);
    OW.factory.redraw(el, () => {
      const board = t ? null : boardOf(sheet, now);
      el.replaceChildren(t ? focusPane(sheet, t, now) : board.root);
      settle(el, board, sheet);
    });
  }
  function show(number, key) {
    enter('page');
    Object.assign(view, { sheet: number, focus: key, mode: 'board' });
    go(number);
  }

  function render(el, feeds, arg) {
    enter('page');
    last = [el, feeds, arg];
    OW.factory.redraw(el, () => draw(el, feeds, arg));
  }
  function rerender() {
    if (!last || !last[0].isConnected) return;
    if (view.place === 'embed') return embed(last[0], last[1], last[3]);
    const arg = location.hash.match(/^#\/canvas\/([1-9]\d*)$/)?.[1] || null;
    render(last[0], last[1], arg);
  }
  PHONE.addEventListener('change', () => { view.cams.clear(); rerender(); });

  document.addEventListener('keydown', event => {
    if (!/^#\/canvas(\/\d+)?$/.test(location.hash) || !last?.[0].isConnected) return;
    if (event.altKey || event.ctrlKey || event.metaKey || OW.palette?.shown?.() || /input|textarea|select/i.test(event.target.tagName)) return;
    if (event.key === '/') {
      event.preventDefault();
      return last[0].querySelector('.cv-search')?.focus();
    }
    if (event.key === 'l' || event.key === 'L') {
      event.preventDefault();
      if (view.mode === 'over') view.mode = 'board';
      else { view.mode = 'over'; view.focus = null; view.over = Math.max(0, visibleSheets().findIndex(s => s.number === view.sheet)); }
      return rerender();
    }
    if (event.key === 'Escape') {
      if (view.mode === 'over') { view.mode = 'board'; return rerender(); }
      if (view.focus) { view.aim = view.focus; view.focus = null; return rerender(); }
      if (view.spread) { view.spread = null; return rerender(); }
    }
    const board = last[0].querySelector('.cv-board');
    if (!board) return;
    const tools = board.querySelectorAll('.cv-tool');
    if (event.key === '+' || event.key === '=') { event.preventDefault(); tools[1]?.click(); }
    if (event.key === '-' || event.key === '_') { event.preventDefault(); tools[0]?.click(); }
    if (event.key === '0') { event.preventDefault(); tools[2]?.click(); }
  });

  OW.canvas = { model, read, embed, show, blocks, sheetLine, pillOf, plainOf };
  OW.page({
    id: 'canvas',
    title: 'Canvas',
    icon: 'canvas',
    feeds: ['specs', 'agents'],
    render,
  });
})();
