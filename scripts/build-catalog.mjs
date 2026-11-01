#!/usr/bin/env node
// Builds public/data/catalog.json and public/data/species.json.
// Node built-ins only. Usage: node scripts/build-catalog.mjs [--no-cache]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'scripts', '.cache');
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
    } else buckets.none++;
    cards.push(card);
  }
  assert(unknownSet.size === 0, 'cards reference unknown sets: ' + [...unknownSet].join(','));

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

  // Logo/symbol URL check (HEAD every logo/symbol .webp; flags are cleared when the URL 404s)
  log('Checking asset URLs for all sets...');
  const probe = async (u) => {
    try {
      return (await fetch(u, { method: 'HEAD' })).ok;
    } catch {
      return false;
    }
  };
  const extResults = { logoEnWebp: [0, 0], symbolEnWebp: [0, 0], symbolUnivWebp: [0, 0] };
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
      const ok2 = await probe(`https://assets.tcgdex.net/univ/${s.series}/${s.id}/symbol.webp`);
      extResults.symbolUnivWebp[ok2 ? 0 : 1]++;
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

  // Report
  const byId = new Map(cards.map((c) => [c.id, c]));
  log('\n===== SUMMARY =====');
  log('sets:', sets.length, '(excluded tcgp sets:', excludedSets.length + ', empty dropped:', emptySets.length + ')');
  log('cards:', cards.length, '(dropped from excluded series:', droppedTcgp.n + ')');
  log('categories:', JSON.stringify(catCounts), 'non-standard raw categories:', JSON.stringify(oddCats));
  log('img buckets: predictable=' + buckets.true, 'custom=' + buckets.custom, 'none=' + buckets.none);
  if (customExamples.length) log('custom img examples:\n  ' + customExamples.join('\n  '));
  log('out-of-range dex ids:', badDex.length, badDex.slice(0, 20).map((b) => `${b.id}:${b.dex}`).join(' '));
  log('Pokemon cards without dex:', pokeNoDex.length);
  log('  examples:', pokeNoDex.slice(0, 10).map((c) => `${c.id} (${c.name})`).join('; '));
  log('species:', species.length);
  log('asset probes [ok, fail]:', JSON.stringify(extResults));
  const sz = (n, s) => `${n}: ${Buffer.byteLength(s)} bytes raw, ${zlib.gzipSync(s).length} gzip`;
  log(sz('catalog.json', catStr));
  log(sz('species.json', spStr));
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
