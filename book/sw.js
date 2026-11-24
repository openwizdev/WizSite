const CACHE_PREFIX = 'book-shell-';
const CACHE_NAME = 'book-shell-__BOOK_CACHE__';
const SHELL_URL = '/book/';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.add(SHELL_URL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

function isNetworkFirstAsset(pathname) {
  return (
    pathname === '/book/' ||
    pathname === '/book' ||
    pathname === '/book/manifest.webmanifest' ||
    (pathname.startsWith('/book/icon-') && pathname.endsWith('.png'))
  );
}

function isImmutableAsset(pathname) {
  return (
    pathname.startsWith('/fonts/') ||
    pathname.endsWith('.css') ||
    pathname.endsWith('.js')
  );
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate' || isNetworkFirstAsset(url.pathname)) {
    const cacheKey = request.mode === 'navigate' || url.pathname === '/book' ? SHELL_URL : request;
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(cacheKey, copy));
          }
          return response;
        })
        .catch(() => caches.match(cacheKey)),
    );
    return;
  }

  if (!isImmutableAsset(url.pathname)) return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
