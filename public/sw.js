/*
 * Offline-friendly, faster repeat visits. Deliberately small and safe:
 * - the page itself: network first (fresh deploys show at once), the cached
 *   copy only if the network is slow (3 s) or gone;
 * - built files (/assets/, hashed names, never change): cache first;
 * - the basemap style, sprites, and label fonts (on the path to the first
 *   frame, rarely change): cached copy at once, refreshed in the background.
 * Weather data is never cached here: it must be live.
 */
const VERSION = 'v1';
const PAGES = `pages-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const BASEMAP = `basemap-${VERSION}`;
const KEEP = [PAGES, ASSETS, BASEMAP];
/** Old builds' files pile up in the assets cache; keep the newest this many. */
const MAX_ASSETS = 80;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (!KEEP.includes(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    void trim(cacheName, MAX_ASSETS);
  }
  return res;
}

async function networkFirst(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  const network = fetch(request).then(async (res) => {
    if (res.ok) await cache.put(request, res.clone());
    return res;
  });
  const slow = new Promise((resolve) => setTimeout(resolve, timeoutMs));
  try {
    const first = await Promise.race([network, slow]);
    if (first) return first;
    // Slow network: the cached page if there is one, else keep waiting.
    return (await cache.match(request)) ?? (await network);
  } catch {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw new Error('offline and not cached');
  }
}

async function staleWhileRevalidate(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const update = fetch(request)
    .then(async (res) => {
      if (res.ok) await cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit);
  if (hit) {
    event.waitUntil(update);
    return hit;
  }
  return update;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') event.respondWith(networkFirst(request, PAGES, 3000));
    else if (url.pathname.includes('/assets/')) event.respondWith(cacheFirst(request, ASSETS));
    return;
  }
  // Carto's style and sprite (/gl/…) and label fonts (/fonts/…), on either of its hosts.
  const basemap =
    (url.host === 'basemaps.cartocdn.com' || url.host === 'tiles.basemaps.cartocdn.com') &&
    (url.pathname.startsWith('/gl/') || url.pathname.startsWith('/fonts/'));
  if (basemap) event.respondWith(staleWhileRevalidate(event, request, BASEMAP));
});
