/**
 * Live capture guidance for binder-page mode: cheap measurements on the
 * preview (or a still) that say, before the shutter, whether the collector
 * number will be readable — card size at the capture resolution, perspective
 * (page not flat under the phone), light and sharpness — and the one piece
 * of advice to show for them.
 *
 * Pure: the capture view samples the page area (grid.ts sampleRgba) and
 * hands the pixels and the grid fit in here.
 */
import { perspectiveCheck, sampleBoxToRegion, sampleRgba, type GridFit, type GridLayoutLike, type GridSource, type RgbaImage } from './grid';
import type { Box } from './types';

export type AdviceKind = 'closer' | 'flatten' | 'light' | 'still';

export interface CaptureAdvice {
  kind: AdviceKind;
  /** Badge / button text: "Move closer". */
  label: string;
  /** One line for the hint under the layout chips: what was measured and what to do. */
  detail: string;
}

export interface GuidanceMetrics {
  /** Fitted card width at the resolution the capture will have, px. */
  cardPx: number;
  /** Card width the number line needs at that resolution (MIN_CARD_PX, or less when the view cannot give that). */
  cardPxWanted: number;
  /** Column pitch ÷ row pitch, relative to the card aspect (1 = agrees). */
  aspectRatio: number;
  /** Card width in the last column ÷ the first column (grid.ts perspectiveCheck); > 1: the right side is nearer the camera. Null when not measured. */
  colWidthRatio: number | null;
  /** Card height in the last row ÷ the first row; > 1: the bottom is nearer. */
  rowHeightRatio: number | null;
  /** Sharpness score of the page area (see sharpness()); null when not measured. */
  sharpness: number | null;
  /** Mean luma of the page area, 0..255; null when not measured. */
  luma: number | null;
}

/**
 * Card width (px) the number line needs in the capture. At 500 px a card's
 * collector number is ~11 px tall; measured: the ~13 px line of a 600 px
 * card is where ML Kit starts reading it and the ~7 px line of a 330 px card
 * is never read.
 */
export const MIN_CARD_PX = 500;
/** Share of the widest card the view can hold that still counts as close enough. */
export const CLOSE_ENOUGH_SHARE = 0.85;
/** Column and row pitches may disagree with the card aspect by this share before the page counts as tilted. */
export const ASPECT_TOLERANCE = 0.08;
/** Card widths across the columns (heights across the rows) may differ by this share before the page counts as tilted. */
export const PITCH_TOLERANCE = 0.05;
/** Mean luma below which the page is too dark for a short, sharp exposure. */
export const MIN_LUMA = 60;
/**
 * Sharpness score below which the number line will not read. Calibrated on
 * scripts/fixtures/binder-pages/ with scripts/guidance-bench.html (see
 * src/scanner/README.md, "Capture guidance"): the three photos score 2.7–3.5
 * at the guidance sample size; Gaussian-blurred at 1 px on ~870 px cards
 * (1/870 of the card width) they score 2.2 and Tesseract still reads the
 * number line and the same ids as unblurred, at 1.5 px (1/580) they score
 * 1.46 and nothing reads; on 577 px cards 1 px of blur (1/577) scores 1.32
 * and loses everything.
 */
export const MIN_SHARPNESS = 1.5;
/** Sample width per card for the sharpness check: the number line is ~7 px tall at this size, like on a 480 px preview card. */
export const SHARPNESS_CARD_PX = 340;
/** Gradient magnitude (luma units) a pixel needs to count as an edge in sharpness(). */
const EDGE_GATE = 8;

/**
 * Card width the number line needs at the capture resolution. Live, the page
 * can at best fill the view, so a card 85% of that is close enough even when
 * it is under MIN_CARD_PX (a preview-only capture cannot do better); a still
 * is what it is.
 */
export function wantedCardPx(viewW: number, cols: number, captureScale: number, live: boolean): number {
  const achievable = (viewW * captureScale) / Math.max(1, cols);
  return live ? Math.min(MIN_CARD_PX, CLOSE_ENOUGH_SHARE * achievable) : MIN_CARD_PX;
}

export interface Sharpness {
  /**
   * Second- over first-derivative energy at the edges: Σ laplacian² / Σ |gradient|²
   * over pixels whose gradient magnitude passes EDGE_GATE. A sharp edge scores
   * ~4, a Gaussian blur of σ px roughly 1/σ²; content-independent for
   * edge-dominated images like a page of cards. 0 when there are no edges.
   */
  score: number;
  /** Mean luma, 0..255. */
  luma: number;
  /** Share of pixels that passed the edge gate (0 = nothing to measure). */
  edgeShare: number;
}

/** Luma of `img` as a float array (BT.601 weights). */
function lumaOf(img: RgbaImage): Float32Array {
  const { width: w, height: h, data } = img;
  const out = new Float32Array(w * h);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return out;
}

/** Sharpness and brightness of `img` (see Sharpness). */
export function sharpness(img: RgbaImage): Sharpness {
  const { width: w, height: h } = img;
  const L = lumaOf(img);
  let sum = 0;
  for (let i = 0; i < L.length; i++) sum += L[i];
  const luma = L.length ? sum / L.length : 0;
  if (w < 3 || h < 3) return { score: 0, luma, edgeShare: 0 };
  let e1 = 0;
  let e2 = 0;
  let edges = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (L[i + 1] - L[i - 1]) / 2;
      const gy = (L[i + w] - L[i - w]) / 2;
      if (Math.abs(gx) + Math.abs(gy) < EDGE_GATE) continue;
      const lap = L[i + 1] + L[i - 1] + L[i + w] + L[i - w] - 4 * L[i];
      e1 += gx * gx + gy * gy;
      e2 += lap * lap;
      edges++;
    }
  }
  return { score: e1 > 0 ? e2 / e1 : 0, luma, edgeShare: edges / ((w - 2) * (h - 2)) };
}

/** Share of the sample's edge pixels under which the sharpness score means nothing (a blank page). */
const MIN_EDGE_SHARE = 0.002;

export interface MeasureOptions {
  /** Card width / height. */
  cardAspect: number;
  /** Capture px per px of `source` (photo over preview; 1 for a still). */
  captureScale: number;
  /** Live preview (true) or a still. */
  live: boolean;
}

/**
 * The guidance measurements for a grid `fit` found on `img`, the sample of
 * `region` of `source` (grid.ts sampleRgba + fitGrid): card width at the
 * capture resolution, pitch agreement with the card aspect, keystone from
 * band fits on the sample, and sharpness and brightness from a finer sample
 * (SHARPNESS_CARD_PX per card, canvas slot 1) of the lower half of the middle
 * row — attack text and the number line, the smallest print on the page.
 */
export function measureGuidance(source: GridSource, img: RgbaImage, fit: GridFit, region: Box, layout: GridLayoutLike, opts: MeasureOptions): GuidanceMetrics {
  const cardPx = fit.cols.size * (region.w / img.width) * opts.captureScale;
  const persp = perspectiveCheck(img, fit, layout);
  const rowPitch = fit.rows.size + fit.rows.gap;
  const band = sampleBoxToRegion(
    { x: fit.box.x, y: fit.rows.start + Math.floor(layout.rows / 2) * rowPitch + fit.rows.size * 0.5, w: fit.box.w, h: fit.rows.size * 0.5 },
    img,
    region,
  );
  const sharp = sharpness(sampleRgba(source, band, layout.cols * SHARPNESS_CARD_PX, 1));
  return {
    cardPx,
    cardPxWanted: wantedCardPx(region.w, layout.cols, opts.captureScale, opts.live),
    aspectRatio: (fit.cols.size + fit.cols.gap) / rowPitch / opts.cardAspect,
    colWidthRatio: persp.colWidthRatio,
    rowHeightRatio: persp.rowHeightRatio,
    sharpness: sharp.edgeShare > MIN_EDGE_SHARE ? sharp.score : null,
    luma: sharp.luma,
  };
}

/** Per cent, rounded, of a ratio's distance from 1. */
const pct = (ratio: number) => Math.round(Math.abs(ratio - 1) * 100);

/**
 * The one thing to tell the user, from the measurements: too far first (the
 * number line cannot read at all), then a tilted page (part of it will be
 * out of focus or too small), then light, then sharpness. Null when the shot
 * should read.
 */
export function adviseCapture(m: GuidanceMetrics, live = true): CaptureAdvice | null {
  if (m.cardPx > 0 && m.cardPx < m.cardPxWanted) {
    const px = Math.round(m.cardPx);
    const want = Math.round(m.cardPxWanted);
    return {
      kind: 'closer',
      label: 'Move closer',
      detail: live
        ? `Cards would be ${px} px wide in the capture; the collector number needs about ${want}. Move closer so the page fills the view.`
        : `Cards are ${px} px wide in this photo; the collector number needs about ${want}. Shoot closer to the page.`,
    };
  }
  if (Math.abs(m.aspectRatio - 1) > ASPECT_TOLERANCE) {
    return {
      kind: 'flatten',
      label: 'Flatten the phone',
      detail: `Columns and rows disagree with the card shape by ${pct(m.aspectRatio)}%: the page is seen at an angle. Hold the phone flat over it.`,
    };
  }
  if (m.rowHeightRatio !== null && Math.abs(m.rowHeightRatio - 1) > PITCH_TOLERANCE) {
    const near = m.rowHeightRatio > 1 ? 'bottom' : 'top';
    return {
      kind: 'flatten',
      label: 'Flatten the phone',
      detail: `The ${near} row's cards look ${pct(m.rowHeightRatio)}% taller than the other's: the ${near} edge is nearer the camera. Hold the phone flat over the page.`,
    };
  }
  if (m.colWidthRatio !== null && Math.abs(m.colWidthRatio - 1) > PITCH_TOLERANCE) {
    const near = m.colWidthRatio > 1 ? 'right' : 'left';
    return {
      kind: 'flatten',
      label: 'Flatten the phone',
      detail: `The ${near} column's cards look ${pct(m.colWidthRatio)}% wider than the other's: the ${near} edge is nearer the camera. Hold the phone flat over the page.`,
    };
  }
  if (m.luma !== null && m.luma < MIN_LUMA) {
    return {
      kind: 'light',
      label: 'More light',
      detail: `The page is dark (brightness ${Math.round(m.luma)} of 255): the camera will blur or grain the number line. Add light.`,
    };
  }
  if (m.sharpness !== null && m.sharpness < MIN_SHARPNESS) {
    return {
      kind: 'still',
      label: 'Hold still',
      detail: live
        ? `The image is soft (sharpness ${m.sharpness.toFixed(1)}, needs ${MIN_SHARPNESS}): hold still and let the camera focus before capturing.`
        : `This photo is soft (sharpness ${m.sharpness.toFixed(1)}, needs ${MIN_SHARPNESS}): the number line is unlikely to read.`,
    };
  }
  return null;
}
