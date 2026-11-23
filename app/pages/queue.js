'use strict';
(() => {
  const { h, STATES, time } = OW.ui;
  const RISKS = ['ordinary', 'live', 'release', 'publish'];
  const GRILL = ['grill_round', 'grill_confirmation'];
  const SPEC = ['spec_confirmation', 'plan_approval'];
  const QUESTION = /^[A-Z]{1,2}[1-9][0-9]*$/;
  const GRILL_FILE = /^docs\/grills\/[A-Za-z0-9][A-Za-z0-9_.-]*\.md$/;
  const VIDEO = /^\[Watch the narrated spec\]\((https:\/\/[^\s<>()\\`]+)\)\n\n(?:Comment here to steer: stop, reset, or anything else|Steering by comment is off for now: tell your orchestrator what to change \(stop, reset, or anything else\))\.$/;
  const EMPTY = 'No open spec or grill pull request is waiting on you';
  const MAX_PAGES = 50;

  class Failed extends Error {}
  const repoPath = full => `/repos/${full.split('/').map(encodeURIComponent).join('/')}`;
  const authorOk = (authors, login) => Boolean(authors) && typeof login === 'string' && authors.has(login.toLowerCase());

  async function ask(path) {
    const data = OW.data;
    if (data.paused() || typeof data.github !== 'function') throw new Failed();
    let response;
    try {
      response = await data.github('GET', path);
    } catch (error) {
      if (error instanceof data.Ended || error instanceof data.SignedOut) throw error;
      throw new Failed();
    }
    data.noteLimit?.(null, response);
    if (!response.ok) throw new Failed();
    const json = await response.json().catch(() => undefined);
    if (json === undefined) throw new Failed();
    return { json, next: /rel="next"/.test(response.headers.get('Link') || '') };
  }
  async function every(path) {
    const items = [];
    const join = path.includes('?') ? '&' : '?';
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      let got;
      try { got = await ask(`${path}${join}per_page=100&page=${page}`); } catch (error) {
        if (error instanceof Failed) return { items, complete: false };
        throw error;
      }
      if (!Array.isArray(got.json)) return { items, complete: false };
      items.push(...got.json);
      if (!got.next) return { items, complete: true };
    }
    return { items, complete: false };
  }

  function tokens(body) {
    const out = [];
    const token = /"(?:[^"\\\u0000-\u001f]|\\[\s\S])*"/y;
    for (let at = body.indexOf('"'); at >= 0; at = body.indexOf('"', at + 1)) {
      token.lastIndex = at;
      const m = token.exec(body);
      if (m) out.push(m[0]);
    }
    return out;
  }
  const SIMPLE = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
  function decoded(token) {
    try { return JSON.parse(token); } catch {
      return token.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (_, e) => (e.length === 5 ? String.fromCharCode(parseInt(e.slice(1), 16)) : SIMPLE[e]));
    }
  }
  const marked = body => tokens(body).some(t => String(decoded(t)).startsWith('openwiz.decisions.'));

  const exactly = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));
  const text = v => typeof v === 'string' && v.length > 0;
  const lines = v => Array.isArray(v) && v.length >= 1 && v.length <= 10 && v.every(l => text(l) && !/[\r\n]/.test(l));
  function grillOk(r) {
    if (!GRILL_FILE.test(r.grill_file) || r.grill_file.split('/').some(part => part === '..' || part === '.')) return false;
    if (r.kind === 'grill_confirmation') return lines(r.summary);
    const ids = Array.isArray(r.questions) ? r.questions.map(q => q?.id) : [];
    return Number.isSafeInteger(r.round) && r.round > 0 && ids.length >= 1 && ids.length <= 3
      && r.questions.every(q => exactly(q, ['id', 'decides', 'context', 'recommendation']) && QUESTION.test(q.id)
        && text(q.decides) && text(q.context) && text(q.recommendation))
      && new Set(ids).size === ids.length && Array.isArray(r.answered) && new Set(r.answered).size === r.answered.length
      && r.answered.every((id, i) => ids.includes(id) && (i === 0 || ids.indexOf(r.answered[i - 1]) < ids.indexOf(id)));
  }
  function recordOf(body, kind, number) {
    const raw = String(body ?? '');
    let read;
    try { read = OW.factory.readRecord(raw, kind === 'issue' ? number : undefined); } catch { read = { malformed: true }; }
    if (!read) return marked(raw) ? { malformed: true } : null;
    if (read.malformed) return read;
    const r = read.record;
    const fits = kind === 'pull_request' ? GRILL.includes(r.kind) && grillOk(r) : SPEC.includes(r.kind);
    return fits ? read : { malformed: true };
  }

  function same(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && same(a[k], b[k]));
  }
  async function sha256(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const untick = body => `${body}\n`.split('\n').map(l => l.replace(/^([ \t]*[-*+][ \t]+)\[[xX]\]$/, '$1[ ]')
    .replace(/^([ \t]*[-*+][ \t]+)\[[xX]\]([ \t\r])/, '$1[ ]$2')).join('\n');
  function headline(body) {
    const section = String(body ?? '').split(/^## /m).find(part => part.startsWith('Changelog headline\n'));
    return section?.split('\n').slice(1).find(line => line.trim()) ?? null;
  }

  function latest(source) {
    if (!source.startsWith('# Grill: ') || source.includes('\r')) throw new Error('unreadable saved grill');
    let selected = null;
    let previous = 0;
    for (const section of source.split(/^## /m).slice(1)) {
      const [heading, ...rest] = section.split('\n');
      if (heading.startsWith('Round ')) {
        const m = heading.match(/^Round ([1-9][0-9]*)$/);
        if (!m || Number(m[1]) <= previous) throw new Error('unreadable saved round order');
        previous = Number(m[1]);
        selected = { kind: 'grill_round', round: previous, rest };
      } else if (heading.startsWith('Summary')) {
        if (!/^Summary(?:, corrected)?(?: \(shown to .+ for confirmation\))?$/.test(heading)) throw new Error('unreadable saved summary heading');
        selected = { kind: 'grill_confirmation', rest };
      }
    }
    if (!selected || !selected.rest.length) throw new Error('no saved round or summary');
    const first = selected.rest[0];
    const risk = first.startsWith('Risk: ') && RISKS.includes(first.slice(6)) ? first.slice(6) : 'unknown';
    const wording = first.startsWith('Risk:') ? selected.rest.slice(1) : selected.rest;
    if (wording.some(l => /^(Risk:|```|~~~)/.test(l.trimStart()))) throw new Error('ambiguous saved risk or wording');
    const proposal = [];
    for (const line of wording) { if (line.startsWith('**') && line.endsWith(':**')) break; proposal.push(line); }
    if (selected.kind === 'grill_confirmation') {
      const summary = [];
      for (const line of proposal.filter(Boolean)) {
        const prefix = `${summary.length + 1}. `;
        if (!line.startsWith(prefix) || line.length === prefix.length) throw new Error('unreadable saved summary');
        summary.push(line.slice(prefix.length));
      }
      return { kind: selected.kind, risk, summary };
    }
    const questions = [];
    let pending = null;
    for (const line of proposal) {
      if (!pending) {
        if (!line) continue;
        const m = line.match(/^\*\*([A-Z]{1,2}[1-9][0-9]*)(?:, re-asked)? - (.+?)\*\* (.*)$/);
        if (!m) throw new Error('unreadable saved question');
        pending = { id: m[1], decides: m[2], context: m[3] };
      } else if (line.startsWith('➡️ ')) {
        questions.push({ ...pending, recommendation: line.slice(3) });
        pending = null;
      } else pending.context += `\n${line}`;
    }
    if (pending || questions.length < 1 || questions.length > 3) throw new Error('expected one to three saved questions');
    return { kind: selected.kind, risk, round: selected.round, questions };
  }
  function base64Bytes(content) {
    const binary = atob(String(content).replace(/\s/g, ''));
    return Uint8Array.from(binary, ch => ch.charCodeAt(0));
  }

  async function check(item, authors) {
    const R = repoPath(item.repository);
    const r = item.request;
    const comment = (await ask(`${R}/issues/comments/${item.comment_id}`)).json;
    let fine = typeof comment?.issue_url === 'string' && comment.issue_url.endsWith(`/issues/${item.subject.number}`)
      && authorOk(authors, comment.user?.login);
    const read = recordOf(comment?.body, item.subject.kind, item.subject.number);
    fine = fine && Boolean(read?.record) && same(read.record, r);
    if (GRILL.includes(r.kind)) {
      const pull = (await ask(`${R}/pulls/${item.subject.number}`)).json;
      const sha = pull?.head?.sha;
      if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) throw new Failed();
      const file = (await ask(`${R}/contents/${r.grill_file.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`)).json;
      if (file?.encoding !== 'base64' || typeof file.content !== 'string') throw new Failed();
      let bytes;
      let saved;
      try {
        bytes = base64Bytes(file.content);
        saved = latest(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch { throw new Failed(); }
      const want = r.kind === 'grill_round' ? { kind: r.kind, risk: r.risk, round: r.round, questions: r.questions }
        : { kind: r.kind, risk: r.risk, summary: r.summary };
      fine = fine && pull.state === 'open' && pull.head?.repo?.full_name === item.repository && same(saved, want);
      return { result: fine ? 'matched' : 'changed', binding: { ref: sha, digest: await sha256(bytes) } };
    }
    const spec = (await ask(`${R}/issues/${r.spec}`)).json;
    if (typeof spec?.body !== 'string') throw new Failed();
    fine = fine && spec.state === 'open' && headline(spec.body) === r.headline;
    if (r.kind === 'spec_confirmation') return { result: fine ? 'matched' : 'changed', binding: { ref: 'issue', digest: await sha256(spec.body) } };
    const subs = await every(`${R}/issues/${r.spec}/sub_issues`);
    if (!subs.complete) throw new Failed();
    const tickets = [];
    for (const t of [...subs.items].sort((a, b) => a.number - b.number)) {
      if (!Number.isSafeInteger(t?.number) || typeof t.title !== 'string' || typeof t.body !== 'string') throw new Failed();
      const by = await every(`${R}/issues/${t.number}/dependencies/blocked_by`);
      if (!by.complete) throw new Failed();
      tickets.push({ number: t.number, title: t.title, body: t.body, blockers: by.items.map(b => b?.number).sort((a, b) => a - b) });
    }
    const rows = [];
    for (const t of tickets) {
      rows.push(`ticket #${t.number} blocked-by ${t.blockers.map(b => `#${b}`).join(' ') || 'none'} body sha256 ${await sha256(untick(t.body))} title ${t.title}`);
    }
    const revision = `${['plan-graph revision v2', `spec #${r.spec} body sha256 ${await sha256(untick(spec.body))}`, ...rows].join('\n')}\n`;
    const digest = await sha256(revision);
    fine = fine && same(tickets.map(({ number, title, blockers }) => ({ number, title, blockers })), r.tickets) && digest === r.fingerprint;
    return { result: fine ? 'matched' : 'changed', binding: { ref: 'revision-v2', digest } };
  }
  async function sourceCheck(item, authors) {
    try { return await check(item, authors); } catch (error) {
      if (error instanceof Failed) return { result: 'unchecked' };
      throw error;
    }
  }

  async function decisions(repository, subject, title, records, complete, authors, gaps) {
    const out = [];
    const sameThread = (a, b) => a.kind === b.kind && (GRILL.includes(a.kind) ? a.grill_file === b.grill_file : a.spec === b.spec);
    for (const { comment, request } of records) {
      const item = { type: 'decision', key: `decision:${repository}#${subject.number}:${comment.id}`, repository, subject: { ...subject },
        title, url: comment.url, comment_id: comment.id, at: comment.at, current: null, checked_at: null, request };
      if (request && records.some(o => o.request && o.comment.at > item.at && sameThread(o.request, request))) item.current = false;
      else if (request && complete && request.status === 'open') {
        const got = await sourceCheck(item, authors);
        if (got.result === 'unchecked') gaps.push(`#${subject.number}'s source check`);
        else Object.assign(item, { current: got.result === 'matched', checked_at: Date.now() });
      }
      out.push(item);
    }
    return out;
  }
  function candidates(comments, kind, number, authors) {
    const out = [];
    for (const c of comments) {
      if (!c || !Number.isSafeInteger(c.id)) continue;
      if (authors && !authorOk(authors, c.login)) continue;
      const read = recordOf(c.body, kind, number);
      if (!read) continue;
      out.push({ comment: { id: c.id, url: c.url, at: Date.parse(c.createdAt) || 0 }, request: authors && read.record ? read.record : null });
    }
    return out;
  }

  async function build(feeds, picked) {
    const seen = OW.factory.model(feeds);
    const data = feeds.specs.data;
    const authors = OW.factory.recordAuthors(data?.fleet?.text);
    const repository = picked.full;
    const R = repoPath(repository);
    const gaps = seen.gaps.filter(gap => gap !== 'tickets marked for you');
    if (!authors) gaps.push('the record authors');
    const items = [];
    for (const spec of seen.specs) {
      const list = spec.detail?.comments;
      const nodes = Array.isArray(list?.nodes) ? list.nodes : [];
      const complete = Boolean(list) && !nodes.some(c => !c) && (list.totalCount ?? 0) <= nodes.length;
      const comments = nodes.filter(Boolean).map(c => ({ id: c.databaseId, url: c.url, createdAt: c.createdAt, body: c.body, login: c.author?.login }));
      const records = candidates(comments, 'issue', spec.number, authors);
      items.push(...(await decisions(repository, { kind: 'issue', number: spec.number }, spec.title, records, complete, authors, gaps)));
    }
    const pulls = await every(`${R}/pulls?state=open`);
    if (!pulls.complete) gaps.push('the open pull requests');
    for (const pull of pulls.items) {
      if (pull?.head?.repo?.full_name !== repository || !Number.isSafeInteger(pull.number)) continue;
      const got = await every(`${R}/issues/${pull.number}/comments`);
      if (!got.complete) gaps.push(`#${pull.number}'s comments`);
      const comments = got.items.filter(Boolean).map(c => ({ id: c.id, url: c.html_url, createdAt: c.created_at, body: c.body, login: c.user?.login }));
      const records = candidates(comments, 'pull_request', pull.number, authors);
      items.push(...(await decisions(repository, { kind: 'pull_request', number: pull.number }, pull.title, records, got.complete, authors, gaps)));
    }
    const updated = new Map((data?.specIssues?.nodes || []).filter(Boolean).map(issue => [issue.number, Date.parse(issue.updatedAt) || 0]));
    const specs = seen.specs.filter(spec => spec.total > 0 && spec.done < spec.total).map(spec => {
      const videos = (spec.detail?.comments?.nodes || []).filter(c => c && Number.isSafeInteger(c.databaseId) && authorOk(authors, c.author?.login)
        && VIDEO.test(String(c.body ?? ''))).sort((a, b) => b.databaseId - a.databaseId);
      return { type: 'spec', key: `spec:${repository}#${spec.number}`, repository, subject: { kind: 'issue', number: spec.number },
        title: spec.title, url: spec.url, at: updated.get(spec.number) ?? 0,
        video: videos.length ? { url: videos[0].body.match(VIDEO)[1] } : null, graph: spec.graph };
    });
    const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    items.sort((a, b) => a.at - b.at || byKey(a, b));
    specs.sort((a, b) => b.at - a.at || byKey(a, b));
    return { repository, items: [...items, ...specs], gaps: [...new Set(gaps)] };
  }

  const state = { key: null, run: null, result: null, el: null, cards: new Map() };
  const shown = item => item.type === 'spec' || item.request === null || (item.request.status === 'open' && item.current !== false);

  function refresh(feeds) {
    const picked = OW.data.repo.get();
    const specs = feeds.specs;
    if (!picked || state.result?.repository !== picked.full) {
      state.result = null;
      state.cards.clear();
    }
    if (!picked || !specs.data || !specs.readAt || !OW.factory.model(feeds)) return;
    const key = `${picked.full}|${specs.readAt}`;
    if (state.key === key) return;
    state.key = key;
    const session = OW.data.auth.session();
    const mine = build(feeds, picked);
    state.run = mine;
    const still = () => state.run === mine && OW.data.auth.session() === session && OW.data.repo.get()?.full === picked.full;
    mine.then(result => {
      if (!still()) return;
      state.run = null;
      state.result = result;
      if (state.el?.isConnected) OW.factory.redraw(state.el, () => draw(state.el));
    }, error => {
      if (!still()) return;
      state.run = null;
      if (error instanceof OW.data.Ended) return;
      if (error instanceof OW.data.SignedOut) return OW.onSignedOut?.();
      state.result = { repository: picked.full, items: [], gaps: ['the queue\'s reads'] };
      if (state.el?.isConnected) OW.factory.redraw(state.el, () => draw(state.el));
    });
  }

  const WORDS = {
    grill_round: 'Grill round to answer',
    grill_confirmation: 'Grill summary to confirm',
    spec_confirmation: 'Spec to confirm',
    plan_approval: 'Plan to approve',
  };
  function plain(item) {
    const head = (word, colour, tell) => h('a', { class: 'card you', href: item.url, target: '_blank', rel: 'noreferrer', '--c': colour, 'data-focus': `queue:${item.key}` },
      h('div', { class: 'num' }, `${word} · #${item.subject.number}${item.at ? ` · ${time(item.at)}` : ''}`), h('h3', {}, item.title), h('p', {}, tell));
    if (item.type === 'spec') {
      return head('Spec to watch', STATES.building.colour, item.video ? 'Watch its video and steer it on GitHub.' : 'See its plan and steer it on GitHub.');
    }
    if (!item.request) {
      return head('A decision record that couldn\'t be read', STATES.unknown.colour,
        'It isn\'t a valid request from the factory, or its author couldn\'t be checked. Open it on GitHub to read it.');
    }
    return head(WORDS[item.request.kind], item.current ? STATES.you.colour : STATES.unknown.colour,
      item.current ? 'Open it on GitHub to answer it.' : 'Its source couldn\'t be checked yet, so read it on GitHub first.');
  }
  function holder(item) {
    const json = JSON.stringify(item);
    const kept = state.cards.get(item.key);
    if (kept && kept.json === json) return kept.el;
    const el = h('div', { class: 'queue-item', 'data-key': item.key });
    const card = OW.cards?.[item.type];
    if (typeof card === 'function') card(item, el);
    else el.replaceChildren(plain(item));
    state.cards.set(item.key, { json, el });
    return el;
  }

  function draw(el) {
    const result = state.result;
    if (!result) return el.replaceChildren(OW.ui.placeholder('Reading GitHub…'));
    const items = result.items.filter(shown);
    const keys = new Set(items.map(item => item.key));
    for (const key of [...state.cards.keys()]) if (!keys.has(key)) state.cards.delete(key);
    const missing = result.gaps.length
      ? OW.ui.unknown(`This list may be missing items: GitHub gave only part of ${result.gaps.join(', ')}. The app tries again on its own.`) : null;
    el.replaceChildren(...[missing, items.length ? h('div', { class: 'queue' }, items.map(holder))
      : missing ? null : OW.ui.placeholder(`${EMPTY}.`)].filter(Boolean));
  }

  OW.queue = { build, sourceCheck };
  OW.page({
    id: 'queue',
    title: 'Queue',
    icon: 'clock',
    v2: true,
    feeds: ['specs'],
    badge: () => state.result?.items.filter(shown).length || null,
    render(el, feeds) {
      state.el = el;
      refresh(feeds);
      OW.factory.redraw(el, () => draw(el));
    },
  });
})();
