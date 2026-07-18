/* ------------------------------------------------------------
   sw.js — service worker for Pocket PDF.

   Caches the application shell so the reader reopens offline
   after the first successful load. The PDF.js runtime (loaded
   from a CDN) is cached opportunistically on first use, so the
   reader also works offline once it has run once online.

   No document content is ever cached — PDFs are read straight
   from the user's device and never touch the network.
   ------------------------------------------------------------ */

const VERSION = 'v1';
const SHELL_CACHE = `pocketpdf-shell-${VERSION}`;
const RUNTIME_CACHE = `pocketpdf-runtime-${VERSION}`;

// App shell — resolved relative to the service worker's scope.
const SHELL_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/viewer.js',
  './js/pdf-loader.js',
  './js/storage.js',
  './js/pwa.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/pdfjs/pdf.min.mjs',
  './vendor/pdfjs/pdf.worker.min.mjs',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Don't let a single missing optional asset abort the whole install.
      Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // App-shell navigations: serve the cached shell first, fall back to network.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => cached || fetch(req))
    );
    return;
  }

  if (sameOrigin) {
    // Cache-first for our own assets.
    event.respondWith(
      caches.match(req).then((cached) => cached || fetchAndCache(req, SHELL_CACHE))
    );
    return;
  }

  // Cross-origin (the PDF.js CDN): stale-while-revalidate into a runtime cache.
  event.respondWith(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

function fetchAndCache(req, cacheName) {
  return fetch(req).then((res) => {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(cacheName).then((cache) => cache.put(req, copy));
    }
    return res;
  });
}
