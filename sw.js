/* ------------------------------------------------------------
   sw.js — service worker for Pocket PDF.

   • Caches the application shell (including the vendored PDF.js
     runtime) so the reader reopens and works fully offline after
     the first successful load.
   • Handles the Web Share Target POST: a PDF shared *to* Pocket
     PDF is stashed in a cache and the client is redirected home,
     where the app picks it up and opens it.

   No document content is ever persisted to the network — PDFs are
   read straight from the device.
   ------------------------------------------------------------ */

const VERSION = 'v3';
const SHELL_CACHE = `bridgepdf-shell-${VERSION}`;
const RUNTIME_CACHE = `bridgepdf-runtime-${VERSION}`;
const SHARE_CACHE = 'bridgepdf-share';       // survives version bumps
const SHARE_KEY = './__shared-pdf';          // cache key for an incoming shared file

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
  './js/recents.js',
  './js/export.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './fonts/archivo-600.woff2',
  './fonts/archivo-700.woff2',
  './fonts/hanken-400.woff2',
  './fonts/hanken-500.woff2',
  './fonts/plex-mono-400.woff2',
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
  const keep = new Set([SHELL_CACHE, RUNTIME_CACHE, SHARE_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // --- Web Share Target: receive a PDF shared into the app ---
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(handleShareTarget(req));
    return;
  }

  if (req.method !== 'GET') return;

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

  // Cross-origin: stale-while-revalidate into a runtime cache (defensive; the
  // app makes no third-party requests by default).
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

async function handleShareTarget(req) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (file && file.size) {
      const cache = await caches.open(SHARE_CACHE);
      await cache.put(
        SHARE_KEY,
        new Response(file, {
          headers: {
            'content-type': file.type || 'application/pdf',
            'x-filename': encodeURIComponent(file.name || 'shared.pdf'),
          },
        })
      );
    }
  } catch {
    /* if we can't stash it, we still redirect home cleanly */
  }
  const home = new URL('./?pp-shared=1', self.registration.scope).href;
  return Response.redirect(home, 303);
}

function fetchAndCache(req, cacheName) {
  return fetch(req).then((res) => {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(cacheName).then((cache) => cache.put(req, copy));
    }
    return res;
  });
}
