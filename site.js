async function showStars() {
  const response = await fetch('https://api.github.com/repos/openwizdev/OpenWiz');
  if (!response.ok) return;
  const { stargazers_count: count } = await response.json();
  if (!Number.isSafeInteger(count) || count < 0) return;
  const formatted = new Intl.NumberFormat(document.documentElement.lang).format(count);
  for (const value of document.querySelectorAll('[data-stars]')) {
    value.textContent = formatted;
    value.hidden = false;
    value.parentElement.setAttribute('aria-label', `Star on GitHub · ${formatted} ${count === 1 ? 'star' : 'stars'}`);
  }
}

const scenes = [
  { era: 'cave', label: 'Answering a few questions', states: [0, 0, 0] },
  { era: 'renaissance', label: 'Writing the spec', states: [0, 0, 0] },
  { era: 'samurai', label: 'Agents building the to-do app', states: [3, 1, 0] },
  { era: 'steam', label: 'Reviewing the changes', states: [3, 3, 2] },
  { era: 'astronaut', label: 'Merged · to-do app shipped', states: [3, 3, 3] },
];
const ticketStates = [
  ['waiting', 'Waiting'],
  ['building', 'Building'],
  ['review', 'In review'],
  ['merged', 'Merged'],
];

function showHero(gsap, paused, signal) {
  const demo = document.querySelector('.product-window');
  const status = demo.querySelector('.demo-status');
  const tickets = [...demo.querySelectorAll('.ember-ticket')];
  const metrics = [...demo.querySelectorAll('dd')];
  const steps = [...demo.querySelectorAll('.demo-steps i')];
  const mascot = demo.querySelector('.hero-sprite');
  const smoke = demo.querySelector('.hero-smoke');
  const fleet = [...demo.querySelectorAll('.hero-fleet span')];
  const builder = demo.querySelector('.ticket-builder');
  const stillStatus = status.textContent;
  const stillTickets = tickets.map(ticket => [ticket.className, ticket.querySelector('small').textContent]);
  const stillNumbers = metrics.map(metric => metric.textContent);
  const sheets = scenes.map(({ era }) => `/art/hero-${era}-frames.webp`);
  let timeline;

  const setFrame = (element, sheet, frame) => {
    element.style.backgroundImage = `url("${sheet}")`;
    element.style.backgroundPositionX = `${frame * 100 / 8}%`;
  };
  const setCrew = (scene, frame) => {
    const crewVisible = scene >= 2;
    for (const [i, member] of fleet.entries()) {
      member.style.backgroundPosition = `${frame * 100 / 3}% ${(scene * 2 + i) * 100 / 9}%`;
      member.style.visibility = crewVisible ? 'visible' : 'hidden';
    }
  };
  const setScene = (index) => {
    const scene = scenes[index];
    status.textContent = scene.label;
    const counts = [Number(index < 3), 0, 0, 0];
    for (const [i, ticket] of tickets.entries()) {
      const state = scene.states[i];
      const [name, label] = ticketStates[state];
      ticket.className = `ember-ticket ${name}`;
      ticket.querySelector('small').textContent = label;
      if (state > 0) counts[state] += 1;
    }
    metrics.forEach((metric, i) => { metric.textContent = counts[i]; });
    steps.forEach((step, i) => step.classList.toggle('active', i <= index));
    // Nothing downstream exists before its step: the stylesheet greys out the spec and tickets until then.
    demo.dataset.scene = index;
    setCrew(index, 0);
  };

  const start = async () => {
    await Promise.all([...sheets, '/art/fleet-frames.webp'].map(src => {
      const image = new Image();
      image.src = src;
      return image.decode();
    }));
    if (signal.aborted) return;

    timeline = gsap.timeline({ repeat: -1, paused: true });
    const duration = 3.8;
    for (const [index, sheet] of sheets.entries()) {
      const at = index * duration;
      const nextSheet = sheets[(index + 1) % sheets.length];
      timeline.call(() => {
        setScene(index);
        setFrame(mascot, sheet, 0);
        smoke.style.visibility = 'hidden';
        mascot.style.visibility = 'visible';
      }, [], at);
      timeline.call(() => setFrame(mascot, sheet, 1), [], at + .65);
      timeline.call(() => setFrame(mascot, sheet, 0), [], at + .78);
      for (let frame = 0; frame < 4; frame++) {
        timeline.call(() => {
          setFrame(mascot, sheet, frame + 2);
          setCrew(index, frame);
        }, [], at + 1.35 + frame * .21);
      }
      timeline.call(() => {
        setFrame(mascot, sheet, 0);
        setCrew(index, 0);
      }, [], at + 2.19);
      timeline.fromTo(builder, { rotation: -10 }, {
        rotation: 8, duration: .32, repeat: 7, yoyo: true, ease: 'sine.inOut', transformOrigin: '50% 85%',
      }, at + .1);
      // The smoke belongs to the outgoing costume. Hide the mascot only on the occlusion frame.
      timeline.call(() => {
        setFrame(smoke, sheet, 6);
        smoke.style.visibility = 'visible';
      }, [], at + duration - .34);
      timeline.call(() => {
        setFrame(smoke, sheet, 7);
        mascot.style.visibility = 'hidden';
        setFrame(mascot, nextSheet, 0);
      }, [], at + duration - .25);
      timeline.call(() => {
        setFrame(smoke, sheet, 8);
        mascot.style.visibility = 'visible';
      }, [], at + duration - .14);
    }
    timeline.call(() => { smoke.style.visibility = 'hidden'; }, [], sheets.length * duration);
    setScene(0);
    setFrame(mascot, sheets[0], 0);
    smoke.style.visibility = 'hidden';
    demo.classList.add('is-playing');
    update();
  };

  let visible = false;
  const update = () => timeline?.paused(!visible || paused() || document.hidden);
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    update();
  });
  observer.observe(demo);
  document.addEventListener('visibilitychange', update, { signal });
  start().catch(() => {}); // Keep the still if a sheet is unavailable.
  signal.addEventListener('abort', () => {
    observer.disconnect();
    timeline?.kill();
    demo.classList.remove('is-playing');
    status.textContent = stillStatus;
    tickets.forEach((ticket, i) => {
      ticket.className = stillTickets[i][0];
      ticket.querySelector('small').textContent = stillTickets[i][1];
    });
    metrics.forEach((metric, i) => { metric.textContent = stillNumbers[i]; });
    steps.forEach(step => step.classList.remove('active'));
    delete demo.dataset.scene;
    builder.removeAttribute('style');
  }, { once: true });
  return update;
}

function followPointer(gsap, paused, signal) {
  const family = document.querySelector('.family');
  const eyes = [[71,86],[71,85],[72,87],[72,86],[72,87],[72,87],
    [71,85],[72,86],[72,87],[72,86],[72,87],[71,86]];
  const pupils = [...family.querySelectorAll('.wiz-eye')].map((eye, i) => {
    eye.style.left = `${eyes[Math.floor(i / 2)][i % 2] / 1.6}%`;
    eye.style.top = '45.8%';
    const pupil = eye.firstElementChild;
    return { eye, x: gsap.quickTo(pupil, 'x', { duration: .26 }), y: gsap.quickTo(pupil, 'y', { duration: .26 }), pupil };
  });
  // Only update the pupils while the footer is on screen.
  let visible = false;
  let frame = 0;
  let pointer;
  let wave;
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    update();
  });
  observer.observe(family);
  function update() {
    const moving = visible && !paused();
    family.classList.toggle('is-playing', moving);
    wave?.kill();
    if (moving) {
      wave = gsap.to(family.children, {
        rotation: -5, y: -3, transformOrigin: '50% 90%', duration: .36, ease: 'sine.inOut',
        yoyo: true, repeat: 1, stagger: .055,
      });
    } else {
      gsap.set(family.children, { clearProps: 'transform,transformOrigin' });
    }
  }
  addEventListener('pointermove', event => {
    if (!visible || paused() || event.pointerType === 'touch') return;
    pointer = event;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!visible || paused()) return;
      for (const { eye, x, y } of pupils) {
        const rect = eye.getBoundingClientRect();
        const dx = pointer.clientX - rect.x - rect.width / 2;
        const dy = pointer.clientY - rect.y - rect.height / 2;
        const ratio = rect.width * .24 / Math.max(1, Math.hypot(dx, dy));
        x(dx * ratio);
        y(dy * ratio);
      }
    });
  }, { passive: true, signal });
  signal.addEventListener('abort', () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    visible = false;
    update();
    for (const { pupil, x, y } of pupils) {
      x.tween.kill();
      y.tween.kill();
      pupil.removeAttribute('style');
    }
  }, { once: true });
  return update;
}

function enableMotion(gsap) {
  const preference = matchMedia('(prefers-reduced-motion: no-preference)');
  const pause = document.querySelector('.demo-pause');
  let controller;

  const configure = () => {
    controller?.abort();
    if (!preference.matches) return;
    controller = new AbortController();
    const { signal } = controller;
    const isPaused = () => pause?.getAttribute('aria-pressed') === 'true';
    // Every site page shares the footer's eyes; only the landing has the hero demo and its Pause motion.
    const updateEyes = followPointer(gsap, isPaused, signal);
    if (!pause) return;
    const updateHero = showHero(gsap, isPaused, signal);
    pause.hidden = false;
    pause.addEventListener('click', () => {
      const paused = !isPaused();
      pause.setAttribute('aria-pressed', String(paused));
      pause.textContent = paused ? 'Resume motion' : 'Pause motion';
      updateHero();
      updateEyes();
    }, { signal });
    signal.addEventListener('abort', () => { pause.hidden = true; }, { once: true });
  };
  preference.addEventListener('change', configure);
  configure();
}

// The "Watch your spec" moment (#1405). The video loads only when it first plays. With motion it plays muted while it
// is in view; with reduced motion, Pause motion or the tab hidden it waits on its poster. It never starts with sound on
// its own: "Play with sound" (or a click on the frame) does that on request, and from then on the visitor drives it
// and scrolling no longer starts or stops it. Until then the frame stays clean: it shows only the slides' band, with no
// captions and no controls; the whole frame, its captions and the native controls (there for visitors without this
// script) come back once the visitor takes over. It needs only this script, not GSAP.
function specVideo() {
  const video = document.querySelector('.spec-video');
  const sound = document.querySelector('.spec-play');
  const pause = document.querySelector('.demo-pause');
  if (!video || !sound) return;
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  let inView = false;
  let visitor = false; // the visitor has taken over playback
  let ours = 0; // play and pause events we caused, not the visitor
  const frame = video.closest('.spec-frame');
  const track = video.textTracks[0];
  const resting = on => {
    frame?.classList.toggle('is-ambient', on);
    video.controls = !on;
    if (track) track.mode = on ? 'hidden' : 'showing';
  };
  const takeOver = () => { visitor = true; resting(false); };
  const update = () => {
    if (visitor) return;
    const ambient = inView && !calm.matches && pause.getAttribute('aria-pressed') !== 'true' && !document.hidden;
    if (ambient && video.paused) {
      ours += 1;
      video.muted = true;
      video.play().catch(() => { ours = 0; });
    } else if (!ambient && !video.paused) {
      ours += 1;
      video.pause();
    }
  };
  const take = () => {
    if (ours > 0) ours -= 1;
    else takeOver();
  };
  video.addEventListener('play', take);
  video.addEventListener('pause', take);
  video.addEventListener('volumechange', () => { if (!video.muted) takeOver(); });
  new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; update(); }, { threshold: .5 }).observe(video);
  calm.addEventListener('change', update);
  document.addEventListener('visibilitychange', update);
  pause.addEventListener('click', () => setTimeout(update));
  resting(true);
  // The muted loop starts at the opening slide, the poster's own frame, so the poster hands over without a jump.
  sound.hidden = false;
  const listen = () => {
    takeOver();
    video.muted = false;
    video.loop = false;
    video.currentTime = 0;
    // Focus moves into the player, so the keyboard reaches its pause control next, as #32's player did.
    video.play().then(() => video.focus(), () => {});
  };
  sound.addEventListener('click', listen);
  video.addEventListener('click', () => { if (!video.controls) listen(); });
}

// The footer Wizes react, one at a time and briefly; at rest the footer is unchanged. With reduced motion, Pause
// motion or no GSAP, a click is a still pose change (another costume) and the line, nothing moves.
const FAMILY = [
  ['Cave Wiz', 'era', 'thinking…', 'cave'], ['Builder Wiz', 'builder', 'building…'], ['Reviewer Wiz', 'reviewer', 'looks good!'],
  ['Samurai Wiz', 'era', 'building…', 'samurai'], ['Astronaut Wiz', 'orchestrator', 'shipped!'], ['Reviewer Wiz', 'reviewer', 'looks good!'],
  ['Orchestrator Wiz', 'orchestrator', 'next ticket!'], ['Builder Wiz', 'builder', 'building…'], ['Orchestrator Wiz', 'orchestrator', 'next ticket!'],
  ['Reviewer Wiz', 'reviewer', 'looks good!'], ['Builder Wiz', 'builder', 'building…'], ['Orchestrator Wiz', 'orchestrator', 'next ticket!'],
];
const POOF = '/art/hero-cave-frames.webp';

function enableFamily(gsap) {
  const family = document.querySelector('.family');
  const wizes = [...family.children];
  const preference = matchMedia('(prefers-reduced-motion: no-preference)');
  const pause = document.querySelector('.demo-pause');
  const moving = () => !!gsap && preference.matches && pause?.getAttribute('aria-pressed') !== 'true';
  const line = document.createElement('span');
  line.className = 'wiz-line';
  line.setAttribute('role', 'status');
  // The one reaction running now: its Wiz, and its timeline or timer. Every new reaction ends it first.
  let current = null;

  family.removeAttribute('aria-hidden');
  family.setAttribute('role', 'group');
  family.setAttribute('aria-label', 'The Wiz family');
  wizes.forEach((wiz, i) => {
    wiz.tabIndex = 0;
    wiz.setAttribute('role', 'button');
    wiz.setAttribute('aria-label', FAMILY[i][0]);
    const sprite = document.createElement('span');
    sprite.className = 'wiz-sprite';
    sprite.setAttribute('aria-hidden', 'true');
    wiz.append(sprite);
  });

  const picture = index => `/art/family-${String(index + 1).padStart(2, '0')}.webp`;
  const frame = (wiz, sheet, index) => {
    const sprite = wiz.querySelector('.wiz-sprite');
    sprite.style.backgroundImage = `url("${sheet}")`;
    sprite.style.backgroundPositionX = `${index * 100 / 8}%`;
    sprite.style.display = 'block';
  };
  // A costume change lasts only for its reaction; the Wiz keeps its own picture and name at rest.
  const wear = (wiz, index) => { wiz.querySelector('img').src = picture(index); };
  const release = () => {
    if (!current) return;
    const { wiz, timeline, timer } = current;
    current = null;
    timeline?.kill();
    clearTimeout(timer);
    gsap?.killTweensOf([wiz, line]);
    if (gsap) gsap.set(wiz, { clearProps: 'transform' });
    wiz.querySelector('.wiz-sprite').removeAttribute('style');
    wiz.classList.remove('is-acting');
    wear(wiz, wizes.indexOf(wiz));
    line.style.visibility = 'hidden';
  };
  const say = (wiz, text) => {
    line.textContent = text;
    line.removeAttribute('style');
    wiz.append(line);
  };
  // Starts one short reaction (under a second) on one Wiz, ending any other first.
  const react = (wiz, build, text) => {
    release();
    const timeline = gsap.timeline({ onComplete: () => { if (current?.timeline === timeline) release(); } });
    current = { wiz, timeline };
    build(timeline);
    if (text) {
      say(wiz, text);
      timeline.fromTo(line, { autoAlpha: 1 }, { autoAlpha: 0, duration: .2, immediateRender: false }, .6);
    }
  };

  const act = wiz => {
    const index = wizes.indexOf(wiz);
    const [, role, text, era] = FAMILY[index];
    if (!moving()) {
      // A still pose: another costume for a moment, with this Wiz's own line, then back.
      release();
      current = { wiz, timer: setTimeout(release, 900) };
      wear(wiz, (index + 1) % FAMILY.length);
      say(wiz, text);
      return;
    }
    if (Math.random() < .2) {
      // Now and then a poof, from the hero's own smoke frames, into another costume and back.
      const other = (index + 1 + Math.floor(Math.random() * (FAMILY.length - 1))) % FAMILY.length;
      react(wiz, timeline => timeline
        .call(() => frame(wiz, POOF, 6), [], 0)
        .call(() => { frame(wiz, POOF, 7); wear(wiz, other); }, [], .08)
        .call(() => frame(wiz, POOF, 8), [], .16)
        .call(() => frame(wiz, POOF, 6), [], .5)
        .call(() => { frame(wiz, POOF, 7); wear(wiz, index); }, [], .58)
        .call(() => frame(wiz, POOF, 8), [], .66)
        .call(() => { wiz.querySelector('.wiz-sprite').removeAttribute('style'); }, [], .76), 'poof!');
      return;
    }
    react(wiz, timeline => {
      if (role === 'era') {
        // The era Wizes play their work frames from the hero's sprite sheet.
        timeline.call(() => wiz.classList.add('is-acting'), [], 0);
        [2, 3, 4, 5].forEach((n, i) => timeline.call(() => frame(wiz, `/art/hero-${era}-frames.webp`, n), [], i * .14));
        timeline.call(() => { wiz.classList.remove('is-acting'); wiz.querySelector('.wiz-sprite').removeAttribute('style'); }, [], .6);
      } else if (role === 'builder') {
        timeline.to(wiz, { rotation: 7, y: 3, duration: .09, yoyo: true, repeat: 5, transformOrigin: '50% 90%', ease: 'power1.in' });
      } else if (role === 'reviewer') {
        timeline.to(wiz, { scale: 1.07, rotation: -4, duration: .18, transformOrigin: '50% 90%' })
          .to(wiz, { rotation: 4, duration: .2 }).to(wiz, { scale: 1, rotation: 0, duration: .16 });
      } else {
        timeline.to(wiz, { rotation: -9, duration: .11, yoyo: true, repeat: 5, transformOrigin: '50% 90%', ease: 'sine.inOut' });
      }
    }, text);
  };
  // Hover and focus: a short wave on that Wiz only; moving on ends it at once.
  const wave = wiz => {
    if (!moving() || current?.wiz === wiz) return;
    react(wiz, timeline => timeline.to(wiz, { rotation: -6, duration: .12, yoyo: true, repeat: 3,
      transformOrigin: '50% 90%', ease: 'sine.inOut' }));
  };
  // Entering the footer: the Wiz nearest the pointer hops once toward it.
  const perk = event => {
    if (event.pointerType === 'touch' || !moving()) return;
    const boxes = wizes.map(wiz => [wiz, wiz.getBoundingClientRect()]).filter(([, box]) => box.width);
    const [wiz, box] = boxes.reduce((best, item) =>
      Math.abs(event.clientX - item[1].left - item[1].width / 2) < Math.abs(event.clientX - best[1].left - best[1].width / 2) ? item : best);
    const toward = Math.sign(event.clientX - box.left - box.width / 2);
    react(wiz, timeline => timeline
      .to(wiz, { y: -5, rotation: toward * 3, duration: .15, transformOrigin: '50% 90%', ease: 'power2.out' })
      .to(wiz, { y: 0, rotation: 0, duration: .2, ease: 'power2.in' }));
  };

  for (const wiz of wizes) {
    wiz.addEventListener('click', () => act(wiz));
    wiz.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      act(wiz);
    });
    wiz.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') wave(wiz); });
    wiz.addEventListener('focus', () => { if (wiz.matches(':focus-visible')) wave(wiz); });
  }
  document.querySelector('.landing-footer').addEventListener('pointerenter', perk);
}

// The install box (#1357): Copy works only once index.html's switch says live; until then it stays disabled.
function enableCopy() {
  const box = document.querySelector('.install-box[data-install="live"]');
  if (!box || !navigator.clipboard) return;
  const button = box.querySelector('button.install');
  const line = box.querySelector('.install-line').textContent;
  let timer;
  button.textContent = 'Copy';
  button.disabled = false;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(line);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Select the line to copy';
    }
    clearTimeout(timer);
    timer = setTimeout(() => { button.textContent = 'Copy'; }, 2000);
  });
}

// The "Ask a Wiz..." row (#1902, contract openwiz.ask-a-wiz.v1): the FAQ's last row, added only when GET /api/ask
// answers the contract's probe (its switch, ASK_A_WIZ, is exactly "on"); anything else, the site's own page included,
// leaves the FAQ as it is. A question streams in; a finished answer becomes a normal row and a fresh input row follows.
// Everything from the stream is set as text; only the not-covered answer's links, exactly the contract's, are links.
const ASK_KEYS = { text: 'text,type', sources: 'sources,type', done: 'type', not_covered: 'links,text,type', refused: 'message,reason,type' };
// Each refusal's status and exact message, as the contract pins them.
const ASK_REFUSALS = {
  bad_request: [400, 'That question couldn\'t be read. Try again.'],
  too_long: [413, 'That question is too long. Keep it to 300 characters or fewer.'],
  rate_limited: [429, 'That\'s a lot of questions at once. Try again in a few minutes.'],
  daily_cap: [429, 'Ask a Wiz has answered all it can for today. Try again tomorrow.'],
  upstream_error: [502, 'Ask a Wiz couldn\'t answer just now. Try again.'],
  unavailable: [503, 'Ask a Wiz isn\'t available right now.'],
  store_error: [503, 'Ask a Wiz couldn\'t keep count just now. Try again.'],
  no_private_route: [503, 'Ask a Wiz can\'t answer privately just now. Try again later.'],
};
const ASK_NOT_COVERED = 'The OpenWiz docs don\'t cover that yet, so I won\'t guess. Book a call or open a GitHub issue, and we\'ll answer it.';
const ASK_LINKS = [['Book a call', 'https://openwiz.dev/team/#book'], ['GitHub issues', 'https://github.com/openwizdev/openwiz/issues']];
const askKeys = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort().join() : '';
const askText = value => typeof value === 'string' && value.length > 0;
// One line of the stream, read only in the contract's shape: each event with exactly its keys, in one of its orders
// (text, then sources, then done; not_covered alone; refused alone, or after text only as upstream_error), refusals
// with their exact message. Anything else throws, and the row treats the stream as broken.
function askEvent(line, text, sources) {
  const e = JSON.parse(line);
  const ok = askKeys(e) === ASK_KEYS[e?.type] && {
    text: () => !sources && askText(e.text),
    sources: () => text && !sources && Array.isArray(e.sources) && e.sources.length >= 1 && e.sources.length <= 6
      && new Set(e.sources.map(s => s?.url)).size === e.sources.length
      && e.sources.every(s => askKeys(s) === 'title,url' && askText(s.title) && /^https:\/\/(openwiz\.dev|github\.com\/openwizdev)\//.test(s.url)),
    done: () => !!sources,
    not_covered: () => !text && e.text === ASK_NOT_COVERED && Array.isArray(e.links) && e.links.length === ASK_LINKS.length
      && e.links.every((link, i) => askKeys(link) === 'href,label' && link.label === ASK_LINKS[i][0] && link.href === ASK_LINKS[i][1]),
    refused: () => !sources && Object.hasOwn(ASK_REFUSALS, e.reason) && e.message === ASK_REFUSALS[e.reason][1] && (!text || e.reason === 'upstream_error'),
  }[e.type]();
  if (!ok) throw new Error('not the contract\'s stream');
  return e;
}
async function askAWiz() {
  const lists = document.querySelectorAll('.faq .faq-rows');
  if (!lists.length) return;
  // Asked once, as the FAQ nears the screen: a visitor who never scrolls to it costs the function nothing.
  await new Promise(resolve => {
    const near = new IntersectionObserver(seen => seen.some(e => e.isIntersecting) && (near.disconnect(), resolve()), { rootMargin: '600px 0px' });
    lists.forEach(list => near.observe(list));
  });
  const probe = await fetch('/api/ask', { cache: 'no-store' }).then(r => r.status === 200 ? r.json() : null).catch(() => null);
  // Only the contract's exact on answer turns the row on.
  if (askKeys(probe) !== 'enabled,max_question_chars,schema' || probe.schema !== 'openwiz.ask-a-wiz.v1' || probe.enabled !== true
    || probe.max_question_chars !== 300) return;
  let made = 0;
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  for (const list of lists) {
    const faq = list.closest('.faq');
    const level = list.querySelector('.faq-q')?.tagName.toLowerCase() || 'h3';
    // One polite status line per FAQ, outside the rows, so every outcome is announced even as its row is replaced.
    const status = el('p', 'sr-only');
    status.setAttribute('aria-live', 'polite');
    list.after(status);
    const addRow = () => {
      const n = ++made, row = el('div', 'faq-row faq-ask'), form = el('form', 'faq-ask-form'), input = el('input');
      const label = el('label', 'sr-only', 'Ask a Wiz a question about OpenWiz');
      Object.assign(input, { id: `faq-ask-${n}`, type: 'text', name: 'question', placeholder: 'Ask a Wiz...', autocomplete: 'off', enterKeyHint: 'send' });
      label.htmlFor = input.id;
      form.append(label, input, el('button', 'faq-ask-go', 'Ask'));
      const heading = el(level, 'faq-q'), answer = el('p', 'faq-ask-answer'), body = el('div', 'faq-a'), actions = el('div', 'faq-ask-actions');
      body.append(el('div'));
      body.firstChild.append(answer);
      const buttons = {};
      for (const name of ['Stop', 'Retry', 'Edit']) actions.append(buttons[name] = Object.assign(el('button', '', name), { type: 'button' }));
      row.append(form, heading, body, actions);
      list.append(row);
      let question = '', controller = null;
      // idle: the input; asking: the question, its answer so far and Stop; ended: the question, a message, Retry and
      // Edit. When focus is in the row, it moves to the control that replaces the one just used, never to the page;
      // focus the visitor moved elsewhere stays there.
      const show = (state, message = '', retry = true, focus = true) => {
        const inside = row.contains(document.activeElement);
        row.dataset.state = state;
        form.hidden = state !== 'idle';
        heading.hidden = body.hidden = state === 'idle';
        heading.textContent = question;
        answer.textContent = message;
        buttons.Stop.hidden = state !== 'asking';
        buttons.Retry.hidden = state !== 'ended' || !retry;
        buttons.Edit.hidden = state !== 'ended';
        actions.hidden = state === 'idle';
        if (state !== 'idle') status.textContent = state === 'asking' ? 'Ask a Wiz is answering.' : message;
        if (focus && inside) (state === 'idle' ? input : state === 'asking' ? buttons.Stop : retry ? buttons.Retry : buttons.Edit).focus();
      };
      const finish = (paragraphs, links = []) => {
        const done = el('div', 'faq-row faq-asked'), h = el(level, 'faq-q'), button = el('button'), a = el('div', 'faq-a');
        button.append(el('span', 'faq-ask-label', question));
        Object.assign(button, { type: 'button', id: `faq-ask-q${n}`, disabled: !faq.hasAttribute('data-ready') });
        button.setAttribute('aria-expanded', 'true');
        button.setAttribute('aria-controls', a.id = `faq-ask-a${n}`);
        const chevron = list.querySelector('.faq-chevron');
        if (chevron) button.append(chevron.cloneNode(true));
        h.append(button);
        a.append(el('div'));
        for (const [text, className] of paragraphs) a.firstChild.append(el('p', className, text));
        if (links.length) {
          const p = el('p', 'faq-ask-links');
          links.forEach(([label, href], i) => p.append(...(i ? [' · '] : []), Object.assign(el('a', '', label), { href })));
          a.firstChild.append(p);
        }
        done.append(h, a);
        const inside = row.contains(document.activeElement);
        row.replaceWith(done);
        status.textContent = paragraphs[0][0];
        const input = addRow();
        if (inside) input.focus({ preventScroll: true });
      };
      const ask = async () => {
        controller = new AbortController();
        show('asking');
        let text = '', sources = null, end = null;
        try {
          const response = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question }), cache: 'no-store', signal: controller.signal });
          if (!/^application\/x-ndjson\s*(;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('not a stream');
          const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = '';
          for (;;) { // to the stream's end: nothing may follow the last event
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            for (let at; (at = buffer.indexOf('\n')) >= 0; buffer = buffer.slice(at + 1)) {
              if (end) throw new Error('data after the last event');
              const event = askEvent(buffer.slice(0, at), text, sources);
              if (event.type === 'text') answer.textContent = text += event.text;
              else if (event.type === 'sources') sources = event.sources.map(s => s.title);
              else end = event;
            }
          }
          const status = end?.type === 'refused' && !text ? ASK_REFUSALS[end.reason][0] : 200;
          if (buffer || response.status !== status) throw new Error('not the contract\'s response');
        } catch {
          end = null;
        }
        controller.abort();
        controller = null;
        if (end?.type === 'done') finish([[text], [`Sources: ${sources.join(', ')}`, 'faq-ask-sources']]);
        else if (end?.type === 'not_covered') finish([[end.text]], ASK_LINKS);
        else if (end?.type === 'refused') show('ended', end.message, end.reason !== 'too_long');
        else show('ended', 'stopped' in row.dataset ? 'Stopped.' : 'The answer didn’t finish. Try again.');
        delete row.dataset.stopped;
      };
      form.addEventListener('submit', event => {
        event.preventDefault();
        question = input.value.trim();
        if (question) ask();
      });
      buttons.Stop.addEventListener('click', () => { row.dataset.stopped = ''; controller?.abort(); });
      buttons.Retry.addEventListener('click', ask);
      buttons.Edit.addEventListener('click', () => { show('idle'); input.value = question; });
      show('idle', '', true, false);
      return input;
    };
    addRow();
  }
}

enableCopy();
askAWiz();
showStars().catch(() => {});
specVideo();
enableFamily(window.gsap);
if (window.gsap) enableMotion(window.gsap);
