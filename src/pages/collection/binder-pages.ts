/**
 * The collection as a binder: the cards of one tab, set by set in number
 * order (the order of the "By set" view), cut into pages of 9 or 12
 * pockets. Pure (named apart from Binder.tsx: Windows resolves the two names the same); Binder.tsx flips through the pages.
 */
import type { CatalogCard, CatalogSet } from '@/data/types';

export interface Pocket {
  card: CatalogCard;
  set: CatalogSet;
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
