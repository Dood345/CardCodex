/**
 * Sort orders for the browse lists: the Pokédex (species, and the Trainer and
 * Energy names), the archetypes and a set's cards. Each list has a natural
 * order it arrives in (Pokédex number, name, collector number); the other
 * orders are by name and by how much of it you own. Sorts are stable and
 * return a new array; the natural order returns the list itself.
 */
import type { CollectionMap } from './collection';
import type { CatalogCard } from './types';

/** "natural" is the order the list comes in: Pokédex number, A–Z for names, collector number for a set. */
export type ListSort = 'natural' | 'name' | 'owned';

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

/**
 * `items` in the chosen order. `nameOf` names an item and `ownedOf` says how
 * much of it is owned (cards of a species, printings of a name, copies of a
 * card); most owned comes first, ties stay in the natural order.
 */
export function sortList<T>(items: readonly T[], sort: ListSort, nameOf: (item: T) => string, ownedOf: (item: T) => number): readonly T[] {
  if (sort === 'name') return [...items].sort((a, b) => byName(nameOf(a), nameOf(b)));
  if (sort === 'owned') {
    // Decorated so the sort is stable on every engine and ownedOf runs once per item.
    return items
      .map((item, i) => ({ item, i, owned: ownedOf(item) }))
      .sort((a, b) => b.owned - a.owned || a.i - b.i)
      .map((x) => x.item);
  }
  return items;
}

/** A set's cards in the chosen order: collector number as listed, A–Z, or most copies owned first. */
export function sortCards(cards: readonly CatalogCard[], sort: ListSort, collection: CollectionMap): readonly CatalogCard[] {
  return sortList(
    cards,
    sort,
    (c) => c.name,
    (c) => collection.get(c.id)?.qty ?? 0,
  );
}

/** A stored sort that is still one of the choices, else the natural order (a renamed or removed option). */
export function asListSort(value: unknown): ListSort {
  return value === 'name' || value === 'owned' ? value : 'natural';
}
