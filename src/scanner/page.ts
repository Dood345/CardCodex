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
import { refineCardBox } from './grid';
import type { TextRecognizer } from './recognizer';
import type { Box, RecognizedLine, ScanAlternative, ScanCandidate, ScanMatcher } from './types';

/** Standard (Pokémon) card size, mm; pocket cells keep the card's aspect. */
export const DEFAULT_CARD_MM = { w: 63, h: 88 } as const;

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
  /** Physical card size in mm (sets the cell aspect). Default 63×88 (Pokémon); Yu-Gi-Oh! is 59×86. */
  cardMm?: { w: number; h: number };
  /**
   * Part of the frame the default page rectangle is centred in (frame px).
   * The capture view shows the camera frame with `object-fit: cover`, so on a
   * wide screen the top and bottom of the frame are off-screen; passing the
   * visible region keeps the whole guide on-screen. Default: the whole frame.
   */
  within?: Box;
  /**
   * An explicit page rectangle (frame px) from the grid fitter or the user's
   * drag; when set, `margin`, `cardMm` and `within` are ignored.
   */
  page?: Box;
}

/**
 * The page rectangle: `opts.page` when given, otherwise the largest rectangle
 * with the page's aspect (cols × 63 : rows × 88) that fits inside `within`
 * (default: the frame) minus the margin, centred. The on-screen guide draws
 * this rectangle; the user lines the binder page up with it.
 */
export function pageRect(frameW: number, frameH: number, layout: PageLayout, opts: PageGeometryOptions = {}): Box {
  if (opts.page) return opts.page;
  const area = opts.within ?? { x: 0, y: 0, w: frameW, h: frameH };
  const margin = (opts.margin ?? 0.03) * Math.min(area.w, area.h);
  const availW = Math.max(1, area.w - 2 * margin);
  const availH = Math.max(1, area.h - 2 * margin);
  const card = opts.cardMm ?? DEFAULT_CARD_MM;
  const aspect = (layout.cols * card.w) / (layout.rows * card.h);
  let w = availW;
  let h = w / aspect;
  if (h > availH) {
    h = availH;
    w = h * aspect;
  }
  return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
}

/** A box as fractions (0..1) of some region: how the page guide is remembered across frames and sessions. */
export interface FracBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function boxToFrac(box: Box, region: Box): FracBox {
  return {
    x: (box.x - region.x) / region.w,
    y: (box.y - region.y) / region.h,
    w: box.w / region.w,
    h: box.h / region.h,
  };
}

export function fracToBox(frac: FracBox, region: Box): Box {
  return {
    x: region.x + frac.x * region.w,
    y: region.y + frac.y * region.h,
    w: frac.w * region.w,
    h: frac.h * region.h,
  };
}

/** Equal pocket cells over `pageRect`, each shrunk by `inset` on every side. Row-major. */
export function pocketBoxes(frameW: number, frameH: number, layout: PageLayout, opts: PageGeometryOptions = {}): Pocket[] {
  return pocketBoxesIn(pageRect(frameW, frameH, layout, opts), layout, opts.inset ?? 0);
}

/** Equal pocket cells over an explicit page rectangle. Row-major. */
export function pocketBoxesIn(page: Box, layout: PageLayout, inset = 0): Pocket[] {
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
  /** The rectangle that was actually read (frame px): the cell plus margin, tightened to the card when its edges were found. */
  cardBox: Box;
  /** Frames the pocket was read from. */
  frames: number;
}

/** Anything drawImage accepts that also reports its pixel size (ImageBitmap, canvas, video). */
export type PageSource = CanvasImageSource & { width: number; height: number };

export interface ScanPageOptions {
  /**
   * Margin added around each pocket cell before reading it, as a fraction of
   * the cell. Default 0.06: a grid that is a little off (the fitter's sample
   * is 320 px wide, a hand-dragged frame is approximate) must not cut the
   * collector number, which sits ~3% from the card's bottom-left corner.
   */
  pad?: number;
  /**
   * Tighten each padded crop to the card's own edges before reading it
   * (grid.ts refineCardBox), falling back to the padded cell when the edges
   * are not clear. Default false: on the fixture photos it lost two pockets
   * (crops that no longer held the name line) and gained none; the padding
   * alone is what recovered the number line.
   */
  refine?: boolean;
  /**
   * When the full read leaves the printing unsettled, read the bottom strip
   * of the card again at higher magnification and add those lines. Default
   * true: the number line is the smallest text on the card and the one that
   * pins down the printing.
   */
  numberStrip?: boolean;
  /**
   * More frames of the same page captured moments apart (same geometry).
   * Every pocket is read from each frame and the candidates are merged, so
   * one blurred or glared frame cannot decide a pocket alone.
   */
  extraFrames?: PageSource[];
  /**
   * Crops narrower than this are upscaled to it before OCR. Default 1000:
   * the collector number on a ~600 px wide card is ~9 px tall, below what
   * Tesseract's LSTM reads reliably; ~1.7× upscaling brings it to ~15 px.
   */
  minCropWidth?: number;
  /**
   * Crops wider than this are downscaled to it. Default 1400: a 50 MP photo
   * gives 1,800 px pockets that take Tesseract 8 s each for no gain (the
   * number line is ~25 px tall at 1400).
   */
  maxCropWidth?: number;
  /** Thumbnail width in the review grid. Default 240. */
  thumbWidth?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  geometry?: PageGeometryOptions;
}

const MIN_CROP_WIDTH = 1000;
const MAX_CROP_WIDTH = 1400;
const THUMB_WIDTH = 240;
const PAD = 0.06;
/** Bottom share of the card read again, magnified. */
const STRIP_SHARE = 0.15;
/** Magnification of the strip relative to the crop (the ~15 px number becomes ~40 px). */
const STRIP_SCALE = 2.5;
/** Share of an alternative's score that counts towards the merged pool. */
const ALT_WEIGHT = 0.5;

/** `box` grown by `pad` × its size on every side, kept inside the frame. */
export function padBox(box: Box, pad: number, frameW: number, frameH: number): Box {
  const dx = box.w * pad;
  const dy = box.h * pad;
  const x = Math.max(0, box.x - dx);
  const y = Math.max(0, box.y - dy);
  return { x, y, w: Math.min(frameW, box.x + box.w + dx) - x, h: Math.min(frameH, box.y + box.h + dy) - y };
}

/**
 * The bottom `STRIP_SHARE` of `crop`, magnified `STRIP_SCALE`×. Returned
 * lines must be mapped back with `stripLines`.
 */
function cropStrip(crop: HTMLCanvasElement): { canvas: HTMLCanvasElement; top: number } {
  const top = Math.round(crop.height * (1 - STRIP_SHARE));
  const h = crop.height - top;
  const out = document.createElement('canvas');
  out.width = Math.round(crop.width * STRIP_SCALE);
  out.height = Math.round(h * STRIP_SCALE);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(crop, 0, top, crop.width, h, 0, 0, out.width, out.height);
  return { canvas: out, top };
}

/** Strip lines mapped into crop coordinates, minus exact repeats of lines already read. */
export function stripLines(lines: readonly RecognizedLine[], top: number, already: readonly RecognizedLine[]): RecognizedLine[] {
  const seen = new Set(already.map((l) => l.text.trim().toUpperCase()));
  const out: RecognizedLine[] = [];
  for (const l of lines) {
    const key = l.text.trim().toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...l,
      bbox: { x: l.bbox.x / STRIP_SCALE, y: top + l.bbox.y / STRIP_SCALE, w: l.bbox.w / STRIP_SCALE, h: l.bbox.h / STRIP_SCALE },
    });
  }
  return out;
}

interface PoolEntry {
  weight: number;
  best: ScanCandidate | null;
  alt: ScanAlternative | null;
  /** Frames in which the card was the pocket's top read. */
  tops: number;
}

/**
 * Merge the candidate lists of one pocket read from several frames (and of
 * the live frame's alternatives): weights add up over frames, so a card that
 * is top-1 in two frames beats one that was top-1 in one, and a card listed
 * second every time can still win. Returns the best candidate and the rest
 * as alternatives, best first.
 */
export function mergePocketCandidates(perFrame: readonly (readonly ScanCandidate[])[]): {
  candidate?: ScanCandidate;
  alternatives: ScanAlternative[];
} {
  const pool = new Map<string, PoolEntry>();
  const entry = (id: string): PoolEntry => {
    let e = pool.get(id);
    if (!e) {
      e = { weight: 0, best: null, alt: null, tops: 0 };
      pool.set(id, e);
    }
    return e;
  };
  for (const cands of perFrame) {
    cands.forEach((c, i) => {
      const e = entry(c.card.id);
      e.weight += c.score * (i === 0 ? 1 : 0.8);
      if (i === 0) e.tops++;
      if (!e.best || c.score > e.best.score) e.best = c;
      for (const a of c.alternatives) {
        const ea = entry(a.card.id);
        ea.weight += a.score * ALT_WEIGHT;
        if (!ea.alt || a.score > ea.alt.score) ea.alt = a;
      }
    });
  }
  const ranked = [...pool.entries()].sort((a, b) => b[1].weight - a[1].weight);
  if (!ranked.length) return { alternatives: [] };
  const [bestId, best] = ranked[0];
  const toAlt = (e: PoolEntry): ScanAlternative =>
    e.best
      ? { card: e.best.card, set: e.best.set, score: e.best.score, evidence: e.best.evidence }
      : { card: e.alt!.card, set: e.alt!.set, score: e.alt!.score, evidence: e.alt!.evidence };
  const alternatives = ranked.slice(1).map(([, e]) => toAlt(e));
  const frames = perFrame.length;
  if (!best.best) {
    // Only ever an alternative: promote it as an unsure candidate.
    const a = best.alt!;
    return {
      candidate: { key: bestId, card: a.card, set: a.set, score: a.score, margin: 0, confident: false, evidence: a.evidence, bbox: { x: 0, y: 0, w: 0, h: 0 }, cardBox: { x: 0, y: 0, w: 0, h: 0 }, alternatives },
      alternatives,
    };
  }
  const runnerUp = ranked[1]?.[1].weight ?? 0;
  const margin = best.weight > 0 ? Math.max(0, Math.min(1, (best.weight - runnerUp) / best.weight)) : 0;
  const agreed = frames >= 2 && best.tops === frames;
  const candidate: ScanCandidate = {
    ...best.best,
    key: bestId,
    margin: Math.max(best.best.margin, margin),
    confident: best.best.confident || (agreed && margin >= 0.3),
    alternatives,
  };
  return { candidate, alternatives };
}

/**
 * Crop `box` from `source` into a new canvas, upscaled so its width is at least
 * `minWidth`. Crop straight from the full-resolution source (an ImageBitmap of
 * the photo): every intermediate resample blurs the tiny number line.
 */
export function cropPocket(source: PageSource, box: Box, minWidth: number, maxWidth = Infinity): HTMLCanvasElement {
  const scale = box.w > maxWidth ? maxWidth / box.w : Math.max(1, minWidth / box.w);
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
  matcher: ScanMatcher,
  opts: ScanPageOptions = {},
): Promise<PocketScan[]> {
  const pockets = pocketBoxes(frame.width, frame.height, layout, opts.geometry);
  const results: PocketScan[] = [];
  const minWidth = opts.minCropWidth ?? MIN_CROP_WIDTH;
  const maxWidth = opts.maxCropWidth ?? MAX_CROP_WIDTH;
  const pad = opts.pad ?? PAD;
  const refine = opts.refine ?? false;
  const strip = opts.numberStrip ?? true;
  const frames: PageSource[] = [frame, ...(opts.extraFrames ?? [])];
  const card = opts.geometry?.cardMm ?? DEFAULT_CARD_MM;
  const aspect = card.w / card.h;
  for (const pocket of pockets) {
    if (opts.signal?.aborted) break;
    const started = performance.now();
    const padded = padBox(pocket.box, pad, frame.width, frame.height);
    const cardBox = (refine && refineCardBox(frame, padded, aspect)) || padded;
    const perFrame: ScanCandidate[][] = [];
    let thumb = '';
    let lineCount = 0;
    for (const src of frames) {
      if (opts.signal?.aborted) break;
      const crop = cropPocket(src, cardBox, minWidth, maxWidth);
      if (!thumb) thumb = thumbnail(crop, opts.thumbWidth ?? THUMB_WIDTH);
      let lines: RecognizedLine[] = [];
      let cands: ScanCandidate[] = [];
      try {
        lines = await recognizer.recognize(crop);
        cands = matcher.scanLines(lines);
        // The number line is what pins the printing: when the full read did
        // not settle it, read the bottom of the card again, magnified.
        if (strip && !cands[0]?.confident) {
          const s = cropStrip(crop);
          const extra = stripLines(await recognizer.recognize(s.canvas), s.top, lines);
          if (extra.length) {
            lines = [...lines, ...extra];
            cands = matcher.scanLines(lines);
          }
        }
      } catch (e) {
        console.warn('[scanner] pocket', pocket.index, 'recognition failed:', e);
      }
      lineCount = Math.max(lineCount, lines.length);
      perFrame.push(cands);
    }
    // A pocket holds one card: keep the strongest candidate across frames,
    // demote the rest to alternatives so the user can correct a wrong pick.
    const merged = mergePocketCandidates(perFrame);
    results.push({
      pocket,
      candidate: merged.candidate,
      alternatives: merged.alternatives,
      lineCount,
      thumb,
      ms: performance.now() - started,
      cardBox,
      frames: perFrame.length,
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
