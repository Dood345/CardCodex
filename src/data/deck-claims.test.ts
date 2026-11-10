/** One deck per owned copy: what older decks claim, and what that leaves a deck. */
import { describe, expect, it } from 'vitest';
import { POKEMON_DECK_RULES, YGO_DECK_RULES } from '@/games/deck-rules';
import type { CatalogIndex } from './catalog';
import type { CollectionEntry, Deck, DeckCard } from './db';
import { claimsBefore, claimText, deckSections, summarizeDeck } from './decks';

const own = (list: [string, number][]) =>
  new Map<string, CollectionEntry>(list.map(([cardId, qty]) => [cardId, { cardId, qty, wanted: 0, addedAt: 0, updatedAt: 0 }]));
const deck = (id: string, createdAt: number, cards: DeckCard[], name = `${id} deck`): Deck => ({ id, game: 'pokemon', name, cards, createdAt, updatedAt: createdAt });

// Three Charizard owned; the Fire deck (oldest) plays two, the Dragon deck two, the Rain deck one.
const collection = own([
  ['zard', 3],
  ['candy', 4],
  ['water', 9],
]);
const fire = deck('fire', 1, [
  { cardId: 'zard', qty: 2 },
  { cardId: 'candy', qty: 4 },
]);
const dragon = deck('dragon', 2, [
  { cardId: 'zard', qty: 2 },
  { cardId: 'candy', qty: 2 },
  { cardId: 'unowned', qty: 1 },
]);
const rain = deck('rain', 3, [
  { cardId: 'zard', qty: 1 },
  { cardId: 'water', qty: 9 },
]);
// Listed newest first, as the app lists them: the order must not matter.
const decks = [rain, dragon, fire];

describe('claimsBefore', () => {
  it('gives the oldest deck every copy it uses', () => {
    expect(claimsBefore(decks, 'fire', collection).size).toBe(0);
  });

  it('leaves a later deck what the older decks did not take', () => {
    const c = claimsBefore(decks, 'dragon', collection);
    expect(c.get('zard')).toEqual({ qty: 2, decks: ['fire deck'] });
    expect(c.get('candy')).toEqual({ qty: 4, decks: ['fire deck'] });
    expect(c.has('unowned')).toBe(false);
    expect(c.has('water')).toBe(false);
  });

  it('never claims more than is owned, and names only the decks that got a copy', () => {
    // Fire takes two Charizard, Dragon the third; nothing is left for Rain, and that is all three decks can hold.
    const c = claimsBefore(decks, 'rain', collection);
    expect(c.get('zard')).toEqual({ qty: 3, decks: ['fire deck', 'dragon deck'] });
    // Fire took all four Rare Candy, so Dragon holds none of them.
    expect(c.get('candy')).toEqual({ qty: 4, decks: ['fire deck'] });
    expect(c.has('water')).toBe(false);
  });

  it('puts a deck that is not saved yet behind every saved deck', () => {
    const c = claimsBefore(decks, undefined, collection);
    expect(c.get('zard')?.qty).toBe(3);
    expect(c.get('water')).toEqual({ qty: 9, decks: ['rain deck'] });
    expect(claimsBefore(decks, 'no-such-deck', collection)).toEqual(c);
  });

  it('breaks a tie in creation time by id, so the order is stable', () => {
    const a = deck('a', 5, [{ cardId: 'zard', qty: 3 }]);
    const b = deck('b', 5, [{ cardId: 'zard', qty: 3 }]);
    expect(claimsBefore([b, a], 'a', collection).size).toBe(0);
    expect(claimsBefore([b, a], 'b', collection).get('zard')).toEqual({ qty: 3, decks: ['a deck'] });
  });

  it('says where the copies are', () => {
    expect(claimText({ qty: 2, decks: ['Fire deck'] })).toBe('2 in Fire deck');
    expect(claimText({ qty: 3, decks: ['Fire deck', 'Dragon deck'] })).toBe('3 in 2 other decks');
  });
});

describe('a deck counted against what is left', () => {
  it('covers fewer copies when older decks hold them', () => {
    // Without claims the Dragon deck looks nearly complete.
    const plain = summarizeDeck(dragon.cards, collection);
    expect([plain.total, plain.covered, plain.short]).toEqual([5, 4, 1]);
    const s = summarizeDeck(dragon.cards, collection, claimsBefore(decks, 'dragon', collection));
    expect([s.total, s.covered, s.short]).toEqual([5, 1, 4]);
    expect(s.needs).toEqual([
      { cardId: 'zard', qty: 2, owned: 3, claimed: 2, short: 1 },
      { cardId: 'candy', qty: 2, owned: 4, claimed: 4, short: 2 },
      { cardId: 'unowned', qty: 1, owned: 0, claimed: 0, short: 1 },
    ]);
  });

  it('adds up to the collection: no copy is covered twice across decks', () => {
    const coveredZard = decks.map((d) => {
      const need = summarizeDeck(d.cards, collection, claimsBefore(decks, d.id, collection)).needs.find((n) => n.cardId === 'zard');
      const qty = d.cards.find((c) => c.cardId === 'zard')!.qty;
      return qty - (need?.short ?? 0);
    });
    expect(coveredZard.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('places lines with the copies that are free, the deck proper before the side deck', () => {
    const index = { cardsById: new Map() } as unknown as CatalogIndex;
    const claims = claimsBefore(decks, 'dragon', collection);
    const [main] = deckSections(POKEMON_DECK_RULES, dragon.cards, index, collection, claims);
    expect(main.lines.map((l) => [l.cardId, l.qty, l.available])).toEqual([
      ['zard', 2, 1],
      ['candy', 2, 0],
      ['unowned', 1, 0],
    ]);
    // Yu-Gi-Oh!: one free copy goes to the Main Deck line, none is left for the Side Deck line.
    const split: DeckCard[] = [
      { cardId: 'zard', qty: 1, zone: 'side' },
      { cardId: 'zard', qty: 1 },
    ];
    const sections = deckSections(YGO_DECK_RULES, split, index, collection, claims);
    const all = sections.flatMap((s) => s.lines);
    expect(all.find((l) => !l.zone)!.available).toBe(1);
    expect(all.find((l) => l.zone === 'side')!.available).toBe(0);
    // Without claims every line is covered, as before.
    expect(deckSections(YGO_DECK_RULES, split, index, collection).flatMap((s) => s.lines).map((l) => l.available)).toEqual([1, 1]);
  });
});
