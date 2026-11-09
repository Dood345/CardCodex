/**
 * Test-only fixtures for the simulator: the real catalog and card text read
 * from public/data, and decks assembled from catalog ids. The Charizard ex
 * deck is the one src/recommend/pokemon.test.ts builds, copied here (that
 * test is not imported). Nothing here ships to the app.
 */
import { readFileSync } from 'node:fs';
import { buildIndex, type CatalogIndex } from '@/data/catalog';
import type { DeckCard } from '@/data/db';
import type { Catalog, SpeciesFile } from '@/data/types';
import { buildTextIndex, type CardTextFile } from '../card-text';
import { createPokemonEvaluator, type PokemonEvaluator } from '../pokemon';

let loaded: { index: CatalogIndex; ev: PokemonEvaluator } | null = null;

export function loadEvaluator(): { index: CatalogIndex; ev: PokemonEvaluator } {
  if (loaded) return loaded;
  const dataDir = new URL('../../../public/data/', import.meta.url);
  const read = <T,>(f: string): T => JSON.parse(readFileSync(new URL(f, dataDir), 'utf8')) as T;
  const index = buildIndex(read<Catalog>('catalog.json'), read<SpeciesFile>('species.json').species);
  const text = buildTextIndex(read<CardTextFile>('text.json'));
  loaded = { index, ev: createPokemonEvaluator({ index, text }) };
  return loaded;
}

export const deck = (lines: readonly (readonly [string, number])[]): DeckCard[] => lines.map(([cardId, qty]) => ({ cardId, qty }));

export const CHARIZARD: [string, number][] = [
  ['sv04.5-007', 3], // Charmander
  ['sv04.5-008', 1], // Charmeleon
  ['sv04.5-054', 3], // Charizard ex
  ['sv04.5-196', 2], // Pidgey
  ['sv04.5-221', 2], // Pidgeot ex
  ['swsh12.5-045', 1], // Rotom V
  ['swsh12.5gg-GG39', 1], // Lumineon V
  ['swsh12.5-020', 1], // Radiant Charizard
  ['swsh12.5gg-GG06', 1], // Manaphy
  ['sv07-098', 1], // Jirachi
  ['sv04.5-089', 4], // Rare Candy
  ['sv04.5-091', 4], // Ultra Ball
  ['sv04.5-084', 4], // Nest Ball
  ['sv08.5-101', 3], // Buddy-Buddy Poffin
  ['sv04.5-235', 4], // Arven
  ['sv04.5-080', 4], // Iono
  ['sv02-172', 3], // Boss's Orders
  ['sv10.5b-085', 2], // Professor's Research
  ['sv04-160', 1], // Counter Catcher
  ['sv02-188', 1], // Super Rod
  ['swsh12.5-135', 1], // Lost Vacuum
  ['sv03.5-206', 1], // Switch
  ['sv01-169', 1], // Defiance Band
  ['swsh12-156', 1], // Forest Seal Stone
  ['sv04-178', 1], // Technical Machine: Evolution
  ['swsh9-144', 1], // Magma Basin
  ['sv01-187', 1], // Pokémon Catcher
  ['sv10.5w-082', 1], // Energy Retrieval
  ['sve-002', 6], // Fire Energy
];

/** Water Energy: a blank for the Charizard deck (nothing in it uses Water), to pad a deck back to 60 after removing cards. */
export const BLANK = 'sve-003';

/** Replace every copy of `ids` with the blank, keeping 60 cards. */
export function withBlanks(cards: readonly DeckCard[], ids: readonly string[]): DeckCard[] {
  const drop = new Set(ids);
  const out = cards.filter((c) => !drop.has(c.cardId));
  const removed = cards.filter((c) => drop.has(c.cardId)).reduce((n, c) => n + c.qty, 0);
  return removed ? [...out, { cardId: BLANK, qty: removed }] : out;
}

/** A seeded pile of 60 distinct cards printed in the given years. */
export function randomPile(index: CatalogIndex, seed: number, fromYear: number, toYear: number): DeckCard[] {
  const year = (setId: string) => Number(index.setsById.get(setId)?.releaseDate.slice(0, 4)) || 0;
  const all = index.catalog.cards.filter((c) => (c.cat === 'Pokemon' || c.cat === 'Trainer' || c.cat === 'Energy') && year(c.set) >= fromYear && year(c.set) <= toYear);
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const picked = new Set<string>();
  while (picked.size < 60) picked.add(all[Math.floor(rnd() * all.length)].id);
  return [...picked].map((cardId) => ({ cardId, qty: 1 }));
}
