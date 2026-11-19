// The Agents page. AP7 (#1260) builds it from the status comments and state labels: the agents working now and
// those that finished in the last day, with kind, model, last step, ticket and time.
'use strict';
OW.page({
  id: 'agents',
  title: 'Agents',
  icon: 'agents',
  feeds: ['agents'],
  badge: () => null, // AP7: how many agents are working
  render(el) {
    el.replaceChildren(OW.ui.placeholder('The agents working now and in the last day arrive in the next update.'));
  },
});
