// The app's shell: sign-in, the repository picker, and the frame every page uses (navigation, read times,
// failed, partial and paused reads). Pages register with OW.page (pages/*.js); the shell routes by #/<page>.
'use strict';
(() => {
  const { h, icon, logo, time } = OW.ui;
  const data = OW.data;
  const root = document.getElementById('app');
  const ROUTES = () => OW.pages.map(page => page.id);
  let built = null; // the shell's live parts, once drawn

  const current = () => {
    const id = location.hash.replace(/^#\/?/, '');
    return OW.pages.find(page => page.id === id) || OW.pages[0];
  };

  // ---- Screens before the shell ----

  function screen(...children) {
    built = null;
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

  async function picker() {
    data.stop();
    screen(h('h1', {}, 'Pick a repository'), h('p', {}, 'Reading your repositories from GitHub…'));
    let repos;
    try {
      repos = await data.repositories();
    } catch (error) {
      if (error instanceof data.SignedOut) return signedOut('Your sign-in ended. Sign in again.');
      return screen(h('h1', {}, 'Pick a repository'),
        h('div', { class: 'notices' }, h('div', { class: 'notice bad', role: 'alert' }, icon('warn'),
          h('span', {}, h('b', {}, 'Couldn\'t read your repositories. '), 'GitHub didn\'t answer, so the list is unknown, not empty.'))),
        h('button', { class: 'btn', type: 'button', onclick: picker }, icon('refresh'), 'Try again'));
    }
    const list = h('ul', { class: 'repos' }, repos.map(r => h('li', {},
      h('button', { type: 'button', onclick: () => { data.repo.pick(r.full); location.hash = '#/you'; draw(); } }, r.full),
      h('span', { class: 'tag' }, r.private ? 'Private' : 'Public'))));
    screen(
      h('h1', {}, 'Pick a repository'),
      h('p', {}, repos.length ? 'The app opens straight to it on this device next time.' : 'The app can\'t see any repository yet.'),
      repos.length ? list : null,
      h('p', { class: 'small' }, 'Missing one? ', h('a', { href: 'https://github.com/settings/installations', rel: 'noreferrer' }, 'Choose repositories on GitHub'), ', then come back.'),
      h('p', { class: 'small' }, h('button', { class: 'btn', type: 'button', onclick: () => { data.auth.signOut(); signedOut(); } }, 'Sign out')),
    );
  }

  // ---- The shell ----

  function navLinks(kind) {
    return OW.pages.map((page, i) => {
      const badge = h('span', { class: 'badge', hidden: true });
      const link = h('a', { href: `#/${page.id}` }, icon(page.icon), h('span', {}, page.title), badge,
        kind === 'main' ? h('span', { class: 'key', 'aria-hidden': 'true', title: `Press ${i + 1}` }, String(i + 1)) : null);
      return { page, link, badge };
    });
  }

  function buildShell() {
    const picked = data.repo.get();
    const repoButton = () => h('button', { class: 'repo', type: 'button', 'aria-label': `Repository ${picked.full}. Change repository`, onclick: () => { data.repo.forget(); picker(); } },
      icon('repo'), h('span', { class: 'name' }, picked.full), icon('chevron'));
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
      h('a', { class: 'skip', href: '#content' }, 'Skip to the page'),
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

  // The read line for one feed: "Specs read 14:02", or why it isn't known.
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
    // Navigation: the current page, and each page's badge.
    for (const { page: p, link, badge } of [...built.side, ...built.tabs]) {
      if (p.id === page.id) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
      const count = p.badge?.(feeds);
      badge.hidden = !count;
      badge.textContent = count ? String(count) : '';
    }
    // Every feed's read time, and the GitHub limit.
    built.reads.replaceChildren(...Object.values(feeds).flatMap(feed => [h('div', {}, ...readLine(feed))]),
      h('div', {}, limit.remaining === null ? 'GitHub limit: not read yet' : `GitHub limit: ${limit.remaining.toLocaleString()} left`));
    for (const button of built.refresh) button.disabled = data.paused();
    // The page's own feeds: its read line, and a notice for each that failed, came back partial or is old.
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
    // The page itself: unknown if none of its feeds could ever be read; "reading" before the first read.
    if (mine.every(feed => feed.state === 'unknown')) {
      built.body.replaceChildren(OW.ui.unknown(`${page.title} couldn't be read from GitHub. The app tries again on its own, or press Refresh now.`));
    } else if (mine.some(feed => feed.state === 'loading') && !mine.some(feed => feed.data)) {
      built.body.replaceChildren(OW.ui.placeholder('Reading GitHub…'));
    } else {
      page.render(built.body, feeds);
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
    if (!ROUTES().includes(location.hash.replace(/^#\/?/, ''))) history.replaceState(null, '', `#/${OW.pages[0].id}`);
    if (!built) {
      buildShell();
      data.start();
    }
    update();
  }

  // ---- Start ----

  data.onChange(update);
  OW.onSignedOut = () => signedOut('Your sign-in ended. Sign in again.');
  window.addEventListener('hashchange', () => (built ? update() : null));
  // Super easy navigation: 1, 2, 3 jump to the pages (not while typing or with a modifier).
  document.addEventListener('keydown', event => {
    if (!built || event.altKey || event.ctrlKey || event.metaKey || /input|textarea|select/i.test(event.target.tagName)) return;
    const page = OW.pages[Number(event.key) - 1];
    if (page) location.hash = `#/${page.id}`;
  });

  async function boot() {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const state = params.get('state');
    // The code never stays in the address bar, history or a shared link.
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
