'use strict';
(() => {
  const OW = (window.OW = window.OW || {});
  OW.cards = OW.cards || {};

  const RISKS = ['ordinary', 'live', 'release', 'publish'];
  const KINDS = { grill_round: 'Grill round', grill_confirmation: 'Grill summary', spec_confirmation: 'Spec to confirm', plan_approval: 'Plan to approve' };
  const SUBJECTS = { issue: 'issue', pull_request: 'pull request' };
  const REC = {
    grill_confirmation: () => 'confirm this summary',
    spec_confirmation: r => `confirm spec #${r.spec}`,
    plan_approval: r => `approve the plan for #${r.spec}`,
  };
  const REASONS = {
    dry_run: 'Dry run: nothing was posted.',
    disabled: 'Answers are switched off in this browser.',
    not_composed: 'The preview was not the one composed.',
    not_confirmed: 'It was not confirmed.',
    signed_out: 'You are signed out.',
    pending: 'An earlier answer on this subject has an unknown outcome. Check that one first.',
    source_changed: 'The request or its source changed since it was read.',
    source_unchecked: 'The request could not be checked again.',
    github: 'GitHub refused it.',
  };

  const staleItems = new WeakSet();
  const STALE = 'The request or its source changed since it was read.';
  const onSubject = (p, item) => !!p && p.repository === item.repository && !!p.subject
    && p.subject.kind === item.subject.kind && p.subject.number === item.subject.number;

  function blocked(item) {
    const r = item.request;
    if (!r) return 'This record couldn’t be read or checked.';
    if (r.status === 'superseded') return 'This request was superseded by a newer one.';
    if (r.status !== 'open') return `This request is ${r.status}, not open.`;
    if (item.current === false) return 'This request is stale: a newer request or a changed source replaced it.';
    if (item.current !== true) return 'OpenWiz couldn’t check that this request is still current.';
    if (!RISKS.includes(r.risk)) return 'Its risk is unknown, so OpenWiz won’t answer it.';
    if (staleItems.has(item)) return STALE;
    return null;
  }

  const where = (h, p) => h('a', { href: p.url, target: '_blank', rel: 'noopener' },
    `${p.repository} ${SUBJECTS[p.subject.kind] || p.subject.kind} #${p.subject.number}`);
  const seen = p => p.visibility === 'public' ? 'Public: anyone can read it.' : `Visible to everyone who can read ${p.repository}.`;

  function exact(box) {
    const flat = text => text.replace(/\r\n?/g, '\n');
    let raw = '';
    let was = '';
    let dropped = null;
    const at = n => { let i = 0; for (let k = 0; k < n; k++) i += raw.startsWith('\r\n', i) ? 2 : 1; return i; };
    const grab = event => {
      const data = event.clipboardData || event.dataTransfer;
      dropped = data ? data.getData('text/plain') : null;
    };
    box.addEventListener('paste', grab);
    box.addEventListener('drop', grab);
    box.addEventListener('input', () => {
      const now = box.value;
      if (flat(raw) !== was) raw = was;
      const caret = typeof box.selectionEnd === 'number' ? box.selectionEnd : now.length;
      let tail = 0;
      while (tail < was.length && tail < now.length - caret && was[was.length - 1 - tail] === now[now.length - 1 - tail]) tail++;
      let head = 0;
      while (head < Math.min(was.length, now.length) - tail && was[head] === now[head]) head++;
      const added = now.slice(head, now.length - tail);
      const text = dropped !== null && flat(dropped) === added ? dropped : added;
      raw = raw.slice(0, at(head)) + text + raw.slice(at(was.length - tail));
      was = now;
      dropped = null;
    });
    return () => flat(raw) === box.value ? raw : box.value;
  }

  function subject(h, item) {
    const records = OW.records;
    const choices = [];
    const outs = [];
    const kept = new Map();
    const held = h('div', { class: 'decision-pending', 'aria-live': 'polite' });
    const top = h('div', { class: 'decision-subject' }, held);
    const lock = locked => { for (const el of choices) el.disabled = locked || staleItems.has(item); };

    function stale() {
      if (staleItems.has(item)) return;
      staleItems.add(item);
      lock(true);
      for (const out of outs) if (!out.querySelector('[data-outcome]')) out.replaceChildren();
      top.append(h('p', { class: 'decision-blocked' }, STALE, ' It can’t be answered here until the queue reads it again.'));
    }

    function refusal(reason) {
      const said = h('div', { class: 'decision-outcome refused', 'data-outcome': 'refused' });
      said.append(...(reason === 'dry_run' ? [h('strong', {}, REASONS.dry_run)]
        : [h('strong', {}, `Not posted (${reason}).`), ' ', (Object.hasOwn(REASONS, reason) ? REASONS[reason] : '')]));
      return said;
    }

    function heed(reason) {
      if (reason === 'source_changed') stale();
      if (reason === 'pending') refresh();
    }

    function idle(slot, reason, note) {
      const said = h('div', { class: 'decision-outcome unknown', 'data-outcome': 'unknown' },
        h('strong', {}, `Outcome unknown (${reason}).`), ' ',
        'It may or may not be on GitHub. Check again before answering another way.',
        h('div', { class: 'decision-buttons' }, h('button', { class: 'btn', type: 'button',
          onclick: () => show(slot.el, slot.preview, 0, () => { idle(slot, reason); lock(false); }, null, slot) }, 'Check again')));
      slot.el.replaceChildren(...(note ? [note] : []), h('pre', { 'data-preview-body': '' }, slot.preview.body), said);
    }

    function hold(preview, reason, note) {
      let slot = kept.get(preview.op);
      if (!slot) {
        slot = { preview, el: h('div', { class: 'decision-preview' }) };
        kept.set(preview.op, slot);
        held.append(slot.el);
      }
      idle(slot, reason, note);
    }

    function refresh() {
      const list = records.pending ? records.pending() : [];
      for (const p of Array.isArray(list) ? list : []) if (onSubject(p, item) && !kept.has(p.op)) hold(p, 'not checked since');
    }

    function settle(out, preview, result, buttons, slot) {
      if (result.outcome === 'posted') {
        const url = result.comment && String(result.comment.url);
        buttons.replaceWith(h('div', { class: 'decision-outcome posted', 'data-outcome': 'posted' }, h('strong', {}, 'Posted.'), ' ',
          url && url.startsWith('https://github.com/') ? h('a', { href: url, target: '_blank', rel: 'noopener' }, 'See it on GitHub') : 'GitHub has it.'));
        lock(false);
      } else if (result.outcome === 'refused') {
        const said = refusal(result.reason);
        if (slot) idle(slot, 'not posted since', said);
        else buttons.replaceWith(said);
        heed(result.reason);
        lock(false);
      } else {
        if (!slot) out.replaceChildren();
        hold(preview, result.reason);
      }
    }

    function show(out, preview, confirmed, back, note, slot) {
      lock(true);
      const risky = preview.confirms > 1;
      const post = h('button', { class: 'btn primary', type: 'button' }, confirmed === 0 ? 'Post' : 'Confirm again');
      const cancel = h('button', { class: 'btn', type: 'button', onclick: back }, 'Cancel');
      const buttons = h('div', { class: 'decision-buttons' }, post, cancel);
      post.addEventListener('click', async event => {
        const counted = records.confirm(preview, event);
        if (counted.confirmed < counted.of) {
          if (counted.confirmed > confirmed) show(out, preview, counted.confirmed, back, note, slot);
          return;
        }
        buttons.replaceChildren(h('span', { class: 'decision-wait' }, 'Posting…'));
        let result;
        try { result = await records.post(preview); } catch { result = { outcome: 'unknown', op: preview.op, reason: 'error' }; }
        settle(out, preview, result || { outcome: 'unknown', op: preview.op, reason: 'error' }, buttons, slot);
      });
      const shown = [h('p', {}, 'This exact comment will be posted as you:'),
        h('pre', { 'data-preview-body': '' }, preview.body),
        h('p', {}, 'Goes on ', where(h, preview), '. ', seen(preview)),
        risky ? h('p', { class: 'decision-risky' }, confirmed === 0
          ? `This is a ${item.request.risk} decision: it needs two confirms.`
          : `Confirm again: this is a ${item.request.risk} decision.`) : null,
        note || null,
        buttons];
      if (slot) out.replaceChildren(...shown);
      else out.replaceChildren(h('div', { class: 'decision-preview' }, ...shown));
    }

    function answers(questionId) {
      const out = h('div', { class: 'decision-out', 'aria-live': 'polite' });
      outs.push(out);
      const box = h('textarea', { rows: 3, 'aria-label': 'Your reply', placeholder: 'Or type a reply' });
      const words = exact(box);
      const action = (form, typed) => Object.assign({ form, item }, questionId ? { question_id: questionId } : {},
        typed === undefined ? {} : { words: typed });
      const back = () => { out.replaceChildren(); lock(false); };

      async function compose(form, typed) {
        lock(true);
        out.replaceChildren(h('p', { class: 'decision-wait' }, 'Writing the preview…'));
        let preview;
        try { preview = await records.compose(action(form, typed)); } catch { preview = { refused: 'error' }; }
        if (preview && !preview.refused) return show(out, preview, 0, back);
        const reason = (preview && preview.refused) || 'error';
        out.replaceChildren(refusal(reason));
        heed(reason);
        lock(false);
      }

      const yes = h('button', { class: 'btn primary', type: 'button', onclick: () => compose('decision.yes') }, 'Yes');
      const no = h('button', { class: 'btn', type: 'button', onclick: () => compose('decision.no') }, 'No');
      const reply = h('button', { class: 'btn', type: 'button', onclick: () => compose('decision.own', words()) }, 'Preview reply');
      choices.push(yes, no, box, reply);
      lock(false);
      return h('div', { class: 'decision-answer' },
        h('div', { class: 'decision-buttons' }, yes, no),
        box, h('div', { class: 'decision-buttons' }, reply), out);
    }

    return { top, answers, refresh };
  }

  OW.cards.decision = (item, el) => {
    const { h } = OW.ui;
    const r = item.request;
    const why = blocked(item);
    const head = h('div', { class: 'decision-head' },
      h('span', { class: 'decision-kind' }, r ? KINDS[r.kind] || r.kind : 'Decision'),
      r ? h('span', { class: `decision-risk${r.risk === 'ordinary' ? '' : ' high'}` }, `Risk: ${RISKS.includes(r.risk) ? r.risk : 'unknown'}`) : null);
    const card = h('article', { class: 'card decision', 'data-key': item.key }, head,
      h('h3', {}, item.title),
      h('p', { class: 'num' }, h('a', { href: item.url, target: '_blank', rel: 'noopener' },
        `${item.repository} ${SUBJECTS[item.subject.kind] || item.subject.kind} #${item.subject.number}`)));
    const answerable = !why && OW.records && OW.records.enabled();
    const ask = answerable ? subject(h, item) : null;
    if (ask) card.append(ask.top);
    if (r && Array.isArray(r.questions)) {
      const answered = Array.isArray(r.answered) ? r.answered : [];
      for (const q of r.questions.filter(q => !answered.includes(q.id))) {
        card.append(h('section', { class: 'decision-question' },
          h('h4', {}, `${q.id}: ${q.decides}`), h('p', {}, q.context),
          h('p', { class: 'decision-rec' }, h('b', {}, 'Rec: '), q.recommendation),
          ask ? ask.answers(q.id) : null));
      }
    } else if (r) {
      if (r.headline) card.append(h('p', { class: 'decision-headline' }, r.headline));
      if (Array.isArray(r.summary)) card.append(h('ul', { class: 'decision-summary' }, r.summary.map(line => h('li', {}, line))));
      if (Array.isArray(r.tickets) && r.tickets.length) {
        card.append(h('ul', { class: 'decision-tickets' }, r.tickets.map(t => h('li', {}, `#${t.number} ${t.title}`,
          Array.isArray(t.blockers) && t.blockers.length ? ` (after ${t.blockers.map(b => `#${b}`).join(', ')})` : ''))));
      }
      if (REC[r.kind]) card.append(h('p', { class: 'decision-rec' }, h('b', {}, 'Rec: '), REC[r.kind](r)));
      if (ask) card.append(ask.answers(null));
    }
    if (why) card.append(h('p', { class: 'decision-blocked' }, why, ' It can’t be answered here.'));
    else if (!answerable) card.append(h('p', { class: 'decision-blocked' }, 'Answers are off in this browser.'));
    if (ask) ask.refresh();
    el.replaceChildren(card);
  };
})();
