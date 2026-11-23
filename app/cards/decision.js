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

  function blocked(item) {
    const r = item.request;
    if (!r) return 'This record couldn’t be read or checked.';
    if (r.status === 'superseded') return 'This request was superseded by a newer one.';
    if (r.status !== 'open') return `This request is ${r.status}, not open.`;
    if (item.current === false) return 'This request is stale: a newer request or a changed source replaced it.';
    if (item.current !== true) return 'OpenWiz couldn’t check that this request is still current.';
    if (!RISKS.includes(r.risk)) return 'Its risk is unknown, so OpenWiz won’t answer it.';
    return null;
  }

  const where = (h, p) => h('a', { href: p.url, target: '_blank', rel: 'noopener' },
    `${p.repository} ${SUBJECTS[p.subject.kind] || p.subject.kind} #${p.subject.number}`);
  const seen = p => p.visibility === 'public' ? 'Public: anyone can read it.' : `Visible to everyone who can read ${p.repository}.`;

  function answers(h, item, questionId) {
    const records = OW.records;
    const choices = [];
    const out = h('div', { class: 'decision-out', 'aria-live': 'polite' });
    const box = h('textarea', { rows: 3, 'aria-label': 'Your reply', placeholder: 'Or type a reply' });
    const lock = locked => { for (const el of choices) el.disabled = locked; };
    const action = (form, words) => Object.assign({ form, item }, questionId ? { question_id: questionId } : {},
      words === undefined ? {} : { words });

    function outcome(preview, result) {
      const said = h('div', { class: `decision-outcome ${result.outcome}`, 'data-outcome': result.outcome });
      if (result.outcome === 'posted') {
        const url = result.comment && String(result.comment.url);
        said.append(h('strong', {}, 'Posted.'), ' ',
          url && url.startsWith('https://github.com/') ? h('a', { href: url, target: '_blank', rel: 'noopener' }, 'See it on GitHub') : 'GitHub has it.');
      } else if (result.outcome === 'refused') {
        said.append(...(result.reason === 'dry_run' ? [h('strong', {}, REASONS.dry_run)]
          : [h('strong', {}, `Not posted (${result.reason}).`), ' ', (Object.hasOwn(REASONS, result.reason) ? REASONS[result.reason] : '')]));
        lock(false);
      } else {
        said.dataset.outcome = 'unknown';
        said.append(h('strong', {}, `Outcome unknown (${result.reason}).`), ' ',
          'It may or may not be on GitHub. Check again before answering another way.',
          h('div', { class: 'decision-buttons' }, h('button', { class: 'btn', type: 'button', onclick: () => show(preview, 0) }, 'Check again')));
      }
      return said;
    }

    function show(preview, confirmed, note) {
      lock(true);
      const risky = preview.confirms > 1;
      const post = h('button', { class: 'btn primary', type: 'button' }, confirmed === 0 ? 'Post' : 'Confirm again');
      const cancel = h('button', { class: 'btn', type: 'button', onclick: () => { out.replaceChildren(); lock(false); } }, 'Cancel');
      const buttons = h('div', { class: 'decision-buttons' }, post, cancel);
      post.addEventListener('click', async event => {
        const counted = records.confirm(preview, event);
        if (counted.confirmed < counted.of) {
          if (counted.confirmed > confirmed) show(preview, counted.confirmed);
          return;
        }
        buttons.replaceChildren(h('span', { class: 'decision-wait' }, 'Posting…'));
        let result;
        try { result = await records.post(preview); } catch { result = { outcome: 'unknown', op: preview.op, reason: 'error' }; }
        buttons.replaceWith(outcome(preview, result));
      });
      out.replaceChildren(h('div', { class: 'decision-preview' },
        h('p', {}, 'This exact comment will be posted as you:'),
        h('pre', { 'data-preview-body': '' }, preview.body),
        h('p', {}, 'Goes on ', where(h, preview), '. ', seen(preview)),
        risky ? h('p', { class: 'decision-risky' }, confirmed === 0
          ? `This is a ${item.request.risk} decision: it needs two confirms.`
          : `Confirm again: this is a ${item.request.risk} decision.`) : null,
        note || null,
        buttons));
    }

    async function compose(form, words) {
      lock(true);
      out.replaceChildren(h('p', { class: 'decision-wait' }, 'Writing the preview…'));
      let preview;
      try { preview = await records.compose(action(form, words)); } catch { preview = { refused: 'error' }; }
      if (preview && !preview.refused) return show(preview, 0);
      out.replaceChildren(outcome(null, { outcome: 'refused', reason: (preview && preview.refused) || 'error' }));
    }

    const yes = h('button', { class: 'btn primary', type: 'button', onclick: () => compose('decision.yes') }, 'Yes');
    const no = h('button', { class: 'btn', type: 'button', onclick: () => compose('decision.no') }, 'No');
    const reply = h('button', { class: 'btn', type: 'button', onclick: () => compose('decision.own', box.value) }, 'Preview reply');
    choices.push(yes, no, box, reply);
    const pending = (records.pending ? records.pending() : []).filter(p => p.repository === item.repository
      && p.subject && p.subject.kind === item.subject.kind && p.subject.number === item.subject.number);
    const el = h('div', { class: 'decision-answer' },
      h('div', { class: 'decision-buttons' }, yes, no),
      box, h('div', { class: 'decision-buttons' }, reply), out);
    if (pending.length) out.replaceChildren(...pending.map(p => h('div', { class: 'decision-preview' },
      h('pre', { 'data-preview-body': '' }, p.body), outcome(p, { outcome: 'unknown', op: p.op, reason: 'not checked since' }))));
    return el;
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
    if (r && Array.isArray(r.questions)) {
      const answered = Array.isArray(r.answered) ? r.answered : [];
      for (const q of r.questions.filter(q => !answered.includes(q.id))) {
        card.append(h('section', { class: 'decision-question' },
          h('h4', {}, `${q.id}: ${q.decides}`), h('p', {}, q.context),
          h('p', { class: 'decision-rec' }, h('b', {}, 'Rec: '), q.recommendation),
          answerable ? answers(h, item, q.id) : null));
      }
    } else if (r) {
      if (r.headline) card.append(h('p', { class: 'decision-headline' }, r.headline));
      if (Array.isArray(r.summary)) card.append(h('ul', { class: 'decision-summary' }, r.summary.map(line => h('li', {}, line))));
      if (Array.isArray(r.tickets) && r.tickets.length) {
        card.append(h('ul', { class: 'decision-tickets' }, r.tickets.map(t => h('li', {}, `#${t.number} ${t.title}`,
          Array.isArray(t.blockers) && t.blockers.length ? ` (after ${t.blockers.map(b => `#${b}`).join(', ')})` : ''))));
      }
      if (REC[r.kind]) card.append(h('p', { class: 'decision-rec' }, h('b', {}, 'Rec: '), REC[r.kind](r)));
      if (answerable) card.append(answers(h, item, null));
    }
    if (why) card.append(h('p', { class: 'decision-blocked' }, why, ' It can’t be answered here.'));
    else if (!answerable) card.append(h('p', { class: 'decision-blocked' }, 'Answers are off in this browser.'));
    el.replaceChildren(card);
  };
})();
