'use strict';
(() => {
  const { h, STATES } = OW.ui;
  const LAPSE = 30 * 60 * 1000;
  const CLOCK_SKEW = 5 * 60 * 1000;
  const recent = (at, now) => at - now <= CLOCK_SKEW && now - at < LAPSE;
  const names = issue => (issue?.labels?.nodes || []).filter(Boolean).map(label => label.name);
  const partialList = list => !list || (list.totalCount ?? 0) > (list.nodes || []).length;

  function recordAuthors(text) {
    if (typeof text !== 'string') return null;
    const section = text.replace(/\r\n/g, '\n').split(/^## /m).find(part => part.startsWith('GitHub identity\n'));
    const row = section?.split('\n').find(line => /^\|\s*Record authors\s*\|/.test(line));
    if (!row) return null;
    const value = row.split('|')[2] || '';
    const logins = [...value.matchAll(/`([^`]*)`/g)].map(m => m[1]);
    if (!logins.length || !logins.every(login => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/.test(login))) return null;
    return new Set(logins.map(login => login.toLowerCase()));
  }
  function byRecordAuthor(comment, authors) {
    if (!authors) return null;
    const login = comment?.author?.login;
    return typeof login === 'string' ? authors.has(login.toLowerCase()) : null;
  }

  function readNote(body) {
    const note = OW.agents.readNote(body);
    if (!note) return null;
    return note.unknown ? { malformed: true } : { agent: note.agent, state: note.state };
  }

  function claimsOf(issue, authors, now = Date.now()) {
    const out = { builder: null, reviewer: null, fleet: null, uncertain: false };
    const comments = issue?.comments;
    const nodes = comments?.nodes || [];
    if (!comments || nodes.some(c => !c)) out.uncertain = true;
    const last = nodes[nodes.length - 1];
    if (partialList(comments) && last && recent(Date.parse(last.updatedAt) || 0, now)) out.uncertain = true;
    const live = [];
    for (const comment of nodes) {
      if (!comment) continue;
      const note = readNote(comment.body);
      if (!note) continue;
      const at = Date.parse(comment.updatedAt) || 0;
      const author = byRecordAuthor(comment, authors);
      if (author === false) continue;
      if (author === null || note.malformed || !Number.isSafeInteger(comment.databaseId)) {
        if (recent(at, now)) out.uncertain = true;
        continue;
      }
      if ((note.state === 'working' || note.state === 'asking') && recent(at, now)) live.push({ ...note, id: comment.databaseId });
    }
    for (const kind of ['builder', 'reviewer', 'fleet']) {
      out[kind] = live.filter(n => n.agent === kind).sort((a, b) => a.id - b.id)[0] || null;
    }
    return out;
  }

  function stateOf(issue, blockers, authors, now = Date.now()) {
    if (!issue) return 'unknown';
    if (issue.state === 'CLOSED') return issue.stateReason === 'COMPLETED' ? 'merged' : 'held';
    const labels = names(issue);
    if (labels.includes('held')) return 'held';
    if (labels.includes('needs-info') || labels.includes('ready-for-human')) return 'you';
    const claims = claimsOf(issue, authors, now);
    if (['builder', 'reviewer', 'fleet'].some(kind => claims[kind]?.state === 'asking')) return 'you';
    const prs = issue.closedByPullRequestsReferences;
    const open = (prs?.nodes || []).filter(pr => pr && pr.state === 'OPEN');
    if (open.length || (prs?.totalCount ?? 0) > 0) {
      return open.some(pr => pr.isDraft || pr.reviewDecision === 'CHANGES_REQUESTED') ? 'building' : 'review';
    }
    if (claims.reviewer?.state === 'working') return 'review';
    if (claims.builder?.state === 'working') return 'building';
    if (claims.uncertain || !prs) return 'unknown';
    if (blockers.gap || blockers.states.some(state => state !== 'merged')) return 'waiting';
    return labels.includes('ready-for-agent') ? 'ready' : 'waiting';
  }
  const outsideState = issue => (issue.state === 'CLOSED' ? (issue.stateReason === 'COMPLETED' ? 'merged' : 'held') : 'waiting');

  const keyOf = (issue, home) => `${issue.repository?.nameWithOwner || home}#${issue.number}`;

  function graph(detail, home, authors, now) {
    if (!detail?.subIssues) return null;
    const nodes = detail.subIssues.nodes || [];
    const tickets = new Map();
    const outside = new Map();
    let unknown = 0;
    for (const issue of nodes) {
      if (!issue) { unknown += 1; continue; }
      tickets.set(keyOf(issue, home), issue);
    }
    unknown += Math.max(0, (detail.subIssues.totalCount ?? nodes.length) - nodes.length);
    const list = [];
    for (const [k, issue] of tickets) {
      const blockers = [];
      const listed = issue.blockedBy?.nodes || [];
      for (const blocker of listed) {
        if (!blocker) continue;
        const b = keyOf(blocker, home);
        blockers.push(b);
        if (!tickets.has(b) && !outside.has(b)) outside.set(b, blocker);
      }
      const gap = issue.blockedBy ? Math.max(0, (issue.blockedBy.totalCount ?? listed.length) - blockers.length) : 1;
      list.push({ key: k, issue, blockers, gap });
    }
    const states = new Map();
    for (const [k, issue] of outside) states.set(k, outsideState(issue));
    const pending = new Map(list.map(t => [t.key, t]));
    const settle = (t, seen = new Set()) => {
      if (states.has(t.key)) return states.get(t.key);
      if (seen.has(t.key)) return 'waiting';
      seen.add(t.key);
      const blockerStates = t.blockers.map(b => (pending.has(b) ? settle(pending.get(b), seen) : states.get(b) || 'unknown'));
      const state = stateOf(t.issue, { states: blockerStates, gap: t.gap }, authors, now);
      states.set(t.key, state);
      return state;
    };
    list.forEach(t => settle(t));
    const shape = (k, issue, extra) => ({ key: k, number: issue.number, title: issue.title, url: issue.url, state: states.get(k), gap: false, ...extra });
    const gaps = list.filter(t => t.gap).map(t => ({
      key: `gap-${t.issue.number}`, number: null, title: `${t.gap} ${t.gap === 1 ? 'ticket' : 'tickets'} GitHub couldn't read or list`,
      url: t.issue.url, state: 'unknown', outside: true, gap: true, blockers: [], missing: 0,
    }));
    return {
      tickets: [
        ...list.map(t => shape(t.key, t.issue, { outside: false, blockers: [...t.blockers, ...(t.gap ? [`gap-${t.issue.number}`] : [])], missing: t.gap })),
        ...[...outside].map(([k, issue]) => shape(k, issue, { outside: true, blockers: [], missing: 0 })),
        ...gaps,
      ],
      unknown,
    };
  }

  const FENCE = /^```json\n([\s\S]*?)\n```$/gm;
  const COMMON = ['schema', 'kind', 'id', 'status', 'fingerprint', 'risk'];
  const KEYS = {
    spec_confirmation: [...COMMON, 'spec', 'summary', 'headline', 'tickets', 'graph'],
    plan_approval: [...COMMON, 'spec', 'summary', 'headline', 'tickets', 'graph'],
    grill_round: [...COMMON, 'grill_file', 'round', 'questions', 'answered'],
    grill_confirmation: [...COMMON, 'grill_file', 'summary'],
  };
  const positive = n => Number.isSafeInteger(n) && n > 0;
  const text = v => typeof v === 'string' && v.length > 0;
  const exactly = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));
  const matches = (v, pattern) => typeof v === 'string' && pattern.test(v);
  function repeatsKeys(json) {
    const stack = [];
    for (const token of json.match(/"(?:[^"\\]|\\.)*"|[{}[\]:,]/g) || []) {
      const top = stack[stack.length - 1];
      if (token === '{') stack.push({ keys: new Set(), expectKey: true });
      else if (token === '[') stack.push(null);
      else if (token === '}' || token === ']') stack.pop();
      else if (token === ',') { if (top) top.expectKey = true; } else if (token !== ':' && top?.expectKey) {
        const name = JSON.parse(token);
        if (top.keys.has(name)) return true;
        top.keys.add(name);
        top.expectKey = false;
      }
    }
    return false;
  }
  function readRecord(body, spec) {
    const raw = String(body ?? '').replace(/\r\n/g, '\n');
    const blocks = [...raw.matchAll(FENCE)].map(m => m[1]);
    const parsed = blocks.map(block => { try { return JSON.parse(block); } catch { return undefined; } });
    const marked = raw.includes('openwiz.decisions.') || parsed.some(p => typeof p?.schema === 'string' && p.schema.startsWith('openwiz.decisions.'));
    if (!marked) return null;
    if (blocks.length !== 1 || parsed[0] === undefined || repeatsKeys(blocks[0])) return { malformed: true };
    const r = parsed[0];
    const keys = typeof r?.kind === 'string' && Object.hasOwn(KEYS, r.kind) ? KEYS[r.kind] : null;
    const ok = keys && exactly(r, keys) && r.schema === 'openwiz.decisions.v1'
      && matches(r.id, /^[A-Za-z0-9][A-Za-z0-9_-]*$/) && ['open', 'resolved', 'superseded'].includes(r.status)
      && matches(r.fingerprint, /^[0-9a-f]{64}$/) && ['ordinary', 'live', 'release', 'publish', 'unknown'].includes(r.risk);
    if (!ok) return { malformed: true };
    if (r.kind !== 'spec_confirmation' && r.kind !== 'plan_approval') return { record: r };
    const summary = Array.isArray(r.summary) && r.summary.length >= 1 && r.summary.length <= 10 && r.summary.every(line => text(line) && !/[\r\n]/.test(line));
    const tickets = Array.isArray(r.tickets) && (r.kind === 'spec_confirmation' ? r.tickets.length === 0
      : r.tickets.every((t, i) => exactly(t, ['number', 'title', 'blockers']) && positive(t.number) && text(t.title)
        && (i === 0 || r.tickets[i - 1].number < t.number) && Array.isArray(t.blockers)
        && t.blockers.every((b, j) => positive(b) && b !== t.number && (j === 0 || t.blockers[j - 1] < b))));
    const graphOk = Array.isArray(r.graph) && (r.kind === 'spec_confirmation' ? r.graph.length === 0
      : r.graph.every(e => exactly(e, ['blocker', 'ticket']) && positive(e.blocker) && positive(e.ticket)));
    if (r.spec !== spec || !summary || !text(r.headline) || !tickets || !graphOk) return { malformed: true };
    return { record: r };
  }
  function decisions(spec, detail, authors) {
    const found = [];
    const nodes = detail?.comments?.nodes;
    for (const comment of Array.isArray(nodes) ? nodes : []) {
      if (!comment) continue;
      const author = byRecordAuthor(comment, authors);
      if (author === false) continue;
      let read;
      try { read = readRecord(comment.body, spec.number); } catch { read = { malformed: true }; }
      if (!read) continue;
      const item = { title: spec.title, number: spec.number, url: comment.url, at: Date.parse(comment.createdAt) || 0 };
      if (author === null || read.malformed) found.push({ ...item, kind: 'unreadable' });
      else if (read.record.status === 'open' && (read.record.kind === 'spec_confirmation' || read.record.kind === 'plan_approval')) {
        found.push({ ...item, kind: read.record.kind });
      }
    }
    return found;
  }

  function model(feed, home, now = Date.now()) {
    const data = feed?.data;
    if (!data?.specIssues || !data?.youIssues) return null;
    const authors = recordAuthors(data.fleet?.text);
    const details = data.specs;
    const gaps = [];
    if (partialList(data.specIssues)) gaps.push('specs');
    if (partialList(data.youIssues)) gaps.push('tickets marked for you');
    const specs = (data.specIssues.nodes || []).filter(Boolean).map(issue => {
      const detail = details?.[`s${issue.number}`] || null;
      if (!detail) gaps.push(`#${issue.number}'s decision records`);
      else if (partialList(detail.comments)) gaps.push(`#${issue.number}'s older comments`);
      return {
        number: issue.number,
        title: issue.title,
        url: issue.url,
        total: issue.subIssuesSummary?.total ?? null,
        done: issue.subIssuesSummary?.completed ?? null,
        graph: graph(detail, home, authors, now),
        detail,
      };
    });
    const later = issue => !names(issue).includes('needs-info') && (issue.issueDependenciesSummary?.blockedBy ?? 0) > 0;
    const ticket = issue => ({ kind: 'ticket', title: issue.title, number: issue.number, url: issue.url, at: Date.parse(issue.updatedAt) || 0 });
    const marked = (data.youIssues.nodes || []).filter(Boolean);
    const you = [
      ...specs.flatMap(spec => decisions(spec, spec.detail, authors)),
      ...marked.filter(issue => !later(issue)).map(ticket),
    ].sort((a, b) => b.at - a.at);
    const yoursLater = marked.filter(later).map(ticket).sort((a, b) => b.at - a.at);
    const running = specs.filter(spec => spec.total > 0);
    const read = running.filter(spec => spec.graph);
    const bound = (n, partial) => (partial ? `${n}+` : n);
    const count = state => (running.length && !read.length ? null
      : bound(read.reduce((n, spec) => n + spec.graph.tickets.filter(t => !t.outside && t.state === state).length, 0),
        read.length < running.length || gaps.includes('specs')));
    const sure = you.filter(item => item.kind !== 'unreadable').length;
    return {
      specs,
      you,
      later: yoursLater,
      gaps,
      partialSpecs: gaps.includes('specs'),
      counts: {
        you: bound(sure, gaps.length > 0),
        sure,
        building: count('building'),
        review: count('review'),
        merged: bound(specs.reduce((n, s) => n + (s.done || 0), 0), gaps.includes('specs')),
      },
    };
  }

  function redraw(el, build) {
    const active = document.activeElement;
    const had = Boolean(active && active !== document.body && el.contains(active));
    const was = had ? active.getAttribute('data-focus') : null;
    build();
    if (!had || el.contains(document.activeElement)) return;
    if (OW.v2 && active.isConnected && !active.closest('[hidden]')) return active.focus();
    const same = was && [...el.querySelectorAll('[data-focus]')].find(e => e.getAttribute('data-focus') === was);
    const target = OW.v2 && same?.disabled ? el.querySelector('.v2-rail-btn:not(:disabled)') : same;
    (target || el.querySelector('.spec-title') || document.querySelector('main h1'))?.focus();
  }

  const home = () => OW.data.repo.get()?.full;
  OW.factory = { model: feeds => model(feeds.specs, home()), stateOf, claimsOf, readNote, readRecord, recordAuthors, redraw };

  function counts(spec) {
    if (!spec.graph) return null;
    const out = {};
    for (const state of Object.keys(STATES)) out[state] = 0;
    for (const t of spec.graph.tickets) if (!t.outside) out[t.state] += 1;
    out.unknown += spec.graph.unknown;
    return out;
  }

  function list(el, feeds) {
    const left = OW.specPage.shown;
    OW.specPage.shown = null;
    const seen = OW.factory.model(feeds);
    if (!seen) return el.replaceChildren(OW.ui.placeholder('Reading GitHub…'));
    const missing = seen.partialSpecs
      ? OW.ui.unknown('GitHub gave only part of the list of specs, so some may be missing. The app tries again on its own, or press Refresh now.') : null;
    if (!seen.specs.length) {
      return el.replaceChildren(missing || OW.ui.placeholder('No open spec yet. A spec shows here once its issue has tickets (sub-issues), a "spec:" title or the spec label.'));
    }
    el.replaceChildren(...[missing, h('div', { class: 'cards' }, seen.specs.map(spec => {
      const href = `#/specs/${spec.number}`;
      const head = [h('div', { class: 'num' }, `#${spec.number}`), h('h3', {}, spec.title)];
      if (!spec.total) {
        return h('a', { class: 'card', href, 'data-focus': `card:${href}`, '--c': STATES.waiting.colour }, ...head,
          h('p', {}, spec.total === 0 ? 'No tickets yet: its plan graph isn\'t written.' : 'Its tickets couldn\'t be counted.'));
      }
      const states = counts(spec);
      return h('a', { class: 'card', href, 'data-focus': `card:${href}`, '--c': spec.done === spec.total ? STATES.merged.colour : STATES.building.colour },
        ...head,
        h('p', {}, `${spec.done} of ${spec.total} tickets done`),
        h('p', {}, OW.ui.bar(states)),
        states ? null : h('p', {}, OW.ui.unknown('This spec\'s tickets couldn\'t be read.')));
    }))].filter(Boolean));
    if (left) el.querySelector(`a.card[href="#/specs/${left}"]`)?.focus();
  }

  OW.page({
    id: 'specs',
    title: 'Specs',
    icon: 'specs',
    feeds: ['specs'],
    badge: () => null,
    render(el, feeds, arg) {
      if (arg) return OW.specPage.render(el, feeds, arg);
      redraw(el, () => list(el, feeds));
    },
  });
})();
