import { describe, expect, it } from 'vitest';
import { decodeDeck, deckShareText, encodeDeck, findDeckCode } from './deck-code';
import { normalizeCards, sizeHint, summarizeDeck, withQty } from './decks';

describe('deck code', () => {
  it('round-trips a deck through a short code found anywhere in a message', async () => {
    const deck = {
      game: 'pokemon' as const,
      name: 'Charizard ex',
      cards: [
        { cardId: 'sv03-125', qty: 4 },
        { cardId: 'sv01-057', qty: 2 },
        { cardId: 'base1-4', qty: 1 },
      ],
    };
    const code = await encodeDeck(deck);
    expect(code.startsWith('CCD1.')).toBe(true);
    expect(code).toMatch(/^CCD1\.[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(120);
    const text = deckShareText(deck, 'Pokémon TCG', ['4× Charizard ex · OBF 125/197'], code);
    expect(text).toContain('Charizard ex · Pokémon TCG deck · 7 cards');
    expect(text).toContain(`cardcodex://deck/${code}`);
    expect(findDeckCode(`hey, try this: ${text} thanks`)).toBe(code);
    expect(await decodeDeck(text)).toEqual(deck);
  });

  it('refuses garbage and keeps only sane lines', async () => {
    await expect(decodeDeck('nothing here')).rejects.toThrow(/No CardCodex deck code/);
    await expect(decodeDeck('CCD1.not-really-a-code')).rejects.toThrow(/damaged/);
    const odd = await encodeDeck({ game: 'ygo', name: '  ', cards: [] });
    // Hand-made payloads: bad lines are dropped, counts capped.
    const { game, name, cards } = await decodeDeck(odd);
    expect([game, name, cards]).toEqual(['ygo', 'Shared deck', []]);
    const packed = await encodeDeck({ game: 'ygo', name: 'x', cards: [{ cardId: 'ygo:LOB-EN001', qty: 500 }, { cardId: 'ygo:LOB-EN002', qty: 0 }] });
    expect((await decodeDeck(packed)).cards).toEqual([{ cardId: 'ygo:LOB-EN001', qty: 99 }]);
  });
});

describe('deck lists', () => {
  it('sets and removes lines in place, merges duplicates', () => {
    let cards = withQty([], 'a', 2);
    cards = withQty(cards, 'b', 1);
    cards = withQty(cards, 'a', 4);
    expect(cards).toEqual([
      { cardId: 'a', qty: 4 },
      { cardId: 'b', qty: 1 },
    ]);
    expect(withQty(cards, 'a', 0)).toEqual([{ cardId: 'b', qty: 1 }]);
    expect(normalizeCards([{ cardId: 'a', qty: 2 }, { cardId: 'a', qty: 1.9 }, { cardId: '', qty: 3 }, { cardId: 'c', qty: 0 }])).toEqual([{ cardId: 'a', qty: 3 }]);
  });

  it('sums what the collection covers and what it is short of', () => {
    const collection = new Map([
      ['a', { cardId: 'a', qty: 1, wanted: 0 as const, addedAt: 0, updatedAt: 0 }],
      ['b', { cardId: 'b', qty: 5, wanted: 0 as const, addedAt: 0, updatedAt: 0 }],
    ]);
    const s = summarizeDeck(
      [
        { cardId: 'a', qty: 4 },
        { cardId: 'b', qty: 2 },
        { cardId: 'c', qty: 1 },
      ],
      collection,
    );
    expect([s.total, s.distinct, s.covered, s.short]).toEqual([7, 3, 3, 4]);
    expect(s.needs).toEqual([
      { cardId: 'a', qty: 4, owned: 1, short: 3 },
      { cardId: 'c', qty: 1, owned: 0, short: 1 },
    ]);
  });

  it('reminds of the deck size without enforcing it', () => {
    expect(sizeHint('pokemon', 60)).toBeNull();
    expect(sizeHint('pokemon', 48)).toMatch(/12 to go/);
    expect(sizeHint('pokemon', 61)).toMatch(/1 over/);
    expect(sizeHint('ygo', 40)).toBeNull();
    expect(sizeHint('ygo', 60)).toBeNull();
    expect(sizeHint('ygo', 39)).toMatch(/1 to go/);
    expect(sizeHint('ygo', 63)).toMatch(/3 over/);
  });
});
