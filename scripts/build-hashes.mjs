#!/usr/bin/env node
/**
 * Builds a game's artwork hash table, one perceptual hash per card image, the
 * table the binder-page scanner uses beside OCR (src/scanner/hash.ts):
 *   Pokémon   → public/data/hashes.json      (npm run hashes)
 *   Yu-Gi-Oh! → public/data/ygo/hashes.json  (npm run hashes:ygo)
 *
 *   node scripts/build-hashes.mjs                        # Pokémon: download what is missing, hash everything
 *   node scripts/build-hashes.mjs --game ygo             # Yu-Gi-Oh!
 *   node scripts/build-hashes.mjs --first sv03.5,xy12    # these sets first (early checks); for ygo: frames (effect_pendulum,…)
 *   options: --rate 10 (requests/s)  --concurrency 4  --limit N  --cache-dir DIR
 *
 * Pokémon: every card with an image (`img`) has its low-resolution TCGdex image
 * (~245×337 WebP, ~16 KB) downloaded once into scripts/.cache/images/pokemon/
 * (or $CARDCODEX_CACHE_DIR/images/pokemon/). The cards TCGdex has no picture of
 * use Scrydex's small picture (~245×342 PNG, with their permission:
 * docs/scrydex-permission.md); the catalog build has usually cached it already
 * (scripts/scrydex-images.mjs), under the same `<id>.webp` name whatever the
 * format, which `sharp` reads from the bytes. Yu-Gi-Oh!: every card (passcode)
 * has its YGOPRODeck small render (`cards_small/<passcode>.jpg`, 268×391,
 * ~28 KB) downloaded once into images/ygo/, as their guide asks (each image
 * fetched once and stored, never hotlinked); the table is keyed by passcode,
 * since every printing of a card shares the picture. Both are hashed with the
 * very function the app runs (loaded through Vite, no copy) and the game's
 * artwork window (`hashSpecFor`). Reruns skip cached images and remembered
 * 404s, so an interrupted build resumes and a changed spec never re-downloads;
 * the output is rewritten every 2,000 cards and at the end. Downloads are
 * rate-limited (10/s) and retried with backoff; `sharp` (dev-only) decodes.
 * 404s are remembered as `<id>.404` beside the images.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import sharp from 'sharp';
import { writeDataManifest } from './data-manifest.mjs';
import { md5, scrydexPlaceholder, SCRYDEX_IMAGES } from './scrydex-images.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i === -1) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const GAME = opt('--game', 'pokemon');
const RATE = Number(opt('--rate', '10'));
const CONCURRENCY = Number(opt('--concurrency', '4'));
const LIMIT = Number(opt('--limit', '0'));
const FIRST = (opt('--first', '') || '').split(',').filter(Boolean);
const CACHE = path.resolve(opt('--cache-dir', process.env.CARDCODEX_CACHE_DIR || path.join(root, 'scripts', '.cache')));
if (args.includes('--help') || args.includes('-h')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*\n|^ \* ?/gm, ''));
  process.exit(0);
}
if (GAME !== 'pokemon' && GAME !== 'ygo') {
  console.error(`unknown game ${GAME}: --game pokemon | ygo`);
  process.exit(2);
}
const IMAGES = path.join(CACHE, 'images', GAME);
const OUT = path.join(root, 'public', 'data', GAME === 'ygo' ? path.join('ygo', 'hashes.json') : 'hashes.json');
const OUT_REL = path.relative(path.join(root, 'public', 'data'), OUT).split(path.sep).join('/');
const CATALOG = path.join(root, 'public', 'data', GAME === 'ygo' ? path.join('ygo', 'catalog.json') : 'catalog.json');
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
const { hashCard, encodeHashes, hashSpecFor, HASH_WORDS } = await vite.ssrLoadModule(path.join(root, 'src/scanner/hash.ts'));
const { cardImageUrl, ygoImageUrl } = await vite.ssrLoadModule(path.join(root, 'src/data/types.ts'));
const spec = hashSpecFor(GAME);

const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));

/**
 * The game's entries: `{ id, url, file, group }` per card with an image, in
 * catalog order. Pokémon ids are catalog card ids and `group` the set;
 * Yu-Gi-Oh! ids are passcodes (every printing shares the picture; an
 * alternate artwork is its own passcode and picture, listed after the
 * card's main one) and `group` the frame type.
 */
function entriesOf() {
  if (GAME === 'ygo') {
    return catalog.cards.flatMap((c) =>
      [c.pc, ...(c.alt ?? [])].map((pc) => ({ id: String(pc), url: ygoImageUrl(pc, 'low'), file: path.join(IMAGES, `${pc}.jpg`), group: c.frame })),
    );
  }
  const seriesOf = new Map(catalog.sets.map((s) => [s.id, s.series]));
  return catalog.cards.filter((c) => c.img).map((c) => ({ id: c.id, url: cardImageUrl(c, seriesOf.get(c.set), 'low'), file: path.join(IMAGES, `${c.id}.webp`), group: c.set }));
}
const all = entriesOf();
let cards = all;
if (FIRST.length) {
  const rank = new Map(FIRST.map((s, i) => [s, i]));
  cards = [...cards].sort((a, b) => (rank.get(a.group) ?? 1e9) - (rank.get(b.group) ?? 1e9));
}
if (LIMIT) cards = cards.slice(0, LIMIT);
console.log(`${GAME}: ${catalog.cards.length} cards, ${all.length} with an image, spec ${spec.id}; cache ${path.relative(root, IMAGES) || IMAGES}`);

/** Token bucket: at most RATE requests per second across all workers. */
let nextSlot = 0;
async function politely() {
  const now = Date.now();
  nextSlot = Math.max(now, nextSlot) + 1000 / RATE;
  const wait = nextSlot - 1000 / RATE - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/** `<id>.404` beside where the image would be (the marker name the Pokémon cache has always used). */
const missingPath = (card) => card.file.replace(/\.[a-z]+$/, '.404');

// A 404 is not forever: new sets get their pictures weeks after their cards, so every run asks again
// for the cards that were missing last time (a few requests) instead of trusting the markers.
for (const f of fs.readdirSync(IMAGES)) if (f.endsWith('.404')) fs.unlinkSync(path.join(IMAGES, f));

/** Scrydex answers an id without a picture with status 200 and a card back: its checksum, asked for on first need. */
let placeholder;
async function isScrydexPlaceholder(card, buf) {
  if (!card.url.startsWith(SCRYDEX_IMAGES)) return false;
  placeholder ??= scrydexPlaceholder(CACHE);
  return md5(buf) === (await placeholder).md5;
}

/** The card's cached image bytes, downloading once; null when the server has none (remembered). */
async function imageBytes(card, stats) {
  if (fs.existsSync(card.file)) {
    stats.cached++;
    return fs.readFileSync(card.file);
  }
  if (fs.existsSync(missingPath(card))) {
    stats.missing++;
    return null;
  }
  let err;
  for (let attempt = 0; attempt < 5; attempt++) {
    await politely();
    try {
      const res = await fetch(card.url, { headers: { 'user-agent': 'CardCodex build-hashes (github.com/Dood345/CardCodex)' } });
      if (res.status === 404) {
        fs.writeFileSync(missingPath(card), card.url);
        stats.missing++;
        stats.newMissing++;
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) throw new Error('empty body');
      if (await isScrydexPlaceholder(card, buf)) {
        fs.writeFileSync(missingPath(card), card.url);
        stats.missing++;
        stats.newMissing++;
        return null;
      }
      fs.writeFileSync(card.file, buf);
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

/** Decoded with sharp to RGBA, hashed with the app's own function and the game's artwork window. */
async function hashImage(buf, stats) {
  const { data, info } = await sharp(buf, { failOn: 'none' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const key = `${info.width}×${info.height}`;
  stats.sizes.set(key, (stats.sizes.get(key) ?? 0) + 1);
  return hashCard(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height, spec.art);
}

const hashes = new Map(); // entry id → Uint32Array
const stats = { cached: 0, downloaded: 0, missing: 0, newMissing: 0, failed: 0, decodeFailed: 0, sizes: new Map() };
const started = Date.now();

function writeOutput(final) {
  // Table order = catalog order, cards without a hash absent.
  const ids = all.filter((c) => hashes.has(c.id)).map((c) => c.id);
  const words = new Uint32Array(ids.length * HASH_WORDS);
  ids.forEach((id, i) => words.set(hashes.get(id), i * HASH_WORDS));
  const file = { version: 1, builtAt: new Date().toISOString(), game: GAME, spec: spec.id, ids, hashes: encodeHashes(words) };
  const text = JSON.stringify(file);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  if (final) {
    const gz = zlib.gzipSync(text).length;
    console.log(`\n${path.relative(root, OUT)}: ${ids.length} hashes, ${text.length} bytes raw (${(text.length / Math.max(1, ids.length)).toFixed(1)} per card), ${gz} gzip`);
    // Versions for the web app's cache busting (see scripts/data-manifest.mjs).
    const manifest = writeDataManifest();
    console.log(`Wrote public/data/manifest.json (${OUT_REL} v=${manifest.files[OUT_REL].hash})`);
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
          fs.unlinkSync(card.file);
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

console.log('\n===== SUMMARY =====');
console.log(
  GAME === 'ygo'
    ? `ygo cards: ${catalog.cards.length}, pictures (cards + alternate artworks): ${all.length}, hashed: ${hashes.size} (${((100 * hashes.size) / all.length).toFixed(1)} % of the pictures)`
    : `pokemon cards: ${catalog.cards.length}, with image: ${all.length}, hashed: ${hashes.size} (${((100 * hashes.size) / catalog.cards.length).toFixed(1)} % of the catalog, ${((100 * hashes.size) / all.length).toFixed(1)} % of the cards with an image)`,
);
console.log(`images: cached ${stats.cached}, downloaded ${stats.downloaded}, 404 ${stats.missing} (${stats.newMissing} new), failed ${stats.failed}, undecodable ${stats.decodeFailed}`);
console.log('image sizes:', [...stats.sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k}×${n}`).join('  '));
console.log(`elapsed ${Math.round((Date.now() - started) / 1000)} s`);
if (stats.failed) {
  console.error(`${stats.failed} downloads failed: rerun to retry them`);
  process.exit(1);
}
