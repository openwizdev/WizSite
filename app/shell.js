'use strict';
(() => {
  const { h, icon, time } = OW.ui;
  const logo = () => h('img', { src: '/app/mark.svg', alt: '', width: 28, height: 28 });
  const wiz = () => h('p', {}, h('img', { src: '/app/wiz-reviewer.svg', alt: '', width: 96, height: 105 }));
  const data = OW.data;
  const root = document.getElementById('app');
  const ROUTES = () => OW.pages.map(page => page.id);
  let built = null;
  const INSTALL = 'https://github.com/apps/openwiz-viewer/installations/new';

  const route = () => {
    const [id, arg] = location.hash.replace(/^#\/?/, '').split('/');
    return id === 'specs' && /^[1-9]\d*$/.test(arg || '') ? { id, arg } : { id: arg === undefined ? id : '', arg: null };
  };
  const current = () => {
    const { id } = route();
    return OW.pages.find(page => page.id === id) || OW.pages[0];
  };

  function screen(...children) {
    built = null;
    OW.palette.close();
    root.replaceChildren(h('div', { class: 'center' }, h('div', { class: 'panel' }, h('div', { class: 'brand' }, logo(), h('span', {}, 'OpenWiz')), ...children)));
    document.title = 'OpenWiz';
  }

  function signedOut(note) {
    data.stop();
    screen(
      h('h1', {}, 'Your factory, at a glance'),
      h('p', {}, 'See what needs you, every spec and the agents at work. Sign in to pick a repository.'),
      note ? h('div', { class: 'notices' }, h('div', { class: 'notice bad', role: 'alert' }, icon('warn'), h('span', {}, note))) : null,
      h('a', { class: 'btn primary', href: '/api/sign-in/start' }, 'Sign in with GitHub'),
      h('p', { class: 'small' }, 'Read-only, on the repositories you choose. Your sign-in stays in this browser; the app talks only to GitHub.'),
    );
  }

  const signOutButton = () => h('button', { class: 'btn', type: 'button', onclick: () => { data.auth.signOut(); signedOut(); } }, 'Sign out');

  async function picker() {
    data.stop();
    const session = data.auth.session();
    screen(h('h1', {}, 'Pick a repository'), h('p', {}, 'Reading your repositories from GitHub…'), h('p', { class: 'small' }, signOutButton()));
    let found;
    try {
      found = await data.repositories();
    } catch (error) {
      if (data.auth.session() !== session || error instanceof data.Ended) return;
      if (error instanceof data.SignedOut) return signedOut('Your sign-in ended. Sign in again.');
      return screen(h('h1', {}, 'Pick a repository'),
        h('div', { class: 'notices' }, h('div', { class: 'notice bad', role: 'alert' }, icon('warn'),
          h('span', {}, h('b', {}, 'Couldn\'t read your repositories. '), 'GitHub didn\'t answer, so the list is unknown, not empty.'))),
        h('p', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: picker }, icon('refresh'), 'Try again'), ' ', signOutButton()));
    }
    if (data.auth.session() !== session) return;
    const repos = found.repos;
    if (found.complete && found.installations === 0) {
      return screen(
        h('h1', {}, 'Pick a repository'),
        wiz(),
        h('p', {}, 'One more step: let OpenWiz Viewer read your repositories.'),
        h('a', { class: 'btn primary', href: INSTALL, rel: 'noreferrer' }, 'Install OpenWiz Viewer'),
        h('p', { class: 'small' }, 'On GitHub, pick the repositories it may read. GitHub brings you back here.'),
        h('p', { class: 'small' }, signOutButton()),
      );
    }
    const list = h('ul', { class: 'repos' }, repos.map(r => h('li', {},
      h('button', { type: 'button', onclick: () => { data.repo.pick(r.full); location.hash = '#/you'; draw(); } }, r.full),
      h('span', { class: 'tag' }, r.private ? 'Private' : 'Public'))));
    screen(
      h('h1', {}, 'Pick a repository'),
      found.complete ? null : h('div', { class: 'notices' }, h('div', { class: 'notice bad', role: 'alert' }, icon('warn'),
        h('span', {}, h('b', {}, 'Only part of your repositories could be read, '), 'so some may be missing. '),
        h('button', { class: 'btn', type: 'button', onclick: picker }, 'Try again'))),
      !repos.length && found.complete ? wiz() : null,
      h('p', {}, repos.length ? 'The app opens straight to it on this device next time.' : found.complete ? 'The app can\'t see any repository yet.' : 'None could be read.'),
      repos.length ? list : null,
      h('p', { class: 'small' }, 'Missing one? ', h('a', { href: 'https://github.com/settings/installations', rel: 'noreferrer' }, 'Choose repositories on GitHub'), ', then come back.'),
      h('p', { class: 'small' }, signOutButton()),
    );
  }

  function navLinks(kind) {
    return OW.pages.map((page, i) => {
      const badge = h('span', { class: 'badge', hidden: true });
      const link = h('a', { href: `#/${page.id}` }, icon(page.icon), h('span', {}, page.title), badge,
        kind === 'main' ? h('span', { class: 'key', 'aria-hidden': 'true', title: `Press ${i + 1}` }, String(i + 1)) : null);
      return { page, link, badge };
    });
  }

  let listing = null;
  function readRepositories() {
    const session = data.auth.session();
    if (listing?.session !== session) {
      const mine = { session, run: data.repositories() };
      listing = mine;
      mine.run.then(() => {}, () => {}).finally(() => { if (listing === mine) listing = null; });
    }
    return listing.run;
  }
  function switchTo(full) {
    if (full === data.repo.get()?.full) return;
    data.stop();
    data.repo.pick(full);
    if (route().arg) history.replaceState(null, '', `#/${route().id}`);
    const side = document.activeElement?.closest?.('.side, .top')?.classList.contains('top') ? '.top' : '.side';
    built = null;
    buildShell();
    data.start();
    update();
    root.querySelector(`${side} button.repo`)?.focus();
  }
  function repoSwitch(picked) {
    const list = h('div', { class: 'repo-list', hidden: true, id: `repos-${Math.random().toString(36).slice(2)}` });
    const close = () => { list.hidden = true; button.setAttribute('aria-expanded', 'false'); };
    const fill = async () => {
      const session = data.auth.session();
      list.replaceChildren(h('p', {}, 'Reading your repositories…'));
      let found;
      try {
        found = await readRepositories();
      } catch (error) {
        if (data.auth.session() !== session || error instanceof data.Ended) return;
        if (error instanceof data.SignedOut) return signedOut('Your sign-in ended. Sign in again.');
        return list.replaceChildren(h('p', { class: 'bad' }, 'Couldn\'t read your repositories, so the list is unknown, not empty.'),
          h('button', { class: 'btn', type: 'button', onclick: fill }, icon('refresh'), 'Try again'));
      }
      if (data.auth.session() !== session || list.hidden) return;
      list.replaceChildren(...[
        found.complete ? null : h('p', { class: 'bad' }, 'Only part of your repositories could be read, so some may be missing.'),
        h('ul', { class: 'repos' }, found.repos.map(r => h('li', {},
          h('button', { type: 'button', 'aria-current': r.full === picked.full ? 'true' : null, onclick: () => {
            close();
            if (r.full === picked.full) button.focus();
            else switchTo(r.full);
          } }, r.full),
          h('span', { class: 'tag' }, r.private ? 'Private' : 'Public')))),
        h('p', {}, h('a', { href: 'https://github.com/settings/installations', target: '_blank', rel: 'noreferrer' }, 'Choose repositories on GitHub'))].filter(Boolean));
      list.querySelector('button[aria-current]')?.focus();
    };
    const button = h('button', { class: 'repo', type: 'button', 'aria-expanded': 'false', 'aria-controls': list.id,
      'aria-label': `Repository ${picked.full}. Change repository`,
      onclick: () => {
        if (!list.hidden) return close();
        list.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        fill();
      } },
    icon('repo'), h('span', { class: 'name' }, picked.full), icon('chevron'));
    const wrap = h('div', { class: 'repo-switch', onkeydown: event => { if (event.key === 'Escape' && !list.hidden) { event.stopPropagation(); close(); button.focus(); } } }, button, list);
    wrap.addEventListener('focusout', event => { if (!wrap.contains(event.relatedTarget) && event.relatedTarget) close(); });
    return wrap;
  }

  function buildShell() {
    const picked = data.repo.get();
    const repoButton = () => repoSwitch(picked);
    const side = navLinks('main');
    const tabs = navLinks('tabs');
    const reads = h('div', { class: 'reads', 'aria-live': 'polite' });
    const refreshButton = () => h('button', { class: 'btn', type: 'button', onclick: () => data.refreshAll() }, icon('refresh'), 'Refresh now');
    const signOutButton = () => h('button', { class: 'btn', type: 'button', onclick: () => { data.auth.signOut(); signedOut(); } }, 'Sign out');
    const refresh = [refreshButton(), refreshButton()];
    const title = h('h1', { tabindex: '-1' });
    const read = h('p', { class: 'read' });
    const phoneReads = h('p', { class: 'phone-reads' });
    const notices = h('div', { class: 'notices', role: 'status' });
    const body = h('section', { class: 'page-body' });
    root.replaceChildren(
      h('a', { class: 'skip', href: '#content', onclick: event => { event.preventDefault(); title.focus(); } }, 'Skip to the page'),
      h('div', { class: 'shell' },
        h('aside', { class: 'side' },
          h('a', { class: 'brand', href: '#/you' }, logo(), h('span', {}, 'OpenWiz')),
          repoButton(),
          h('nav', { class: 'main', 'aria-label': 'Pages' }, side.map(item => item.link)),
          h('div', { class: 'foot' }, reads, h('div', { class: 'actions' }, refresh[0], signOutButton()))),
        h('header', { class: 'top' }, h('a', { class: 'brand', href: '#/you' }, logo(), h('span', {}, 'OpenWiz')), repoButton()),
        h('main', { id: 'content' }, h('div', { class: 'page-head' }, title, read), phoneReads, notices, body,
          h('div', { class: 'phone-actions' }, refresh[1], signOutButton())),
        h('nav', { class: 'tabs', 'aria-label': 'Pages' }, tabs.map(item => item.link))));
    built = { side, tabs, reads, refresh, title, read, phoneReads, notices, body, page: null };
  }

  function readLine(feed) {
    if (feed.state === 'loading') return [h('span', {}, `${feed.label}: reading…`)];
    if (feed.state === 'unknown') return [h('span', { class: 'bad' }, `${feed.label}: unknown (couldn't read at ${time(feed.failedAt)})`)];
    return [h('span', {}, `${feed.label} read `), h('b', {}, time(feed.readAt)), feed.state === 'stale' ? h('span', { class: 'bad' }, ' · last read failed') : null];
  }

  function notice(kind, iconName, strong, text) {
    return h('div', { class: `notice ${kind}` }, icon(iconName), h('span', {}, h('b', {}, strong), ' ', text));
  }

  function update() {
    if (!built) return;
    const page = current();
    const feeds = data.feeds;
    const limit = data.limit;
    for (const { page: p, link, badge } of [...built.side, ...built.tabs]) {
      if (p.id === page.id) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
      const count = p.badge?.(feeds);
      badge.hidden = !count;
      badge.textContent = count ? String(count) : '';
    }
    built.reads.replaceChildren(...Object.values(feeds).flatMap(feed => [h('div', {}, ...readLine(feed))]),
      h('div', {}, limit.remaining === null ? 'GitHub limit: not read yet' : `GitHub limit: ${limit.remaining.toLocaleString()} left`));
    for (const button of built.refresh) button.disabled = data.paused();
    const mine = page.feeds.map(name => feeds[name]);
    const latest = mine.filter(feed => feed.readAt).map(feed => feed.readAt);
    built.read.textContent = latest.length ? `Read ${time(Math.min(...latest))}` : '';
    built.phoneReads.replaceChildren(...mine.flatMap((feed, i) => [i ? ' · ' : '', ...readLine(feed)]).filter(part => part !== null && part !== ''));
    const notes = [];
    if (data.paused()) {
      notes.push(notice('slow', 'pause', 'GitHub\'s limit is low', `(${limit.remaining ?? 0} left). Reads are paused until ${time(limit.pausedUntil)}, then resume on their own.`));
    }
    for (const feed of mine) {
      if (feed.state === 'unknown') notes.push(notice('bad', 'warn', `Couldn't read ${feed.label} from GitHub`, `at ${time(feed.failedAt)}. It shows as unknown, not as empty, until a read works.`));
      if (feed.state === 'stale') notes.push(notice('bad', 'warn', `Couldn't read ${feed.label} at ${time(feed.failedAt)}.`, `Showing the read from ${time(feed.readAt)}.`));
      if (feed.state === 'partial') notes.push(notice('bad', 'warn', 'Part of this read failed', `(${feed.label}, ${time(feed.readAt)}). What's missing shows as unknown.`));
    }
    built.notices.replaceChildren(...notes);
    if (mine.every(feed => feed.state === 'unknown')) {
      built.body.replaceChildren(OW.ui.unknown(`${page.title} couldn't be read from GitHub. The app tries again on its own, or press Refresh now.`));
    } else if (mine.some(feed => feed.state === 'loading') && !mine.some(feed => feed.data)) {
      built.body.replaceChildren(OW.ui.placeholder('Reading GitHub…'));
    } else {
      page.render(built.body, feeds, route().arg);
    }
    if (built.page !== page.id) {
      built.title.textContent = page.title;
      document.title = `${page.title} · OpenWiz`;
      if (built.page !== null) built.title.focus();
      built.page = page.id;
    }
  }

  function draw() {
    if (!data.auth.signedIn()) return signedOut();
    if (!data.repo.get()) return picker();
    if (!ROUTES().includes(route().id)) history.replaceState(null, '', `#/${OW.pages[0].id}`);
    if (!built) {
      buildShell();
      data.start();
    }
    update();
  }

  data.onChange(update);
  OW.onSignedOut = () => signedOut('Your sign-in ended. Sign in again.');
  window.addEventListener('hashchange', () => (built ? update() : null));
  document.addEventListener('keydown', event => {
    if (!built) return;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      return OW.palette.toggle();
    }
    if (OW.palette.shown() || event.altKey || event.ctrlKey || event.metaKey || /input|textarea|select/i.test(event.target.tagName)) return;
    if (event.key === '?') {
      event.preventDefault();
      return OW.palette.shortcuts();
    }
    const page = OW.pages[Number(event.key) - 1];
    if (page) location.hash = `#/${page.id}`;
  });

  async function boot() {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (location.search) history.replaceState(null, '', `${location.pathname}${location.hash}`);
    if (code && state) {
      screen(h('h1', {}, 'Signing in…'), h('p', {}, 'Finishing your GitHub sign-in.'));
      try {
        await data.finishSignIn(code, state);
      } catch {
        return signedOut('Sign-in didn\'t finish. Try again.');
      }
    }
    draw();
  }
  boot();
})();
