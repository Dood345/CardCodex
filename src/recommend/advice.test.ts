/** What the deck screens ask of the recommender, on the real Pokémon catalog and card text. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeText } from '@/data/normalize';
import { buildIndex } from '@/data/catalog';
import type { Deck, DeckCard } from '@/data/db';
import type { Catalog, CatalogCard, SpeciesFile } from '@/data/types';
import { advise, builtDeckName, describeMove, formatDelta, formatsOf, mainCount, namesInDecks, namesToVary, seedIdeas, SOURCES } from './advice';
import { buildDeck, type SuggestOptions } from './builder';
import { buildTextIndex, type CardTextFile } from './card-text';
import { hasRecommender } from './index';
import { createPokemonEvaluator } from './pokemon';
import type { Suggestion } from './types';

const dataDir = new URL('../../public/data/', import.meta.url);
const read = <T,>(f: string): T => JSON.parse(readFileSync(new URL(f, dataDir), 'utf8')) as T;
const index = buildIndex(read<Catalog>('catalog.json'), read<SpeciesFile>('species.json').species);
const ev = createPokemonEvaluator({ index, text: buildTextIndex(read<CardTextFile>('text.json')) });

const options: SuggestOptions = { source: 'catalog', collection: new Map(), format: 'standard' };
const pool = ev.pool(options);
// A Stage 2 of the pool, picked by rule: the first by id whose text names what it evolves from.
const seed = [...pool].sort((a, b) => (a.id < b.id ? -1 : 1)).find((c) => ev.features(c).stage === 'Stage 2' && ev.features(c).best)!;
const built = buildDeck(ev, [seed.id], options, pool);
const card = (name: string): CatalogCard => ({ id: name, name, set: 'x', num: '1', cat: 'Pokemon' }) as CatalogCard;
const move = (add: string[], remove: string[] = []): Suggestion => ({
  move: { add: add.map(card), remove: remove.map(card) },
  total: 0,
  delta: 0,
  reason: '',
  detail: '',
  partId: '',
});

describe('advice for the deck screens', () => {
  it('knows which games have a recommender and what to offer', () => {
    expect(hasRecommender('pokemon')).toBe(true);
    expect(SOURCES.map((s) => s.id)).toEqual(['prefer-collection', 'collection', 'catalog']);
    expect(formatsOf(ev).map((f) => f.id)).toEqual(['standard', 'expanded', 'any']);
    expect(formatsOf({ ...ev, formats: undefined })).toEqual([{ id: 'any', label: 'Any format' }]);
  });

  it('suggests cards to add while a deck is short, with a reason each', () => {
    const start: DeckCard[] = [{ cardId: seed.id, qty: 2 }];
    const a = advise(ev, start, options, pool);
    expect(a.mode).toBe('add');
    expect(a.main).toBe(2);
    expect(a.target).toBe(60);
    expect(a.suggestions.length).toBeGreaterThan(0);
    for (const s of a.suggestions) {
      expect(s.delta).toBeGreaterThan(0);
      expect(s.reason).toMatch(/→/);
      expect(s.move.remove).toEqual([]);
    }
  });

  it('never suggests more cards than the deck has room for', () => {
    const lines = built.cards.map((l) => ({ ...l }));
    const last = lines[lines.length - 1];
    last.qty -= 1;
    const a = advise(ev, lines.filter((l) => l.qty > 0), options, pool);
    expect(a.mode).toBe('add');
    expect(a.main).toBe(59);
    for (const s of a.suggestions) expect(s.move.add).toHaveLength(1);
  });

  it('turns to swaps once the deck is full', () => {
    expect(mainCount(ev, built.cards)).toBe(60);
    const a = advise(ev, built.cards, options, pool);
    expect(a.mode).toBe('swap');
    for (const s of a.suggestions) {
      expect(s.move.remove).toHaveLength(1);
      expect(s.delta).toBeGreaterThan(0);
    }
  });

  it('puts a move and its gain into words', () => {
    expect(describeMove(move(['Charmander']))).toBe('Add Charmander');
    expect(describeMove(move(['Charizard ex', 'Charmander']))).toBe('Add Charizard ex with Charmander');
    expect(describeMove(move(['Charizard ex', 'Charmeleon', 'Charmander']))).toBe('Add Charizard ex with Charmeleon and Charmander');
    expect(describeMove(move(['Rare Candy'], ['Lost Vacuum']))).toBe('Swap Lost Vacuum for Rare Candy');
    expect(formatDelta(3.24)).toBe('+3.2');
    expect(formatDelta(0.01)).toBe('+0.1');
    expect(formatDelta(-1)).toBe('−1.0');
    expect(builtDeckName([card('Charizard ex')])).toBe('Charizard ex deck');
    expect(builtDeckName([card('A'), card('B'), card('C')])).toBe('A and B deck');
    expect(builtDeckName([])).toBe('Built deck');
  });

  it('collects the names other decks use, without the any-number cards', () => {
    const deck = (id: string, game: Deck['game'], cards: DeckCard[]): Deck => ({ id, game, name: id, cards, createdAt: 0, updatedAt: 0 });
    const basicEnergy = built.cards.map((l) => ev.card(l.cardId)!).find((c) => ev.rules.copyLimit(c) === Infinity);
    expect(basicEnergy).toBeDefined();
    const names = namesInDecks(ev, [deck('a', 'pokemon', built.cards), deck('b', 'ygo', [{ cardId: 'ygo-x', qty: 1 }])]);
    expect(names.has(seed.name)).toBe(true);
    expect(names.has(basicEnergy!.name)).toBe(false);
    expect(namesInDecks(ev, [deck('a', 'pokemon', built.cards)], 'a').size).toBe(0);
    const vary = namesToVary(ev, built.cards, [seed]);
    expect(vary.has(seed.name)).toBe(false);
    expect(vary.has(basicEnergy!.name)).toBe(false);
    expect(vary.size).toBeGreaterThan(5);
  });

  it('builds a different deck when told to avoid the last one', () => {
    const avoid = namesToVary(ev, built.cards, [seed]);
    const opts = { ...options, avoid };
    const second = buildDeck(ev, [seed.id], opts, ev.pool(opts));
    expect(mainCount(ev, second.cards)).toBe(60);
    const names = new Set(second.cards.map((l) => ev.card(l.cardId)!.name));
    expect(names.has(seed.name)).toBe(true);
    for (const n of avoid) expect(names.has(n), n).toBe(false);
    // The seed is a Stage 2: the second deck still holds the line it stands on.
    const f = ev.features(seed);
    expect(f.evolvesFrom).not.toBe('');
    expect([...names].some((n) => normalizeText(n) === f.evolvesFrom) || names.has('Rare Candy')).toBe(true);
    expect(avoid.has(f.evolvesFromName)).toBe(false);
  });

  it('offers distinct cards to start from', () => {
    const ideas = seedIdeas(ev, pool, 8);
    expect(ideas).toHaveLength(8);
    expect(new Set(ideas.map((c) => c.name)).size).toBe(8);
    for (const c of ideas) expect(ev.kindOf(c)).toBe('pokemon');
    // The evaluator's own ideas come from several Energy types.
    expect(new Set(ideas.map((c) => ev.features(c).types[0])).size).toBeGreaterThan(4);
    // Without them, the fallback takes the monsters with the highest printed HP.
    const plain = seedIdeas({ ...ev, seedIdeas: undefined }, pool, 5);
    expect(plain).toHaveLength(5);
    expect(new Set(plain.map((c) => c.name)).size).toBe(5);
    expect(seedIdeas({ ...ev, seedIdeas: (p, n) => p.slice(0, n) }, pool, 2)).toEqual(pool.slice(0, 2));
  });
});
