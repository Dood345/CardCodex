import { describe, expect, it } from 'vitest';
import { buildIndex } from './catalog';
import { computeStats, progressOf, type CollectionMap } from './collection';
import type { Catalog } from './types';

const catalog: Catalog = {
  version: 1,
  builtAt: '2026-01-01T00:00:00Z',
  sets: [
    { id: 'a', name: 'A', series: 's', seriesName: 'S', releaseDate: '2020-01-01', official: 2, total: 2, abbr: 'A' },
    { id: 'b', name: 'B', series: 's', seriesName: 'S', releaseDate: '2021-01-01', official: 1, total: 1, abbr: 'B' },
  ],
  cards: [
    { id: 'a-1', set: 'a', num: '1', name: 'Pikachu', cat: 'Pokemon', dex: [25] },
    { id: 'a-2', set: 'a', num: '2', name: 'Eevee', cat: 'Pokemon', dex: [133] },
    { id: 'b-1', set: 'b', num: '1', name: 'Pikachu', cat: 'Pokemon', dex: [25] },
  ],
};
const index = buildIndex(catalog, []);

const entry = (cardId: string, qty: number, wanted: 0 | 1 = 0) => ({ cardId, qty, wanted, addedAt: 0, updatedAt: 0 });

describe('computeStats', () => {
  it('counts copies, unique cards, species, sets and wishlist', () => {
    const col: CollectionMap = new Map([
      ['a-1', entry('a-1', 3)],
      ['b-1', entry('b-1', 1, 1)],
      ['a-2', entry('a-2', 0, 1)],
    ]);
    expect(computeStats(col, index)).toEqual({ totalCopies: 4, uniqueCards: 2, wanted: 2, groupsOwned: 1, setsTouched: 2 });
  });
  it('ignores entries of a game whose catalog is not loaded', () => {
    const col: CollectionMap = new Map([
      ['a-1', entry('a-1', 1)],
      ['ygo:LOB-001', entry('ygo:LOB-001', 3, 1)],
    ]);
    expect(computeStats(col, index)).toEqual({ totalCopies: 1, uniqueCards: 1, wanted: 0, groupsOwned: 1, setsTouched: 1 });
  });
});

describe('progressOf', () => {
  it('counts distinct owned cards out of a list', () => {
    const col: CollectionMap = new Map([['a-1', entry('a-1', 2)], ['a-2', entry('a-2', 0, 1)]]);
    expect(progressOf(index.cardsBySet.get('a')!, col)).toEqual({ owned: 1, total: 2 });
  });
});
