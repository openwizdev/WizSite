'use strict';
(() => {
  const OW = (window.OW = window.OW || {});
  OW.cards = OW.cards || {};
  OW.cards.decision = (item, el) => {
    el.replaceChildren(OW.ui.h('article', { class: 'card decision' }, OW.ui.h('h3', {}, item.title)));
  };
})();
