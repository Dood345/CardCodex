/**
 * The pure part of the deck editor's "From my binder" picker
 * (FromBinderSheet.tsx): narrowing the binder's set groups to one set and to
 * the cards whose name has every word typed.
 */
import { normalizeText, tokenize } from '@/data/normalize';
import type { CatalogSet } from '@/data/types';
import type { SetGroup } from '@/pages/collection/binder-pages';

/**
 * `groups` narrowed to the set `setId` (every set when empty) and to the cards
 * whose name contains every word of `query` ("char ex" finds "Charizard ex";
 * case, accents and punctuation do not matter). Groups left without a card
 * are dropped; the order is kept.
 */
export function filterGroups(groups: readonly SetGroup[], query: string, setId = ''): SetGroup[] {
  const words = tokenize(query);
  const out: SetGroup[] = [];
  for (const g of groups) {
    if (setId && g.set.id !== setId) continue;
    if (!words.length) {
      out.push(g);
      continue;
    }
    const cards = g.cards.filter((c) => {
      const name = normalizeText(c.name);
      return words.every((w) => name.includes(w));
    });
    if (cards.length) out.push({ set: g.set, cards, copies: g.copies });
  }
  return out;
}

/** The sets the groups span, in their order, with how many cards each holds. */
export function setsOf(groups: readonly SetGroup[]): { set: CatalogSet; count: number }[] {
  return groups.map((g) => ({ set: g.set, count: g.cards.length }));
}

/** Cards (distinct) across the groups. */
export function countCards(groups: readonly SetGroup[]): number {
  return groups.reduce((n, g) => n + g.cards.length, 0);
}

/** Set chips read well up to this many sets; past it the picker offers a select. */
export const SET_CHIPS_MAX = 6;
