import { describe, expect, it } from 'vitest';
import { encodeDeck } from './deck-code';
import { DECK_FILE_ROUTE, decodeDeckText, deckFileName, encodeDeckFile, heldDeckFile, holdDeckFile } from './deck-file';

const deck = {
  game: 'pokemon' as const,
  name: 'Charizard ex',
  cards: [
    { cardId: 'sv03-125', qty: 4 },
    { cardId: 'base1-4', qty: 1 },
  ],
};

describe('deck file', () => {
  it('names the file after the deck, safely', () => {
    expect(deckFileName('Charizard ex')).toBe('Charizard-ex.ccdeck');
    expect(deckFileName('  Pokémon: Fire / Water?  ')).toBe('Pokemon-Fire-Water.ccdeck');
    expect(deckFileName('???')).toBe('deck.ccdeck');
    expect(deckFileName('x'.repeat(80))).toBe('x'.repeat(40) + '.ccdeck');
  });

  it('round-trips a deck through the file text', async () => {
    const text = encodeDeckFile(deck, new Date('2026-11-02T10:00:00Z'));
    const raw = JSON.parse(text);
    expect(raw.cardcodex).toBe('deck');
    expect(raw.cards).toEqual([
      { id: 'sv03-125', qty: 4 },
      { id: 'base1-4', qty: 1 },
    ]);
    expect(raw.exportedAt).toBe('2026-11-02T10:00:00.000Z');
    expect(text.length).toBeLessThan(400);
    expect(await decodeDeckText(text)).toEqual(deck);
  });

  it('carries a side-deck line as side: true, and reads files without it as the deck proper', async () => {
    const ygo = {
      game: 'ygo' as const,
      name: 'Side test',
      cards: [
        { cardId: 'ygo:LOB-EN119', qty: 2 },
        { cardId: 'ygo:LOB-EN119', qty: 1, zone: 'side' as const },
      ],
    };
    const text = encodeDeckFile(ygo);
    const raw = JSON.parse(text);
    expect(raw.v).toBe(1);
    expect(raw.cards).toEqual([
      { id: 'ygo:LOB-EN119', qty: 2 },
      { id: 'ygo:LOB-EN119', qty: 1, side: true },
    ]);
    expect(await decodeDeckText(text)).toEqual(ygo);
    const old = JSON.stringify({ cardcodex: 'deck', v: 1, game: 'ygo', name: 'Old', cards: [{ id: 'ygo:LOB-EN119', qty: 3 }] });
    expect((await decodeDeckText(old)).cards).toEqual([{ cardId: 'ygo:LOB-EN119', qty: 3 }]);
  });

  it('drops bad lines and caps counts', async () => {
    const text = JSON.stringify({
      cardcodex: 'deck',
      v: 1,
      game: 'ygo',
      name: '  ',
      cards: [{ id: 'ygo-1', qty: 500 }, { id: 7, qty: 1 }, { id: 'ygo-2', qty: 0 }, null],
    });
    expect(await decodeDeckText(text)).toEqual({ game: 'ygo', name: 'Shared deck', cards: [{ cardId: 'ygo-1', qty: 99 }] });
  });

  it('also reads a saved share message, and refuses anything else', async () => {
    const code = await encodeDeck(deck);
    expect(await decodeDeckText(`Open in CardCodex: cardcodex://deck/${code}`)).toEqual(deck);
    await expect(decodeDeckText('{"cardcodex":"collection"}')).rejects.toThrow('not a CardCodex deck');
    await expect(decodeDeckText('{not json')).rejects.toThrow('not a CardCodex deck');
    await expect(decodeDeckText('hello')).rejects.toThrow('not a CardCodex deck');
    await expect(decodeDeckText('')).rejects.toThrow('not a CardCodex deck');
  });

  it('holds an opened file for the import page', () => {
    expect(heldDeckFile()).toBeNull();
    holdDeckFile({ name: 'a.ccdeck', text: '{}' });
    expect(heldDeckFile()).toEqual({ name: 'a.ccdeck', text: '{}' });
    expect(DECK_FILE_ROUTE).toBe('/decks/import/file');
  });
});
