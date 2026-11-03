/**
 * The collection as a binder: the cards of one tab, set by set in number
 * order (the order of the "By set" view), cut into pages of 9 or 12
 * pockets. Pure (named apart from Binder.tsx: Windows resolves the two names the same); Binder.tsx flips through the pages.
 * The grouping itself lives here too, so the Collection page and the deck
 * editor's "From my binder" picker show the same cards in the same order.
 */
import { setRecency, type CatalogIndex } from '@/data/catalog';
import type { CollectionMap } from '@/data/collection';
import type { CatalogCard, CatalogSet } from '@/data/types';

export interface Pocket {
  card: CatalogCard;
  set: CatalogSet;
}

/** Which cards of the collection: the ones in hand, or the wishlist. */
export type BinderTab = 'owned' | 'wanted';

/** The cards of one set that the collection holds, in number order. */
export interface SetGroup {
  set: CatalogSet;
  cards: CatalogCard[];
  /** Copies owned across `cards`. */
  copies: number;
}

/**
 * The collection's cards of one tab, set by set with the newest set first and
 * each set in catalog (number) order: the order of the "By set" view and of
 * the binder. Entries the loaded catalog does not know (another game's cards)
 * are left out.
 */
export function groupBySet(collection: CollectionMap, index: CatalogIndex, tab: BinderTab): SetGroup[] {
  const bySet = new Map<string, SetGroup>();
  for (const e of collection.values()) {
    const include = tab === 'owned' ? e.qty > 0 : !!e.wanted;
    if (!include) continue;
    const card = index.cardsById.get(e.cardId);
    const set = card && index.setsById.get(card.set);
    if (!card || !set) continue;
    let g = bySet.get(set.id);
    if (!g) bySet.set(set.id, (g = { set, cards: [], copies: 0 }));
    g.cards.push(card);
    g.copies += e.qty;
  }
  const list = [...bySet.values()];
  for (const g of list) {
    const order = new Map((index.cardsBySet.get(g.set.id) ?? []).map((c, i) => [c.id, i]));
    g.cards.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }
  list.sort((a, b) => {
    const ra = setRecency(a.set);
    const rb = setRecency(b.set);
    return ra < rb ? 1 : ra > rb ? -1 : a.set.id < b.set.id ? -1 : a.set.id > b.set.id ? 1 : 0;
  });
  return list;
}

/** The groups' cards as one run of binder pockets. */
export function pocketsOf(groups: readonly SetGroup[]): Pocket[] {
  return groups.flatMap((g) => g.cards.map((card) => ({ card, set: g.set })));
}

/** Pockets per page: a 3×3 page like a real binder's, or a 4×3 page. */
export const PAGE_SIZES = [9, 12] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

/** `items` in pages of `perPage`; an empty list is one empty page. */
export function paginate<T>(items: readonly T[], perPage: number): T[][] {
  const n = Math.max(1, Math.floor(perPage));
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += n) pages.push(items.slice(i, i + n));
  return pages.length ? pages : [[]];
}

/** The page that holds item `index` when pages hold `perPage`. */
export function pageOf(index: number, perPage: number): number {
  return Math.floor(Math.max(0, index) / Math.max(1, perPage));
}

/** What a page holds, by set: "Scarlet & Violet", or "Base Set → Jungle" when it spans sets. */
export function pageLabel(pockets: readonly Pocket[]): string {
  const names: string[] = [];
  for (const p of pockets) if (names[names.length - 1] !== p.set.name) names.push(p.set.name);
  if (!names.length) return 'Empty page';
  return names.length === 1 ? names[0] : `${names[0]} → ${names[names.length - 1]}`;
}
