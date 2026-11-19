// The Specs page, and the model of the factory that You, Specs and each spec's page read.
//
// The Specs feed (OW.data.feeds.specs) holds two GitHub reads: `issues`, the repository's open issues with their
// labels, sub-issue counts and recent comments, and `specs`, each running spec's tickets with their state, labels
// and blocked-by links, pull requests and recent comments (null where GitHub couldn't give a spec). A ticket GitHub couldn't read is unknown, never
// dropped and never guessed.
'use strict';
(() => {
  const { h, STATES } = OW.ui;

  // A ticket's state, worked out from GitHub and the agents' status notes, never from a state label (records
  // spec B). People set only spec, ready-for-agent, ready-for-human, needs-info and held.
  //   merged     closed as completed (a ticket closes only on a verified merge)
  //   held       closed otherwise, or labelled held
  //   you        labelled needs-info or ready-for-human, or the ticket's claim says its agent is asking
  //   review     an open, non-draft pull request that closes it, or the claim is a reviewer's that is working
  //   building   an open draft pull request, changes requested on its pull request, or the claim is working
  //   waiting    something it is blocked by isn't merged yet (or can't be read)
  //   ready      labelled ready-for-agent with nothing left to wait for; otherwise waiting
  const names = issue => (issue?.labels?.nodes || []).filter(Boolean).map(label => label.name);
  function stateOf(issue, blockers, now = Date.now()) {
    if (!issue) return 'unknown';
    if (issue.state === 'CLOSED') return issue.stateReason === 'COMPLETED' ? 'merged' : 'held';
    const labels = names(issue);
    if (labels.includes('held')) return 'held';
    const held = claim(issue, now);
    if (labels.includes('needs-info') || labels.includes('ready-for-human') || held?.state === 'asking') return 'you';
    const prs = (issue.closedByPullRequestsReferences?.nodes || []).filter(pr => pr && pr.state === 'OPEN');
    const working = held?.state === 'working';
    if (prs.some(pr => pr.isDraft || pr.reviewDecision === 'CHANGES_REQUESTED')) return 'building';
    if (prs.length || (working && held.kind === 'reviewer')) return 'review';
    if (working) return 'building';
    if (blockers.some(state => state !== 'merged')) return 'waiting';
    return labels.includes('ready-for-agent') ? 'ready' : 'waiting';
  }
  // Blockers outside the spec are read without their own blockers.
  const outsideState = issue => stateOf(issue, []);

  // The status notes on a ticket (openwiz:status v1, WizSkills' agent-status contract): a comment whose first
  // line is the marker, posted by the repository's own people, with "state" and "kind" field lines. A note is
  // live while it was edited in the last 30 minutes; of several live notes the oldest wins (the ticket's claim).
  // A note of another version is unknown and never read for a state.
  const LAPSE = 30 * 60 * 1000;
  const TRUSTED = ['OWNER', 'MEMBER', 'COLLABORATOR'];
  const MARKER = /^(?:<!--\s*)?openwiz:status v(\d+)(?:\s*-->)?\s*$/;
  function note(comment) {
    if (!comment || !TRUSTED.includes(comment.authorAssociation)) return null;
    const lines = String(comment.body || '').replace(/\r\n/g, '\n').split('\n');
    const marker = lines[0].trim().match(MARKER);
    if (!marker) return null;
    const at = Date.parse(comment.updatedAt) || 0;
    const created = Date.parse(comment.createdAt) || at;
    if (marker[1] !== '1') return { version: Number(marker[1]), state: 'unknown', kind: 'unknown', at, created };
    const field = name => {
      for (const line of lines.slice(1)) {
        // "- **State:** working", "state: working" or "State: `working`": markdown marks don't change a field.
        const m = line.replace(/[*`]/g, '').match(/^[\s-]*([A-Za-z][A-Za-z ]*?)\s*:\s*(\S.*?)\s*$/);
        if (m && m[1].toLowerCase() === name) return m[2].toLowerCase();
      }
      return null;
    };
    const state = field('state');
    return { version: 1, state: ['working', 'asking', 'done', 'stopped'].includes(state) ? state : 'unknown', kind: field('kind') || 'unknown', at, created };
  }
  // Live: edited within the last 30 minutes (a few minutes ahead of this clock still counts, for clock skew).
  const SKEW = 5 * 60 * 1000;
  const notes = (issue, now = Date.now()) => (issue?.comments?.nodes || []).map(note)
    .filter(n => n && n.version === 1 && n.at - now <= SKEW && now - n.at <= LAPSE);
  const claim = (issue, now) => notes(issue, now).sort((a, b) => a.created - b.created)[0] || null;

  const key = (issue, home) => `${issue.repository?.nameWithOwner || home}#${issue.number}`;

  // One spec's graph: {tickets: [{key, number, title, url, state, outside, blockers: [key]}], unknown: n, complete}.
  function graph(detail, home) {
    if (!detail?.subIssues) return null;
    const nodes = detail.subIssues.nodes || [];
    const tickets = new Map();
    const outside = new Map();
    let unknown = 0;
    for (const issue of nodes) {
      if (!issue) { unknown += 1; continue; }
      tickets.set(key(issue, home), issue);
    }
    // Sub-issues GitHub counted but didn't list (past the first page) are unknown too.
    unknown += Math.max(0, (detail.subIssues.totalCount ?? nodes.length) - nodes.length);
    const states = new Map();
    const list = [];
    for (const [k, issue] of tickets) {
      const blockers = [];
      for (const blocker of issue.blockedBy?.nodes || []) {
        if (!blocker) continue;
        const b = key(blocker, home);
        blockers.push(b);
        if (!tickets.has(b) && !outside.has(b)) outside.set(b, blocker);
      }
      list.push({ key: k, issue, blockers });
    }
    for (const [k, issue] of outside) states.set(k, outsideState(issue));
    // Inside the spec, a ticket waits on its blockers' states: settle them in blocking order.
    const pending = new Map(list.map(t => [t.key, t]));
    const settle = (t, seen = new Set()) => {
      if (states.has(t.key)) return states.get(t.key);
      if (seen.has(t.key)) return 'waiting'; // a blocking cycle never resolves
      seen.add(t.key);
      const blockerStates = t.blockers.map(b => (pending.has(b) ? settle(pending.get(b), seen) : states.get(b) || 'unknown'));
      const state = stateOf(t.issue, blockerStates);
      states.set(t.key, state);
      return state;
    };
    list.forEach(t => settle(t));
    const shape = (k, issue, extra) => ({ key: k, number: issue.number, title: issue.title, url: issue.url, state: states.get(k), ...extra });
    return {
      tickets: [
        ...list.map(t => shape(t.key, t.issue, { outside: false, blockers: t.blockers })),
        ...[...outside].map(([k, issue]) => shape(k, issue, { outside: true, blockers: [] })),
      ],
      unknown,
    };
  }

  // The open openwiz.decisions.v1 requests on an issue's comments that wait for the user: a spec to confirm or a
  // plan to approve. Only the repository's own people post them (owner, member or collaborator). A comment that
  // names the schema but can't be read is reported as unreadable, never skipped.
  const FENCE = /^```json\n([\s\S]*?)\n```$/gm;
  const WAITS = { spec_confirmation: 'Spec to confirm', plan_approval: 'Plan to approve' };
  function decisions(issue) {
    const found = [];
    for (const comment of issue.comments?.nodes || []) {
      if (!comment || !TRUSTED.includes(comment.authorAssociation)) continue;
      const body = String(comment.body || '').replace(/\r\n/g, '\n');
      if (!body.includes('openwiz.decisions.')) continue;
      const blocks = [...body.matchAll(FENCE)].map(m => m[1]).filter(text => text.includes('openwiz.decisions.'));
      let record = null;
      try { record = blocks.length === 1 ? JSON.parse(blocks[0]) : null; } catch { record = null; }
      const at = Date.parse(comment.createdAt) || 0;
      if (!record || record.schema !== 'openwiz.decisions.v1' || typeof record.status !== 'string') {
        found.push({ kind: 'unreadable', title: issue.title, number: issue.number, url: comment.url, at });
        continue;
      }
      if (record.status !== 'open' || !WAITS[record.kind]) continue;
      found.push({ kind: record.kind, title: issue.title, number: issue.number, url: comment.url, at });
    }
    return found;
  }

  // The whole picture for the pages; null when the Specs feed has nothing yet.
  function model(feed, home) {
    const data = feed?.data;
    if (!data?.issues) return null;
    const open = (data.issues.nodes || []).filter(Boolean);
    const specs = open.filter(issue => issue.subIssuesSummary?.total > 0).map(issue => ({
      number: issue.number,
      title: issue.title,
      url: issue.url,
      total: issue.subIssuesSummary.total,
      done: issue.subIssuesSummary.completed,
      graph: graph(data.specs?.[`s${issue.number}`], home),
    }));
    const you = [
      ...open.flatMap(decisions),
      ...open.filter(issue => names(issue).some(n => n === 'needs-info' || n === 'ready-for-human')).map(issue => ({
        kind: 'ticket', title: issue.title, number: issue.number, url: issue.url, at: Date.parse(issue.updatedAt) || 0,
      })),
    ].sort((a, b) => b.at - a.at);
    // Building and In review count the running specs' tickets; unknown while no spec's tickets could be read.
    const read = specs.filter(spec => spec.graph);
    const count = state => (specs.length && !read.length ? null
      : read.reduce((n, spec) => n + spec.graph.tickets.filter(t => !t.outside && t.state === state).length, 0));
    return {
      specs,
      you,
      counts: { you: you.length, building: count('building'), review: count('review'), merged: specs.reduce((n, s) => n + s.done, 0) },
    };
  }

  const home = () => OW.data.repo.get()?.full;
  OW.factory = { model: feeds => model(feeds.specs, home()), stateOf, notes, claim, graph, decisions };

  // ---- The Specs page: every running spec with how many of its tickets are done ----

  function counts(spec) {
    if (!spec.graph) return null;
    const out = {};
    for (const state of Object.keys(STATES)) out[state] = 0;
    for (const t of spec.graph.tickets) if (!t.outside) out[t.state] += 1;
    out.unknown += spec.graph.unknown;
    return out;
  }

  function list(el, feeds) {
    // Back from a spec's page (Esc or All specs): focus returns to that spec's card.
    const left = OW.specPage.shown;
    OW.specPage.shown = null;
    const seen = OW.factory.model(feeds);
    if (!seen) return el.replaceChildren(OW.ui.placeholder('Reading GitHub…'));
    if (!seen.specs.length) {
      return el.replaceChildren(OW.ui.placeholder('No open spec has tickets yet. A spec shows here once its plan graph has tickets.'));
    }
    el.replaceChildren(h('div', { class: 'cards' }, seen.specs.map(spec => {
      const states = counts(spec);
      return h('a', { class: 'card', href: `#/specs/${spec.number}`, '--c': spec.done === spec.total ? STATES.merged.colour : STATES.building.colour },
        h('div', { class: 'num' }, `#${spec.number}`),
        h('h3', {}, spec.title),
        h('p', {}, `${spec.done} of ${spec.total} tickets done`),
        h('p', {}, OW.ui.bar(states)),
        states ? null : h('p', {}, OW.ui.unknown('This spec\'s tickets couldn\'t be read.')));
    })));
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
      list(el, feeds);
    },
  });
})();
