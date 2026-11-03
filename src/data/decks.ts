/**
 * Decks: named lists of cards and counts, owned or not, one game each.
 * Stored in the `decks` table; the pure parts (deck-list arithmetic, what
 * the collection is short of, size hints) are here too so the pages and
 * the tests share them.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Deck, type DeckCard } from './db';
import { setWanted, type CollectionMap } from './collection';
import { isGameId, type GameId } from '@/games/ids';

const EMPTY: Deck[] = [];

/** Live list of a game's decks, most recently changed first. */
export function useDecks(game: GameId): Deck[] {
  return useLiveQuery(
    () =>
      db.decks
        .where('game')
        .equals(game)
        .toArray()
        .then((list) => list.sort((a, b) => b.updatedAt - a.updatedAt)),
    [game],
    EMPTY,
  );
}

/** Live view of one deck: `loaded` false while the database answers, `deck` undefined when there is no such deck. */
export function useDeck(id: string): { deck: Deck | undefined; loaded: boolean } {
  const result = useLiveQuery(() => db.decks.get(id).then((deck) => ({ deck })), [id]);
  return result ? { deck: result.deck, loaded: true } : { deck: undefined, loaded: false };
}

export function newDeckId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** The list with `cardId` at `qty` copies (0 or less removes it); order kept, a new card goes last. */
export function withQty(cards: readonly DeckCard[], cardId: string, qty: number): DeckCard[] {
  const n = Math.floor(qty);
  const rest = cards.filter((c) => c.cardId !== cardId);
  if (n <= 0) return rest;
  const i = cards.findIndex((c) => c.cardId === cardId);
  if (i < 0) return [...rest, { cardId, qty: n }];
  return cards.map((c) => (c.cardId === cardId ? { cardId, qty: n } : c));
}

/** Copies of `cardId` in the list. */
export function qtyOf(cards: readonly DeckCard[], cardId: string): number {
  return cards.find((c) => c.cardId === cardId)?.qty ?? 0;
}

/** Duplicates merged, empty lines dropped, counts whole and at most 99. */
export function normalizeCards(cards: readonly DeckCard[]): DeckCard[] {
  const out: DeckCard[] = [];
  for (const c of cards) {
    const qty = Math.min(99, Math.floor(c.qty));
    if (!c.cardId || !(qty > 0)) continue;
    const prev = out.find((o) => o.cardId === c.cardId);
    if (prev) prev.qty = Math.min(99, prev.qty + qty);
    else out.push({ cardId: c.cardId, qty });
  }
  return out;
}

export async function createDeck(game: GameId, name: string, cards: readonly DeckCard[] = []): Promise<Deck> {
  const now = Date.now();
  const deck: Deck = { id: newDeckId(), game, name: name.trim() || 'Untitled deck', cards: normalizeCards(cards), createdAt: now, updatedAt: now };
  await db.decks.put(deck);
  return deck;
}

export async function renameDeck(id: string, name: string): Promise<void> {
  await db.decks.update(id, { name: name.trim() || 'Untitled deck', updatedAt: Date.now() });
}

export async function setDeckCardQty(id: string, cardId: string, qty: number): Promise<void> {
  await db.transaction('rw', db.decks, async () => {
    const deck = await db.decks.get(id);
    if (!deck) return;
    await db.decks.put({ ...deck, cards: withQty(deck.cards, cardId, qty), updatedAt: Date.now() });
  });
}

export async function adjustDeckCard(id: string, cardId: string, delta: number): Promise<void> {
  await db.transaction('rw', db.decks, async () => {
    const deck = await db.decks.get(id);
    if (!deck) return;
    await db.decks.put({ ...deck, cards: withQty(deck.cards, cardId, qtyOf(deck.cards, cardId) + delta), updatedAt: Date.now() });
  });
}

export async function deleteDeck(id: string): Promise<void> {
  await db.decks.delete(id);
}

/** A deck line the collection cannot fill: `short` copies missing. */
export interface DeckNeed {
  cardId: string;
  qty: number;
  owned: number;
  short: number;
}

export interface DeckSummary {
  /** Cards in the deck (copies). */
  total: number;
  /** Different cards. */
  distinct: number;
  /** Copies the collection covers. */
  covered: number;
  /** Copies the collection is short of. */
  short: number;
  /** Lines the collection is short of, in deck order. */
  needs: DeckNeed[];
}

export function summarizeDeck(cards: readonly DeckCard[], collection: CollectionMap): DeckSummary {
  let total = 0;
  let covered = 0;
  const needs: DeckNeed[] = [];
  for (const c of cards) {
    const owned = collection.get(c.cardId)?.qty ?? 0;
    total += c.qty;
    covered += Math.min(owned, c.qty);
    if (owned < c.qty) needs.push({ cardId: c.cardId, qty: c.qty, owned, short: c.qty - owned });
  }
  return { total, distinct: cards.length, covered, short: total - covered, needs };
}

/** Puts every card the collection is short of on the wishlist; returns how many were not on it yet. */
export async function wantMissing(cards: readonly DeckCard[], collection: CollectionMap): Promise<number> {
  const fresh = summarizeDeck(cards, collection).needs.filter((n) => !collection.get(n.cardId)?.wanted);
  for (const n of fresh) await setWanted(n.cardId, true);
  return fresh.length;
}

/** What a legal deck holds, as a reminder (nothing is enforced): "60 cards" for Pokémon, "40–60 cards" for a Yu-Gi-Oh! main deck. */
export function sizeHint(game: GameId, total: number): string | null {
  if (game === 'pokemon') {
    if (total === 60) return null;
    return total < 60 ? `A Pokémon deck has 60 cards: ${60 - total} to go.` : `A Pokémon deck has 60 cards: ${total - 60} over.`;
  }
  if (total >= 40 && total <= 60) return null;
  return total < 40 ? `A Yu-Gi-Oh! main deck has 40–60 cards: ${40 - total} to go.` : `A Yu-Gi-Oh! main deck has 40–60 cards: ${total - 60} over.`;
}

/* ---------- export / import: the decks part of the Settings backup (src/data/collection.ts) ---------- */

/** The decks of an export that are well-formed enough to keep; bad lines inside a deck are dropped. */
export function parseExportedDecks(raw: unknown): Deck[] {
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  const out: Deck[] = [];
  for (const d of raw as (Partial<Deck> | null)[]) {
    if (!d || typeof d.id !== 'string' || !d.id || !isGameId(d.game) || !Array.isArray(d.cards)) continue;
    const cards = (d.cards as (Partial<DeckCard> | null)[]).flatMap((c) => (c && typeof c.cardId === 'string' ? [{ cardId: c.cardId, qty: Number(c.qty) }] : []));
    out.push({
      id: d.id,
      game: d.game,
      name: (typeof d.name === 'string' ? d.name.trim().slice(0, 80) : '') || 'Untitled deck',
      cards: normalizeCards(cards),
      createdAt: Number(d.createdAt) || now,
      updatedAt: Number(d.updatedAt) || now,
    });
  }
  return out;
}

/**
 * Puts exported decks back. `replace` wipes the decks first; `merge` keeps
 * the newer copy of a deck both sides have. Resolves with how many were
 * written.
 */
export async function importDecks(raw: unknown, mode: 'merge' | 'replace'): Promise<number> {
  const decks = parseExportedDecks(raw);
  let written = 0;
  await db.transaction('rw', db.decks, async () => {
    if (mode === 'replace') await db.decks.clear();
    for (const deck of decks) {
      const existing = mode === 'merge' ? await db.decks.get(deck.id) : undefined;
      if (existing && existing.updatedAt >= deck.updatedAt) continue;
      await db.decks.put(deck);
      written++;
    }
  });
  return written;
}
