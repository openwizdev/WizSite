'use strict';
OW.page({
  id: 'you',
  title: 'You',
  icon: 'you',
  feeds: ['specs', 'agents'],
  badge: feeds => OW.factory.model(feeds)?.counts.sure || null,
  render(el, feeds) {
    OW.factory.redraw(el, () => {
      const { h, STATES, time } = OW.ui;
      const seen = OW.factory.model(feeds);
      const c = seen?.counts;
      const tiles = OW.ui.tiles([
        { label: 'Needs you', value: c?.you, state: 'you' },
        { label: 'Building', value: c?.building, state: 'building' },
        { label: 'In review', value: c?.review, state: 'review' },
        { label: 'Merged', value: c?.merged, state: 'merged' },
      ]);
      if (!seen) return OW.ui.fill(el, tiles, OW.ui.placeholder('Reading GitHub…'));
      const WORDS = {
        spec_confirmation: 'Spec to confirm',
        plan_approval: 'Plan to approve',
        ticket: 'Waiting on your answer',
        person: 'A task for a person',
        unreadable: 'A decision record that couldn\'t be read',
      };
      const TELL = {
        ticket: 'It is labelled needs-info: an agent or a person waits on your answer. Open the ticket on GitHub.',
        person: 'It is labelled ready-for-human: a person has to act on it. Open the ticket on GitHub.',
        unreadable: 'It isn\'t a valid request from the factory, or its author couldn\'t be checked. Open it on GitHub to read it.',
      };
      const card = (item, quiet) => h('a', {
        class: `card${item.kind === 'unreadable' || quiet ? '' : ' you'}`, href: item.url, target: '_blank', rel: 'noreferrer', 'data-focus': `item:${item.url}`,
        '--c': item.kind === 'unreadable' ? STATES.unknown.colour : quiet ? STATES.waiting.colour : STATES.you.colour,
      },
      h('div', { class: 'num' }, `${WORDS[item.kind]} · #${item.number}${item.at ? ` · ${time(item.at)}` : ''}`),
      h('h3', {}, item.title),
      h('p', {}, quiet && item.kind !== 'person' ? 'Later: it waits on an open blocker first. Open the ticket on GitHub.' : TELL[item.kind] || 'Say yes in chat, as today. Open it on GitHub to read it.'));
      const items = seen.you.map(item => card(item));
      const later = seen.later.length ? [h('h2', { class: 'later' }, 'Later'), h('div', { class: 'cards later' }, seen.later.map(item => card(item, true)))] : [];
      const people = seen.people?.length ? [h('h2', { class: 'later' }, `Tasks for a person · ${Math.max(seen.peopleTotal, seen.people.length)}`),
        h('div', { class: 'cards later' }, seen.people.map(item => card(item, true)))] : [];
      const missing = seen.gaps.length
        ? OW.ui.unknown(`This list may be missing items: GitHub gave only part of ${seen.gaps.join(', ')}. The app tries again on its own.`) : null;
      el.replaceChildren(...[tiles, missing, items.length ? h('div', { class: 'cards' }, items)
        : missing ? null : OW.ui.placeholder('Nothing needs you right now: no spec to confirm, no plan to approve and no ticket waiting on your answer.'), ...later, ...people].filter(Boolean));
    });
  },
});
