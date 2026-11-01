/**
 * Collection mutations and React hooks.
 *
 * All writes go through here so the invariants hold:
 *  - `qty` is the total; when `variants` exist, qty === sum(variants).
 *  - An entry with qty 0, not wanted, and no note is deleted.
 */
import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type CollectionEntry, type VariantKey, VARIANT_KEYS } from './db';
import type { CatalogIndex } from './catalog';
import type { CatalogCard } from './types';
import { gameOfId, type GameId } from '@/games/ids';

export type CollectionMap = Map<string, CollectionEntry>;

const EMPTY: CollectionEntry[] = [];

/** Live map of cardId → entry. Re-renders on any collection change. */
export function useCollection(): CollectionMap {
  const rows = useLiveQuery(() => db.collection.toArray(), [], EMPTY);
  return useMemo(() => new Map(rows.map((r) => [r.cardId, r])), [rows]);
}

/** Live entry for one card (undefined when not in the collection). */
export function useEntry(cardId: string): CollectionEntry | undefined {
  return useLiveQuery(() => db.collection.get(cardId), [cardId]);
}

function sumVariants(v: Partial<Record<VariantKey, number>> | undefined): number {
  if (!v) return 0;
  let n = 0;
  for (const k of VARIANT_KEYS) n += v[k] ?? 0;
  return n;
}

function isEmptyEntry(e: CollectionEntry): boolean {
  return e.qty <= 0 && !e.wanted && !e.note;
}

async function upsert(cardId: string, mutate: (e: CollectionEntry) => void): Promise<CollectionEntry | undefined> {
  return db.transaction('rw', db.collection, async () => {
    const now = Date.now();
    const existing = await db.collection.get(cardId);
    const entry: CollectionEntry = existing ?? { cardId, qty: 0, wanted: 0, addedAt: now, updatedAt: now };
    mutate(entry);
    if (entry.variants) {
      for (const k of VARIANT_KEYS) {
        if (!entry.variants[k] || entry.variants[k]! <= 0) delete entry.variants[k];
      }
      if (Object.keys(entry.variants).length === 0) delete entry.variants;
      else entry.qty = sumVariants(entry.variants);
    }
    if (entry.qty < 0) entry.qty = 0;
    entry.updatedAt = now;
    if (isEmptyEntry(entry)) {
      if (existing) await db.collection.delete(cardId);
      return undefined;
    }
    await db.collection.put(entry);
    return entry;
  });
}

/** Adds `delta` copies (negative to remove). With a variant, adjusts that variant. */
export function adjustQty(cardId: string, delta: number, variant?: VariantKey): Promise<CollectionEntry | undefined> {
  return upsert(cardId, (e) => {
    if (variant) {
      const v = { ...(e.variants ?? {}) };
      if (!e.variants && e.qty > 0 && variant !== 'normal') {
        // First time breaking down an untracked total: keep the old copies as "normal".
        v.normal = e.qty;
      } else if (!e.variants && e.qty > 0) {
        v.normal = e.qty;
      }
      v[variant] = Math.max(0, (v[variant] ?? 0) + delta);
      e.variants = v;
    } else if (e.variants) {
      // Untyped adjustment with variants tracked: apply to "normal".
      e.variants.normal = Math.max(0, (e.variants.normal ?? 0) + delta);
    } else {
      e.qty = Math.max(0, e.qty + delta);
    }
  });
}

/** Sets the total directly (drops any variant breakdown). */
export function setQty(cardId: string, qty: number): Promise<CollectionEntry | undefined> {
  return upsert(cardId, (e) => {
    delete e.variants;
    e.qty = Math.max(0, Math.floor(qty));
  });
}

export function toggleWanted(cardId: string): Promise<CollectionEntry | undefined> {
  return upsert(cardId, (e) => {
    e.wanted = e.wanted ? 0 : 1;
  });
}

export function setNote(cardId: string, note: string): Promise<CollectionEntry | undefined> {
  return upsert(cardId, (e) => {
    const trimmed = note.trim();
    if (trimmed) e.note = trimmed;
    else delete e.note;
  });
}

/** Remove every entry of one game (or of all games when `game` is omitted). */
export async function clearCollection(game?: GameId): Promise<void> {
  if (!game) {
    await db.collection.clear();
    return;
  }
  await db.collection.filter((e) => gameOfId(e.cardId) === game).delete();
}

/* ---------- export / import ---------- */

export interface CollectionExport {
  app: 'cardcodex';
  version: 1;
  exportedAt: string;
  entries: CollectionEntry[];
}

export async function exportCollection(): Promise<CollectionExport> {
  const entries = await db.collection.toArray();
  return { app: 'cardcodex', version: 1, exportedAt: new Date().toISOString(), entries };
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

/**
 * Imports a previous export. `merge` keeps existing entries and adds the
 * imported quantities; `replace` wipes the collection first. Entries of the
 * active game's catalog are validated against `index`; entries of another
 * game (whose catalog is not loaded) are imported as they are.
 */
export async function importCollection(
  data: unknown,
  mode: 'merge' | 'replace',
  index?: CatalogIndex,
): Promise<ImportResult> {
  const parsed = data as Partial<CollectionExport>;
  if (!parsed || parsed.app !== 'cardcodex' || !Array.isArray(parsed.entries)) {
    throw new Error('Not a CardCodex export file');
  }
  let imported = 0;
  let skipped = 0;
  await db.transaction('rw', db.collection, async () => {
    if (mode === 'replace') await db.collection.clear();
    for (const raw of parsed.entries as Partial<CollectionEntry>[]) {
      if (!raw || typeof raw.cardId !== 'string') {
        skipped++;
        continue;
      }
      if (index && gameOfId(raw.cardId) === index.game && !index.cardsById.has(raw.cardId)) {
        skipped++;
        continue;
      }
      const now = Date.now();
      const incoming: CollectionEntry = {
        cardId: raw.cardId,
        qty: Math.max(0, Math.floor(Number(raw.qty) || 0)),
        variants: raw.variants,
        wanted: raw.wanted ? 1 : 0,
        note: raw.note,
        addedAt: Number(raw.addedAt) || now,
        updatedAt: Number(raw.updatedAt) || now,
      };
      if (incoming.variants) incoming.qty = sumVariants(incoming.variants);
      const existing = mode === 'merge' ? await db.collection.get(incoming.cardId) : undefined;
      if (existing) {
        existing.qty += incoming.qty;
        if (existing.variants || incoming.variants) {
          const merged: Partial<Record<VariantKey, number>> = { ...(existing.variants ?? {}) };
          if (!existing.variants && existing.qty - incoming.qty > 0) merged.normal = existing.qty - incoming.qty;
          for (const k of VARIANT_KEYS) {
            const add = incoming.variants?.[k] ?? (k === 'normal' && !incoming.variants ? incoming.qty : 0);
            if (add) merged[k] = (merged[k] ?? 0) + add;
          }
          existing.variants = merged;
          existing.qty = sumVariants(merged);
        }
        existing.wanted = existing.wanted || incoming.wanted ? 1 : 0;
        existing.note = existing.note ?? incoming.note;
        existing.updatedAt = now;
        if (!isEmptyEntry(existing)) await db.collection.put(existing);
      } else if (!isEmptyEntry(incoming)) {
        await db.collection.put(incoming);
      }
      imported++;
    }
  });
  return { imported, skipped };
}

/* ---------- derived stats ---------- */

export interface CollectionStats {
  totalCopies: number;
  uniqueCards: number;
  wanted: number;
  /** Distinct groups (Pokémon species / Yu-Gi-Oh! archetypes) with at least one owned card. */
  groupsOwned: number;
  /** Sets with at least one owned card. */
  setsTouched: number;
}

/** Grouping keys of a card for the stats tile: species dex ids or the archetype. */
export function groupsOf(card: Pick<CatalogCard, 'dex' | 'arc'>): string[] {
  if (card.dex) return card.dex.map(String);
  return card.arc ? [card.arc] : [];
}

/** Stats over the entries that belong to the loaded catalog (other games' entries are ignored). */
export function computeStats(collection: CollectionMap, index: CatalogIndex): CollectionStats {
  let totalCopies = 0;
  let uniqueCards = 0;
  let wanted = 0;
  const groups = new Set<string>();
  const sets = new Set<string>();
  for (const e of collection.values()) {
    const card = index.cardsById.get(e.cardId);
    if (!card) continue;
    if (e.wanted) wanted++;
    if (e.qty > 0) {
      totalCopies += e.qty;
      uniqueCards++;
      sets.add(card.set);
      for (const g of groupsOf(card)) groups.add(g);
    }
  }
  return { totalCopies, uniqueCards, wanted, groupsOwned: groups.size, setsTouched: sets.size };
}

/** Owned-distinct / total for a list of cards. */
export function progressOf(cards: readonly { id: string }[], collection: CollectionMap): { owned: number; total: number } {
  let owned = 0;
  for (const c of cards) {
    const e = collection.get(c.id);
    if (e && e.qty > 0) owned++;
  }
  return { owned, total: cards.length };
}
