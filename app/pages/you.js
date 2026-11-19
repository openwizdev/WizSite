// The You page: what needs the user now. AP6 (#1259) builds it: the count tiles (Needs you, Building, In review,
// Merged) with OW.ui.tiles, then the specs to confirm, plans to approve and tickets marked for the user.
// Until then the shell shows its frame, read times and failed reads, and this placeholder.
'use strict';
OW.page({
  id: 'you',
  title: 'You',
  icon: 'you',
  feeds: ['specs', 'agents'],
  badge: () => null, // AP6: how many things need the user
  render(el) {
    el.replaceChildren(OW.ui.placeholder('What needs you, with the Needs you, Building, In review and Merged counts, arrives in the next update.'));
  },
});
