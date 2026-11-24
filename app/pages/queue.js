'use strict';
(() => {
  const { h, STATES, time } = OW.ui;
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
    if (typeof r.grill_file !== 'string' || !GRILL_FILE.test(r.grill_file) || r.grill_file.split('/').some(part => part === '..' || part === '.')) return false;
    if (r.kind === 'grill_confirmation') return lines(r.summary);
    if (!Array.isArray(r.questions) || !Array.isArray(r.answered)) return false;
    const ids = r.questions.map(q => q?.id);
    return Number.isSafeInteger(r.round) && r.round > 0 && ids.length >= 1 && ids.length <= 3
      && r.questions.every(q => exactly(q, ['id', 'decides', 'context', 'recommendation']) && typeof q.id === 'string' && QUESTION.test(q.id)
        && text(q.decides) && text(q.context) && text(q.recommendation))
      && new Set(ids).size === ids.length && new Set(r.answered).size === r.answered.length
      && r.answered.every((id, i) => typeof id === 'string' && ids.includes(id) && (i === 0 || ids.indexOf(r.answered[i - 1]) < ids.indexOf(id)));
  }
  function recordOf(body, kind, number) {
    const raw = String(body ?? '');
    let read;
    try { read = OW.factory.readRecord(raw, kind === 'issue' ? number : undefined); } catch { read = { malformed: true }; }
    if (!read) return marked(raw) ? { malformed: true } : null;
    if (read.malformed) return read;
    const r = read.record;
    let fits = false;
    try { fits = kind === 'pull_request' ? GRILL.includes(r.kind) && grillOk(r) : SPEC.includes(r.kind); } catch { fits = false; }
    return fits ? read : { malformed: true };
  }

  async function sourceCheck(item) {
    let got;
    try {
      if (typeof OW.records?.check !== 'function') return { result: 'unchecked' };
      got = await OW.records.check(item);
    } catch (error) {
      if (error instanceof OW.data.Ended || error instanceof OW.data.SignedOut) throw error;
      return { result: 'unchecked' };
    }
    const at = got?.checked_at;
    if (!['matched', 'changed'].includes(got?.result) || !Number.isFinite(at)) return { result: 'unchecked' };
    return { result: got.result, checked_at: at, binding: got.result === 'matched' ? JSON.stringify(got.binding ?? null) : null };
  }

  async function decisions(repository, subject, title, records, complete, authors, gaps, bindings, onCheck) {
    const out = [];
    const sameThread = (a, b) => a.kind === b.kind && (GRILL.includes(a.kind) ? a.grill_file === b.grill_file : a.spec === b.spec);
    const later = (a, b) => a.at > b.at || (a.at === b.at && a.id > b.id);
    for (const { comment, request } of records) {
      const item = { type: 'decision', key: `decision:${repository}#${subject.number}:${comment.id}`, repository, subject: { ...subject },
        title, url: comment.url, comment_id: comment.id, at: comment.at, current: null, checked_at: null, request };
      if (request && records.some(o => o.request && later(o.comment, comment) && sameThread(o.request, request))) item.current = false;
      else if (request && complete && request.status === 'open') {
        const got = await sourceCheck(item);
        if (got.result === 'unchecked') gaps.push(`#${subject.number}'s source check`);
        else {
          Object.assign(item, { current: got.result === 'matched', checked_at: got.checked_at });
          if (got.binding) bindings.set(item.key, got.binding);
          if (got.result === 'matched') onCheck?.(item, got.binding ?? null);
        }
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

  async function build(feeds, picked, onCheck) {
    const seen = OW.factory.model(feeds);
    const data = feeds.specs.data;
    const specsWhole = !(feeds.specs.errors?.length);
    const bindings = new Map();
    const authors = OW.factory.recordAuthors(data?.fleet?.text);
    const repository = picked.full;
    const R = repoPath(repository);
    const gaps = seen.gaps.filter(gap => gap !== 'tickets marked for you');
    if (!authors) gaps.push('the record authors');
    if (!specsWhole) gaps.push('the spec read');
    const items = [];
    for (const spec of seen.specs) {
      const list = spec.detail?.comments;
      const nodes = Array.isArray(list?.nodes) ? list.nodes : [];
      const complete = specsWhole && Boolean(list) && !nodes.some(c => !c) && (list.totalCount ?? 0) <= nodes.length;
      const comments = nodes.filter(Boolean).map(c => ({ id: c.databaseId, url: c.url, createdAt: c.createdAt, body: c.body, login: c.author?.login }));
      const records = candidates(comments, 'issue', spec.number, authors);
      items.push(...(await decisions(repository, { kind: 'issue', number: spec.number }, spec.title, records, complete, authors, gaps, bindings, onCheck)));
    }
    const pulls = await every(`${R}/pulls?state=open`);
    if (!pulls.complete) gaps.push('the open pull requests');
    for (const pull of pulls.items) {
      if (pull?.head?.repo?.full_name !== repository || !Number.isSafeInteger(pull.number)) continue;
      const got = await every(`${R}/issues/${pull.number}/comments`);
      if (!got.complete) gaps.push(`#${pull.number}'s comments`);
      const comments = got.items.filter(Boolean).map(c => ({ id: c.id, url: c.html_url, createdAt: c.created_at, body: c.body, login: c.user?.login }));
      const records = candidates(comments, 'pull_request', pull.number, authors);
      items.push(...(await decisions(repository, { kind: 'pull_request', number: pull.number }, pull.title, records, pulls.complete && got.complete, authors, gaps, bindings, onCheck)));
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
    return { repository, items: [...items, ...specs], gaps: [...new Set(gaps)], bindings };
  }

  const state = { key: null, run: null, result: null, failedSince: null, el: null, session: null, cards: new Map(), drafts: new Map() };
  const shown = item => item.type === 'spec' || item.request === null || (item.request.status === 'open' && item.current !== false);
  const shapeOf = item => JSON.stringify({ ...item, current: null, checked_at: null });

  function refresh(feeds) {
    const picked = OW.data.repo.get();
    const specs = feeds.specs;
    const session = OW.data.auth.session();
    if (!picked || state.result?.repository !== picked.full || state.session !== session) {
      state.result = null;
      state.failedSince = null;
      state.session = session;
      state.cards.clear();
      state.drafts.clear();
    }
    if (!picked || !specs.data || !specs.readAt || !OW.factory.model(feeds)) return;
    if (specs.failedAt != null) state.failedSince = Math.max(state.failedSince ?? 0, specs.failedAt);
    const readAt = specs.readAt;
    const key = `${picked.full}|${readAt}`;
    if (state.key === key) return;
    state.key = key;
    let mine;
    const still = () => state.run === mine && OW.data.auth.session() === session && OW.data.repo.get()?.full === picked.full;
    const sync = (item, binding) => {
      if (!still()) return;
      const kept = state.cards.get(item.key);
      if (!kept || kept.item.type !== 'decision' || kept.item.current !== true) return;
      if (kept.shape !== shapeOf(item) || kept.binding !== binding) return;
      kept.item.checked_at = item.checked_at;
      if (state.result) {
        const shownItem = state.result.items.find(x => x.key === item.key);
        if (shownItem && shownItem.current === true) shownItem.checked_at = item.checked_at;
        if (binding != null) state.result.bindings.set(item.key, binding);
      }
    };
    mine = build(feeds, picked, sync);
    state.run = mine;
    mine.then(result => {
      if (!still()) return;
      state.run = null;
      state.result = result;
      if (state.failedSince !== null && readAt > state.failedSince) state.failedSince = null;
      if (state.el?.isConnected) OW.factory.redraw(state.el, () => draw(state.el));
    }, error => {
      if (!still()) return;
      state.run = null;
      if (error instanceof OW.data.Ended) return;
      if (error instanceof OW.data.SignedOut) return OW.onSignedOut?.();
      state.result = { repository: picked.full, items: [], gaps: ['the queue\'s reads'], bindings: new Map() };
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
  function view() {
    const result = state.result;
    if (!result || state.failedSince === null) return result;
    return { ...result, gaps: [...new Set([...result.gaps, 'the latest spec read'])],
      items: result.items.map(item => (item.type === 'decision' && item.current === true ? { ...item, current: null, checked_at: null } : item)) };
  }
  function saveDraft(kept) {
    if (!kept || kept.item.type !== 'decision' || kept.item.current !== true) return;
    const boxes = [...kept.el.querySelectorAll('textarea')];
    if (!boxes.length) return;
    const values = boxes.map(box => box.value);
    if (values.some(v => v.length > 0)) state.drafts.set(kept.item.key, { shape: kept.shape, binding: kept.binding, values });
    else state.drafts.delete(kept.item.key);
  }
  function restoreDraft(el, key, shape, binding) {
    const draft = state.drafts.get(key);
    if (!draft) return;
    if (draft.shape !== shape || draft.binding !== binding) return void state.drafts.delete(key);
    const boxes = [...el.querySelectorAll('textarea')];
    if (boxes.length !== draft.values.length) return;
    state.drafts.delete(key);
    boxes.forEach((box, i) => {
      if (!draft.values[i]) return;
      box.value = draft.values[i];
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  function holder(item, bindings) {
    const binding = bindings.get(item.key) ?? null;
    const shape = shapeOf(item);
    const identity = JSON.stringify([{ ...item, checked_at: null }, binding]);
    const kept = state.cards.get(item.key);
    const stale = item.type === 'decision' && item.current === true && item !== kept?.item && Boolean(kept?.el?.querySelector('.decision-blocked'));
    if (kept && kept.identity === identity && !stale) {
      kept.item.checked_at = item.checked_at;
      return kept.el;
    }
    saveDraft(kept);
    const el = h('div', { class: 'queue-item', 'data-key': item.key });
    const card = OW.cards?.[item.type];
    if (typeof card === 'function') card(item, el);
    else el.replaceChildren(plain(item));
    if (item.type === 'decision' && item.current === true) restoreDraft(el, item.key, shape, binding);
    state.cards.set(item.key, { identity, shape, binding, item, el });
    return el;
  }

  function draw(el) {
    const result = view();
    if (!result) return el.replaceChildren(OW.ui.placeholder('Reading GitHub…'));
    const items = result.items.filter(shown);
    const keys = new Set(items.map(item => item.key));
    for (const [key, kept] of [...state.cards.entries()]) {
      if (keys.has(key)) continue;
      const gone = result.items.find(i => i.key === key);
      if (result.gaps.length && (!gone || gone.current !== false)) saveDraft(kept);
      else state.drafts.delete(key);
      state.cards.delete(key);
    }
    if (!result.gaps.length) {
      for (const key of [...state.drafts.keys()]) if (!keys.has(key)) state.drafts.delete(key);
    } else {
      for (const item of result.items) if (item.current === false) state.drafts.delete(item.key);
    }
    const missing = result.gaps.length
      ? OW.ui.unknown(`This list may be missing items: GitHub gave only part of ${result.gaps.join(', ')}. The app tries again on its own.`) : null;
    el.replaceChildren(...[missing, items.length ? h('div', { class: 'queue' }, items.map(item => holder(item, result.bindings)))
      : missing ? null : OW.ui.placeholder(`${EMPTY}.`)].filter(Boolean));
  }

  OW.page({
    id: 'queue',
    title: 'Queue',
    icon: 'clock',
    v2: true,
    feeds: ['specs'],
    badge: () => view()?.items.filter(shown).length || null,
    render(el, feeds) {
      state.el = el;
      refresh(feeds);
      OW.factory.redraw(el, () => draw(el));
    },
  });
})();
