'use strict';
(() => {
  const OW = (window.OW = window.OW || {});
  OW.cards = OW.cards || {};
  OW.cards.spec = (item, el) => { el.replaceChildren(OW.ui.h('h3', {}, item.title)); };
})();
