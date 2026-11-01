#!/usr/bin/env node
// Builds public/data/ygo/catalog.json: every Yu-Gi-Oh! TCG card and printing,
// from the YGOPRODeck API v7 (https://ygoprodeck.com/api-guide/).
// Node built-ins only. Usage: node scripts/build-ygo-catalog.mjs [--no-cache]
//
// The file is two-level to stay small (~3 MB for 14.6k cards / 44.7k
// printings): `cards` holds one entry per card (passcode), `printings` one
// row per set code. The app expands it into the generic Catalog shape in
// src/games/ygo/catalog.ts. Card images are NOT downloaded here: YGOPRODeck
// asks that each image be fetched once and stored, which the app does per
// device (src/data/imageCache.ts).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDataManifest } from './data-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'scripts', '.cache');
const OUT_DIR = path.join(ROOT, 'public', 'data', 'ygo');
const OUT = path.join(OUT_DIR, 'catalog.json');
const NO_CACHE = process.argv.includes('--no-cache');
const API = 'https://db.ygoprodeck.com/api/v7';

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

/** One download per endpoint, cached on disk (the API asks for exactly that). */
async function cachedJson(name, url) {
  const p = path.join(CACHE, name);
  if (!NO_CACHE && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  log(`  GET ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': 'CardCodex catalog builder (github.com/Dood345/CardCodex)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  fs.writeFileSync(p, text);
  return JSON.parse(text);
}

/** "Effect Monster" → "Monster", "Spell Card" → "Spell", ... */
function categoryOf(type) {
  if (/monster/i.test(type)) return 'Monster';
  if (/^spell/i.test(type)) return 'Spell';
  if (/^trap/i.test(type)) return 'Trap';
  if (/^skill/i.test(type)) return 'Skill';
  if (/^token/i.test(type)) return 'Token';
  return 'Other';
}

/** Numeric tail of a printing code for ordering ("LOB-EN001" → 1, "SOI-ENSE1" → 1). */
function codeOrder(code) {
  const m = /([0-9]+)[A-Z]?$/.exec(code);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

log('Yu-Gi-Oh! catalog (YGOPRODeck)...');
const setsRaw = await cachedJson('ygo_cardsets.json', `${API}/cardsets.php`);
const cardsRaw = (await cachedJson('ygo_cardinfo.json', `${API}/cardinfo.php`)).data;
assert(Array.isArray(setsRaw) && setsRaw.length > 500, `too few sets: ${setsRaw?.length}`);
assert(Array.isArray(cardsRaw) && cardsRaw.length > 10000, `too few cards: ${cardsRaw?.length}`);
log(`  ${cardsRaw.length} cards, ${setsRaw.length} sets from the API`);

// ---------- sets ----------
// Set names are unique in the API; set codes (prefixes) are not ("ABPF" is
// both the booster and its special edition), so ids get a numeric suffix on
// collision, in release order for determinism.
const setsSorted = [...setsRaw].sort(
  (a, b) => (a.tcg_date || '9999').localeCompare(b.tcg_date || '9999') || a.set_name.localeCompare(b.set_name),
);
const sets = [];
const setByName = new Map();
const usedIds = new Set();
function addSet(name, code, date, total) {
  const base = String(code || name).toLowerCase().replace(/[^a-z0-9]+/g, '') || 'set';
  let id = base;
  for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
  usedIds.add(id);
  const set = { id, name, code: String(code || '').toUpperCase(), date: date || '', total: total || 0 };
  sets.push(set);
  setByName.set(name, set);
  return set;
}
for (const s of setsSorted) {
  if (setByName.has(s.set_name)) continue;
  addSet(s.set_name, s.set_code, s.tcg_date, s.num_of_cards);
}

// ---------- cards + printings ----------
/** Printed set code: prefix, optional hyphen, 2–8 letters/digits ("LOB-EN001", "SDK-001", "DB49"). */
const CODE_RE = /^[A-Z0-9]{2,6}(-[A-Z0-9]{2,8})?$/;
const skippedCodes = [];
const cards = [];
const cardIndexByPc = new Map();
/** code → Map(cardIdx → Set(rarity)) */
const byCode = new Map();
const synthesized = new Set();
for (const c of [...cardsRaw].sort((a, b) => a.id - b.id)) {
  assert(Number.isInteger(c.id) && c.id > 0, `bad passcode on ${c.name}`);
  assert(typeof c.name === 'string' && c.name.trim(), `empty name for ${c.id}`);
  assert(!cardIndexByPc.has(c.id), `duplicate passcode ${c.id}`);
  const card = {
    pc: c.id,
    name: c.name.trim(),
    type: c.type,
    frame: c.frameType,
  };
  if (c.race) card.race = c.race;
  if (c.attribute) card.attr = c.attribute;
  if (typeof c.atk === 'number') card.atk = c.atk;
  if (typeof c.def === 'number') card.def = c.def;
  if (typeof c.level === 'number') card.lv = c.level;
  else if (typeof c.linkval === 'number') card.lv = c.linkval;
  // Archetype names: skip the API's internal markers ("| supports_archetype").
  if (c.archetype && /^[A-Za-z0-9@"'(-]/.test(c.archetype) && !/[_|]/.test(c.archetype)) card.arc = c.archetype;
  const alt = (c.card_images ?? []).map((i) => i.id).filter((id) => id !== c.id);
  if (alt.length) card.alt = alt;
  cardIndexByPc.set(c.id, cards.length);
  cards.push(card);

  for (const p of c.card_sets ?? []) {
    const code = String(p.set_code || '').trim().toUpperCase();
    if (!code) continue;
    if (!CODE_RE.test(code)) {
      // Placeholder codes for unreleased prints ("MF03-EN0??").
      skippedCodes.push(code);
      continue;
    }
    let set = setByName.get(p.set_name);
    if (!set) {
      // A set the cardsets endpoint does not list yet (brand new / promo).
      const prefix = code.split('-')[0];
      set = addSet(p.set_name, prefix, '', 0);
      synthesized.add(p.set_name);
    }
    const key = `${set.id}|${code}`;
    let perCard = byCode.get(key);
    if (!perCard) byCode.set(key, (perCard = new Map()));
    const ci = cards.length - 1;
    let rar = perCard.get(ci);
    if (!rar) perCard.set(ci, (rar = new Set()));
    if (p.set_rarity) rar.add(p.set_rarity);
  }
}
if (skippedCodes.length) log(`  skipped ${skippedCodes.length} placeholder code(s): ${skippedCodes.slice(0, 5).join(', ')}`);
if (synthesized.size) log(`  synthesized ${synthesized.size} set(s) missing from cardsets.php: ${[...synthesized].join('; ')}`);

const setIndexById = new Map(sets.map((s, i) => [s.id, i]));
const printings = [];
for (const [key, perCard] of byCode) {
  const [setId, code] = key.split('|');
  for (const [ci, rarities] of perCard) {
    printings.push([ci, setIndexById.get(setId), code, [...rarities].sort().join(' / ')]);
  }
}
// Set order (release), then code number, then code text, then passcode.
printings.sort(
  (a, b) =>
    a[1] - b[1] || codeOrder(a[2]) - codeOrder(b[2]) || a[2].localeCompare(b[2]) || cards[a[0]].pc - cards[b[0]].pc,
);
// Fill in totals for synthesized sets.
const countBySet = new Map();
for (const p of printings) countBySet.set(p[1], (countBySet.get(p[1]) ?? 0) + 1);
sets.forEach((s, i) => {
  if (!s.total) s.total = countBySet.get(i) ?? 0;
});

// ---------- validate ----------
assert(cards.length === cardIndexByPc.size, 'card index mismatch');
for (const p of printings) {
  assert(cards[p[0]] && sets[p[1]], `dangling printing ${p[2]}`);
  assert(CODE_RE.test(p[2]), `odd printing code ${p[2]}`);
}
const reused = new Map();
for (const p of printings) reused.set(p[2], (reused.get(p[2]) ?? 0) + 1);
const multi = [...reused.values()].filter((n) => n > 1).length;
const withoutPrintings = cards.filter((_, i) => !printings.some((p) => p[0] === i)).length;
log(`  ${cards.length} cards, ${sets.length} sets, ${printings.length} printings (${multi} codes shared by different cards, ${withoutPrintings} cards with no TCG printing)`);

const out = { version: 1, game: 'ygo', builtAt: new Date().toISOString(), sets, cards, printings };
const json = JSON.stringify(out);
fs.writeFileSync(OUT, json);
log(`Wrote ${path.relative(ROOT, OUT)} (${(json.length / 1e6).toFixed(2)} MB)`);
// Versions for the web app's cache busting (see scripts/data-manifest.mjs).
const manifest = writeDataManifest();
log(`Wrote public/data/manifest.json (ygo/catalog.json v=${manifest.files['ygo/catalog.json'].hash})`);
