/**
 * Decks: named lists of cards and counts, owned or not, one game each.
 * Stored in the `decks` table; the pure parts (deck-list arithmetic, what
 * the collection is short of, sections and reminders from the game's deck
 * rules in src/games/deck-rules.ts) are here too so the pages and the tests
 * share them. A line is keyed by card and zone: the same card may sit once
 * in the deck and once in the side deck (`zone: 'side'`); everything that
 * compares with the collection counts per card over both.
 */
import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSettings } from '@/app/settings';
import { db, type Deck, type DeckCard } from './db';
import { setWanted, type CollectionMap } from './collection';
import type { CatalogIndex } from './catalog';
import { normalizeText } from './normalize';
import type { CatalogCard } from './types';
import { isGameId, type GameId } from '@/games/ids';
import { sectionHint, type DeckRules, type DeckSection, type DeckSectionId } from '@/games/deck-rules';

const EMPTY: Deck[] = [];

/** Where a line sits: undefined for the deck proper, 'side' for the side deck. */
export type DeckZone = DeckCard['zone'];

const isLine = (c: DeckCard, cardId: string, zone: DeckZone) => c.cardId === cardId && c.zone === zone;
const line = (cardId: string, qty: number, zone: DeckZone): DeckCard => (zone ? { cardId, qty, zone } : { cardId, qty });

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

/** The list with `cardId` at `qty` copies in `zone` (0 or less removes the line); order kept, a new line goes last. */
export function withQty(cards: readonly DeckCard[], cardId: string, qty: number, zone?: DeckZone): DeckCard[] {
  const n = Math.floor(qty);
  const rest = cards.filter((c) => !isLine(c, cardId, zone));
  if (n <= 0) return rest;
  const i = cards.findIndex((c) => isLine(c, cardId, zone));
  if (i < 0) return [...rest, line(cardId, n, zone)];
  return cards.map((c) => (isLine(c, cardId, zone) ? line(cardId, n, zone) : c));
}

/** Copies of `cardId` in `zone` (the deck proper by default). */
export function qtyOf(cards: readonly DeckCard[], cardId: string, zone?: DeckZone): number {
  return cards.find((c) => isLine(c, cardId, zone))?.qty ?? 0;
}

/** The list with up to `n` copies of `cardId` moved from one zone to the other. */
export function withMoved(cards: readonly DeckCard[], cardId: string, from: DeckZone, to: DeckZone, n = 1): DeckCard[] {
  const have = qtyOf(cards, cardId, from);
  const k = Math.min(have, Math.floor(n));
  if (k <= 0 || from === to) return [...cards];
  return withQty(withQty(cards, cardId, have - k, from), cardId, qtyOf(cards, cardId, to) + k, to);
}

/** Duplicate lines (same card and zone) merged, empty lines dropped, counts whole and at most 99; only `zone: 'side'` is kept. */
export function normalizeCards(cards: readonly DeckCard[]): DeckCard[] {
  const out: DeckCard[] = [];
  for (const c of cards) {
    const qty = Math.min(99, Math.floor(c.qty));
    if (!c.cardId || !(qty > 0)) continue;
    const zone: DeckZone = c.zone === 'side' ? 'side' : undefined;
    const prev = out.find((o) => isLine(o, c.cardId, zone));
    if (prev) prev.qty = Math.min(99, prev.qty + qty);
    else out.push(line(c.cardId, qty, zone));
  }
  return out;
}

export async function createDeck(game: GameId, name: string, cards: readonly DeckCard[] = [], rules?: string): Promise<Deck> {
  const now = Date.now();
  const deck: Deck = { id: newDeckId(), game, name: name.trim() || 'Untitled deck', cards: normalizeCards(cards), createdAt: now, updatedAt: now };
  if (rules) deck.rules = rules;
  await db.decks.put(deck);
  return deck;
}

export async function renameDeck(id: string, name: string): Promise<void> {
  await db.decks.update(id, { name: name.trim() || 'Untitled deck', updatedAt: Date.now() });
}

/** Sets the rule set a deck follows; undefined goes back to the game's default. */
export async function setDeckRules(id: string, rules: string | undefined): Promise<void> {
  await db.transaction('rw', db.decks, async () => {
    const deck = await db.decks.get(id);
    if (!deck) return;
    const next: Deck = { ...deck, updatedAt: Date.now() };
    if (rules) next.rules = rules;
    else delete next.rules;
    await db.decks.put(next);
  });
}

async function editDeckCards(id: string, edit: (cards: DeckCard[]) => DeckCard[]): Promise<void> {
  await db.transaction('rw', db.decks, async () => {
    const deck = await db.decks.get(id);
    if (!deck) return;
    await db.decks.put({ ...deck, cards: edit(deck.cards), updatedAt: Date.now() });
  });
}

export async function setDeckCardQty(id: string, cardId: string, qty: number, zone?: DeckZone): Promise<void> {
  await editDeckCards(id, (cards) => withQty(cards, cardId, qty, zone));
}

export async function adjustDeckCard(id: string, cardId: string, delta: number, zone?: DeckZone): Promise<void> {
  await editDeckCards(id, (cards) => withQty(cards, cardId, qtyOf(cards, cardId, zone) + delta, zone));
}

/** Moves `n` copies (one by default) of a card between the deck proper and the side deck, in one write. */
export async function moveDeckCard(id: string, cardId: string, from: DeckZone, to: DeckZone, n = 1): Promise<void> {
  await editDeckCards(id, (cards) => withMoved(cards, cardId, from, to, n));
}

export async function deleteDeck(id: string): Promise<void> {
  await db.decks.delete(id);
}

/** Owned copies of one card that other decks have first call on, and those decks' names. */
export interface Claim {
  qty: number;
  decks: string[];
}

/** Claims by card id; a card nobody else uses has no entry. */
export type Claims = ReadonlyMap<string, Claim>;

/**
 * What the decks that come before `deckId` take out of the collection: a
 * real copy sits in one deck at a time, so a deck counts what the older
 * decks left over. Decks come in the order they were made (the oldest keeps
 * its cards); a deck that is not saved yet (`deckId` undefined, or unknown)
 * comes after all of them. A claim never exceeds the copies owned.
 */
export function claimsBefore(decks: readonly Deck[], deckId: string | undefined, collection: CollectionMap): Map<string, Claim> {
  const ordered = [...decks].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  const at = deckId === undefined ? -1 : ordered.findIndex((d) => d.id === deckId);
  const out = new Map<string, Claim>();
  for (const deck of at < 0 ? ordered : ordered.slice(0, at)) {
    for (const [cardId, qty] of perCard(deck.cards)) {
      const owned = collection.get(cardId)?.qty ?? 0;
      if (owned <= 0 || qty <= 0) continue;
      const claim = out.get(cardId) ?? { qty: 0, decks: [] };
      // A deck that found nothing left claims nothing, and is not named.
      const takes = Math.min(qty, owned - claim.qty);
      if (takes <= 0) continue;
      claim.qty += takes;
      claim.decks.push(deck.name);
      out.set(cardId, claim);
    }
  }
  return out;
}

/** "2 in Fire deck", "3 in 2 other decks". */
export function claimText(claim: Claim): string {
  return claim.decks.length === 1 ? `${claim.qty} in ${claim.decks[0]}` : `${claim.qty} in ${claim.decks.length} other decks`;
}

/**
 * The claims on a deck's cards (see `claimsBefore`), live; undefined when
 * the "one deck per copy" setting is off, so every deck counts every copy.
 */
export function useClaims(game: GameId, deckId: string | undefined, collection: CollectionMap): Claims | undefined {
  const decks = useDecks(game);
  const [settings] = useSettings();
  return useMemo(() => (settings.reserveDeckCopies ? claimsBefore(decks, deckId, collection) : undefined), [settings.reserveDeckCopies, decks, deckId, collection]);
}

/** A card the collection cannot fill: `qty` copies over every zone, `short` of them missing. */
export interface DeckNeed {
  cardId: string;
  qty: number;
  /** Copies owned, whichever deck they sit in. */
  owned: number;
  /** Copies other decks have first call on (0 without claims). */
  claimed: number;
  short: number;
}

export interface DeckSummary {
  /** Cards in the deck (copies, every zone). */
  total: number;
  /** Different cards (a card in the deck and the side deck counts once). */
  distinct: number;
  /** Copies the collection covers. */
  covered: number;
  /** Copies the collection is short of. */
  short: number;
  /** Cards the collection is short of, in deck order (one entry per card, over every zone). */
  needs: DeckNeed[];
}

/** Copies of each card over every zone, in first-seen order. */
function perCard(cards: readonly DeckCard[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of cards) out.set(c.cardId, (out.get(c.cardId) ?? 0) + c.qty);
  return out;
}

export function summarizeDeck(cards: readonly DeckCard[], collection: CollectionMap, claims?: Claims): DeckSummary {
  let total = 0;
  let covered = 0;
  const needs: DeckNeed[] = [];
  const counts = perCard(cards);
  for (const [cardId, qty] of counts) {
    const owned = collection.get(cardId)?.qty ?? 0;
    const claimed = Math.min(owned, claims?.get(cardId)?.qty ?? 0);
    const free = owned - claimed;
    total += qty;
    covered += Math.min(free, qty);
    if (free < qty) needs.push({ cardId, qty, owned, claimed, short: qty - free });
  }
  return { total, distinct: counts.size, covered, short: total - covered, needs };
}

/** Puts every card the collection is short of on the wishlist; returns how many were not on it yet. */
export async function wantMissing(cards: readonly DeckCard[], collection: CollectionMap, claims?: Claims): Promise<number> {
  const fresh = summarizeDeck(cards, collection, claims).needs.filter((n) => !collection.get(n.cardId)?.wanted);
  for (const n of fresh) await setWanted(n.cardId, true);
  return fresh.length;
}

/** What a legal section holds, as a reminder (nothing is enforced): "A Pokémon deck has 60 cards: 12 to go.". Null when in range. */
export function sizeHint(rules: DeckRules, total: number, section: DeckSectionId = 'main'): string | null {
  const sec = rules.sections.find((s) => s.id === section);
  return sec ? sectionHint(sec, total) : null;
}

/** One deck line placed in its section, with the owned copies it can use (the deck proper claims owned copies before the side deck). */
export interface PlacedLine extends DeckCard {
  available: number;
}

export interface PlacedSection {
  section: DeckSection;
  /** Lines in deck order, unknown cards included. */
  lines: PlacedLine[];
  /** Copies in the section. */
  total: number;
  /** The size reminder, or null when the count is in range. */
  hint: string | null;
}

/** The deck split into its game's sections, in the rules' order; every section is listed, empty ones too. */
export function deckSections(rules: DeckRules, cards: readonly DeckCard[], index: CatalogIndex, collection: CollectionMap, claims?: Claims): PlacedSection[] {
  const left = new Map<string, number>();
  const placed = new Map<DeckCard, PlacedLine>();
  for (const c of [...cards.filter((c) => c.zone !== 'side'), ...cards.filter((c) => c.zone === 'side')]) {
    const owned = collection.get(c.cardId)?.qty ?? 0;
    const free = left.get(c.cardId) ?? Math.max(0, owned - (claims?.get(c.cardId)?.qty ?? 0));
    const used = Math.min(free, c.qty);
    left.set(c.cardId, free - used);
    placed.set(c, { ...c, available: used });
  }
  return rules.sections.map((section) => {
    const lines = cards.filter((c) => rules.sectionOf(index.cardsById.get(c.cardId), c) === section.id).map((c) => placed.get(c)!);
    const total = lines.reduce((n, l) => n + l.qty, 0);
    return { section, lines, total, hint: sectionHint(section, total) };
  });
}

/** A card the deck holds more copies of than the rules allow. */
export interface OverLimit {
  name: string;
  qty: number;
  limit: number;
  /** The printings counted, in deck order. */
  ids: string[];
}

/**
 * Cards over the copy limit, counted by name over every printing and section
 * (unknown cards are skipped). A printing with no limit is never counted: a
 * name can be two cards (basic "Darkness Energy" and the older Special
 * Energy of the same name), and twelve basic ones must not be held against
 * the four a Special one allows.
 */
export function overLimit(rules: DeckRules, cards: readonly DeckCard[], index: CatalogIndex): OverLimit[] {
  const byName = new Map<string, OverLimit>();
  for (const c of cards) {
    const card = index.cardsById.get(c.cardId);
    if (!card) continue;
    const limit = rules.copyLimit(card);
    if (!Number.isFinite(limit)) continue;
    const prev = byName.get(card.name);
    if (prev) {
      prev.qty += c.qty;
      prev.limit = Math.min(prev.limit, limit);
      if (!prev.ids.includes(card.id)) prev.ids.push(card.id);
    } else byName.set(card.name, { name: card.name, qty: c.qty, limit, ids: [card.id] });
  }
  return [...byName.values()].filter((o) => o.qty > o.limit);
}

/**
 * The printing to use instead when a card over its limit also exists, under
 * the same name, as a card with no limit (basic Darkness Energy for the old
 * Special one): an owned one first, else the newest with a picture, else the
 * newest. Undefined when the name has no such twin.
 */
export function unlimitedTwin(rules: DeckRules, name: string, index: CatalogIndex, collection: CollectionMap): CatalogCard | undefined {
  const twins = (index.cardsByName.get(normalizeText(name)) ?? []).filter((c) => c.name === name && !Number.isFinite(rules.copyLimit(c)));
  return twins.find((c) => (collection.get(c.id)?.qty ?? 0) > 0) ?? twins.find((c) => c.img || c.pc !== undefined || c.sid) ?? twins[0];
}

/** `cards` with every line of the printings `from` turned into a line of `to` in the same zone (merged with one already there). */
export function withPrinting(cards: readonly DeckCard[], from: ReadonlySet<string>, to: string): DeckCard[] {
  return normalizeCards(cards.map((c) => (from.has(c.cardId) ? line(to, c.qty, c.zone) : c)));
}

/** Swaps printings in a deck (see `withPrinting`), in one write. */
export async function replaceDeckPrinting(id: string, from: readonly string[], to: string): Promise<void> {
  const set = new Set(from);
  await editDeckCards(id, (cards) => withPrinting(cards, set, to));
}

/** "3 copies at most: Pot of Greed ×4, Raigeki ×5.", or null when nothing is over. */
export function limitHint(rules: DeckRules, over: readonly OverLimit[]): string | null {
  return over.length ? `${rules.limitHint}: ${over.map((o) => `${o.name} ×${o.qty}`).join(', ')}.` : null;
}

/* ---------- export / import: the decks part of the Settings backup (src/data/collection.ts) ---------- */

/** The decks of an export that are well-formed enough to keep; bad lines inside a deck are dropped, side-deck lines keep their zone. */
export function parseExportedDecks(raw: unknown): Deck[] {
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  const out: Deck[] = [];
  for (const d of raw as (Partial<Deck> | null)[]) {
    if (!d || typeof d.id !== 'string' || !d.id || !isGameId(d.game) || !Array.isArray(d.cards)) continue;
    const cards = (d.cards as (Partial<DeckCard> | null)[]).flatMap((c) =>
      c && typeof c.cardId === 'string' ? [line(c.cardId, Number(c.qty), c.zone === 'side' ? 'side' : undefined)] : [],
    );
    const deck: Deck = {
      id: d.id,
      game: d.game,
      name: (typeof d.name === 'string' ? d.name.trim().slice(0, 80) : '') || 'Untitled deck',
      cards: normalizeCards(cards),
      createdAt: Number(d.createdAt) || now,
      updatedAt: Number(d.updatedAt) || now,
    };
    if (typeof d.rules === 'string' && /^[a-z0-9-]{1,24}$/.test(d.rules)) deck.rules = d.rules;
    out.push(deck);
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
