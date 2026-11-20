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
  void faq.offsetHeight;
  faq.dataset.moving = '';
}
