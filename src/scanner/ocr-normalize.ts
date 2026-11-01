/**
 * Pure string/geometry helpers shared by the parser and the matcher.
 * No DOM, no catalog access: everything here is unit-testable in Node.
 */
import type { Box } from './types';

// ---------------------------------------------------------------------------
// Digits
// ---------------------------------------------------------------------------

/**
 * Characters OCR engines commonly emit instead of a digit on card print.
 * Observed with Tesseract on TCGdex scans: "O57" for 057, "1O2" for 102,
 * "S" for 5, "B" for 8. "D"/"Q" → 0 and "g" → 9 are rarer but cheap to allow
 * because every parsed number is validated against the catalog afterwards.
 */
export const DIGIT_CONFUSIONS: Readonly<Record<string, string>> = {
  O: '0', o: '0', D: '0', Q: '0',
  I: '1', l: '1', i: '1', '|': '1', '!': '1',
  S: '5', s: '5',
  B: '8',
  Z: '2', z: '2',
  G: '6', b: '6',
  g: '9', q: '9',
};

/**
 * Convert a token that should be all digits ("1O2", "O57") to digits.
 * Returns null when a character is neither a digit nor a known confusion,
 * or when the token has no real digit at all (so words like "Sol" or "IS"
 * never turn into numbers). `noisy` reports whether a substitution happened.
 */
export function toDigits(token: string): { digits: string; noisy: boolean } | null {
  let out = '';
  let noisy = false;
  let real = 0;
  for (const ch of token) {
    if (ch >= '0' && ch <= '9') {
      out += ch;
      real++;
    } else if (DIGIT_CONFUSIONS[ch] !== undefined) {
      out += DIGIT_CONFUSIONS[ch];
      noisy = true;
    } else return null;
  }
  return out && real > 0 ? { digits: out, noisy } : null;
}

/**
 * Letter prefixes that legitimately appear in collector numbers in the
 * catalog (counted over the 21k-card TCGdex snapshot: SWSH 307, SM 248,
 * XY 216, SV 216, TG 120, BW 101, GG 70, H 64, RC 57, DP 56, HGSS 25, CC 25,
 * SH 12, SL 11, AR 9, RT 6). Longest first so "SWSH" wins over "SH".
 */
export const NUMBER_PREFIXES: readonly string[] = [
  'HGSS', 'SWSH', 'TG', 'GG', 'SV', 'SM', 'XY', 'BW', 'RC', 'DP', 'CC', 'SH', 'SL', 'AR', 'RT', 'H',
];

/**
 * Canonical form of a collector number for comparisons:
 * upper-case letter prefix + digit part without leading zeros.
 * "057" → "57", "TG01" → "TG1", "sv001" → "SV1", "4" → "4", "000" → "0".
 * Non-numeric numbers ("A", "?") are returned upper-cased as-is.
 */
export function canonicalNum(num: string): string {
  const m = /^([A-Za-z]*)0*(\d+)([A-Za-z]?)$/.exec(num.trim());
  if (!m) return num.trim().toUpperCase();
  return `${m[1].toUpperCase()}${m[2]}${m[3].toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * Card-name suffix tokens after normalization. They are part of the card name
 * ("Pikachu ex" and "Pikachu" are different cards) but OCR often drops or
 * mangles them, so the matcher also indexes names without them.
 */
export const NAME_SUFFIXES: ReadonlySet<string> = new Set([
  'ex', 'gx', 'v', 'vmax', 'vstar', 'vunion', 'break', 'lvx', 'prime', 'legend', 'star',
]);

/**
 * Normalize a card name or an OCR line for comparison:
 * - strip diacritics ("Pokémon" → "pokemon"), lower-case;
 * - "€X"/"€x" (Tesseract reads the stylised "ex" logo as a euro sign) → "ex";
 * - ♀/♂ → " f"/" m" so "Nidoran♀" stays distinct from "Nidoran♂";
 * - ☆/★ → " star" so "Greninja ☆" is not an exact hit for a plain "Greninja" read;
 * - "'s" → "s" so "Professor's" ≈ "Professors" ≈ "Professor’s";
 * - joins split suffixes: "v max"/"v-max" → "vmax", "v star" → "vstar",
 *   "lv. x" → "lvx";
 * - everything else non-alphanumeric becomes a space; spaces collapsed.
 */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/€\s*[xX]/g, ' ex')
    .replace(/♀/g, ' f ')
    .replace(/♂/g, ' m ')
    .replace(/[☆★]/g, ' star ')
    .replace(/[’‘`´]/g, "'")
    .toLowerCase()
    .replace(/'s\b/g, 's')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\bv (max|star|union)\b/g, 'v$1')
    .replace(/\blv x\b/g, 'lvx');
}

/** `normalizeName` output with trailing suffix tokens removed ("charizard vmax" → "charizard"). */
export function baseName(norm: string): string {
  const parts = norm.split(' ');
  while (parts.length > 1 && NAME_SUFFIXES.has(parts[parts.length - 1])) parts.pop();
  return parts.join(' ');
}

/**
 * Optimal-string-alignment Damerau–Levenshtein distance, bounded: returns
 * `max + 1` as soon as the distance is known to exceed `max` (row-minimum
 * check), which keeps fuzzy name lookups cheap.
 */
export function boundedDamerau(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev2: number[] = new Array<number>(lb + 1).fill(0);
  let prev: number[] = Array.from({ length: lb + 1 }, (_, j) => j);
  let cur: number[] = new Array<number>(lb + 1).fill(0);
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[lb] <= max ? prev[lb] : max + 1;
}

/** Character trigrams of " s " (padded so short names still get grams). */
export function trigrams(s: string): string[] {
  const p = ` ${s} `;
  const out: string[] = [];
  for (let i = 0; i + 3 <= p.length; i++) out.push(p.slice(i, i + 3));
  return out;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Smallest box containing all `boxes` (zero box for an empty list). */
export function unionBox(boxes: readonly Box[]): Box {
  if (boxes.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Center point of a box. */
export function boxCenter(b: Box): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Intersection-over-union of two boxes, 0..1. */
export function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
}

/** True when point (x, y) lies inside `b`. */
export function containsPoint(b: Box, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

/** Median of a list (0 for empty). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
