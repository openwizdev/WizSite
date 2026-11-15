// Prototype: three structurally different "one spec becomes many" transitions on one page (?variant=A|B|C).
// One conductor, render(t), draws every layer from the time t (seconds after the build ends).
const V = (new URLSearchParams(location.search).get('variant') || 'A').toUpperCase();
const NAMES_V = { A: 'A · Window to window', B: 'B · Cards multiply', C: 'C · Elevator cutaway', M: 'A + C · Items on the lines' };
const NAMES = ['Dark mode toggle', 'Invoice PDFs', 'Search across projects', 'Offline drafts', 'Two-step sign-in', 'Team mentions', 'Faster uploads', 'Calendar sync'];
const $ = id => document.getElementById(id);
const stage = $('stage'), world = $('world'), lit = $('lit'), bay = $('bay'), tiles = $('tiles'), section = $('section'), pills = $('pills');
const phone = innerWidth < 600;
const W = stage.clientWidth, H = stage.clientHeight;
const BAY = { x: 940, y: 893, w: 192, h: 120 }, BX = 1036, BY = 953;
const clamp = v => Math.max(0, Math.min(1, v));
const ease = v => v < .5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
const seg = (t, a, b) => ease(clamp((t - a) / (b - a)));
const lerp = (a, b, k) => a + (b - a) * k;
const zBay = W / BAY.w, zFloor = W / (phone ? 640 : 980), zAll = W / (phone ? 1300 : 1750);
const ALL = { x: 1200, y: phone ? 720 : 690, z: zAll }, BAYCAM = { x: BX, y: BY, z: zBay }, FLOOR = { x: BX, y: BY - (phone ? 120 : 170), z: zFloor };
let cam = BAYCAM;
const camLerp = (a, b, k) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), k)) });
function setCam(c) { cam = c; world.style.transform = `translate(${W / 2 - c.x * c.z}px,${H / 2 - c.y * c.z}px) scale(${c.z})`; }
const proj = (x, y) => [W / 2 + (x - cam.x) * cam.z, H / 2 + (y - cam.y) * cam.z];

Object.assign(bay.style, { left: BAY.x + 'px', top: BAY.y + 'px', width: BAY.w + 'px', height: BAY.h + 'px' });

// A bay interior with its own crew and work in progress (k picks the scene).
function crewHTML(k) {
  const b = ['builder-hammer-up', 'builder-carry', 'builder-hammer-down', 'builder-stand'];
  const item = ['item-1', 'item-2', 'item-3'][k % 3];
  return `<img class="hall" src="art/bay.webp" alt=""><img class="c" style="left:${8 + (k * 7) % 12}%" src="art/${b[k % 4]}.webp" alt=""><img class="it" style="left:${30 + (k * 11) % 14}%" src="art/${item}.webp" alt=""><img class="c" style="left:${52 + (k * 5) % 10}%" src="art/${k % 2 ? 'reviewer-look' : b[(k + 2) % 4]}.webp" alt="">`;
}
function pill(name, status, big) {
  const p = document.createElement('div');
  p.className = 'pill' + (big ? ' big' : '');
  p.innerHTML = `<i class="${status}"></i><span>${name}</span>` + (status === 'done' ? '<em>shipped</em>' : '');
  pills.append(p); return p;
}
function place(p, x, y, o, s = 1) { const hw = p.offsetWidth * s / 2 + 8; x = Math.max(hw, Math.min(W - hw, x)); p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.opacity = o; p.style.transform = `translate(-50%,-100%) scale(${s})`; }

let wins = [], strips = [], near = [], LINES = [];
async function setup() {
  const data = await (await fetch('windows.json')).json();
  LINES = await (await fetch('lines.json')).json();
  const mk = b => {
    const el = document.createElement('i');
    Object.assign(el.style, { left: b[0] + 'px', top: b[1] + 'px', width: b[2] - b[0] + 'px', height: b[3] - b[1] + 'px', backgroundPosition: `-${b[0]}px -${b[1]}px` });
    lit.append(el);
    return { el, x0: b[0], y0: b[1], cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, t: 99 };
  };
  wins = data.windows.map(mk); strips = data.strips.map(mk); strips.forEach(s => { s.strip = true; });
  const inBay = w => w.cx > BAY.x - 10 && w.cx < BAY.x + BAY.w + 10 && w.cy > BAY.y - 20 && w.cy < BAY.y + BAY.h + 20;
  for (const w of [...wins, ...strips]) if (inBay(w)) w.t = -1;
  // Group nearby windows into bays (clusters) that light together.
  const free = wins.filter(w => w.t > 0), groups = [];
  for (const w of free) {
    let g = groups.find(g => g.some(o => Math.abs(o.cx - w.cx) < 62 && Math.abs(o.cy - w.cy) < 50));
    if (g) g.push(w); else groups.push([w]);
  }
  const rest = groups.map(g => {
    const cx = g.reduce((a, w) => a + w.cx, 0) / g.length, cy = g.reduce((a, w) => a + w.cy, 0) / g.length;
    const area = g.reduce((a, w) => a + w.el.offsetWidth * w.el.offsetHeight, 0);
    const o = { g, cx, cy, y0: Math.min(...g.map(w => w.y0)), area, d: Math.abs(cx - BX) + 3 * Math.abs(cy - BY) };
    Object.defineProperty(o, 't', { get() { return g[0].t; }, set(v) { g.forEach(w => { w.t = v; }); } });
    return o;
  });
  rest.sort((a, b) => a.d - b.d);
  const sepX = phone ? 330 : 260, sepY = 130;
  for (const w of rest) {
    if (near.length >= (phone ? 2 : 4)) break;
    const dx = Math.abs(w.cx - BX), dy = BY - w.cy;
    if (w.area < 900 || (dx < 150 && dy < 150) || dx > (phone ? 320 : 480) || dy < -60 || dy > 380) continue;
    if (phone && dy < 170) continue;
    if (near.every(n => Math.abs(n.cx - w.cx) > sepX || Math.abs(n.cy - w.cy) > sepY)) near.push(w);
  }
  const far = rest.filter(w => !near.includes(w));
  const maxd = far[far.length - 1].d;
  BUILD[V](far, maxd);
}

// M (A + C): A's one continuous pull-back; every spec is an item riding its own line, named near the camera.
const NS = 'http://www.w3.org/2000/svg';
function lineAt(l, u) { return [l[0] + (l[2] - l[0]) * u, l[1] + (l[3] - l[1]) * u]; }
const BUILD = {
  M(far, maxd) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 2400 1350'); svg.setAttribute('class', 'mlines'); world.insertBefore(svg, bay);
    const ourLine = LINES.length - 2;
    // Named lines, nearest the bay first (fewer on the phone).
    const order = LINES.map((l, i) => ({ i, d: Math.hypot((l[0] + l[2]) / 2 - BX, (l[1] + l[3]) / 2 - BY) })).filter(o => o.i !== ourLine).sort((a, b) => a.d - b.d);
    const named = order.slice(0, phone ? 2 : 4).map(o => o.i);
    BUILD.M.lines = LINES.map((l, i) => {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', `M${l[0]} ${l[1]}L${l[2]} ${l[3]}`); path.setAttribute('pathLength', '1'); svg.append(path);
      const rank = order.findIndex(o => o.i === i);
      const t = i === ourLine ? 1.0 : named.includes(i) ? 2.1 + .5 * named.indexOf(i) : 3.9 + .12 * rank;
      const n = i === ourLine ? 1 : named.includes(i) ? 1 : 3;
      const items = [];
      for (let k = 0; k < n + (named.includes(i) ? 2 : 0); k++) {
        const el = document.createElement('img'); el.src = 'art/app.webp'; el.className = 'mitem'; world.insertBefore(el, bay);
        const isName = (named.includes(i) || i === ourLine) && k === 0;
        items.push({ el, k, isName, start: t + (isName ? 0 : .5 + k * .45), speed: i === ourLine ? .24 : .17 + .02 * (k % 3) });
      }
      const label = i === ourLine ? null : named.includes(i) ? pill(NAMES[named.indexOf(i) + 1], 'build') : null;
      return { l, i, path, t, items, label, ang: Math.atan2(l[3] - l[1], l[2] - l[0]) * 180 / Math.PI };
    });
    BUILD.M.ourLine = ourLine;
    near.forEach((w, i) => { w.t = 2.3 + .45 * i; });
    far.forEach((w, i) => { w.t = 3.9 + 1.7 * (w.d / maxd) + (i % 7) * .03; });
    strips.forEach(s => { if (s.t > 0) s.t = 4.1 + 1.3 * Math.abs(s.cx - BX) / 1100; });
  },

  A(far, maxd) {
    near.forEach((w, i) => { w.t = 2.1 + .45 * i; w.p = pill(NAMES[i + 1], 'build'); });
    far.forEach((w, i) => { w.t = 3.9 + 1.7 * (w.d / maxd) + (i % 7) * .03; });
    strips.forEach((s, i) => { if (s.t > 0) s.t = 4.3 + 1.3 * Math.abs(s.cx - BX) / 1100; });
  },
  B(far, maxd) {
    const n = phone ? 4 : 6, cols = phone ? 2 : 3;
    const tw = phone ? 168 : 250, th = tw / 1.6, gap = phone ? 34 : 40;
    const gx = (W - (cols * tw + (cols - 1) * 24)) / 2, gy = (H - (2 * th + gap)) / 2 + 12;
    const order = phone ? [0, 1, 2, 3] : [1, 0, 2, 3, 4, 5];
    BUILD.B.tiles = [];
    for (let k = 0; k < n; k++) {
      const cell = order[k], c = cell % cols, r = Math.floor(cell / cols);
      const el = document.createElement('div'); el.className = 'tile';
      el.innerHTML = crewHTML(k + 1); tiles.append(el);
      const target = k === 0 ? { x0: BAY.x + 70, y0: BAY.y + 40, cx: BX, cy: BY } : near[k - 1] || far[k * 7];
      if (k > 0 && target) target.t = 4.55 + .05 * k;
      BUILD.B.tiles.push({ el, x: gx + c * (tw + 24), y: gy + r * (th + gap), w: tw, h: th, k, target, p: pill(NAMES[k], k ? 'build' : 'done', false) });
    }
    far.forEach((w, i) => { if (w.t > 50) w.t = 4.8 + 1.4 * (w.d / maxd) + (i % 5) * .03; });
    strips.forEach(s => { if (s.t > 0) s.t = 5 + 1.1 * Math.abs(s.cx - BX) / 1100; });
  },
  C(far, maxd) {
    const cw = 192, ch = 120, gx = 16, gy = 34, cols = 3, rows = 4;
    BUILD.C.cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = -cols; c <= cols; c++) {
        const el = document.createElement('div'); el.className = 'cell';
        el.innerHTML = r === 0 && c === 0 ? '<img class="hall" src="art/bay.webp" alt="">' : crewHTML(r * 7 + c + 9);
        Object.assign(el.style, { left: c * (cw + gx) + 'px', top: -r * (ch + gy) + 'px', width: cw + 'px', height: ch + 'px' });
        section.append(el);
        const t = r === 0 && c === 0 ? -1 : r === 0 ? 1.7 + .32 * (Math.abs(c) - 1) + (c < 0 ? .16 : 0) : 2.5 + .45 * r + .1 * Math.abs(c);
        BUILD.C.cells.push({ el, r, c, t });
      }
      const slab = document.createElement('div'); slab.className = 'slab';
      Object.assign(slab.style, { left: -cols * (cw + gx) - 20 + 'px', top: -r * (ch + gy) + ch + 6 + 'px', width: (2 * cols + 1) * (cw + gx) + 24 + 'px' });
      section.append(slab);
    }
    const crew = bay.cloneNode(true); crew.removeAttribute('id');
    Object.assign(crew.style, { left: 0, top: 0, width: cw + 'px', height: ch + 'px', position: 'absolute' });
    section.append(crew);
    BUILD.C.labels = (phone ? [[1, 0, 1], [2, 1, 2]] : [[0, 1, 1], [0, -1, 2], [1, 0, 3], [0, 2, 4]]).map(([r, c, i]) => ({ r, c, p: pill(NAMES[i], 'build'), t: r === 0 ? 1.7 + .32 * (Math.abs(c) - 1) + (c < 0 ? .16 : 0) : 2.5 + .45 * r + .1 * Math.abs(c) }));
    far.concat(near).forEach((w, i) => { w.t = 4.7 + 1.3 * (w.d / maxd) + (i % 6) * .03; });
    strips.forEach(s => { if (s.t > 0) s.t = 4.9 + 1.1 * Math.abs(s.cx - BX) / 1100; });
    section.style.transformOrigin = '0 0';
  },
};

let ours;
function render(t) {
  if (!ours) ours = pill(NAMES[0], 'done', true);
  const winOn = w => {
    const k = w.t < 0 ? 1 : seg(t, w.t, w.t + .35);
    w.el.style.opacity = k;
    // A brass bloom when a window lights, settling to a faint glow.
    const pulse = w.strip ? 0 : w.t < 0 ? .35 : k * (.35 + .9 * Math.max(0, 1 - Math.abs(t - w.t - .3) / .6));
    w.el.style.boxShadow = k ? `0 0 ${10 + 14 * pulse}px ${2 + 4 * pulse}px rgba(232,168,73,${(.55 * pulse).toFixed(3)})` : 'none';
  };
  if (V === 'A') {
    setCam(t < 1 ? BAYCAM : t < 2.6 ? camLerp(BAYCAM, FLOOR, seg(t, 1, 2.6)) : t < 3.8 ? camLerp(FLOOR, { ...FLOOR, z: zFloor * .88 }, (t - 2.6) / 1.2) : camLerp({ ...FLOOR, z: zFloor * .88 }, ALL, seg(t, 3.8, 5.6)));
    bay.style.opacity = 1 - seg(t, 1.4, 2.1);
    [...wins, ...strips].forEach(winOn);
    const [ox, oy] = proj(BX, t < 1.6 ? BAY.y + 18 : BAY.y - 4);
    place(ours, ox, oy, 1 - .5 * seg(t, 5.2, 5.8), 1 - .25 * seg(t, 1.2, 2));
    near.forEach(w => { const [x, y] = proj(w.cx, w.y0 - 14); place(w.p, x, y, seg(t, w.t, w.t + .3) * (1 - seg(t, 4.5, 5)), .8 + .2 * seg(t, w.t, w.t + .3)); });
  }
  if (V === 'M') {
    const FL = { ...FLOOR, y: FLOOR.y + (phone ? 20 : 40) };
    setCam(t < 1 ? BAYCAM : t < 2.6 ? camLerp(BAYCAM, FL, seg(t, 1, 2.6)) : t < 3.8 ? camLerp(FL, { ...FL, z: zFloor * .86 }, (t - 2.6) / 1.2) : camLerp({ ...FL, z: zFloor * .86 }, ALL, seg(t, 3.8, 5.6)));
    bay.style.opacity = 1 - seg(t, 1.4, 2.1);
    [...wins, ...strips].forEach(winOn);
    for (const L of BUILD.M.lines) {
      const k = seg(t, L.t, L.t + .5);
      L.path.style.strokeDashoffset = 1 - k; L.path.style.opacity = .25 + .75 * k;
      for (const it of L.items) {
        const age = t - it.start;
        if (age < 0) { it.el.style.opacity = 0; continue; }
        const u = it.isName && L.i === BUILD.M.ourLine ? Math.min(.9, age * it.speed) : (age * it.speed + it.k * .31) % 1;
        const [x, y] = lineAt(L.l, u);
        it.el.style.opacity = Math.min(1, age / .3) * (u > .93 ? (1 - u) / .07 : 1);
        it.el.style.transform = `translate(${x}px,${y}px) rotate(${L.ang}deg) translate(-50%,-92%)`;
        if (it.isName && L.label) { const [px, py] = proj(x, y - 30); place(L.label, px, py, Math.min(1, age / .3) * (1 - seg(t, 4.6, 5.1)), .9); }
        if (it.isName && L.i === BUILD.M.ourLine) { const [px, py] = proj(x, y - 30); place(ours, px, py, 1 - .45 * seg(t, 5.2, 5.8), 1 - .2 * seg(t, 1.2, 2)); }
      }
    }

    if (t < 1.0) { const [ox, oy] = proj(BX, BAY.y + 18); place(ours, ox, oy, 1, 1); }
  }
  if (V === 'B') {
    setCam(ALL);
    world.style.opacity = seg(t, 3.2, 4.3);
    bay.style.opacity = 0;
    [...wins, ...strips].forEach(winOn);
    const full = { x: 0, y: (H - W / 1.6) / 2, w: W, h: W / 1.6 };
    for (const tl of BUILD.B.tiles) {
      let r = { x: tl.x, y: tl.y, w: tl.w, h: tl.h }, o = 1, s = 1;
      if (tl.k === 0) { const k = seg(t, 1, 1.9); r = { x: lerp(full.x, r.x, k), y: lerp(full.y, r.y, k), w: lerp(full.w, r.w, k), h: lerp(full.h, r.h, k) }; }
      else { const a = 1.9 + .28 * (tl.k - 1); o = seg(t, a, a + .3); s = .7 + .3 * o; }
      if (tl.target) {
        const k = seg(t, 3.5, 4.6), [tx, ty] = proj(tl.target.cx, tl.target.cy), tw = 30 * cam.z * 2.2, th = tw / 1.6;
        r = { x: lerp(r.x, tx - tw / 2, k), y: lerp(r.y, ty - th / 2, k), w: lerp(r.w, tw, k), h: lerp(r.h, th, k) };
        o *= 1 - seg(t, 4.35, 4.75);
      }
      Object.assign(tl.el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px', opacity: o, transform: `scale(${s})` });
      const pp = tl.k === 0 ? ours : tl.p;
      place(pp, r.x + r.w / 2, r.y - 8, o * (1 - seg(t, 3.3, 3.7)) + (tl.k === 0 ? 0 : 0), tl.k === 0 ? 1 - .2 * seg(t, 1, 1.9) : 1);
      if (tl.k === 0 && t < 1.9) place(ours, r.x + r.w / 2, r.y + 26 + (1 - seg(t, 1, 1.9)) * 20, 1, 1 - .2 * seg(t, 1, 1.9));
      if (tl.k === 0 && t >= 1.9) { place(ours, r.x + r.w / 2, r.y - 8, 1 - seg(t, 3.3, 3.7), .8); }
    }
    if (t > 4.6) { const [x, y] = proj(BX, BAY.y - 4); place(ours, x, y, seg(t, 4.7, 5.1) * .55, .8); }
  }
  if (V === 'C') {
    const C = BUILD.C, P = { x: 96, y: 60 };
    const s0 = { x: P.x, y: P.y, z: zBay }, s1 = { x: P.x, y: P.y - 20, z: W / ((phone ? 3 : 5) * 208) }, s2 = { x: P.x, y: -1.5 * 154 + 60, z: Math.min(H / (4.6 * 154), W / ((phone ? 3.2 : 6) * 208)) };
    const sc = t < 1 ? s0 : t < 2.2 ? camLerp(s0, s1, seg(t, 1, 2.2)) : t < 4.4 ? camLerp(s1, s2, seg(t, 2.2, 4.4)) : camLerp(s2, { ...s2, z: s2.z * .55 }, seg(t, 4.4, 5.6));
    section.style.transform = `translate(${W / 2 - sc.x * sc.z}px,${H / 2 - sc.y * sc.z}px) scale(${sc.z})`;
    section.style.opacity = 1 - seg(t, 4.6, 5.5);
    for (const cl of C.cells) { const k = cl.t < 0 ? 1 : seg(t, cl.t, cl.t + .4); cl.el.style.filter = `brightness(${.28 + .72 * k}) saturate(${.4 + .6 * k})`; }
    setCam(ALL); world.style.opacity = seg(t, 4.5, 5.5); bay.style.opacity = 0;
    [...wins, ...strips].forEach(winOn);
    const sp = (x, y) => [W / 2 + (x - sc.x) * sc.z, H / 2 + (y - sc.y) * sc.z];
    const [ox, oy] = sp(96, t < 1 ? 18 : -6);
    place(ours, ox, oy, 1 - seg(t, 4.3, 4.8), 1 - .2 * seg(t, 1, 2));
    for (const l of C.labels) { const [x, y] = sp(l.c * 208 + 96, -l.r * 154 - 6); place(l.p, x, y, seg(t, l.t, l.t + .3) * (1 - seg(t, 4.1, 4.6)), .9); }
    if (t > 5) { const [x, y] = proj(BX, BAY.y - 4); place(ours, x, y, seg(t, 5.1, 5.5) * .55, .8); }
  }
}

$('label').textContent = NAMES_V[V] || V;
const go = d => { const ks = ['A', 'B', 'C', 'M']; location.search = '?variant=' + ks[(ks.indexOf(V) + d + 4) % 4]; };
$('prev').onclick = () => go(-1); $('next').onclick = () => go(1);
addEventListener('keydown', e => { if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); });
let start = 0, raf;
function play() { cancelAnimationFrame(raf); start = performance.now(); const tick = () => { const t = (performance.now() - start) / 1000; render(Math.min(t, 7)); if (t < 7) raf = requestAnimationFrame(tick); }; tick(); }
$('play').onclick = play;
window.render = render;
setup().then(() => Promise.all([...document.images].map(i => i.decode().catch(() => {})))).then(() => { render(0); window.protoReady = true; if (!location.hash.includes('capture')) play(); else document.body.classList.add('capture'); });
