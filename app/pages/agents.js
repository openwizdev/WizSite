'use strict';
(() => {
  const { h, STATES, time } = OW.ui;
  const LAPSE = 30 * 60 * 1000;
  const DAY = 24 * 60 * 60 * 1000;
  const CLOCK_SKEW = 5 * 60 * 1000;
  const MARKER = '<!-- openwiz:status v1 -->';
  const KINDS = ['builder', 'reviewer', 'fleet'];

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
  const REQUIRED_FIELDS = 7;

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
    if (!FIELDS.slice(0, REQUIRED_FIELDS).every(name => name in fields)) return { unknown: 'a status note that doesn\'t read as version 1' };
    const stopped = fields.state.match(/^stopped \((.*)\)$/);
    return { ...fields, state: stopped ? 'stopped' : fields.state, why: stopped ? stopped[1] : null };
  }

  const recent = (at, now) => at - now <= CLOCK_SKEW && now - at < LAPSE;
  const keyOf = (issue, home) => `${issue.repository?.nameWithOwner || home}#${issue.number}`;

  function notesOf(issue, home, authors, now) {
    const authorsOf = typeof authors === 'function' ? authors : () => authors;
    const out = [];
    const comments = issue?.comments;
    const nodes = Array.isArray(comments?.nodes) ? comments.nodes : [];
    const last = nodes[nodes.length - 1];
    const uncertain = !comments || ((comments.totalCount ?? 0) > nodes.length && Boolean(last) && now - (Date.parse(last.updatedAt) || 0) < DAY);
    for (const comment of nodes) {
      if (!comment) continue;
      const note = readNote(comment.body);
      if (!note) continue;
      const set = authorsOf(comment);
      const by = typeof comment.author?.login === 'string' && set ? set.has(comment.author.login.toLowerCase()) : null;
      if (by === false) continue;
      const at = Date.parse(comment.updatedAt) || 0;
      const base = { key: keyOf(issue, home), issue, id: comment.databaseId, at };
      if (by === null) out.push({ ...base, unknown: 'a status note whose author couldn\'t be checked against the record authors' });
      else if (note.unknown) out.push({ ...base, unknown: note.unknown });
      else if (!Number.isSafeInteger(comment.databaseId)) out.push({ ...base, unknown: 'a status note GitHub gave without its id' });
      else out.push({ ...base, note, live: (note.state === 'working' || note.state === 'asking') && recent(at, now) });
    }
    for (const kind of KINDS) {
      const live = out.filter(n => n.live && n.note.agent === kind).sort((a, b) => a.id - b.id);
      live.forEach((n, i) => { n.holds = i === 0; });
    }
    return { notes: out, uncertain };
  }

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
      read: issues.nodes.length,
      reading: Boolean(issues.reading),
      short: issues.short || null,
      total: issues.totalCount,
      authors: Boolean(authors),
    };
  }

  const CHECKS = { SUCCESS: 'checks pass', FAILURE: 'checks fail', ERROR: 'checks fail', PENDING: 'checks running', EXPECTED: 'checks running' };
  const REVIEW = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', REVIEW_REQUIRED: 'waiting for review' };
  function pullRequest(row) {
    const list = row.issue.closedByPullRequestsReferences;
    const nodes = (list?.nodes || []).filter(Boolean);
    const named = row.note?.pr || null;
    const pr = named ? nodes.find(p => p.url === named) || null : nodes.find(p => p.state === 'OPEN') || nodes.find(p => p.state === 'MERGED') || null;
    const at = pr ? (list?.nodes || []).indexOf(pr) : -1;
    const refused = (row.issue.errors || []).some(path => path[0] === 'closedByPullRequestsReferences' && path[1] === 'nodes' && path[2] === at);
    const url = pr?.url || named;
    if (!url) return list ? null : { url: null, facts: 'its pull request is unknown' };
    const number = url.split('/').pop();
    if (!pr) return { url, number, facts: list ? 'GitHub doesn\'t link it to this ticket, so its state, review and checks are unknown' : 'its state is unknown' };
    if (pr.state === 'MERGED') return { url, number, facts: 'merged', merged: true };
    if (pr.state === 'CLOSED') return { url, number, facts: 'closed without merging' };
    const rollup = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup;
    const facts = [pr.isDraft ? 'draft' : 'open', REVIEW[pr.reviewDecision], refused || rollup === undefined ? 'checks unknown' : rollup === null ? 'no checks' : CHECKS[rollup.state] || 'checks unknown'];
    return { url, number, facts: facts.filter(Boolean).join(', ') };
  }

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
    el.append(h('div', { class: 'num' }, `${KIND[n.agent]} · ${OW.ui.agentName(n.harness, n.model)}`), h('h3', {}, ticket), h('p', {}, n.step), h('p', {}, ...meta));
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
    if (!seen) return OW.ui.fill(el, OW.ui.placeholder('Reading GitHub…'));
    if (seen.broken) return el.replaceChildren(OW.ui.unknown('GitHub\'s answer had no tickets in it, so the agents are unknown, not none.'));
    const notes = [];
    if (!seen.authors) notes.push('The record authors (fleet.md) couldn\'t be read, so no status note can be checked: each shows as unknown.');
    if (seen.reading) notes.push(`Still reading: ${seen.read} of the ${seen.total} tickets updated in the last day so far. Agents on the rest show as they are read.`);
    else if (seen.short) {
      const { read, total, why, scope } = seen.short;
      const what = scope === 'since' ? 'tickets updated since the last read' : 'tickets updated in the last day';
      notes.push(why === 'limit' ? `Read ${read} of the ${total} ${what}: GitHub's limit can't cover the rest now, so an agent on another ticket may be missing.`
        : `Read ${read} of the ${total} ${what}: GitHub didn't give the rest, so an agent on another ticket may be missing.`);
    }
    const hidden = seen.missing.filter(Boolean).map(issue => `#${issue.number}`);
    const unreadable = seen.missing.filter(issue => !issue).length;
    if (hidden.length) notes.push(`${hidden.join(', ')} ${hidden.length === 1 ? 'has' : 'have'} more recently edited comments than GitHub gave, so a note there may be missing.`);
    if (unreadable) notes.push(`${unreadable} ${unreadable === 1 ? 'ticket' : 'tickets'} couldn't be read, so ${unreadable === 1 ? 'its' : 'their'} agents are unknown.`);
    el.replaceChildren(...notes.map(text => css(OW.ui.unknown(text), { margin: '0 0 16px' })),
      ...section('Working now', seen.now, 'No agent is working right now.', now),
      ...section('In the last day', seen.day, 'No agent finished or stopped in the last day.', now));
  }

  const FEEDS = ['agents', 'specs'];
  const order = Object.fromEntries(FEEDS.map(name => [name, { at: null, pending: false, overlapped: false }]));
  OW.data.onChange(() => {
    for (const name of FEEDS) {
      const feed = OW.data.feeds[name];
      const seen = order[name];
      if (feed.readAt === seen.at) {
        if (!feed.busy) seen.pending = false;
        continue;
      }
      Object.assign(seen, { at: feed.readAt, overlapped: feed.readAt !== null && seen.pending, pending: false });
      const other = FEEDS.find(n => n !== name);
      if (OW.data.feeds[other].busy) order[other].pending = true;
    }
  });

  const edited = comment => Date.parse(comment?.updatedAt) || 0;
  function reconcile(reads, home) {
    const tickets = new Map();
    for (const read of reads) {
      for (const issue of read.issues) {
        if (!issue) continue;
        const list = issue.comments;
        const nodes = (Array.isArray(list?.nodes) ? list.nodes : []).filter(Boolean);
        const seen = tickets.get(keyOf(issue, home));
        if (!seen) {
          tickets.set(keyOf(issue, home), { issue, comments: new Map(nodes.map(c => [c.databaseId, { comment: c, authors: read.authors }])) });
          continue;
        }
        const whole = Boolean(list) && (list.totalCount ?? Infinity) <= nodes.length;
        const reach = nodes.length ? Math.min(...nodes.map(edited)) : Infinity;
        const ids = new Set(nodes.map(c => c.databaseId));
        for (const [id, kept] of seen.comments) if (!ids.has(id) && (whole || edited(kept.comment) > reach)) seen.comments.delete(id);
        for (const c of nodes) {
          const kept = seen.comments.get(c.databaseId);
          if (!kept || edited(c) >= edited(kept.comment)) seen.comments.set(c.databaseId, { comment: c, authors: read.authors });
        }
      }
    }
    return tickets;
  }
  function pulsing(reads, home, now) {
    const tickets = reconcile(reads, home);
    return new Set([...tickets.values()].flatMap(({ issue, comments }) => {
      const nodes = [...comments.values()].map(kept => kept.comment);
      const authors = new Map([...comments.values()].map(kept => [kept.comment, kept.authors]));
      return notesOf({ ...issue, comments: { totalCount: nodes.length, nodes } }, home, comment => authors.get(comment), now).notes;
    }).filter(n => n.holds && n.note.state === 'working').map(n => n.key));
  }
  function readsNow() {
    const { agents, specs } = OW.data.feeds;
    return [
      { name: 'agents', at: agents.readAt || 0, authors: OW.factory.recordAuthors(agents.data?.fleet?.text), issues: agents.data?.issues?.nodes || [] },
      { name: 'specs', at: specs.readAt || 0, authors: OW.factory.recordAuthors(specs.data?.fleet?.text),
        issues: Object.values(specs.data?.specs || {}).flatMap(spec => spec?.subIssues?.nodes || []) },
    ].sort((a, b) => a.at - b.at);
  }
  function notes(now = Date.now()) {
    const home = OW.data.repo.get()?.full;
    const reads = readsNow();
    const fresh = new Map((reads.find(r => r.name === 'agents').issues || []).filter(Boolean).map(issue => [keyOf(issue, home), issue]));
    const out = new Map();
    for (const [key, { issue, comments }] of reconcile(reads, home)) {
      const nodes = [...comments.values()].map(kept => kept.comment);
      const authors = new Map([...comments.values()].map(kept => [kept.comment, kept.authors]));
      const read = notesOf({ ...issue, comments: { totalCount: nodes.length, nodes } }, home, comment => authors.get(comment), now);
      out.set(key, { issue: fresh.get(key) || issue, notes: read.notes });
    }
    return out;
  }
  function working(now = Date.now()) {
    const home = OW.data.repo.get()?.full;
    const reads = readsNow();
    const [older, newer] = reads;
    const known = older.at < newer.at && !(order[newer.name].at === newer.at && order[newer.name].overlapped);
    const one = pulsing(reads, home, now);
    if (known) return one;
    const other = pulsing([newer, older], home, now);
    return new Set([...one].filter(key => other.has(key)));
  }

  OW.agents = { readNote, picture, working, notes, status, pullRequest, WORDS, KIND };

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
