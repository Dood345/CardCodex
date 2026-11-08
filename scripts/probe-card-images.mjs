#!/usr/bin/env node
/**
 * Card picture gaps: measure them from the shipped catalogs and probe where a picture might live.
 * Research tool behind docs/card-art-gaps.md. Node built-ins only; nothing here changes the app.
 *
 *   node scripts/probe-card-images.mjs measure            gap tables for all three games (JSON on stdout with --json)
 *   node scripts/probe-card-images.mjs tcgdex [setId...]  per gap set, sample cards x URL variants on TCGdex
 *   node scripts/probe-card-images.mjs census [setId...]  every gap card against the variants that answered in the tcgdex run
 *   node scripts/probe-card-images.mjs cards <cardId...>  all variants for single cards (also cards whose img flag 404s)
 *   node scripts/probe-card-images.mjs scrydex [setId...] gap cards against images.scrydex.com (placeholder-aware)
 *   node scripts/probe-card-images.mjs tiers              merge census + scrydex runs: English / foreign / Scrydex-only / nowhere
 *   node scripts/probe-card-images.mjs ygo                YGOPRODeck picture check for cards without a TCG printing
 *   node scripts/probe-card-images.mjs mtg [n]            Scryfall image check for a random sample of printings
 *   node scripts/probe-card-images.mjs ext <url>...       status of arbitrary URLs (HEAD, cached)
 *
 * Every request is paced (about 4 per second), sent with a descriptive User-Agent, retried on 429/5xx and
 * cached in scripts/.cache/probe/responses-<command>.json, so a rerun costs no requests. Delete that file to re-probe.
 * A 404 from assets.tcgdex.net carries Content-Type image/webp and an HTML body, so only the status counts.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(process.env.CARDCODEX_CACHE_DIR || path.join(ROOT, 'scripts', '.cache'), 'probe');
// tcgdex, census and cards share one cache (same host); the other commands each get their own, so concurrent runs never clobber each other
const CACHE_GROUP = { census: 'tcgdex', cards: 'tcgdex' }[process.argv[2]] || process.argv[2] || 'misc';
const CACHE_FILE = path.join(CACHE_DIR, `responses-${CACHE_GROUP}.json`);
const UA = 'CardCodex-image-gap-research/1.0 (+https://github.com/Dood345/CardCodex; paced, cached, a few requests per second)';
const GAP_MS = 250;

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

// ---------------------------------------------------------------- request layer (paced, retried, cached)
fs.mkdirSync(CACHE_DIR, { recursive: true });
let cache = {};
try {
  cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
} catch {}
let dirty = 0;
let lastAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function save() {
  try {
    Object.assign(cache, { ...JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')), ...cache });
  } catch {}
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  dirty = 0;
}
process.on('exit', () => {
  if (dirty) save();
});

/** -> {s: status, n: bytes, t: content-type, j?: parsed JSON (only for GET of json)} ; s = 0 on network failure */
async function req(url, method = 'HEAD') {
  const key = method + ' ' + url;
  if (cache[key]) return cache[key];
  let out;
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastAt + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    try {
      const res = await fetch(url, { method, headers: { 'User-Agent': UA }, redirect: 'follow' });
      out = { s: res.status, t: res.headers.get('content-type') || '' };
      if (method === 'GET') {
        const buf = Buffer.from(await res.arrayBuffer());
        out.n = buf.length;
        if (out.t.startsWith('image/')) out.h = crypto.createHash('md5').update(buf).digest('hex').slice(0, 12);
        if (out.t.includes('json')) {
          try {
            out.j = JSON.parse(buf.toString('utf8'));
          } catch {}
        }
      } else out.n = Number(res.headers.get('content-length') || 0);
    } catch (e) {
      out = { s: 0, n: 0, t: String(e.cause?.code || e.message) };
    }
    if (out.s === 429 || out.s >= 500 || out.s === 0) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    break;
  }
  // 5xx / network failures are not cached: they say nothing about the picture
  if (out.s !== 0 && out.s < 500 && out.s !== 429) {
    cache[key] = out;
    if (++dirty >= 25) save();
  }
  return out;
}
/** True when the URL answers 200 with a body big enough to be a picture. */
const isImage = (r) => r.s === 200 && (r.n === 0 || r.n > 2000);

// ---------------------------------------------------------------- catalogs
function pokemon() {
  const c = readJson('public/data/catalog.json');
  const sets = new Map(c.sets.map((s) => [s.id, s]));
  return { c, sets };
}

function tally(arr, key) {
  const m = {};
  for (const x of arr) m[key(x)] = (m[key(x)] || 0) + 1;
  return m;
}

// ---------------------------------------------------------------- measure
function measure(json) {
  const { c, sets } = pokemon();
  const gaps = c.cards.filter((k) => !k.img);
  const customs = c.cards.filter((k) => typeof k.img === 'string').length;
  const bySet = new Map();
  for (const k of c.cards) {
    const e = bySet.get(k.set) || { id: k.set, total: 0, none: 0, cats: {} };
    e.total++;
    if (!k.img) {
      e.none++;
      e.cats[k.cat] = (e.cats[k.cat] || 0) + 1;
    }
    bySet.set(k.set, e);
  }
  const gapSets = [...bySet.values()].filter((e) => e.none).sort((a, b) => b.none - a.none);
  const pk = {
    cards: c.cards.length,
    withImage: c.cards.length - gaps.length,
    customUrl: customs,
    none: gaps.length,
    byCategory: tally(gaps, (k) => k.cat),
    categoryTotals: tally(c.cards, (k) => k.cat),
    gapSets: gapSets.length,
    wholeSets: gapSets.filter((e) => e.none === e.total).length,
    wholeSetCards: gapSets.filter((e) => e.none === e.total).reduce((a, e) => a + e.none, 0),
    scatteredCards: gapSets.filter((e) => e.none !== e.total).reduce((a, e) => a + e.none, 0),
    sets: gapSets.map((e) => ({ ...e, name: sets.get(e.id).name, series: sets.get(e.id).series, date: sets.get(e.id).releaseDate })),
  };
  // by series family
  const fam = {};
  for (const e of gapSets) {
    const s = sets.get(e.id).series;
    fam[s] = (fam[s] || 0) + e.none;
  }
  pk.bySeries = fam;
  const ygo = readJson('public/data/ygo/catalog.json');
  const printed = new Set(ygo.printings.map((p) => p[0]));
  const noPrint = ygo.cards.filter((_, i) => !printed.has(i));
  const mtg = readJson('public/data/mtg/catalog.json');
  const res = {
    pokemon: pk,
    ygo: {
      cards: ygo.cards.length,
      printings: ygo.printings.length,
      cardsWithoutPrinting: noPrint.length,
      byType: tally(noPrint, (k) => k.type),
      altArt: ygo.cards.reduce((a, k) => a + (k.alt?.length || 0), 0),
    },
    mtg: { cards: mtg.cards.length, printings: mtg.printings.length, sets: mtg.sets.length },
  };
  if (json) return console.log(JSON.stringify(res, null, 1));
  console.log(`Pokemon: ${pk.cards} cards, ${pk.withImage} with a picture, ${pk.customUrl} custom URL, ${pk.none} without`);
  console.log('  without, by category:', JSON.stringify(pk.byCategory), 'of', JSON.stringify(pk.categoryTotals));
  console.log(`  ${pk.gapSets} sets have gaps: ${pk.wholeSets} are missing entirely (${pk.wholeSetCards} cards), ${pk.gapSets - pk.wholeSets} partly (${pk.scatteredCards} cards)`);
  console.log('  by series:', JSON.stringify(pk.bySeries));
  for (const e of pk.sets) console.log(`  ${e.id.padEnd(12)} ${e.none === e.total ? 'ALL' : '   '} ${String(e.none).padStart(3)}/${String(e.total).padEnd(3)} ${e.date} ${e.name} ${JSON.stringify(e.cats)}`);
  console.log('Yu-Gi-Oh!:', JSON.stringify(res.ygo));
  console.log('Magic:', JSON.stringify(res.mtg));
}

// ---------------------------------------------------------------- TCGdex
const A = 'https://assets.tcgdex.net';
const LANGS = ['fr', 'de', 'es', 'it', 'pt-br', 'ja'];

/** Sibling set ids a subset might be stored under (swsh4.5sv -> swsh4.5, swsh12.5gg -> swsh12.5, ...). */
function siblings(setId) {
  const out = new Set();
  const m = setId.match(/^(.*?)(sv|gg|tg|a)$/);
  if (m) out.add(m[1]);
  const m2 = setId.match(/^(swsh\d+(?:\.5)?)/);
  if (m2 && m2[1] !== setId) out.add(m2[1]);
  return [...out];
}

function variantsFor(card, series, sets) {
  const L = card.num;
  const base = `${A}/en/${series}/${card.set}`;
  const v = [];
  const add = (name, url, kind = 'img') => v.push({ name, url, kind });
  add('en high', `${base}/${L}/high.webp`);
  add('en low', `${base}/${L}/low.webp`);
  add('en high.png', `${base}/${L}/high.png`);
  add('en high.jpg', `${base}/${L}/high.jpg`);
  if (/^\d+$/.test(L)) {
    add('en unpadded', `${base}/${Number(L)}/high.webp`);
    add('en padded3', `${base}/${L.padStart(3, '0')}/high.webp`);
  }
  for (const sib of siblings(card.set)) {
    const ss = sets.get(sib);
    add(`set ${sib}`, `${A}/en/${ss ? ss.series : series}/${sib}/${L}/high.webp`);
  }
  for (const lang of LANGS) add(`${lang} high`, `${A}/${lang}/${series}/${card.set}/${L}/high.webp`);
  add('REST en', `https://api.tcgdex.net/v2/en/cards/${card.id}`, 'rest');
  for (const lang of ['fr', 'de', 'es', 'it']) add(`REST ${lang}`, `https://api.tcgdex.net/v2/${lang}/cards/${card.id}`, 'rest');
  return v;
}

async function runVariant(v) {
  if (v.kind === 'rest') {
    const r = await req(v.url, 'GET');
    return { ...v, ok: r.s === 200 && !!r.j?.image, status: r.s, image: r.j?.image };
  }
  const r = await req(v.url, 'HEAD');
  return { ...v, ok: isImage(r), status: r.s, bytes: r.n };
}

/** First and last card, plus the first Trainer and the first Energy, capped at 4. */
function sample(cards) {
  const pick = new Map();
  const at = (k) => pick.set(k.id, k);
  at(cards[0]);
  at(cards[cards.length - 1]);
  for (const cat of ['Trainer', 'Energy']) {
    const k = cards.find((x) => x.cat === cat);
    if (k) at(k);
  }
  return [...pick.values()].slice(0, 4);
}

async function tcgdex(ids) {
  const { c, sets } = pokemon();
  const gap = c.cards.filter((k) => !k.img);
  const bySet = new Map();
  for (const k of gap) (bySet.get(k.set) || bySet.set(k.set, []).get(k.set)).push(k);
  const todo = ids.length ? ids : [...bySet.keys()].sort((a, b) => bySet.get(b).length - bySet.get(a).length);
  const summary = [];
  for (const id of todo) {
    const cards = bySet.get(id);
    if (!cards) {
      console.log(id, 'has no gaps');
      continue;
    }
    const s = sets.get(id);
    const hits = {};
    const tried = sample(cards);
    for (const card of tried) {
      for (const v of variantsFor(card, s.series, sets)) {
        const r = await runVariant(v);
        if (r.ok) (hits[v.name] ||= []).push(card.id + (r.image ? ` ${r.image}` : ''));
      }
    }
    const row = { set: id, name: s.name, gaps: cards.length, sampled: tried.map((k) => k.id), hits };
    summary.push(row);
    console.log(`${id.padEnd(12)} ${String(cards.length).padStart(3)} gaps, ${tried.length} sampled: ${Object.keys(hits).length ? JSON.stringify(hits) : 'no variant answers'}`);
  }
  fs.writeFileSync(path.join(CACHE_DIR, 'tcgdex-summary.json'), JSON.stringify(summary, null, 1));
  save();
}

/**
 * Every gap card of the given sets (all gap sets when none are named) against the variants that answered in the
 * `tcgdex` sampling run (scripts/.cache/probe/tcgdex-summary.json): about one request per card and variant.
 */
async function census(ids) {
  const { c, sets } = pokemon();
  const summary = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'tcgdex-summary.json'), 'utf8'));
  const out = [];
  for (const row of summary) {
    if (ids.length && !ids.includes(row.set)) continue;
    const s = sets.get(row.set);
    const gaps = c.cards.filter((k) => k.set === row.set && !k.img);
    // one variant per answer: skip the REST rows and the format / padding twins of 'en high'
    let names = Object.keys(row.hits).filter((n) => !n.startsWith('REST') && !/png|jpg|low$|padded3|unpadded/.test(n));
    if (!names.length) names = Object.keys(row.hits).filter((n) => !n.startsWith('REST')).slice(0, 1);
    const found = {};
    for (const k of gaps) {
      for (const v of variantsFor(k, s.series, sets).filter((x) => names.includes(x.name) && x.kind === 'img')) {
        const r = await runVariant(v);
        if (r.ok) (found[v.name] ||= []).push({ id: k.id, bytes: r.bytes, cat: k.cat });
      }
    }
    const line = { set: row.set, gaps: gaps.length, variants: Object.fromEntries(names.map((n) => [n, (found[n] || []).length])), byCat: {} };
    for (const n of names) for (const f of found[n] || []) line.byCat[n] = { ...(line.byCat[n] || {}), [f.cat]: ((line.byCat[n] || {})[f.cat] || 0) + 1 };
    line.bytes = Object.fromEntries(names.map((n) => [n, (found[n] || []).reduce((a, f) => a + (f.bytes || 0), 0)]));
    line.found = found;
    out.push(line);
    console.log(`${row.set.padEnd(12)} ${gaps.length} gaps:`, JSON.stringify(line.variants), JSON.stringify(line.byCat));
    save();
  }
  fs.writeFileSync(path.join(CACHE_DIR, 'tcgdex-census.json'), JSON.stringify(out));
}

/** Variants for arbitrary card ids (including cards that have `img: true` but 404). */
async function cards(ids) {
  const { c, sets } = pokemon();
  for (const id of ids) {
    const k = c.cards.find((x) => x.id === id);
    if (!k) {
      console.log(id, 'not in catalog');
      continue;
    }
    const hits = [];
    for (const v of variantsFor(k, sets.get(k.set).series, sets)) {
      const r = await runVariant(v);
      if (r.ok) hits.push(v.name + (r.image ? ' ' + r.image : ''));
    }
    console.log(id, k.name, k.img ? '(img flag set)' : '(no img flag)', '->', hits.length ? hits.join(', ') : 'nothing answers');
  }
  save();
}

// ---------------------------------------------------------------- Scrydex image CDN (the Pokemon TCG API's picture host since 2026)
const SCRYDEX = 'https://images.scrydex.com/pokemon';
/** Sets whose names differ too much between TCGdex and Scrydex for the name match (checked by hand against the expansion list). */
const SCRYDEX_ALIAS = { 'tk-hs-g': 'tk4b', 'tk-hs-r': 'tk4a', '30th-c': 'me55c', 'ex5.5': 'wb1' };
const norm = (n) => n.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

async function dataRepoSets() {
  const f = path.join(CACHE_DIR, 'pokemon-tcg-data-sets-en.json');
  if (!fs.existsSync(f)) {
    const res = await fetch('https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/sets/en.json', { headers: { 'User-Agent': UA } });
    fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  }
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

/** Scrydex's own expansion list (slug + id per set), from the public listing page; cached. */
async function scrydexExpansions() {
  const f = path.join(CACHE_DIR, 'scrydex-expansions.html');
  if (!fs.existsSync(f)) {
    const res = await fetch('https://scrydex.com/pokemon/expansions', { headers: { 'User-Agent': UA } });
    fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  }
  const html = fs.readFileSync(f, 'utf8');
  const m = new Map();
  for (const [, slug, id] of html.matchAll(/href="\/pokemon\/expansions\/([^"\/]+)\/([^"\/]+)"/g)) m.set(norm(slug), id);
  return m;
}

/** Candidate Scrydex ids for a TCGdex card: derived from the id, and via the set name in sets/en.json. */
function scrydexCandidates(card, set, repoByName, expByName) {
  const num = /^\d+$/.test(card.num) ? String(Number(card.num)) : card.num;
  const out = [];
  const add = (setId, n) => {
    const id = `${setId}-${n}`;
    if (!out.includes(id)) out.push(id);
  };
  add(card.set.replace(/\./g, ''), num);
  add(card.set.replace(/^([a-z]+)0*(\d+)/, '$1$2').replace(/\./g, ''), num); // me06 -> me6
  if (SCRYDEX_ALIAS[card.set]) add(SCRYDEX_ALIAS[card.set], num);
  const e = expByName.get(norm(set.name));
  if (e) add(e, num);
  const r = repoByName.get(norm(set.name));
  if (r) add(r.id, num);
  return out;
}

async function scrydex(args) {
  const { c, sets } = pokemon();
  const only = args.filter((a) => !a.startsWith('--'));
  const repo = await dataRepoSets();
  const repoByName = new Map(repo.map((s) => [norm(s.name), s]));
  const expByName = await scrydexExpansions();
  // what the CDN answers for an id it does not know (a card back, with status 200)
  const ph = await req(`${SCRYDEX}/zzz-not-a-card-999/small`, 'GET');
  console.log('placeholder for unknown ids:', ph.s, ph.n, 'bytes, md5', ph.h);
  const gaps = c.cards.filter((k) => !k.img && (!only.length || only.includes(k.set)));
  const per = {};
  const resolved = [];
  for (const k of gaps) {
    const set = sets.get(k.set);
    let hit = null;
    for (const id of scrydexCandidates(k, set, repoByName, expByName)) {
      const r = await req(`${SCRYDEX}/${id}/small`, 'GET');
      if (r.s === 200 && r.h && r.h !== ph.h) {
        hit = { id, n: r.n };
        break;
      }
    }
    const e = (per[k.set] ||= { gaps: 0, hit: 0, cats: {}, hitCats: {}, bytes: 0 });
    e.gaps++;
    e.cats[k.cat] = (e.cats[k.cat] || 0) + 1;
    if (hit) {
      e.hit++;
      e.hitCats[k.cat] = (e.hitCats[k.cat] || 0) + 1;
      e.bytes += hit.n;
      resolved.push({ card: k.id, scrydex: hit.id });
    }
  }
  const tot = { gaps: 0, hit: 0, bytes: 0, cats: {}, hitCats: {} };
  for (const [id, e] of Object.entries(per)) {
    tot.gaps += e.gaps;
    tot.hit += e.hit;
    tot.bytes += e.bytes;
    for (const [k, v] of Object.entries(e.cats)) tot.cats[k] = (tot.cats[k] || 0) + v;
    for (const [k, v] of Object.entries(e.hitCats)) tot.hitCats[k] = (tot.hitCats[k] || 0) + v;
    console.log(`${id.padEnd(12)} ${String(e.hit).padStart(3)}/${String(e.gaps).padEnd(3)} ${JSON.stringify(e.hitCats)} of ${JSON.stringify(e.cats)}`);
  }
  console.log('TOTAL', JSON.stringify(tot));
  fs.writeFileSync(path.join(CACHE_DIR, 'scrydex-resolved.json'), JSON.stringify(resolved));
  save();
}


// ---------------------------------------------------------------- tiers: merge the census and the Scrydex run
/** Where each gap card can get a picture: TCGdex English file, TCGdex other language, Scrydex only, nowhere. */
function tiers() {
  const { c, sets } = pokemon();
  const census = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'tcgdex-census.json'), 'utf8'));
  const sx = new Set(JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'scrydex-resolved.json'), 'utf8')).map((r) => r.card));
  const en = new Map(); // card id -> variant name of the English file
  const foreign = new Map(); // card id -> languages
  const enBytes = {};
  for (const row of census)
    for (const [name, list] of Object.entries(row.found))
      for (const f of list) {
        if (name === 'en high' || name.startsWith('set ')) {
          en.set(f.id, name);
          enBytes[f.id] = f.bytes;
        } else if (name.endsWith(' high')) (foreign.get(f.id) || foreign.set(f.id, []).get(f.id)).push(name.split(' ')[0]);
      }
  const gaps = c.cards.filter((k) => !k.img);
  const t = { A_tcgdex_english: [], B_tcgdex_foreign_only: [], C_scrydex_only: [], D_nowhere: [] };
  for (const k of gaps) {
    if (en.has(k.id)) t.A_tcgdex_english.push(k);
    else if (foreign.has(k.id)) t.B_tcgdex_foreign_only.push(k);
    else if (sx.has(k.id)) t.C_scrydex_only.push(k);
    else t.D_nowhere.push(k);
  }
  const cats = (arr) => tally(arr, (k) => k.cat);
  const out = { gaps: gaps.length, scrydexAny: gaps.filter((k) => sx.has(k.id)).length, scrydexAnyCats: cats(gaps.filter((k) => sx.has(k.id))) };
  for (const [name, arr] of Object.entries(t)) {
    out[name] = { n: arr.length, cats: cats(arr), sets: tally(arr, (k) => k.set) };
  }
  // of the cards TCGdex lacks in English: how many does Scrydex cover
  const lacking = [...t.B_tcgdex_foreign_only, ...t.C_scrydex_only, ...t.D_nowhere];
  out.lackingEnglish = { n: lacking.length, cats: cats(lacking), inScrydex: lacking.filter((k) => sx.has(k.id)).length, inScrydexCats: cats(lacking.filter((k) => sx.has(k.id))) };
  const sizes = Object.values(enBytes);
  out.avgEnglishLowBytes = null;
  out.enHighBytesAvg = sizes.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) : null;
  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(CACHE_DIR, 'tiers.json'), JSON.stringify({ ...out, lackingSets: tally(lacking, (k) => k.set) }));
}

// ---------------------------------------------------------------- Yu-Gi-Oh!
async function ygo() {
  const y = readJson('public/data/ygo/catalog.json');
  const printed = new Set(y.printings.map((p) => p[0]));
  const missing = y.cards.map((k, i) => ({ k, i })).filter((x) => !printed.has(x.i));
  console.log(`${missing.length} cards without a TCG printing, by type:`, JSON.stringify(tally(missing, (x) => x.k.type)));
  console.log('by frame:', JSON.stringify(tally(missing, (x) => x.k.frame)));
  // 40 evenly spaced samples + the 5 first
  const step = Math.max(1, Math.floor(missing.length / 40));
  const picks = missing.filter((_, i) => i % step === 0).slice(0, 45);
  let ok = 0;
  const bad = [];
  for (const { k } of picks) {
    const r = await req(`https://images.ygoprodeck.com/images/cards_small/${k.pc}.jpg`, 'HEAD');
    if (isImage(r)) ok++;
    else bad.push(`${k.pc} ${k.name} (${r.s})`);
  }
  console.log(`cards_small by passcode: ${ok}/${picks.length} answer with a picture`, bad.length ? 'misses: ' + bad.join('; ') : '');
  // the catalog's own cards (with printing) as a control
  const withPr = y.cards.filter((_, i) => printed.has(i)).filter((_, i) => i % 400 === 0).slice(0, 25);
  let ok2 = 0;
  for (const k of withPr) if (isImage(await req(`https://images.ygoprodeck.com/images/cards_small/${k.pc}.jpg`, 'HEAD'))) ok2++;
  console.log(`control, cards with a printing: ${ok2}/${withPr.length}`);
  save();
}

// ---------------------------------------------------------------- Magic
async function mtg(n) {
  const m = readJson('public/data/mtg/catalog.json');
  const total = m.printings.length;
  // deterministic sample: every (total/n)-th printing
  const step = Math.floor(total / n);
  let ok = 0;
  const bad = [];
  for (let i = 0; i < total && ok + bad.length < n; i += step) {
    const p = m.printings[i];
    const id = p[4];
    const url = `https://cards.scryfall.io/grid/front/${id[0]}/${id[1]}/${id}.webp`;
    const r = await req(url, 'HEAD');
    if (isImage(r)) ok++;
    else bad.push(`${m.sets[p[1]].id}-${p[2]} ${m.cards[p[0]].name} ${id} (${r.s})`);
  }
  console.log(`Scryfall grid image: ${ok}/${ok + bad.length} answer`, bad.length ? '\nmisses:\n  ' + bad.join('\n  ') : '');
  save();
}

// ---------------------------------------------------------------- main
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'measure') measure(rest.includes('--json'));
else if (cmd === 'tcgdex') await tcgdex(rest);
else if (cmd === 'census') await census(rest);
else if (cmd === 'cards') await cards(rest);
else if (cmd === 'tiers') tiers();
else if (cmd === 'scrydex') await scrydex(rest);
else if (cmd === 'ygo') await ygo();
else if (cmd === 'mtg') await mtg(Number(rest[0]) || 300);
else if (cmd === 'ext') {
  for (const u of rest) {
    const r = await req(u, 'HEAD');
    console.log(r.s, r.n, r.t, u);
  }
  save();
} else {
  console.log('usage: node scripts/probe-card-images.mjs measure|tcgdex|census|ygo|mtg|ext ...');
  process.exit(2);
}
