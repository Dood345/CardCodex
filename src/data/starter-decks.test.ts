import { describe, expect, it } from 'vitest';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CollectionEntry } from './db';
import { rankStarterDecks, starterFileFor, toDeckCards, type StarterDeck } from './starter-decks';

const own = (...pairs: [string, number][]) =>
  new Map(pairs.map(([cardId, qty]) => [cardId, { cardId, qty, wanted: 0, addedAt: 0, updatedAt: 0 } as CollectionEntry]));
const deck = (id: string, cards: [string, number][], date = ''): StarterDeck => ({
  id,
  name: id.toUpperCase(),
  game: 'ygo',
  date,
  source: { name: 'x', url: 'https://example.com' },
  note: '',
  cards,
});

describe('rankStarterDecks', () => {
  const a = deck('a', [['ygo:A-1', 1], ['ygo:A-2', 1], ['ygo:A-3', 1], ['ygo:A-4', 1]]);
  const b = deck('b', [['ygo:B-1', 1], ['ygo:B-2', 1]]);
  const c = deck('c', [['ygo:C-1', 2], ['ygo:C-2', 1]]);

  it('puts the fullest coverage first and reports the share', () => {
    const r = rankStarterDecks([a, b, c], own(['ygo:A-1', 1], ['ygo:A-2', 1], ['ygo:B-1', 1], ['ygo:C-1', 2], ['ygo:C-2', 1]));
    expect(r.map((x) => x.deck.id)).toEqual(['c', 'a', 'b']);
    expect(r.map((x) => [x.covered, x.total, x.coverage])).toEqual([[3, 3, 1], [2, 4, 0.5], [1, 2, 0.5]]);
  });
  it('counts a card at most as many times as the deck has it', () => {
    const [r] = rankStarterDecks([c], own(['ygo:C-1', 5]));
    expect([r.covered, r.total]).toEqual([2, 3]);
  });
  it('breaks ties by covered count, then newer deck, then name', () => {
    expect(rankStarterDecks([b, a], own(['ygo:A-1', 1], ['ygo:A-2', 1], ['ygo:B-1', 1])).map((x) => x.deck.id)).toEqual(['a', 'b']);
    const old = deck('old', [['ygo:O-1', 1]], '2010-01-01');
    const fresh = deck('fresh', [['ygo:F-1', 1]], '2020-01-01');
    expect(rankStarterDecks([old, fresh], new Map()).map((x) => x.deck.id)).toEqual(['fresh', 'old']);
    expect(rankStarterDecks([deck('y', [['ygo:Y', 1]]), deck('x', [['ygo:X', 1]])], new Map()).map((x) => x.deck.id)).toEqual(['x', 'y']);
  });
  it('leaves out cards the catalog does not know', () => {
    const [r] = rankStarterDecks([a], own(['ygo:A-1', 1]), (id) => id !== 'ygo:A-4' && id !== 'ygo:A-3');
    expect([r.covered, r.total]).toEqual([1, 2]);
  });
  it('handles no decks and empty decks', () => {
    expect(rankStarterDecks([], new Map())).toEqual([]);
    expect(rankStarterDecks([deck('e', [])], new Map())[0].coverage).toBe(0);
  });
  it('converts lines to deck cards', () => {
    expect(toDeckCards(b)).toEqual([{ cardId: 'ygo:B-1', qty: 1 }, { cardId: 'ygo:B-2', qty: 1 }]);
  });
});

describe('starterFileFor', () => {
  it('has a file for Yu-Gi-Oh! and none for Pokémon', () => {
    expect(starterFileFor('ygo')).toBe('ygo/decks.json');
    expect(starterFileFor('pokemon')).toBeNull();
  });
});

// The pure mapping of scripts/decks-ygo.mjs, on a small fixture catalog and a fake API answer.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lib: any = await import(/* @vite-ignore */ pathToFileURL(fileURLToPath(new URL('../../scripts/decks-ygo.mjs', import.meta.url))).href);

describe('scripts/decks-ygo.mjs', () => {
  const catalog = {
    sets: [{ name: 'Structure Deck: Test' }, { name: 'Other Set' }],
    cards: [{ pc: 1 }, { pc: 2 }, { pc: 3 }],
    // [card index, set index, code]
    printings: [
      [0, 0, 'SDT-EN001'],
      [0, 0, 'SDT-EN002'],
      [1, 0, 'SDT-EN003'],
      [2, 1, 'OTH-EN001'],
      [2, 1, 'SDT-EN003'], // same code printed on another card: the second use gets the passcode
    ],
  };
  const cardinfo = [
    { id: 1, card_sets: [{ set_name: 'Structure Deck: Test', set_code: 'SDT-EN002' }, { set_name: 'Structure Deck: Test', set_code: 'SDT-EN001' }, { set_name: 'Other Set', set_code: 'OTH-EN009' }] },
    { id: 2, card_sets: [{ set_name: 'Structure Deck: Test', set_code: 'SDT-EN003' }, { set_name: 'Structure Deck: Test', set_code: 'SDT-EN003' }] },
    { id: 3, card_sets: [{ set_name: 'Structure Deck: Test', set_code: 'SDT-EN004' }, { set_name: 'Other Set', set_code: 'SDT-EN003' }] },
  ];

  it('recognises structure and starter decks and skips the multi-deck boxes and promos', () => {
    for (const n of ['Structure Deck: Blue-Eyes White Destiny', 'Cyber Dragon Revolution Structure Deck', 'Starter Deck: Kaiba', 'Starter Deck 2006']) expect(lib.isDeckSet(n)).toBe(true);
    for (const n of ['Legend of Blue Eyes White Dragon', 'Speed Duel Starter Decks: Destiny Masters', '2-Player Starter Deck: Yuya & Declan', 'Starter Deck 2006: Special Edition', 'Structure Deck: Deluxe Edition']) expect(lib.isDeckSet(n)).toBe(false);
  });
  it('slugs names', () => {
    expect(lib.slug("Structure Deck: Dragon's Roar")).toBe('structure-deck-dragons-roar');
    expect(lib.slug('Starter Deck: Yu-Gi-Oh! 5D’s')).toBe('starter-deck-yu-gi-oh-5ds');
  });
  it('maps catalog ids with the same rule as the app, passcode suffix included', () => {
    const ids = lib.catalogIds(catalog);
    expect(ids.get('Structure Deck: Test|SDT-EN001|1')).toBe('ygo:SDT-EN001');
    expect(ids.get('Structure Deck: Test|SDT-EN003|2')).toBe('ygo:SDT-EN003');
    expect(ids.get('Other Set|SDT-EN003|3')).toBe('ygo:SDT-EN003~3');
  });
  it('lists one line per printed code in code order, quantity 1, and counts what the catalog lacks', () => {
    const { cards, lost } = lib.deckOfSet('Structure Deck: Test', cardinfo, lib.catalogIds(catalog));
    expect(cards).toEqual([['ygo:SDT-EN001', 1], ['ygo:SDT-EN002', 1], ['ygo:SDT-EN003', 1]]);
    expect(lost).toBe(1); // SDT-EN004 is not in the catalog
  });
  it('drops a deck that lost too many cards or is too small, and builds a whole one', () => {
    expect(lib.buildDeck({ set_name: 'Structure Deck: Test', tcg_date: '2020-01-01' }, cardinfo, lib.catalogIds(catalog))).toBeNull(); // 3 cards is below the minimum
    const code = (i: number) => `BIG-EN${String(i + 1).padStart(3, '0')}`;
    const big = {
      sets: [{ name: 'Big' }],
      cards: Array.from({ length: 30 }, (_, i) => ({ pc: i + 1 })),
      printings: Array.from({ length: 30 }, (_, i) => [i, 0, code(i)]),
    };
    const info = big.cards.map((c, i) => ({ id: c.pc, card_sets: [{ set_name: 'Big', set_code: code(i) }] }));
    const deck = lib.buildDeck({ set_name: 'Big', tcg_date: '2021-02-03' }, info, lib.catalogIds(big));
    expect(deck).toMatchObject({ id: 'big', name: 'Big', game: 'ygo', date: '2021-02-03' });
    expect(deck.cards).toHaveLength(30);
    expect(deck.source.url).toContain('cardset=Big');
    expect(deck.note).toMatch(/one copy of each/);
    const lossy = info.map((c, i) => (i < 5 ? { ...c, card_sets: [{ set_name: 'Big', set_code: `BIG-XX${i}` }] } : c)); // five codes the catalog lacks
    expect(lib.buildDeck({ set_name: 'Big' }, lossy, lib.catalogIds(big))).toBeNull();
  });
});
