// A running spec's own page (#/specs/<number>): its ticket graph, with the blocking arrows and one colour per state,
// then the same tickets as a plain list. The layout is dagre's (layered, with fewer crossings and routed arrows):
// left to right on a laptop, top to bottom on a phone. Ticket cards use Ember's card, pill and colours.
//
// The pulse (AP7, #1260): OW.specPage.pulse(card, ticket) is called for every ticket card, and marks the tickets an
// agent is working on now (OW.agents.working()). The mark is still, a dot and its words: Ember has no motion.
'use strict';
(() => {
  const { h, STATES } = OW.ui;
  const SVG = 'http://www.w3.org/2000/svg';
  const NODE = { width: 248, height: 104 };

  // Styles are set through the CSSOM (the page's CSP allows no style attributes), and only with Ember's tokens.
  const css = (el, props) => { for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v); return el; };
  const svg = (tag, attrs = {}) => {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  };

  function layout(tickets, phone) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: phone ? 'TB' : 'LR', nodesep: phone ? 20 : 28, ranksep: phone ? 48 : 72, marginx: 4, marginy: 4 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const t of tickets) g.setNode(t.key, { ...NODE });
    for (const t of tickets) for (const b of t.blockers) if (g.hasNode(b)) g.setEdge(b, t.key);
    dagre.layout(g);
    return g;
  }

  function card(ticket) {
    const s = STATES[ticket.state];
    const id = ticket.gap ? ticket.key : ticket.number;
    const el = h('a', { class: 'card', href: ticket.url, rel: 'noreferrer', '--c': s.colour, 'data-ticket': id, 'data-state': ticket.state, 'data-focus': `ticket:${ticket.key}` },
      h('div', { class: 'num' }, ticket.gap ? 'Blocked by' : `#${ticket.number}${ticket.outside ? ' · outside this spec' : ''}`),
      css(h('h3', {}, ticket.title), { 'font-size': '16px', 'line-height': '1.35', overflow: 'hidden', 'max-height': '2.7em' }),
      css(h('p', {}, OW.ui.pill(ticket.state)), { margin: '8px 0 0' }));
    if (ticket.outside) css(el, { opacity: '.8' });
    OW.specPage.pulse(el, ticket);
    return el;
  }

  function drawGraph(spec, phone) {
    const tickets = spec.graph.tickets;
    const g = layout(tickets, phone);
    const { width, height } = g.graph();
    const lines = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' });
    css(lines, { position: 'absolute', left: '0', top: '0', overflow: 'visible' });
    const marker = svg('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    marker.append(css(svg('path', { d: 'M0 0 10 5 0 10Z' }), { fill: 'var(--em-muted)' }));
    const defs = svg('defs');
    defs.append(marker);
    lines.append(defs);
    for (const e of g.edges()) {
      const points = g.edge(e).points;
      const d = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      lines.append(css(svg('path', { d, 'marker-end': 'url(#arrow)', 'data-from': e.v, 'data-to': e.w, class: 'arrow' }),
        { fill: 'none', stroke: 'var(--em-muted)', 'stroke-width': '1.6' }));
    }
    const board = css(h('div', { class: 'graph', role: 'group', 'aria-label': `Ticket graph of #${spec.number}` }, lines),
      { position: 'relative', width: `${width}px`, height: `${height}px`, margin: '0 auto' });
    // Keyboard order follows the picture: rank by rank (left to right on a laptop, top to bottom on a phone).
    const along = t => (phone ? [g.node(t.key).y, g.node(t.key).x] : [g.node(t.key).x, g.node(t.key).y]);
    const ordered = [...tickets].sort((a, b) => along(a)[0] - along(b)[0] || along(a)[1] - along(b)[1]);
    for (const t of ordered) {
      const at = g.node(t.key);
      board.append(css(card(t), { position: 'absolute', left: `${at.x - NODE.width / 2}px`, top: `${at.y - NODE.height / 2}px`,
        width: `${NODE.width}px`, height: `${NODE.height}px`, padding: '12px 14px 12px 20px' }));
    }
    return css(h('div', { class: 'graph-scroll' }, board), { overflow: 'auto', margin: '0 0 28px', padding: '4px 2px 12px' });
  }

  // The legend: every state shown on this spec, with its count and word.
  function legend(spec) {
    const counts = {};
    for (const t of spec.graph.tickets) if (!t.outside) counts[t.state] = (counts[t.state] || 0) + 1;
    if (spec.graph.unknown) counts.unknown = (counts.unknown || 0) + spec.graph.unknown;
    return css(h('p', { class: 'legend' }, Object.keys(STATES).filter(s => counts[s]).map(s =>
      h('span', { class: 'pill', '--c': STATES[s].colour }, `${counts[s]} ${STATES[s].word.toLowerCase()}`))),
    { display: 'flex', 'flex-wrap': 'wrap', gap: '8px', margin: '0 0 20px' });
  }

  function ticketList(spec) {
    const byKey = new Map(spec.graph.tickets.map(t => [t.key, t]));
    const waits = t => {
      const known = t.blockers.filter(b => !byKey.get(b)?.gap).map(b => `#${byKey.get(b)?.number ?? '?'}`);
      const gap = t.missing ? [`${t.missing} ${t.missing === 1 ? 'ticket' : 'tickets'} GitHub couldn't read or list`] : [];
      const all = [...known, ...gap];
      return all.length ? `Waits for ${all.length > 1 ? `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}` : all[0]}` : null;
    };
    const rows = spec.graph.tickets.filter(t => !t.outside).map(t => css(h('li', {},
      h('a', { href: t.url, rel: 'noreferrer', 'data-focus': `list:${t.key}` }, `#${t.number} ${t.title}`), ' ', OW.ui.pill(t.state),
      waits(t) ? css(h('div', {}, waits(t)), { color: 'var(--em-muted)', 'font-size': '15px' }) : null),
    { padding: '10px 0', 'border-top': '1px solid var(--em-line)' }));
    for (let i = 0; i < spec.graph.unknown; i += 1) {
      rows.push(css(h('li', {}, 'A ticket GitHub couldn\'t read ', OW.ui.pill('unknown')), { padding: '10px 0', 'border-top': '1px solid var(--em-line)' }));
    }
    return css(h('ul', { class: 'tickets' }, rows), { 'list-style': 'none', margin: '0', padding: '0' });
  }

  // The graph turns (left to right, or top to bottom) when the screen crosses the phone width: redraw it then.
  const PHONE = matchMedia('(max-width: 760px)');
  let last = null;
  PHONE.addEventListener('change', () => { if (last && last[0].isConnected && location.hash === `#/specs/${last[2]}`) render(...last); });

  // A redraw (a feed refresh, or the screen turning) keeps keyboard focus on the same control.
  function render(el, feeds, arg) {
    last = [el, feeds, arg];
    OW.factory.redraw(el, () => draw(el, feeds, arg));
  }

  function draw(el, feeds, arg) {
    const back = h('p', {}, h('a', { href: '#/specs', 'aria-keyshortcuts': 'Escape', 'data-focus': 'back' }, '← All specs',
      css(h('span', { 'aria-hidden': 'true' }, ' · Esc'), { color: 'var(--em-muted)', 'font-size': '14px' })));
    const seen = OW.factory.model(feeds);
    if (!seen) return el.replaceChildren(back, OW.ui.placeholder('Reading GitHub…'));
    const spec = seen.specs.find(s => String(s.number) === arg);
    if (!spec) {
      el.replaceChildren(back, OW.ui.unknown(`Spec #${arg} isn't among the open specs (labelled spec) that GitHub gave this read.`));
      if (OW.specPage.shown !== arg) back.querySelector('a').focus();
      OW.specPage.shown = arg;
      return;
    }
    const head = [back, css(h('h2', { tabindex: '-1', class: 'spec-title', 'data-focus': 'spec-title' }, h('a', { href: spec.url, rel: 'noreferrer', 'data-focus': 'spec-link' }, `#${spec.number} ${spec.title}`)), { margin: '0 0 6px', 'font-size': '24px', 'line-height': '1.35' }),
      css(h('p', {}, spec.total === 0 ? 'No tickets yet: its plan graph isn\'t written.' : spec.total ? `${spec.done} of ${spec.total} tickets done` : 'Its tickets couldn\'t be counted.'),
        { margin: '0 0 16px', color: 'var(--em-text-2)' })];
    if (spec.total === 0 && spec.graph && !spec.graph.tickets.length && !spec.graph.unknown) {
      el.replaceChildren(...head);
      return arrived(el, arg);
    }
    if (!spec.graph) {
      el.replaceChildren(...head, OW.ui.unknown('This spec\'s tickets couldn\'t be read from GitHub.'));
      return arrived(el, arg);
    }
    const unknown = spec.graph.unknown ? css(OW.ui.unknown(`${spec.graph.unknown} of this spec's tickets couldn't be read, so they show as unknown.`), { margin: '0 0 20px' }) : null;
    const phone = PHONE.matches;
    el.replaceChildren(...head, legend(spec), unknown, drawGraph(spec, phone),
      css(h('h2', {}, 'Tickets'), { 'font-size': '20px', margin: '0 0 8px' }), ticketList(spec));
    arrived(el, arg);
  }

  // Keyboard: arriving on a spec's page moves focus to its title (a refresh of the same page doesn't); Esc goes back
  // to all specs, where focus returns to the card of the spec just left.
  function arrived(el, arg) {
    if (OW.specPage.shown === arg) return;
    OW.specPage.shown = arg;
    el.querySelector('.spec-title')?.focus();
  }
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!/^#\/specs\/\d+$/.test(location.hash) || /input|textarea|select/i.test(event.target.tagName)) return;
    location.hash = '#/specs';
  });

  function pulse(el, ticket) {
    if (ticket.gap || !OW.agents?.working().has(ticket.key)) return;
    const dot = css(h('span', { 'aria-hidden': 'true' }), { width: '8px', height: '8px', 'border-radius': '50%', background: 'var(--em-building)',
      'box-shadow': '0 0 0 3px color-mix(in srgb, var(--em-building) 30%, transparent)' });
    el.setAttribute('data-pulse', '');
    el.lastElementChild.append(css(h('span', { class: 'pulse' }, dot, 'Agent working'),
      { display: 'inline-flex', 'align-items': 'center', gap: '8px', 'margin-left': '10px', 'font-size': '14px', color: 'var(--em-text-2)' }));
  }

  OW.specPage = { render, pulse, shown: null };
})();
