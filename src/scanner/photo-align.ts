/**
 * Keeping a snapped photo on what the user framed. The shutter asks the
 * camera for a full-size photo, which arrives a moment later (a few hundred
 * milliseconds, sometimes seconds), and a hand moves in that time: the photo
 * can show the card shifted, or cut off, although it sat dead centre in the
 * guide when the shutter was pressed.
 *
 * So the preview frame is copied at the press, and when the photo arrives it
 * is compared with that copy: the guide's picture at the press is looked for
 * in the photo, around where the guide should be. Found where expected, the
 * photo is used as it is; found shifted, the guide moves with the card; not
 * found, or found so far off that the card leaves the photo, the copy made
 * at the press is used instead (fewer pixels, but the card the user framed).
 *
 * Pure: the caller samples the two pictures (src/pages/scan/SnapScan.tsx).
 */
import type { Box } from './types';
import { correlation, normalizeCells } from './energy-features';
import { cellMeans, type HashWindow, type LumaImage } from './hash';

/** Cells the guide's picture is compared in: about the card's own proportions. */
export const ALIGN_COLS = 18;
export const ALIGN_ROWS = 25;
/** How far the guide is looked for, as a share of its own size each way. */
export const ALIGN_REACH = 0.3;
export const ALIGN_STEP = 0.02;
/**
 * Correlation above which the photo shows what the guide framed. The same view gives 0.9 and more; the best of
 * a thousand positions over an unrelated picture can still reach 0.5, so the bar sits well above that.
 */
export const ALIGN_MIN = 0.7;
/** A shift under this share of the guide is hand tremor: the photo is used as it is. */
export const ALIGN_STILL = 0.03;
/** Share of the moved guide that must lie inside the photo for the card to be whole. */
export const ALIGN_INSIDE = 0.97;

const WHOLE: HashWindow = { x: 0, y: 0, w: 1, h: 1 };

export interface GuideShift {
  /** Where the guide's picture was found, as shares of the guide's size from where it was expected. */
  dx: number;
  dy: number;
  /** Correlation there, −1..1. */
  score: number;
}

/**
 * Looks for the picture `template` (the guide at the press, the whole image)
 * in `search` (a region of the photo), around `nominal` (where the guide is
 * expected in it, as fractions of `search`). Positions that leave `search`
 * are not tried; a featureless picture correlates with nothing and scores 0.
 */
export function findGuide(template: LumaImage, search: LumaImage, nominal: HashWindow, reach = ALIGN_REACH, step = ALIGN_STEP): GuideShift {
  const t = normalizeCells(cellMeans(template.integral, template.width, template.height, WHOLE, ALIGN_COLS, ALIGN_ROWS));
  let best: GuideShift = { dx: 0, dy: 0, score: -1 };
  const n = Math.round(reach / step);
  for (let iy = -n; iy <= n; iy++) {
    for (let ix = -n; ix <= n; ix++) {
      const dx = ix * step;
      const dy = iy * step;
      const win = { x: nominal.x + dx * nominal.w, y: nominal.y + dy * nominal.h, w: nominal.w, h: nominal.h };
      if (win.x < 0 || win.y < 0 || win.x + win.w > 1 || win.y + win.h > 1) continue;
      const score = correlation(t, normalizeCells(cellMeans(search.integral, search.width, search.height, win, ALIGN_COLS, ALIGN_ROWS)));
      // Ties go to the smaller move: an even picture should not send the guide to a corner.
      if (score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && Math.hypot(dx, dy) < Math.hypot(best.dx, best.dy))) best = { dx, dy, score };
    }
  }
  return best;
}

/** The region of a `frame` to sample for the search: `guide` grown by the reach (and a little) each way, clamped to the frame. */
export function searchRegion(guide: Box, frame: { w: number; h: number }, reach = ALIGN_REACH): Box {
  const pad = reach + 0.02;
  const x0 = Math.max(0, guide.x - guide.w * pad);
  const y0 = Math.max(0, guide.y - guide.h * pad);
  const x1 = Math.min(frame.w, guide.x + guide.w * (1 + pad));
  const y1 = Math.min(frame.h, guide.y + guide.h * (1 + pad));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

export type PhotoVerdict =
  /** The photo shows what was framed: use it, with the guide where it is expected. */
  | { use: 'photo'; guide: Box }
  /** The view moved a little before the photo: use the photo, with the guide moved onto the card. */
  | { use: 'photo-moved'; guide: Box }
  /** The photo does not show the framed card whole: use the copy of the preview made at the press. */
  | { use: 'preview'; why: 'not found' | 'cut off' };

/**
 * What to hand to the reader, given where the guide's picture was found in
 * the photo. `guide` is where the guide is expected in the photo (photo px).
 */
export function judgePhoto(shift: GuideShift, guide: Box, photo: { w: number; h: number }): PhotoVerdict {
  if (shift.score < ALIGN_MIN) return { use: 'preview', why: 'not found' };
  if (Math.hypot(shift.dx, shift.dy) <= ALIGN_STILL) return { use: 'photo', guide };
  const moved: Box = { x: guide.x + shift.dx * guide.w, y: guide.y + shift.dy * guide.h, w: guide.w, h: guide.h };
  const ix = Math.max(0, Math.min(photo.w, moved.x + moved.w) - Math.max(0, moved.x));
  const iy = Math.max(0, Math.min(photo.h, moved.y + moved.h) - Math.max(0, moved.y));
  if ((ix * iy) / (moved.w * moved.h) < ALIGN_INSIDE) return { use: 'preview', why: 'cut off' };
  return { use: 'photo-moved', guide: moved };
}
