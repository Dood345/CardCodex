/**
 * Fetch-once image store, for two hosts:
 *  - YGOPRODeck, which forbids hotlinking ("do not continually hotlink
 *    images; download each once and store it");
 *  - Scrydex, whose pictures fill in the Pokémon cards TCGdex has none of.
 *    Their permission (docs/scrydex-permission.md) is for loading from
 *    images.scrydex.com "with local caching", so each picture is fetched once
 *    per device and then shown from the device, online or not.
 *
 * resolveImage(url) returns something an <img> can show:
 *  - an object URL for a blob already in IndexedDB (or just downloaded);
 *  - the original URL when the blob cannot be fetched by script: YGOPRODeck
 *    in a plain browser (the host sends no CORS headers), where the browser's
 *    own HTTP cache (31-day max-age) and the service worker keep repeat views
 *    local, or any host while the device is offline, where the <img> then
 *    fails and the caller shows its placeholder.
 * On Android the download goes through Capacitor's native HTTP bridge, which
 * is not subject to CORS, so every image is stored after its first view.
 * Scrydex sends CORS headers, so a browser stores its pictures the same way.
 *
 * Downloads run through a small FIFO queue, four at a time and spaced out,
 * well under the host's rate limits. Callers (the Img component) only ask for
 * an image once it is near the viewport, so the queue holds what the user is
 * about to see rather than every tile of a long grid.
 */
import { isNative } from '@/app/platform';
import { db, type CachedImage } from './db';

const YGOPRODECK_RE = /^https:\/\/images\.ygoprodeck\.com\//;
const SCRYDEX_RE = /^https:\/\/images\.scrydex\.com\//;
/**
 * Scrydex picks the format from the Accept header. Its large picture is about 280 KB as the PNG it sends
 * by default, 200 to 700 KB as WebP and 45 to 170 KB as AVIF; the small one is 10 to 25 KB as either. So
 * AVIF is asked for wherever this WebView can decode it, and WebP otherwise.
 */
const SCRYDEX_ACCEPT_WEBP = 'image/webp,image/png;q=0.9,image/*;q=0.8';
const SCRYDEX_ACCEPT_AVIF = `image/avif,${SCRYDEX_ACCEPT_WEBP}`;
/** A 2×2 grey AVIF: decoding it is the test. */
const AVIF_PROBE =
  'data:image/avif;base64,AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAAA+gABAAAAAAAAAB0AAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABhdjAxAAAAAA5waXRtAAAAAAABAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgQAMAAAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAlbWRhdBIACggYADbICGg0IDIPHEeHhd3AACwAACCQNZaA';

let avifSupport: Promise<boolean> | undefined;
function scrydexAccept(): Promise<string> {
  avifSupport ??= new Promise<boolean>((resolve) => {
    if (typeof Image === 'undefined') return resolve(false);
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth === 2);
    img.onerror = () => resolve(false);
    img.src = AVIF_PROBE;
  });
  return avifSupport.then((ok) => (ok ? SCRYDEX_ACCEPT_AVIF : SCRYDEX_ACCEPT_WEBP));
}
/** Object URLs kept in memory (LRU); each holds a ~30 KB blob alive. */
const MEM_MAX = 400;
/** Stored images; the small card image is ~30 KB, so this is ~250 MB at most. */
const STORE_MAX = 8000;
const CONCURRENCY = 4;
const SPACING_MS = 50;
/** Refresh `at` at most once a day per image (cheap eviction bookkeeping). */
const TOUCH_MS = 86_400_000;

/** Whether `url` is served by a host whose images are stored on the device after the first view. */
export function isCacheableImage(url: string | undefined): url is string {
  return !!url && (YGOPRODECK_RE.test(url) || SCRYDEX_RE.test(url));
}

const mem = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

function remember(url: string, objectUrl: string): string {
  mem.delete(url);
  mem.set(url, objectUrl);
  if (mem.size > MEM_MAX) {
    const oldest = mem.keys().next().value as string;
    URL.revokeObjectURL(mem.get(oldest)!);
    mem.delete(oldest);
  }
  return objectUrl;
}

/** Synchronous memory hit, or undefined. */
export function cachedImageUrl(url: string): string | undefined {
  const hit = mem.get(url);
  if (hit) remember(url, hit); // bump
  return hit;
}

/* ---------- download queue ---------- */

interface Job {
  url: string;
  resolve: (blob: Blob | null) => void;
}
const queue: Job[] = [];
let active = 0;
let lastStart = 0;

function pump(): void {
  while (active < CONCURRENCY && queue.length) {
    const job = queue.shift()!;
    active++;
    const wait = Math.max(0, lastStart + SPACING_MS - Date.now());
    lastStart = Date.now() + wait;
    setTimeout(() => {
      download(job.url)
        .then(job.resolve, () => job.resolve(null))
        .finally(() => {
          active--;
          pump();
        });
    }, wait);
  }
}

function enqueue(url: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    queue.push({ url, resolve });
    pump();
  });
}

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Fetch the bytes, or null when this platform cannot read them by script. */
async function download(url: string): Promise<Blob | null> {
  const scrydex = SCRYDEX_RE.test(url);
  const accept = scrydex ? await scrydexAccept() : undefined;
  if (isNative()) {
    const { CapacitorHttp } = await import('@capacitor/core');
    const res = await CapacitorHttp.get({
      url,
      responseType: 'blob',
      connectTimeout: 15000,
      readTimeout: 15000,
      ...(accept ? { headers: { Accept: accept } } : {}),
    });
    if (res.status !== 200 || typeof res.data !== 'string') throw new Error(`HTTP ${res.status}`);
    const type = String((res.headers?.['Content-Type'] ?? res.headers?.['content-type']) || (scrydex ? 'image/png' : 'image/jpeg'));
    return base64ToBlob(res.data, type);
  }
  if (scrydex) {
    // Scrydex allows cross-origin reads, so a browser can keep the bytes too.
    const res = await fetch(url, { headers: { Accept: accept! } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) throw new Error(`not an image: ${blob.type}`);
    return blob;
  }
  // A browser cannot read YGOPRODeck's bytes: the host sends no CORS headers,
  // so a fetch would only fail (noisily). The <img> loads it directly and the
  // browser's HTTP cache / the service worker keep repeat views local.
  return null;
}

/* ---------- store ---------- */

let inserts = 0;

async function prune(): Promise<void> {
  const n = await db.images.count();
  if (n <= STORE_MAX) return;
  const drop = Math.ceil(STORE_MAX * 0.1) + (n - STORE_MAX);
  const old = await db.images.orderBy('at').limit(drop).primaryKeys();
  await db.images.bulkDelete(old);
}

async function store(url: string, blob: Blob): Promise<void> {
  const row: CachedImage = { url, blob, size: blob.size, at: Date.now() };
  await db.images.put(row);
  if (++inserts % 50 === 0) void prune().catch(() => undefined);
}

/**
 * Resolve `url` to a displayable source (see file header). Never rejects:
 * the worst case is the original URL.
 */
export function resolveImage(url: string): Promise<string> {
  const hit = cachedImageUrl(url);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(url);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const row = await db.images.get(url);
      if (row?.blob) {
        if (Date.now() - row.at > TOUCH_MS) void db.images.update(url, { at: Date.now() }).catch(() => undefined);
        return remember(url, URL.createObjectURL(row.blob));
      }
    } catch {
      /* IndexedDB unavailable: fall through to a plain download */
    }
    const blob = await enqueue(url);
    if (!blob) return url;
    void store(url, blob).catch(() => undefined);
    return remember(url, URL.createObjectURL(blob));
  })().finally(() => pending.delete(url));
  pending.set(url, p);
  return p;
}

/** Number of stored images and their total bytes (Settings). */
export async function imageCacheStats(): Promise<{ count: number; bytes: number }> {
  let bytes = 0;
  let count = 0;
  await db.images.each((r) => {
    count++;
    bytes += r.size;
  });
  return { count, bytes };
}

export async function clearImageCache(): Promise<void> {
  await db.images.clear();
  for (const u of mem.values()) URL.revokeObjectURL(u);
  mem.clear();
}
