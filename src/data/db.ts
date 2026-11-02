/**
 * Local persistence (IndexedDB via Dexie).
 *
 * The user's collection is the only mutable data in the app. Each entry is
 * keyed by catalog card id (global across games, see src/games/ids.ts).
 * `qty` is always the total owned; `variants` optionally breaks it down
 * (normal / holo / reverse / other). `images` holds card images that must be
 * fetched once and kept on the device (src/data/imageCache.ts).
 */
import Dexie, { type EntityTable } from 'dexie';
import type { GameId } from '@/games/ids';

export type VariantKey = 'normal' | 'holo' | 'reverse' | 'other';
export const VARIANT_KEYS: VariantKey[] = ['normal', 'holo', 'reverse', 'other'];
export const VARIANT_LABELS: Record<VariantKey, string> = {
  normal: 'Normal',
  holo: 'Holo',
  reverse: 'Reverse holo',
  other: 'Other',
};

export interface CollectionEntry {
  cardId: string;
  /** Total copies owned (sum of variants when variants are tracked). */
  qty: number;
  variants?: Partial<Record<VariantKey, number>>;
  /** 1 when on the wishlist (Dexie indexes numbers, not booleans). */
  wanted: 0 | 1;
  note?: string;
  addedAt: number;
  updatedAt: number;
}

export interface ScanLogEntry {
  id?: number;
  cardId: string;
  at: number;
  /** Which engine recognized it ("mlkit" | "tesseract" | "manual"). */
  engine: string;
}

export interface CachedImage {
  url: string;
  blob: Blob;
  size: number;
  /** Last use, ms since epoch (for eviction). */
  at: number;
}

/** Small app state that must survive the app being killed (an unfinished binder-page review). */
export interface KvEntry {
  key: string;
  value: unknown;
  at: number;
}

/** One line of a deck list. */
export interface DeckCard {
  cardId: string;
  qty: number;
}

/**
 * A deck: a named list of cards and counts, owned or not, for one game.
 * Built in the app or imported from a friend's share text (src/data/deck-code.ts).
 */
export interface Deck {
  id: string;
  game: GameId;
  name: string;
  cards: DeckCard[];
  createdAt: number;
  updatedAt: number;
}

export const db = new Dexie('cardcodex') as Dexie & {
  collection: EntityTable<CollectionEntry, 'cardId'>;
  scanLog: EntityTable<ScanLogEntry, 'id'>;
  images: EntityTable<CachedImage, 'url'>;
  kv: EntityTable<KvEntry, 'key'>;
  decks: EntityTable<Deck, 'id'>;
};

db.version(1).stores({
  collection: 'cardId, qty, wanted, updatedAt',
  scanLog: '++id, cardId, at',
});
db.version(2).stores({
  collection: 'cardId, qty, wanted, updatedAt',
  scanLog: '++id, cardId, at',
  images: 'url, at',
});
db.version(3).stores({
  collection: 'cardId, qty, wanted, updatedAt',
  scanLog: '++id, cardId, at',
  images: 'url, at',
  kv: 'key',
});
db.version(4).stores({
  collection: 'cardId, qty, wanted, updatedAt',
  scanLog: '++id, cardId, at',
  images: 'url, at',
  kv: 'key',
  decks: 'id, game, updatedAt',
});
