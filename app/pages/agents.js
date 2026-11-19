// The Agents page (AP7, #1260): the agents working now and those that finished in the last day, read from their
// status notes (WizSkills' agent-status contract, `openwiz:status v1`) and GitHub: kind, model, last step, ticket,
// time, and what GitHub shows of the ticket's pull request (its state, review and checks).
//
// A note counts only from the repository's record authors (fleet.md's `Record authors` row). A note of another
// version, or one that doesn't read exactly as v1 says, is shown as unknown: its fields are never guessed. A
// `working` or `asking` note not edited for 30 minutes has lapsed. Per ticket and kind, the oldest live note holds
// the claim. OW.agents.working() gives the tickets an agent is working on now, for the spec page's pulse.
'use strict';
(() => {
  const { h, STATES, time } = OW.ui;
  const LAPSE = 30 * 60 * 1000;
  const DAY = 24 * 60 * 60 * 1000;
  const SKEW = 5 * 60 * 1000; // an edit up to 5 minutes ahead of this clock still counts as recent
  const MARKER = '<!-- openwiz:status v1 -->';
  const KINDS = ['builder', 'reviewer', 'fleet'];

  // ---- The status note, exactly as v1 says (contracts/agent-status.v1.md and its schema) ----

  const TEXT = /^[^\u0000-\u001f\u007f"\u201c\u201d>][^\u0000-\u001f\u007f"\u201c\u201d]*$/;
  const SKILL = '[a-z0-9]+(?:-[a-z0-9]+)*@[0-9]+\\.[0-9]+\\.[0-9]+';
  const RULES = {
    agent: v => KINDS.includes(v),
    state: v => /^(working|asking|done|stopped|stopped \([^()\u0000-\u001f\u007f"\u201c\u201d]{1,100}\))$/.test(v),
    harness: v => v.length <= 60,
    model: v => v.length <= 60,
    skills: v => new RegExp(`^${SKILL}(?:, ${SKILL})*$`).test(v),
    step: () => true,
    time: v => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v) && !Number.isNaN(Date.parse(v)),
    pr: v => /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(v),
    preview: v => /^https:\/\/(?![^/:]*\.(?:local|internal|lan|localhost)(?:[:/]|$))(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(?::[0-9]{1,5})?(?:\/[^\s"<>?#@\\]*)?$/.test(v),
  };
  const FIELDS = Object.keys(RULES);
  const REQUIRED = 7; // agent to time; pr and preview are optional

  // The note's fields; {unknown: why} for another version or a note that doesn't read as v1; null for a comment
  // that isn't a status note at all.
  function readNote(body) {
    const lines = String(body ?? '').replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
    if (lines[0] !== MARKER) {
      const other = lines[0].match(/^<!-- openwiz:status v(\d+) -->$/);
      return other ? { unknown: `a status note of version ${other[1]}, which this app doesn't read` } : null;
    }
    const fields = {};
    let at = 0;
    for (const line of lines.slice(1)) {
      const m = line.match(/^([a-z]+): (.*)$/);
      const index = m ? FIELDS.indexOf(m[1], at) : -1;
      if (index < 0) return { unknown: 'a status note that doesn\'t read as version 1' };
      const value = m[2];
      if (value.length < 1 || value.length > 300 || !TEXT.test(value) || !RULES[m[1]](value)) {
        return { unknown: 'a status note that doesn\'t read as version 1' };
      }
      fields[m[1]] = value;
      at = index + 1;
    }
    if (!FIELDS.slice(0, REQUIRED).every(name => name in fields)) return { unknown: 'a status note that doesn\'t read as version 1' };
    const stopped = fields.state.match(/^stopped \((.*)\)$/);
    return { ...fields, state: stopped ? 'stopped' : fields.state, why: stopped ? stopped[1] : null };
  }

  // ---- Every note on the tickets GitHub gave, with its claim worked out ----

  const recent = (at, now) => at - now <= SKEW && now - at < LAPSE;
  const keyOf = (issue, home) => `${issue.repository?.nameWithOwner || home}#${issue.number}`;

  // [{key, issue, id, at, note, live, holds, unknown}] for one issue's comments. `uncertain` is set on the issue's
  // result when its comment window is full of recent edits, so a live note may be missing.
  function notesOf(issue, home, authors, now) {
    const out = [];
    const comments = issue?.comments;
    const nodes = Array.isArray(comments?.nodes) ? comments.nodes : [];
    const last = nodes[nodes.length - 1];
    const uncertain = !comments || ((comments.totalCount ?? 0) > nodes.length && Boolean(last) && now - (Date.parse(last.updatedAt) || 0) < DAY);
    for (const comment of nodes) {
      if (!comment) continue;
      const note = readNote(comment.body);
      if (!note) continue;
      const by = typeof comment.author?.login === 'string' && authors ? authors.has(comment.author.login.toLowerCase()) : null;
      if (by === false) continue; // a visitor's comment with the marker is ordinary discussion
      const at = Date.parse(comment.updatedAt) || 0;
      const base = { key: keyOf(issue, home), issue, id: comment.databaseId, at };
      if (by === null) out.push({ ...base, unknown: 'a status note whose author couldn\'t be checked against the record authors' });
      else if (note.unknown) out.push({ ...base, unknown: note.unknown });
      else if (!Number.isSafeInteger(comment.databaseId)) out.push({ ...base, unknown: 'a status note GitHub gave without its id' });
      else out.push({ ...base, note, live: (note.state === 'working' || note.state === 'asking') && recent(at, now) });
    }
    // The oldest live note of each kind holds the claim; a newer live one of the same kind doesn't.
    for (const kind of KINDS) {
      const live = out.filter(n => n.live && n.note.agent === kind).sort((a, b) => a.id - b.id);
      live.forEach((n, i) => { n.holds = i === 0; });
    }
    return { notes: out, uncertain };
  }

  // The Agents page's picture from the Agents feed: {now, day, missing, partial} or null when nothing is read yet.
  function picture(feed, home, now = Date.now()) {
    const data = feed?.data;
    if (!data) return null;
    const issues = data.issues;
    if (!issues || !Array.isArray(issues.nodes)) return { broken: true };
    const authors = OW.factory.recordAuthors(data.fleet?.text);
    const rows = [];
    const missing = [];
    for (const issue of issues.nodes) {
      if (!issue) { missing.push(null); continue; }
      const { notes, uncertain } = notesOf(issue, home, authors, now);
      if (uncertain) missing.push(issue);
      rows.push(...notes);
    }
    const shown = rows.filter(r => r.holds || now - r.at < DAY).sort((a, b) => b.at - a.at);
    return {
      now: shown.filter(r => r.holds),
      day: shown.filter(r => !r.holds),
      missing,
      partial: (issues.totalCount ?? issues.nodes.length) > issues.nodes.length,
      authors: Boolean(authors),
    };
  }

  // ---- What GitHub shows of a ticket's pull request ----

  const CHECKS = { SUCCESS: 'checks pass', FAILURE: 'checks fail', ERROR: 'checks fail', PENDING: 'checks running', EXPECTED: 'checks running' };
  const REVIEW = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', REVIEW_REQUIRED: 'waiting for review' };
  function pullRequest(row) {
    const list = row.issue.closedByPullRequestsReferences;
    const nodes = (list?.nodes || []).filter(Boolean);
    const named = row.note?.pr ? nodes.find(pr => pr.url === row.note.pr) : null;
    const pr = named || nodes.find(p => p.state === 'OPEN') || nodes.find(p => p.state === 'MERGED') || null;
    const url = pr?.url || row.note?.pr || null;
    if (!url) return list ? null : { url: null, facts: 'its pull request is unknown' };
    const number = url.split('/').pop();
    if (!pr) return { url, number, facts: list ? 'GitHub doesn\'t link it to this ticket' : 'its state is unknown' };
    if (pr.state === 'MERGED') return { url, number, facts: 'merged', merged: true };
    if (pr.state === 'CLOSED') return { url, number, facts: 'closed without merging' };
    const rollup = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup;
    const facts = [pr.isDraft ? 'draft' : 'open', REVIEW[pr.reviewDecision], rollup === undefined ? 'checks unknown' : rollup === null ? 'no checks' : CHECKS[rollup.state] || 'checks unknown'];
    return { url, number, facts: facts.filter(Boolean).join(', ') };
  }

  // ---- Drawing ----

  const css = (el, props) => { for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v); return el; };
  const WORDS = {
    working: ['Working', STATES.building.colour],
    asking: ['Asking you', STATES.you.colour],
    done: ['Done', STATES.merged.colour],
    stopped: ['Stopped', STATES.held.colour],
    lapsed: ['Lapsed', STATES.waiting.colour],
    second: ['Not holding the claim', STATES.waiting.colour],
    unknown: ['Unknown', STATES.unknown.colour],
  };
  const KIND = { builder: 'Builder', reviewer: 'Reviewer', fleet: 'Fleet' };
  function status(row) {
    if (row.unknown) return 'unknown';
    if (row.holds) return row.note.state;
    if (row.live) return 'second';
    return row.note.state === 'working' || row.note.state === 'asking' ? 'lapsed' : row.note.state;
  }
  const ago = (at, now) => {
    const min = Math.max(0, Math.round((now - at) / 60000));
    return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ago`;
  };

  function card(row, now) {
    const s = status(row);
    const [word, colour] = WORDS[s];
    const pill = h('span', { class: 'pill', '--c': colour }, row.note?.why ? `${word}: ${row.note.why}` : word);
    const ticket = h('a', { href: row.issue.url, rel: 'noreferrer', 'data-focus': `ticket:${row.key}:${row.id}` }, `#${row.issue.number} ${row.issue.title}`);
    const el = h('article', { class: 'card', '--c': colour, 'data-note': row.id, 'data-status': s, 'aria-label': `${word}, ticket #${row.issue.number}` });
    if (row.unknown) {
      el.append(h('div', { class: 'num' }, 'Unknown agent'), h('h3', {}, ticket),
        css(h('div', {}, OW.ui.unknown(`This ticket has ${row.unknown}, so its agent, model and step aren't shown.`)), { margin: '8px 0 0' }),
        h('p', {}, pill, ` · edited ${time(row.at)} (${ago(row.at, now)})`));
      return el;
    }
    const n = row.note;
    const pr = pullRequest(row);
    const at = Date.parse(n.time);
    const meta = [pill, ` · ${time(at)} (${ago(at, now)})`];
    if (pr) {
      meta.push(' · ', pr.url ? h('a', { href: pr.url, rel: 'noreferrer', 'data-focus': `pr:${row.key}:${row.id}` }, `Pull request #${pr.number}`) : 'Pull request', `: ${pr.facts}`);
    }
    if (n.preview) meta.push(' · ', h('a', { href: n.preview, rel: 'noreferrer', 'data-focus': `preview:${row.key}:${row.id}` }, 'Preview'));
    el.append(h('div', { class: 'num' }, `${KIND[n.agent]} · ${n.harness}, ${n.model}`), h('h3', {}, ticket), h('p', {}, n.step), h('p', {}, ...meta));
    if (row.holds && n.state === 'working' && pr?.merged) {
      el.append(css(h('div', {}, OW.ui.unknown('GitHub shows its pull request merged, so this note is out of date.')), { margin: '8px 0 0' }));
    }
    return el;
  }

  function section(title, rows, empty, now) {
    return [css(h('h2', {}, title), { 'font-size': '20px', margin: '0 0 12px' }),
      rows.length ? css(h('div', { class: 'cards' }, rows.map(row => card(row, now))), { margin: '0 0 32px' })
        : css(OW.ui.placeholder(empty), { margin: '0 0 32px' })];
  }

  function draw(el, feeds) {
    const now = Date.now();
    const seen = picture(feeds.agents, OW.data.repo.get()?.full, now);
    if (!seen) return el.replaceChildren(OW.ui.placeholder('Reading GitHub…'));
    if (seen.broken) return el.replaceChildren(OW.ui.unknown('GitHub\'s answer had no tickets in it, so the agents are unknown, not none.'));
    const notes = [];
    if (!seen.authors) notes.push('The record authors (fleet.md) couldn\'t be read, so no status note can be checked: each shows as unknown.');
    if (seen.partial) notes.push('Only the 50 most recently updated tickets were read: an agent on an older ticket isn\'t shown.');
    const hidden = seen.missing.filter(Boolean).map(issue => `#${issue.number}`);
    const unreadable = seen.missing.filter(issue => !issue).length;
    if (hidden.length) notes.push(`${hidden.join(', ')} ${hidden.length === 1 ? 'has' : 'have'} more recently edited comments than GitHub gave, so a note there may be missing.`);
    if (unreadable) notes.push(`${unreadable} ${unreadable === 1 ? 'ticket' : 'tickets'} couldn't be read, so ${unreadable === 1 ? 'its' : 'their'} agents are unknown.`);
    el.replaceChildren(...notes.map(text => css(OW.ui.unknown(text), { margin: '0 0 16px' })),
      ...section('Working now', seen.now, 'No agent is working right now.', now),
      ...section('In the last day', seen.day, 'No agent finished or stopped in the last day.', now));
  }

  // ---- The pulse: the tickets an agent is working on now (a live `working` note that holds its claim) ----

  function workingIn(issues, home, authorsText, now) {
    const authors = OW.factory.recordAuthors(authorsText);
    if (!authors) return [];
    return issues.filter(Boolean).flatMap(issue => notesOf(issue, home, authors, now).notes)
      .filter(n => n.holds && n.note.state === 'working').map(n => n.key);
  }
  function working(now = Date.now()) {
    const home = OW.data.repo.get()?.full;
    const { agents, specs } = OW.data.feeds;
    const tickets = Object.values(specs.data?.specs || {}).flatMap(spec => spec?.subIssues?.nodes || []);
    return new Set([
      ...workingIn(agents.data?.issues?.nodes || [], home, agents.data?.fleet?.text, now),
      ...workingIn(tickets, home, specs.data?.fleet?.text, now),
    ]);
  }

  OW.agents = { readNote, picture, working };

  OW.page({
    id: 'agents',
    title: 'Agents',
    icon: 'agents',
    feeds: ['agents'],
    badge: feeds => picture(feeds.agents, OW.data.repo.get()?.full)?.now?.length || null,
    render(el, feeds) {
      OW.factory.redraw(el, () => draw(el, feeds));
    },
  });
})();
