/**
 * Which of a frame's cards single-card mode shows.
 *
 * Single-card mode is for one card at a time, but the camera often sees more:
 * a binder page behind the card, the next card in the pile, the card below
 * in a sleeve. Showing a chip per card covers the view and, worse, two chips
 * for two cards of the same name make the reads look like they flip. So:
 *
 *  - the card whose outline sits under the middle of the frame is THE card
 *    (the user aims at what they want); nothing else is shown while one does;
 *  - otherwise the largest card nearest the middle, plus a second one only
 *    when it is nearly as big (two cards held side by side).
 *
 * Pure; the outlines are the matcher's `cardBox` estimates in frame px.
 */
import type { Box, ScanCandidate } from './types';

/** Live single-card mode shows at most this many cards at once. */
export const MAX_LIVE_CARDS = 2;
/** A second card must be at least this share of the first by (area × centrality) to be shown too. */
export const SECOND_CARD_SHARE = 0.45;
/** The frame centre may sit this far outside an outline (fraction of its size) and still count as on the card. */
export const CENTRE_SLACK = 0.04;

/** Whether (x, y) lies in `b` grown by `slack` of its own size on every side. */
export function onCard(b: Box, x: number, y: number, slack = CENTRE_SLACK): boolean {
  const dx = b.w * slack;
  const dy = b.h * slack;
  return x >= b.x - dx && x <= b.x + b.w + dx && y >= b.y - dy && y <= b.y + b.h + dy;
}

/** The candidates to show, best first (see file header). */
export function focusTracks(results: readonly ScanCandidate[], frame: { w: number; h: number }): ScanCandidate[] {
  if (results.length <= 1 || !frame.w || !frame.h) return [...results];
  const cx = frame.w / 2;
  const cy = frame.h / 2;
  const diag = Math.hypot(frame.w, frame.h) / 2;
  const ranked = results
    .map((r) => {
      const b = r.cardBox ?? r.bbox;
      const d = Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy) / diag;
      return { r, score: Math.max(1, b.w * b.h) * (1 - 0.6 * Math.min(1, d)), centred: onCard(b, cx, cy) };
    })
    .sort((a, b) => b.score - a.score);
  // Two outlines can both cover the middle (a tall estimate over a stacked pair): the bigger, better-centred one wins.
  const centred = ranked.find((x) => x.centred);
  if (centred) return [centred.r];
  const top = ranked[0].score;
  return ranked.filter((x, i) => i === 0 || (i < MAX_LIVE_CARDS && x.score >= top * SECOND_CARD_SHARE)).map((x) => x.r);
}
