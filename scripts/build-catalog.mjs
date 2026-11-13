#!/usr/bin/env node
// Builds public/data/catalog.json and public/data/species.json.
// Node built-ins only. Usage: node scripts/build-catalog.mjs [--no-cache]
// Downloads are cached in scripts/.cache (or $CARDCODEX_CACHE_DIR, as for the hash build).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { writeDataManifest } from './data-manifest.mjs';
import { fillScrydexImages } from './scrydex-images.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.resolve(process.env.CARDCODEX_CACHE_DIR || path.join(ROOT, 'scripts', '.cache'));
const OUT = path.join(ROOT, 'public', 'data');
const NO_CACHE = process.argv.includes('--no-cache');
const API = 'https://api.tcgdex.net/v2';
const CSV = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/';
const EXCLUDED_SERIES = new Set(['tcgp']);
const MAX_SPECIES = 1025;
const CATS = new Set(['Pokemon', 'Trainer', 'Energy']);

fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(...a);
const fail = (msg) => {
  console.error('\nVALIDATION FAILED: ' + msg);
  process.exit(1);
};
const assert = (cond, msg) => {
  if (!cond) fail(msg);
};

async function fetchRetry(url, opts, tries = 5) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.ok) return res;
      err = new Error(`HTTP ${res.status} for ${url}`);
      if (res.status === 404) throw err;
    } catch (e) {
      err = e;
      if (/HTTP 404/.test(String(e.message))) throw e;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** i));
  }
  throw err;
}

function cachePath(key) {
  return path.join(CACHE, key.replace(/[^A-Za-z0-9._-]/g, '_'));
}

/** Cached text fetch. */
async function cached(key, fetcher) {
  const p = cachePath(key);
  if (!NO_CACHE && fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  const text = await fetcher();
  fs.writeFileSync(p, text);
  return text;
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
      done++;
      if (done % 40 === 0 || done === items.length) log(`  ${done}/${items.length}`);
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

// ---------- CSV ----------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const head = rows.shift();
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

async function csv(name) {
  const text = await cached('csv_' + name, async () => (await fetchRetry(CSV + name)).text());
  return parseCsv(text.replace(/^﻿/, ''));
}

// ---------- pictures the bulk feed left blank ----------
const PROBE_TTL_MS = 7 * 24 * 3600 * 1000;
const PROBE_CACHE = path.join(CACHE, 'image-probe.json');

/** HEAD a TCGdex asset. TCGdex serves from a CDN, so a few requests at a time are fine. */
async function headOk(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'user-agent': 'CardCodex build-catalog (github.com/Dood345/CardCodex)' } });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The GraphQL feed says `image: null` for cards whose file is on the CDN all
 * the same: new sets while their uploads catch up, and the Shiny Vault,
 * Galarian Gallery and Trainer Gallery subsets, whose files sit under the
 * parent set's path (`swsh4.5sv` → `swsh4.5`). Probe `low.webp` (the size the
 * app and the hash build fetch) at the card's own path, then at the parent's,
 * and mark the card accordingly. Answers are kept for a week so a cached run
 * does not ask again; `--no-cache` asks afresh.
 */
async function probeMissingImages(pending, setIds) {
  let memo = {};
  if (!NO_CACHE && fs.existsSync(PROBE_CACHE)) {
    try {
      memo = JSON.parse(fs.readFileSync(PROBE_CACHE, 'utf8'));
    } catch {
      memo = {};
    }
  }
  const now = Date.now();
  const stats = { own: 0, parent: 0, none: 0, asked: 0 };
  let i = 0;
  const worker = async () => {
    while (i < pending.length) {
      const { card, series, sid, localId } = pending[i++];
      let hit = memo[card.id];
      if (!hit || now - hit.at > PROBE_TTL_MS) {
        stats.asked++;
        const own = `https://assets.tcgdex.net/en/${series}/${sid}/${localId}`;
        const parent = sid.match(/^([a-z]+[0-9.]+)[a-z]+$/u)?.[1];
        let where = (await headOk(`${own}/low.webp`)) ? 'own' : 'none';
        if (where === 'none' && parent && setIds.has(parent)) {
          const base = `https://assets.tcgdex.net/en/${series}/${parent}/${localId}`;
          if (await headOk(`${base}/low.webp`)) where = base;
        }
        hit = memo[card.id] = { where, at: now };
      }
      if (hit.where === 'own') {
        card.img = true;
        stats.own++;
      } else if (hit.where !== 'none') {
        card.img = hit.where;
        stats.parent++;
      } else stats.none++;
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(PROBE_CACHE, JSON.stringify(memo));
  return stats;
}

// ---------- species ----------
async function buildSpecies() {
  log('Species (PokeAPI CSV)...');
  const [sp, names, ptypes, types] = await Promise.all([
    csv('pokemon_species.csv'),
    csv('pokemon_species_names.csv'),
    csv('pokemon_types.csv'),
    csv('types.csv'),
  ]);
  const typeName = new Map(types.map((t) => [Number(t.id), t.identifier]));
  const nameOf = new Map();
  for (const n of names) if (n.local_language_id === '9') nameOf.set(Number(n.pokemon_species_id), n.name);
  const typesOf = new Map();
  for (const p of ptypes) {
    const id = Number(p.pokemon_id);
    if (id < 1 || id > MAX_SPECIES) continue;
    if (!typesOf.has(id)) typesOf.set(id, []);
    typesOf.get(id).push({ slot: Number(p.slot), t: typeName.get(Number(p.type_id)) });
  }
  const out = [];
  for (const s of sp) {
    const id = Number(s.id);
    if (id < 1 || id > MAX_SPECIES) continue;
    const t = (typesOf.get(id) || []).sort((a, b) => a.slot - b.slot).map((x) => x.t);
    out.push({ id, name: nameOf.get(id) || '', gen: Number(s.generation_id), types: t });
  }
  out.sort((a, b) => a.id - b.id);
  assert(out.length === MAX_SPECIES, `expected ${MAX_SPECIES} species, got ${out.length}`);
  out.forEach((s, i) => {
    assert(s.id === i + 1, `species id gap at ${i + 1}`);
    assert(s.name.length > 0, `species ${s.id} has empty name`);
    assert(s.types.length >= 1 && s.types.length <= 2 && s.types.every(Boolean), `species ${s.id} bad types ${s.types}`);
    assert(s.gen >= 1 && s.gen <= 9, `species ${s.id} bad gen ${s.gen}`);
  });
  return out;
}

// Mechanic suffixes a card name adds after the species name.
const NAME_SUFFIX = /\s+(ex|EX|GX|V|VMAX|VSTAR|BREAK|LV\.X|LEGEND|Prism Star|Star|G|GL|FB|C|E4|4|◇|☆|δ)$/u;

/**
 * Dex ids for a card whose source left `dexId` empty (new sets reach TCGdex
 * before their dex ids do): strip the mechanic suffixes ("Fuecoco ex",
 * "Pikachu & Zekrom GX"), then drop leading words until the rest is a species
 * name ("Alolan Exeggutor", "Heat Rotom", "Teal Mask Ogerpon", "Team Rocket's
 * Mewtwo"). Tag teams split on "&". Returns [] when any part is not a species.
 */
function dexFromName(name, dexByName) {
  const parts = name.split(/\s*&\s*/u).map((part) => {
    let n = part.trim();
    for (let i = 0; i < 3; i++) n = n.replace(NAME_SUFFIX, '').replace(/-(GX|EX)$/u, '');
    const words = n.split(/\s+/u);
    for (let drop = 0; drop < words.length; drop++) {
      const id = dexByName.get(words.slice(drop).join(' '));
      if (id) return id;
    }
    return undefined;
  });
  return parts.every(Boolean) ? parts : [];
}

// ---------- cards ----------
const CARD_FIELDS = 'id localId name category dexId types rarity hp stage image set { id }';

async function fetchCardsGraphQL() {
  const text = await cached('cards_graphql.json', async () => {
    const res = await fetchRetry(API + '/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: `{ cards { ${CARD_FIELDS} } }` }),
    });
    return res.text();
  });
  const j = JSON.parse(text);
  if (j.errors) {
    try {
      fs.unlinkSync(cachePath('cards_graphql.json'));
    } catch {}
    fail('GraphQL errors: ' + JSON.stringify(j.errors).slice(0, 500));
  }
  return j.data.cards;
}

async function buildSets() {
  log('Sets (TCGdex REST)...');
  const list = JSON.parse(
    await cached('sets_list.json', async () => (await fetchRetry(API + '/en/sets')).text()),
  );
  log(`  ${list.length} sets in list; fetching details`);
  const details = await pool(list, 8, async (s) =>
    JSON.parse(
      await cached(`set_${s.id}.json`, async () =>
        (await fetchRetry(`${API}/en/sets/${encodeURIComponent(s.id)}`)).text(),
      ),
    ),
  );
  return details;
}

function localeCompareNum(a, b) {
  const na = /^\d+$/.test(a);
  const nb = /^\d+$/.test(b);
  if (na && nb) return Number(a) - Number(b);
  if (na) return -1;
  if (nb) return 1;
  return a.localeCompare(b, 'en', { numeric: true });
}

async function main() {
  const builtAt = new Date().toISOString();
  const species = await buildSpecies();
  const dexByName = new Map(species.map((s) => [s.name, s.id]));
  const dexFromNames = { n: 0, examples: [] };

  const details = await buildSets();
  log('Cards (TCGdex GraphQL)...');
  const raw = await fetchCardsGraphQL();
  log(`  ${raw.length} cards from GraphQL`);

  // Sets
  const seriesById = new Map();
  let sets = [];
  const excludedSets = [];
  for (const d of details) {
    if (EXCLUDED_SERIES.has(d.serie?.id)) {
      excludedSets.push(d.id);
      continue;
    }
    const cc = d.cardCount || {};
    const set = {
      id: d.id,
      name: d.name,
      series: d.serie?.id ?? '',
      seriesName: d.serie?.name ?? '',
      releaseDate: d.releaseDate || '',
      official: cc.official ?? 0,
      total: cc.total ?? 0,
      abbr: d.abbreviation?.official ?? d.tcgOnline ?? '',
    };
    if (d.logo) set.logo = true;
    if (d.symbol) set.symbol = true;
    sets.push(set);
    seriesById.set(set.id, set.series);
  }
  const excl = new Set(excludedSets);

  // Cards
  const buckets = { true: 0, custom: 0, none: 0 };
  const customExamples = [];
  const oddCats = {};
  const badDex = [];
  const cards = [];
  /** Cards the feed lists without a picture, probed on the CDN after the loop. */
  const pending = [];
  const droppedTcgp = { n: 0 };
  const unknownSet = new Set();
  for (const c of raw) {
    const sid = c.set?.id;
    if (excl.has(sid)) {
      droppedTcgp.n++;
      continue;
    }
    if (!seriesById.has(sid)) {
      unknownSet.add(sid);
      continue;
    }
    const series = seriesById.get(sid);
    let cat = c.category;
    if (!CATS.has(cat)) {
      oddCats[cat] = (oddCats[cat] || 0) + 1;
      cat = /energy/i.test(cat) ? 'Energy' : /trainer/i.test(cat) ? 'Trainer' : 'Pokemon';
    }
    const card = { id: c.id, set: sid, num: c.localId, name: c.name, cat };
    if (Array.isArray(c.dexId) && c.dexId.length) {
      const ok = [];
      for (const d of c.dexId) {
        if (Number.isInteger(d) && d >= 1 && d <= MAX_SPECIES) ok.push(d);
        else badDex.push({ id: c.id, dex: d });
      }
      if (ok.length) card.dex = ok;
    } else if (cat === 'Pokemon') {
      const dex = dexFromName(c.name, dexByName);
      if (dex.length) {
        card.dex = dex;
        dexFromNames.n++;
        if (dexFromNames.examples.length < 6) dexFromNames.examples.push(`${c.id} (${c.name}) → ${dex.join(',')}`);
      }
    }
    if (Array.isArray(c.types) && c.types.length) card.types = c.types;
    if (c.rarity) card.rarity = c.rarity;
    if (c.hp != null && c.hp !== '') {
      const hp = Number(c.hp);
      if (Number.isFinite(hp)) card.hp = hp;
    }
    if (c.stage) card.stage = c.stage;
    const predicted = `https://assets.tcgdex.net/en/${series}/${sid}/${c.localId}`;
    if (c.image) {
      if (c.image === predicted) {
        card.img = true;
        buckets.true++;
      } else {
        card.img = c.image;
        buckets.custom++;
        if (customExamples.length < 10) customExamples.push(`${c.id}: ${c.image}`);
      }
    } else {
      buckets.none++;
      pending.push({ card, series, sid, localId: c.localId });
    }
    cards.push(card);
  }
  assert(unknownSet.size === 0, 'cards reference unknown sets: ' + [...unknownSet].join(','));

  log(`Probing the CDN for ${pending.length} cards the feed lists without a picture...`);
  const probed = await probeMissingImages(pending, new Set(sets.map((s) => s.id)));
  buckets.true += probed.own;
  buckets.custom += probed.parent;
  buckets.none -= probed.own + probed.parent;

  // What TCGdex has no picture of in any place probed: Scrydex's, where they list the same card
  // (used with their permission, docs/scrydex-permission.md; scripts/scrydex-images.mjs has the rules).
  const withoutPicture = cards.filter((c) => !c.img);
  log(`Scrydex pictures for the ${withoutPicture.length} cards TCGdex has none of...`);
  const scrydex = await fillScrydexImages({ pending: withoutPicture, allCards: cards, sets, cacheDir: CACHE, noCache: NO_CACHE, log });
  buckets.scrydex = scrydex.marked;
  buckets.none -= scrydex.marked;

  // Drop empty sets
  const counts = new Map();
  for (const c of cards) counts.set(c.set, (counts.get(c.set) || 0) + 1);
  const emptySets = sets.filter((s) => !counts.has(s.id)).map((s) => s.id);
  sets = sets.filter((s) => counts.has(s.id));

  // Sort
  sets.sort((a, b) => {
    if (!a.releaseDate !== !b.releaseDate) return a.releaseDate ? -1 : 1;
    return a.releaseDate.localeCompare(b.releaseDate) || a.id.localeCompare(b.id);
  });
  const order = new Map(sets.map((s, i) => [s.id, i]));
  cards.sort((a, b) => order.get(a.set) - order.get(b.set) || localeCompareNum(a.num, b.num) || a.id.localeCompare(b.id));

  // Validation
  const ids = new Set();
  for (const c of cards) {
    assert(!ids.has(c.id), 'duplicate card id ' + c.id);
    ids.add(c.id);
    assert(order.has(c.set), 'card set missing ' + c.id);
  }
  for (const s of sets) assert(counts.get(s.id) >= 1, 'empty set ' + s.id);

  const catCounts = {};
  for (const c of cards) catCounts[c.cat] = (catCounts[c.cat] || 0) + 1;
  const pokeNoDex = cards.filter((c) => c.cat === 'Pokemon' && !c.dex);

  // Logo/symbol URL check (HEAD every logo/symbol .webp; flags are cleared when the URL 404s).
  // The API's `symbol` field points at assets.tcgdex.net/univ/..., but only the
  // /en/ path serves the .webp (the app uses /en/, src/data/types.ts), so that
  // is the one probed.
  log('Checking asset URLs for all sets...');
  const probe = async (u) => {
    try {
      return (await fetch(u, { method: 'HEAD' })).ok;
    } catch {
      return false;
    }
  };
  const extResults = { logoEnWebp: [0, 0], symbolEnWebp: [0, 0] };
  const failures = [];
  await pool(sets, 8, async (s) => {
    if (s.logo) {
      const ok = await probe(`https://assets.tcgdex.net/en/${s.series}/${s.id}/logo.webp`);
      extResults.logoEnWebp[ok ? 0 : 1]++;
      if (!ok) {
        failures.push('logo ' + s.id);
        delete s.logo;
      }
    }
    if (s.symbol) {
      const ok = await probe(`https://assets.tcgdex.net/en/${s.series}/${s.id}/symbol.webp`);
      extResults.symbolEnWebp[ok ? 0 : 1]++;
      if (!ok) {
        failures.push('symbol(en) ' + s.id);
        delete s.symbol;
      }
    }
  });
  log('asset flags cleared (API advertised but 404):', failures.length);

  // Write
  const catalog = { version: 1, builtAt, sets, cards };
  const speciesFile = { version: 1, builtAt, species };
  const catStr = JSON.stringify(catalog);
  const spStr = JSON.stringify(speciesFile);
  fs.writeFileSync(path.join(OUT, 'catalog.json'), catStr);
  fs.writeFileSync(path.join(OUT, 'species.json'), spStr);
  // Versions for the web app's cache busting (see scripts/data-manifest.mjs).
  const manifest = writeDataManifest(OUT);

  // Report
  const byId = new Map(cards.map((c) => [c.id, c]));
  log('\n===== SUMMARY =====');
  log('sets:', sets.length, '(excluded tcgp sets:', excludedSets.length + ', empty dropped:', emptySets.length + ')');
  log('cards:', cards.length, '(dropped from excluded series:', droppedTcgp.n + ')');
  log('categories:', JSON.stringify(catCounts), 'non-standard raw categories:', JSON.stringify(oddCats));
  log('img buckets: predictable=' + buckets.true, 'custom=' + buckets.custom, 'scrydex=' + buckets.scrydex, 'none=' + buckets.none);
  if (customExamples.length) log('custom img examples:\n  ' + customExamples.join('\n  '));
  log(`pictures found on the CDN for cards the feed left blank: ${probed.own} at their own path, ${probed.parent} under the parent set, ${probed.none} nowhere (${probed.asked} asked, the rest remembered)`);
  log(`pictures from Scrydex for cards TCGdex has none of: ${scrydex.marked} of ${scrydex.pending} (${scrydex.byName} paired by name where the numbering differs; ${scrydex.noExpansion} in sets Scrydex does not list, ${scrydex.notListed} not listed in their expansion, ${scrydex.placeholder} listed without a picture; ${scrydex.requests} requests)`);
  if (scrydex.mismatched.length) log('  same number under another name at Scrydex (left without a picture):\n    ' + scrydex.mismatched.join('\n    '));
  log('out-of-range dex ids:', badDex.length, badDex.slice(0, 20).map((b) => `${b.id}:${b.dex}`).join(' '));
  log('Pokemon cards without dex:', pokeNoDex.length);
  log('  examples:', pokeNoDex.slice(0, 10).map((c) => `${c.id} (${c.name})`).join('; '));
  log('dex ids taken from the card name (source had none):', dexFromNames.n, dexFromNames.examples.join('; '));
  // Every set must reach the Pokédex: a set whose Pokémon all lack dex ids is a source gap the name fallback should have closed.
  for (const s of sets) {
    const pk = cards.filter((c) => c.set === s.id && c.cat === 'Pokemon');
    assert(pk.length === 0 || pk.some((c) => c.dex), `set ${s.id} (${s.name}) has ${pk.length} Pokémon cards and none with a dex id`);
  }
  log('species:', species.length);
  log('asset probes [ok, fail]:', JSON.stringify(extResults));
  const sz = (n, s) => `${n}: ${Buffer.byteLength(s)} bytes raw, ${zlib.gzipSync(s).length} gzip`;
  log(sz('catalog.json', catStr));
  log(sz('species.json', spStr));
  log('manifest.json versions:', JSON.stringify(Object.fromEntries(Object.entries(manifest.files).map(([f, e]) => [f, e.hash]))));
  log('sets without logo:', sets.filter((s) => !s.logo).length, 'without symbol:', sets.filter((s) => !s.symbol).length);
  log('sets with official=0:', sets.filter((s) => !s.official).length, 'no releaseDate:', sets.filter((s) => !s.releaseDate).length, 'no abbr:', sets.filter((s) => !s.abbr).length);
  const nameCount = {};
  for (const s of sets) nameCount[s.name] = (nameCount[s.name] || 0) + 1;
  log('duplicate set names:', JSON.stringify(Object.entries(nameCount).filter(([, n]) => n > 1)));
  const oddNums = cards.filter((c) => !/^\d+$/.test(c.num));
  const prefixes = {};
  for (const c of oddNums) {
    const p = c.num.replace(/\d+/g, '#');
    prefixes[p] = (prefixes[p] || 0) + 1;
  }
  log('non-numeric nums:', oddNums.length, 'patterns:', JSON.stringify(Object.entries(prefixes).sort((a, b) => b[1] - a[1]).slice(0, 15)));
  const mismatchIds = cards.filter((c) => c.id !== `${c.set}-${c.num}`);
  log('cards where id != set-num:', mismatchIds.length, mismatchIds.slice(0, 8).map((c) => `${c.id}|${c.num}`).join('; '));
  log('empty names:', cards.filter((c) => !c.name).length);

  log('\nSpot checks:');
  for (const id of ['base1-4', 'swsh3-136', 'sv01-001']) log(' ', JSON.stringify(byId.get(id)));
  const tr = cards.find((c) => c.cat === 'Trainer' && c.set === 'sv01');
  const en = cards.find((c) => c.cat === 'Energy' && c.set === 'base1');
  log(' ', JSON.stringify(tr));
  log(' ', JSON.stringify(en));
  assert(byId.get('base1-4')?.dex?.[0] === 6, 'base1-4 should be dex 6');
  assert(byId.get('swsh3-136')?.dex?.[0] === 162, 'swsh3-136 should be dex 162');
  assert(byId.get('sv01-001')?.cat === 'Pokemon' && byId.get('sv01-001')?.img, 'sv01-001 should be Pokemon with image');
  assert(tr && en, 'missing trainer/energy spot check');

  // REST vs GraphQL image sample
  const sample = ['base1-4', 'swsh3-136', 'sv01-001'];
  for (const id of sample) {
    const r = JSON.parse(await cached(`card_${id}.json`, async () => (await fetchRetry(`${API}/en/cards/${id}`)).text()));
    const g = raw.find((x) => x.id === id);
    assert(r.image === g.image, `image mismatch REST vs GraphQL for ${id}: ${r.image} vs ${g.image}`);
  }
  log('REST vs GraphQL image match on sample: OK');
  log('\nOK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
