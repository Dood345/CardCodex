// Local validation data for the deck benchmark (docs/deck-bench.md): deck
// lists with match records from the Limitless tournament platform's public
// API (https://play.limitlesstcg.com/api, documented at
// https://docs.limitlesstcg.com/developer.html; no key, rate limit 50
// requests per 5 minutes; see docs/deck-results-sources.md for the terms as
// read on 2026-11-09).
//
// The API states no licence for its data, so nothing fetched here is ever
// committed or shipped: raw responses stay in scripts/.cache/limitless/ and
// the corpora in scripts/.cache/decks/, both ignored by git, and only the
// benchmark's aggregate rates reach the repository. Player handles are in the
// raw responses only; the corpora carry none.
//
//   node scripts/fetch-limitless-decks.mjs [--events 30] [--min-players 64] [--format STANDARD]
//
// Writes two corpora in the shape src/recommend/bench/local.ts reads:
//   scripts/.cache/decks/limitless-archetypes/decks.json  one list per archetype with enough
//       matches (the best-placed one), strength = the archetype's match win rate over all events
//   scripts/.cache/decks/limitless-lists/decks.json       a sample of single lists with at least
//       six matches, strength = that list's own match win rate
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'https://play.limitlesstcg.com/api';
const UA = 'CardCodex deck-bench (open-source card collection app; local validation)';
const GAP_MS = 7000; // about 43 requests per 5 minutes, under the limit of 50

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const EVENTS = Number(arg('events', 30));
const MIN_PLAYERS = Number(arg('min-players', 64));
const FORMAT = arg('format', 'STANDARD');
const MIN_ARCHETYPE_MATCHES = 60;
const MIN_LIST_MATCHES = 6;
const MAX_LISTS = 400;

const root = new URL('../', import.meta.url);
const rawDir = new URL('scripts/.cache/limitless/', root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastFetch = 0;
async function get(path, cacheName) {
  const file = cacheName ? new URL(cacheName, rawDir) : null;
  if (file && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const wait = lastFetch + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastFetch = Date.now();
  const res = await fetch(`${API}${path}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const json = await res.json();
  if (file) writeFileSync(file, JSON.stringify(json));
  return json;
}

/** Finished events of the format with enough players, newest first; events of the last day are skipped (they may still be running). */
async function listEvents() {
  const out = [];
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (let page = 1; out.length < EVENTS && page <= 12; page++) {
    const list = await get(`/tournaments?game=PTCG&format=${FORMAT}&limit=50&page=${page}`);
    if (!Array.isArray(list) || !list.length) break;
    for (const t of list) {
      if (t.players >= MIN_PLAYERS && Date.parse(t.date) < cutoff && out.length < EVENTS) out.push(t);
    }
  }
  return out;
}

/** PTCGL set code + collector number → catalog card id. */
function cardFinder() {
  const catalog = JSON.parse(readFileSync(new URL('public/data/catalog.json', root), 'utf8'));
  const setsByAbbr = new Map();
  for (const s of catalog.sets) {
    if (!s.abbr) continue;
    if (!setsByAbbr.has(s.abbr)) setsByAbbr.set(s.abbr, []);
    setsByAbbr.get(s.abbr).push(s.id);
  }
  const norm = (n) => String(n).replace(/^0+(?=.)/, '').toLowerCase();
  const byKey = new Map();
  for (const c of catalog.cards) byKey.set(`${c.set}|${norm(c.num)}`, c);
  return (line) => {
    for (const set of setsByAbbr.get(line.set) ?? []) {
      const card = byKey.get(`${set}|${norm(line.number)}`);
      if (card) return card.id;
    }
    return undefined;
  };
}

function toCards(decklist, find, stats) {
  const cards = [];
  for (const kind of ['pokemon', 'trainer', 'energy']) {
    for (const line of decklist?.[kind] ?? []) {
      const id = find(line);
      stats.lines++;
      if (!id) stats.byName++;
      // Without an id the benchmark falls back to the name (its newest printing).
      cards.push(id ? { id, name: line.name, count: line.count } : { name: line.name, count: line.count });
    }
  }
  return cards;
}

mkdirSync(rawDir, { recursive: true });
const events = await listEvents();
console.log(`${events.length} ${FORMAT} events with at least ${MIN_PLAYERS} players`);
const find = cardFinder();
const stats = { lines: 0, byName: 0 };
const archetypes = new Map();
const lists = [];
for (const [i, ev] of events.entries()) {
  let standings;
  try {
    standings = await get(`/tournaments/${ev.id}/standings`, `standings-${ev.id}.json`);
  } catch (e) {
    console.log(`  skipped ${ev.id}: ${e.message}`);
    continue;
  }
  if (!Array.isArray(standings)) continue;
  let withList = 0;
  for (const p of standings) {
    const r = p.record ?? {};
    const matches = (r.wins ?? 0) + (r.losses ?? 0) + (r.ties ?? 0);
    const total = ['pokemon', 'trainer', 'energy'].reduce((n, k) => n + (p.decklist?.[k] ?? []).reduce((m, l) => m + l.count, 0), 0);
    if (!matches || total !== 60) continue;
    withList++;
    const points = (r.wins ?? 0) + 0.5 * (r.ties ?? 0);
    const cards = toCards(p.decklist, find, stats);
    const name = p.deck?.name ?? 'Other';
    const key = p.deck?.id ?? 'other';
    const rel = (p.placing ?? standings.length) / standings.length;
    let a = archetypes.get(key);
    if (!a) archetypes.set(key, (a = { id: key, name, matches: 0, points: 0, lists: 0, best: null, bestRel: 2 }));
    a.matches += matches;
    a.points += points;
    a.lists++;
    if (rel < a.bestRel) {
      a.bestRel = rel;
      a.best = cards;
    }
    if (matches >= MIN_LIST_MATCHES) lists.push({ id: `${ev.id}-${p.placing}`, name, strength: points / matches, cards });
  }
  console.log(`  ${i + 1}/${events.length} ${ev.date.slice(0, 10)} ${ev.players} players, ${withList} lists`);
}

const write = (folder, decks) => {
  const dir = new URL(`scripts/.cache/decks/${folder}/`, root);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('decks.json', dir), JSON.stringify(decks));
  console.log(`${folder}: ${decks.length} decks → ${fileURLToPath(dir)}`);
};
const byArchetype = [...archetypes.values()]
  .filter((a) => a.id !== 'other' && a.matches >= MIN_ARCHETYPE_MATCHES && a.best)
  .map((a) => ({ id: `arch-${a.id}`, name: a.name, strength: a.points / a.matches, matches: a.matches, lists: a.lists, cards: a.best }))
  .sort((a, b) => b.strength - a.strength);
write('limitless-archetypes', byArchetype);
// An even sample, so the corpus stays a size the playtest judges can run.
const step = Math.max(1, Math.ceil(lists.length / MAX_LISTS));
write('limitless-lists', lists.filter((_, i) => i % step === 0));
console.log(`${stats.lines} list lines, ${stats.byName} matched by name only (${((stats.byName / Math.max(1, stats.lines)) * 100).toFixed(1)}%)`);
