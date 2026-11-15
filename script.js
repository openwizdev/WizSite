const button = document.querySelector('.menu-toggle');
const nav = document.querySelector('#navigation');
function closeMenu() {
  nav.classList.remove('open');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', 'Open menu');
}
button.addEventListener('click', () => {
  const open = button.getAttribute('aria-expanded') !== 'true';
  nav.classList.toggle('open', open);
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
});
nav.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') { closeMenu(); button.focus(); } });
const art = document.querySelector('.art');
if (art && 'IntersectionObserver' in window) {
  new IntersectionObserver(entries => { art.classList.toggle('offscreen', !entries[0].isIntersecting); }).observe(art);
}

// The ⌘K palette: filter the site's sections and pages, then follow a link.
const palette = document.querySelector('#jump');
const opener = document.querySelector('.cmdk');
const input = palette.querySelector('input');
const links = [...palette.querySelectorAll('.palette-list a')];
const empty = palette.querySelector('.palette-empty');
links.forEach((link, index) => {
  link.id = `jump-option-${index}`;
  link.setAttribute('role', 'option');
  link.setAttribute('aria-selected', 'false');
  link.tabIndex = -1;
  link.parentElement.setAttribute('role', 'presentation');
});
let active = 0;
const shown = () => links.filter(link => !link.parentElement.hidden);
function highlight(index) {
  const visible = shown();
  active = visible.length ? (index + visible.length) % visible.length : 0;
  links.forEach(link => {
    const selected = link === visible[active];
    link.classList.toggle('active', selected);
    link.setAttribute('aria-selected', String(selected));
  });
  if (palette.open) visible[active]?.scrollIntoView({ block: 'nearest' });
  if (palette.open && visible[active]) input.setAttribute('aria-activedescendant', visible[active].id);
  else input.removeAttribute('aria-activedescendant');
}
function filter() {
  const query = input.value.trim().toLowerCase();
  for (const link of links) link.parentElement.hidden = !link.textContent.toLowerCase().includes(query);
  empty.hidden = shown().length > 0;
  highlight(0);
}
function openPalette() {
  if (palette.open) return;
  closeMenu();
  input.value = '';
  filter();
  palette.showModal();
  input.setAttribute('aria-expanded', 'true');
  highlight(active);
  input.focus();
}
opener.addEventListener('click', openPalette);
input.addEventListener('input', filter);
input.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); palette.close(); return; }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); highlight(active + (event.key === 'ArrowDown' ? 1 : -1)); }
  if (event.key === 'Enter' && shown()[active]) { event.preventDefault(); shown()[active].click(); }
});
palette.addEventListener('click', event => {
  if (event.target === palette) palette.close();
  else if (event.target.closest('a')) palette.close();
});
palette.addEventListener('close', () => {
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  links.forEach(link => link.setAttribute('aria-selected', 'false'));
  opener.focus({ preventScroll: true });
});
document.addEventListener('keydown', event => {
  const typing = event.target.closest('input, textarea, [contenteditable]');
  if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
    event.preventDefault();
    openPalette();
  }
});

// The intro's handwriting (Virgil, 61 KB) loads only after the page and its text fonts have
// loaded, so it never competes with them for the first paint; its notes show once it is ready. The page is
// ready when the text fonts and, on the landing, the handwriting are both in.
const ink = document.querySelector('.intro.wait-ink');
const inked = !ink ? Promise.resolve() : new Promise(resolve => {
  const show = () => document.fonts.ready.then(() => document.fonts.load('400 20px Virgil')).catch(() => {}).then(() => { ink.classList.remove('wait-ink'); resolve(); });
  if (document.readyState === 'complete') show(); else addEventListener('load', show, { once: true });
});
Promise.all([document.fonts.ready, inked]).then(() => { document.querySelector('main').dataset.ready = 'true'; });

// The landing intro (#1352): splits the typed idea into letters so CSS can type it.
// Everything else is CSS animation; nothing here changes the stage over time.
(() => {
  const typed = document.querySelector('.intro .typed');
  const text = typed && typed.firstChild;
  if (!text || text.nodeType !== 3) return;
  const caret = typed.querySelector('.caret');
  [...text.textContent].forEach((c, i) => {
    const s = document.createElement('span');
    s.className = 'ch';
    s.style.setProperty('--i', i);
    s.textContent = c === ' ' ? ' ' : c;
    typed.insertBefore(s, caret);
  });
  text.remove();
})();
