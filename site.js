// The landing film (J185). The hero's 40 s film runs on one GSAP timeline (J187: GSAP 3.15.1, vendored), built
// only under gsap.matchMedia's no-preference query: with reduced motion it is never built (and is reverted, inline
// styles and all, if the setting changes), so every scene stays a still painting. The act loops and the small moves
// are CSS animations that also wait for .film-live. If this file or GSAP never loads, the whole page stays still.
(() => {
  const root = document.documentElement;
  const loops = [...document.querySelectorAll('.loop')];
  const pauses = [...document.querySelectorAll('.pause')];
  const film = document.querySelector('.film');
  let timeline = null;
  let paused = false;
  let filmSeen = true;
  const sync = () => timeline && (paused || !filmSeen ? timeline.pause() : timeline.play());

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
      for (const entry of entries) {
        entry.target.classList.toggle('offscreen', !entry.isIntersecting);
        if (entry.target === film) { filmSeen = entry.isIntersecting; sync(); }
      }
    });
    for (const loop of loops) seen.observe(loop);
  }

  // Pause motion: one choice for the whole page, shown on every loop, without changing a system setting.
  for (const button of pauses) {
    button.addEventListener('click', () => {
      paused = button.getAttribute('aria-pressed') !== 'true';
      root.classList.toggle('motion-paused', paused);
      for (const each of pauses) each.setAttribute('aria-pressed', String(paused));
      sync();
    });
  }

  // The hero film: one 40 s timeline, in seconds. Each shot fades, wipes (a brush edge, --w) or cuts in over the one
  // before; its camera (.cam) pans or pushes; the last shot is the app, then "This is your factory.", then black.
  function buildFilm(gsap) {
    const shot = name => film.querySelector(`.s-${name}`);
    const cam = name => shot(name).querySelector('.cam');
    const shots = [...film.querySelectorAll('.shot')];
    const tl = gsap.timeline({ repeat: -1, defaults: { ease: 'none' } });
    tl.set(shots, { opacity: 0 }, 0);
    const fade = (name, at, duration) => tl.fromTo(shot(name), { opacity: 0 }, { opacity: 1, duration }, at);
    const wipe = (name, at) => tl.set(shot(name), { opacity: 1 }, at)
      .fromTo(shot(name), { '--w': '100%' }, { '--w': '0%', duration: 1, ease: 'power1.inOut' }, at);
    const cut = (name, at) => tl.set(shot(name), { opacity: 1 }, at);
    const hide = (name, at) => tl.set(shot(name), { opacity: 0 }, at);
    const move = (name, from, to, at, duration, ease = 'sine.inOut') => tl.fromTo(cam(name), from, { ...to, duration, ease }, at);

    fade('cave', 0, 0.8);
    move('cave', { scale: 1.8 }, { scale: 1.04 }, 0, 6.8, 'power2.out');
    wipe('grill', 6); hide('cave', 7);
    move('grill', { scale: 1.16, xPercent: 5 }, { xPercent: -5 }, 6, 5.8);
    cut('forge', 11.8); hide('grill', 11.8);
    move('forge', { scale: 1.04 }, { scale: 1.32 }, 11.8, 6.2, 'power1.out');
    wipe('mill', 17.2); hide('forge', 18.2);
    move('mill', { scale: 1.22, xPercent: 6 }, { xPercent: -6 }, 17.2, 6.2);
    cut('launch', 23.4); hide('mill', 23.4);
    move('launch', { scale: 1.06, yPercent: 3 }, { scale: 1.3, yPercent: -2 }, 23.4, 5.4);
    wipe('lanes', 28); hide('launch', 29);
    move('lanes', { scale: 2.3 }, { scale: 1 }, 28, 4.8, 'power2.inOut');
    fade('rooms', 32, 0.8); hide('lanes', 32.8);
    move('rooms', { scale: 2.5 }, { scale: 1.02 }, 32, 3.2, 'power2.inOut');
    fade('app', 34.4, 0.8); hide('rooms', 35.2);
    tl.fromTo(film.querySelector('.in-film'), { scale: 1.75 }, { scale: 1, duration: 2.2, ease: 'power3.inOut' }, 34.4);
    tl.fromTo(film.querySelector('.cap'), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 1, ease: 'power2.out' }, 36.4);
    tl.to([shot('app'), film.querySelector('.cap')], { opacity: 0, duration: 0.8 }, 39.2);
    return tl;
  }

  // Only now, with every handler in place, switch on the film and every loop (.film-live), and only while GSAP runs
  // under no-preference. Without GSAP, or with reduced motion, nothing moves and every scene stays a still.
  const gsap = window.gsap;
  if (gsap && film) {
    gsap.matchMedia().add('(prefers-reduced-motion: no-preference)', () => {
      root.classList.add('film-live');
      timeline = buildFilm(gsap);
      sync();
      return () => { root.classList.remove('film-live'); timeline = null; };
    });
  }
})();
