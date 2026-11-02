/**
 * When binder-page mode may press the shutter by itself, and where to look
 * for the grid on the photo it took. Pure; the capture view (PageScan.tsx)
 * feeds it one live grid fit at a time.
 *
 * Why: the live loop fits the grid three times a second and used to demand a
 * lock (several fits agreeing within 1.5 %) before a capture was read at once.
 * A hand-held phone rarely holds that still, so by the time the guide said
 * "Page found" it had drifted, the lock dropped, and the user was sent to the
 * check-the-grid screen instead. Now a capture is read at once whenever the
 * grid can be found on the PHOTO itself (searchRegion below says where), and
 * the shutter fires on its own once a confident fit has held for a moment
 * with no capture advice pending, so nobody has to tap at the right instant.
 */
import type { FracBox } from './page';
import type { Box } from './types';

/** Consecutive live fits that must agree (within AUTO_TOLERANCE, confidence ≥ AUTO_MIN_CONFIDENCE) before the shutter fires by itself. */
export const AUTO_FITS = 2;
/** How far (fractions of the view) consecutive fits may move and still count as holding. */
export const AUTO_TOLERANCE = 0.03;
/** Grid confidence (grid.ts) a fit needs to count towards an auto-capture. */
export const AUTO_MIN_CONFIDENCE = 0.5;
/** The photo is searched for the grid in the guide's box grown by this share of its size on each side. */
export const PHOTO_SEARCH_PAD = 0.12;

export interface AutoState {
  /** Consecutive qualifying fits so far. */
  fits: number;
  /** The last fit's box (fractions of the view). */
  last: FracBox | null;
}

export const AUTO_IDLE: AutoState = { fits: 0, last: null };

const near = (a: FracBox, b: FracBox, tol: number): boolean =>
  Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol && Math.abs(a.w - b.w) < tol && Math.abs(a.h - b.h) < tol;

/**
 * Next state after one live fit (`null` when the grid was not found). A
 * confident fit near the previous one extends the run; a confident fit
 * elsewhere starts a new run of one; anything else ends it.
 */
export function autoStep(state: AutoState, fit: { confidence: number; frac: FracBox } | null): AutoState {
  if (!fit || fit.confidence < AUTO_MIN_CONFIDENCE) return AUTO_IDLE;
  const fits = state.last && near(fit.frac, state.last, AUTO_TOLERANCE) ? state.fits + 1 : 1;
  return { fits, last: fit.frac };
}

/** Whether the shutter may fire: the run is long enough and no capture advice ("Move closer", …) is pending. */
export function autoReady(state: AutoState, adviceClear: boolean): boolean {
  return adviceClear && state.fits >= AUTO_FITS;
}

/** `box` grown by `pad` of its size on each side, clamped to a `w × h` frame. */
export function searchRegion(box: Box, w: number, h: number, pad = PHOTO_SEARCH_PAD): Box {
  const x0 = Math.max(0, box.x - box.w * pad);
  const y0 = Math.max(0, box.y - box.h * pad);
  const x1 = Math.min(w, box.x + box.w * (1 + pad));
  const y1 = Math.min(h, box.y + box.h * (1 + pad));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}
