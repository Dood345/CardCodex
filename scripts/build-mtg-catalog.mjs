#!/usr/bin/env node
// Builds public/data/mtg/catalog.json: every English paper Magic: The Gathering
// printing, from Scryfall's bulk data (https://scryfall.com/docs/api/bulk-data).
// Node built-ins only (plus src/games/mtg/scryfall.ts, run through Node's type
// stripping). Usage: node scripts/build-mtg-catalog.mjs [--no-cache]
//
// Two requests go to api.scryfall.com (the bulk-data index and the set list),
// paced well under the API's 10 requests per second, with a descriptive
// User-Agent and Accept header as its guidelines ask; the bulk file itself
// comes from data.scryfall.io. All three are cached under scripts/.cache/mtg/
// and reused until --no-cache (Scryfall refreshes bulk files daily; a new
// index names a new file, which is downloaded once).
//
// The file is two-level like the Yu-Gi-Oh! one: `cards` holds one row per
// Oracle card, `printings` one row per set + collector number, `artists` the
// artist names the printings point at. Card images are not downloaded: the app
// shows Scryfall's image URLs (src/data/types.ts). Oracle text is left out to
// keep the file small; the card image carries it.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { buildMtgCatalog } from '../src/games/mtg/scryfall.ts';
import { writeDataManifest } from './data-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'scripts', '.cache', 'mtg');
const OUT_DIR = path.join(ROOT, 'public', 'data', 'mtg');
const OUT = path.join(OUT_DIR, 'catalog.json');
const NO_CACHE = process.argv.includes('--no-cache');
const API = 'https://api.scryfall.com';
const HEADERS = { 'User-Agent': 'CardCodex/1.0 catalog builder (github.com/Dood345/CardCodex)', Accept: 'application/json' };

fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const log = (...a) => console.log(...a);
const fail = (msg) => {
  console.error('\nVALIDATION FAILED: ' + msg);
  process.exit(1);
};
const assert = (cond, msg) => {
  if (!cond) fail(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** API GET, cached on disk; waits 150 ms after each network request (Scryfall asks for 50–100 ms between requests). */
async function cachedApiJson(name, url) {
  const p = path.join(CACHE, name);
  if (!NO_CACHE && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  log(`  GET ${url}`);
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  fs.writeFileSync(p, text);
  await sleep(150);
  return JSON.parse(text);
}

/** Every page of a paginated list endpoint. */
async function cachedApiList(name, url) {
  const p = path.join(CACHE, name);
  if (!NO_CACHE && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')).data;
  const data = [];
  for (let next = url, page = 1; next; page++) {
    const body = await cachedApiJson(`${name}.page${page}`, next);
    data.push(...body.data);
    next = body.has_more ? body.next_page : null;
  }
  fs.writeFileSync(p, JSON.stringify({ data }));
  return data;
}

/** The bulk file named by the index, downloaded once per name. */
async function bulkFile(entry) {
  const url = entry.download_uri ?? entry.jsonl_download_uri;
  assert(typeof url === 'string', 'bulk-data entry has no download URI');
  const p = path.join(CACHE, path.basename(new URL(url).pathname));
  if (fs.existsSync(p)) return p;
  log(`  GET ${url} (${entry.compressed_size ?? entry.size ?? '?'} bytes)`);
  const res = await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'], Accept: '*/*' } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  const tmp = `${p}.part`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, p);
  // Older downloads of the same kind are superseded.
  for (const f of fs.readdirSync(CACHE)) {
    if (f !== path.basename(p) && f.startsWith(String(entry.type).replace(/_/g, '-')) && !f.endsWith('.part')) fs.rmSync(path.join(CACHE, f));
  }
  return p;
}

/**
 * Card objects from the bulk file, one at a time: JSON Lines, or the older
 * JSON array with one card per line; gzipped or not. Streaming keeps the
 * ~500 MB of JSON out of memory.
 */
async function* readCards(file) {
  const fd = fs.openSync(file, 'r');
  const magic = Buffer.alloc(2);
  fs.readSync(fd, magic, 0, 2, 0);
  fs.closeSync(fd);
  let input = fs.createReadStream(file);
  if (magic[0] === 0x1f && magic[1] === 0x8b) input = input.pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const raw of rl) {
    const line = raw.trim().replace(/,$/, '');
    if (!line || line === '[' || line === ']') continue;
    yield JSON.parse(line);
  }
}

/** The synchronous builder takes an iterable: collect the stream first (objects are small once parsed). */
async function collect(iter) {
  const out = [];
  for await (const c of iter) out.push(c);
  return out;
}

log('Magic: The Gathering catalog (Scryfall)...');
const index = await cachedApiJson('bulk-data.json', `${API}/bulk-data`);
const entry = index.data?.find((b) => b.type === 'default_cards');
assert(entry, 'no default_cards entry in /bulk-data');
const setsRaw = await cachedApiList('sets.json', `${API}/sets`);
assert(Array.isArray(setsRaw) && setsRaw.length > 500, `too few sets: ${setsRaw?.length}`);
const file = await bulkFile(entry);
log(`  bulk file ${path.relative(ROOT, file)} (updated ${entry.updated_at})`);
const rawCards = await collect(readCards(file));
assert(rawCards.length > 80000, `too few card objects: ${rawCards.length}`);
log(`  ${rawCards.length} card objects, ${setsRaw.length} sets from Scryfall`);

const { file: out, skipped, synthesizedSets } = buildMtgCatalog(rawCards, setsRaw, new Date().toISOString());
log(`  skipped: ${[...skipped].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${n} ${r}`).join(', ')}`);
if (synthesizedSets.length) log(`  ${synthesizedSets.length} set(s) missing from /sets, named from the cards: ${synthesizedSets.join(', ')}`);

// ---------- validate ----------
assert(out.cards.length > 20000, `too few Oracle cards: ${out.cards.length}`);
assert(out.printings.length > 60000, `too few printings: ${out.printings.length}`);
const ids = new Set();
for (const p of out.printings) {
  const [ci, si, num, , sid] = p;
  assert(out.cards[ci] && out.sets[si], `dangling printing ${num}`);
  assert(/^[0-9a-f-]{36}$/.test(sid), `odd Scryfall id ${sid}`);
  const id = `${out.sets[si].id}-${num}`;
  assert(!ids.has(id), `duplicate printing ${id}`);
  ids.add(id);
}
const bolt = out.cards.findIndex((c) => c.name === 'Lightning Bolt');
assert(bolt >= 0, 'Lightning Bolt is missing');
const boltPrints = out.printings.filter((p) => p[0] === bolt).length;
assert(boltPrints >= 10, `Lightning Bolt has only ${boltPrints} printings`);

const json = JSON.stringify(out);
fs.writeFileSync(OUT, json);
const gz = zlib.gzipSync(json, { level: 9 }).length;
log(`  ${out.cards.length} Oracle cards, ${out.printings.length} printings, ${out.sets.length} sets, ${out.artists.length} artists (Lightning Bolt: ${boltPrints} printings)`);
log(`Wrote ${path.relative(ROOT, OUT)} (${(json.length / 1e6).toFixed(2)} MB, ${(gz / 1e6).toFixed(2)} MB gzipped)`);
// Versions for the web app's cache busting (see scripts/data-manifest.mjs).
const manifest = writeDataManifest();
log(`Wrote public/data/manifest.json (mtg/catalog.json v=${manifest.files['mtg/catalog.json'].hash})`);
