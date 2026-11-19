// The landing story: one Wiz in every era. This script only feeds the scroll to CSS and pauses the idle moves:
// --p on each painting's plate (its place in the viewport, -1 above centre .. 1 below) drives the light parallax,
// and --z on the zoom-out (0..1 as it scrolls past) drives the hand-off to "This is your factory."
// CSS applies both only when reduced motion is not asked for; with reduced motion this script sets nothing.
(() => {
  const root = document.documentElement;
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const plates = [...document.querySelectorAll('.plate')];
  const zoom = document.querySelector('.zoom');
  const pause = document.querySelector('.pause');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  let queued = false;

  function frame() {
    queued = false;
    if (still.matches) return;
    const vh = innerHeight;
    for (const plate of plates) {
      const box = plate.parentElement.getBoundingClientRect();
      if (box.bottom < 0 || box.top > vh) continue;
      const p = (box.top + box.height / 2 - vh / 2) / (vh / 2 + box.height / 2);
      plate.style.setProperty('--p', clamp(p, -1, 1).toFixed(4));
    }
    if (zoom) {
      const box = zoom.getBoundingClientRect();
      const run = box.height - vh;
      zoom.style.setProperty('--z', run > 0 ? clamp(-box.top / run, 0, 1).toFixed(4) : '1');
    }
  }
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(frame); } };
  function reset() {
    for (const plate of plates) plate.style.removeProperty('--p');
    zoom?.style.removeProperty('--z');
    queue();
  }
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', queue);
  still.addEventListener('change', reset);

  // The idle moves (hammer, stamp, rocket) run only while their painting is on screen.
  if ('IntersectionObserver' in window) {
    const seen = new IntersectionObserver(entries => {
      for (const entry of entries) entry.target.classList.toggle('offscreen', !entry.isIntersecting);
    });
    for (const plate of plates) if (plate.querySelector('.layer')) seen.observe(plate);
  }

  // Pause motion: stops the idle moves for anyone who wants them still without changing a system setting.
  pause?.addEventListener('click', () => {
    const paused = pause.getAttribute('aria-pressed') !== 'true';
    pause.setAttribute('aria-pressed', String(paused));
    root.classList.toggle('motion-paused', paused);
  });

  // Only now, with every handler in place, switch on the animated story (sticky zoom-out, Pause motion), and set
  // the scroll state at once. If this file never loads, the page keeps its still layout with every scene shown.
  root.classList.add('story-live');
  frame();
})();
