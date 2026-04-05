/* Simple service worker for offline-friendly SPA behavior.
 * Note: This is intentionally minimal (no Workbox). For production-grade caching,
 * consider using a Vite PWA plugin or Workbox build step.
 */

const CACHE_NAME = 'freightpower-pwa-v2-20260405';

// Core files to keep available offline.
// Vite's hashed assets are not known here without a build step, so we focus on
// index + manifest + icons. Runtime caching handles same-origin requests.
const PRECACHE_URLS = [
  '/index.html',
  '/manifest.json',
  '/icons/FP-logo-removebg-preview.png',
];

function isAppAssetRequest(req, url) {
  if (url.pathname.startsWith('/assets/')) return true;
  const d = req.destination;
  return d === 'script' || d === 'style' || d === 'worker';
}

async function networkFirst(req, fallbackCacheKey = null) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const network = await fetch(req);
    if (req.method === 'GET' && network && network.status === 200) {
      cache.put(req, network.clone());
      if (fallbackCacheKey) cache.put(fallbackCacheKey, network.clone());
    }
    return network;
  } catch (_) {
    const cached = await caches.match(req);
    if (cached) return cached;
    if (fallbackCacheKey) {
      const fallback = await caches.match(fallbackCacheKey);
      if (fallback) return fallback;
    }
    throw _;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
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

  // Handle only GET requests from this point.
  if (req.method !== 'GET') return;

  // SPA navigation fallback (network-first).
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await networkFirst(req, '/index.html');
        } catch (_) {
          const cached = await caches.match('/index.html');
          return cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        }
      })()
    );
    return;
  }

  // JS/CSS/hashed app assets should be network-first to prevent stale chunk mismatches.
  if (isAppAssetRequest(req, url)) {
    event.respondWith(
      networkFirst(req).catch(() => new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }))
    );
    return;
  }

  // Cache-first for non-critical same-origin files (images/fonts/etc.).
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Cache successful GET responses.
          if (req.method === 'GET' && res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
