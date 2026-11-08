/**
 * Trainer and Energy cards have no species, so the Pokédex groups them by
 * name instead: every printing of "Professor's Research" is one entry, the
 * way a species gathers its cards (src/pages/DexPage.tsx, NameGroupPage.tsx).
 * Pure, so the pages and the tests share it.
 */
import type { CatalogIndex } from './catalog';
import type { CollectionMap } from './collection';
import { normalizeText } from './normalize';
import type { CardCategory, CatalogCard } from './types';

export interface NameGroup {
  /** The normalized name, also the route segment (`#/dex/name/<key>`). */
  key: string;
  /** The name as printed on the newest card. */
  name: string;
  /** Printings, newest set first. */
  cards: CatalogCard[];
}

/** The route key of a card name. */
export function nameGroupKey(name: string): string {
  return normalizeText(name);
}

/** A category's cards grouped by name, alphabetical. */
export function nameGroups(index: CatalogIndex, cat: CardCategory): NameGroup[] {
  const out: NameGroup[] = [];
  for (const [key, cards] of index.cardsByName) {
    const mine = cards.filter((c) => c.cat === cat);
    if (mine.length) out.push({ key, name: mine[0].name, cards: mine });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** One name's printings, whatever the category, or [] when the name is unknown. */
export function nameGroup(index: CatalogIndex, key: string): NameGroup | null {
  const cards = index.cardsByName.get(key);
  return cards?.length ? { key, name: cards[0].name, cards } : null;
}

/** Distinct printings of a group that the collection holds. */
export function ownedIn(group: NameGroup, collection: CollectionMap): number {
  return group.cards.filter((c) => (collection.get(c.id)?.qty ?? 0) > 0).length;
}
