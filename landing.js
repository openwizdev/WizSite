// The landing page's only script: it runs the hero intro once, offers Replay, and pauses
// ambient motion off screen. Everything that moves is CSS; with no script, or with reduced
// motion, the page shows the intro's final frame.
const stage = document.querySelector('#stage');
const replay = stage.querySelector('.replay');
const still = matchMedia('(prefers-reduced-motion: reduce)');
const INTRO_MS = 10000;

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

let timer;
function play() {
  clearTimeout(timer);
  replay.hidden = true;
  stage.removeAttribute('data-play');
  if (still.matches) return;
  void stage.offsetWidth; // restart every CSS animation from the first frame
  stage.setAttribute('data-play', '');
  timer = setTimeout(() => {
    stage.removeAttribute('data-play');
    replay.hidden = false;
  }, INTRO_MS);
}
replay.addEventListener('click', play);
still.addEventListener('change', play);

// Start once the text fonts and the first-frame art are in (or after 3 s at most), and only
// while the tab is visible, so the intro is not spent in a background tab.
const art = [...stage.querySelectorAll('.bay img, .city img')];
const loaded = Promise.all([document.fonts.ready, ...art.map(img => img.decode().catch(() => {}))]);
const visible = () => new Promise(resolve => {
  if (!document.hidden) return resolve();
  document.addEventListener('visibilitychange', function seen() {
    if (!document.hidden) { document.removeEventListener('visibilitychange', seen); resolve(); }
  });
});
Promise.race([loaded, new Promise(resolve => setTimeout(resolve, 3000))]).then(visible).then(() => {
  play();
  document.querySelector('main').dataset.ready = 'true';
});

// Pause ambient loops while their section is off screen.
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(entries => {
    for (const e of entries) e.target.classList.toggle('offscreen', !e.isIntersecting);
  });
  document.querySelectorAll('.view, .floor').forEach(el => io.observe(el));
}
