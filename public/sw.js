/* CardCodex service worker: offline app shell + opportunistic image cache.
 * Registered only by the web build (main.tsx); the Android build serves
 * everything from the APK and never registers it. */
const VERSION = 'cardcodex-v1';
const SHELL = `${VERSION}-shell`;
const IMAGES = `${VERSION}-images`;
const IMAGE_HOSTS = ['assets.tcgdex.net', 'raw.githubusercontent.com'];
const MAX_IMAGES = 1500;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Card art and sprites: cache-first, bounded.
  if (IMAGE_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(IMAGES).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok || res.type === 'opaque') {
            cache.put(req, res.clone());
            trimCache(IMAGES, MAX_IMAGES);
          }
          return res;
        } catch (e) {
          return hit || Response.error();
        }
      }),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Same-origin app files: network-first, fall back to cache (so updates
  // arrive promptly but the app still opens offline).
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }),
  );
});
