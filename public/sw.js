/* CardCodex service worker: offline app shell, versioned catalog data and an
 * opportunistic image cache. Registered only by the web build (main.tsx); the
 * Android build serves everything from the APK and never registers it.
 *
 * Bump VERSION whenever a cache's contents or strategy change: activate()
 * deletes every cache of an older version. v2: the catalogs moved out of the
 * shell cache (where a stale /data/catalog.json outlived deploys) into DATA,
 * keyed by their versioned URL. */
const VERSION = 'cardcodex-v2';
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;
const IMAGES = `${VERSION}-images`;
const IMAGE_HOSTS = ['assets.tcgdex.net', 'raw.githubusercontent.com', 'images.ygoprodeck.com', 'cards.scryfall.io'];
const MAX_IMAGES = 1500;
/* One build is index.html, the web manifest, a dozen hashed chunks, icons and
 * the OCR model; the hashed chunks of older builds age out past this. */
const MAX_SHELL = 60;
/* "/data/" under the app's base ("/" or "/<repo>/"): the catalog files. */
const DATA_PATH = new URL('./data/', self.location.href).pathname;

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

/** Drops the oldest entries (insertion order) beyond `max`. */
async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

/* Catalog data (see src/data/catalog.ts). The page requests manifest.json with
 * `no-cache` and the catalogs as catalog.json?v=<hash> with `force-cache`.
 *  - A versioned file is cache-first: that URL's content never changes, so a
 *    hit is final. A miss is a new version: fetched once, stored, and the other
 *    versions of the same file are dropped so old catalogs do not pile up.
 *  - The manifest (and any unversioned data request) is network-first so a
 *    deploy is noticed; the stored copy serves it offline, which also makes the
 *    page ask for the catalog version that is in the cache. */
async function dataResponse(req, url) {
  const cache = await caches.open(DATA);
  const versioned = url.searchParams.has('v');
  if (versioned) {
    const hit = await cache.match(req);
    if (hit) return hit;
  }
  try {
    const res = await fetch(req);
    if (res.ok) {
      await cache.put(req, res.clone());
      if (versioned) await dropOtherVersions(cache, url);
    }
    return res;
  } catch {
    // Offline: this exact request from the cache, else whichever version of the
    // same file is stored (the page asked for a newer one it cannot download yet).
    return (await cache.match(req)) || (await anyVersion(cache, url)) || Response.error();
  }
}

async function dropOtherVersions(cache, url) {
  for (const key of await cache.keys()) {
    const stored = new URL(key.url);
    if (stored.pathname === url.pathname && stored.search !== url.search) await cache.delete(key);
  }
}

async function anyVersion(cache, url) {
  for (const key of await cache.keys()) {
    if (new URL(key.url).pathname === url.pathname) return cache.match(key);
  }
  return undefined;
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

  if (url.pathname.startsWith(DATA_PATH)) {
    event.respondWith(dataResponse(req, url));
    return;
  }

  // Same-origin app files: network-first, fall back to cache (so updates
  // arrive promptly but the app still opens offline).
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(req, copy).then(() => trimCache(SHELL, MAX_SHELL)));
        }
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
