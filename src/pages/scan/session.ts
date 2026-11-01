/**
 * The scanner's working state, kept outside React so that leaving the Scan
 * tab (to check a card, say) and coming back resumes where you were: camera
 * still armed, the photo you were looking at, the binder page under review.
 *
 * The page review is also snapshotted to IndexedDB: Android may kill the app
 * while the phone is locked mid-review, and nine pockets of corrections are
 * worth restoring. Only ids and the small pocket thumbnails are stored; cards
 * are looked up again in the catalog when the snapshot is restored.
 */
import { useSyncExternalStore } from 'react';
import type { CatalogIndex } from '@/data/catalog';
import { db } from '@/data/db';
import type { CatalogCard, CatalogSet } from '@/data/types';
import type { ScanAlternative, ScanCandidate } from '@/scanner';
import type { FracBox, PageSource, PocketScan } from '@/scanner/page';

export interface Recent {
  card: CatalogCard;
  set: CatalogSet;
  qty: number;
  at: number;
}

/** A photo scanned in single-card mode. */
export interface Still {
  url: string;
  w: number;
  h: number;
  results: ScanCandidate[];
  busy: boolean;
  error?: string;
  ms?: number;
  /** Text lines the OCR engine read (to tell "no text" from "no match"). */
  lineCount?: number;
}

export interface PocketState {
  scan: PocketScan;
  /** The confirmed card for the pocket (best guess until corrected). */
  card?: CatalogCard;
  set?: CatalogSet;
  qty: number;
}

/** A still image in page mode: a photo, or the frame just captured from the camera. */
export interface PageStill {
  source: PageSource;
  /** Object URL for display. */
  url: string;
  w: number;
  h: number;
}

export interface PageSession {
  phase: 'capture' | 'review';
  /** Still the guide is shown on; null = live camera. */
  still: PageStill | null;
  /** Guide position as fractions of the visible part of the current source; null = default. */
  frac: FracBox | null;
  /** Grid fitting moves the guide; false once the user dragged it. */
  auto: boolean;
  pockets: PocketState[];
  pageMs: number;
  /** Frame the review came from, kept so the grid can be adjusted and the page rescanned. */
  frame: PageStill | null;
  /** Where the guide sat on `frame` when it was scanned (fractions of the frame). */
  frameFrac: FracBox | null;
}

export interface ScanSession {
  /** Game the session belongs to; a game switch clears it. */
  game: string;
  /** Camera view open (either mode). */
  armed: boolean;
  recent: Recent[];
  still: Still | null;
  page: PageSession | null;
}

export const EMPTY_PAGE: PageSession = {
  phase: 'capture',
  still: null,
  frac: null,
  auto: true,
  pockets: [],
  pageMs: 0,
  frame: null,
  frameFrac: null,
};

let state: ScanSession = { game: '', armed: false, recent: [], still: null, page: null };
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function getScanSession(): ScanSession {
  return state;
}

export function patchScanSession(patch: Partial<ScanSession>): void {
  state = { ...state, ...patch };
  emit();
}

export function patchPageSession(patch: Partial<PageSession>): void {
  state = { ...state, page: { ...(state.page ?? EMPTY_PAGE), ...patch } };
  emit();
}

/** Release a still's object URL and bitmap. */
export function disposeStill(s: PageStill | null | undefined): void {
  if (!s) return;
  URL.revokeObjectURL(s.url);
  const src = s.source as { close?: () => void };
  if (typeof src.close === 'function') src.close();
}

/** Forget everything (game switch). */
export function resetScanSession(game: string): void {
  if (state.still) URL.revokeObjectURL(state.still.url);
  disposeStill(state.page?.still);
  if (state.page?.frame !== state.page?.still) disposeStill(state.page?.frame);
  state = { game, armed: false, recent: [], still: null, page: null };
  emit();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useScanSession(): ScanSession {
  return useSyncExternalStore(subscribe, getScanSession, getScanSession);
}

/* ---------- review snapshot (IndexedDB) ---------- */

const REVIEW_KEY = 'scan.page.review';

interface AltSnapshot {
  id: string;
  score: number;
  evidence: string[];
}

interface PocketSnapshot {
  index: number;
  row: number;
  col: number;
  thumb: string;
  lineCount: number;
  qty: number;
  cardId?: string;
  candidate?: { id: string; score: number; confident: boolean; evidence: string[] };
  alternatives: AltSnapshot[];
}

interface ReviewSnapshot {
  game: string;
  layout: string;
  pageMs: number;
  pockets: PocketSnapshot[];
}

export async function saveReview(game: string, layout: string, pockets: PocketState[], pageMs: number): Promise<void> {
  const snap: ReviewSnapshot = {
    game,
    layout,
    pageMs,
    pockets: pockets.map((p) => ({
      index: p.scan.pocket.index,
      row: p.scan.pocket.row,
      col: p.scan.pocket.col,
      thumb: p.scan.thumb,
      lineCount: p.scan.lineCount,
      qty: p.qty,
      cardId: p.card?.id,
      candidate: p.scan.candidate
        ? {
            id: p.scan.candidate.card.id,
            score: p.scan.candidate.score,
            confident: p.scan.candidate.confident,
            evidence: p.scan.candidate.evidence,
          }
        : undefined,
      alternatives: p.scan.alternatives.slice(0, 8).map((a) => ({ id: a.card.id, score: a.score, evidence: a.evidence })),
    })),
  };
  try {
    await db.kv.put({ key: REVIEW_KEY, value: snap, at: Date.now() });
  } catch {
    /* storage unavailable: the in-memory session still works */
  }
}

/** Whether a review of this game's page is saved (to offer "resume" on the intro screen). */
export async function hasSavedReview(game: string): Promise<boolean> {
  try {
    const row = await db.kv.get(REVIEW_KEY);
    const snap = row?.value as ReviewSnapshot | undefined;
    return !!snap && snap.game === game && Array.isArray(snap.pockets) && snap.pockets.length > 0;
  } catch {
    return false;
  }
}

export async function clearReview(): Promise<void> {
  try {
    await db.kv.delete(REVIEW_KEY);
  } catch {
    /* ignore */
  }
}

const ZERO_BOX = { x: 0, y: 0, w: 0, h: 0 };

/** Rebuild a saved review against the loaded catalog; null when there is none (or it is another game's). */
export async function loadReview(
  index: CatalogIndex,
  game: string,
): Promise<{ layout: string; pockets: PocketState[]; pageMs: number } | null> {
  let row: { value: unknown } | undefined;
  try {
    row = await db.kv.get(REVIEW_KEY);
  } catch {
    return null;
  }
  const snap = row?.value as ReviewSnapshot | undefined;
  if (!snap || snap.game !== game || !Array.isArray(snap.pockets)) return null;
  const lookup = (id: string | undefined): { card: CatalogCard; set: CatalogSet } | null => {
    if (!id) return null;
    const card = index.cardsById.get(id);
    const set = card && index.setsById.get(card.set);
    return card && set ? { card, set } : null;
  };
  const pockets: PocketState[] = snap.pockets.map((p) => {
    const alternatives: ScanAlternative[] = p.alternatives.flatMap((a) => {
      const hit = lookup(a.id);
      return hit ? [{ ...hit, score: a.score, evidence: a.evidence }] : [];
    });
    const best = lookup(p.candidate?.id);
    const candidate: ScanCandidate | undefined =
      best && p.candidate
        ? {
            key: `p${p.index}`,
            ...best,
            score: p.candidate.score,
            margin: 0,
            confident: p.candidate.confident,
            evidence: p.candidate.evidence,
            bbox: ZERO_BOX,
            cardBox: ZERO_BOX,
            alternatives,
          }
        : undefined;
    const chosen = lookup(p.cardId);
    return {
      scan: {
        pocket: { index: p.index, row: p.row, col: p.col, box: ZERO_BOX },
        candidate,
        alternatives,
        lineCount: p.lineCount,
        thumb: p.thumb,
        ms: 0,
      },
      card: chosen?.card,
      set: chosen?.set,
      qty: p.qty,
    };
  });
  return { layout: snap.layout, pockets, pageMs: snap.pageMs };
}
