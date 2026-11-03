import { describe, expect, it } from 'vitest';
import { buildIndex } from '@/data/catalog';
import type { CollectionMap } from '@/data/collection';
import { fixtureCatalog } from '@/scanner/fixtures.test-util';
import { groupBySet, pocketsOf } from '@/pages/collection/binder-pages';
import { countCards, filterGroups, setsOf } from './from-binder';

const index = buildIndex(fixtureCatalog, []);
const entry = (cardId: string, qty: number, wanted: 0 | 1 = 0) => ({ cardId, qty, wanted, addedAt: 0, updatedAt: 0 });
const col = (...es: ReturnType<typeof entry>[]): CollectionMap => new Map(es.map((e) => [e.cardId, e]));

const collection = col(
  entry('sv01-125', 1), // Charizard ex
  entry('sv01-025', 2), // Pikachu
  entry('base1-4', 1), // Charizard
  entry('base1-58', 3), // Pikachu
  entry('rv1-025', 1, 1), // Charizard VMAX, owned and wanted
  entry('sv01-063', 0, 1), // Pikachu ex, wishlist only
  entry('ygo:LOB-EN001', 4), // another game's card: ignored
);

describe('groupBySet', () => {
  it('groups owned cards by set, newest set first, each in catalog order', () => {
    const groups = groupBySet(collection, index, 'owned');
    expect(groups.map((g) => g.set.id)).toEqual(['rv1', 'sv01', 'base1']);
    expect(groups.find((g) => g.set.id === 'sv01')!.cards.map((c) => c.id)).toEqual(['sv01-025', 'sv01-125']);
    expect(groups.find((g) => g.set.id === 'base1')!.cards.map((c) => c.id)).toEqual(['base1-4', 'base1-58']);
    expect(groups.map((g) => g.copies)).toEqual([1, 3, 4]);
  });

  it('takes the wishlist for the wanted tab, owned or not', () => {
    const groups = groupBySet(collection, index, 'wanted');
    expect(groups.flatMap((g) => g.cards.map((c) => c.id))).toEqual(['rv1-025', 'sv01-063']);
  });

  it('is empty for an empty collection and flattens into pockets in order', () => {
    expect(groupBySet(new Map(), index, 'owned')).toEqual([]);
    const pockets = pocketsOf(groupBySet(collection, index, 'owned'));
    expect(pockets.map((p) => p.card.id)).toEqual(['rv1-025', 'sv01-025', 'sv01-125', 'base1-4', 'base1-58']);
    expect(pockets.every((p) => p.set.id === p.card.set)).toBe(true);
  });
});

describe('filterGroups', () => {
  const groups = groupBySet(collection, index, 'owned');
  const ids = (gs: ReturnType<typeof filterGroups>) => gs.flatMap((g) => g.cards.map((c) => c.id));

  it('returns everything for an empty query and set', () => {
    expect(filterGroups(groups, '')).toEqual(groups);
    expect(countCards(groups)).toBe(5);
  });

  it('matches names by every typed word, ignoring case and accents', () => {
    expect(ids(filterGroups(groups, 'pika'))).toEqual(['sv01-025', 'base1-58']);
    expect(ids(filterGroups(groups, 'CHAR ex'))).toEqual(['sv01-125']);
    expect(ids(filterGroups(groups, '  charizard '))).toEqual(['rv1-025', 'sv01-125', 'base1-4']);
    expect(filterGroups(groups, 'mewtwo')).toEqual([]);
  });

  it('narrows to one set and drops groups left empty', () => {
    expect(ids(filterGroups(groups, '', 'base1'))).toEqual(['base1-4', 'base1-58']);
    expect(filterGroups(groups, 'charizard', 'base1').map((g) => g.set.id)).toEqual(['base1']);
    expect(filterGroups(groups, 'pika', 'rv1')).toEqual([]);
  });

  it('lists the sets with their card counts', () => {
    expect(setsOf(groups).map((s) => [s.set.id, s.count])).toEqual([['rv1', 1], ['sv01', 2], ['base1', 2]]);
  });
});
