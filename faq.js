// The Questions (#76): each row's button opens and closes its own answer; site.css animates it (no motion with
// reduced motion) and shows every answer when scripts are off. One listener on the document, so a row added later
// (part 2's "Ask a Wiz..." row) needs no wiring of its own.
document.addEventListener('click', event => {
  const button = event.target.closest('.faq-q button');
  if (button) button.setAttribute('aria-expanded', String(button.getAttribute('aria-expanded') !== 'true'));
});
