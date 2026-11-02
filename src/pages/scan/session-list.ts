/**
 * The list of cards added through the scanner this session, one row per card
 * with how many were added, newest first. Pure; session.ts keeps the list and
 * ScanPage shows it in the pull-up sheet.
 */
import type { CatalogCard, CatalogSet } from '@/data/types';

export interface SessionAdd {
  card: CatalogCard;
  set: CatalogSet;
  /** Copies added this session (an undo subtracts). */
  qty: number;
  /** Last time the card was added. */
  at: number;
}

/** `list` with `qty` more of `card` (negative to take back); a card at zero leaves the list. */
export function addToSession(list: readonly SessionAdd[], card: CatalogCard, set: CatalogSet, qty: number, at: number): SessionAdd[] {
  const rest = list.filter((e) => e.card.id !== card.id);
  const prev = list.find((e) => e.card.id === card.id);
  const total = (prev?.qty ?? 0) + qty;
  if (total <= 0) return rest;
  return [{ card, set, qty: total, at: qty > 0 ? at : (prev?.at ?? at) }, ...rest];
}

/** Copies added in total. */
export function sessionTotal(list: readonly SessionAdd[]): number {
  return list.reduce((n, e) => n + e.qty, 0);
}
