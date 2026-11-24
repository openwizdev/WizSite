'use strict';
(() => {
  const writer = window.OW.data.claim();
  const OW = window.OW;
  const API = 'https://api.github.com';
  const lockRequest = (() => {
    try { return typeof navigator.locks?.request === 'function' ? navigator.locks.request.bind(navigator.locks) : null; } catch { return null; }
  })();
  const eventType = (() => {
    try { return Object.getOwnPropertyDescriptor(Event.prototype, 'type')?.get ?? null; } catch { return null; }
  })();
  const random = bytes => crypto.getRandomValues(bytes);
  const SKEW = 5 * 60 * 1000;
  const LONGEST = 65536;
  const MAX_PAGES = 50;
  const RISKS = ['ordinary', 'live', 'release', 'publish'];
  const RECEIPTS = 'openwiz.app.v2.receipts.';
  const PENDING = ['sending', 'unknown'];
  const TERMINAL = ['refused', 'retired'];
  const STATES = [...PENDING, 'posted', ...TERMINAL];
  const REASONS = ['dry_run', 'disabled', 'not_composed', 'not_confirmed', 'signed_out', 'pending', 'source_changed', 'source_unchecked', 'github'];
  const OP = /^op-[0-9a-f]{32}$/;

  const FIELDS = {
    'decision.yes': ['form', 'item'],
    'decision.no': ['form', 'item'],
    'decision.own': ['form', 'item', 'words'],
    'spec.ship': ['form', 'item'],
    'spec.not_now': ['form', 'item'],
    'spec.change': ['form', 'item', 'words'],
  };
  const COMMON = ['schema', 'kind', 'id', 'status', 'fingerprint', 'risk'];
  const KEYS = {
    grill_round: [...COMMON, 'grill_file', 'round', 'questions', 'answered'],
    grill_confirmation: [...COMMON, 'grill_file', 'summary'],
    spec_confirmation: [...COMMON, 'spec', 'summary', 'headline', 'tickets', 'graph'],
    plan_approval: [...COMMON, 'spec', 'summary', 'headline', 'tickets', 'graph'],
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
  const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
  const QUESTION = /^[A-Z]{1,2}[1-9][0-9]*$/;
  const GRILL_FILE = /^docs\/grills\/[A-Za-z0-9][A-Za-z0-9_.-]*\.md$/;

  const own = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const positive = n => Number.isSafeInteger(n) && n > 0;
  const text = v => typeof v === 'string' && v.length > 0;
  const matches = (v, pattern) => typeof v === 'string' && pattern.test(v);
  const exactly = (o, keys) => object(o) && Object.keys(o).length === keys.length && keys.every(k => own(o, k));
  const same = (a, b) => canonical(a) === canonical(b);
  function canonical(v) {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (object(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
    return JSON.stringify(v) ?? 'undefined';
  }
  function frozen(v) {
    if (v !== null && typeof v === 'object') {
      for (const key of Object.keys(v)) frozen(v[key]);
      Object.freeze(v);
    }
    return v;
  }
  function snapshot(v) {
    try { return frozen(structuredClone(v)); } catch { return null; }
  }
  const refused = (op, reason) => ({ outcome: 'refused', op, reason });
  const unknown = (op, reason) => ({ outcome: 'unknown', op, reason });
  const mode = () => (writer && lockRequest ? OW.data.v2.get() : 'off');

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
  const lines = v => Array.isArray(v) && v.length >= 1 && v.length <= 10 && v.every(line => text(line) && !/[\r\n]/.test(line));
  function requestShape(r) {
    if (!object(r) || typeof r.kind !== 'string' || !own(KEYS, r.kind) || !exactly(r, KEYS[r.kind])) return false;
    if (r.schema !== 'openwiz.decisions.v1' || !matches(r.id, IDENTIFIER) || !['open', 'resolved', 'superseded'].includes(r.status)
      || !matches(r.fingerprint, /^[0-9a-f]{64}$/) || ![...RISKS, 'unknown'].includes(r.risk)) return false;
    if (r.kind === 'grill_round') {
      if (!matches(r.grill_file, GRILL_FILE) || !positive(r.round) || !Array.isArray(r.questions) || r.questions.length < 1 || r.questions.length > 3) return false;
      const ids = [];
      for (const q of r.questions) {
        if (!exactly(q, ['id', 'decides', 'context', 'recommendation']) || !Object.values(q).every(text) || !QUESTION.test(q.id) || ids.includes(q.id)) return false;
        ids.push(q.id);
      }
      const answered = r.answered;
      return Array.isArray(answered) && same(answered, ids.filter(id => answered.includes(id)))
        && (r.status === 'superseded' || (r.status === 'resolved') === same(answered, ids));
    }
    if (r.kind === 'grill_confirmation') return matches(r.grill_file, GRILL_FILE) && lines(r.summary);
    const tickets = Array.isArray(r.tickets) && (r.kind === 'spec_confirmation' ? r.tickets.length === 0
      : r.tickets.every((t, i) => exactly(t, ['number', 'title', 'blockers']) && positive(t.number) && text(t.title)
        && (i === 0 || r.tickets[i - 1].number < t.number) && Array.isArray(t.blockers)
        && t.blockers.every((b, j) => positive(b) && b !== t.number && (j === 0 || t.blockers[j - 1] < b))));
    const graph = Array.isArray(r.graph) && (r.kind === 'spec_confirmation' ? r.graph.length === 0
      : r.graph.every(e => exactly(e, ['blocker', 'ticket']) && positive(e.blocker) && positive(e.ticket)));
    return positive(r.spec) && lines(r.summary) && text(r.headline) && tickets && graph;
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

  function precheck(action, picked) {
    if (notAForm(action)) return 'not_a_form';
    if (picked !== undefined && (!object(picked) || action.item.repository !== picked.full)) return 'other_repository';
    if (action.item.type === 'decision') {
      const request = action.item.request;
      if (!requestShape(request)) return 'unreadable';
      if (request.status !== 'open') return 'not_open';
      if (action.item.current !== true) return 'not_current';
      if (!RISKS.includes(request.risk)) return 'risk_unknown';
      if (request.kind === 'grill_round' && (typeof action.question_id !== 'string' || !request.questions.some(q => q.id === action.question_id)
        || request.answered.includes(action.question_id))) return 'answered';
    }
    if (own(action, 'words') && (typeof action.words !== 'string' || !/\S/.test(action.words))) return 'empty';
    const body = bodyOf(action);
    if (refusedForm(body)) return 'refused_form';
    if (body.length > LONGEST) return 'too_long';
    return null;
  }
  function build(action, op, visibility, source) {
    const { item } = action;
    return {
      op, form: action.form, body: bodyOf(action), repository: item.repository,
      subject: { kind: item.subject.kind, number: item.subject.number }, url: item.url.replace(/#.*$/, ''), visibility,
      confirms: item.type === 'decision' && item.request.risk !== 'ordinary' ? 2 : 1,
      source,
    };
  }

  function context() {
    const kept = OW.data.auth.get();
    const picked = OW.data.repo.get();
    const account = OW.data.auth.account();
    if (!kept?.token || typeof kept.session !== 'string' || !account || !object(picked)) return null;
    return { session: kept.session, account, owner: picked.owner, name: picked.name, full: picked.full };
  }
  async function read(pin, path) {
    let response;
    try { response = await writer.read(pin, path); } catch { return null; }
    OW.data.noteLimit(null, response);
    if (!response.ok) return null;
    return { json: await response.json().catch(() => undefined), response };
  }
  function sameListUrl(rawUrl, pin, path) {
    let url;
    try { url = new URL(rawUrl); } catch { return null; }
    const repoPath = `/repos/${pin.owner}/${pin.name}${path}`;
    const idPath = url.pathname.startsWith('/repositories/') && url.pathname.endsWith(path)
      && /^[1-9][0-9]*$/.test(url.pathname.slice('/repositories/'.length, url.pathname.length - path.length));
    if (url.origin !== API || url.hash || !(url.pathname === repoPath || idPath)) return null;
    if (![...url.searchParams.keys()].every(k => k === 'per_page' || k === 'page')) return null;
    if (url.searchParams.getAll('page').length !== 1 || url.searchParams.getAll('per_page').length > 1) return null;
    if (url.searchParams.has('per_page') && !matches(url.searchParams.get('per_page'), /^[1-9][0-9]*$/)) return null;
    const rawPage = url.searchParams.get('page');
    if (!matches(rawPage, /^[1-9][0-9]*$/)) return null;
    const num = Number(rawPage);
    return Number.isSafeInteger(num) ? num : null;
  }
  function following(response, pin, path, page) {
    const header = response.headers.get('Link');
    if (header === null) return 'done';
    if (!header.trim()) return 'unreadable';
    const rels = new Map();
    for (const part of header.split(',')) {
      const m = part.match(/^\s*<([^<>]+)>\s*;\s*rel="(prev|next|last|first)"\s*$/);
      if (!m || rels.has(m[2])) return 'unreadable';
      const target = sameListUrl(m[1], pin, path);
      if (target === null) return 'unreadable';
      rels.set(m[2], target);
    }
    if (rels.has('prev') && rels.get('prev') !== page - 1) return 'unreadable';
    if (rels.has('first') && rels.get('first') !== 1) return 'unreadable';
    if (rels.has('next')) {
      if (rels.get('next') !== page + 1) return 'unreadable';
      if (rels.has('last') && rels.get('last') < page + 1) return 'unreadable';
      return 'next';
    }
    if (rels.has('last') && rels.get('last') > page) return 'unreadable';
    return 'done';
  }
  async function pages(pin, path, readable) {
    const items = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const got = await read(pin, `${path}?per_page=100&page=${page}`);
      if (!got || !Array.isArray(got.json) || !got.json.every(readable)) return { items, complete: false };
      items.push(...got.json);
      const next = following(got.response, pin, path, page);
      if (next !== 'next') return { items, complete: next === 'done' };
    }
    return { items, complete: false };
  }
  const readableComment = c => object(c) && positive(c.id) && object(c.user) && positive(c.user.id) && typeof c.user.login === 'string'
    && typeof c.body === 'string' && typeof c.created_at === 'string' && Number.isFinite(Date.parse(c.created_at)) && typeof c.html_url === 'string';
  async function sha256(bytes) {
    const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const PY_SPACE = /^[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;
  function latest(source) {
    if (!source.startsWith('# Grill: ') || source.includes('\r')) return null;
    const starts = [];
    for (let at = source.indexOf('## '); at >= 0; at = source.indexOf('## ', at + 1)) if (at === 0 || source[at - 1] === '\n') starts.push(at);
    let selected = null;
    let previous = 0;
    for (const [i, at] of starts.entries()) {
      const [heading, ...rest] = source.slice(at + 3, starts[i + 1] ?? source.length).split('\n');
      if (heading.startsWith('Round ')) {
        const m = heading.match(/^Round ([1-9][0-9]*)$/);
        if (!m || !Number.isSafeInteger(Number(m[1])) || Number(m[1]) <= previous) return null;
        previous = Number(m[1]);
        selected = { kind: 'grill_round', round: previous, rest };
      } else if (heading.startsWith('Summary')) {
        if (!/^Summary(?:, corrected)?(?: \(shown to [^\n]+ for confirmation\))?$/.test(heading)) return null;
        selected = { kind: 'grill_confirmation', rest };
      }
    }
    if (!selected || !selected.rest.length) return null;
    const first = selected.rest[0];
    const risk = first.startsWith('Risk: ') && RISKS.includes(first.slice(6)) ? first.slice(6) : 'unknown';
    const wording = first.startsWith('Risk:') ? selected.rest.slice(1) : selected.rest;
    if (wording.some(l => /^(Risk:|```|~~~)/.test(l.replace(PY_SPACE, '')))) return null;
    const proposal = [];
    for (const line of wording) { if (line.startsWith('**') && line.endsWith(':**')) break; proposal.push(line); }
    if (selected.kind === 'grill_confirmation') {
      const summary = [];
      for (const line of proposal.filter(Boolean)) {
        const prefix = `${summary.length + 1}. `;
        if (!line.startsWith(prefix) || line.length === prefix.length) return null;
        summary.push(line.slice(prefix.length));
      }
      return summary.length >= 1 && summary.length <= 10 ? { kind: selected.kind, risk, summary } : null;
    }
    const questions = [];
    let pending = null;
    for (const line of proposal) {
      if (!pending) {
        if (!line) continue;
        const m = line.match(/^\*\*([A-Z]{1,2}[1-9][0-9]*)(?:, re-asked)? - ([^\n]+?)\*\* ([^\n]*)$/);
        if (!m) return null;
        pending = { id: m[1], decides: m[2], context: m[3] };
      } else if (line.startsWith('➡️ ')) {
        if (!pending.context || !line.slice(3)) return null;
        questions.push({ ...pending, recommendation: line.slice(3) });
        pending = null;
      } else {
        if (line.startsWith('**')) return null;
        pending.context += `\n${line}`;
      }
    }
    if (pending || questions.length < 1 || questions.length > 3 || new Set(questions.map(q => q.id)).size !== questions.length) return null;
    return { kind: selected.kind, risk, round: selected.round, questions };
  }
  function strictBase64(content) {
    const plain = content.replace(/\n/g, '');
    if (plain.length % 4 || !/^[A-Za-z0-9+/]*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(plain)) return null;
    return Uint8Array.from(atob(plain), c => c.charCodeAt(0));
  }
  const untick = body => `${body}\n`.split('\n').map(l => l.replace(/^([ \t]*[-*+][ \t]+)\[[xX]\]$/, '$1[ ]')
    .replace(/^([ \t]*[-*+][ \t]+)\[[xX]\]([ \t\r])/, '$1[ ]$2')).join('\n');
  function headline(body) {
    const section = String(body ?? '').split(/^## /m).find(part => part.startsWith('Changelog headline\n'));
    return section?.split('\n').slice(1).find(line => line.trim()) ?? null;
  }
  const SPEC_EDIT = 'query SpecEdit($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { lastEditedAt } } }';
  async function lastEdited(pin, number) {
    const response = await writer.query(pin, SPEC_EDIT, { owner: pin.owner, name: pin.name, number });
    OW.data.noteLimit(null, response);
    const answer = response.ok ? await response.json().catch(() => null) : null;
    const issue = answer?.data?.repository?.issue;
    if (!object(issue) || answer.errors !== undefined || !own(issue, 'lastEditedAt')) return undefined;
    if (issue.lastEditedAt === null) return null;
    const at = typeof issue.lastEditedAt === 'string' ? Date.parse(issue.lastEditedAt) : NaN;
    return Number.isFinite(at) ? at : undefined;
  }

  const authors = () => OW.factory?.recordAuthors(OW.data.feeds.specs.data?.fleet?.text) ?? null;
  async function sourceCheck(pin, item) {
    const unchecked = { result: 'unchecked' };
    try {
      const writers = authors();
      const r = item.request;
      if (!writer || !writers || pin.full !== item.repository || !requestShape(r)) return unchecked;
      const comment = await read(pin, `/issues/comments/${item.comment_id}`);
      const c = comment?.json;
      if (!object(c) || c.id !== item.comment_id || typeof c.body !== 'string') return unchecked;
      let record;
      try { record = OW.factory.readRecord(c.body, item.subject.number); } catch { record = null; }
      let fine = c.issue_url === `${API}/repos/${pin.owner}/${pin.name}/issues/${item.subject.number}` && typeof c.user?.login === 'string'
        && writers.has(c.user.login.toLowerCase()) && Boolean(record?.record) && same(record.record, r);
      let binding;
      if (r.kind === 'grill_round' || r.kind === 'grill_confirmation') {
        if (item.subject.kind !== 'pull_request') return { result: 'changed' };
        const pull = await read(pin, `/pulls/${item.subject.number}`);
        const sha = pull?.json?.head?.sha;
        if (!object(pull?.json) || !matches(sha, /^[0-9a-f]{40}$/)) return unchecked;
        const file = await read(pin, `/contents/${r.grill_file}?ref=${sha}`);
        const blob = file?.json;
        if (!object(blob) || blob.path !== r.grill_file || blob.encoding !== 'base64' || typeof blob.content !== 'string') return unchecked;
        const bytes = strictBase64(blob.content);
        if (!bytes) return unchecked;
        let saved;
        try { saved = latest(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)); } catch { return unchecked; }
        if (!saved) return unchecked;
        const want = r.kind === 'grill_round' ? { kind: r.kind, risk: r.risk, round: r.round, questions: r.questions }
          : { kind: r.kind, risk: r.risk, summary: r.summary };
        fine = fine && pull.json.state === 'open' && pull.json.head?.repo?.full_name === item.repository && same(saved, want);
        binding = { ref: sha, digest: await sha256(bytes) };
      } else {
        if (item.subject.kind !== 'issue') return { result: 'changed' };
        const spec = await read(pin, `/issues/${r.spec}`);
        if (!object(spec?.json) || typeof spec.json.body !== 'string') return unchecked;
        fine = fine && spec.json.state === 'open' && headline(spec.json.body) === r.headline;
        binding = { ref: 'issue', digest: await sha256(spec.json.body) };
        if (r.kind === 'spec_confirmation') {
          const edited = await lastEdited(pin, r.spec);
          const posted = Date.parse(c.created_at);
          if (edited === undefined || !Number.isFinite(posted) || edited === posted) return unchecked;
          fine = fine && (edited === null || edited < posted);
        }
        if (r.kind === 'plan_approval') {
          const subs = await pages(pin, `/issues/${r.spec}/sub_issues`, t => object(t) && positive(t.number) && typeof t.title === 'string');
          if (!subs.complete) return unchecked;
          const tickets = [];
          for (const t of [...subs.items].sort((a, b) => a.number - b.number)) {
            const by = await pages(pin, `/issues/${t.number}/dependencies/blocked_by`, b => object(b) && positive(b.number));
            if (!by.complete) return unchecked;
            tickets.push({ number: t.number, title: t.title, body: t.body ?? '', blockers: by.items.map(b => b.number).sort((a, b) => a - b) });
          }
          const revision = ['plan-graph revision v2', `spec #${r.spec} body sha256 ${await sha256(untick(spec.json.body))}`];
          for (const t of tickets) {
            revision.push(`ticket #${t.number} blocked-by ${t.blockers.map(b => `#${b}`).join(' ') || 'none'} body sha256 ${await sha256(untick(t.body))} title ${t.title}`);
          }
          const digest = await sha256(`${revision.join('\n')}\n`);
          fine = fine && same(tickets.map(({ number, title, blockers }) => ({ number, title, blockers })), r.tickets) && digest === r.fingerprint;
          binding = { ref: 'revision-v2', digest };
        }
      }
      return fine ? { result: 'matched', binding } : { result: 'changed' };
    } catch {
      return unchecked;
    }
  }
  function conversationCheck(list, item) {
    const writers = authors();
    const r = item.request;
    const at = list.items.findIndex(c => c.id === item.comment_id);
    if (!writers || at < 0) return 'source_unchecked';
    for (const [i, c] of list.items.entries()) {
      if (!writers.has(c.user.login.toLowerCase())) continue;
      let got;
      try { got = OW.factory.readRecord(c.body, item.subject.number); } catch { got = { malformed: true }; }
      if (!got) continue;
      if (i === at) {
        if (!got.record || !same(got.record, r)) return 'source_changed';
        continue;
      }
      if (got.record?.id === r.id) return 'source_unchecked';
      if (i < at) continue;
      if (!got.record) return 'source_unchecked';
      const sameSource = r.kind === 'grill_round' || r.kind === 'grill_confirmation' ? got.record.grill_file === r.grill_file : got.record.spec === r.spec;
      if (got.record.kind === r.kind && sameSource) return 'source_changed';
    }
    return null;
  }

  const verified = new Map();
  const verifiedKey = item => `${item.repository}#${item.subject.number}:${item.comment_id}:${item.request?.id}`;
  const itemCanon = item => canonical({ key: item.key, repository: item.repository, subject: item.subject, comment_id: item.comment_id, url: item.url, request: item.request });
  let checks = 0;
  let stamped = 0;
  async function check(item) {
    const snap = snapshot(item);
    const pin = context();
    if (!snap || !itemShape(snap, 'decision')) return { result: 'unchecked', binding: null, checked_at: null };
    const key = verifiedKey(snap);
    const seq = ++checks;
    if (!pin) {
      if (!(verified.get(key)?.seq > seq)) verified.set(key, frozen({ seq, binding: null }));
      return { result: 'unchecked', binding: null, checked_at: null };
    }
    const got = await sourceCheck(pin, snap);
    if (verified.get(key)?.seq > seq) return { result: 'unchecked', binding: null, checked_at: null };
    const checkedAt = got.result === 'unchecked' ? null : (stamped = Math.max(Date.now(), stamped + 1));
    if (got.result === 'matched') {
      verified.set(key, frozen({ seq, binding: { ...got.binding }, checked_at: checkedAt, session: pin.session, account: pin.account, item: itemCanon(snap) }));
    } else {
      verified.set(key, frozen({ seq, binding: null }));
    }
    return { result: got.result, binding: got.result === 'matched' ? { ...got.binding } : null, checked_at: checkedAt };
  }

  const issued = new WeakMap();
  const usedTaps = new WeakSet();
  const inflight = new Map();
  function issue(preview, action) {
    frozen(preview);
    issued.set(preview, { snapshot: JSON.stringify(preview), action, session: OW.data.auth.session(), confirmed: 0 });
    return preview;
  }
  function newOp() {
    return `op-${[...random(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')}`;
  }

  async function compose(action) {
    const snap = snapshot(action);
    if (!snap) return { refused: 'not_a_form' };
    const picked = OW.data.repo.get();
    const reason = precheck(snap, picked);
    if (reason) return { refused: reason };
    const { item } = snap;
    const visibility = picked.private === true ? 'repository' : 'public';
    let source = null;
    if (item.type === 'decision') {
      const kept = verified.get(verifiedKey(item));
      const pin = context();
      if (!pin) return { refused: 'source_unchecked' };
      const ours = kept && kept.session === pin.session && kept.account === pin.account && kept.item === itemCanon(item);
      const got = await sourceCheck(pin, item);
      if (got.result === 'changed') return { refused: 'source_changed' };
      if (got.result !== 'matched' || !ours) return { refused: 'source_unchecked' };
      if (kept.checked_at !== item.checked_at) return { refused: Number.isFinite(item.checked_at) && item.checked_at < kept.checked_at ? 'source_changed' : 'source_unchecked' };
      if (!same(kept.binding, got.binding)) return { refused: 'source_changed' };
      source = { ...kept.binding };
    }
    return issue(build(snap, newOp(), visibility, source), snap);
  }

  function trustedClick(event) {
    try {
      if (!eventType || eventType.call(event) !== 'click') return false;
      const trusted = Object.getOwnPropertyDescriptor(event, 'isTrusted');
      return Boolean(trusted && !trusted.configurable && trusted.get && trusted.get.call(event) === true);
    } catch { return false; }
  }
  function confirm(preview, event) {
    const state = issued.get(preview);
    if (!state) return { confirmed: 0, of: 0 };
    const account = OW.data.auth.account();
    const book = account ? ledger(account) : null;
    if (book && (!book.ok || TERMINAL.includes(book.receipts[preview.op]?.state))) {
      state.confirmed = 0;
      return { confirmed: 0, of: preview.confirms };
    }
    if (trustedClick(event) && !usedTaps.has(event) && state.confirmed < preview.confirms) {
      usedTaps.add(event);
      state.confirmed += 1;
    }
    return { confirmed: state.confirmed, of: preview.confirms };
  }

  function validReceipt(key, r, account) {
    if (!object(r) || r.v !== 1 || r.op !== key || !OP.test(key) || r.account !== account || !STATES.includes(r.state)) return null;
    if (!positive(r.sent_at) || !Array.isArray(r.before) || !r.before.every(positive) || new Set(r.before).size !== r.before.length) return null;
    const action = snapshot(r.action);
    if (!action || precheck(action) !== null || !object(r.preview)) return null;
    const p = r.preview;
    if (!['public', 'repository'].includes(p.visibility)) return null;
    const source = action.item.type === 'spec' ? null
      : exactly(p.source, ['ref', 'digest']) && text(p.source.ref) && matches(p.source.digest, /^[0-9a-f]{64}$/) ? { ...p.source } : undefined;
    if (source === undefined || canonical(build(action, key, p.visibility, source)) !== canonical(p)) return null;
    if (r.state === 'posted' && !(exactly(r.comment, ['id', 'url']) && positive(r.comment.id) && typeof r.comment.url === 'string')) return null;
    if (TERMINAL.includes(r.state) && !REASONS.includes(r.reason)) return null;
    return frozen({ ...r, action });
  }
  function ledger(account) {
    let all;
    try { all = JSON.parse(localStorage.getItem(`${RECEIPTS}${account}`) ?? '{}'); } catch { return { ok: false }; }
    if (!object(all)) return { ok: false };
    const receipts = {};
    for (const [key, r] of Object.entries(all)) {
      const valid = validReceipt(key, r, account);
      if (!valid) return { ok: false };
      receipts[key] = valid;
    }
    return { ok: true, receipts };
  }
  async function commit(account, op, receipt) {
    return lockRequest(`openwiz.app.v2.ledger.${account}`, () => {
      const book = ledger(account);
      if (!book.ok || !validReceipt(op, receipt, account)) return false;
      localStorage.setItem(`${RECEIPTS}${account}`, JSON.stringify({ ...book.receipts, [op]: receipt }));
      return true;
    }).catch(() => false);
  }

  function reconcile(list, prior, book, account) {
    if (!list.complete) return { unknown: 'incomplete' };
    const claimed = new Set(Object.values(book.receipts).filter(r => r.op !== prior.op && r.comment).map(r => r.comment.id));
    const earlier = new Set(prior.before);
    const found = list.items.filter(c => c.user.id === account && c.body === prior.preview.body && !earlier.has(c.id) && !claimed.has(c.id)
      && Date.parse(c.created_at) >= prior.sent_at - SKEW);
    if (found.length > 1) return { unknown: 'ambiguous' };
    return found.length ? { found: found[0] } : {};
  }
  function notSent(pin) {
    if (OW.data.v2.get() !== 'on') return 'disabled';
    const kept = OW.data.auth.get();
    if (!kept?.token || kept.session !== pin.session || OW.data.auth.account() !== pin.account) return 'signed_out';
    return 'not_composed';
  }

  async function send(preview, state, pin, base) {
    const op = preview.op;
    const save = receipt => commit(pin.account, op, { ...base, ...receipt });
    let response;
    try {
      response = await writer.comment(pin, preview.body);
    } catch (error) {
      if (error instanceof OW.data.Refused || error instanceof OW.data.Ended || error instanceof OW.data.SignedOut) {
        const reason = notSent(pin);
        await save({ state: 'refused', reason });
        return refused(op, reason);
      }
      await save({ state: 'unknown' });
      return unknown(op, 'network');
    }
    OW.data.noteLimit(null, response);
    if (response.status >= 200 && response.status < 300) {
      const body = await response.json().catch(() => null);
      if (positive(body?.id) && typeof body.html_url === 'string') {
        const comment = { id: body.id, url: body.html_url };
        await save({ state: 'posted', comment });
        return { outcome: 'posted', op, comment };
      }
      await save({ state: 'unknown' });
      return unknown(op, 'unreadable');
    }
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 500)) {
      await save({ state: 'refused', reason: 'github' });
      return refused(op, 'github');
    }
    await save({ state: 'unknown' });
    return unknown(op, 'server');
  }

  async function locked(preview, state, pin) {
    const op = preview.op;
    const book = ledger(pin.account);
    if (!book.ok) return refused(op, 'pending');
    const saved = book.receipts[op];
    if (saved?.state === 'posted') return { outcome: 'posted', op, comment: { ...saved.comment } };
    if (saved && TERMINAL.includes(saved.state)) return refused(op, saved.reason);
    const other = Object.values(book.receipts).find(r => r.op !== op && PENDING.includes(r.state)
      && r.preview.repository === preview.repository && same(r.preview.subject, preview.subject));
    if (other) return refused(op, 'pending');
    const prior = saved && PENDING.includes(saved.state) ? saved : null;
    let baseline = null;
    if (prior) {
      const list = await pages(pin, `/issues/${pin.number}/comments`, readableComment);
      const found = reconcile(list, prior, book, pin.account);
      if (found.found) {
        const comment = { id: found.found.id, url: found.found.html_url };
        await commit(pin.account, op, { ...prior, state: 'posted', comment });
        return { outcome: 'posted', op, comment };
      }
      if (found.unknown) {
        await commit(pin.account, op, { ...prior, state: 'unknown' });
        return unknown(op, found.unknown);
      }
      baseline = list;
    }
    if (state.action.item.type === 'decision') {
      const got = await sourceCheck(pin, state.action.item);
      let reason = got.result === 'unchecked' ? 'source_unchecked'
        : got.result !== 'matched' || !same(got.binding, preview.source) ? 'source_changed' : null;
      if (!reason) {
        const fresh = await pages(pin, `/issues/${pin.number}/comments`, readableComment);
        if (!fresh.complete) reason = 'source_unchecked';
        else {
          if (prior) {
            const found = reconcile(fresh, prior, book, pin.account);
            if (found.found) {
              const comment = { id: found.found.id, url: found.found.html_url };
              await commit(pin.account, op, { ...prior, state: 'posted', comment });
              return { outcome: 'posted', op, comment };
            }
            if (found.unknown) {
              await commit(pin.account, op, { ...prior, state: 'unknown' });
              return unknown(op, found.unknown);
            }
          }
          reason = conversationCheck(fresh, state.action.item);
          baseline = fresh;
        }
      }
      if (reason) {
        if (prior) await commit(pin.account, op, { ...prior, ...(reason === 'source_changed' ? { state: 'retired', reason } : { state: 'unknown' }) });
        return refused(op, reason);
      }
    } else if (!baseline) {
      baseline = await pages(pin, `/issues/${pin.number}/comments`, readableComment);
      if (!baseline.complete) return refused(op, 'source_unchecked');
    }
    const base = { v: 1, op, account: pin.account, preview: JSON.parse(JSON.stringify(preview)), action: state.action,
      sent_at: Date.now(), before: baseline.items.filter(c => c.user.id === pin.account && c.body === preview.body).map(c => c.id) };
    if (!(await commit(pin.account, op, { ...base, state: 'sending' }))) return refused(op, 'pending');
    return send(preview, state, pin, base);
  }

  async function run(preview, state, pin) {
    const op = preview.op;
    const book = ledger(pin.account);
    if (!book.ok) return refused(op, 'pending');
    const saved = book.receipts[op];
    if (saved?.state === 'posted') return { outcome: 'posted', op, comment: { ...saved.comment } };
    if (saved && TERMINAL.includes(saved.state)) return refused(op, saved.reason);
    if (state.outcome?.outcome === 'posted') return state.outcome;
    if (state.confirmed < preview.confirms) return refused(op, 'not_confirmed');
    state.confirmed = 0;
    let entered = false;
    try {
      return await lockRequest(`openwiz.app.v2.subject.${pin.account}.${pin.full}#${pin.number}`, { ifAvailable: true }, lock => {
        if (!lock) return refused(op, 'pending');
        entered = true;
        return locked(preview, state, pin);
      });
    } catch {
      return entered ? unknown(op, 'failed') : refused(op, 'pending');
    }
  }

  function post(preview) {
    const state = issued.get(preview);
    const op = state ? preview.op : null;
    if (!state || state.snapshot !== JSON.stringify(preview)) return Promise.resolve(refused(op, 'not_composed'));
    const now = mode();
    if (now === 'off') return Promise.resolve(refused(op, 'disabled'));
    if (now === 'dry-run') return Promise.resolve(refused(op, 'dry_run'));
    const found = context();
    if (!OW.data.auth.signedIn() || !found) return Promise.resolve(refused(op, 'signed_out'));
    if (found.full !== preview.repository || found.session !== state.session) return Promise.resolve(refused(op, 'not_composed'));
    if (inflight.has(op)) return inflight.get(op);
    const pin = Object.freeze({ ...found, number: preview.subject.number });
    const promise = run(preview, state, pin).then(outcome => {
      if (outcome.outcome === 'posted') state.outcome = outcome;
      return outcome;
    }, () => unknown(op, 'failed')).finally(() => { if (inflight.get(op) === promise) inflight.delete(op); });
    inflight.set(op, promise);
    return promise;
  }

  function pending() {
    const account = OW.data.auth.account();
    if (!account) return [];
    const book = ledger(account);
    if (!book.ok) return [];
    return Object.values(book.receipts).filter(r => PENDING.includes(r.state)).sort((a, b) => a.sent_at - b.sent_at)
      .map(r => issue(JSON.parse(JSON.stringify(r.preview)), r.action));
  }

  OW.records = Object.freeze({
    enabled: () => mode() !== 'off',
    dryRun: () => mode() === 'dry-run',
    compose, confirm, post, pending, check,
  });
})();
