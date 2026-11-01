/**
 * Binder-page grid fitting: find where the cards sit in a frame instead of
 * asking the user to line the page up with a fixed rectangle.
 *
 * Approach (a few ms on a 320 px sample, so it can run several times a
 * second on a phone):
 *  1. Downscale the frame to ~320 px wide, keeping colour: a yellow card
 *     border against a white page is nearly invisible in luminance but
 *     strong in the blue channel.
 *  2. Sum the horizontal gradient down every column and the vertical gradient
 *     across every row, per channel. A card edge runs the full height (width)
 *     of the card, so it shows up as a spike in the column (row) profile; art,
 *     text and page texture average out. The SIGNED sums are kept too: every
 *     card on a page has the same border, so its left edges all go dark→light
 *     (or all light→dark) and add up, while random texture cancels.
 *  3. Everything printed on a card repeats once per card, so the profile's
 *     autocorrelation peaks at the card pitch. With the pitch known, only the
 *     phase and the card width remain to be searched, which rules out the
 *     tempting wrong answers (three art frames, every other edge).
 *  4. Score "n cards of width s at pitch p from x0" by the edge evidence at
 *     the 2n predicted edges, less the edge energy found in the gaps between
 *     cards (the inside of a card is busy; the page between cards is not),
 *     and check that columns and rows agree with the card's aspect ratio.
 *
 * Coordinates: everything here is in the pixels of the image handed in;
 * callers scale the result back to their frame (see fitGridOnSource).
 */
import type { Box } from './types';

/** An RGBA pixel buffer (canvas getImageData layout). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface GridLayoutLike {
  cols: number;
  rows: number;
}

/** One-dimensional fit: n items of `size` px at pitch `size + gap` from `start`. */
export interface Fit1D {
  start: number;
  size: number;
  gap: number;
  /** Net edge score at the 2n predicted edges (see confidence1D). */
  score: number;
  /** +1: items are lighter than their surroundings on their left edge; -1: darker. */
  sign: 1 | -1;
  /** 0..1, how much the predicted edges stand out from average edge energy. */
  confidence: number;
  /** Score components, for calibration: raw edge evidence and the three penalties. */
  parts: { edges: number; fill: number; gap: number };
}

export interface GridFit {
  /** Page rectangle (outer edges of the first and last cards), image px. */
  box: Box;
  cols: Fit1D;
  rows: Fit1D;
  /** 0..1; the weaker of the two dimensions. */
  confidence: number;
}

/** Edge evidence along one axis. All arrays are in units of the mean absolute energy (1 = average). */
export interface Profile {
  /** Σ |gradient| over the other axis and the three channels. */
  abs: Float32Array;
  /** Standard deviation of `abs` (its mean is 1). */
  sd: number;
  /** Edge evidence for a dark→light edge at each position (±1 px tolerance). */
  plus: Float32Array;
  /** Edge evidence for a light→dark edge. */
  minus: Float32Array;
}

export interface EdgeProfiles {
  cols: Profile;
  rows: Profile;
}

/** Profiles are clipped here so one very strong edge (a window, a lamp) cannot dominate a fit. */
const CAP = 8;
/** Weight of the pixels either side of a predicted edge position. */
const NEIGHBOUR_WEIGHT = 0.8;

function finishProfile(abs: Float32Array, signed: Float32Array[]): Profile {
  const n = abs.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += abs[i];
  const mean = sum / Math.max(1, n) || 1;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    abs[i] = Math.min(CAP, abs[i] / mean);
    sq += (abs[i] - 1) * (abs[i] - 1);
    for (const s of signed) s[i] = Math.max(-CAP, Math.min(CAP, s[i] / mean));
  }
  const sd = Math.max(0.05, Math.sqrt(sq / Math.max(1, n)));
  // Directed edge evidence: the strongest same-direction channel gradient plus
  // half the absolute energy (so a border whose inner and outer edges cancel
  // in the signed sum still counts a little). Neighbouring pixels count at a
  // discount: ±1 px tolerance without a plateau of equally good positions.
  const plus = new Float32Array(n);
  const minus = new Float32Array(n);
  for (let x = 0; x < n; x++) {
    let p = 0;
    let m = 0;
    let a = 0;
    for (let d = -1; d <= 1; d++) {
      const i = x + d;
      if (i < 0 || i >= n) continue;
      const w = d === 0 ? 1 : NEIGHBOUR_WEIGHT;
      a = Math.max(a, w * abs[i]);
      for (const s of signed) {
        p = Math.max(p, w * s[i]);
        m = Math.max(m, w * -s[i]);
      }
    }
    plus[x] = p + 0.5 * a;
    minus[x] = m + 0.5 * a;
  }
  return { abs, sd, plus, minus };
}

/** Column and row gradient profiles of `img`. */
export function edgeProfiles(img: RgbaImage): EdgeProfiles {
  const { width: w, height: h, data } = img;
  const colAbs = new Float32Array(w);
  const rowAbs = new Float32Array(h);
  const colSigned = [new Float32Array(w), new Float32Array(w), new Float32Array(w)];
  const rowSigned = [new Float32Array(h), new Float32Array(h), new Float32Array(h)];
  const stride = w * 4;
  for (let y = 1; y < h - 1; y++) {
    let ra = 0;
    const rs = [0, 0, 0];
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      let ca = 0;
      for (let c = 0; c < 3; c++) {
        const dx = data[i + 4 + c] - data[i - 4 + c];
        const dy = data[i + stride + c] - data[i - stride + c];
        colSigned[c][x] += dx;
        ca += Math.abs(dx);
        rs[c] += dy;
        ra += Math.abs(dy);
      }
      colAbs[x] += ca;
    }
    rowAbs[y] = ra;
    for (let c = 0; c < 3; c++) rowSigned[c][y] = rs[c];
  }
  return { cols: finishProfile(colAbs, colSigned), rows: finishProfile(rowAbs, rowSigned) };
}

/** Cards must be at least this fraction of their share of the frame (the page fills a good part of it). */
const MIN_PITCH_SHARE = 0.45;

/**
 * Likely item pitches along a profile, best first: peaks of the mean-removed
 * autocorrelation of the absolute energy between MIN_PITCH_SHARE·L/n and L/n.
 */
export function pitchCandidates(abs: Float32Array, n: number, max = 3): number[] {
  const L = abs.length;
  const pMin = Math.max(4, Math.floor((MIN_PITCH_SHARE * L) / n));
  const pMax = Math.floor(L / n);
  if (pMax <= pMin) return [];
  let mean = 0;
  for (let i = 0; i < L; i++) mean += abs[i];
  mean /= L;
  const r = new Float32Array(pMax + 2);
  for (let tau = pMin - 1; tau <= pMax + 1; tau++) {
    let s = 0;
    for (let x = 0; x + tau < L; x++) s += (abs[x] - mean) * (abs[x + tau] - mean);
    r[tau] = s / (L - tau);
  }
  const peaks: { tau: number; v: number }[] = [];
  for (let tau = pMin; tau <= pMax; tau++) {
    if (r[tau] > 0 && r[tau] >= r[tau - 1] && r[tau] >= r[tau + 1]) peaks.push({ tau, v: r[tau] });
  }
  peaks.sort((a, b) => b.v - a.v);
  return peaks.slice(0, max).map((p) => p.tau);
}

/** Weight of the above-average edge energy found in the gaps between cards. */
const GAP_PENALTY = 0.5;
/** Smallest card as a fraction of the pitch (the rest is the pocket gap). */
const MIN_SIZE_SHARE = 0.75;

/** Score components of one placement (see fit1D); `score` is what the search maximizes. */
export interface Placement {
  start: number;
  size: number;
  gap: number;
  sign: 1 | -1;
  score: number;
  parts: { edges: number; fill: number; gap: number };
}

interface ScoreContext {
  profile: Profile;
  n: number;
  /** Prefix sums of max(0, abs − 1). */
  excess: Float32Array;
  /** Scratch space for the per-item scores (no allocation per placement). */
  up: Float64Array;
  down: Float64Array;
  weights: Float64Array;
}

function scoreContext(profile: Profile, n: number): ScoreContext {
  const { abs } = profile;
  const L = abs.length;
  const excess = new Float32Array(L + 1);
  for (let x = 0; x < L; x++) excess[x + 1] = excess[x] + Math.max(0, abs[x] - 1);
  // Weights for the items sorted weakest first (see weakestFirst).
  const weights = new Float64Array(n);
  if (n === 1) weights[0] = 1;
  else if (n === 2) {
    weights[0] = 0.65;
    weights[1] = 0.35;
  } else {
    weights[0] = 0.6;
    weights[1] = 0.25;
    for (let i = 2; i < n; i++) weights[i] = 0.15 / (n - 2);
  }
  return { profile, n, excess, up: new Float64Array(n), down: new Float64Array(n), weights };
}

function sumIn(pre: Float32Array, from: number, to: number): number {
  const a = Math.max(0, from);
  const b = Math.min(pre.length - 1, to + 1);
  return b > a ? pre[b] - pre[a] : 0;
}

/** Score `n` items of size `s` at pitch `p` starting at `x0`. */
export function scorePlacement(ctx: ScoreContext, x0: number, s: number, p: number): Placement {
  const { plus, minus } = ctx.profile;
  const { n, excess } = ctx;
  const { up, down, weights } = ctx;
  for (let i = 0; i < n; i++) {
    const l = x0 + i * p;
    const r = l + s - 1;
    up[i] = plus[l] + minus[r]; // left edges dark→light, right edges light→dark
    down[i] = minus[l] + plus[r];
  }
  const edgesUp = weakestFirst(up, weights);
  const edgesDown = weakestFirst(down, weights);
  const edges = Math.max(edgesUp, edgesDown);
  const r0 = x0 + s - 1;
  let gap = sumIn(excess, x0 - 5, x0 - 2) + sumIn(excess, r0 + (n - 1) * p + 2, r0 + (n - 1) * p + 5);
  for (let i = 0; i < n - 1; i++) gap += sumIn(excess, x0 + i * p + s + 1, x0 + (i + 1) * p - 2);
  // Cards nearly fill their pitch (pocket gaps are 3–8% of it): a wide gap
  // usually means the items are something inside the cards.
  const fill = 1 - (0.5 * (p - s)) / p;
  const score = edges * fill - GAP_PENALTY * gap;
  return { start: x0, size: s, gap: p - s, sign: edgesUp >= edgesDown ? 1 : -1, score, parts: { edges, fill, gap: GAP_PENALTY * gap } };
}

/**
 * Item scores combined with the weakest counting most (×n so the scale stays
 * "sum over items"). Everything printed on a card repeats once per card, so
 * a cell offset by a fraction of the pitch still finds n−1 good items; only
 * the item at the end of the page has nothing to match. Weighting the weakest
 * item rules those cells out while one weak item (an empty pocket, glare)
 * only lowers the score instead of breaking the fit.
 */
function weakestFirst(items: Float64Array, weights: Float64Array): number {
  const n = items.length;
  // Insertion sort in place (n ≤ 4).
  for (let i = 1; i < n; i++) {
    const v = items[i];
    let j = i - 1;
    while (j >= 0 && items[j] > v) {
      items[j + 1] = items[j];
      j--;
    }
    items[j + 1] = v;
  }
  let sum = 0;
  for (let i = 0; i < n; i++) sum += items[i] * weights[i];
  return sum * n;
}

/**
 * Confidence of a fit from how far its 2n edges stand above the profile's
 * average energy (1): a random position averages ~1.4 after the ±1 px
 * tolerance; card edges in a busy photo reach 2.2–3 (measured), on a plain
 * page more.
 */
function confidence1D(abs: Float32Array, x0: number, n: number, s: number, p: number, score: number): number {
  if (score <= 0) return 0;
  const L = abs.length;
  const at = (x: number) => Math.max(abs[Math.max(0, x - 1)], abs[x], abs[Math.min(L - 1, x + 1)]);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += at(x0 + i * p) + at(x0 + i * p + s - 1);
  const perEdge = sum / (2 * n);
  return Math.max(0, Math.min(1, (perEdge - RANDOM_EDGE) / (SURE_EDGE - RANDOM_EDGE)));
}

/** Mean edge energy a random placement reaches, and the level that counts as certain. */
const RANDOM_EDGE = 1.4;
const SURE_EDGE = 2.6;

/**
 * Best placement of `n` items of pitch ≈ `pitch` (±`slack` px) along a
 * profile. Returns null when nothing fits.
 */
export function fit1D(profile: Profile, n: number, pitch: number, slack = 2): Fit1D | null {
  const L = profile.abs.length;
  const ctx = scoreContext(profile, n);
  let best: Placement | null = null;
  for (let p = pitch - slack; p <= pitch + slack; p++) {
    if (p < 4) continue;
    const sMin = Math.max(3, Math.round(p * MIN_SIZE_SHARE));
    for (let s = sMin; s <= p; s++) {
      const span = (n - 1) * p + s;
      if (span > L) break;
      for (let x0 = 0; x0 + span <= L; x0++) {
        const c = scorePlacement(ctx, x0, s, p);
        if (!best || c.score > best.score) best = c;
      }
    }
  }
  if (!best) return null;
  return { ...best, confidence: confidence1D(profile.abs, best.start, n, best.size, best.size + best.gap, best.score) };
}

/** Score an explicit placement (debugging, calibration). */
export function evaluatePlacement(profile: Profile, n: number, x0: number, s: number, p: number): Placement {
  return scorePlacement(scoreContext(profile, n), x0, s, p);
}

/** Below this the fit is reported as null: the caller keeps its current guide. */
export const MIN_GRID_CONFIDENCE = 0.4;
/** Column and row pitches may disagree with the card aspect by this factor. */
const ASPECT_TOLERANCE = 0.2;

export interface FitGridOptions {
  /** Card width / height. Default 63/88 (Pokémon). */
  cardAspect?: number;
  /** Return fits below this confidence as null. Default MIN_GRID_CONFIDENCE. */
  minConfidence?: number;
}

/** Fit `layout.cols × layout.rows` cards to the image. */
export function fitGrid(img: RgbaImage, layout: GridLayoutLike, opts: FitGridOptions = {}): GridFit | null {
  const aspect = opts.cardAspect ?? 63 / 88;
  const minConf = opts.minConfidence ?? MIN_GRID_CONFIDENCE;
  const { cols: n, rows: m } = layout;
  const p = edgeProfiles(img);
  const colFits = pitchCandidates(p.cols.abs, n).map((pitch) => fit1D(p.cols, n, pitch));
  const rowFits = pitchCandidates(p.rows.abs, m).map((pitch) => fit1D(p.rows, m, pitch));
  let best: GridFit | null = null;
  for (const c of colFits) {
    if (!c) continue;
    for (const r of rowFits) {
      if (!r) continue;
      // Pitches include the pocket gap on both axes, so compare pitch to pitch.
      const ratio = (c.size + c.gap) / (r.size + r.gap) / aspect;
      if (ratio < 1 - ASPECT_TOLERANCE || ratio > 1 + ASPECT_TOLERANCE) continue;
      const confidence = Math.min(c.confidence, r.confidence);
      if (!best || confidence > best.confidence) {
        best = {
          cols: c,
          rows: r,
          confidence,
          box: { x: c.start, y: r.start, w: (n - 1) * (c.size + c.gap) + c.size, h: (m - 1) * (r.size + r.gap) + r.size },
        };
      }
    }
  }
  return best && best.confidence >= minConf ? best : null;
}

/* ---------- single card inside a pocket crop ---------- */

/**
 * The card must cover at least this share of the padded pocket crop in each
 * dimension: the crop is the cell plus a 6% margin, so the card is ~88% of it,
 * while the art frame printed on it is ~70% and must not be mistaken for it.
 */
const MIN_CARD_SHARE = 0.8;
/** Score multiplier lost per unit of centre offset (as a share of the crop): the card sits near the middle. */
const OFF_CENTRE_PENALTY = 1.5;
/** Mean absolute edge energy at the four edges needed to trust a single-card fit. */
const SINGLE_CARD_MIN_EDGE = 1.8;

/**
 * Tighten a pocket crop (the cell plus some margin) to the card inside it:
 * the best left/right edge pair and top/bottom pair with the card's aspect,
 * scored like fit1D but for one item. Returns null when the edges are not
 * clear enough, in which case the caller keeps the padded crop.
 */
export function fitSingleCard(img: RgbaImage, cardAspect = 63 / 88): (Box & { confidence: number }) | null {
  const p = edgeProfiles(img);
  const W = img.width;
  const H = img.height;
  // Edge evidence for an item [l, r], discounted by how far its centre sits from the crop's.
  const edgeAt = (prof: Profile, l: number, r: number, L: number) => {
    const e = Math.max(prof.plus[l] + prof.minus[r], prof.minus[l] + prof.plus[r]);
    const off = Math.abs((l + r + 1) / 2 - L / 2) / L;
    return e * Math.max(0.2, 1 - OFF_CENTRE_PENALTY * off);
  };
  // Columns: every (x0, w) with w ≥ MIN_CARD_SHARE·W.
  let bestCol: { x: number; w: number; e: number } | null = null;
  for (let w = Math.floor(W * MIN_CARD_SHARE); w <= W; w++) {
    for (let x = 0; x + w <= W; x++) {
      const e = edgeAt(p.cols, x, x + w - 1, W);
      if (!bestCol || e > bestCol.e) bestCol = { x, w, e };
    }
  }
  if (!bestCol) return null;
  // Rows: height within ±12% of what the aspect predicts, and at least MIN_CARD_SHARE·H.
  const hMid = bestCol.w / cardAspect;
  let bestRow: { y: number; h: number; e: number } | null = null;
  for (let h = Math.max(Math.floor(H * MIN_CARD_SHARE), Math.floor(hMid * 0.88)); h <= Math.min(H, Math.ceil(hMid * 1.12)); h++) {
    for (let y = 0; y + h <= H; y++) {
      const e = edgeAt(p.rows, y, y + h - 1, H);
      if (!bestRow || e > bestRow.e) bestRow = { y, h, e };
    }
  }
  if (!bestRow) return null;
  const at = (abs: Float32Array, x: number) => Math.max(abs[Math.max(0, x - 1)], abs[x], abs[Math.min(abs.length - 1, x + 1)]);
  const meanEdge =
    (at(p.cols.abs, bestCol.x) + at(p.cols.abs, bestCol.x + bestCol.w - 1) + at(p.rows.abs, bestRow.y) + at(p.rows.abs, bestRow.y + bestRow.h - 1)) / 4;
  if (meanEdge < SINGLE_CARD_MIN_EDGE) return null;
  return {
    x: bestCol.x,
    y: bestRow.y,
    w: bestCol.w,
    h: bestRow.h,
    confidence: Math.max(0, Math.min(1, (meanEdge - RANDOM_EDGE) / (SURE_EDGE - RANDOM_EDGE))),
  };
}

/* ---------- DOM helpers ---------- */

let sampleCanvas: HTMLCanvasElement | null = null;

/** Anything drawImage accepts (video, canvas, ImageBitmap, img). */
export type GridSource = CanvasImageSource;

/** RGBA sample of `region` of `source`, `width` px wide. */
export function sampleRgba(source: GridSource, region: Box, width: number): RgbaImage {
  const w = Math.max(8, Math.round(width));
  const h = Math.max(8, Math.round((width * region.h) / region.w));
  sampleCanvas ??= document.createElement('canvas');
  if (sampleCanvas.width !== w) sampleCanvas.width = w;
  if (sampleCanvas.height !== h) sampleCanvas.height = h;
  const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(source, region.x, region.y, region.w, region.h, 0, 0, w, h);
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
}

/** Sample width: a 3-wide page gives ~100 px cards, enough to tell the border from the art frame. */
export const GRID_SAMPLE_WIDTH = 320;
/** Sample width for tightening one pocket crop to its card. */
export const CARD_SAMPLE_WIDTH = 200;

/**
 * Tighten `region` (a pocket cell plus margin, frame px) to the card in it.
 * Returns the card box in frame px, or null to keep the region as is.
 */
export function refineCardBox(source: GridSource, region: Box, cardAspect = 63 / 88): Box | null {
  if (region.w <= 0 || region.h <= 0) return null;
  const img = sampleRgba(source, region, CARD_SAMPLE_WIDTH);
  const fit = fitSingleCard(img, cardAspect);
  if (!fit) return null;
  const sx = region.w / img.width;
  const sy = region.h / img.height;
  return { x: region.x + fit.x * sx, y: region.y + fit.y * sy, w: fit.w * sx, h: fit.h * sy };
}

/**
 * Fit the grid inside `region` of `source` (frame px) and return the page box
 * in frame px, or null when no confident grid was found.
 */
export function fitGridOnSource(
  source: GridSource,
  region: Box,
  layout: GridLayoutLike,
  opts: FitGridOptions & { sampleWidth?: number } = {},
): GridFit | null {
  if (region.w <= 0 || region.h <= 0) return null;
  const img = sampleRgba(source, region, opts.sampleWidth ?? GRID_SAMPLE_WIDTH);
  const fit = fitGrid(img, layout, opts);
  if (!fit) return null;
  const sx = region.w / img.width;
  const sy = region.h / img.height;
  return {
    ...fit,
    box: { x: region.x + fit.box.x * sx, y: region.y + fit.box.y * sy, w: fit.box.w * sx, h: fit.box.h * sy },
  };
}
