/* umlLight service worker — offline app shell + cached diagram renders. */
const VERSION = 'v4';
const SHELL_CACHE = `umllight-shell-${VERSION}`;
const DIAGRAM_CACHE = `umllight-diagrams-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/ui.js',
  './js/store.js',
  './js/plantuml.js',
  './js/diagram.js',
  './js/generators.js',
  './js/ai.js',
  './js/aipanel.js',
  './js/export.js',
  './js/github.js',
  './js/gitsync.js',
  './js/gitpanel.js',
  './js/schemas.js',
  './js/views/schemas.js',
  './js/views/projects.js',
  './js/views/overview.js',
  './js/views/vision.js',
  './js/views/usecases.js',
  './js/views/deployment.js',
  './js/views/datamodel.js',
  './js/views/viewmodel.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('umllight-') && k !== SHELL_CACHE && k !== DIAGRAM_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // Cross-origin: only rendered diagrams are cached (network first, cached copy
  // as fallback). API traffic — GitHub, the AI endpoint — must never be served
  // from cache, or stale blob shas would break conflict detection.
  if (!sameOrigin) {
    if (request.destination !== 'image') return;
    event.respondWith((async () => {
      try {
        const res = await fetch(request);
        if (res && (res.ok || res.type === 'opaque')) {
          const cache = await caches.open(DIAGRAM_CACHE);
          cache.put(request, res.clone());
        }
        return res;
      } catch (err) {
        const cached = await caches.match(request);
        if (cached) return cached;
        throw err;
      }
    })());
    return;
  }

  // Navigations: serve the shell so deep links work offline.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // App assets: cache first, refresh in the background.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request).then(async (res) => {
      if (res && res.ok) {
        const cache = await caches.open(SHELL_CACHE);
        cache.put(request, res.clone());
      }
      return res;
    }).catch(() => cached);
    return cached || network;
  })());
});
