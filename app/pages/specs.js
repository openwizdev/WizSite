// The Specs page and each running spec's page. AP6 (#1259) builds them: every spec with its progress
// (OW.ui.bar), and a spec's ticket graph with one colour per state (OW.ui.STATES).
'use strict';
OW.page({
  id: 'specs',
  title: 'Specs',
  icon: 'specs',
  feeds: ['specs'],
  badge: () => null,
  render(el) {
    el.replaceChildren(OW.ui.placeholder('Every spec with its progress, and each running spec\'s ticket graph, arrive in the next update.'));
  },
});
