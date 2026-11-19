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
  const pulse = demo.querySelector('.work-pulse');
  const ring = pulse.querySelector('circle');
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
    const active = tickets.find(ticket => ticket.matches('.building, .review'));
    pulse.style.visibility = active ? 'visible' : 'hidden';
    active?.append(pulse);
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
      timeline.fromTo(ring, { scale: .65, opacity: .45 }, {
        scale: 1.3, opacity: .08, duration: .8, repeat: 2, ease: 'power1.out',
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
    tickets[1].append(pulse);
    pulse.removeAttribute('style');
    ring.removeAttribute('style');
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
    signal.addEventListener('abort', () => {
      pause.hidden = true;
    }, { once: true });
  };
  preference.addEventListener('change', configure);
  configure();
}

// The "Watch your spec" moment (#1405). The video loads only when it first plays. With motion it plays muted while it
// is in view; with reduced motion, Pause motion or the tab hidden it waits on its poster. It never starts with sound on
// its own: "Play with sound" does that on request, and from then on (or once the visitor uses its own controls) the
// visitor drives it and scrolling no longer starts or stops it. It needs only this script, not GSAP.
function specVideo() {
  const video = document.querySelector('.spec-video');
  const sound = document.querySelector('.spec-play');
  const pause = document.querySelector('.demo-pause');
  if (!video || !sound) return;
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  let inView = false;
  let visitor = false; // the visitor has taken over playback
  let ours = 0; // play and pause events we caused, not the visitor
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
    else visitor = true;
  };
  video.addEventListener('play', take);
  video.addEventListener('pause', take);
  video.addEventListener('volumechange', () => { if (!video.muted) visitor = true; });
  new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; update(); }, { threshold: .5 }).observe(video);
  calm.addEventListener('change', update);
  document.addEventListener('visibilitychange', update);
  pause.addEventListener('click', () => setTimeout(update));
  sound.hidden = false;
  sound.addEventListener('click', () => {
    visitor = true;
    video.muted = false;
    video.loop = false;
    video.currentTime = 0;
    video.play().catch(() => {});
  });
}

showStars().catch(() => {});
specVideo();
if (window.gsap) enableMotion(window.gsap);
