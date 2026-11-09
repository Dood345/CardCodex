#!/usr/bin/env node
// Builds public/data/text.json: the rules text of every Pokémon card in the catalog
// (attacks, Abilities, Trainer and Energy effects, weakness, resistance, retreat,
// what the card evolves from, regulation mark and format legality) from TCGdex,
// the catalog's own source. The deck recommender (src/recommend) reads it; the
// Pokédex, search and scanner never do, so it is a separate, lazily loaded file.
//
// Node built-ins only. Usage: node scripts/build-text.mjs [--no-cache]
//
// Shape (see src/recommend/card-text.ts): the unique texts once (`texts`), then
// for every catalog card that has one, parallel arrays with the card id, the text
// index, its regulation mark and legality bits. Reprints share a text entry; the
// mark and legality belong to the printing, so they stay per card.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { writeDataManifest } from './data-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'scripts', '.cache');
const OUT = path.join(ROOT, 'public', 'data');
const NO_CACHE = process.argv.includes('--no-cache');
const API = 'https://api.tcgdex.net/v2';

/** One letter per energy type, as deck lists write attack costs ("RRC"). Mirrored in src/recommend/card-text.ts. */
export const COST_LETTERS = {
  Grass: 'G',
  Fire: 'R',
  Water: 'W',
  Lightning: 'L',
  Psychic: 'P',
  Fighting: 'F',
  Darkness: 'D',
  Metal: 'M',
  Fairy: 'Y',
  Dragon: 'N',
  Colorless: 'C',
};

const TEXT_FIELDS =
  'id evolveFrom regulationMark retreat legal { standard expanded } abilities { type name effect } attacks { cost name effect damage } weaknesses { type value } resistances { type value } effect trainerType energyType';

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
    } catch (e) {
      err = e;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** i));
  }
  throw err;
}

function cachePath(key) {
  return path.join(CACHE, key.replace(/[^A-Za-z0-9._-]/g, '_'));
}

async function cached(key, fetcher) {
  const p = cachePath(key);
  if (!NO_CACHE && fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  const text = await fetcher();
  fs.writeFileSync(p, text);
  return text;
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

/**
 * Every card's text from one GraphQL query. A few cards have an attack without a
 * name, which the schema declares non-nullable: GraphQL then nulls that card's
 * `attacks` (or the card) and reports the path. Those cards are fetched again one
 * by one over REST, which has no such constraint, and spliced in.
 */
async function fetchTextGraphQL() {
  const text = await cached('cards_text_graphql.json', async () => {
    const res = await fetchRetry(API + '/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: `{ cards { ${TEXT_FIELDS} } }` }),
    });
    return res.text();
  });
  const j = JSON.parse(text);
  const cards = j.data?.cards;
  if (!Array.isArray(cards)) {
    try {
      fs.unlinkSync(cachePath('cards_text_graphql.json'));
    } catch {}
    fail('GraphQL returned no card list: ' + JSON.stringify(j.errors ?? j).slice(0, 500));
  }
  const broken = new Set();
  for (const e of j.errors ?? []) {
    const i = e.path?.[1];
    if (typeof i === 'number') broken.add(i);
  }
  log(`  ${cards.length} cards from GraphQL, ${j.errors?.length ?? 0} errors on ${broken.size} cards (refetched over REST)`);
  const nulls = cards.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
  assert(nulls.every((i) => broken.has(i)), `${nulls.length} null cards without a reported error`);
  await pool([...broken], 6, async (i) => {
    const id = cards[i]?.id ?? (await idOfBrokenCard(i));
    if (!id) return;
    const r = JSON.parse(await cached(`card_${id}.json`, async () => (await fetchRetry(`${API}/en/cards/${encodeURIComponent(id)}`)).text()));
    cards[i] = r;
  });
  return cards.filter(Boolean);
}

/** The id of a card GraphQL nulled entirely: the same query with ids only has the same order. */
let idsOnly;
async function idOfBrokenCard(i) {
  idsOnly ??= JSON.parse(
    await cached('cards_ids_graphql.json', async () => {
      const res = await fetchRetry(API + '/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ cards { id } }' }),
      });
      return res.text();
    }),
  ).data.cards;
  return idsOnly[i]?.id;
}

const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

/** Attack cost as letters; an unknown type keeps its full name in braces so nothing is silently lost. */
export function costLetters(cost) {
  if (!Array.isArray(cost)) return '';
  return cost.map((t) => COST_LETTERS[t] ?? `{${t}}`).join('');
}

/** The compact text record of one GraphQL card, or null when the card carries no rules text at all. */
export function textOf(raw) {
  const t = {};
  if (Array.isArray(raw.attacks) && raw.attacks.length) {
    t.a = raw.attacks.map((x) => {
      const a = { c: costLetters(x.cost), n: clean(x.name) };
      const d = clean(x.damage == null ? '' : String(x.damage));
      if (d) a.d = d;
      const e = clean(x.effect);
      if (e) a.e = e;
      return a;
    });
  }
  if (Array.isArray(raw.abilities) && raw.abilities.length) {
    t.b = raw.abilities.map((x) => ({ k: clean(x.type) || 'Ability', n: clean(x.name), e: clean(x.effect) }));
  }
  if (Array.isArray(raw.weaknesses) && raw.weaknesses.length) t.w = raw.weaknesses.flatMap((x) => [clean(x.type), clean(x.value)]);
  if (Array.isArray(raw.resistances) && raw.resistances.length) t.r = raw.resistances.flatMap((x) => [clean(x.type), clean(x.value)]);
  if (typeof raw.retreat === 'number') t.rc = raw.retreat;
  const ev = clean(raw.evolveFrom);
  if (ev) t.ev = ev;
  const fx = clean(raw.effect);
  if (fx) t.fx = fx;
  const tt = clean(raw.trainerType);
  if (tt) t.tt = tt;
  const et = clean(raw.energyType);
  if (et) t.et = et;
  return Object.keys(t).length ? t : null;
}

export function legalBits(legal) {
  return (legal?.standard ? 1 : 0) | (legal?.expanded ? 2 : 0);
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const builtAt = new Date().toISOString();
  const catalog = JSON.parse(fs.readFileSync(path.join(OUT, 'catalog.json'), 'utf8'));
  const inCatalog = new Set(catalog.cards.map((c) => c.id));
  log('Card text (TCGdex GraphQL)...');
  const raw = await fetchTextGraphQL();
  log(`  ${raw.length} usable cards, ${inCatalog.size} in the catalog`);

  const texts = [];
  const textIndex = new Map();
  const ids = [];
  const ti = [];
  const mk = [];
  const lg = [];
  const counts = { withText: 0, noText: 0, attacks: 0, abilities: 0, effects: 0, marks: 0, standard: 0, expanded: 0, oddCost: 0 };
  const noTextExamples = [];
  for (const r of raw) {
    if (!inCatalog.has(r.id)) continue;
    const t = textOf(r);
    if (!t) {
      counts.noText++;
      if (noTextExamples.length < 12) noTextExamples.push(r.id);
      continue;
    }
    counts.withText++;
    if (t.a) counts.attacks++;
    if (t.b) counts.abilities++;
    if (t.fx) counts.effects++;
    if (t.a?.some((a) => a.c.includes('{'))) counts.oddCost++;
    const key = JSON.stringify(t);
    let idx = textIndex.get(key);
    if (idx === undefined) {
      idx = texts.length;
      texts.push(t);
      textIndex.set(key, idx);
    }
    ids.push(r.id);
    ti.push(idx);
    const mark = clean(r.regulationMark);
    mk.push(mark);
    if (mark) counts.marks++;
    const bits = legalBits(r.legal);
    lg.push(bits);
    if (bits & 1) counts.standard++;
    if (bits & 2) counts.expanded++;
  }

  const file = { version: 1, builtAt, game: 'pokemon', texts, ids, ti, mk, lg };
  const str = JSON.stringify(file);
  fs.writeFileSync(path.join(OUT, 'text.json'), str);
  writeDataManifest(OUT);

  const byId = new Map(ids.map((id, i) => [id, texts[ti[i]]]));
  log('\n===== SUMMARY =====');
  log('cards with text:', counts.withText, 'without:', counts.noText, 'unique texts:', texts.length);
  log('with attacks:', counts.attacks, 'abilities:', counts.abilities, 'trainer/energy effects:', counts.effects, 'odd costs:', counts.oddCost);
  log('regulation marks:', counts.marks, 'standard-legal:', counts.standard, 'expanded-legal:', counts.expanded);
  log('no-text examples:', noTextExamples.join(' '));
  log('bytes:', str.length, 'gzip:', zlib.gzipSync(str).length);
  log('sample sv01-001:', JSON.stringify(byId.get('sv01-001')));
  log('sample sv01-172:', JSON.stringify(byId.get('sv01-172')));
  log('sample base1-4:', JSON.stringify(byId.get('base1-4')));

  // Validation
  const coverage = counts.withText / inCatalog.size;
  assert(coverage > 0.9, `only ${(coverage * 100).toFixed(1)}% of catalog cards have text`);
  assert(byId.get('sv01-001')?.a?.[0]?.c === 'CC', 'sv01-001 Guard Press should cost CC');
  assert(/Basic Energy/.test(byId.get('sv01-172')?.fx ?? ''), 'sv01-172 Energy Search text');
  assert(byId.get('base1-4')?.ev === 'Charmeleon', 'base1-4 should evolve from Charmeleon');
  assert(counts.oddCost === 0, 'attack costs with unknown energy types');
  log('\nOK');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
