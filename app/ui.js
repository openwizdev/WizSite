'use strict';
(() => {
  const OW = (window.OW = window.OW || {});

  function h(tag, attrs = {}, ...children) {
    const el = document.createElementNS(tag === 'svg' || tag === 'path' || tag === 'circle' || tag === 'rect'
      ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml', tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key.startsWith('--')) el.style.setProperty(key, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  const STATES = {
    merged: { word: 'Merged', colour: 'var(--em-merged)' },
    review: { word: 'In review', colour: 'var(--em-review)' },
    building: { word: 'Building', colour: 'var(--em-building)' },
    ready: { word: 'Ready', colour: 'var(--em-ready)' },
    waiting: { word: 'Waiting', colour: 'var(--em-waiting)' },
    you: { word: 'Needs you', colour: 'var(--em-you)' },
    held: { word: 'Held', colour: 'var(--em-held)' },
    unknown: { word: 'Unknown', colour: 'var(--em-unknown)' },
  };

  const ICONS = {
    you: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c1.5-4 4.5-6 8-6s6.5 2 8 6',
    specs: 'M3 5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM14 5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2ZM3 16a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM14 17.5h7M17.5 14v7',
    agents: 'M3 12h4l3-8 4 16 3-8h4',
    models: 'm12 3 9 5-9 5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5',
    canvas: 'M3 4h7v6H3ZM14 4h7v6h-7ZM14 14h7v6h-7ZM10 7h4M17.5 10v4',
    repo: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3ZM5 17a3 3 0 0 1 3-3h11',
    chevron: 'm7 10 5 5 5-5',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
    warn: 'M12 3 2 20h20ZM12 10v4M12 17v.5',
    pause: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM10 9v6M14 9v6',
    refresh: 'M20 12a8 8 0 1 1-2.3-5.7L20 8M20 3v5h-5',
    chat: 'M21 12a8.5 8.5 0 0 1-8.5 8.5c-1.3 0-2.5-.3-3.6-.8L3 21l1.4-5.2A8.5 8.5 0 1 1 21 12Z',
    feed: 'M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Zm6 4.5 5 2.5-5 2.5v-5Z',
    settings: 'M4 6h16M9 4v4M4 12h16M15 10v4M4 18h16M11 16v4',
    check: 'M5 13l4 4L19 7',
    edit: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
    down: 'M12 5v14m0 0-5-5m5 5 5-5',
    up: 'M12 19V5m0 0-5 5m5-5 5 5',
    right: 'M5 12h14m0 0-5-5m5 5-5 5',
  };
  const icon = name => h('svg', { class: 'ic', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('path', { d: ICONS[name] }));
  const logo = () => h('svg', { viewBox: '0 0 1000 1000', 'aria-hidden': 'true' },
    h('circle', { cx: 500, cy: 638, r: 230, fill: '#e8b46a' }),
    h('path', { fill: '#e8b46a', d: 'M312 445 500 125c52-75 184-79 256 11 37 48 48 118 20 153-18 22-44 13-53-11-11-33-24-72-61-80-28-4-46 7-59 22l96 225Z' }),
    h('rect', { x: 187, y: 437, width: 626, height: 107, rx: 53, fill: '#e8b46a' }),
    h('circle', { cx: 443, cy: 561, r: 59, fill: '#1c1a17' }),
    h('circle', { cx: 574, cy: 561, r: 59, fill: '#1c1a17' }));

  function time(ms) {
    const at = new Date(ms);
    const clock = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return at.toDateString() === new Date().toDateString() ? clock
      : `${at.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${clock}`;
  }

  const HARNESSES = { 'claude-code': 'Claude Code', claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor', opencode: 'OpenCode' };
  const FAMILY = '(opus|sonnet|haiku|fable|sol)';
  const MODELS = [
    new RegExp(`^claude-${FAMILY}-(\\d+)-(\\d+)$`, 'i'),
    new RegExp(`^${FAMILY}[- ](\\d+)\\.(\\d+)$`, 'i'),
    new RegExp(`^gpt-(\\d+)\\.(\\d+)-${FAMILY}$`, 'i'),
  ];
  const EFFORT = /^(.*?)[- ](low|medium|high|xhigh|max)$/i;
  const title = word => `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`;
  function modelName(model) {
    const text = String(model);
    const effort = text.match(EFFORT);
    const base = effort ? effort[1] : text;
    for (const [i, pattern] of MODELS.entries()) {
      const m = base.match(pattern);
      if (!m) continue;
      const [family, major, minor] = i === 2 ? [m[3], m[1], m[2]] : [m[1], m[2], m[3]];
      return `${title(family)} ${major}.${minor}${effort ? ` ${effort[2] === 'xhigh' ? 'XHigh' : title(effort[2])}` : ''}`;
    }
    return text;
  }
  const agentName = (harness, model) => `${HARNESSES[String(harness).toLowerCase()] || harness}, ${modelName(model)}`;

  const ui = {
    h, icon, logo, time, STATES, agentName,
    pill: state => h('span', { class: 'pill', '--c': STATES[state].colour }, STATES[state].word),
    tiles: items => h('div', { class: 'tiles' }, items.map(item => h('div', { class: `tile${item.state === 'you' ? ' you' : ''}`, '--c': STATES[item.state]?.colour },
      h('div', { class: 'k' }, item.label), h('div', { class: 'v' }, item.value ?? '?')))),
    bar(counts) {
      if (!counts) return h('div', { class: 'bar unknown', role: 'img', 'aria-label': 'unknown' });
      const shown = Object.entries(counts).filter(([, n]) => n > 0);
      const el = h('div', { class: 'bar', role: 'img', 'aria-label': shown.map(([s, n]) => `${n} ${STATES[s].word.toLowerCase()}`).join(', ') },
        shown.map(([s]) => h('i', { '--c': STATES[s].colour, title: STATES[s].word })));
      shown.forEach(([, n], i) => { el.children[i].style.flex = String(n); });
      return el;
    },
    unknown: text => h('div', { class: 'unknown' }, h('b', {}, 'Unknown. '), text),
    placeholder: text => h('div', { class: 'placeholder' }, text),
  };
  const pages = [];
  OW.ui = ui;
  OW.pages = pages;
  OW.page = page => pages.push(page);
})();
