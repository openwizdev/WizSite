// The You page: what needs the user now. The count tiles (Needs you, Building, In review, Merged), then every
// spec waiting for the user's confirm, every plan waiting for approval (open openwiz.decisions.v1 records) and
// every ticket labelled needs-info or ready-for-human, newest first, each linked to GitHub.
'use strict';
OW.page({
  id: 'you',
  title: 'You',
  icon: 'you',
  feeds: ['specs', 'agents'],
  badge: feeds => OW.factory.model(feeds)?.you.length || null,
  render(el, feeds) {
    const { h, STATES, time } = OW.ui;
    const seen = OW.factory.model(feeds);
    const c = seen?.counts;
    const tiles = OW.ui.tiles([
      { label: 'Needs you', value: c?.you, state: 'you' },
      { label: 'Building', value: c?.building, state: 'building' },
      { label: 'In review', value: c?.review, state: 'review' },
      { label: 'Merged', value: c?.merged, state: 'merged' },
    ]);
    if (!seen) return el.replaceChildren(tiles, OW.ui.placeholder('Reading GitHub…'));
    const WORDS = {
      spec_confirmation: 'Spec to confirm',
      plan_approval: 'Plan to approve',
      ticket: 'Ticket marked for you',
      unreadable: 'A decision record that couldn\'t be read',
    };
    const items = seen.you.map(item => h('a', {
      class: `card${item.kind === 'unreadable' ? '' : ' you'}`, href: item.url, rel: 'noreferrer',
      '--c': item.kind === 'unreadable' ? STATES.unknown.colour : STATES.you.colour,
    },
    h('div', { class: 'num' }, `${WORDS[item.kind]} · #${item.number}${item.at ? ` · ${time(item.at)}` : ''}`),
    h('h3', {}, item.title),
    h('p', {}, item.kind === 'ticket' ? 'Open the ticket on GitHub.' : item.kind === 'unreadable' ? 'Open it on GitHub to read it.' : 'Say yes in chat, as today. Open it on GitHub to read it.')));
    el.replaceChildren(tiles, items.length ? h('div', { class: 'cards' }, items)
      : OW.ui.placeholder('Nothing needs you right now: no spec to confirm, no plan to approve and no ticket marked for you.'));
  },
});
