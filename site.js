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
    const isPaused = () => pause.getAttribute('aria-pressed') === 'true';
    const updateHero = showHero(gsap, isPaused, signal);
    const updateEyes = followPointer(gsap, isPaused, signal);
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
  const moving = () => !!gsap && preference.matches && pause.getAttribute('aria-pressed') !== 'true';
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

// The silent spec sample plays only on request, so it stays available with reduced motion on or GSAP blocked.
function enableVideo() {
  const play = document.querySelector('.spec-play');
  const video = document.querySelector('.spec-video');
  const still = document.querySelector('.spec-screen');
  play.hidden = false;
  play.addEventListener('click', async () => {
    video.hidden = false;
    still.hidden = true;
    try {
      video.currentTime = 0;
      await video.play();
      video.focus();
    } catch {
      video.hidden = true;
      still.hidden = false;
    }
  });
}

showStars().catch(() => {});
enableVideo();
enableFamily(window.gsap);
if (window.gsap) enableMotion(window.gsap);
