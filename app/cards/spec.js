'use strict';
(() => {
  const OW = (window.OW = window.OW || {});
  const { h, STATES } = OW.ui;
  const SVG = 'http://www.w3.org/2000/svg';
  const NODE = { width: 64, height: 34 };
  let drawn = 0;

  const REASONS = {
    dry_run: 'Dry run: nothing was posted.',
    disabled: 'Not posted: writing from the app is off in this browser.',
    not_composed: 'Not posted: this preview changed after it was made. Start again.',
    not_confirmed: 'Not posted: it wasn\'t confirmed.',
    signed_out: 'Not posted: you\'re signed out.',
    pending: 'Not posted: another steer on this spec still has an unknown outcome. Check that one first.',
    github: 'Not posted: GitHub refused it.',
    source_changed: 'Not posted: the spec changed.',
    source_unchecked: 'Not posted: the spec couldn\'t be checked.',
  };
  const COMPOSE = {
    empty: 'Type what to change first.',
    too_long: 'That is longer than GitHub allows in one comment.',
    refused_form: 'The app can\'t write that: it reads as an agent record.',
    other_repository: 'The app can\'t write that: this spec is in another repository.',
  };

  const sameSite = url => {
    try { return new URL(url).origin === location.origin; } catch { return false; }
  };

  function plan(item) {
    const graph = item.graph;
    if (!graph) return h('p', { class: 'spec-card-note' }, 'Its plan picture couldn\'t be read from GitHub.');
    const tickets = graph.tickets.filter(t => !t.gap);
    if (!tickets.length) return h('p', { class: 'spec-card-note' }, 'No plan picture yet: its plan graph isn\'t written.');
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 12, ranksep: 28, marginx: 4, marginy: 4 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const t of tickets) g.setNode(t.key, { ...NODE });
    for (const t of tickets) for (const b of t.blockers) if (g.hasNode(b)) g.setEdge(b, t.key);
    dagre.layout(g);
    const { width, height } = g.graph();
    const el = (tag, attrs) => {
      const node = document.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
      return node;
    };
    const arrow = `spec-card-arrow-${(drawn += 1)}`;
    const picture = el('svg', { class: 'spec-card-plan', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'data-plan': '',
      'aria-label': `Plan of #${item.subject.number}: ${tickets.filter(t => !t.outside).map(t => `#${t.number} ${STATES[t.state].word.toLowerCase()}`).join(', ')}` });
    const marker = el('marker', { id: arrow, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
    marker.append(el('path', { class: 'spec-card-head', d: 'M0 0 10 5 0 10Z' }));
    picture.append(marker);
    for (const e of g.edges()) {
      picture.append(el('path', { class: 'spec-card-arrow', 'marker-end': `url(#${arrow})`, d: g.edge(e).points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') }));
    }
    for (const t of tickets) {
      const at = g.node(t.key);
      const box = el('g', { 'data-ticket': t.number, class: t.outside ? 'outside' : '' });
      box.style.setProperty('--c', STATES[t.state].colour);
      box.append(el('rect', { x: at.x - NODE.width / 2, y: at.y - NODE.height / 2, width: NODE.width, height: NODE.height, rx: 7 }));
      const label = el('text', { x: at.x, y: at.y, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      label.textContent = `#${t.number}`;
      box.append(label);
      picture.append(box);
    }
    return h('a', { class: 'spec-card-picture', href: `#/specs/${item.subject.number}`, 'aria-label': `The plan of #${item.subject.number}` }, picture);
  }

  function video(item, fallback) {
    const player = h('video', { src: item.video.url, poster: '/app/mark.svg', preload: 'none', muted: true, playsinline: true,
      'aria-label': `The narrated spec video of #${item.subject.number}` });
    player.muted = true;
    const sound = h('button', { type: 'button', class: 'spec-card-sound' }, 'Play with sound');
    const listen = event => {
      if (!event.isTrusted || player.controls) return;
      player.controls = true;
      player.muted = false;
      player.play().then(() => player.focus(), () => {});
    };
    sound.addEventListener('click', listen);
    player.addEventListener('click', listen);
    player.addEventListener('error', () => frame.replaceWith(fallback()));
    const frame = h('div', { class: 'spec-card-frame' }, player, h('div', { class: 'spec-card-actions' }, sound,
      h('a', { href: item.video.url, rel: 'noreferrer' }, 'The video')));
    return frame;
  }

  function where(preview) {
    const who = preview.visibility === 'public' ? 'publicly' : `to everyone who can read ${preview.repository}`;
    return `A comment from you, shown ${who}, on ${preview.repository}#${preview.subject.number}:`;
  }

  function spec(item, el) {
    const status = h('div', { class: 'spec-card-status', role: 'status', 'aria-live': 'polite' });
    const steer = h('div', { class: 'spec-card-steer' });
    let busy = false;
    const setBusy = value => {
      busy = value;
      for (const control of steer.querySelectorAll('button, textarea')) control.disabled = value;
    };
    const waitingHere = () => OW.records.pending().find(p => p.repository === item.repository
      && p.subject.kind === item.subject.kind && p.subject.number === item.subject.number);

    const SENDING = ['Twirling the wands', 'Polishing the hats', 'Dusting off the stars', 'Tidying the beards'];
    const wait = text => {
      const box = OW.ui.dance(text, SENDING);
      if (!box) return h('p', { 'data-outcome': 'sending' }, text);
      box.removeAttribute('role');
      box.dataset.outcome = 'sending';
      return box;
    };
    const say = (outcome, text, ...more) => status.replaceChildren(h('p', { 'data-outcome': outcome }, text, ...more));
    const buttons = () => {
      status.replaceChildren();
      steer.replaceChildren(h('div', { class: 'spec-card-buttons' },
        h('button', { type: 'button', class: 'primary', onclick: () => compose({ form: 'spec.ship', item }) }, 'Ship it'),
        h('button', { type: 'button', onclick: change }, 'Change something'),
        h('button', { type: 'button', onclick: () => compose({ form: 'spec.not_now', item }) }, 'Not now')));
    };
    let box = null;
    let draftOp = null;
    function clearDraft() {
      box = null;
      draftOp = null;
    }

    function change() {
      status.replaceChildren();
      box = box || h('textarea', { rows: 4, 'aria-label': 'What to change', placeholder: 'What should change?',
        oninput: () => { draftOp = null; } });
      steer.replaceChildren(h('label', { class: 'spec-card-typed' }, 'What to change', box), h('div', { class: 'spec-card-buttons' },
        h('button', { type: 'button', class: 'primary', onclick: () => compose({ form: 'spec.change', item, words: box.value }, true) }, 'Preview'),
        h('button', { type: 'button', onclick: () => { clearDraft(); buttons(); } }, 'Cancel')));
      box.focus();
    }

    async function compose(action, typed) {
      if (busy) return;
      setBusy(true);
      status.replaceChildren(wait('Writing the preview…'));
      let preview;
      try {
        preview = await OW.records.compose(action);
      } catch {
        preview = { refused: 'source_unchecked' };
      } finally {
        setBusy(false);
      }
      if (preview.refused) {
        if (!typed) buttons();
        say('refused', COMPOSE[preview.refused] || `The app can't write that (${preview.refused}).`);
        return;
      }
      if (typed) draftOp = preview.op;
      confirm(preview, typed);
    }

    function confirm(preview, typed) {
      status.replaceChildren();
      const post = h('button', { type: 'button', class: 'primary' }, 'Post it');
      post.addEventListener('click', event => {
        if (busy) return;
        const { confirmed, of } = OW.records.confirm(preview, event);
        if (confirmed < of) {
          if (confirmed > 0) post.textContent = 'Yes, post it';
          return;
        }
        post.textContent = 'Sending…';
        send(preview);
      });
      steer.replaceChildren(h('div', { class: 'spec-card-preview', 'data-preview': '' },
        h('p', {}, where(preview)),
        h('pre', { 'data-body': '' }, preview.body),
        h('div', { class: 'spec-card-buttons' }, post,
          h('button', { type: 'button', onclick: () => (typed ? change() : buttons()) }, 'Cancel'))));
    }

    async function send(preview) {
      setBusy(true);
      status.replaceChildren(wait('Sending…'));
      let outcome;
      try {
        outcome = await OW.records.post(preview);
      } catch {
        outcome = { outcome: 'unknown', op: preview.op, reason: 'network' };
      } finally {
        setBusy(false);
      }
      if (outcome.outcome === 'posted') {
        if (preview.op === draftOp) clearDraft();
        buttons();
        say('posted', 'Posted. ', h('a', { href: outcome.comment.url, rel: 'noreferrer' }, 'See the comment'));
      } else if (outcome.outcome === 'refused') {
        const waiting = outcome.reason === 'pending' && waitingHere();
        if (waiting) return unknown(waiting, REASONS.pending);
        buttons();
        say('refused', REASONS[outcome.reason] || `Not posted (${outcome.reason}).`);
      } else {
        unknown(preview);
      }
    }

    function unknown(preview, why) {
      steer.replaceChildren(h('div', { class: 'spec-card-preview' }, h('pre', { 'data-body': '' }, preview.body)));
      say('unknown', why ? `${why} ` : '', 'Unknown: this may or may not have posted, so it isn\'t shown as sent. ',
        h('button', { type: 'button', onclick: () => confirm(preview, false) }, 'Check again'));
    }

    const fallback = () => plan(item);
    const watch = item.video && sameSite(item.video.url) ? video(item, fallback)
      : h('div', { class: 'spec-card-watch' }, plan(item),
        item.video ? h('p', { class: 'spec-card-note' }, h('a', { href: item.video.url, rel: 'noreferrer' }, 'The narrated spec video'), ' (on another site)') : null);
    el.replaceChildren(h('article', { class: 'spec-card', 'data-key': item.key },
      h('p', { class: 'spec-card-kind' }, 'A spec to watch and steer'),
      h('h3', {}, h('a', { href: item.url, rel: 'noreferrer' }, `#${item.subject.number} ${item.title}`)),
      watch, steer, status));
    buttons();
    const waiting = waitingHere();
    if (waiting) unknown(waiting);
  }

  OW.cards = OW.cards || {};
  OW.cards.spec = spec;
})();
