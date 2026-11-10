import { describe, expect, it } from 'vitest';
import { decodeDeck, deckShareText, encodeDeck, findDeckCode } from './deck-code';
import { normalizeCards, sizeHint, summarizeDeck, withQty } from './decks';
import { POKEMON_DECK_RULES, YGO_DECK_RULES } from '@/games/deck-rules';

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
      { cardId: 'a', qty: 4, owned: 1, claimed: 0, short: 3 },
      { cardId: 'c', qty: 1, owned: 0, claimed: 0, short: 1 },
    ]);
  });

  it('reminds of the deck size without enforcing it', () => {
    expect(sizeHint(POKEMON_DECK_RULES, 60)).toBeNull();
    expect(sizeHint(POKEMON_DECK_RULES, 48)).toBe('A Pokémon deck has 60 cards: 12 to go.');
    expect(sizeHint(POKEMON_DECK_RULES, 61)).toMatch(/1 over/);
    expect(sizeHint(YGO_DECK_RULES, 40)).toBeNull();
    expect(sizeHint(YGO_DECK_RULES, 60)).toBeNull();
    expect(sizeHint(YGO_DECK_RULES, 39)).toBe('A Yu-Gi-Oh! main deck has 40–60 cards: 1 to go.');
    expect(sizeHint(YGO_DECK_RULES, 63)).toMatch(/3 over/);
    expect(sizeHint(YGO_DECK_RULES, 0, 'extra')).toBeNull();
    expect(sizeHint(YGO_DECK_RULES, 16, 'extra')).toBe('An Extra deck has at most 15 cards: 1 over.');
    expect(sizeHint(YGO_DECK_RULES, 17, 'side')).toMatch(/Side deck has at most 15 cards: 2 over/);
    expect(sizeHint(POKEMON_DECK_RULES, 3, 'side')).toBeNull();
  });
});

describe('deck code with a side deck', () => {
  const deck = {
    game: 'ygo' as const,
    name: 'Side test',
    cards: [
      { cardId: 'ygo:LOB-EN119', qty: 2 },
      { cardId: 'ygo:LOB-EN119', qty: 1, zone: 'side' as const },
    ],
  };

  it('round-trips the side zone as a third element', async () => {
    const code = await encodeDeck(deck);
    expect(await decodeDeck(code)).toEqual(deck);
  });

  it('reads old two-element codes as the deck proper', async () => {
    const old = await encodeDeck({ game: 'ygo', name: 'Old', cards: [{ cardId: 'ygo:LOB-EN119', qty: 3 }] });
    expect((await decodeDeck(old)).cards).toEqual([{ cardId: 'ygo:LOB-EN119', qty: 3 }]);
  });

  it('stays a v1 code, so a 1.5.0 reader still opens it and merges the side into the deck', async () => {
    const code = await encodeDeck(deck);
    // What a 1.5.0 reader does: v must be 1, lines are [id, qty], and the deck is normalized on save.
    const raw = await rawPayload(code);
    expect(raw.v).toBe(1);
    expect(raw.c).toEqual([
      ['ygo:LOB-EN119', 2],
      ['ygo:LOB-EN119', 1, 's'],
    ]);
    const asOld = raw.c.map((l) => ({ cardId: l[0] as string, qty: l[1] as number }));
    expect(normalizeCards(asOld)).toEqual([{ cardId: 'ygo:LOB-EN119', qty: 3 }]);
  });
});

async function rawPayload(code: string): Promise<{ v: number; c: unknown[][] }> {
  const b64 = code.slice(5).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(stream).text());
}
