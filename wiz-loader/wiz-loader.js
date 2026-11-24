'use strict';
// Dancing Wizes for slow loads: mount(el, { compact, lines }) -> { stop }, markup(compact) -> el.
(() => {
  const LINES = ['Wizes are brewing your specs', 'Herding agents', 'Checking every ticket', 'Reading your repo',
    'Polishing the hats', 'Asking the reviewers nicely', 'Twirling the wands', 'Waking the sleepy Wizes',
    'Tidying the beards', 'Dusting off the stars', 'Sorting the spellbook', 'Finding a comfy hat'];
  const SVG = `<svg class="wl-wiz" viewBox="90 20 420 450"><mask id="wlm"><rect width="512" height="512" fill="#fff"/><g fill="#000"><circle cx="219" cy="278" r="30"/><circle cx="291" cy="278" r="30"/><path d="M190 323Q190 312 202 312H310Q322 312 322 324V342Q322 354 310 354H202Q190 354 190 342Z"/></g></mask>
<g fill="#cfc6b8"><g mask="url(#wlm)"><path d="M132 234Q132 210 158 210H354Q380 210 380 236V293C380 322 368 345 348 358H164C144 344 132 322 132 293Z"/>
<path d="M148 325C151 362 164 390 186 410L207 391L228 438L247 405L264 461L283 405L304 438L325 391L346 410C368 388 379 358 380 325C351 346 324 353 294 353H220C192 353 167 345 148 325Z"/></g><circle cx="230" cy="273" r="8"/><circle cx="280" cy="284" r="8"/><path d="M220 313V353H228V313ZM252 313V353H260V313ZM284 313V353H292V313Z"/><g class="wl-hat">
<path d="M154 222L228 81C249 40 281 25 313 30C357 36 385 73 384 111C383 139 367 154 350 145C336 138 342 110 323 96C307 84 288 91 278 106L328 222Z"/><path d="M96 210Q96 190 117 190H395Q416 190 416 210V228Q416 246 397 246H115Q96 246 96 228Z"/></g></g>
<g class="wl-wand"><path d="M384 352L462 250" stroke="#aaa194" stroke-width="9" stroke-linecap="round"/><path class="wl-star" fill="#e8b46a" d="M470 213L476 231L496 232L480 243L486 262L470 251L454 262L460 243L444 232L464 231Z"/></g></svg>`;
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let masks = 0;
  const make = (tag, className) => Object.assign(document.createElement(tag), { className });

  // Each SVG copy needs its own mask id.
  function ownMask(svg) {
    svg.querySelector('mask').id = `wlm${++masks}`;
    svg.querySelector('[mask]').setAttribute('mask', `url(#wlm${masks})`);
  }

  function mount(box, options = {}) {
    if (box._wl) return box._wl;
    if (options.compact) box.setAttribute('data-wiz-loader', 'compact');
    const lines = options.lines || LINES, joined = [], classes = box.classList;
    const stage = box.querySelector('.wl-stage'), leader = stage.querySelector('.wl-slot');
    const line = box.querySelector('.wiz-loader-line');
    const most = box.getAttribute('data-wiz-loader') === 'compact' ? 2 : innerWidth < 700 ? 3 : 4;
    let size = 1, beat = 0, casts = 0, next = 0, seen = false, swap;
    ownMask(leader.querySelector('svg'));
    if (options.lines) line.textContent = lines[next++];
    // Screen readers hear the first line once.
    box.setAttribute('role', 'status');
    if (!box.querySelector('.wl-sr')) box.append(Object.assign(make('span', 'wl-sr'), { textContent: line.textContent }));
    line.setAttribute('aria-hidden', 'true');
    // Stops once it has been on the page and left it.
    function alive() {
      if (box.isConnected) seen = true;
      else if (seen) return stop(), false;
      return true;
    }
    function join() {
      const slot = leader.cloneNode(true), wrap = make('div', 'wl-in'), svg = slot.querySelector('svg');
      slot.className = `wl-slot wl-j${size} wl-c${size}`;
      ownMask(svg);
      wrap.append(svg);
      slot.append(wrap, make('span', 'wl-poof'));
      stage.append(slot);
      joined.push(slot);
      classes.remove(`wl-n${size}`);
      classes.add(`wl-n${++size}`);
    }
    function onBeat() {
      if (!alive()) return;
      beat++;
      // After a cast the hats shift one place.
      if (classes.contains('wl-cast')) {
        classes.remove('wl-cast', 'wl-cast-a', 'wl-cast-b', 'wl-cast-c');
        joined.forEach((slot, i) => { slot.className = slot.className.replace(/wl-c\d/, `wl-c${(i + casts) % 4 + 1}`); });
      }
      if (still.matches) return;
      // A Wiz joins each beat from 4 s; casts at 14 s, then every 10 s.
      if (beat > 1 && size <= most) join();
      else if (beat > 6 && (beat - 7) % 5 === 0) classes.add('wl-cast', `wl-cast-${'abc'[casts++ % 3]}`);
    }
    function onLine() {
      if (!alive()) return;
      line.classList.add('wl-out');
      clearTimeout(swap);
      swap = setTimeout(() => {
        line.textContent = lines[next++ % lines.length];
        line.classList.remove('wl-out');
      }, 320);
    }
    const timers = [setInterval(onBeat, 2000), setInterval(onLine, still.matches ? 4000 : 2500)];
    const stop = () => { timers.forEach(clearInterval); clearTimeout(swap); box._wl = null; };
    return (box._wl = { stop });
  }
  function markup(compact) {
    const box = make('div', 'wiz-loader');
    box.setAttribute('data-wiz-loader', compact ? 'compact' : '');
    box.innerHTML = `<div class="wl-stage" aria-hidden="true"><div class="wl-slot">${SVG}</div>`
      + '<div class="wl-shower"><i></i><i></i></div></div><p class="wiz-loader-line">Opening OpenWiz</p>';
    return box;
  }
  const mountAll = () => document.querySelectorAll('[data-wiz-loader]').forEach(box => mount(box));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
  else mountAll();
  window.WizLoader = { mount, markup, lines: LINES };
})();
