import { describe, expect, it } from 'vitest';
import type { CollectionEntry } from './db';
import { asListSort, sortCards, sortList } from './sorting';
import type { CatalogCard } from './types';

const species = [
  { id: 1, name: 'Bulbasaur' },
  { id: 4, name: 'Charmander' },
  { id: 7, name: 'Squirtle' },
  { id: 25, name: 'Pikachu' },
  { id: 133, name: 'Eevee' },
];
const owned = new Map([
  [25, 6],
  [4, 2],
  [133, 2],
]);
const names = (list: readonly { name: string }[]) => list.map((s) => s.name);
const sorted = (sort: Parameters<typeof sortList>[1]) =>
  sortList(
    species,
    sort,
    (s) => s.name,
    (s) => owned.get(s.id) ?? 0,
  );

describe('sortList', () => {
  it('keeps the natural order as the very list it was given', () => {
    expect(sorted('natural')).toBe(species);
  });

  it('sorts by name without touching the list it was given', () => {
    expect(names(sorted('name'))).toEqual(['Bulbasaur', 'Charmander', 'Eevee', 'Pikachu', 'Squirtle']);
    expect(names(species)).toEqual(['Bulbasaur', 'Charmander', 'Squirtle', 'Pikachu', 'Eevee']);
  });

  it('puts the most owned first and leaves ties in the natural order', () => {
    // Charmander and Eevee both have two: Charmander comes first because it does in the Pokédex.
    expect(names(sorted('owned'))).toEqual(['Pikachu', 'Charmander', 'Eevee', 'Bulbasaur', 'Squirtle']);
  });

  it('reads names the way a person does: accents and case aside, numbers by value', () => {
    const list = ['Éclair', 'eevee', 'Zubat', 'Porygon2', 'Porygon10', 'Abra'].map((name) => ({ name }));
    expect(
      names(
        sortList(
          list,
          'name',
          (x) => x.name,
          () => 0,
        ),
      ),
    ).toEqual(['Abra', 'Éclair', 'eevee', 'Porygon2', 'Porygon10', 'Zubat']);
  });
});

describe('sortCards', () => {
  const card = (id: string, name: string): CatalogCard => ({ id, name, set: 's', num: id, cat: 'Pokemon' }) as CatalogCard;
  const cards = [card('1', 'Weedle'), card('2', 'Abra'), card('3', 'Mew'), card('4', 'Abra')];
  const collection = new Map<string, CollectionEntry>([
    ['3', { cardId: '3', qty: 4, wanted: 0, addedAt: 0, updatedAt: 0 }],
    ['4', { cardId: '4', qty: 1, wanted: 0, addedAt: 0, updatedAt: 0 }],
  ]);
  const ids = (list: readonly CatalogCard[]) => list.map((c) => c.id);

  it('orders a set by number, by name or by copies owned', () => {
    expect(ids(sortCards(cards, 'natural', collection))).toEqual(['1', '2', '3', '4']);
    // Two Abra keep their collector-number order.
    expect(ids(sortCards(cards, 'name', collection))).toEqual(['2', '4', '3', '1']);
    expect(ids(sortCards(cards, 'owned', collection))).toEqual(['3', '4', '1', '2']);
  });
});

describe('asListSort', () => {
  it('falls back to the natural order for anything it does not know', () => {
    expect(asListSort('name')).toBe('name');
    expect(asListSort('owned')).toBe('owned');
    expect(asListSort('natural')).toBe('natural');
    expect(asListSort('size')).toBe('natural');
    expect(asListSort(undefined)).toBe('natural');
  });
});
