/* Simple service worker for offline-friendly SPA behavior.
 * Note: This is intentionally minimal (no Workbox). For production-grade caching,
 * consider using a Vite PWA plugin or Workbox build step.
 */

const CACHE_NAME = 'freightpower-pwa-v2';

// Core files to keep available offline.
// Vite's hashed assets are not known here without a build step, so we focus on
// index + manifest + icons. Runtime caching handles same-origin requests.
const PRECACHE_URLS = [
  '/index.html',
  '/manifest.json',
  '/icons/FP-logo-removebg-preview.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Be tolerant: don't fail install if a single asset is missing.
      const results = await Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u)));
      // Silence lint; keep for debugging if needed.
      void results;
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin requests.
  if (url.origin !== self.location.origin) return;

  // SPA navigation fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const network = await fetch(req);
          // Cache the latest HTML shell for offline.
          if (network && network.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put('/index.html', network.clone());
          }
          return network;
        } catch (_) {
          const cached = await caches.match('/index.html');
          return cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        }
      })()
    );
    return;
  }

  // Cache-first for static-ish same-origin files.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Cache successful GET responses for assets/HTML only (avoid caching API JSON).
          if (req.method === 'GET' && res && res.status === 200) {
            const ct = (res.headers.get('content-type') || '').toLowerCase();
            const isCacheable =
              ct.includes('text/html') ||
              ct.includes('text/css') ||
              ct.includes('javascript') ||
              ct.includes('image/') ||
              ct.includes('font/');

            if (isCacheable) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
            }
          }
          return res;
        })
        .catch(() => cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }));
    })
  );
});
