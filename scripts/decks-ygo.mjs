#!/usr/bin/env node
// Builds public/data/ygo/decks.json: the Yu-Gi-Oh! Structure Decks and Starter
// Decks as ready-made deck lists, from YGOPRODeck (https://ygoprodeck.com/api-guide/).
// Node built-ins only. Usage: node scripts/decks-ygo.mjs [--no-cache]
//
// A deck is a set: `cardsets.php` names the sets, `cardinfo.php?cardset=<name>`
// lists a set's cards with their `card_sets` entries. The whole `cardinfo.php`
// answer is already in scripts/.cache from the catalog build (ygo_cardinfo.json)
// and holds exactly those entries for every set, so the per-set lists are cut
// from it instead of asking the API ninety more times (it asks for gentle
// pacing). When the cache is missing, it is downloaded once, like the catalog.
//
// YGOPRODeck gives no per-card quantity: every printed code of the set becomes
// one line with quantity 1 (a card that is three copies in the box has three
// codes, so it still adds up), and each deck's `note` says so.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDataManifest } from './data-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'scripts', '.cache');
const OUT = path.join(ROOT, 'public', 'data', 'ygo', 'decks.json');
const API = 'https://db.ygoprodeck.com/api/v7';

/** A deck may lose this many cards to ids the catalog does not have; more and it is dropped. */
export const MAX_LOST = 3;
/** Fewer cards than this is a promo or a special edition, not a deck. */
export const MIN_CARDS = 20;

/** Sets that are a Structure Deck or a Starter Deck (of the Duel Monsters TCG). */
export function isDeckSet(name) {
  if (!/structure deck|starter deck/i.test(name)) return false;
  // Speed Duel boxes hold two decks each, the 2-Player box holds two decks mixed, and the
  // "Special Edition" / "Special Set" extras are one or two promo cards.
  return !/speed duel|2-player|special (edition|set)|deluxe edition/i.test(name);
}

/** "Structure Deck: Blue-Eyes White Destiny" → "structure-deck-blue-eyes-white-destiny". */
export function slug(name) {
  return name
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * The catalog id of every printing, keyed "<set name>|<code>|<passcode>", built with the
 * rule of src/games/ygo/catalog.ts: a code seen twice gets "~<passcode>" the second time.
 */
export function catalogIds(file) {
  const ids = new Map();
  const seen = new Set();
  for (const [ci, si, code] of file.printings) {
    const card = file.cards[ci];
    const set = file.sets[si];
    if (!card || !set) continue;
    const id = seen.has(code) ? `ygo:${code}~${card.pc}` : `ygo:${code}`;
    seen.add(code);
    ids.set(`${set.name}|${code}|${card.pc}`, id);
  }
  return ids;
}

/**
 * The deck of one set: one line per printed code of the set, in code order, quantity 1.
 * `cardinfo` is the API's `data` array, `ids` comes from catalogIds. Returns the lines and
 * how many codes the catalog does not know.
 */
export function deckOfSet(setName, cardinfo, ids) {
  const found = new Map();
  let lost = 0;
  for (const c of cardinfo) {
    for (const p of c.card_sets ?? []) {
      if (p.set_name !== setName) continue;
      const code = String(p.set_code || '').trim().toUpperCase();
      if (!code) continue;
      const id = ids.get(`${setName}|${code}|${c.id}`);
      if (found.has(code) || (!id && found.has(`!${code}`))) continue;
      if (id) found.set(code, id);
      else {
        found.set(`!${code}`, true);
        lost++;
      }
    }
  }
  const lines = [...found.entries()]
    .filter(([k]) => !k.startsWith('!'))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([, id]) => [id, 1]);
  return { cards: lines, lost };
}

/** The deck record for a set, or null when it lost too many cards or is too small. */
export function buildDeck(set, cardinfo, ids) {
  const { cards, lost } = deckOfSet(set.set_name, cardinfo, ids);
  if (lost > MAX_LOST || cards.length < MIN_CARDS) return null;
  return {
    id: slug(set.set_name),
    name: set.set_name,
    game: 'ygo',
    date: set.tcg_date || '',
    source: {
      name: 'YGOPRODeck',
      url: `${API}/cardinfo.php?cardset=${encodeURIComponent(set.set_name)}`,
    },
    note: `The card list of the ${set.set_name} set${set.tcg_date ? `, released ${set.tcg_date}` : ''}, one copy of each printed card. The box may hold more copies of some cards than this list does.`,
    cards,
  };
}

async function main() {
  const NO_CACHE = process.argv.includes('--no-cache');
  fs.mkdirSync(CACHE, { recursive: true });
  const cachedJson = async (name, url) => {
    const p = path.join(CACHE, name);
    if (!NO_CACHE && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    console.log(`  GET ${url}`);
    const res = await fetch(url, { headers: { 'User-Agent': 'CardCodex catalog builder (github.com/Dood345/CardCodex)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const text = await res.text();
    fs.writeFileSync(p, text);
    return JSON.parse(text);
  };

  console.log('Yu-Gi-Oh! starter decks (YGOPRODeck)...');
  const sets = await cachedJson('ygo_cardsets.json', `${API}/cardsets.php`);
  const cardinfo = (await cachedJson('ygo_cardinfo.json', `${API}/cardinfo.php`)).data;
  const catalogPath = path.join(ROOT, 'public', 'data', 'ygo', 'catalog.json');
  if (!fs.existsSync(catalogPath)) throw new Error('run `npm run catalog:ygo` first: public/data/ygo/catalog.json is missing');
  const ids = catalogIds(JSON.parse(fs.readFileSync(catalogPath, 'utf8')));

  const decks = [];
  const dropped = [];
  const seenIds = new Set();
  for (const set of [...sets].sort((a, b) => (a.tcg_date || '').localeCompare(b.tcg_date || '') || a.set_name.localeCompare(b.set_name))) {
    if (!isDeckSet(set.set_name)) continue;
    const deck = buildDeck(set, cardinfo, ids);
    if (!deck || seenIds.has(deck.id)) {
      dropped.push(set.set_name);
      continue;
    }
    seenIds.add(deck.id);
    decks.push(deck);
  }
  if (decks.length < 50) throw new Error(`too few decks: ${decks.length}`);
  if (dropped.length) console.log(`  dropped ${dropped.length}: ${dropped.join('; ')}`);

  const out = { version: 1, game: 'ygo', builtAt: new Date().toISOString(), decks };
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`Wrote ${path.relative(ROOT, OUT)}: ${decks.length} decks, ${decks.reduce((n, d) => n + d.cards.length, 0)} lines`);
  const manifest = writeDataManifest();
  console.log(`Wrote public/data/manifest.json (ygo/decks.json v=${manifest.files['ygo/decks.json'].hash})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
