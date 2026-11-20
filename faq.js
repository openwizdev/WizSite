// The Questions (#76): the page ships every answer open and every row's button disabled, so a visitor reads them all
// if this script never runs (#77 R1). Here each button is enabled and its answer closed at once; only then may the
// rows move (site.css animates them unless motion is reduced). One listener on the document, so a row added later
// (part 2's "Ask a Wiz..." row) needs no wiring of its own.
document.addEventListener('click', event => {
  const button = event.target.closest('.faq[data-ready] .faq-q button');
  if (button) button.setAttribute('aria-expanded', String(button.getAttribute('aria-expanded') !== 'true'));
});
for (const faq of document.querySelectorAll('.faq')) {
  for (const button of faq.querySelectorAll('.faq-q button')) {
    button.setAttribute('aria-expanded', 'false');
    button.disabled = false;
  }
  faq.dataset.ready = '';
  void faq.offsetHeight; // closed without motion, then the rows may move
  faq.dataset.moving = '';
}
