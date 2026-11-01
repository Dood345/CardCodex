/**
 * Binder-page scanning: one photo of a whole binder page (3×3, 2×2, 3×4 or
 * 4×4 pockets), split into pocket crops that are each OCR'd on their own.
 *
 * Why per-pocket: in a full-page frame every card is only ~1/3 of the frame
 * wide, and the single-frame matcher never reads the small collector-number
 * line at that size (measured 0/11 at ~245 px card width). Cropping each
 * pocket and upscaling it to ≥ MIN_CROP_WIDTH gives the recognizer the same
 * pixels-per-glyph as a single-card scan.
 */
import type { CatalogCard, CatalogSet } from '../data/types';
import type { TextRecognizer } from './recognizer';
import { scanLines, type ScanIndex } from './match';
import type { Box, ScanAlternative, ScanCandidate } from './types';

/** Standard card size, mm; pocket cells keep this aspect. */
const CARD_W = 63;
const CARD_H = 88;

export type PageLayoutId = '3x3' | '2x2' | '3x4' | '4x4';

export interface PageLayout {
  id: PageLayoutId;
  label: string;
  cols: number;
  rows: number;
}

export const PAGE_LAYOUTS: readonly PageLayout[] = [
  { id: '3x3', label: '9-pocket (3×3)', cols: 3, rows: 3 },
  { id: '2x2', label: '4-pocket (2×2)', cols: 2, rows: 2 },
  { id: '3x4', label: '12-pocket (3×4)', cols: 3, rows: 4 },
  { id: '4x4', label: '16-pocket (4×4)', cols: 4, rows: 4 },
];

export function pageLayout(id: string): PageLayout {
  return PAGE_LAYOUTS.find((l) => l.id === id) ?? PAGE_LAYOUTS[0];
}

/** One pocket of the page: row-major index and its box in frame pixels. */
export interface Pocket {
  index: number;
  row: number;
  col: number;
  box: Box;
}

export interface PageGeometryOptions {
  /** Empty border kept around the page, as a fraction of the frame's shorter side. Default 0.03. */
  margin?: number;
  /**
   * Fraction of each cell trimmed on every side. Default 0: pockets are spaced
   * on a page, and trimming risks cutting off the collector number printed
   * ~3% from the card's edge (measured: a 4% trim lost it on a tight page).
   */
  inset?: number;
}

/**
 * The largest rectangle with the page's aspect (cols × 63 : rows × 88) that
 * fits inside the frame minus the margin, centred. The on-screen guide draws
 * this rectangle; the user lines the binder page up with it.
 */
export function pageRect(frameW: number, frameH: number, layout: PageLayout, opts: PageGeometryOptions = {}): Box {
  const margin = (opts.margin ?? 0.03) * Math.min(frameW, frameH);
  const availW = Math.max(1, frameW - 2 * margin);
  const availH = Math.max(1, frameH - 2 * margin);
  const aspect = (layout.cols * CARD_W) / (layout.rows * CARD_H);
  let w = availW;
  let h = w / aspect;
  if (h > availH) {
    h = availH;
    w = h * aspect;
  }
  return { x: (frameW - w) / 2, y: (frameH - h) / 2, w, h };
}

/** Equal pocket cells over `pageRect`, each shrunk by `inset` on every side. Row-major. */
export function pocketBoxes(frameW: number, frameH: number, layout: PageLayout, opts: PageGeometryOptions = {}): Pocket[] {
  const page = pageRect(frameW, frameH, layout, opts);
  const inset = opts.inset ?? 0;
  const cellW = page.w / layout.cols;
  const cellH = page.h / layout.rows;
  const pockets: Pocket[] = [];
  for (let row = 0; row < layout.rows; row++) {
    for (let col = 0; col < layout.cols; col++) {
      pockets.push({
        index: row * layout.cols + col,
        row,
        col,
        box: {
          x: page.x + col * cellW + cellW * inset,
          y: page.y + row * cellH + cellH * inset,
          w: cellW * (1 - 2 * inset),
          h: cellH * (1 - 2 * inset),
        },
      });
    }
  }
  return pockets;
}

/** Result for one pocket. `candidate` is undefined when nothing matched. */
export interface PocketScan {
  pocket: Pocket;
  candidate?: ScanCandidate;
  /** Other plausible cards for the pocket (from the best candidate). */
  alternatives: ScanAlternative[];
  /** Text lines the engine read in the crop; 0 usually means an empty pocket. */
  lineCount: number;
  /** JPEG data URL of the crop, for the review grid. */
  thumb: string;
  /** Recognition time for this pocket, ms. */
  ms: number;
}

/** Anything drawImage accepts that also reports its pixel size (ImageBitmap, canvas, video). */
export type PageSource = CanvasImageSource & { width: number; height: number };

export interface ScanPageOptions {
  /**
   * Crops narrower than this are upscaled to it before OCR. Default 1000:
   * the collector number on a ~600 px wide card is ~9 px tall, below what
   * Tesseract's LSTM reads reliably; ~1.7× upscaling brings it to ~15 px.
   */
  minCropWidth?: number;
  /** Thumbnail width in the review grid. Default 240. */
  thumbWidth?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  geometry?: PageGeometryOptions;
}

const MIN_CROP_WIDTH = 1000;
const THUMB_WIDTH = 240;

/**
 * Crop `box` from `source` into a new canvas, upscaled so its width is at least
 * `minWidth`. Crop straight from the full-resolution source (an ImageBitmap of
 * the photo): every intermediate resample blurs the tiny number line.
 */
export function cropPocket(source: PageSource, box: Box, minWidth: number): HTMLCanvasElement {
  const scale = Math.max(1, minWidth / box.w);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(box.w * scale));
  out.height = Math.max(1, Math.round(box.h * scale));
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height);
  return out;
}

function thumbnail(crop: HTMLCanvasElement, width: number): string {
  const t = document.createElement('canvas');
  const scale = Math.min(1, width / crop.width);
  t.width = Math.max(1, Math.round(crop.width * scale));
  t.height = Math.max(1, Math.round(crop.height * scale));
  t.getContext('2d')!.drawImage(crop, 0, 0, t.width, t.height);
  return t.toDataURL('image/jpeg', 0.75);
}

/**
 * OCR every pocket of a page frame, one at a time (engines are not safe to
 * run concurrently), and match each against the catalog.
 */
export async function scanPage(
  frame: PageSource,
  layout: PageLayout,
  recognizer: TextRecognizer,
  index: ScanIndex,
  opts: ScanPageOptions = {},
): Promise<PocketScan[]> {
  const pockets = pocketBoxes(frame.width, frame.height, layout, opts.geometry);
  const results: PocketScan[] = [];
  const minWidth = opts.minCropWidth ?? MIN_CROP_WIDTH;
  for (const pocket of pockets) {
    if (opts.signal?.aborted) break;
    const crop = cropPocket(frame, pocket.box, minWidth);
    const started = performance.now();
    let lines: Awaited<ReturnType<TextRecognizer['recognize']>> = [];
    try {
      lines = await recognizer.recognize(crop);
    } catch (e) {
      console.warn('[scanner] pocket', pocket.index, 'recognition failed:', e);
    }
    const candidates = scanLines(lines, index);
    // A pocket holds one card: keep the strongest candidate, demote the rest
    // to alternatives so the user can correct a wrong pick in place.
    const best = candidates[0];
    const alternatives: ScanAlternative[] = best
      ? [
          ...best.alternatives,
          ...candidates.slice(1).map((c) => ({ card: c.card, set: c.set, score: c.score, evidence: c.evidence })),
        ].filter((a, i, arr) => a.card.id !== best.card.id && arr.findIndex((b) => b.card.id === a.card.id) === i)
      : [];
    results.push({
      pocket,
      candidate: best,
      alternatives,
      lineCount: lines.length,
      thumb: thumbnail(crop, opts.thumbWidth ?? THUMB_WIDTH),
      ms: performance.now() - started,
    });
    opts.onProgress?.(results.length, pockets.length);
  }
  return results;
}

/** What the review grid needs per pocket once the user has confirmed it. */
export interface PocketEntry {
  card: CatalogCard;
  set: CatalogSet;
  qty: number;
}
