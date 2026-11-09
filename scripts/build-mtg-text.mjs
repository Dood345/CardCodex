#!/usr/bin/env node
// Builds public/data/mtg/text.json: the Oracle text of every Magic card in the
// catalog (public/data/mtg/catalog.json), with what the deck recommender needs
// that the catalog leaves out: keywords, colour identity, the mana a card
// produces, each face of a multi-faced card, and legality in the constructed
// formats the recommender offers. Source: Scryfall's `oracle_cards` bulk file
// (https://scryfall.com/docs/api/bulk-data), one card object per Oracle id.
// The deck recommender (src/recommend/mtg.ts) reads it; the card browser,
// search and scanner never do, so it is a separate, lazily loaded file.
//
// Node built-ins only. Usage: node scripts/build-mtg-text.mjs [--no-cache]
// Run it after scripts/build-mtg-catalog.mjs: the catalog decides which cards
// get text (its Oracle ids), so a card in one file is a card in the other.
//
// Requests: one to api.scryfall.com for the bulk-data index (cached and shared
// with the catalog script) and the bulk file itself from data.scryfall.io,
// downloaded once per name, with a descriptive User-Agent as Scryfall asks.
//
// Shape (see src/recommend/mtg-text.ts): `ids` and `cards` are parallel
// arrays, one entry per Oracle card. An id is the start of the card's Oracle id
// (hex digits, dashes dropped), as many digits as keep every id distinct
// (`idLength`, 8 today, where full ids would cost 0.5 MB gzipped); keyword names are held once in
// `keywords` and referred to by index; legality is one bit per entry of
// `formats`. Fields the catalog already has (name, front face's mana cost,
// type line, mana value, colours, power, toughness, loyalty) are left out,
// except per face of a multi-faced card, which the catalog has no room for.
// Reminder text (the parenthesised explanations of keywords) is dropped: it
// restates rules the keywords already name, it is a fifth of the text, and it
// would mislead the recommender's reading (Ward's reminder "counter it unless
// that player pays" is not a counterspell; a basic land's "({T}: Add {G}.)" is
// what `pm` already says).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { writeDataManifest } from './data-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'scripts', '.cache', 'mtg');
const OUT_DIR = path.join(ROOT, 'public', 'data', 'mtg');
const OUT = path.join(OUT_DIR, 'text.json');
const CATALOG = path.join(OUT_DIR, 'catalog.json');
const NO_CACHE = process.argv.includes('--no-cache');
const API = 'https://api.scryfall.com';
const HEADERS = { 'User-Agent': 'CardCodex/1.0 text builder (github.com/Dood345/CardCodex)', Accept: 'application/json' };

/** Legality bit order. Mirrored by MTG_TEXT_FORMATS in src/recommend/mtg-text.ts. */
export const FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper'];

fs.mkdirSync(CACHE, { recursive: true });

const log = (...a) => console.log(...a);
const fail = (msg) => {
  console.error('\nVALIDATION FAILED: ' + msg);
  process.exit(1);
};
const assert = (cond, msg) => {
  if (!cond) fail(msg);
};

async function cachedApiJson(name, url) {
  const p = path.join(CACHE, name);
  if (!NO_CACHE && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  log(`  GET ${url}`);
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  fs.writeFileSync(p, text);
  return JSON.parse(text);
}

/** The bulk file named by the index, downloaded once per name; older oracle-cards files are removed. */
async function bulkFile(entry) {
  const url = entry.download_uri ?? entry.jsonl_download_uri;
  assert(typeof url === 'string', 'bulk-data entry has no download URI');
  const name = path.basename(new URL(url).pathname);
  const p = path.join(CACHE, name);
  if (fs.existsSync(p)) return p;
  log(`  GET ${url} (${entry.compressed_size ?? entry.size ?? '?'} bytes)`);
  const res = await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'], Accept: '*/*' } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  const tmp = `${p}.part`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, p);
  for (const f of fs.readdirSync(CACHE)) if (f !== name && f.startsWith('oracle-cards') && !f.endsWith('.part')) fs.rmSync(path.join(CACHE, f));
  return p;
}

/** Card objects from a bulk file (JSON Lines or a one-card-per-line JSON array; gzipped or not), streamed. */
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

const WUBRG = 'WUBRG';
const letters = (xs, order = WUBRG) => order.split('').filter((l) => (xs ?? []).includes(l)).join('');
const oracleIdOf = (c) => c.oracle_id ?? c.card_faces?.[0]?.oracle_id;
/** Oracle text without reminder text; lines left empty go too. */
const stripReminder = (t) =>
  (t ?? '')
    .replace(/[ \t]*\([^()]*\)/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');

log('Magic: The Gathering card text (Scryfall)...');
assert(fs.existsSync(CATALOG), `${path.relative(ROOT, CATALOG)} is missing: run scripts/build-mtg-catalog.mjs first`);
const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const wanted = new Map(catalog.cards.map((c) => [c.oid, c]));
log(`  catalog: ${wanted.size} Oracle cards (built ${catalog.builtAt})`);

const index = await cachedApiJson('bulk-data.json', `${API}/bulk-data`);
const entry = index.data?.find((b) => b.type === 'oracle_cards');
assert(entry, 'no oracle_cards entry in /bulk-data');
const file = await bulkFile(entry);
log(`  bulk file ${path.relative(ROOT, file)} (updated ${entry.updated_at})`);

const keywordIndex = new Map();
const keywordOf = (k) => {
  let i = keywordIndex.get(k);
  if (i === undefined) keywordIndex.set(k, (i = keywordIndex.size));
  return i;
};

const rows = new Map();
let read = 0;
const layouts = new Map();
for await (const c of readCards(file)) {
  read++;
  const oid = oracleIdOf(c);
  if (!oid || !wanted.has(oid) || rows.has(oid)) continue;
  layouts.set(c.layout, (layouts.get(c.layout) ?? 0) + 1);
  const row = {};
  // Reversible cards print the same card on both faces: one face is the card.
  const faces = c.card_faces ?? [];
  const sameFaces = faces.length > 1 && faces.every((f) => f.name === faces[0].name);
  if (faces.length > 1 && !sameFaces) {
    row.f = faces.map((f) => {
      const face = { n: f.name, t: f.type_line ?? '' };
      if (f.mana_cost) face.c = f.mana_cost;
      const o = stripReminder(f.oracle_text);
      if (o) face.o = o;
      if (f.power !== undefined) face.p = f.power;
      if (f.toughness !== undefined) face.d = f.toughness;
      if (f.loyalty !== undefined) face.l = f.loyalty;
      return face;
    });
  } else {
    const text = stripReminder(c.oracle_text ?? faces[0]?.oracle_text);
    if (text) row.o = text;
  }
  const kw = (c.keywords ?? []).map(keywordOf);
  if (kw.length) row.k = kw;
  const ci = letters(c.color_identity);
  if (ci) row.ci = ci;
  const pm = letters(c.produced_mana, 'WUBRGC');
  if (pm) row.pm = pm;
  let lg = 0;
  let rs = 0;
  FORMATS.forEach((f, i) => {
    const v = c.legalities?.[f];
    if (v === 'legal' || v === 'restricted') lg |= 1 << i;
    if (v === 'restricted') rs |= 1 << i;
  });
  row.lg = lg;
  if (rs) row.rs = rs;
  rows.set(oid, row);
}
log(`  ${read} Oracle card objects read; layouts kept: ${[...layouts].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${n} ${l}`).join(', ')}`);

// Catalog order, so a diff after a rebuild stays small.
const oids = catalog.cards.map((c) => c.oid).filter((oid) => rows.has(oid));
const missing = catalog.cards.filter((c) => !rows.has(c.oid)).map((c) => c.name);
const hex = (oid) => oid.replace(/-/g, '');
let idLength = 8;
while (new Set(oids.map((oid) => hex(oid).slice(0, idLength))).size < oids.length) idLength++;
const out = {
  version: 1,
  game: 'mtg',
  builtAt: new Date().toISOString(),
  source: `Scryfall oracle_cards ${entry.updated_at}`,
  formats: FORMATS,
  keywords: [...keywordIndex.keys()],
  idLength,
  ids: oids.map((oid) => hex(oid).slice(0, idLength)),
  cards: oids.map((oid) => rows.get(oid)),
};

// ---------- validate ----------
const coverage = oids.length / wanted.size;
log(`  ${oids.length} of ${wanted.size} catalog cards have text (${(coverage * 100).toFixed(2)}%)${missing.length ? `; without: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}` : ''}`);
assert(coverage > 0.99, `only ${(coverage * 100).toFixed(1)}% of catalog cards have text`);
const byName = new Map(oids.map((oid, i) => [wanted.get(oid).name, out.cards[i]]));
const bolt = byName.get('Lightning Bolt');
assert(/deals 3 damage/.test(bolt?.o ?? ''), 'Lightning Bolt should deal 3 damage');
assert(!byName.get('Forest')?.o, 'Forest should have no text once its reminder text is gone');
assert(byName.get('Forest')?.pm === 'G', 'Forest should produce G');
assert(byName.get('Island')?.lg === (1 << FORMATS.length) - 1, 'Island should be legal in every format');
const multi = out.cards.filter((c) => c.f).length;
assert(multi > 500, `only ${multi} multi-faced cards`);
for (const [i, f] of FORMATS.entries()) {
  const n = out.cards.filter((c) => c.lg & (1 << i)).length;
  log(`  ${f}: ${n} legal`);
  assert(n > 1000, `only ${n} cards legal in ${f}`);
}
const restricted = out.cards.filter((c) => c.rs).length;
log(`  ids: first ${idLength} hex digits of the Oracle id; ${out.keywords.length} keywords, ${multi} multi-faced cards, ${restricted} restricted somewhere, ${out.cards.filter((c) => c.pm).length} produce mana`);

const json = JSON.stringify(out);
fs.writeFileSync(OUT, json);
const gz = zlib.gzipSync(json, { level: 9 }).length;
log(`Wrote ${path.relative(ROOT, OUT)} (${(json.length / 1e6).toFixed(2)} MB, ${(gz / 1e6).toFixed(2)} MB gzipped)`);
// Versions for the web app's cache busting (see scripts/data-manifest.mjs); mtg/text.json counts once it is listed there.
writeDataManifest();
