import { describe, expect, it } from 'vitest';
import { parseExportedDecks } from './decks';

describe('parseExportedDecks', () => {
  it('keeps well-formed decks and drops the rest', () => {
    const decks = parseExportedDecks([
      {
        id: 'a',
        game: 'pokemon',
        name: ' Fire ',
        cards: [{ cardId: 'base1-4', qty: 2 }, { cardId: 'base1-4', qty: 1 }, { cardId: 7, qty: 1 }, { cardId: 'x', qty: 0 }, null],
        createdAt: 5,
        updatedAt: 9,
      },
      { id: 'b', game: 'ygo', name: '', cards: [] },
      { id: '', game: 'pokemon', name: 'no id', cards: [] },
      { id: 'c', game: 'chess', name: 'wrong game', cards: [] },
      { id: 'd', game: 'pokemon', name: 'no cards' },
      null,
      'junk',
    ]);
    expect(decks.map((d) => d.id)).toEqual(['a', 'b']);
    expect(decks[0]).toMatchObject({ name: 'Fire', cards: [{ cardId: 'base1-4', qty: 3 }], createdAt: 5, updatedAt: 9 });
    expect(decks[1].name).toBe('Untitled deck');
    expect(decks[1].createdAt).toBeGreaterThan(0);
    expect(decks[1].updatedAt).toBe(decks[1].createdAt);
  });

  it('is empty for anything that is not a list', () => {
    expect(parseExportedDecks(undefined)).toEqual([]);
    expect(parseExportedDecks({})).toEqual([]);
    expect(parseExportedDecks('x')).toEqual([]);
  });
});
