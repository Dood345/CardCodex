#!/usr/bin/env node
/**
 * Builds public/data/hashes.json: one perceptual hash per Pokémon card image,
 * the artwork-matching table the scanner uses beside OCR (src/scanner/hash.ts).
 *
 *   node scripts/build-hashes.mjs                 # download what is missing, hash everything
 *   node scripts/build-hashes.mjs --first sv03.5,xy12   # process these sets first (early checks)
 *   options: --rate 10 (requests/s)  --concurrency 4  --limit N  --cache-dir DIR
 *
 * Every card with an image (`img`) has its low-resolution TCGdex image
 * (~245×337 WebP, ~16 KB) downloaded once into scripts/.cache/images/pokemon/
 * (or $CARDCODEX_CACHE_DIR/images/pokemon/) and hashed with the very function
 * the app runs (loaded through Vite, no copy). Reruns skip cached images and
 * remembered 404s, so an interrupted build resumes; the output is rewritten
 * every 2,000 cards and at the end. Downloads are rate-limited (10/s) and
 * retried with backoff; `sharp` (dev-only) decodes the WebP.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i === -1) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const RATE = Number(opt('--rate', '10'));
const CONCURRENCY = Number(opt('--concurrency', '4'));
const LIMIT = Number(opt('--limit', '0'));
const FIRST = (opt('--first', '') || '').split(',').filter(Boolean);
const CACHE = path.resolve(opt('--cache-dir', process.env.CARDCODEX_CACHE_DIR || path.join(root, 'scripts', '.cache')));
const IMAGES = path.join(CACHE, 'images', 'pokemon');
const OUT = path.join(root, 'public', 'data', 'hashes.json');
const CATALOG = path.join(root, 'public', 'data', 'catalog.json');
if (args.includes('--help') || args.includes('-h')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*\n|^ \* ?/gm, ''));
  process.exit(0);
}
fs.mkdirSync(IMAGES, { recursive: true });

// The hash code is the app's own (src/scanner/hash.ts), loaded through Vite's SSR module loader.
const vite = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { middlewareMode: true, hmr: false },
  resolve: { alias: { '@': path.join(root, 'src') } },
});
const { hashCard, encodeHashes, HASH_SPEC, HASH_WORDS } = await vite.ssrLoadModule(path.join(root, 'src/scanner/hash.ts'));
const { cardImageUrl } = await vite.ssrLoadModule(path.join(root, 'src/data/types.ts'));

const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const seriesOf = new Map(catalog.sets.map((s) => [s.id, s.series]));
let cards = catalog.cards.filter((c) => c.img);
if (FIRST.length) {
  const rank = new Map(FIRST.map((s, i) => [s, i]));
  cards = [...cards].sort((a, b) => (rank.get(a.set) ?? 1e9) - (rank.get(b.set) ?? 1e9));
}
if (LIMIT) cards = cards.slice(0, LIMIT);
console.log(`${catalog.cards.length} cards, ${cards.length} with an image; cache ${path.relative(root, IMAGES) || IMAGES}`);

/** Token bucket: at most RATE requests per second across all workers. */
let nextSlot = 0;
async function politely() {
  const now = Date.now();
  nextSlot = Math.max(now, nextSlot) + 1000 / RATE;
  const wait = nextSlot - 1000 / RATE - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

const imagePath = (card) => path.join(IMAGES, `${card.id}.webp`);
const missingPath = (card) => path.join(IMAGES, `${card.id}.404`);

/** The card's cached image bytes, downloading once; null when the server has none (remembered). */
async function imageBytes(card, stats) {
  const file = imagePath(card);
  if (fs.existsSync(file)) {
    stats.cached++;
    return fs.readFileSync(file);
  }
  if (fs.existsSync(missingPath(card))) {
    stats.missing++;
    return null;
  }
  const url = cardImageUrl(card, seriesOf.get(card.set), 'low');
  let err;
  for (let attempt = 0; attempt < 5; attempt++) {
    await politely();
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'CardCodex build-hashes (github.com/Dood345/CardCodex)' } });
      if (res.status === 404) {
        fs.writeFileSync(missingPath(card), url);
        stats.missing++;
        stats.newMissing++;
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) throw new Error('empty body');
      fs.writeFileSync(file, buf);
      stats.downloaded++;
      return buf;
    } catch (e) {
      err = e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  stats.failed++;
  console.warn(`  ${card.id}: giving up (${err?.message ?? err})`);
  return null;
}

/** Decoded with sharp to RGBA, hashed with the app's own function. */
async function hashImage(buf, stats) {
  const { data, info } = await sharp(buf, { failOn: 'none' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const key = `${info.width}×${info.height}`;
  stats.sizes.set(key, (stats.sizes.get(key) ?? 0) + 1);
  return hashCard(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
}

const hashes = new Map(); // card id → Uint32Array
const stats = { cached: 0, downloaded: 0, missing: 0, newMissing: 0, failed: 0, decodeFailed: 0, sizes: new Map() };
const started = Date.now();

function writeOutput(final) {
  // Table order = catalog order, cards without a hash absent.
  const ids = catalog.cards.filter((c) => hashes.has(c.id)).map((c) => c.id);
  const words = new Uint32Array(ids.length * HASH_WORDS);
  ids.forEach((id, i) => words.set(hashes.get(id), i * HASH_WORDS));
  const file = { version: 1, builtAt: new Date().toISOString(), game: 'pokemon', spec: HASH_SPEC, ids, hashes: encodeHashes(words) };
  const text = JSON.stringify(file);
  fs.writeFileSync(OUT, text);
  if (final) {
    const gz = zlib.gzipSync(text).length;
    console.log(`\n${path.relative(root, OUT)}: ${ids.length} hashes, ${text.length} bytes raw (${(text.length / Math.max(1, ids.length)).toFixed(1)} per card), ${gz} gzip`);
  }
}

let done = 0;
let next = 0;
async function worker() {
  while (next < cards.length) {
    const card = cards[next++];
    const buf = await imageBytes(card, stats);
    if (buf) {
      try {
        hashes.set(card.id, await hashImage(buf, stats));
      } catch (e) {
        stats.decodeFailed++;
        console.warn(`  ${card.id}: decode failed (${e.message}); removing the cached file`);
        try {
          fs.unlinkSync(imagePath(card));
        } catch {}
      }
    }
    done++;
    if (done % 200 === 0 || done === cards.length) {
      const s = (Date.now() - started) / 1000;
      const rate = done / Math.max(1, s);
      const eta = Math.round((cards.length - done) / Math.max(0.01, rate));
      console.log(`  ${done}/${cards.length}  cached ${stats.cached}  downloaded ${stats.downloaded}  missing ${stats.missing}  failed ${stats.failed}  ${Math.round(s)} s, ETA ${eta} s`);
    }
    if (done % 2000 === 0) writeOutput(false);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
writeOutput(true);
await vite.close();

const withImg = catalog.cards.filter((c) => c.img).length;
console.log('\n===== SUMMARY =====');
console.log(`cards: ${catalog.cards.length}, with image: ${withImg}, hashed: ${hashes.size} (${((100 * hashes.size) / catalog.cards.length).toFixed(1)} % of the catalog, ${((100 * hashes.size) / withImg).toFixed(1)} % of the cards with an image)`);
console.log(`images: cached ${stats.cached}, downloaded ${stats.downloaded}, 404 ${stats.missing} (${stats.newMissing} new), failed ${stats.failed}, undecodable ${stats.decodeFailed}`);
console.log('image sizes:', [...stats.sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k}×${n}`).join('  '));
console.log(`elapsed ${Math.round((Date.now() - started) / 1000)} s`);
if (stats.failed) {
  console.error(`${stats.failed} downloads failed: rerun to retry them`);
  process.exit(1);
}
