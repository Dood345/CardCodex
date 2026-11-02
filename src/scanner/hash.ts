/**
 * Artwork matching: perceptual hashes of card images, an OCR-independent
 * signal for identifying a card from its picture.
 *
 * One hash per card is built offline from the catalog's reference image
 * (scripts/build-hashes.mjs → public/data/hashes.json); at scan time the same
 * function hashes a pocket crop and the nearest catalog hashes are the cards
 * whose artwork looks like the pocket's.
 *
 * The hash (one `HashSpec` per game): two 64-bit difference hashes of the
 * greyscale image,
 *  - the whole card on a 9×8 grid (8 rows × 8 left<right comparisons), and
 *  - the artwork window (the game's `HashSpec.art`, the picture box printed on
 *    a regular card of that game) on the same grid,
 * 128 bits = 16 bytes per card. A dHash compares neighbouring cell means, so
 * global brightness, contrast and a smooth lighting gradient leave it alone,
 * and a few per cent of misalignment changes only a few bits (page.ts probes
 * several alignments and keeps the best). Random images differ in ~64 of the
 * 128 bits; the same artwork rephotographed in ~10–25.
 *
 * Everything in this file except the DOM helpers at the end is pure and runs
 * unchanged in Node: the build script loads it through Vite so the table and
 * the scanner use one implementation, not two that agree on paper.
 */
import { sampleRgba } from './grid';
import type { Box } from './types';

/** 32-bit words per hash. */
export const HASH_WORDS = 4;
export const HASH_BYTES = HASH_WORDS * 4;
export const HASH_BITS = HASH_WORDS * 32;
/** Cell grid of each difference hash: `cols − 1` comparisons per row. */
export const HASH_GRID = { cols: 9, rows: 8 } as const;

/** A rectangle as fractions (0..1) of the image. */
export interface HashWindow {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const CARD_WINDOW: HashWindow = { x: 0, y: 0, w: 1, h: 1 };
/**
 * The picture box of a regular Pokémon card: measured on TCGdex scans the
 * artwork spans ≈ 6–94 % of the width and 8–47 % of the height on SV cards,
 * 10–90 % and 13–50 % on Base Set; this window sits inside both. Full-art
 * cards have no box; their whole-card hash still carries the picture.
 */
export const ART_WINDOW: HashWindow = { x: 0.1, y: 0.12, w: 0.8, h: 0.35 };
/**
 * The picture box of a Yu-Gi-Oh! card, measured on YGOPRODeck renders
 * (268×391): standard frames (monster, spell, trap, link, xyz) print a square
 * picture at x 12–88 %, y 18–71 % of the card; the `*_pendulum` frames a
 * wider one at x 6–94 %, y 17–76 %, with the pendulum scale box drawn over
 * its bottom from ≈ 63 %. This window sits ≈ 1 % inside the standard box and
 * inside the pendulum picture too (its bottom rows cover the scale box on
 * those 391 cards, the same on the render and the card), so one window hashes
 * every frame and a pocket needs no second set of probes.
 */
export const YGO_ART_WINDOW: HashWindow = { x: 0.13, y: 0.2, w: 0.74, h: 0.49 };

/**
 * The hash layout of one game's table: the artwork window and the card
 * aspect the pocket crops are resampled with. `id` is written into the table
 * file as `spec`; a file whose spec this code does not know is not loaded,
 * and a change to a window is a new id (and a rebuilt table).
 */
export interface HashSpec {
  id: string;
  game: string;
  /** Card width ÷ height (63×88 mm Pokémon, 59×86 mm Yu-Gi-Oh!). */
  cardAspect: number;
  /** The artwork window hashed into words 2–3, as fractions of the card. */
  art: HashWindow;
}

export const POKEMON_HASH_SPEC: HashSpec = { id: 'dhash-9x8-luma-card+art-v1', game: 'pokemon', cardAspect: 63 / 88, art: ART_WINDOW };
export const YGO_HASH_SPEC: HashSpec = { id: 'dhash-9x8-luma-card+art-ygo-v1', game: 'ygo', cardAspect: 59 / 86, art: YGO_ART_WINDOW };
export const HASH_SPECS: readonly HashSpec[] = [POKEMON_HASH_SPEC, YGO_HASH_SPEC];
/** The Pokémon spec id (the original, single-game table format). */
export const HASH_SPEC = POKEMON_HASH_SPEC.id;

/** The spec of a game's table, or undefined when the game has none. */
export function hashSpecFor(game: string): HashSpec | undefined {
  return HASH_SPECS.find((s) => s.game === game);
}

/** The spec a table file's `spec` field names, or undefined when this code does not know it. */
export function hashSpecById(id: string): HashSpec | undefined {
  return HASH_SPECS.find((s) => s.id === id);
}

/**
 * Summed-area table of the image's luma (Rec. 601), `(width+1) × (height+1)`,
 * transparent pixels composited over white (the corners of a reference scan
 * are transparent; on a page they show the white pocket behind the card).
 */
export function lumaIntegral(data: ArrayLike<number>, width: number, height: number): Float64Array {
  const W = width + 1;
  const out = new Float64Array(W * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const above = y * W;
    const row = (y + 1) * W;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const a = data[i + 3];
      if (a < 255) luma = (luma * a + 255 * (255 - a)) / 255;
      rowSum += luma;
      out[row + x + 1] = out[above + x + 1] + rowSum;
    }
  }
  return out;
}

/**
 * Mean luma of each cell of a `cols × rows` grid laid over `win` (fractions
 * of the image), row-major. Cell edges are rounded to whole pixels; every
 * cell is at least one pixel.
 */
export function cellMeans(integral: Float64Array, width: number, height: number, win: HashWindow, cols: number, rows: number): Float64Array {
  const W = width + 1;
  const x0 = win.x * width;
  const y0 = win.y * height;
  const cw = (win.w * width) / cols;
  const ch = (win.h * height) / rows;
  const out = new Float64Array(cols * rows);
  const clampX = (v: number) => Math.max(0, Math.min(width, Math.round(v)));
  const clampY = (v: number) => Math.max(0, Math.min(height, Math.round(v)));
  for (let r = 0; r < rows; r++) {
    let ya = clampY(y0 + r * ch);
    let yb = clampY(y0 + (r + 1) * ch);
    if (yb <= ya) {
      if (ya >= height) ya = height - 1;
      yb = ya + 1;
    }
    for (let c = 0; c < cols; c++) {
      let xa = clampX(x0 + c * cw);
      let xb = clampX(x0 + (c + 1) * cw);
      if (xb <= xa) {
        if (xa >= width) xa = width - 1;
        xb = xa + 1;
      }
      const sum = integral[yb * W + xb] - integral[ya * W + xb] - integral[yb * W + xa] + integral[ya * W + xa];
      out[r * cols + c] = sum / ((xb - xa) * (yb - ya));
    }
  }
  return out;
}

/**
 * Difference hash of a cell grid: bit k (k = row × (cols−1) + col, most
 * significant first) is 1 when the cell is darker than its right neighbour.
 * `(cols − 1) × rows` must be 64; returns the two 32-bit words.
 */
export function dhashWords(means: ArrayLike<number>, cols: number, rows: number): [number, number] {
  let hi = 0;
  let lo = 0;
  let k = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const bit = means[r * cols + c] < means[r * cols + c + 1] ? 1 : 0;
      if (k < 32) hi |= bit << (31 - k);
      else lo |= bit << (63 - k);
      k++;
    }
  }
  return [hi >>> 0, lo >>> 0];
}

/** An image reduced to its luma summed-area table: hashes of any window of it are cheap (`hashCardIn`). */
export interface LumaImage {
  width: number;
  height: number;
  integral: Float64Array;
}

export function lumaImage(data: ArrayLike<number>, width: number, height: number): LumaImage {
  return { width, height, integral: lumaIntegral(data, width, height) };
}

/** `inner` (fractions of `outer`) as fractions of the whole image. */
export function subWindow(outer: HashWindow, inner: HashWindow): HashWindow {
  return { x: outer.x + inner.x * outer.w, y: outer.y + inner.y * outer.h, w: inner.w * outer.w, h: inner.h * outer.h };
}

/**
 * The 128-bit hash of the card that fills `card` (fractions of the image):
 * words 0–1 the whole-card dHash, words 2–3 the dHash of the artwork window
 * `art` (the game's `HashSpec.art`; default the Pokémon one) inside it.
 * Hashing from the integral costs 144 lookups, so a pocket can be tried at
 * hundreds of alignments (`matchPocket`).
 */
export function hashCardIn(img: LumaImage, card: HashWindow = CARD_WINDOW, art: HashWindow = ART_WINDOW): Uint32Array {
  const { cols, rows } = HASH_GRID;
  const out = new Uint32Array(HASH_WORDS);
  const whole = dhashWords(cellMeans(img.integral, img.width, img.height, card, cols, rows), cols, rows);
  const artWords = dhashWords(cellMeans(img.integral, img.width, img.height, subWindow(card, art), cols, rows), cols, rows);
  out[0] = whole[0];
  out[1] = whole[1];
  out[2] = artWords[0];
  out[3] = artWords[1];
  return out;
}

/**
 * The hash of an RGBA image of a whole card (any size; the reference images
 * are ~245×337 or 268×391, pocket crops are resampled to about that), with
 * the game's artwork window (default the Pokémon one).
 */
export function hashCard(data: ArrayLike<number>, width: number, height: number, art: HashWindow = ART_WINDOW): Uint32Array {
  return hashCardIn(lumaImage(data, width, height), CARD_WINDOW, art);
}

export function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Hamming distance between hash `a` (at word offset `ao`) and `b` (at `bo`). */
export function hammingDistance(a: ArrayLike<number>, b: ArrayLike<number>, ao = 0, bo = 0): number {
  let d = 0;
  for (let i = 0; i < HASH_WORDS; i++) d += popcount32((a[ao + i] ^ b[bo + i]) >>> 0);
  return d;
}

/** 32 hex characters, words in order, most significant first. */
export function hashToHex(h: ArrayLike<number>, offset = 0): string {
  let s = '';
  for (let i = 0; i < HASH_WORDS; i++) s += (h[offset + i] >>> 0).toString(16).padStart(8, '0');
  return s;
}

export function hexToHash(hex: string): Uint32Array {
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`bad hash hex: ${hex}`);
  const out = new Uint32Array(HASH_WORDS);
  for (let i = 0; i < HASH_WORDS; i++) out[i] = parseInt(hex.slice(i * 8, i * 8 + 8), 16) >>> 0;
  return out;
}

/* ---------- the table ---------- */

/** public/data/hashes.json (Pokémon) and public/data/ygo/hashes.json. */
export interface HashFile {
  version: number;
  builtAt: string;
  game: string;
  /** `HashSpec.id` of the layout the hashes were built with. */
  spec: string;
  /**
   * Entry ids in table order (catalog order; cards without an image are
   * absent): catalog card ids for Pokémon, passcodes (decimal strings) for
   * Yu-Gi-Oh!, where every printing of a card shares the picture.
   */
  ids: string[];
  /** base64 of `ids.length × HASH_BYTES` bytes: each hash's words big-endian, in order. */
  hashes: string;
}

export interface HashTable {
  /** The layout the entries were hashed with: `matchPocket` probes a pocket with its artwork window. */
  spec: HashSpec;
  ids: string[];
  /** `ids.length × HASH_WORDS` words. */
  words: Uint32Array;
  indexOf: Map<string, number>;
}

/** Words → the base64 string stored in the file (big-endian bytes). */
export function encodeHashes(words: Uint32Array): string {
  const bytes = new Uint8Array(words.length * 4);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    bytes[i * 4] = w >>> 24;
    bytes[i * 4 + 1] = (w >>> 16) & 0xff;
    bytes[i * 4 + 2] = (w >>> 8) & 0xff;
    bytes[i * 4 + 3] = w & 0xff;
  }
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function decodeHashes(b64: string): Uint32Array {
  const bin = atob(b64);
  if (bin.length % 4) throw new Error('hash blob is not whole words');
  const words = new Uint32Array(bin.length / 4);
  for (let i = 0; i < words.length; i++) {
    words[i] = ((bin.charCodeAt(i * 4) << 24) | (bin.charCodeAt(i * 4 + 1) << 16) | (bin.charCodeAt(i * 4 + 2) << 8) | bin.charCodeAt(i * 4 + 3)) >>> 0;
  }
  return words;
}

/** Builds the in-memory table; throws when the file's spec is not one this code knows or is another game's. */
export function decodeHashFile(file: HashFile): HashTable {
  const spec = hashSpecById(file.spec);
  if (!spec) throw new Error(`hash table spec ${file.spec} is not one of ${HASH_SPECS.map((s) => s.id).join(', ')}`);
  if (file.game !== spec.game) throw new Error(`hash table for ${file.game} uses the ${spec.game} spec ${spec.id}`);
  const words = decodeHashes(file.hashes);
  if (words.length !== file.ids.length * HASH_WORDS) throw new Error(`hash table has ${words.length} words for ${file.ids.length} ids`);
  return { spec, ids: file.ids, words, indexOf: new Map(file.ids.map((id, i) => [id, i])) };
}

export function hashTableFrom(ids: string[], hashes: readonly Uint32Array[], spec: HashSpec = POKEMON_HASH_SPEC): HashTable {
  const words = new Uint32Array(ids.length * HASH_WORDS);
  hashes.forEach((h, i) => words.set(h, i * HASH_WORDS));
  return { spec, ids, words, indexOf: new Map(ids.map((id, i) => [id, i])) };
}

/**
 * Per-card distance to the nearest of `probes` (several hashes of the same
 * pocket at slightly different alignments), as a `Uint8Array` indexed like
 * `table.ids`. A linear scan: 20k cards × 4 words × a few probes is ~1 ms.
 */
export function hashDistances(table: HashTable, probes: Uint32Array | readonly Uint32Array[]): Uint8Array {
  const list = probes instanceof Uint32Array ? [probes] : probes;
  const n = table.ids.length;
  const out = new Uint8Array(n).fill(HASH_BITS);
  const { words } = table;
  for (const p of list) {
    const p0 = p[0];
    const p1 = p[1];
    const p2 = p[2];
    const p3 = p[3];
    for (let i = 0, o = 0; i < n; i++, o += HASH_WORDS) {
      const d = popcount32((words[o] ^ p0) >>> 0) + popcount32((words[o + 1] ^ p1) >>> 0) + popcount32((words[o + 2] ^ p2) >>> 0) + popcount32((words[o + 3] ^ p3) >>> 0);
      if (d < out[i]) out[i] = d;
    }
  }
  return out;
}

export interface HashHit {
  index: number;
  id: string;
  /** Hamming distance, 0..HASH_BITS (the best over the probes). */
  distance: number;
  /** Where the card sat when this distance was measured (fractions of the probed image); set by `matchPocket`. */
  window?: HashWindow;
}

/** The `k` nearest table entries to the probe(s), nearest first (ties in table order). */
export function nearestByHash(table: HashTable, probes: Uint32Array | readonly Uint32Array[], k = 5, maxDistance = HASH_BITS): HashHit[] {
  const dist = hashDistances(table, probes);
  const hits: HashHit[] = [];
  // Partial selection: keep the k best in a small sorted array.
  for (let i = 0; i < dist.length; i++) {
    const d = dist[i];
    if (d > maxDistance) continue;
    if (hits.length === k && d >= hits[k - 1].distance) continue;
    let j = hits.length;
    while (j > 0 && hits[j - 1].distance > d) j--;
    hits.splice(j, 0, { index: i, id: table.ids[i], distance: d });
    if (hits.length > k) hits.pop();
  }
  return hits;
}

/* ---------- pocket alignment probes ---------- */

export interface ProbeOptions {
  /** Offsets of the card inside the cell, as fractions of the cell size. Default −3 %, 0, +3 %. */
  shifts?: readonly number[];
  /** Card size as a fraction of the cell (the pocket gap makes the card smaller than its cell). Default 0.94, 0.97, 1. */
  scales?: readonly number[];
}

/**
 * Candidate card rectangles for a pocket cell (the fitted grid is within a
 * pocket gap of the cards, never exact): every combination of shift and
 * scale around the cell's centre, in the cell's own units (frame px or
 * fractions). The hash is taken at each and the nearest table entry over
 * all of them wins (`hashDistances`).
 */
export function alignmentProbes(cell: HashWindow, opts: ProbeOptions = {}): HashWindow[] {
  const shifts = opts.shifts ?? [-0.03, 0, 0.03];
  const scales = opts.scales ?? [0.94, 0.97, 1];
  const cx = cell.x + cell.w / 2;
  const cy = cell.y + cell.h / 2;
  const out: HashWindow[] = [];
  for (const s of scales) {
    const w = cell.w * s;
    const h = cell.h * s;
    for (const dy of shifts) {
      for (const dx of shifts) {
        out.push({ x: cx - w / 2 + dx * cell.w, y: cy - h / 2 + dy * cell.h, w, h });
      }
    }
  }
  return out;
}

const steps = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
};

/**
 * Coarse pass: the whole table against 75 alignments (±4 % in 2 % steps,
 * card 92–100 % of the cell). A dHash loses ~13 bits per 1 % of misalignment
 * (measured on reference images), so the right card is near the top but not
 * yet at its best distance.
 */
export const COARSE_PROBES: ProbeOptions = { shifts: steps(-0.04, 0.04, 0.02), scales: [0.92, 0.96, 1] };
/** Fine pass over the shortlist: ±6 % in 1 % steps, card 90–102 % of the cell (1,183 alignments). */
export const FINE_PROBES: ProbeOptions = { shifts: steps(-0.06, 0.06, 0.01), scales: steps(0.9, 1.02, 0.02) };
/** Cards kept from the coarse pass for the fine one. */
export const SHORTLIST = 96;

export interface MatchPocketOptions {
  coarse?: ProbeOptions;
  fine?: ProbeOptions;
  shortlist?: number;
  /** Hits returned. Default 8. */
  k?: number;
}

export interface PocketMatch {
  /** Nearest table entries after the fine pass, nearest first. */
  hits: HashHit[];
  /** Distance of every card: fine for the shortlist, coarse for the rest (indexed like `table.ids`). */
  distances: Uint8Array;
}

/**
 * Where in `img` (a pocket crop, luma integral) the card nominally sits is
 * `nominal` (fractions of the image, with the game's card aspect); the grid
 * is a few per cent off, so the card is searched around it coarse-to-fine:
 * every table entry against the coarse alignments, then the shortlist against
 * the fine ones. Probes are hashed with the table's artwork window.
 */
export function matchPocket(table: HashTable, img: LumaImage, nominal: HashWindow, opts: MatchPocketOptions = {}): PocketMatch {
  const k = opts.k ?? 8;
  const art = table.spec.art;
  const coarseWindows = alignmentProbes(nominal, opts.coarse ?? COARSE_PROBES);
  const coarse = coarseWindows.map((w) => hashCardIn(img, w, art));
  const distances = hashDistances(table, coarse);
  const shortlist = nearestByHash(table, coarse, opts.shortlist ?? SHORTLIST);
  // Per shortlisted card: its best distance over every probe, and the probe that gave it (where the card is).
  const windows = new Map<number, HashWindow>();
  if (shortlist.length) {
    const fineWindows = alignmentProbes(nominal, opts.fine ?? FINE_PROBES);
    const fine = fineWindows.map((w) => hashCardIn(img, w, art));
    for (const hit of shortlist) {
      const o = hit.index * HASH_WORDS;
      let best = Infinity;
      let at = nominal;
      for (let i = 0; i < coarse.length; i++) {
        const d = hammingDistance(table.words, coarse[i], o, 0);
        if (d < best) {
          best = d;
          at = coarseWindows[i];
        }
      }
      for (let i = 0; i < fine.length; i++) {
        const d = hammingDistance(table.words, fine[i], o, 0);
        if (d < best) {
          best = d;
          at = fineWindows[i];
        }
      }
      distances[hit.index] = best;
      windows.set(hit.index, at);
    }
  }
  const hits: HashHit[] = shortlist
    .map((h) => ({ ...h, distance: distances[h.index], window: windows.get(h.index) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .slice(0, k);
  return { hits, distances };
}

/* ---------- DOM helpers ---------- */

/** Pocket regions are resampled to about the reference images' size (~245×337, 268×391) before hashing. */
export const HASH_SAMPLE_WIDTH = 240;
/** A padded pocket crop (cell + 6 % margin) is sampled this wide, so the card in it is ≈ 245 px like a reference image. */
export const POCKET_SAMPLE_WIDTH = 272;

let hashCanvas: HTMLCanvasElement | null = null;

/**
 * Hash of `box` (source px) of `source`, resampled to `sampleWidth` wide with
 * the card's aspect and hashed with the artwork window `art` (default the
 * Pokémon one; pass the game's `HashSpec` values). `source` is anything
 * drawImage accepts (ImageBitmap, canvas, video, img).
 */
export function hashRegion(source: CanvasImageSource, box: Box, cardAspect = 63 / 88, sampleWidth = HASH_SAMPLE_WIDTH, art: HashWindow = ART_WINDOW): Uint32Array {
  const w = Math.max(HASH_GRID.cols, Math.round(sampleWidth));
  const h = Math.max(HASH_GRID.rows, Math.round(sampleWidth / cardAspect));
  hashCanvas ??= document.createElement('canvas');
  if (hashCanvas.width !== w) hashCanvas.width = w;
  if (hashCanvas.height !== h) hashCanvas.height = h;
  const ctx = hashCanvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, w, h);
  return hashCard(ctx.getImageData(0, 0, w, h).data, w, h, art);
}

/** `region` of `source` (source px) sampled `width` px wide as a luma integral, ready for `matchPocket`. */
export function samplePocketLuma(source: CanvasImageSource, region: Box, width = POCKET_SAMPLE_WIDTH): LumaImage {
  const img = sampleRgba(source, region, width);
  return lumaImage(img.data, img.width, img.height);
}

/** `inner` (source px, e.g. the pocket cell) as fractions of `outer` (the padded crop that was sampled). */
export function windowOf(inner: Box, outer: Box): HashWindow {
  return { x: (inner.x - outer.x) / outer.w, y: (inner.y - outer.y) / outer.h, w: inner.w / outer.w, h: inner.h / outer.h };
}
