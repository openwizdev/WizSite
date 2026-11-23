'use strict';
(() => {
  const OW = (window.OW = window.OW || {});
  const API = 'https://api.github.com';
  const writer = OW.data.writer();
  const SKEW = 5 * 60 * 1000;
  const LONGEST = 65536;
  const MAX_PAGES = 50;
  const RISKS = ['ordinary', 'live', 'release', 'publish'];
  const ACCOUNT_KEY = 'openwiz.app.v2.account';
  const RECEIPTS = 'openwiz.app.v2.receipts.';
  const PENDING = ['sending', 'unknown'];

  const FIELDS = {
    'decision.yes': ['form', 'item'],
    'decision.no': ['form', 'item'],
    'decision.own': ['form', 'item', 'words'],
    'spec.ship': ['form', 'item'],
    'spec.not_now': ['form', 'item'],
    'spec.change': ['form', 'item', 'words'],
  };
  const CONTEXT = {
    grill_round: ['grill_file', 'round', 'question_id'],
    grill_confirmation: ['grill_file'],
    spec_confirmation: ['spec'],
    plan_approval: ['spec'],
  };
  const YES = {
    grill_round: action => `${action.question_id} yes`,
    grill_confirmation: () => 'confirm',
    spec_confirmation: action => `confirm spec #${action.item.request.spec}`,
    plan_approval: action => `approve #${action.item.request.spec}`,
  };
  const STEERS = { 'spec.ship': () => 'go on', 'spec.not_now': () => 'stop', 'spec.change': action => action.words };
  const MARKERS = { line: ['launch-fleet:', '**Machine plan approval', '**Plan graph approved by', '**Late look by'], decisions: 'openwiz.decisions.' };

  const own = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const positive = n => Number.isSafeInteger(n) && n > 0;
  const same = (a, b) => canonical(a) === canonical(b);
  function canonical(v) {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (object(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
    return JSON.stringify(v) ?? 'undefined';
  }
  const refused = (op, reason) => ({ outcome: 'refused', op, reason });
  const mode = () => (writer ? OW.data.v2.get() : 'off');

  function tokens(body) {
    const out = [];
    for (let at = body.indexOf('"'); at >= 0; at = body.indexOf('"', at + 1)) {
      const found = body.slice(at).match(/^"(?:[^"\\\u0000-\u001f]|\\[^])*"/);
      if (found) out.push(found[0]);
    }
    return out;
  }
  const SHORT = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
  function decoded(token) {
    try { return JSON.parse(token); } catch {
      return token.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|[^])/g, (all, e) => (e.length === 5 ? String.fromCharCode(parseInt(e.slice(1), 16)) : SHORT[e] ?? all));
    }
  }
  function refusedForm(body) {
    if (body.includes(MARKERS.decisions)) return true;
    if (body.split(/\r\n|\r|\n/).some(line => MARKERS.line.some(marker => line.replace(/^[ \t]+/, '').startsWith(marker)))) return true;
    return tokens(body).some(token => decoded(token).startsWith(MARKERS.decisions));
  }

  function itemShape(item, type) {
    if (!object(item) || item.type !== type || typeof item.repository !== 'string' || typeof item.key !== 'string') return false;
    const subject = item.subject;
    if (!object(subject) || !positive(subject.number) || subject.number > 9_999_999_999) return false;
    if (type === 'spec' ? subject.kind !== 'issue' : subject.kind !== 'issue' && subject.kind !== 'pull_request') return false;
    return typeof item.url === 'string' && /^https:\/\/github\.com\/[^\s]*$/.test(item.url)
      && (type === 'spec' || positive(item.comment_id));
  }
  function notAForm(action) {
    if (!object(action) || typeof action.form !== 'string' || !own(FIELDS, action.form)) return true;
    const type = action.form.split('.')[0];
    if (!itemShape(action.item, type)) return true;
    const fields = [...FIELDS[action.form]];
    if (type === 'decision' && action.item.request?.kind === 'grill_round') fields.push('question_id');
    const keys = Object.keys(action);
    return keys.length !== fields.length || !fields.every(f => own(action, f));
  }
  function requestShape(request) {
    if (!object(request) || typeof request.kind !== 'string' || !own(CONTEXT, request.kind)) return false;
    if (typeof request.id !== 'string' || typeof request.fingerprint !== 'string') return false;
    if (request.kind === 'grill_round') return Array.isArray(request.questions) && Array.isArray(request.answered)
      && typeof request.grill_file === 'string' && positive(request.round);
    if (request.kind === 'grill_confirmation') return typeof request.grill_file === 'string';
    return positive(request.spec);
  }

  function bodyOf(action) {
    if (action.item.type === 'spec') return STEERS[action.form](action);
    const { item } = action;
    const request = item.request;
    const context = { subject: { repository: item.repository, kind: item.subject.kind, number: item.subject.number },
      comment_id: item.comment_id, request_id: request.id, request_kind: request.kind, fingerprint: request.fingerprint };
    for (const key of CONTEXT[request.kind]) context[key] = key === 'question_id' ? action.question_id : request[key];
    const segment = action.form === 'decision.yes' ? YES[request.kind](action)
      : action.form === 'decision.no' ? (request.kind === 'grill_round' ? `${action.question_id} no` : 'no') : action.words;
    return `openwiz decision answer v1\n${JSON.stringify(context)}\n\n${segment}`;
  }

  function precheck(action) {
    if (notAForm(action)) return 'not_a_form';
    const picked = OW.data.repo.get();
    if (!picked || action.item.repository !== picked.full) return 'other_repository';
    if (action.item.type === 'decision') {
      const request = action.item.request;
      if (!requestShape(request)) return 'unreadable';
      if (request.status !== 'open') return 'not_open';
      if (action.item.current !== true) return 'not_current';
      if (!RISKS.includes(request.risk)) return 'risk_unknown';
      if (request.kind === 'grill_round' && (!request.questions.some(q => q?.id === action.question_id)
        || request.answered.includes(action.question_id) || typeof action.question_id !== 'string')) return 'answered';
    }
    if (own(action, 'words') && (typeof action.words !== 'string' || !/\S/.test(action.words))) return 'empty';
    const body = bodyOf(action);
    if (refusedForm(body)) return 'refused_form';
    if (body.length > LONGEST) return 'too_long';
    return null;
  }

  async function read(path) {
    const response = await writer.github('GET', path);
    OW.data.noteLimit(null, response);
    if (!response.ok) return null;
    return { json: await response.json().catch(() => undefined), response };
  }
  async function pages(path) {
    const items = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const got = await read(`${path}?per_page=100&page=${page}`);
      if (!got || !Array.isArray(got.json)) return { items, complete: false };
      items.push(...got.json);
      if (!/rel="next"/.test(got.response.headers.get('Link') || '')) return { items, complete: true };
    }
    return { items, complete: false };
  }
  async function sha256(bytes) {
    const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function latest(source) {
    if (!source.startsWith('# Grill: ') || source.includes('\r')) return null;
    let selected = null;
    let previous = 0;
    for (const section of source.split(/^## /m).slice(1)) {
      const [heading, ...rest] = section.split('\n');
      if (heading.startsWith('Round ')) {
        const m = heading.match(/^Round ([1-9][0-9]*)$/);
        if (!m || Number(m[1]) <= previous) return null;
        previous = Number(m[1]);
        selected = { kind: 'grill_round', round: previous, rest };
      } else if (heading.startsWith('Summary')) {
        if (!/^Summary(?:, corrected)?(?: \(shown to .+ for confirmation\))?$/.test(heading)) return null;
        selected = { kind: 'grill_confirmation', rest };
      }
    }
    if (!selected || !selected.rest.length) return null;
    const first = selected.rest[0];
    const risk = first.startsWith('Risk: ') && RISKS.includes(first.slice(6)) ? first.slice(6) : 'unknown';
    const wording = first.startsWith('Risk:') ? selected.rest.slice(1) : selected.rest;
    if (wording.some(l => /^(Risk:|```|~~~)/.test(l.trimStart()))) return null;
    const proposal = [];
    for (const line of wording) { if (line.startsWith('**') && line.endsWith(':**')) break; proposal.push(line); }
    if (selected.kind === 'grill_confirmation') {
      const summary = [];
      for (const line of proposal.filter(Boolean)) {
        const prefix = `${summary.length + 1}. `;
        if (!line.startsWith(prefix) || line.length === prefix.length) return null;
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
        if (!m) return null;
        pending = { id: m[1], decides: m[2], context: m[3] };
      } else if (line.startsWith('➡️ ')) {
        questions.push({ ...pending, recommendation: line.slice(3) });
        pending = null;
      } else pending.context += `\n${line}`;
    }
    if (pending || questions.length < 1 || questions.length > 3) return null;
    return { kind: selected.kind, risk, round: selected.round, questions };
  }
  const untick = body => `${body}\n`.split('\n').map(l => l.replace(/^([ \t]*[-*+][ \t]+)\[[xX]\]$/, '$1[ ]')
    .replace(/^([ \t]*[-*+][ \t]+)\[[xX]\]([ \t\r])/, '$1[ ]$2')).join('\n');
  function headline(body) {
    const section = String(body ?? '').split(/^## /m).find(part => part.startsWith('Changelog headline\n'));
    return section?.split('\n').slice(1).find(line => line.trim()) ?? null;
  }
  const GRILL_FILE = /^docs\/grills\/[A-Za-z0-9][A-Za-z0-9_.-]*\.md$/;
  function base64Bytes(text) {
    const raw = atob(String(text).replace(/\s+/g, ''));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }

  async function sourceCheck(item) {
    const unchecked = { result: 'unchecked' };
    try {
      if (!writer) return unchecked;
      const authors = OW.factory?.recordAuthors(OW.data.feeds.specs.data?.fleet?.text);
      const picked = OW.data.repo.get();
      const r = item.request;
      if (!authors || !picked || picked.full !== item.repository || !requestShape(r)) return unchecked;
      const R = `/repos/${encodeURIComponent(picked.owner)}/${encodeURIComponent(picked.name)}`;
      const comment = await read(`${R}/issues/comments/${item.comment_id}`);
      if (!object(comment?.json)) return unchecked;
      const c = comment.json;
      let read1;
      try { read1 = OW.factory.readRecord(c.body, item.subject.number); } catch { read1 = null; }
      let fine = c.issue_url === `${API}${R}/issues/${item.subject.number}` && typeof c.user?.login === 'string'
        && authors.has(c.user.login.toLowerCase()) && Boolean(read1?.record) && same(read1.record, r);
      let binding;
      if (r.kind === 'grill_round' || r.kind === 'grill_confirmation') {
        if (item.subject.kind !== 'pull_request' || !GRILL_FILE.test(r.grill_file)) return { result: 'changed' };
        const pull = await read(`${R}/pulls/${item.subject.number}`);
        const sha = pull?.json?.head?.sha;
        if (!object(pull?.json) || typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) return unchecked;
        const file = await read(`${R}/contents/${r.grill_file}?ref=${sha}`);
        if (file?.json?.encoding !== 'base64' || typeof file.json.content !== 'string') return unchecked;
        let bytes;
        let saved;
        try {
          bytes = base64Bytes(file.json.content);
          saved = latest(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        } catch { return unchecked; }
        if (!saved) return unchecked;
        const want = r.kind === 'grill_round' ? { kind: r.kind, risk: r.risk, round: r.round, questions: r.questions }
          : { kind: r.kind, risk: r.risk, summary: r.summary };
        fine = fine && pull.json.state === 'open' && pull.json.head?.repo?.full_name === item.repository && same(saved, want);
        binding = { ref: sha, digest: await sha256(bytes) };
      } else {
        if (item.subject.kind !== 'issue') return { result: 'changed' };
        const spec = await read(`${R}/issues/${r.spec}`);
        if (!object(spec?.json) || typeof spec.json.body !== 'string') return unchecked;
        fine = fine && spec.json.state === 'open' && headline(spec.json.body) === r.headline;
        binding = { ref: 'issue', digest: await sha256(spec.json.body) };
        if (r.kind === 'plan_approval') {
          const subs = await pages(`${R}/issues/${r.spec}/sub_issues`);
          if (!subs.complete || !subs.items.every(t => positive(t?.number) && typeof t.title === 'string')) return unchecked;
          const tickets = [];
          for (const t of [...subs.items].sort((a, b) => a.number - b.number)) {
            const by = await pages(`${R}/issues/${t.number}/dependencies/blocked_by`);
            if (!by.complete || !by.items.every(b => positive(b?.number))) return unchecked;
            tickets.push({ number: t.number, title: t.title, body: t.body ?? '', blockers: by.items.map(b => b.number).sort((a, b) => a - b) });
          }
          const lines = ['plan-graph revision v2', `spec #${r.spec} body sha256 ${await sha256(untick(spec.json.body))}`];
          for (const t of tickets) {
            lines.push(`ticket #${t.number} blocked-by ${t.blockers.map(b => `#${b}`).join(' ') || 'none'} body sha256 ${await sha256(untick(t.body))} title ${t.title}`);
          }
          const revision = await sha256(`${lines.join('\n')}\n`);
          fine = fine && same(tickets.map(({ number, title, blockers }) => ({ number, title, blockers })), r.tickets) && revision === r.fingerprint;
          binding = { ref: 'revision-v2', digest: revision };
        }
      }
      return fine ? { result: 'matched', binding } : { result: 'changed' };
    } catch {
      return unchecked;
    }
  }

  const verified = new Map();
  const verifiedKey = item => `${item.repository}#${item.subject.number}:${item.comment_id}:${item.request?.id}`;
  async function check(item) {
    if (!object(item) || item.type !== 'decision' || !itemShape(item, 'decision')) return { result: 'unchecked', checked_at: null };
    const got = await sourceCheck(item);
    if (got.result === 'matched') verified.set(verifiedKey(item), got.binding);
    else verified.delete(verifiedKey(item));
    return { ...got, checked_at: got.result === 'unchecked' ? null : Date.now() };
  }

  const issued = new WeakMap();
  const usedTaps = new WeakSet();
  const inflight = new Map();

  function freeze(preview) {
    Object.freeze(preview.subject);
    if (preview.source) Object.freeze(preview.source);
    return Object.freeze(preview);
  }
  function issue(preview, item) {
    freeze(preview);
    issued.set(preview, { snapshot: JSON.stringify(preview), item, confirmed: 0 });
    return preview;
  }

  async function compose(action) {
    const reason = precheck(action);
    if (reason) return { refused: reason };
    const { item } = action;
    let source = null;
    if (item.type === 'decision') {
      const got = await sourceCheck(item);
      if (got.result === 'changed') return { refused: 'source_changed' };
      if (got.result !== 'matched') return { refused: 'source_unchecked' };
      const known = verified.get(verifiedKey(item));
      if (!known) return { refused: 'source_unchecked' };
      if (!same(known, got.binding)) return { refused: 'source_changed' };
      source = got.binding;
    }
    const picked = OW.data.repo.get();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const preview = {
      op: `op-${[...bytes].map(b => b.toString(16).padStart(2, '0')).join('')}`,
      form: action.form, body: bodyOf(action), repository: item.repository,
      subject: { kind: item.subject.kind, number: item.subject.number }, url: item.url.replace(/#.*$/, ''),
      visibility: picked.private === true ? 'repository' : 'public',
      confirms: item.type === 'decision' && item.request.risk !== 'ordinary' ? 2 : 1,
      source,
    };
    return issue(preview, structuredClone(item));
  }

  function confirm(preview, event) {
    const state = issued.get(preview);
    const of = state ? preview.confirms : 0;
    if (!state) return { confirmed: 0, of };
    if (typeof Event === 'function' && event instanceof Event && event.isTrusted === true && event.type === 'click'
      && !usedTaps.has(event) && state.confirmed < preview.confirms) {
      usedTaps.add(event);
      state.confirmed += 1;
    }
    return { confirmed: state.confirmed, of };
  }

  function session() { return OW.data.auth.session(); }
  function cachedAccount() {
    try {
      const kept = JSON.parse(localStorage.getItem(ACCOUNT_KEY));
      return kept && kept.session === session() && positive(kept.id) ? kept.id : null;
    } catch { return null; }
  }
  let reading = null;
  async function account() {
    const known = cachedAccount();
    if (known) return known;
    const mine = session();
    if (!mine) return null;
    if (reading?.session !== mine) {
      reading = { session: mine, run: read('/user').then(got => {
        if (!positive(got?.json?.id) || session() !== mine) return null;
        localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ session: mine, id: got.json.id }));
        return got.json.id;
      }).catch(() => null).finally(() => { if (reading?.session === mine) reading = null; }) };
    }
    return reading.run;
  }
  function receipts(id) {
    try {
      const all = JSON.parse(localStorage.getItem(`${RECEIPTS}${id}`));
      return object(all) ? all : {};
    } catch { return {}; }
  }
  function save(id, op, receipt) {
    localStorage.setItem(`${RECEIPTS}${id}`, JSON.stringify({ ...receipts(id), [op]: receipt }));
  }

  function commentsPath(preview) {
    const picked = OW.data.repo.get();
    return `/repos/${encodeURIComponent(picked.owner)}/${encodeURIComponent(picked.name)}/issues/${preview.subject.number}/comments`;
  }

  async function reconcile(preview, id, prior) {
    const op = preview.op;
    const list = await pages(commentsPath(preview));
    const ours = list.items.filter(c => object(c) && c.user?.id === id && c.body === preview.body && positive(c.id));
    if (prior) {
      const claimed = new Set(Object.entries(receipts(id)).filter(([key]) => key !== op).map(([, r]) => r?.comment?.id).filter(Boolean));
      const earlier = new Set(Array.isArray(prior.before) ? prior.before : []);
      const found = ours.find(c => !claimed.has(c.id) && !earlier.has(c.id) && Date.parse(c.created_at) >= prior.sent_at - SKEW);
      if (found) {
        const comment = { id: found.id, url: found.html_url };
        save(id, op, { ...prior, state: 'posted', comment });
        return { outcome: { outcome: 'posted', op, comment } };
      }
      if (!list.complete) {
        save(id, op, { ...prior, state: 'unknown' });
        return { outcome: { outcome: 'unknown', op, reason: 'incomplete' } };
      }
    } else if (!list.complete) {
      return { outcome: refused(op, 'source_unchecked') };
    }
    return { before: ours.map(c => c.id) };
  }

  async function send(preview, state, id, before) {
    const op = preview.op;
    const path = commentsPath(preview);
    save(id, op, { op, body: preview.body, repository: preview.repository, subject: preview.subject, source: preview.source,
      preview, item: state.item, state: 'sending', sent_at: Date.now(), before });
    let response;
    try {
      response = await writer.github('POST', path, { body: preview.body });
    } catch (error) {
      if (error instanceof OW.data.Refused) {
        save(id, op, { ...receipts(id)[op], state: 'refused' });
        return refused(op, 'disabled');
      }
      if (error instanceof OW.data.SignedOut || error instanceof OW.data.Ended) {
        save(id, op, { ...receipts(id)[op], state: 'unknown' });
        return { outcome: 'unknown', op, reason: 'signed_out' };
      }
      save(id, op, { ...receipts(id)[op], state: 'unknown' });
      return { outcome: 'unknown', op, reason: 'network' };
    }
    OW.data.noteLimit(null, response);
    if (response.status >= 200 && response.status < 300) {
      const body = await response.json().catch(() => null);
      if (positive(body?.id) && typeof body.html_url === 'string') {
        const comment = { id: body.id, url: body.html_url };
        save(id, op, { ...receipts(id)[op], state: 'posted', comment });
        return { outcome: 'posted', op, comment };
      }
      save(id, op, { ...receipts(id)[op], state: 'unknown' });
      return { outcome: 'unknown', op, reason: 'unreadable' };
    }
    if (response.status >= 400 && response.status < 500) {
      save(id, op, { ...receipts(id)[op], state: 'refused' });
      return refused(op, 'github');
    }
    save(id, op, { ...receipts(id)[op], state: 'unknown' });
    return { outcome: 'unknown', op, reason: 'server' };
  }

  async function run(preview, state) {
    const op = preview.op;
    const id = await account();
    if (!id) return refused(op, 'signed_out');
    const all = receipts(id);
    const saved = all[op];
    if (saved?.state === 'posted') return { outcome: 'posted', op, comment: saved.comment };
    if (state.outcome?.outcome === 'posted') return state.outcome;
    if (state.confirmed < preview.confirms) return refused(op, 'not_confirmed');
    state.confirmed = 0;
    const other = Object.values(all).find(r => object(r) && r.op !== op && PENDING.includes(r.state)
      && r.repository === preview.repository && same(r.subject, preview.subject));
    if (other) return refused(op, 'pending');
    const prior = saved && PENDING.includes(saved.state) ? saved : null;
    const read1 = await reconcile(preview, id, prior);
    if (read1.outcome) return (state.outcome = read1.outcome);
    if (state.item.type === 'decision') {
      const got = await sourceCheck(state.item);
      const reason = got.result === 'unchecked' ? 'source_unchecked'
        : got.result !== 'matched' || !same(got.binding, preview.source) ? 'source_changed' : null;
      if (reason) {
        if (prior) save(id, op, { ...prior, state: reason === 'source_changed' ? 'retired' : 'unknown' });
        return refused(op, reason);
      }
    }
    const outcome = await send(preview, state, id, read1.before);
    state.outcome = outcome;
    return outcome;
  }

  function post(preview) {
    const state = issued.get(preview);
    const op = typeof preview?.op === 'string' ? preview.op : null;
    if (!state || state.snapshot !== JSON.stringify(preview)) return Promise.resolve(refused(op, 'not_composed'));
    const now = mode();
    if (now === 'off') return Promise.resolve(refused(op, 'disabled'));
    if (now === 'dry-run') return Promise.resolve(refused(op, 'dry_run'));
    if (!OW.data.auth.signedIn()) return Promise.resolve(refused(op, 'signed_out'));
    const picked = OW.data.repo.get();
    if (!picked || picked.full !== preview.repository) return Promise.resolve(refused(op, 'not_composed'));
    if (inflight.has(op)) return inflight.get(op);
    const promise = run(preview, state).catch(() => ({ outcome: 'unknown', op, reason: 'failed' }))
      .finally(() => { if (inflight.get(op) === promise) inflight.delete(op); });
    inflight.set(op, promise);
    return promise;
  }

  function pending() {
    const id = cachedAccount();
    if (!id) return [];
    return Object.values(receipts(id))
      .filter(r => object(r) && PENDING.includes(r.state) && object(r.preview) && r.preview.op === r.op && object(r.item))
      .sort((a, b) => (a.sent_at || 0) - (b.sent_at || 0))
      .map(r => issue({ ...r.preview, subject: { ...r.preview.subject }, source: r.preview.source ? { ...r.preview.source } : null }, r.item));
  }

  OW.records = {
    enabled: () => mode() !== 'off',
    dryRun: () => mode() === 'dry-run',
    compose, confirm, post, pending, check,
  };
  if (mode() !== 'off' && OW.data.auth.signedIn()) account();
})();
