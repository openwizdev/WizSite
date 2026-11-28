if (typeof navigator.sendBeacon === 'function') {
  const countActions = new Set(['install-copy', 'github', 'star', 'book-call', 'market', 'drivers', 'docs', 'x']);
  document.addEventListener('click', event => {
    const action = event.target.closest?.('[data-count]')?.dataset.count;
    if (countActions.has(action)) navigator.sendBeacon('/api/count', action);
  });
}

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
    demo.dataset.scene = index;
    setCrew(index, 0);
  };

  const loaded = new Promise(resolve => {
    if (document.readyState === 'complete') resolve();
    else addEventListener('load', resolve, { once: true, signal });
  });
  const near = new Promise(resolve => {
    const watch = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      watch.disconnect();
      resolve();
    }, { rootMargin: '400px 0px' });
    watch.observe(demo);
    signal.addEventListener('abort', () => watch.disconnect(), { once: true });
  });

  const start = async () => {
    await Promise.all([loaded, near]);
    if (signal.aborted) return;
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
  start().catch(() => {});
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

function oneVoiceAtATime() {
  const players = [...document.querySelectorAll('.launch-video, .spec-video')];
  const speaks = video => !video.paused && !video.muted;
  const silenceOthers = ({ target }) => {
    if (!speaks(target)) return;
    for (const other of players) if (other !== target && speaks(other)) other.pause();
  };
  for (const video of players) {
    video.addEventListener('playing', silenceOthers);
    video.addEventListener('volumechange', silenceOthers);
  }
}

function launchVideo() {
  const video = document.querySelector('.launch-video');
  const play = document.querySelector('.launch-play');
  if (!video || !play) return;
  video.controls = false;
  play.hidden = false;
  const start = event => {
    if (!event.isTrusted) return;
    play.removeEventListener('click', start);
    play.hidden = true;
    video.controls = true;
    video.muted = false;
    video.focus();
    video.play().catch(() => {});
  };
  play.addEventListener('click', start);
}

function specVideo() {
  const video = document.querySelector('.spec-video');
  const sound = document.querySelector('.spec-play');
  if (!video || !sound) return;
  const frame = video.closest('.spec-frame');
  const track = video.textTracks[0];
  frame?.classList.add('is-resting');
  video.controls = false;
  if (track) track.mode = 'hidden';
  sound.hidden = false;
  const listen = event => {
    if (!event.isTrusted || video.controls) return;
    frame?.classList.remove('is-resting');
    video.controls = true;
    if (track) track.mode = 'showing';
    video.muted = false;
    video.play().then(() => video.focus(), () => {});
  };
  sound.addEventListener('click', listen);
  video.addEventListener('click', listen);
}

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
      release();
      current = { wiz, timer: setTimeout(release, 900) };
      wear(wiz, (index + 1) % FAMILY.length);
      say(wiz, text);
      return;
    }
    if (Math.random() < .2) {
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
  const wave = wiz => {
    if (!moving() || current?.wiz === wiz) return;
    react(wiz, timeline => timeline.to(wiz, { rotation: -6, duration: .12, yoyo: true, repeat: 3,
      transformOrigin: '50% 90%', ease: 'sine.inOut' }));
  };
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

function enableCopy() {
  const box = document.querySelector('.install-box[data-install="live"]');
  if (!box) return;
  const button = box.querySelector('button.install');
  const code = box.querySelector('.install-line');
  const line = code.textContent;
  let timer;
  const selectLine = () => {
    const range = document.createRange();
    range.selectNodeContents(code);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  };
  const fallback = () => {
    selectLine();
    try { return document.execCommand('copy'); } catch { return false; }
  };
  button.textContent = 'Copy';
  button.disabled = false;
  button.addEventListener('click', async () => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(line);
      copied = true;
    } catch {
      copied = fallback();
    }
    button.textContent = copied ? 'Copied' : 'Line selected: copy it';
    clearTimeout(timer);
    timer = setTimeout(() => { button.textContent = 'Copy'; }, copied ? 2000 : 3000);
  });
}

const ASK_KEYS = { text: 'text,type', sources: 'sources,type', done: 'type', not_covered: 'links,text,type', refused: 'message,reason,type' };
const ASK_REFUSALS = {
  bad_request: [400, 'That question couldn\'t be read. Try again.'],
  not_human: [403, 'Please confirm you\'re human and try again.'],
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
const ASK_LINES = ['A Wiz is reading the docs', 'Flipping through the spellbook', 'Finding the right page',
  'Asking the other Wizes', 'Checking every source', 'Polishing the answer'];
const askKeys = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort().join() : '';
const askText = value => typeof value === 'string' && value.length > 0;
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
let turnstileScript = null;
const loadTurnstile = () => turnstileScript ??= new Promise(resolve => {
  const script = Object.assign(document.createElement('script'), { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', async: true });
  script.onload = () => resolve(window.turnstile ?? null);
  script.onerror = () => resolve(null);
  document.head.append(script);
});
function askGate(sitekey, container) {
  let widget = null, ready = null, waiting = [];
  const settle = value => { const all = waiting; waiting = []; all.forEach(resolve => resolve(value)); };
  const start = () => ready ??= loadTurnstile().then(turnstile => {
    if (!turnstile || !container.isConnected) return null;
    try {
      widget = turnstile.render(container, {
        sitekey, action: 'ask', appearance: 'interaction-only', size: 'flexible',
        callback: token => settle(token), 'error-callback': () => { settle(''); return true; },
      });
    } catch {
      widget = null;
    }
    return widget === null || widget === undefined ? null : turnstile;
  });
  return {
    start,
    token(signal) {
      if (signal?.aborted) return Promise.resolve('');
      return new Promise(resolve => {
        let settled = false;
        const done = value => {
          if (settled) return;
          settled = true;
          waiting = waiting.filter(fn => fn !== done);
          signal?.removeEventListener('abort', onAbort);
          resolve(value);
        };
        const onAbort = () => done('');
        signal?.addEventListener('abort', onAbort, { once: true });
        start().then(turnstile => {
          if (settled) return;
          if (!turnstile) return done('');
          const now = turnstile.getResponse(widget);
          if (now && !turnstile.isExpired(widget)) return done(now);
          waiting.push(done);
        });
      });
    },
    used() { if (widget !== null) window.turnstile?.reset(widget); },
    remove() { settle(''); if (widget !== null) window.turnstile?.remove(widget); widget = null; },
  };
}
async function askAWiz() {
  const lists = document.querySelectorAll('.faq .faq-rows');
  if (!lists.length) return;
  await new Promise(resolve => {
    const near = new IntersectionObserver(seen => seen.some(e => e.isIntersecting) && (near.disconnect(), resolve()), { rootMargin: '600px 0px' });
    lists.forEach(list => near.observe(list));
  });
  const probe = await fetch('/api/ask', { cache: 'no-store' }).then(r => r.status === 200 ? r.json() : null).catch(() => null);
  const keys = askKeys(probe);
  if ((keys !== 'enabled,max_question_chars,schema' && keys !== 'enabled,max_question_chars,schema,turnstile_site_key')
    || probe.schema !== 'openwiz.ask-a-wiz.v1' || probe.enabled !== true || probe.max_question_chars !== 300
    || (keys.endsWith('turnstile_site_key') && (typeof probe.turnstile_site_key !== 'string' || !/^[0-9A-Za-z_-]{1,100}$/.test(probe.turnstile_site_key)))) return;
  const sitekey = probe.turnstile_site_key;
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
    const status = el('p', 'sr-only');
    status.setAttribute('aria-live', 'polite');
    list.after(status);
    const addRow = () => {
      const n = ++made, row = el('div', 'faq-row faq-ask'), form = el('form', 'faq-ask-form'), input = el('input');
      const label = el('label', 'sr-only', 'Ask a Wiz a question about OpenWiz');
      Object.assign(input, { id: `faq-ask-${n}`, type: 'text', name: 'question', placeholder: 'Ask a Wiz...', autocomplete: 'off', enterKeyHint: 'send' });
      label.htmlFor = input.id;
      const go = el('button', 'faq-ask-go', 'Ask');
      form.append(label, input, go);
      const human = sitekey ? el('div', 'faq-ask-human') : null;
      const gate = human && askGate(sitekey, human);
      let inHuman = false;
      if (human) {
        form.append(human);
        for (const type of ['focusin', 'pointerdown', 'input']) form.addEventListener(type, gate.start, { once: true });
        human.addEventListener('focusin', () => { inHuman = true; });
        human.addEventListener('focusout', event => { if (event.relatedTarget && !human.contains(event.relatedTarget)) inHuman = false; });
      }
      const heading = el(level, 'faq-q'), answer = el('p', 'faq-ask-answer'), body = el('div', 'faq-a'), actions = el('div', 'faq-ask-actions');
      body.append(el('div'));
      body.firstChild.append(answer);
      const buttons = {};
      for (const name of ['Stop', 'Retry', 'Edit']) actions.append(buttons[name] = Object.assign(el('button', '', name), { type: 'button' }));
      row.append(heading, body, form, actions);
      list.append(row);
      let question = '', controller = null, wait = null, verifying = false;
      const waiting = on => {
        if (!on) {
          wait?._wl?.stop();
          wait?.remove();
          wait = null;
        }
        if (!on || wait || !window.WizLoader) return;
        wait = window.WizLoader.markup(true);
        window.WizLoader.mount(wait, { lines: ASK_LINES });
        wait.setAttribute('aria-hidden', 'true');
        answer.before(wait);
      };
      const show = (state, message = '', retry = true, focus = true) => {
        const inside = row.contains(document.activeElement);
        row.dataset.state = state;
        const idle = state === 'idle';
        label.hidden = input.hidden = go.hidden = !idle;
        form.hidden = !idle && !(state === 'asking' && verifying);
        heading.hidden = body.hidden = idle;
        heading.textContent = question;
        answer.textContent = message;
        waiting(state === 'asking');
        buttons.Stop.hidden = state !== 'asking';
        buttons.Retry.hidden = state !== 'ended' || !retry;
        buttons.Edit.hidden = state !== 'ended';
        actions.hidden = idle;
        if (!idle) status.textContent = state === 'asking' ? 'Ask a Wiz is answering.' : message;
        if (focus && inside) (idle ? input : state === 'asking' ? buttons.Stop : retry ? buttons.Retry : buttons.Edit).focus();
      };
      const finish = (paragraphs, links = []) => {
        waiting(false);
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
          links.forEach(([label, href], i) => {
            const link = Object.assign(el('a', '', label), { href });
            link.dataset.count = i === 0 ? 'book-call' : 'github';
            p.append(...(i ? [' · '] : []), link);
          });
          a.firstChild.append(p);
        }
        done.append(h, a);
        const inside = row.contains(document.activeElement);
        gate?.remove();
        row.replaceWith(done);
        status.textContent = paragraphs[0][0];
        const input = addRow();
        if (inside) input.focus({ preventScroll: true });
      };
      const ask = async () => {
        if (controller) return;
        const current = controller = new AbortController();
        inHuman = false;
        verifying = !!gate;
        show('asking');
        let text = '', sources = null, end = null;
        try {
          let token = '';
          if (gate) {
            token = await gate.token(current.signal);
            verifying = false;
            const keepFocus = form.contains(document.activeElement) || (inHuman && document.activeElement === document.body);
            inHuman = false;
            form.hidden = true;
            if (keepFocus) buttons.Stop.focus();
            if (current.signal.aborted) throw new Error('stopped');
            gate.used();
          }
          const response = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(gate ? { 'CF-Turnstile-Response': token } : {}) },
            body: JSON.stringify({ question }), cache: 'no-store', signal: current.signal });
          if (!/^application\/x-ndjson\s*(;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('not a stream');
          const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            for (let at; (at = buffer.indexOf('\n')) >= 0; buffer = buffer.slice(at + 1)) {
              if (end) throw new Error('data after the last event');
              const event = askEvent(buffer.slice(0, at), text, sources);
              if (event.type === 'text') waiting(false), answer.textContent = text += event.text;
              else if (event.type === 'sources') sources = event.sources.map(s => s.title);
              else end = event;
            }
          }
          const status = end?.type === 'refused' && !text ? ASK_REFUSALS[end.reason][0] : 200;
          if (buffer || response.status !== status) throw new Error('not the contract\'s response');
        } catch {
          end = null;
        }
        verifying = false;
        current.abort();
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

function browseMarket() {
  const root = document.querySelector('main.market');
  const tools = root?.querySelector('.market-tools');
  if (!tools) return;
  const cards = [...root.querySelectorAll('.market-card')];
  if (!cards.length) return;
  const search = tools.querySelector('#market-q');
  const live = tools.querySelector('.market-live');
  const clear = tools.querySelector('#market-clear-tag');
  let tag = '';
  const kind = () => tools.querySelector('input[name="market-kind"]:checked')?.id.replace('market-kind-', '') ?? 'all';
  const sortMode = () => tools.querySelector('input[name="market-sort"]:checked')?.id ?? 'market-sort-name';
  const nameOf = card => card.querySelector('h3')?.textContent ?? '';
  const byName = (a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true, sensitivity: 'base' });

  const apply = () => {
    const query = search.value.trim().toLowerCase();
    const selected = kind();
    const onlyVerified = tools.querySelector('#market-verified-only').checked;
    let shown = 0;
    for (const card of cards) {
      const tagOk = !tag || card.querySelector(`a[href="#tag-${tag}"]`);
      const kindOk = selected === 'all' || card.dataset.kind === selected;
      const statusOk = !onlyVerified || card.querySelector('[data-status="verified"]');
      const textOk = !query || card.textContent.toLowerCase().includes(query);
      const on = Boolean(tagOk && kindOk && statusOk && textOk);
      card.classList.toggle('is-out', !on);
      if (on) shown += 1;
    }
    const mode = sortMode();
    const rank = { driver: 0, harness: 1, skill: 2, other: 3 };
    const sorted = cards.slice().sort((a, b) => {
      if (mode === 'market-sort-verified') {
        const delta = Number(Boolean(b.querySelector('[data-status="verified"]'))) - Number(Boolean(a.querySelector('[data-status="verified"]')));
        if (delta) return delta;
      } else if (mode === 'market-sort-kind') {
        const delta = (rank[a.dataset.kind] ?? 9) - (rank[b.dataset.kind] ?? 9);
        if (delta) return delta;
      }
      return byName(a, b);
    });
    root.querySelector('.market-cards').append(...sorted);
    const filtering = Boolean(query || tag || selected !== 'all' || onlyVerified);
    root.classList.toggle('is-empty', shown === 0);
    root.classList.toggle('is-filtered', filtering);
    root.classList.toggle('is-tagged', Boolean(tag));
    clear.textContent = tag ? `Clear tag ${tag}` : 'Clear tag';
    live.textContent = filtering || mode !== 'market-sort-name' ? `Showing ${shown} of ${cards.length}` : '';
  };

  search.addEventListener('input', apply);
  tools.addEventListener('change', apply);
  clear.addEventListener('click', () => {
    tag = '';
    if (location.hash.startsWith('#tag-')) history.replaceState(null, '', location.pathname + location.search);
    apply();
  });
  const kindOfPill = { '#tag-driver': 'driver', '#tag-harness': 'harness', '#tag-skill': 'skill', '#by-tag': 'other' };
  root.addEventListener('click', event => {
    const anchor = event.target.closest('a');
    if (!anchor || !root.contains(anchor)) return;
    if (anchor.closest('.market-stats')) {
      event.preventDefault();
      const href = anchor.getAttribute('href');
      tag = '';
      if (location.hash.startsWith('#tag-')) history.replaceState(null, '', location.pathname + location.search);
      if (href === '#all-listings') {
        search.value = '';
        tools.querySelector('#market-kind-all').checked = true;
        tools.querySelector('#market-verified-only').checked = false;
      } else if (kindOfPill[href]) {
        tools.querySelector(`#market-kind-${kindOfPill[href]}`).checked = true;
      }
      apply();
      return;
    }
    if (!anchor.getAttribute('href')?.startsWith('#tag-')) return;
    event.preventDefault();
    tag = anchor.getAttribute('href').slice('#tag-'.length);
    apply();
    document.getElementById('all-listings')?.scrollIntoView({ block: 'nearest' });
  });
  const initial = location.hash.match(/^#tag-([a-z0-9-]+)$/);
  if (initial) tag = initial[1];
  apply();
}

enableCopy();
browseMarket();
askAWiz();
showStars().catch(() => {});
launchVideo();
specVideo();
oneVoiceAtATime();
const GSAP = document.currentScript?.dataset.gsap;
const startMotion = () => {
  enableFamily(window.gsap);
  if (window.gsap) enableMotion(window.gsap);
};
const loadMotion = () => {
  const script = document.createElement('script');
  script.src = GSAP;
  script.onload = script.onerror = startMotion;
  document.head.append(script);
};
if (!GSAP) startMotion();
else if (document.readyState === 'complete') loadMotion();
else addEventListener('load', loadMotion, { once: true });
