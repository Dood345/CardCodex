import { describe, expect, it } from 'vitest';
import type { CatalogIndex } from './catalog';
import type { CollectionMap } from './collection';
import { nameGroup, nameGroupKey, nameGroups, ownedIn } from './name-groups';
import type { CatalogCard } from './types';

const card = (id: string, name: string, cat: CatalogCard['cat']): CatalogCard => ({ id, set: id.split('-')[0], num: id.split('-')[1], name, cat });

const index = {
  cardsByName: new Map<string, CatalogCard[]>([
    ['professors research', [card('sv01-189', "Professor's Research", 'Trainer'), card('swsh1-178', "Professor's Research", 'Trainer')]],
    ['fire energy', [card('sv01-230', 'Fire Energy', 'Energy'), card('base1-98', 'Fire Energy', 'Energy')]],
    ['boss orders', [card('sv01-172', "Boss's Orders", 'Trainer')]],
    ['pikachu', [card('base1-58', 'Pikachu', 'Pokemon')]],
  ]),
} as unknown as CatalogIndex;

describe('name groups', () => {
  it('groups a category by name, alphabetically, newest printing naming the group', () => {
    const trainers = nameGroups(index, 'Trainer');
    expect(trainers.map((g) => g.name)).toEqual(["Boss's Orders", "Professor's Research"]);
    expect(trainers[1].cards.map((c) => c.id)).toEqual(['sv01-189', 'swsh1-178']);
    expect(nameGroups(index, 'Energy').map((g) => g.key)).toEqual(['fire energy']);
    expect(nameGroups(index, 'Pokemon')).toHaveLength(1);
  });

  it('finds one group by its route key and counts the owned printings', () => {
    expect(nameGroupKey("Professor's Research")).toBe('professors research');
    const g = nameGroup(index, 'fire energy')!;
    expect(g.name).toBe('Fire Energy');
    const owned = new Map([['base1-98', { cardId: 'base1-98', qty: 3, wanted: 0, addedAt: 0, updatedAt: 0 }]]) as unknown as CollectionMap;
    expect(ownedIn(g, owned)).toBe(1);
    expect(ownedIn(g, new Map() as CollectionMap)).toBe(0);
    expect(nameGroup(index, 'nothing')).toBeNull();
  });
});
