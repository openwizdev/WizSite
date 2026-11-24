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
  play.addEventListener('click', () => {
    play.hidden = true;
    video.controls = true;
    video.muted = false;
    video.focus();
    video.play().catch(() => {});
  }, { once: true });
}

function specVideo() {
  const video = document.querySelector('.spec-video');
  const sound = document.querySelector('.spec-play');
  const pause = document.querySelector('.demo-pause');
  if (!video || !sound) return;
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  let inView = false;
  let visitorDrives = false;
  let ownPlayEvents = 0;
  const frame = video.closest('.spec-frame');
  const track = video.textTracks[0];
  const resting = on => {
    frame?.classList.toggle('is-ambient', on);
    video.controls = !on;
    if (track) track.mode = on ? 'hidden' : 'showing';
  };
  const takeOver = () => { visitorDrives = true; resting(false); };
  const update = () => {
    if (visitorDrives) return;
    const ambient = inView && !calm.matches && pause.getAttribute('aria-pressed') !== 'true' && !document.hidden;
    if (ambient && video.paused) {
      ownPlayEvents += 1;
      video.muted = true;
      video.play().catch(() => { ownPlayEvents = 0; });
    } else if (!ambient && !video.paused) {
      ownPlayEvents += 1;
      video.pause();
    }
  };
  const take = () => {
    if (ownPlayEvents > 0) ownPlayEvents -= 1;
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
  sound.hidden = false;
  const listen = () => {
    takeOver();
    video.muted = false;
    video.loop = false;
    video.currentTime = 0;
    video.play().then(() => video.focus(), () => {});
  };
  sound.addEventListener('click', listen);
  video.addEventListener('click', () => { if (!video.controls) listen(); });
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

const ASK_KEYS = { text: 'text,type', sources: 'sources,type', done: 'type', not_covered: 'links,text,type', refused: 'message,reason,type' };
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
  await new Promise(resolve => {
    const near = new IntersectionObserver(seen => seen.some(e => e.isIntersecting) && (near.disconnect(), resolve()), { rootMargin: '600px 0px' });
    lists.forEach(list => near.observe(list));
  });
  const probe = await fetch('/api/ask', { cache: 'no-store' }).then(r => r.status === 200 ? r.json() : null).catch(() => null);
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
          links.forEach(([label, href], i) => {
            const link = Object.assign(el('a', '', label), { href });
            link.dataset.count = i === 0 ? 'book-call' : 'github';
            p.append(...(i ? [' · '] : []), link);
          });
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
          for (;;) {
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

function teamFactoryLog() {
  const log = document.querySelector('.team-log');
  if (!log) return false;

  const api = 'https://api.github.com';
  const github = 'https://github.com/openwizdev';
  const search = '/search/issues?q=repo:openwizdev/OpenWiz+is:issue+in:title+%22spec:%22&sort=updated&per_page=20';
  const issues = '/repos/openwizdev/OpenWiz/issues';
  const cacheKey = 'openwiz-team-factory-log-v1';
  const maxAge = 10 * 60 * 1000;
  const issueLink = /^https:\/\/github\.com\/openwizdev\/OpenWiz\/issues\/[1-9]\d*$/i;
  const prLink = /^https:\/\/github\.com\/openwizdev\/[\w.-]+\/pull\/[1-9]\d*$/i;
  const timePattern = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
  const isTime = value => typeof value === 'string' && timePattern.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value.replace('Z', '.000Z');
  const titleOK = title => typeof title === 'string' && title.trim() && title.length <= 256
    && !/\b(?:cloudroom|customers?|testimonial\w*|pricing|prices?|costs?|guarantee\w*|checkout|free|trusted|live|right now)\b|[$€£]\s*\d|\bper (?:month|seat|user)\b/i.test(title);
  const require = condition => {
    if (!condition) throw new Error('Invalid factory log data');
  };
  const isIssue = issue => issue && Number.isSafeInteger(issue.number) && issue.number > 0
    && titleOK(issue.title) && issueLink.test(issue.html_url) && issue.html_url.endsWith(`/${issue.number}`)
    && ['open', 'closed'].includes(issue.state);

  function readTicket(issue, timeline) {
    require(Array.isArray(timeline));
    const prs = new Map();
    let built = null;
    const closes = new Set();
    for (const event of timeline) {
      require(event && typeof event.event === 'string');
      if (event.event === 'commented') {
        require(typeof event.body === 'string');
        if (event.body.startsWith('launch-fleet: start') ||
            (event.body.includes('<!-- openwiz:status v1 -->') && /^\s*agent:\s*builder[ \t]*$/m.test(event.body))) {
          require(isTime(event.created_at));
          if (!built || event.created_at < built) built = event.created_at;
        }
      }
      if (event.event === 'closed') {
        require(isTime(event.created_at));
        closes.add(event.created_at);
      }
      if (event.event !== 'cross-referenced') continue;
      const source = event.source?.issue;
      require(source && typeof source.html_url === 'string');
      if (!source.pull_request || !source.html_url.toLowerCase().startsWith(`${github}/`)) continue;
      const { html_url: url, merged_at: merged } = source.pull_request;
      require(prLink.test(url) && url === source.html_url && new URL(url).href === url
        && Number.isSafeInteger(source.number) && url.endsWith(`/${source.number}`)
        && ['open', 'closed'].includes(source.state) && isTime(source.created_at)
        && (merged === null || isTime(merged)));
      prs.set(url, { url, opened: source.created_at, merged, state: source.state });
    }
    if (issue.state === 'closed') {
      require(isTime(issue.closed_at));
      closes.add(issue.closed_at);
    }
    return {
      title: issue.title, url: issue.html_url, built, closes: [...closes],
      state: issue.state, completed: issue.state === 'closed' && issue.state_reason === 'completed',
      prs: [...prs.values()],
    };
  }

  function validRun(run) {
    return run && titleOK(run.title) && issueLink.test(run.url)
      && Array.isArray(run.tickets) && run.tickets.length >= 2 && run.tickets.length <= 6
      && run.tickets.every(ticket => ticket && titleOK(ticket.title) && issueLink.test(ticket.url)
        && ['open', 'closed'].includes(ticket.state) && typeof ticket.completed === 'boolean'
        && (ticket.built === null || isTime(ticket.built)) && Array.isArray(ticket.closes)
        && ticket.closes.every(isTime) && Array.isArray(ticket.prs)
        && ticket.prs.every(pr => pr && prLink.test(pr.url) && new URL(pr.url).href === pr.url
          && isTime(pr.opened) && (pr.merged === null || isTime(pr.merged)) && ['open', 'closed'].includes(pr.state)));
  }

  const replayDate = time => `2026-11-${time}Z`;
  // From the public replay packet for OpenWiz #1927.
  const replay = {
    title: 'Infra spec: write-driver, a skill that writes your own driver',
    url: `${github}/OpenWiz/issues/1927`,
    tickets: [
      ['Infra WD1: the write-driver contract', 1928, '20T15:45:24', '20T19:03:28', [['OpenWiz', 1945, '20T15:57:37', '20T19:03:26']]],
      ['Infra WD2: the write-driver skill takes a user from paste to a passing driver (WizSkills 0.2.1)', 1929, '20T17:45:43', '21T01:27:35', [['WizSite', 118, '20T17:58:49', '21T01:28:08'], ['WizSkills', 212, '20T18:27:18', '21T01:27:33']]],
      ['Infra WD3: write-driver’s end-to-end eval against the template’s fake host (WizSkills 0.2.1)', 1931, '21T01:32:44', '21T04:36:55', [['WizSkills', 229, '21T02:00:06', '21T04:36:53']]],
      ['Infra WD4: the Drivers page’s Write your own driver copy line', 1932, '20T17:46:29', '21T01:28:10', [['WizSite', 118, '20T17:58:49', '21T01:28:08']]],
    ].map(([title, number, built, closed, prs]) => ({
      title, url: `${github}/OpenWiz/issues/${number}`, built: replayDate(built), closes: [replayDate(closed)],
      state: 'closed', completed: true,
      prs: prs.map(([repo, pr, opened, merged]) => ({
        url: `${github}/${repo}/pull/${pr}`, opened: replayDate(opened), merged: replayDate(merged), state: 'closed',
      })),
    })),
  };

  const nameOf = ticket => ticket.title.match(/^(?:\w+ )?([A-Z][A-Z0-9-]{0,3}\d{1,3})\b/)?.[1]
    ?? `#${ticket.url.split('/').at(-1)}`;
  const seen = (time, until) => time !== null && (until === null || time <= until);
  function stateOf(ticket, until) {
    const prs = ticket.prs.filter(pr => seen(pr.opened, until));
    const closed = until ? ticket.closes.some(time => seen(time, until)) : ticket.state === 'closed';
    if ((closed && ticket.completed) || (prs.length && prs.every(pr => seen(pr.merged, until)))) return ['merged', 'Merged', '✓'];
    if (prs.some(pr => until ? !seen(pr.merged, until) : pr.state === 'open')) return ['review', 'In review', '↗'];
    if (!closed && !prs.length && seen(ticket.built, until)) return ['building', 'Building', '…'];
    return ['waiting', 'Waiting', '○'];
  }

  function eventsOf(run) {
    const events = [];
    for (const ticket of run.tickets) {
      const add = (time, action, url, number) => {
        if (time) events.push({ time, action, url, number, name: nameOf(ticket) });
      };
      add(ticket.built, 'builder started', ticket.url);
      for (const time of ticket.closes) add(time, 'ticket closed', ticket.url);
      for (const pr of ticket.prs) {
        const number = pr.url.split('/').at(-1);
        add(pr.opened, 'opened', pr.url, number);
        add(pr.merged, 'merged', pr.url, number);
      }
    }
    return events.sort((a, b) => b.time.localeCompare(a.time));
  }

  const heading = log.querySelector('.team-log-heading a');
  const summary = log.querySelector('.team-log-tickets');
  const eventsList = log.querySelector('.team-log-events');
  const status = log.querySelector('.team-log-status');
  const still = [heading.cloneNode(true), ...[summary, eventsList].map(list => [...list.childNodes].map(node => node.cloneNode(true))), status.textContent];
  const make = (tag, text = '') => Object.assign(document.createElement(tag), { textContent: text });
  const quote = text => text.replaceAll("'", '’');
  const clock = time => time.slice(11, 16);

  function render(run, label, until = null) {
    heading.href = run.url;
    heading.textContent = quote(run.title);
    const names = new Intl.Collator('en', { numeric: true });
    summary.replaceChildren(...[...run.tickets].sort((a, b) => names.compare(nameOf(a), nameOf(b))).map(ticket => {
      const [state, label, marker] = stateOf(ticket, until);
      const link = Object.assign(make('a'), { href: ticket.url });
      link.setAttribute('aria-label', `${quote(ticket.title)} · ${label}`);
      link.title = label;
      const icon = make('span', marker);
      icon.dataset.state = state;
      link.append(`${nameOf(ticket)} `, icon);
      const item = make('li');
      item.append(link);
      return item;
    }));
    const rows = eventsOf(run).filter(event => seen(event.time, until)).slice(0, 8).map(event => {
      const { time, action, url, number, name } = event;
      const stamp = Object.assign(make('time', until ? `${time.slice(8, 10)} ${clock(time)}` : clock(time)), { dateTime: time });
      const message = make('span');
      const link = Object.assign(make('a', number ? `#${number}` : action), { href: url });
      if (number) message.append('pull request ', link, ` ${action}`);
      else message.append(link);
      const row = make('li');
      row.append(stamp, ' ', make('span', name), ' ', message);
      return row;
    });
    eventsList.replaceChildren(...(rows.length ? rows : [make('li', 'No recorded events yet')]));
    status.textContent = label;
  }

  let cached, replayIndex = -1;
  try {
    const saved = JSON.parse(localStorage.getItem(cacheKey));
    if (saved && Number.isSafeInteger(saved.readAt) && saved.readAt > 0 && saved.readAt <= Date.now() && validRun(saved.run)) cached = saved;
  } catch { /* Storage may be unavailable. */ }
  function current() {
    if (cached) {
      render(cached.run, `Live from GitHub · read ${clock(new Date(cached.readAt).toISOString())}`);
    } else {
      const [spec, tickets, events, label] = still;
      heading.href = spec.href;
      heading.textContent = spec.textContent;
      summary.replaceChildren(...tickets);
      eventsList.replaceChildren(...events);
      status.textContent = label;
    }
  }

  const steps = [...new Set(eventsOf(replay).map(event => event.time))].reverse();
  const actions = make('div');
  actions.className = 'team-log-actions';
  const toggle = Object.assign(make('button', 'Replay a real run'), { type: 'button' });
  const next = Object.assign(make('button', 'Next event'), { type: 'button' });
  const showReplay = () => {
    const done = replayIndex === steps.length - 1;
    render(replay, `Replay of a real run · 20–21 Nov 2026 UTC${done ? ' · Complete' : ''}`, steps[replayIndex]);
    next.setAttribute('aria-disabled', String(done));
  };
  toggle.addEventListener('click', () => {
    if (replayIndex < 0) {
      replayIndex = 0;
      toggle.textContent = 'Back to current spec';
      actions.append(next);
      showReplay();
    } else {
      replayIndex = -1;
      toggle.textContent = 'Replay a real run';
      next.remove();
      current();
    }
  });
  next.addEventListener('click', () => {
    if (replayIndex < steps.length - 1) {
      replayIndex++;
      showReplay();
    }
  });
  actions.append(toggle);
  status.after(actions);
  if (cached) current();

  const read = new AbortController();
  let attempted = false;
  async function get(path) {
    require(document.visibilityState === 'visible' && !read.signal.aborted);
    const response = await fetch(api + path, {
      credentials: 'omit', cache: 'no-store',
      signal: AbortSignal.any([read.signal, AbortSignal.timeout(5000)]),
    });
    require(response.status === 200);
    return response.json();
  }
  async function onVisibility() {
    if (document.visibilityState !== 'visible') {
      if (attempted) read.abort();
      return;
    }
    if (attempted || (cached && Date.now() - cached.readAt < maxAge)) return;
    attempted = true;
    try {
      const { items } = await get(search);
      require(Array.isArray(items) && items.every(item => item && ['open', 'closed'].includes(item.state)));
      const spec = items.find(item => item.state === 'open' && Number.isInteger(item.sub_issues_summary?.total)
        && item.sub_issues_summary.total >= 2 && item.sub_issues_summary.total <= 6);
      // Five or six timelines would exceed the six-request budget.
      require(isIssue(spec) && spec.sub_issues_summary.total <= 4);
      const tickets = await get(`${issues}/${spec.number}/sub_issues?per_page=20`);
      require(Array.isArray(tickets) && tickets.length === spec.sub_issues_summary.total && tickets.every(isIssue)
        && new Set(tickets.map(ticket => ticket.number)).size === tickets.length);
      const run = {
        title: spec.title, url: spec.html_url,
        tickets: await Promise.all(tickets.map(async ticket =>
          readTicket(ticket, await get(`${issues}/${ticket.number}/timeline?per_page=100`)))),
      };
      require(document.visibilityState === 'visible' && !read.signal.aborted && validRun(run));
      cached = { readAt: Date.now(), run };
      try { localStorage.setItem(cacheKey, JSON.stringify(cached)); } catch { /* Keep this read on screen. */ }
      if (replayIndex < 0) current();
    } catch {
      read.abort();
    }
  }
  document.addEventListener('visibilitychange', onVisibility);
  onVisibility();
  return true;
}

enableCopy();
askAWiz();
if (!teamFactoryLog()) showStars().catch(() => {});
launchVideo();
specVideo();
oneVoiceAtATime();
enableFamily(window.gsap);
if (window.gsap) enableMotion(window.gsap);
