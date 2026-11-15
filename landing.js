// The landing page's only script. CSS runs the build beats (window, bay, crew); this conductor runs the
// camera pull-back from one spec to many, then the citadel's rest motion. With no script, or under reduced
// motion, the page shows one still frame: the whole lit citadel and the finished spec.
const stage = document.querySelector('#stage');
const view = stage.querySelector('.view');
const cam = stage.querySelector('.cam');
const city = stage.querySelector('.city');
const bay = stage.querySelector('.bay');
const lit = stage.querySelector('.lit');
const labels = stage.querySelector('.labels');
const replay = stage.querySelector('.replay');
const pauser = stage.querySelector('.pause');
const still = matchMedia('(prefers-reduced-motion: reduce)');
const phone = matchMedia('(max-width: 960px)');
const NS = 'http://www.w3.org/2000/svg';

const TS = 7.3;          // intro second where the pull-back starts (the bay has just shipped)
const PACE = .85;        // pull-back speed (its beats below are in its own seconds)
const INTRO = TS + 6.4 * PACE;
const NAMES = ['Invoice PDFs', 'Search across projects', 'Offline drafts', 'Two-step sign-in'];
// The citadel's lit conveyors, in its picture's pixels (2400 × 1350); the last two are drawn by hand.
const LINES = [[868, 626, 1114, 560], [1544, 596, 1716, 572], [1354, 594, 1504, 636], [580, 672, 848, 724], [1456, 736, 1664, 714], [942, 734, 1148, 766], [1754, 780, 1900, 768], [672, 890, 874, 798], [594, 805, 738, 805], [1322, 814, 1592, 848], [1460, 942, 1768, 842], [504, 866, 672, 926], [1112, 1004, 1712, 1036], [618, 992, 822, 958]];
const OURS = 12;
const BX = 1036, BY = 953;  // the lit bay window's centre

const clamp = v => Math.max(0, Math.min(1, v));
const ease = v => v < .5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
const seg = (t, a, b) => ease(clamp((t - a) / (b - a)));
const lerp = (a, b, k) => a + (b - a) * k;

// Split the typed idea into letters so CSS can type it.
const typed = stage.querySelector('.typed');
[...typed.textContent].forEach((c, i) => {
  const s = document.createElement('span');
  s.className = 'ch';
  s.style.setProperty('--i', i);
  s.textContent = c;
  typed.append(s);
});
typed.firstChild.remove();

// ---- Scene: lines, items, labels, the ring train, window groups ----
const svgEl = (name, attrs, parent) => { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.append(e); return e; };
const gLines = lit.querySelector('.lines'), gBlooms = lit.querySelector('.blooms');
const gItems = svgEl('g', { class: 'items' }, lit);
const gRing = lit.querySelector('.ring');
const pill = (name, cls) => { const p = document.createElement('span'); p.className = 'pill ' + cls; p.innerHTML = `<i></i>${name}` + (cls === 'ours' ? ' <em>shipped</em>' : ''); labels.append(p); return p; };
const oursPill = pill('Dark mode toggle', 'ours');

const groups = new Map();
for (const r of lit.querySelectorAll('mask rect')) {
  const g = +r.dataset.g;
  if (!groups.has(g)) groups.set(g, { rects: [], strip: 's' in r.dataset, x: 0, y: 0, n: 0 });
  const o = groups.get(g), x = +r.getAttribute('x') + r.getAttribute('width') / 2, y = +r.getAttribute('y') + r.getAttribute('height') / 2;
  o.rects.push(r); o.x += x; o.y += y; o.n++;
}
for (const o of groups.values()) { o.x /= o.n; o.y /= o.n; o.d = Math.abs(o.x - BX) + 3 * Math.abs(o.y - BY); }

const order = LINES.map((l, i) => ({ i, d: Math.hypot((l[0] + l[2]) / 2 - BX, (l[1] + l[3]) / 2 - BY) })).filter(o => o.i !== OURS).sort((a, b) => a.d - b.d);
let named = [];
const lines = LINES.map((l, i) => {
  const path = svgEl('path', { d: `M${l[0]} ${l[1]}L${l[2]} ${l[3]}`, pathLength: 1 }, gLines);
  const ang = Math.atan2(l[3] - l[1], l[2] - l[0]) * 180 / Math.PI;
  const n = i === OURS ? 1 : 3;
  const items = Array.from({ length: n }, (_, k) => ({ el: svgEl('image', { href: '/art/app.webp', width: 40, height: 30 }, gItems), k, speed: .15 + .025 * ((i + k) % 3) }));
  return { l, i, path, ang, items, rank: order.findIndex(o => o.i === i) };
});
const train = [0, 1, 2].map(() => svgEl('circle', { r: 5 }, gRing));
const bloom = svgEl('circle', { r: 46, fill: 'url(#bloom)', opacity: 0 }, gBlooms);

function layoutStory() {
  // Named lines nearest the bay (fewer on the phone); everything else lights later, outward.
  named = order.slice(0, phone.matches ? 2 : 4).map(o => o.i);
  labels.querySelectorAll('.pill:not(.ours)').forEach(p => p.remove());
  for (const L of lines) {
    const ni = named.indexOf(L.i);
    L.t = L.i === OURS ? 1 : ni >= 0 ? 2.1 + .5 * ni : 3.9 + .12 * L.rank;
    L.label = ni >= 0 ? pill(NAMES[ni], 'near') : null;
  }
  const bayIn = o => Math.abs(o.x - BX) < 110 && Math.abs(o.y - BY) < 80;
  const rest = [...groups.values()].filter(o => !bayIn(o));
  const maxd = Math.max(...rest.map(o => o.d));
  for (const o of groups.values()) {
    if (bayIn(o)) o.t = -1;
    else if (o.strip) o.t = 4.1 + 1.3 * Math.abs(o.x - BX) / 1100;
    else o.t = (o.d < 420 ? 2.2 + o.d / 420 * 1.6 : 3.9 + 1.7 * (o.d / maxd)) + (o.n % 5) * .03;
  }
}

// ---- Camera ----
let G; // geometry, measured with the camera at rest
function measure() {
  const prev = cam.style.transform; cam.style.transform = 'none';
  const v = cam.getBoundingClientRect(), c = city.getBoundingClientRect(), b = bay.getBoundingClientRect();
  cam.style.transform = prev;
  const cs = getComputedStyle(stage), num = k => parseFloat(cs.getPropertyValue(k));
  const W = v.width, H = v.height, k = c.width / 2400;
  const ox = c.left - v.left, oy = c.top - v.top;
  const bc = [b.left - v.left + b.width / 2, b.top - v.top + b.height / 2];
  G = {
    W, H, k, ox, oy,
    bay: { s: num('--D') * W / b.width, p: bc, c: [num('--cx') * W, num('--cy') * H] },
    floor: { s: W / (num('--F') * k), p: [bc[0], bc[1] - num('--fy') * k], c: [W / 2, H / 2] },
    rest: { s: 1, p: [W / 2, H / 2], c: [W / 2, H / 2] },
  };
}
const mix = (a, b, k) => ({ s: Math.exp(lerp(Math.log(a.s), Math.log(b.s), k)), p: [lerp(a.p[0], b.p[0], k), lerp(a.p[1], b.p[1], k)], c: [lerp(a.c[0], b.c[0], k), lerp(a.c[1], b.c[1], k)] });
let V = null;
function setView(v) {
  V = v;
  cam.style.transform = v.s === 1 && v.p[0] === v.c[0] && v.p[1] === v.c[1] ? '' : `translate(${v.c[0] - v.s * v.p[0]}px,${v.c[1] - v.s * v.p[1]}px) scale(${v.s})`;
}
const toScreen = (x, y) => { const s = V ? V.s : 1, tx = V ? V.c[0] - s * V.p[0] : 0, ty = V ? V.c[1] - s * V.p[1] : 0; return [tx + s * (G.ox + x * G.k), ty + s * (G.oy + y * G.k)]; };
// Label sizes are read once per layout (sizeLabels), so frames only write.
function sizeLabels() { for (const p of labels.children) { p._w = p.offsetWidth; p._h = p.offsetHeight; } }
function place(p, x, y, o, sc = 1) {
  if (o <= .01) { if (p._o !== 0) { p.style.opacity = 0; p._o = 0; } return; }
  const [sx, sy] = toScreen(x, y), hw = p._w * sc / 2 + 6;
  p._o = o;
  p.style.opacity = o.toFixed(3);
  p.style.transform = `translate(${Math.max(hw, Math.min(G.W - hw, sx)) - p._w / 2}px,${sy - p._h - 10}px) scale(${sc})`;
}
const at = (l, u) => [l[0] + (l[2] - l[0]) * u, l[1] + (l[3] - l[1]) * u];

// ---- One frame. t: seconds since the pull-back began (null = rest); now: wall clock seconds ----
let flip = null;
function frame(t, now) {
  const rest = t === null;
  if (!rest) {
    const FL = G.floor, FL2 = { ...FL, s: FL.s * .86 };
    setView(t < 1 ? G.bay : t < 2.6 ? mix(G.bay, FL, seg(t, 1, 2.6)) : t < 3.8 ? mix(FL, FL2, (t - 2.6) / 1.2) : mix(FL2, G.rest, seg(t, 3.8, 5.6)));
    bay.style.opacity = (1 - seg(t, 1.4, 2.1)).toFixed(3);
    for (const o of groups.values()) {
      const k = o.t < 0 ? 1 : seg(t, o.t, o.t + .35);
      for (const r of o.rects) r.setAttribute('fill-opacity', k.toFixed(3));
    }
  }
  // Window flips at rest: one group goes dark and returns to brass, as a spec finishes.
  if (rest && !still.matches) {
    if (!flip || now - flip.at > 2.6) {
      if (flip) for (const r of flip.o.rects) r.removeAttribute('fill-opacity');
      const pool = [...groups.values()].filter(o => !o.strip && o.t > 0);
      flip = { o: pool[Math.floor(Math.random() * pool.length)], at: now };
    }
    const a = now - flip.at, k = a < .5 ? 0 : seg(a, .5, 1.1);
    for (const r of flip.o.rects) r.setAttribute('fill-opacity', k.toFixed(3));
    const bl = bloom;
    bl.setAttribute('cx', flip.o.x); bl.setAttribute('cy', flip.o.y);
    bl.setAttribute('opacity', (k * Math.max(0, 1 - (a - 1.1) / .9)).toFixed(3));
  }
  for (const L of lines) {
    const lk = rest ? 1 : seg(t, L.t, L.t + .5);
    L.path.style.strokeDasharray = `${lk} 1`;
    L.path.style.opacity = rest ? '' : (.3 + .6 * lk * Math.max(.3, 1 - (t - L.t) / 2)).toFixed(3);
    for (const it of L.items) {
      const start = rest ? -99 : L.t + (it.k === 0 ? 0 : .5 + it.k * .45);
      const age = rest ? now : t - start;
      if (!rest && age < 0) { it.el.style.opacity = 0; continue; }
      const u = L.i === OURS ? Math.min(.9, rest ? .9 : age * .24) : ((rest ? now : age) * it.speed + it.k * .31 + L.i * .13) % 1;
      const [x, y] = at(L.l, u);
      const fade = L.i === OURS ? 1 : Math.min(1, u / .06, (1 - u) / .07);
      it.el.style.opacity = (rest ? fade : Math.min(1, age / .3) * fade).toFixed(3);
      it.el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${L.ang.toFixed(1)}) translate(-20 -27)`);
      if (it.k === 0 && L.label) place(L.label, x, y - 24, rest ? 0 : Math.min(1, age / .3) * (1 - seg(t, 4.6, 5.1)), .95);
      if (L.i === OURS) place(oursPill, x, y - 24, rest ? .9 : 1 - .1 * seg(t, 5.2, 5.8), rest ? .9 : 1 - .1 * seg(t, 1.2, 2));
    }
  }
  if (!rest && t < 1) place(oursPill, BX, BY - 50, 1);
  // The ring's train runs along the front of the ring once the whole citadel is in view.
  const tr = rest ? 1 : seg(t, 4.6, 5.4);
  train.forEach((c, i) => {
    const th = (((now / 9) + i * .012) % 1) * Math.PI;
    c.setAttribute('cx', (1190 - 330 * Math.cos(th)).toFixed(1));
    c.setAttribute('cy', (486 + 45 * Math.sin(th)).toFixed(1));
    c.style.opacity = (tr * Math.min(1, Math.sin(th) * 4)).toFixed(3);
  });
}

// ---- Playback ----
// The intro plays once per load (and on Replay); pausing shifts its start, so CSS and JS stay in step.
// Layout and preference changes only re-render the current state.
let raf = 0, playing = false, done = false, paused = false, visible = true, t0 = 0, pausedAt = 0;
const wall = () => performance.now() / 1000;
function loop() {
  raf = 0;
  if (!G) return;
  if (still.matches) { if (playing) stop(); return; } // settles to the still frame
  if (paused || !visible || document.hidden) return;
  const now = wall();
  if (playing) {
    const it = now - t0;
    if (it >= INTRO) { finish(); }
    else if (it < TS) {
      if (V !== G.bay) setView(G.bay);
      place(oursPill, BX, BY - 50, it > 6.9 ? seg(it, 6.9, 7.2) : 0);
    } else frame((it - TS) / PACE, now);
  }
  if (!playing) frame(null, now);
  raf = requestAnimationFrame(loop);
}
const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
function toRest() {
  playing = false;
  stage.removeAttribute('data-play');
  bay.style.opacity = '';
  setView(G.rest);
  for (const o of groups.values()) for (const r of o.rects) r.removeAttribute('fill-opacity');
  labels.querySelectorAll('.pill.near').forEach(p => { p.style.opacity = 0; p._o = 0; });
}
function finish() { toRest(); done = true; replay.hidden = false; }
function stop() { toRest(); done = true; replay.hidden = true; frame(null, 4); } // reduced motion: the still frame
function play() {
  replay.hidden = true;
  stage.removeAttribute('data-play');
  measure(); sizeLabels();
  if (still.matches) { stop(); return; }
  void stage.offsetWidth; // restart every CSS animation from the first frame
  stage.setAttribute('data-play', '');
  playing = true; done = false; t0 = wall(); pausedAt = t0; // a Pause pressed before startup holds the intro at its start
  setView(G.bay);
  for (const o of groups.values()) for (const r of o.rects) r.setAttribute('fill-opacity', o.t < 0 ? 1 : 0);
  for (const L of lines) { L.path.style.strokeDasharray = '0 1'; for (const it of L.items) it.el.style.opacity = 0; }
  train.forEach(c => { c.style.opacity = 0; });
  labels.querySelectorAll('.pill').forEach(p => { p.style.opacity = 0; p._o = 0; });
  if (flip) { for (const r of flip.o.rects) r.removeAttribute('fill-opacity'); bloom.setAttribute('opacity', 0); flip = null; }
  kick();
}
// Pause motion: one control for the hero's intro and rest motion and the factory loop (CSS and JS).
function setPaused(on) {
  if (on === paused) return;
  const now = wall();
  if (on) pausedAt = now; else t0 += now - pausedAt;
  paused = on;
  document.documentElement.classList.toggle('motion-paused', on);
  pauser.setAttribute('aria-pressed', String(on));
  kick();
}
pauser.addEventListener('click', () => setPaused(!paused));
replay.addEventListener('click', () => { setPaused(false); play(); });
// Preference and layout changes never replay the intro: they re-render where it is.
// Back to normal motion: offer Replay again (no autoplay) and resume the rest scene.
const onMotionPref = () => { if (still.matches) stop(); else { if (done) replay.hidden = false; kick(); } };
still.addEventListener('change', onMotionPref);
const relayout = () => {
  const wasPlaying = playing;
  if (wasPlaying) toRest();
  layoutStory(); measure(); sizeLabels();
  setView(G.rest);
  if (wasPlaying) finish();
  if (still.matches) frame(null, 4); else kick();
};
phone.addEventListener('change', relayout);
let rz;
addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { measure(); sizeLabels(); if (!playing) setView(G.rest); kick(); }, 150); });

// Start once the text fonts and the first-frame art are in (or after 3 s at most), and only
// while the tab is visible, so the intro is not spent in a background tab.
const art = [...stage.querySelectorAll('.bay img, .city img')];
const loaded = Promise.all([document.fonts.ready, ...art.map(img => img.decode().catch(() => {}))]);
const shown = () => new Promise(resolve => {
  if (!document.hidden) return resolve();
  document.addEventListener('visibilitychange', function seen() {
    if (!document.hidden) { document.removeEventListener('visibilitychange', seen); resolve(); }
  });
});
layoutStory();
Promise.race([loaded, new Promise(resolve => setTimeout(resolve, 3000))]).then(shown).then(() => {
  if (still.matches) { measure(); sizeLabels(); stop(); } else play();
  // A second list made after startup: some engines skip change events on the first one.
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', onMotionPref);
  document.querySelector('main').dataset.ready = 'true';
});
document.addEventListener('visibilitychange', kick);

// Pause motion while its section is off screen.
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      e.target.classList.toggle('offscreen', !e.isIntersecting);
      if (e.target === view) { visible = e.isIntersecting; kick(); }
    }
  });
  document.querySelectorAll('.view, .floor').forEach(el => io.observe(el));
}
