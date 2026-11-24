const labels = {
  live: 'Passed live, not in a release yet',
  waiting: 'Built, waiting on its live check',
  review: 'In review',
  building: 'Being built',
  planned: 'Planned',
  held: 'Held',
  parked: 'Parked',
  verified: 'Verified',
  listed: 'Listed',
};

const hostIds = { local: 'vps', 'fly-sprites': 'sprites', 'github-codespaces': 'codespaces' };
const harnessIds = {
  'cline-cli': 'cline', 'copilot-cli': 'copilot', 'gemini-cli': 'gemini', 'junie-cli': 'junie',
  'kilo-code': 'kilo', 'kimi-code': 'kimi', 'kiro-cli': 'kiro', 'mistral-vibe': 'vibe', 'qwen-code': 'qwen',
};
const logos = {
  local: 'monitor.svg', 'boat-dev': 'boat-dev.svg', cloudroom: 'cloudroom.png', openclaw: 'openclaw.svg',
  hermes: 'hermes.png', conductor: 'conductor.svg', cursor: 'cursor.svg', factory: 'factory.svg', pane: 'pane.svg',
  openhands: 'openhands.svg', 'warp-oz': 'warp.svg', tembo: 'tembo.svg', capy: 'capy.svg', ona: 'ona.svg',
  amp: 'amp.svg', antigravity: 'antigravity.svg', auggie: 'augment.svg', crush: 'crush.png',
  'cursor-cli': 'cursor.svg', 'gemini-cli': 'gemini-cli.svg', goose: 'goose.png', 'kilo-code': 'kilo-code.svg',
  'kimi-code': 'kimi-code.svg', 'kiro-cli': 'kiro.svg', opencode: 'opencode.svg', pi: 'pi.svg',
  'qwen-code': 'qwen-code.svg', sculptor: 'sculptor.svg', 'warp-local': 'warp.svg', 'cline-cli': 'cline.svg',
};
const kitIcon = '<svg class="kit-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7"/><path d="M4.6 8.3l2.3 2.3 4.5-4.8"/></svg>';
const esc = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const attributes = listing => `data-listing="${listing.id}" data-stage="${listing.stage}" data-status="${listing.status}"`;
const shipped = listing => listing.stage === 'available' && listing.status === 'verified';
const login = listing => listing.login ? `<p class="driver-login">Login: ${esc(listing.login)}</p>` : '';
const dateLink = ({ url, date }, label, className = '') =>
  `<a${className ? ` class="${className}"` : ''} href="${esc(url)}">${label}, <time datetime="${date}">${date}</time></a>`;

function slot(page, name) {
  const start = `<template data-slot="drivers-${name}-start"></template>`;
  const end = `<template data-slot="drivers-${name}-end"></template>`;
  const [before, rest, duplicateStart] = page.split(start);
  const [fallback, after, duplicateEnd] = rest?.split(end) ?? [];
  if (after === undefined || duplicateStart !== undefined || duplicateEnd !== undefined || before.includes(end)) {
    throw new Error(`Drivers page requires exactly one complete ${name} slot`);
  }
  return { fallback, fill: contents => before + start + contents + end + after };
}

function logo(listing, size, className = '') {
  const file = Object.hasOwn(logos, listing.id) ? logos[listing.id] : 'monitor.svg';
  const alt = file === 'monitor.svg' ? 'Computer icon' : `${listing.name} logo`;
  return `<img${className ? ` class="${className}"` : ''} src="/drivers/logos/${file}" alt="${esc(alt)}"`
    + ` width="${size}" height="${size}"${className ? '' : ' loading="lazy"'}>`;
}

function hostMark(listing, id, fallback = '') {
  const mark = fallback.match(/<span class="host-mark">.*?<\/span>/)?.[0]
    ?? `<span class="host-mark">${logo(listing, 24, 'host-icon')}</span>`;
  const name = id === 'boat-dev' ? '' : `<span class="host-name">${esc(listing.name)}</span> `;
  return `<li data-host="${id}" data-state="passed" ${attributes(listing)}>`
    + `${mark}${name}<span class="host-state">passed 5 of 5</span></li>`;
}

function shippedCard(listing, id, fallback = '') {
  const mark = fallback.match(/<img class="driver-logo[^>]*>/)?.[0] ?? logo(listing, 24, 'driver-logo host-icon');
  const line = fallback.match(/<p class="driver-line">.*?<\/p>/)?.[0] ?? '<p class="driver-line">Passed all five checks</p>';
  return `<li><article class="driver" id="${id}" aria-labelledby="${id}-name" ${attributes(listing)}>`
    + `<h3 class="driver-name" id="${id}-name">${mark}<span>${esc(listing.name)}</span></h3>`
    + login(listing) + line + `<p class="driver-date">${dateLink(listing.proof.receipt, 'Kit run')}</p>`
    + `<p class="driver-kit passed" data-state="passed">${kitIcon}<span>Kit: passed, 5 of 5</span></p></article></li>`;
}

function spotlight(listing, fallback) {
  if (!listing || !shipped(listing)) return fallback;
  return fallback.replace('<article class="driver hero"', `<article class="driver hero" ${attributes(listing)}`)
    .replace(/(<h2 class="driver-name"[^>]*><img[^>]* alt=")[^"]*/, (_, opening) => opening + esc(listing.name))
    .replace(/<p class="driver-login">.*?<\/p>/, () => login(listing))
    .replace(/<p class="driver-date">.*?<\/p>/, () =>
      `<p class="driver-date">${dateLink(listing.proof.receipt, 'On a real account')}</p>`);
}

function tile(listing, id, previousState, fallback = '') {
  const receipt = listing.proof?.receipt;
  const work = listing.stage === 'being-built' ? listing.links[0] : undefined;
  const state = receipt ? (work ? 'live' : 'verified')
    : work ? (previousState && previousState !== 'live' ? previousState : 'building') : 'listed';
  const copy = {
    live: 'Passed its live check, 5 of 5 on a real host; not in a release yet',
    verified: 'Passed its live check, 5 of 5 on a real host',
    listed: 'Available, live check not verified',
  };
  const previousCopy = state === previousState ? fallback.match(/<p class="tile-state">([^<]*)<\/p>/)?.[1] : undefined;
  const words = copy[state] ?? previousCopy ?? labels[state];
  const mark = fallback.match(/<span class="tile-mark">.*?<\/span>/)?.[0]
    ?? `<span class="tile-mark">${logo(listing, 32)}</span>`;
  const href = work ?? (!receipt ? { url: listing.url, label: 'Get it' } : undefined);
  const workLink = href ? `<a class="tile-link" href="${esc(href.url)}">${esc(href.label)}</a>` : '';
  const proofLink = receipt ? dateLink(receipt, 'Live check receipt', 'tile-link') : '';
  const html = `<li class="tile" id="${id}" data-state="${state}" ${attributes(listing)}>`
    + `${mark}<h4 class="tile-name">${esc(listing.name)}</h4><p class="tile-state">${words}</p>`
    + login(listing) + `<p class="build-line">${esc(listing.summary)}</p>${workLink}${proofLink}</li>`;
  return { state, html };
}

function wall(name, fallback, listings, idFor, counts) {
  const groups = new Map(Object.keys(labels).map(state => [state, []]));
  const remaining = new Map(listings);
  for (const [html, id, state] of fallback.matchAll(/<li class="tile[^"]*" id="([^"]+)" data-state="([^"]+)">[\s\S]*?<\/li>/g)) {
    const listing = remaining.get(id);
    remaining.delete(id);
    if (name === 'hosts' && listing && shipped(listing)) continue;
    const row = listing ? tile(listing, id, state, html) : { state, html };
    groups.get(row.state).push(row.html);
  }
  for (const [, listing] of remaining) {
    if (name === 'hosts' && shipped(listing)) continue;
    const row = tile(listing, idFor(listing));
    groups.get(row.state).push(row.html);
  }
  const populated = [...groups].filter(([, rows]) => rows.length);
  const jump = populated.map(([state, rows]) =>
    `<a href="#${name}-${state}" data-state="${state}">${labels[state]} <span>${rows.length}</span></a>`).join('');
  const nav = fallback.match(/^<nav[^>]*>/)[0] + jump + '</nav>';
  const body = populated.map(([state, rows]) => {
    counts[state] = (counts[state] ?? 0) + rows.length;
    return `<div class="wall-group" id="${name}-${state}" data-state="${state}">`
      + `<h3 class="group-title">${labels[state]} <span class="group-count">${rows.length}</span></h3>`
      + `<ul class="tiles">${rows.join('\n')}</ul></div>`;
  });
  return [nav, ...body].join('\n    ');
}

function byPageId(listings, aliases) {
  const found = new Map();
  for (const listing of listings) {
    if (Object.hasOwn(aliases, listing.id)) found.set(aliases[listing.id], listing);
  }
  for (const listing of listings) {
    if (Object.hasOwn(aliases, listing.id)) continue;
    found.set(found.has(listing.id) ? `listing:${listing.id}` : listing.id, listing);
  }
  return found;
}

export function withDrivers(page, registry) {
  const drivers = registry.listings.filter(listing => listing.tags.includes('driver'));
  const harnesses = registry.listings.filter(listing => listing.tags.includes('harness') && !listing.tags.includes('driver'));
  if (!drivers.length && !harnesses.length) return page;

  const hosts = byPageId(drivers, hostIds);
  const existing = new Set([...page.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id));
  const generatedIds = new Map();
  const idFor = listing => {
    if (!generatedIds.has(listing.id)) {
      let id = listing.id;
      while (existing.has(id)) id = `driver-listing-${id}`;
      existing.add(id);
      generatedIds.set(listing.id, id);
    }
    return generatedIds.get(listing.id);
  };
  const marks = slot(page, 'marks');
  const knownShipped = new Set();
  const marksHtml = marks.fallback.replace(/<li data-host="([^"]+)"[^>]*>.*?<\/li>/g, (html, id) => {
    knownShipped.add(id);
    const listing = hosts.get(id);
    return !listing ? html : shipped(listing) ? hostMark(listing, id, html) : '';
  });
  const extraShipped = [...hosts].filter(([id, listing]) => !knownShipped.has(id) && shipped(listing));
  page = marks.fill(marksHtml + extraShipped.map(([, listing]) => hostMark(listing, idFor(listing))).join(''));

  const compact = slot(page, 'shipped');
  const cards = compact.fallback.replace(/<li>\s*<article class="driver" id="([^"]+)"[\s\S]*?<\/article>\s*<\/li>/g, (html, id) => {
    const listing = hosts.get(id);
    return !listing ? html : shipped(listing) ? shippedCard(listing, id, html) : '';
  });
  page = compact.fill(cards + extraShipped.map(([, listing]) => shippedCard(listing, idFor(listing))).join(''));
  const hero = slot(page, 'spotlight');
  page = hero.fill(spotlight(hosts.get('boat-dev'), hero.fallback));

  const counts = { shipped: [...knownShipped].filter(id => !hosts.has(id) || shipped(hosts.get(id))).length + extraShipped.length };
  const hostWall = slot(page, 'hosts');
  page = hostWall.fill(wall('hosts', hostWall.fallback, hosts, idFor, counts));
  const harnessWall = slot(page, 'harnesses');
  page = harnessWall.fill(wall('harnesses', harnessWall.fallback, byPageId(harnesses, harnessIds), idFor, counts));

  const tally = slot(page, 'tally');
  const tallied = tally.fallback.replace(/(<li data-state="([^"]+)"><b>)\d+/g, (_, prefix, state) => prefix + (counts[state] ?? 0));
  const extraTally = ['verified', 'listed'].filter(state => counts[state])
    .map(state => `<li data-state="${state}"><b>${counts[state]}</b> ${labels[state].toLowerCase()}</li>`).join('');
  return tally.fill(tallied + extraTally);
}
