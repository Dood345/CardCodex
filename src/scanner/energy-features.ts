/**
 * What a basic Energy card is told apart by, as pure functions shared by the
 * app (src/scanner/energy.ts) and the build script that precomputes the same
 * features for the reference images (scripts/build-energy-refs.mjs):
 *
 * - the picture of the big symbol, as a small grey thumbnail compared by
 *   normalised correlation, which ignores how bright or what colour the light
 *   is and separates the types well (on the 2020 Darkness Energy photo:
 *   0.90 for Darkness, 0.77 for the next type);
 * - the colour of the art under the symbol, which separates red from blue
 *   beyond doubt but not Darkness from Water in a bluish light, so it only
 *   nudges.
 */
import { cellMeans, type HashWindow, type LumaImage } from './hash';

/** The Energy types, as the card names spell them. */
export const BASIC_ENERGY = /^(?:Basic )?(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy) Energy$/;

/** The band of art under the symbol, as fractions of the card: the type's colour, no symbol, text or border. */
export const ENERGY_COLOR_WINDOW: HashWindow = { x: 0.12, y: 0.62, w: 0.76, h: 0.2 };
/** The big symbol in the middle of the card, as fractions of the card. */
export const ENERGY_SYMBOL_WINDOW: HashWindow = { x: 0.2, y: 0.22, w: 0.6, h: 0.34 };
/** Side of the symbol thumbnail, in cells. */
export const ENERGY_THUMB = 20;

/** `inner` (fractions of `outer`) as fractions of the image `outer` is given in. */
const within = (outer: HashWindow, inner: HashWindow): HashWindow => ({ x: outer.x + inner.x * outer.w, y: outer.y + inner.y * outer.h, w: inner.w * outer.w, h: inner.h * outer.h });

/** Mean [r, g, b] (0..255) of `win` (fractions of the image) of an RGBA buffer. */
export function meanRgb(data: ArrayLike<number>, width: number, height: number, win: HashWindow): [number, number, number] {
  const x0 = Math.max(0, Math.floor(win.x * width));
  const x1 = Math.min(width, Math.ceil((win.x + win.w) * width));
  const y0 = Math.max(0, Math.floor(win.y * height));
  const y1 = Math.min(height, Math.ceil((win.y + win.h) * height));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  return n ? [r / n, g / n, b / n] : [0, 0, 0];
}

/** The art colour of the card at `card` (fractions of the image) in an RGBA buffer. */
export function energyColor(data: ArrayLike<number>, width: number, height: number, card: HashWindow): [number, number, number] {
  return meanRgb(data, width, height, within(card, ENERGY_COLOR_WINDOW));
}

/** [r, g, b] as shares of their sum: colour without brightness. */
export function chromaticity(r: number, g: number, b: number): [number, number, number] {
  const s = r + g + b || 1;
  return [r / s, g / s, b / s];
}

/** Mean luma (0..255) of each cell of the symbol of the card at `card`, row by row: what the reference file stores. */
export function symbolCells(img: LumaImage, card: HashWindow, n = ENERGY_THUMB): Float64Array {
  return cellMeans(img.integral, img.width, img.height, within(card, ENERGY_SYMBOL_WINDOW), n, n);
}

/** Cells with their mean taken out and scaled to unit length, so two thumbnails' dot product is their correlation (−1..1). */
export function normalizeCells(cells: ArrayLike<number>): Float32Array {
  const out = new Float32Array(cells.length);
  let mean = 0;
  for (let i = 0; i < cells.length; i++) mean += cells[i];
  mean /= cells.length || 1;
  let norm = 0;
  for (let i = 0; i < cells.length; i++) {
    out[i] = cells[i] - mean;
    norm += out[i] * out[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/** Correlation of two normalised thumbnails. */
export function correlation(a: ArrayLike<number>, b: ArrayLike<number>, bo = 0): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[bo + i];
  return s;
}

/** `card` moved by (dx, dy) of its own size and scaled by `scale` about its centre. */
export function nudged(card: HashWindow, dx: number, dy: number, scale: number): HashWindow {
  return { x: card.x + dx * card.w - ((scale - 1) * card.w) / 2, y: card.y + dy * card.h - ((scale - 1) * card.h) / 2, w: card.w * scale, h: card.h * scale };
}
