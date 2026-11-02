/**
 * Artwork evidence for the live single-card loop.
 *
 * The OCR names a card from its text; when the text is weak (a stylised name,
 * a glued stage badge, a number line too small for the preview) the matcher
 * falls back to "some printing of this Pokémon", and two cards of the same
 * name in the frame make the chips swap identities between frames. The
 * picture settles it: the card's outline (the matcher's `cardBox`, estimated
 * from the text lines) is hashed with the pocket alignment search of hash.ts
 * and the nearest table entries are merged into the OCR candidates exactly as
 * in binder-page mode (artwork.ts), so a hit ranks that picture's printings
 * first and a read number among them makes the read confident.
 *
 * Pure apart from the injected sampler: `addLiveArtwork` takes a function
 * that turns a frame region into a luma integral (hash.ts samplePocketLuma
 * over the OCR frame canvas), so it can be tested without a DOM.
 */
import { mergeArtworkEvidence, type CardLookup } from './artwork';
import { matchPocket, windowOf, type HashTable, type LumaImage, type ProbeOptions } from './hash';
import type { Box, ScanCandidate } from './types';

/** Margin around the estimated outline that is sampled, so the alignment search has room (fraction of the outline). */
export const LIVE_PAD = 0.12;
/** Cards hashed per frame, nearest the middle first (the one the user aims at, and at most one more). */
export const LIVE_MAX_CARDS = 2;
/** Outlines narrower than this in the OCR frame (px) are not hashed: too few pixels for the picture. */
export const LIVE_MIN_CARD_PX = 60;
/** Share of the outline that must lie inside the frame: a card cut off at the edge has no complete picture. */
export const LIVE_MIN_INSIDE = 0.9;

const steps = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
};

/**
 * Alignment probes for a text-estimated outline, wider than the pocket ones:
 * a card box inferred from a name line can be off by ~10 % in position and
 * scale (the fitted grid of page mode is within a pocket gap). Coarse: ±8 %
 * in 4 % steps at four scales (100 probes against the whole table); fine:
 * ±10 % in 2 % steps at nine scales over the shortlist.
 */
export const LIVE_COARSE: ProbeOptions = { shifts: steps(-0.08, 0.08, 0.04), scales: [0.84, 0.92, 1, 1.08] };
export const LIVE_FINE: ProbeOptions = { shifts: steps(-0.1, 0.1, 0.02), scales: steps(0.8, 1.12, 0.04) };

/**
 * The frame region to sample for `cardBox`: the outline plus LIVE_PAD on each
 * side, clamped to the frame. Null when the outline is too small or too far
 * off the frame to hold a picture.
 */
export function liveArtworkRegion(cardBox: Box, frame: { w: number; h: number }, pad = LIVE_PAD): Box | null {
  if (cardBox.w < LIVE_MIN_CARD_PX || cardBox.h <= 0) return null;
  const ix = Math.max(0, Math.min(frame.w, cardBox.x + cardBox.w) - Math.max(0, cardBox.x));
  const iy = Math.max(0, Math.min(frame.h, cardBox.y + cardBox.h) - Math.max(0, cardBox.y));
  if ((ix * iy) / (cardBox.w * cardBox.h) < LIVE_MIN_INSIDE) return null;
  const x0 = Math.max(0, cardBox.x - cardBox.w * pad);
  const y0 = Math.max(0, cardBox.y - cardBox.h * pad);
  const x1 = Math.min(frame.w, cardBox.x + cardBox.w * (1 + pad));
  const y1 = Math.min(frame.h, cardBox.y + cardBox.h * (1 + pad));
  if (x1 - x0 < LIVE_MIN_CARD_PX || y1 - y0 <= 0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Merge artwork evidence into up to `max` of a frame's candidates (the ones
 * nearest the middle of the frame). Each keeps its key and geometry; its card,
 * score, evidence, confidence and alternatives come from the merge. The
 * others are returned untouched.
 */
export function addLiveArtwork(
  cands: readonly ScanCandidate[],
  frame: { w: number; h: number },
  table: HashTable,
  lookup: CardLookup,
  sample: (region: Box) => LumaImage,
  max = LIVE_MAX_CARDS,
): ScanCandidate[] {
  const out = [...cands];
  if (!cands.length || !frame.w || !frame.h) return out;
  const cx = frame.w / 2;
  const cy = frame.h / 2;
  const order = cands
    .map((c, i) => ({ i, d: Math.hypot(c.cardBox.x + c.cardBox.w / 2 - cx, c.cardBox.y + c.cardBox.h / 2 - cy) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, max);
  for (const { i } of order) {
    const c = cands[i];
    const region = liveArtworkRegion(c.cardBox, frame);
    if (!region) continue;
    const { hits } = matchPocket(table, sample(region), windowOf(c.cardBox, region), { coarse: LIVE_COARSE, fine: LIVE_FINE, k: 12 });
    const merged = mergeArtworkEvidence([c], hits, lookup, region)[0];
    if (merged) out[i] = { ...merged, key: c.key, bbox: c.bbox, cardBox: c.cardBox };
  }
  return out;
}
