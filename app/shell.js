'use strict';
(async () => {
  const { h, icon, time } = OW.ui;
  const logo = () => h('img', { src: '/app/mark.svg', alt: '', width: 28, height: 28 });
  const wiz = () => h('p', {}, h('img', { src: '/app/wiz-reviewer.svg', alt: '', width: 96, height: 105 }));
  const data = OW.data;
  const root = document.getElementById('app');
  const ROUTES = () => OW.pages.map(page => page.id);
  let built = null;
  const INSTALL = 'https://github.com/apps/openwiz-viewer/installations/new';
  const v2 = Boolean(OW.records?.enabled?.());
  const demo = v2 && data.demo;
  if (v2) {
    const { v2Style, v2Script } = document.currentScript.dataset;
    const load = el => new Promise((resolve, reject) => {
      el.addEventListener('load', resolve, { once: true });
      el.addEventListener('error', reject, { once: true });
      document.head.append(el);
    });
    try {
      await Promise.all([
        load(h('link', { rel: 'stylesheet', href: v2Style })),
        load(h('script', { src: v2Script })),
      ]);
    } catch {
      root.replaceChildren(h('div', { class: 'center', role: 'alert' }, 'OpenWiz could not load. Reload to try again.'));
      return;
    }
    document.documentElement.dataset.v2 = '1';
  }
  const queue = OW.pages.findIndex(page => page.v2);
  if (queue >= 0) {
    const [page] = OW.pages.splice(queue, 1);
    if (v2 && !OW.v2) OW.pages.unshift(page);
  }
  const home = () => (v2 && OW.v2 ? '#/feed' : `#/${OW.pages[0].id}`);

  const route = () => {
    const [rawId, arg] = location.hash.replace(/^#\/?/, '').split('/');
    const id = v2 && OW.v2 && rawId === 'queue' ? 'feed' : rawId;
    if ((id === 'specs' || id === 'canvas') && /^[1-9]\d*$/.test(arg || '')) return { id, arg };
    if (v2 && OW.v2 && id === 'feed' && (/^[1-9]\d*$/.test(arg || '') || (demo && arg === 'clear'))) return { id, arg };
    return { id: arg === undefined ? id : '', arg: null };
  };
  const current = () => {
    const { id } = route();
    return OW.pages.find(page => page.id === id) || OW.pages.find(page => page.id === 'feed') || OW.pages[0];
  };

  function screen(...children) {
    built = null;
    OW.palette.close();
    const view = h('div', { class: 'center' }, h('div', { class: 'panel' }, h('div', { class: 'brand' }, logo(), h('span', {}, 'OpenWiz')), ...children));
    if (v2 && OW.v2) {
      root.replaceChildren(
        h('div', { class: 'v2-backdrop', 'aria-hidden': 'true' }),
        h('div', { class: 'v2-welcome-stage' }, view));
    } else {
      root.replaceChildren(view);
    }
    document.title = 'OpenWiz';
    return view;
  }

  function signedOut(note) {
    data.stop();
    if (v2 && OW.v2) {
      built = null;
      OW.palette.close();
      return OW.v2.renderWelcome(root, { note, demoMode: false });
    }
    screen(
      h('h1', {}, 'Your factory, at a glance'),
      h('p', {}, 'See what needs you, every spec and the agents at work. Sign in to pick a repository.'),
      note ? h('div', { class: 'notices' }, h('div', { class: 'notice bad', role: 'alert' }, icon('warn'), h('span', {}, note))) : null,
      h('a', { class: 'btn primary', href: '/api/sign-in/start' }, 'Sign in with GitHub'),
      h('p', { class: 'small' }, v2
        ? 'On the repositories you choose, it posts only the comments you see and confirm. Your sign-in stays in this browser; the app talks only to GitHub.'
        : 'Read-only, on the repositories you choose. Your sign-in stays in this browser; the app talks only to GitHub.'),
    );
  }

  const signOutButton = () => h('button', { class: 'btn', type: 'button', onclick: () => { data.auth.signOut(); signedOut(); } }, 'Sign out');

  async function picker() {
    data.stop();
    const session = data.auth.session();
    const view = screen(h('h1', {}, 'Pick a repository'), h('p', {}, 'Reading your repositories from GitHub…'), h('p', { class: 'small' }, signOutButton()));
    let found;
    try {
      found = await data.repositories();
    } catch (error) {
      if (!view.isConnected) return;
      const now = data.auth.session();
      if (now === null && (error instanceof data.SignedOut || error instanceof data.Ended)) return OW.onSignedOut();
      if (now !== session || error instanceof data.Ended) return;
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
      h('button', { type: 'button', onclick: () => { data.repo.pick(r.full); location.hash = home(); draw(); } }, r.full),
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
    root.querySelector(v2 ? '.v2-settings button.repo' : `${side} button.repo`)?.focus();
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
        if (!list.isConnected) return;
        const now = data.auth.session();
        if (now === null && (error instanceof data.SignedOut || error instanceof data.Ended)) return OW.onSignedOut();
        if (now !== session || error instanceof data.Ended) return;
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

  function freshnessNodes() {
    const feeds = v2 ? [data.feeds.specs, data.feeds.agents] : Object.values(data.feeds);
    const limit = data.limit;
    return [
      ...feeds.map(feed => h('div', {}, ...readLine(feed))),
      h('div', {}, limit.remaining === null ? 'GitHub limit: not read yet' : `GitHub limit: ${limit.remaining.toLocaleString()} left`),
      ...(v2 && data.paused() ? [h('div', {}, `Reads paused until ${time(limit.pausedUntil)}`)] : []),
    ];
  }

  if (v2 && OW.v2) {
    const v2Pages = OW.v2.pages({
      canvas: OW.pages.find(page => page.id === 'canvas'),
      updateBadges,
      repoSwitch: () => repoSwitch(data.repo.get()),
      freshnessNodes,
      signOut: () => { data.auth.signOut(); signedOut(); },
    });
    OW.pages.splice(0, OW.pages.length, ...v2Pages);
    OW.v2.setRedraw(() => update());
  }

  function v2NavLinks(kind) {
    return OW.pages.map(page => {
      const badge = h('span', { class: 'v2-badge', hidden: true });
      const cls = kind === 'main' ? `v2-nav-item${page.bottom ? ' v2-bottom' : ''}` : '';
      const mobile = kind === 'tabs';
      const glyph = mobile ? h('span', { class: 'v2-tab-icon' }, icon(page.icon), badge) : icon(page.icon);
      const link = h('a', { href: `#/${page.id}`, class: cls || null }, glyph, h('span', {}, page.title), mobile ? null : badge);
      return { page, link, badge };
    });
  }

  function buildV2Shell() {
    const workspace = demo ? 'Harbor' : data.repo.get()?.full;
    const side = v2NavLinks('main');
    const tabs = v2NavLinks('tabs');
    const title = h('h1', { tabindex: '-1' });
    const refresh = demo ? null : h('button', {
      class: 'v2-btn subtle v2-refresh', type: 'button', onclick: () => data.refreshAll(), hidden: true,
    }, icon('refresh'), 'Refresh now');
    const pager = h('div', { class: 'v2-pager-slot' });
    const head = h('div', { class: 'v2-head' }, title, h('div', { class: 'v2-head-tools' }, pager, refresh));
    const phoneBar = h('header', { class: 'v2-phone-bar' },
      h('a', { class: 'v2-phone-brand', href: home() }, logo(), h('span', {}, 'OpenWiz')),
      demo ? h('span', { class: 'v2-sample-tag' }, 'Sample data') : null);
    const notices = h('div', { class: 'notices v2-notices', role: 'status' });
    const body = h('section', { class: 'v2-body' });
    const view = h('div', { class: 'v2-view' }, notices, body);
    root.replaceChildren(
      h('a', { class: 'skip', href: '#content', onclick: event => { event.preventDefault(); title.focus(); } }, 'Skip to the page'),
      h('div', { class: 'v2-backdrop', 'aria-hidden': 'true' }),
      h('div', { class: 'v2-frame' },
        h('div', { class: 'v2-shell' },
          h('aside', { class: 'v2-side' },
            h('a', { class: 'v2-brand', href: home() },
              logo(),
              h('span', { class: 'v2-brand-text' },
                h('span', { class: 'v2-brand-name' }, 'OpenWiz'),
                h('span', { class: 'v2-brand-sub' }, workspace),
                demo ? h('span', { class: 'v2-sample-tag' }, 'Sample data') : null)),
            h('nav', { class: 'main v2-nav', 'aria-label': 'Pages' }, side.map(item => item.link))),
          h('main', { id: 'content', class: 'v2-main' },
            phoneBar,
            head,
            view,
            h('nav', { class: 'v2-tabs', 'aria-label': 'Pages' }, tabs.map(item => item.link))))));
    built = { side, tabs, title, refresh, pager, notices, body, view, page: null, isV2: true };
  }

  function buildShell() {
    if (v2 && OW.v2) return buildV2Shell();
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
          h('a', { class: 'brand', href: home() }, logo(), h('span', {}, 'OpenWiz')),
          repoButton(),
          h('nav', { class: 'main', 'aria-label': 'Pages' }, side.map(item => item.link)),
          h('div', { class: 'foot' }, reads, h('div', { class: 'actions' }, refresh[0], signOutButton()))),
        h('header', { class: 'top' }, h('a', { class: 'brand', href: home() }, logo(), h('span', {}, 'OpenWiz')), repoButton()),
        h('main', { id: 'content' }, h('div', { class: 'page-head' }, title, read), phoneReads, notices, body,
          h('div', { class: 'phone-actions' }, refresh[1], signOutButton())),
        h('nav', { class: 'tabs', 'aria-label': 'Pages' }, tabs.map(item => item.link))));
    built = { side, tabs, reads, refresh, title, read, phoneReads, notices, body, page: null };
  }

  const feedLabel = feed => (v2 && feed === data.feeds.agents ? 'Activity' : feed.label);
  function readLine(feed) {
    const label = feedLabel(feed);
    if (feed.state === 'loading') return [h('span', {}, `${label}: reading…`)];
    if (feed.state === 'unknown') return [h('span', { class: 'bad' }, `${label}: unknown (couldn't read at ${time(feed.failedAt)})`)];
    return [h('span', {}, `${label} read `), h('b', {}, time(feed.readAt)), feed.state === 'stale' ? h('span', { class: 'bad' }, ' · last read failed') : null];
  }

  function notice(kind, iconName, strong, text) {
    return h('div', { class: `notice ${kind}` }, icon(iconName), h('span', {}, h('b', {}, strong), ' ', text));
  }

  function updateBadges() {
    if (!built) return;
    const page = current();
    if (built.isV2 && built.refresh) built.refresh.disabled = data.paused();
    for (const { page: p, link, badge } of [...built.side, ...built.tabs]) {
      if (p.id === page.id) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
      const count = p.badge?.(data.feeds);
      badge.hidden = !count;
      badge.textContent = count ? String(count) : '';
    }
  }

  function update() {
    if (!built) return;
    const page = current();
    const feeds = data.feeds;
    const limit = data.limit;
    updateBadges();
    if (built.isV2 && built.page !== page.id) {
      built.body.replaceChildren();
      built.pager.replaceChildren();
      built.view.dataset.page = page.id;
      built.view.scrollTop = 0;
    }
    const mine = page.feeds.map(name => feeds[name]);
    const liveFeed = built.isV2 && !demo && page.id === 'feed';
    if (!built.isV2) {
      built.reads.replaceChildren(...freshnessNodes());
      for (const button of built.refresh) button.disabled = data.paused();
      const latest = mine.filter(feed => feed.readAt).map(feed => feed.readAt);
      built.read.textContent = latest.length ? `Read ${time(Math.min(...latest))}` : '';
      built.phoneReads.replaceChildren(...mine.flatMap((feed, i) => [i ? ' · ' : '', ...readLine(feed)]).filter(part => part !== null && part !== ''));
    } else if (built.refresh) {
      built.refresh.hidden = page.id !== 'feed' && page.id !== 'canvas';
    }
    const notes = [];
    if (!v2 && data.paused()) {
      notes.push(notice('slow', 'pause', 'GitHub\'s limit is low', `(${limit.remaining ?? 0} left). Reads are paused until ${time(limit.pausedUntil)}, then resume on their own.`));
    }
    if (!demo && !liveFeed) {
      for (const feed of mine) {
        if (feed.state === 'unknown') notes.push(notice('bad', 'warn', `Couldn't read ${feedLabel(feed)} from GitHub`, `at ${time(feed.failedAt)}. It shows as unknown, not as empty, until a read works.`));
        if (feed.state === 'stale') notes.push(notice('bad', 'warn', `Couldn't read ${feedLabel(feed)} at ${time(feed.failedAt)}.`, `Showing the read from ${time(feed.readAt)}.`));
        if (feed.state === 'partial') notes.push(notice('bad', 'warn', 'Part of this read failed', `(${feedLabel(feed)}, ${time(feed.readAt)}). What's missing shows as unknown.`));
      }
    }
    built.notices.replaceChildren(...notes);
    if (!demo && !liveFeed && mine.length && mine.every(feed => feed.state === 'unknown')) {
      built.body.replaceChildren(OW.ui.unknown(`${page.title} couldn't be read from GitHub. The app tries again on its own, or press Refresh now.`));
    } else if (!demo && !liveFeed && mine.length && mine.some(feed => feed.state === 'loading') && !mine.some(feed => feed.data)) {
      built.body.replaceChildren(OW.ui.placeholder('Reading GitHub…'));
    } else {
      page.render(built.body, feeds, route().arg, built.pager);
    }
    if (built.page !== page.id) {
      built.title.textContent = page.title;
      document.title = `${page.title} · OpenWiz`;
      if (built.page !== null) built.title.focus();
      built.page = page.id;
    }
  }

  function draw() {
    if (demo) {
      if (!location.hash || route().id === 'welcome') {
        built = null;
        return OW.v2.renderWelcome(root, { demoMode: true });
      }
      if (!ROUTES().includes(route().id)) history.replaceState(null, '', home());
      if (!built) buildShell();
      return update();
    }
    if (!data.auth.signedIn()) return signedOut();
    if (!data.repo.get()) return picker();
    if (!ROUTES().includes(route().id)) history.replaceState(null, '', home());
    if (!built) {
      buildShell();
      data.start();
    }
    update();
  }

  data.onChange(update);
  OW.onSignedOut = () => signedOut('Your sign-in ended. Sign in again.');
  window.addEventListener('hashchange', () => {
    if (demo) {
      OW.v2.dismissToast();
      return draw();
    }
    if (built) update();
  });
  document.addEventListener('keydown', event => {
    if (!built || (v2 && (event.defaultPrevented || document.querySelector('.v2-sheet[open]')))) return;
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
    if (demo) return draw();
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
