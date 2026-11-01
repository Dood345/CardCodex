/**
 * Local persistence (IndexedDB via Dexie).
 *
 * The user's collection is the only mutable data in the app. Each entry is
 * keyed by catalog card id. `qty` is always the total owned; `variants`
 * optionally breaks it down (normal / holo / reverse / other).
 */
import Dexie, { type EntityTable } from 'dexie';

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

export const db = new Dexie('cardcodex') as Dexie & {
  collection: EntityTable<CollectionEntry, 'cardId'>;
  scanLog: EntityTable<ScanLogEntry, 'id'>;
};

db.version(1).stores({
  collection: 'cardId, qty, wanted, updatedAt',
  scanLog: '++id, cardId, at',
});
