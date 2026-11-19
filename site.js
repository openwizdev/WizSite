// The landing film (J185). CSS plays everything; this script only switches it on, closes Act 1's strip into a loop,
// pauses each loop while it is off screen, and runs the Pause buttons. Under reduced motion CSS ignores all of it,
// so every scene stays a still painting; if this file never loads, the page keeps that still layout too.
(() => {
  const root = document.documentElement;
  const loops = [...document.querySelectorAll('.loop')];
  const pauses = [...document.querySelectorAll('.pause')];

  // Act 1's strip rolls by half its width: a hidden copy of the five eras follows the first five.
  const track = document.querySelector('.track');
  if (track) {
    for (const item of [...track.children]) {
      const copy = item.cloneNode(true);
      copy.setAttribute('aria-hidden', 'true');
      copy.classList.add('copy');
      for (const img of copy.querySelectorAll('img')) img.alt = '';
      track.append(copy);
    }
  }

  // A loop off screen holds still (and costs nothing) until it comes back.
  if ('IntersectionObserver' in window) {
    const seen = new IntersectionObserver(entries => {
      for (const entry of entries) entry.target.classList.toggle('offscreen', !entry.isIntersecting);
    });
    for (const loop of loops) seen.observe(loop);
  }

  // Pause motion: one choice for the whole page, shown on every loop, without changing a system setting.
  for (const button of pauses) {
    button.addEventListener('click', () => {
      const paused = button.getAttribute('aria-pressed') !== 'true';
      root.classList.toggle('motion-paused', paused);
      for (const each of pauses) each.setAttribute('aria-pressed', String(paused));
    });
  }

  // Only now, with every handler in place, switch on the film. Without this line the page stays a set of stills.
  root.classList.add('story-live');
})();
