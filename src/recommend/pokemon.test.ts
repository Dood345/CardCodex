/**
 * The Pokémon evaluator and the builder on the real catalog and card text.
 * The deck under test is assembled here from the catalog for the test's sake:
 * a Charizard ex line with Pidgeot ex for search, draw Supporters, Items to
 * find Pokémon, and Fire Energy. Nothing here ships to the app.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildIndex } from '@/data/catalog';
import type { CollectionMap } from '@/data/collection';
import type { DeckCard } from '@/data/db';
import type { Catalog, SpeciesFile } from '@/data/types';
import { buildDeck, contributions, suggestAdds, suggestSwaps } from './builder';
import { buildTextIndex, type CardTextFile } from './card-text';
import { createPokemonEvaluator, mulliganChance } from './pokemon';
import type { BuildOptions } from './types';

const dataDir = new URL('../../public/data/', import.meta.url);
const read = <T,>(f: string): T => JSON.parse(readFileSync(new URL(f, dataDir), 'utf8')) as T;
const index = buildIndex(read<Catalog>('catalog.json'), read<SpeciesFile>('species.json').species);
const text = buildTextIndex(read<CardTextFile>('text.json'));
const ev = createPokemonEvaluator({ index, text });

const deck = (lines: [string, number][]): DeckCard[] => lines.map(([cardId, qty]) => ({ cardId, qty }));

const CHARIZARD: [string, number][] = [
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

const options: BuildOptions = { source: 'catalog', collection: new Map(), format: 'any' };
const partOf = (cards: DeckCard[], id: string) => ev.score(cards).parts.find((p) => p.id === id)!;

describe('mulliganChance', () => {
  it('is the hypergeometric chance of no Basic in seven cards', () => {
    expect(mulliganChance(60, 10)).toBeCloseTo(0.259, 2);
    expect(mulliganChance(60, 0)).toBe(1);
    expect(mulliganChance(60, 60)).toBe(0);
  });
});

describe('Pokémon evaluator', () => {
  const cards = deck(CHARIZARD);

  it('has every test card in the catalog with text', () => {
    for (const [id] of CHARIZARD) {
      expect(index.cardsById.get(id), id).toBeDefined();
      expect(text.byId.get(id), id).toBeDefined();
    }
    expect(cards.reduce((n, c) => n + c.qty, 0)).toBe(60);
  });

  it('scores a coherent deck well above a random pile of 60 legal cards', () => {
    const good = ev.score(cards);
    expect(good.issues).toEqual([]);
    expect(good.total).toBeGreaterThan(75);
    // A seeded pseudo-random pile of distinct cards.
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const all = index.catalog.cards;
    const pile: DeckCard[] = [];
    while (pile.length < 60) {
      const c = all[Math.floor(rnd() * all.length)];
      if (!pile.some((p) => p.cardId === c.id)) pile.push({ cardId: c.id, qty: 1 });
    }
    const bad = ev.score(pile);
    expect(bad.total).toBeLessThan(good.total - 25);
  });

  it('explains each part in one line', () => {
    const s = ev.score(cards);
    expect(s.parts.map((p) => p.id)).toEqual(['rules', 'basics', 'lines', 'energy', 'draw', 'power', 'synergy', 'focus', 'era']);
    expect(s.parts.reduce((n, p) => n + p.weight, 0)).toBe(100);
    for (const p of s.parts) expect(p.detail.length).toBeGreaterThan(0);
    expect(partOf(cards, 'basics').detail).toMatch(/^10 Basic Pokémon: 2\d% chance/);
    expect(partOf(cards, 'era').detail).toMatch(/^Cards from 202\d–202\d$/);
    expect(partOf([...cards, { cardId: 'base1-91', qty: 1 }], 'era').detail).toContain('out of era: Bill');
    expect(partOf(cards, 'lines').score).toBe(1);
    expect(partOf(cards, 'power').detail).toContain('Charizard ex');
  });

  it('notices a missing pre-evolution unless Rare Candy bridges it', () => {
    const noCharmander = cards.filter((c) => c.cardId !== 'sv04.5-007');
    const lines = partOf(noCharmander, 'lines');
    expect(lines.score).toBeLessThan(1);
    expect(lines.detail).toContain('Charmeleon');
    // Without the Stage 1 the Stage 2 still stands on Rare Candy and the Basic.
    const noCharmeleon = cards.filter((c) => c.cardId !== 'sv04.5-008');
    expect(partOf(noCharmeleon, 'lines').score).toBe(1);
    const noCandyNoCharmeleon = noCharmeleon.filter((c) => c.cardId !== 'sv04.5-089');
    expect(partOf(noCandyNoCharmeleon, 'lines').detail).toContain('Charizard ex');
  });

  it('wants Energy of the attackers’ type', () => {
    const noFire = cards.filter((c) => c.cardId !== 'sve-002');
    const e = partOf(noFire, 'energy');
    expect(e.score).toBeLessThan(partOf(cards, 'energy').score);
    expect(e.detail).toMatch(/no Energy for Fire/);
    const water = [...noFire, { cardId: 'sve-003', qty: 6 }];
    expect(partOf(water, 'energy').detail).toMatch(/no Energy for Fire/);
  });

  it('flags conditional Trainers the deck cannot use', () => {
    // Magma Basin wants Fire Pokémon: fine here, dead in a Water deck.
    expect(partOf(cards, 'synergy').score).toBe(1);
    const waterDeck = deck([
      ['swsh12.5gg-GG06', 4], // Manaphy
      ['swsh9-144', 2], // Magma Basin
      ['sve-003', 10],
    ]);
    const s = partOf(waterDeck, 'synergy');
    expect(s.score).toBe(0);
    expect(s.detail).toContain('Magma Basin');
  });

  it('reports rule problems as issues', () => {
    const s = ev.score([...cards, { cardId: 'sv02-172', qty: 2 }]);
    expect(s.issues).toContain("Boss's Orders: 5 copies, 4 at most");
    expect(s.issues).toContain('2 cards over 60');
  });

  it('scores the mulligan odds, not the count', () => {
    const fewBasics = deck([
      ['sv04.5-054', 4],
      ['sv04.5-007', 2],
      ['sve-002', 54],
    ]);
    expect(partOf(fewBasics, 'basics').score).toBeLessThan(0.3);
  });
});

describe('builder', () => {
  const cards = deck(CHARIZARD);
  const pool = ev.pool(options);

  it('builds a pool of one printing per name', () => {
    const names = new Set(pool.map((c) => c.name));
    expect(names.size).toBe(pool.length);
    expect(pool.length).toBeGreaterThan(3500);
  });

  it('suggests the missing Basic for a line, with the reason', () => {
    const noCharmander = cards.filter((c) => c.cardId !== 'sv04.5-007');
    const adds = suggestAdds(ev, noCharmander, { ...options, limit: 5 }, pool);
    expect(adds.length).toBeGreaterThan(0);
    const charmander = adds.find((s) => s.move.add.some((c) => c.name === 'Charmander'));
    expect(charmander).toBeDefined();
    expect(charmander!.delta).toBeGreaterThan(0);
    expect(charmander!.partId).toBe('lines');
  });

  it('brings the earlier stages along when it suggests an evolution', () => {
    const start = deck([['sve-002', 4]]);
    const charizard = pool.find((c) => c.name === 'Charizard ex')!;
    const req = ev.requirements(charizard, start, pool);
    expect(req.map((c) => c.name)).toEqual(['Charmeleon', 'Charmander']);
  });

  it('ranks the weakest cards by what they carry', () => {
    const c = contributions(ev, cards, pool);
    expect(c.length).toBe(CHARIZARD.length);
    expect(c[0].loss).toBeLessThan(c[c.length - 1].loss);
    // A spare copy costs little; the main attacker is not dispensable.
    expect(c[0].loss).toBeLessThan(0.5);
    expect(c.slice(-5).map((x) => x.card.name)).toEqual(expect.arrayContaining(['Charizard ex']));
  });

  it('finds swaps that raise the score of a weakened deck', () => {
    // Trade the Fire Energy for Water: the swaps should bring Fire back.
    const broken = [...cards.filter((c) => c.cardId !== 'sve-002'), { cardId: 'sve-003', qty: 6 }];
    const swaps = suggestSwaps(ev, broken, { ...options, limit: 3 }, pool);
    expect(swaps.length).toBeGreaterThan(0);
    expect(swaps[0].delta).toBeGreaterThan(0);
    expect(swaps.some((s) => s.move.add.some((c) => c.name === 'Fire Energy'))).toBe(true);
  });

  it('builds a legal 60-card deck of one era around a seed', { timeout: 60000 }, () => {
    const t0 = performance.now();
    const built = buildDeck(ev, ['sv04.5-054'], { ...options, breadth: 80 }, pool);
    const ms = performance.now() - t0;
    const total = built.cards.reduce((n, c) => n + c.qty, 0);
    expect(total).toBe(60);
    expect(built.score.issues).toEqual([]);
    const names = new Set(built.cards.map((c) => index.cardsById.get(c.cardId)?.name));
    expect(names.has('Charizard ex')).toBe(true);
    expect(names.has('Charmander')).toBe(true);
    expect(names.has('Fire Energy')).toBe(true);
    expect(built.score.total).toBeGreaterThan(80);
    expect(built.steps.length).toBeGreaterThan(10);
    expect(built.score.parts.find((p) => p.id === 'basics')!.score).toBeGreaterThan(0.5);
    expect(built.score.parts.find((p) => p.id === 'era')!.score).toBeGreaterThan(0.8);
    expect(ms, `build took ${Math.round(ms)} ms`).toBeLessThan(10000);
  });

  it('keeps to the collection when that is the source', { timeout: 60000 }, () => {
    const collection: CollectionMap = new Map();
    for (const [id, qty] of CHARIZARD) collection.set(id, { cardId: id, qty, wanted: 0, addedAt: 0, updatedAt: 0 });
    const owned = { ...options, source: 'collection' as const, collection };
    const ownedPool = ev.pool(owned);
    expect(ownedPool.length).toBe(CHARIZARD.length);
    const built = buildDeck(ev, ['sv04.5-054'], owned, ownedPool);
    for (const c of built.cards) expect(c.qty, c.cardId).toBeLessThanOrEqual(collection.get(c.cardId)!.qty);
    expect(built.cards.reduce((n, c) => n + c.qty, 0)).toBe(60);
  });
});
