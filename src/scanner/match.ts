/**
 * Pure matching of OCR observations against the catalog.
 *
 *   buildScanIndex(catalog)        once (≈100 ms for 21k cards in Node)
 *   matchObservations(obs, index)  per frame → one ScanCandidate per physical card
 *   scanLines(lines, index)        convenience: parseLines + matchObservations
 *
 * Pipeline per frame:
 *  1. Name hits: every OCR line is looked up (exact + trigram/Damerau fuzzy)
 *     against the ~4.5k unique normalized card names, over word windows.
 *  2. Grouping: lines are grouped into physical cards using anchors — the
 *     collector-number line (bottom-left of a card) and a prominent name line
 *     (top-left). A name above a number at the right distance forms a pair
 *     that fixes the card's scale; unpaired anchors estimate the card from
 *     their text height. Every other line joins the card whose box contains it.
 *  3. Scoring: candidates come from number+total, set code, and name; each is
 *     scored on all evidence in its group. See SCORE_* constants.
 *
 * Card geometry used below (measured on 600×825 TCGdex scans, SV/SWSH/Base):
 * the card is 2.5:3.5 (w = 0.714 h); the name line's centre is at ≈6% of the
 * height, its box 29–42 px tall (H/h ≈ 20–28); the number line's centre is at
 * ≈95% height, left edge ≈5% width, box 23–36 px tall (H/h ≈ 23–36);
 * body text ≈15–20 px.
 */
import type { Catalog, CatalogCard, CatalogSet } from '../data/types';
import type {
  Box,
  DexObservation,
  FrameObservations,
  HpObservation,
  NumberObservation,
  RecognizedLine,
  ScanAlternative,
  ScanCandidate,
  ScanMatcher,
  SetCodeObservation,
} from './types';
import {
  baseName,
  boundedDamerau,
  boxCenter,
  canonicalNum,
  containsPoint,
  median,
  normalizeName,
  trigrams,
  unionBox,
} from './ocr-normalize';
import { parseLines, type ParseContext } from './parse';

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

/** Precomputed lookup structures over the catalog. Build once, reuse. */
export interface ScanIndex {
  catalog: Catalog;
  setById: Map<string, CatalogSet>;
  /** official (printed denominator) → sets, newest first. Never contains 0. */
  setsByOfficial: Map<number, CatalogSet[]>;
  /** Upper-case printed code (base part before ":") → sets, newest first. */
  setsByAbbr: Map<string, CatalogSet[]>;
  /** `${setId}|${canonicalNum}` → card. */
  cardBySetNum: Map<string, CatalogCard>;
  /** Normalized full name → cards (all printings, newest set first). */
  cardsByName: Map<string, CatalogCard[]>;
  /** National Pokédex number → cards featuring that species, newest set first. */
  cardsByDex: Map<number, CatalogCard[]>;
  /** Normalized card name per card id (cached). */
  normNameById: Map<string, string>;
  /** Unique normalized full names; position = name id. */
  names: string[];
  /** Base name (suffix-stripped) → name ids. */
  namesByBase: Map<string, number[]>;
  /** Trigram → name ids (fuzzy candidate retrieval). */
  trigramIndex: Map<string, number[]>;
  /** 0 (oldest) .. 1 (newest) by release date; tie-breaker. */
  setRecency: Map<string, number>;
  /** Max number of words in any name (bounds the window search). */
  maxNameWords: number;
  parseContext: ParseContext;
}

export interface ScanIndexOptions {
  /**
   * Longest name (in words) the fuzzy lookup tries per line. Default 6: long
   * Pokémon names ("thought wave machine rocket s secret machine") are rare
   * and never OCR'd intact. Yu-Gi-Oh! uses 8 (names run to 11 words).
   */
  maxNameWords?: number;
}

/** Build the scan index. O(cards); ~100 ms for the full 21k-card catalog. */
export function buildScanIndex(catalog: Catalog, opts: ScanIndexOptions = {}): ScanIndex {
  const setById = new Map<string, CatalogSet>();
  for (const s of catalog.sets) setById.set(s.id, s);

  // Newest first; ties broken by id for determinism.
  const byNewest = [...catalog.sets].sort(
    (a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || '') || a.id.localeCompare(b.id),
  );
  const setRecency = new Map<string, number>();
  byNewest.forEach((s, i) => setRecency.set(s.id, byNewest.length > 1 ? 1 - i / (byNewest.length - 1) : 1));

  const setsByOfficial = new Map<number, CatalogSet[]>();
  const setsByAbbr = new Map<string, CatalogSet[]>();
  for (const s of byNewest) {
    if (s.official > 0) push(setsByOfficial, s.official, s);
    const abbr = s.abbr.split(':')[0].trim().toUpperCase();
    if (abbr) push(setsByAbbr, abbr, s);
  }

  const cardBySetNum = new Map<string, CatalogCard>();
  const cardsByName = new Map<string, CatalogCard[]>();
  const cardsByDex = new Map<number, CatalogCard[]>();
  const normNameById = new Map<string, string>();
  const rec = (c: CatalogCard) => setRecency.get(c.set) ?? 0;
  for (const c of catalog.cards) {
    cardBySetNum.set(`${c.set}|${canonicalNum(c.num)}`, c);
    const n = normalizeName(c.name);
    normNameById.set(c.id, n);
    if (n) push(cardsByName, n, c);
    if (c.dex) for (const d of c.dex) push(cardsByDex, d, c);
  }
  const newestFirst = (a: CatalogCard, b: CatalogCard) => rec(b) - rec(a) || a.id.localeCompare(b.id);
  for (const list of cardsByName.values()) list.sort(newestFirst);
  for (const list of cardsByDex.values()) list.sort(newestFirst);

  const names = [...cardsByName.keys()].sort();
  const namesByBase = new Map<string, number[]>();
  const trigramIndex = new Map<string, number[]>();
  let maxNameWords = 1;
  names.forEach((n, id) => {
    push(namesByBase, baseName(n), id);
    for (const g of new Set(trigrams(n))) push(trigramIndex, g, id);
    maxNameWords = Math.max(maxNameWords, n.split(' ').length);
  });

  return {
    catalog,
    setById,
    setsByOfficial,
    setsByAbbr,
    cardBySetNum,
    cardsByName,
    cardsByDex,
    normNameById,
    names,
    namesByBase,
    trigramIndex,
    setRecency,
    maxNameWords: Math.min(maxNameWords, opts.maxNameWords ?? 6),
    parseContext: {
      abbrs: new Set(setsByAbbr.keys()),
      knownTotals: new Set(setsByOfficial.keys()),
    },
  };
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}

/** All printings of a card name, newest first (for a "pick another printing" UI). */
export function printingsOf(name: string, index: ScanIndex): CatalogCard[] {
  return index.cardsByName.get(normalizeName(name)) ?? [];
}

// ---------------------------------------------------------------------------
// Name lookup
// ---------------------------------------------------------------------------

/** A catalog name found inside an OCR line. */
export interface NameHit {
  /** Normalized catalog name. */
  name: string;
  /** 0..1 string similarity of the matched window. */
  sim: number;
  /** Fraction of the line's letters/digits covered by the window, 0..1. */
  coverage: number;
}

/** Coverage credited to an exact name with one junk token glued to an edge (see findNames). */
const GLUED_JUNK_COVERAGE = 0.85;

/** Edit budget by length: short names must match exactly (too many near-collisions). */
function maxEdits(len: number): number {
  if (len <= 4) return 0;
  if (len <= 7) return 1;
  if (len <= 12) return 2;
  return 3;
}

/**
 * Look up catalog names inside one normalized OCR line. Tries every window of
 * 1..maxNameWords consecutive words: exact full name (sim 1), exact base name
 * with suffix lost (sim 0.9 — "Charizard €X" read as "charizard"), then fuzzy
 * via trigram retrieval + bounded Damerau–Levenshtein. Returns the best hit
 * per catalog name, best first.
 */
export function findNames(norm: string, index: ScanIndex, limit = 6): NameHit[] {
  const words = norm.split(' ').filter(Boolean);
  const totalChars = words.join('').length;
  if (totalChars === 0) return [];
  const best = new Map<string, NameHit>();
  const offer = (name: string, sim: number, windowChars: number, i: number, k: number) => {
    let coverage = Math.min(1, windowChars / totalChars);
    // The stage badge or HP is often glued to the name by OCR ("zest) Furret"
    // for "Stage 1 … Furret" on SWSH/SM cards, "Furret »110"). One junk token
    // at either edge of an exact or base-name hit must not make the name look
    // like a weak, rules-text-style match (measured: coverage 0.6 → strength
    // 0.69, below the 0.72 anchor floor, so the card was dropped entirely).
    if (sim >= 0.9 && coverage < GLUED_JUNK_COVERAGE) {
      const leading = i;
      const trailing = words.length - (i + k);
      if ((leading <= 1 && trailing === 0) || (leading === 0 && trailing <= 1)) coverage = GLUED_JUNK_COVERAGE;
    }
    const prev = best.get(name);
    if (!prev || sim + coverage * 0.01 > prev.sim + prev.coverage * 0.01) best.set(name, { name, sim, coverage });
  };
  for (let i = 0; i < words.length; i++) {
    for (let k = 1; k <= index.maxNameWords && i + k <= words.length; k++) {
      const win = words.slice(i, i + k).join(' ');
      const chars = win.replace(/ /g, '').length;
      if (chars < 3) continue;
      if (index.cardsByName.has(win)) offer(win, 1, chars, i, k);
      const base = index.namesByBase.get(win);
      if (base) for (const id of base) if (index.names[id] !== win) offer(index.names[id], 0.9, chars, i, k);
      const budget = maxEdits(win.length);
      if (budget === 0) continue;
      // Trigram retrieval: a candidate must share at least ~1/3 of the
      // window's trigrams, then pass the edit-distance bound.
      const grams = trigrams(win);
      const counts = new Map<number, number>();
      for (const g of grams) {
        const ids = index.trigramIndex.get(g);
        if (ids) for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      const need = Math.max(2, Math.floor(grams.length / 3));
      for (const [id, c] of counts) {
        if (c < need) continue;
        const cand = index.names[id];
        const d = boundedDamerau(win, cand, budget);
        if (d <= budget && d > 0) offer(cand, 1 - d / Math.max(win.length, cand.length), chars, i, k);
      }
    }
  }
  return [...best.values()]
    .sort((a, b) => b.sim * (0.6 + 0.4 * b.coverage) - a.sim * (0.6 + 0.4 * a.coverage) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Grouping lines into physical cards
// ---------------------------------------------------------------------------

/** Card aspect (w/h) of a standard TCG card, 63×88 mm. */
const CARD_ASPECT = 63 / 88;
/** Card height ÷ name-line box height (measured 20–28 on scans; boxes include junk). */
const H_PER_NAME_LINE = 22;
/**
 * Card height ÷ number-line box height. Boxes that include the set-code box
 * measured 23–36 (H/h ≈ 23–36); a bare "4/102" line measured 11 px (H/h ≈ 75).
 * 50 is the compromise; it is only used when no better scale is known.
 */
const H_PER_NUMBER_LINE = 50;
/**
 * Card height ÷ rules-text line height: the most reliable scale cue because
 * rules text is printed in one size on every card. Measured 41 (SV Wugtrio,
 * 20 px lines), 43 (Base Charizard, 19 px), 48 (Charizard ex, 17 px).
 */
const H_PER_RULES_LINE = 44;
/** A "rules text" line: confident, at least this many letters... */
const RULES_MIN_LETTERS = 12;
const RULES_MIN_CONFIDENCE = 0.75;
/** ...and at least this many words (so a long card name like "Professor's Research" isn't rules text). */
const RULES_MIN_WORDS = 4;
/** Vertical distance name-centre → number-centre as a fraction of card height (0.95 − 0.06). */
const NAME_TO_NUMBER = 0.89;
/** Minimum name strength for a line to anchor a card on its own. */
const NAME_ANCHOR_MIN = 0.72;

/** One physical card hypothesis in the frame. */
export interface CardGroup {
  /** Estimated outline of the card. */
  cardBox: Box;
  /** Indices into FrameObservations.lines. */
  lineIndices: number[];
  /** Line index of the name anchor, if any. */
  nameLine?: number;
  /** Line index of the number anchor, if any. */
  numberLine?: number;
}

interface NameLineInfo {
  lineIndex: number;
  hits: NameHit[];
  /** Strength of the best hit, 0..1, including coverage and text size. */
  strength: number;
}

/**
 * Name strength: similarity, discounted when the hit covers a small part of
 * the line (rules text such as "Evolves from Charmeleon") and when the text is
 * not larger than the frame's typical line (names are printed ~2× body size).
 */
export function nameStrength(hit: NameHit, lineH: number, medianH: number): number {
  const size = medianH > 0 ? Math.min(1, Math.max(0.6, lineH / medianH / 1.5)) : 1;
  return hit.sim * (0.55 + 0.45 * hit.coverage) * size;
}

/**
 * Card outline from a lone number line. Modern cards (BW era on) print the
 * number bottom-LEFT; older ones (Base Set "4/102") bottom-RIGHT. Both
 * placements are tried and the one covering more text lines wins (ties: left).
 */
function rectFromNumber(b: Box, H: number, lines: readonly RecognizedLine[]): Box {
  const W = H * CARD_ASPECT;
  const y = b.y + b.h / 2 + 0.05 * H - H;
  const left: Box = { x: b.x - 0.06 * W, y, w: W, h: H };
  const right: Box = { x: b.x + b.w + 0.06 * W - W, y, w: W, h: H };
  const count = (r: Box) =>
    lines.reduce((n, l) => {
      const c = boxCenter(l.bbox);
      return n + (containsPoint(r, c.x, c.y) ? 1 : 0);
    }, 0);
  return count(right) > count(left) ? right : left;
}

function rectFromName(b: Box, H: number): Box {
  const W = H * CARD_ASPECT;
  const cy = b.y + b.h / 2;
  // Name starts 3–25% from the left edge (after the stage badge); use 12%.
  return { x: b.x - 0.12 * W, y: cy - 0.06 * H, w: W, h: H };
}

/**
 * Card outline from a lone Pokédex line ("NO. 0204 …"): it runs under the
 * artwork, centred ~0.55 of the card height down (SV) / ~0.48 (SWSH), and
 * starts ~10% in from the left edge.
 */
function rectFromDex(b: Box, H: number): Box {
  const W = H * CARD_ASPECT;
  const cy = b.y + b.h / 2;
  return { x: b.x - 0.1 * W, y: cy - 0.52 * H, w: W, h: H };
}

function grow(b: Box, f: number): Box {
  return { x: b.x - b.w * f, y: b.y - b.h * f, w: b.w * (1 + 2 * f), h: b.h * (1 + 2 * f) };
}

/**
 * Group the frame's lines into physical cards (see file header). Exported for
 * tests. Deterministic: anchors are processed in a fixed, sorted order.
 */
export function groupCards(obs: FrameObservations, nameInfo: Map<number, NameLineInfo>): CardGroup[] {
  const lines = obs.lines;
  // Frame-wide scale from rules text (cards in one frame are at a similar
  // distance); 0 when there is no such text. Median, because Tesseract
  // sometimes merges two rows into one tall box (36 px on Charizard ex).
  const rulesH = median(
    lines
      .filter(
        (l) =>
          l.confidence >= RULES_MIN_CONFIDENCE &&
          (l.text.match(/[A-Za-z]/g) ?? []).length >= RULES_MIN_LETTERS &&
          (l.text.match(/[A-Za-z]{2,}/g) ?? []).length >= RULES_MIN_WORDS,
      )
      .map((l) => l.bbox.h),
  );
  const rulesCardH = rulesH * H_PER_RULES_LINE;
  const numberLines = [...new Set(obs.numbers.map((n) => n.lineIndex))].sort((a, b) => a - b);
  const nameLines = [...nameInfo.values()]
    .filter((n) => n.strength >= NAME_ANCHOR_MIN)
    .sort((a, b) => b.strength - a.strength || a.lineIndex - b.lineIndex);

  // 1) Pairs: a name above a number at a distance consistent with the text
  //    scale, number at the card's left edge (modern) or right edge (old).
  type Pair = { name: number; num: number; H: number; x: number; cost: number };
  const pairs: Pair[] = [];
  for (const nm of nameLines) {
    const a = lines[nm.lineIndex].bbox;
    for (const ni of numberLines) {
      if (ni === nm.lineIndex) continue;
      const b = lines[ni].bbox;
      const dy = b.y + b.h / 2 - (a.y + a.h / 2);
      if (dy <= 0) continue;
      const H = dy / NAME_TO_NUMBER;
      const hEst = rulesCardH || (a.h * H_PER_NAME_LINE + b.h * H_PER_NUMBER_LINE) / 2;
      const ratio = H / hEst;
      if (ratio < 0.5 || ratio > 2) continue;
      const W = H * CARD_ASPECT;
      const dxL = b.x - a.x; // number left edge vs name left edge (modern)
      const dxR = b.x + b.w - a.x; // number right edge vs name left edge (old)
      let x: number;
      let off: number;
      if (dxL >= -0.4 * W && dxL <= 0.15 * W) {
        x = Math.min(b.x - 0.06 * W, a.x - 0.12 * W);
        off = Math.abs(dxL) / W;
      } else if (dxR >= 0.6 * W && dxR <= 1.0 * W) {
        x = b.x + b.w + 0.06 * W - W;
        off = Math.abs(dxR / W - 0.85) + 0.05; // slight preference for modern layout
      } else continue;
      pairs.push({ name: nm.lineIndex, num: ni, H, x, cost: Math.abs(Math.log(ratio)) + off - nm.strength });
    }
  }
  pairs.sort((p, q) => p.cost - q.cost || p.num - q.num || p.name - q.name);

  const groups: CardGroup[] = [];
  const used = new Set<number>();
  for (const p of pairs) {
    if (used.has(p.name) || used.has(p.num)) continue;
    used.add(p.name);
    used.add(p.num);
    const top = lines[p.name].bbox.y + lines[p.name].bbox.h / 2 - 0.06 * p.H;
    groups.push({
      cardBox: { x: p.x, y: top, w: p.H * CARD_ASPECT, h: p.H },
      lineIndices: [],
      nameLine: p.name,
      numberLine: p.num,
    });
  }

  // Scale learned from pairs beats the rules-text estimate, which beats the
  // per-anchor text-height estimate (name/number boxes often include junk).
  const frameH = median(groups.map((g) => g.cardBox.h)) || rulesCardH;
  const scaleFor = (own: number) => frameH || own;
  const inExisting = (li: number) => {
    const c = boxCenter(lines[li].bbox);
    return groups.some((g) => containsPoint(g.cardBox, c.x, c.y));
  };

  // 2) Unpaired numbers, then 3) unpaired names — unless they fall inside a
  //    card already found (e.g. "Evolves from Charmeleon" inside a card).
  for (const ni of numberLines) {
    if (used.has(ni) || inExisting(ni)) continue;
    used.add(ni);
    const H = scaleFor(lines[ni].bbox.h * H_PER_NUMBER_LINE);
    groups.push({ cardBox: rectFromNumber(lines[ni].bbox, H, lines), lineIndices: [], numberLine: ni });
  }
  for (const nm of nameLines) {
    if (used.has(nm.lineIndex) || inExisting(nm.lineIndex)) continue;
    used.add(nm.lineIndex);
    const H = scaleFor(lines[nm.lineIndex].bbox.h * H_PER_NAME_LINE);
    groups.push({ cardBox: rectFromName(lines[nm.lineIndex].bbox, H), lineIndices: [], nameLine: nm.lineIndex });
  }
  // 3b) A Pokédex line with no name or number nearby still marks a card
  //     (stylised names and tiny numbers are what OCR loses first).
  for (const d of obs.dexes) {
    if (used.has(d.lineIndex) || inExisting(d.lineIndex)) continue;
    used.add(d.lineIndex);
    // The Pokédex line is printed at rules-text size.
    const H = scaleFor(lines[d.lineIndex].bbox.h * H_PER_RULES_LINE);
    groups.push({ cardBox: rectFromDex(lines[d.lineIndex].bbox, H), lineIndices: [] });
  }

  // 4) Assign every other line to the card whose (5%-grown) outline contains
  //    its centre; if several do (overlapping estimates), the nearest centre.
  lines.forEach((l, i) => {
    const own = groups.find((gr) => gr.nameLine === i || gr.numberLine === i);
    if (own) {
      own.lineIndices.push(i);
      return;
    }
    const c = boxCenter(l.bbox);
    let best: CardGroup | undefined;
    let bestD = Infinity;
    for (const gr of groups) {
      if (!containsPoint(grow(gr.cardBox, 0.05), c.x, c.y)) continue;
      const gc = boxCenter(gr.cardBox);
      const d = Math.hypot((c.x - gc.x) / gr.cardBox.w, (c.y - gc.y) / gr.cardBox.h);
      if (d < bestD) {
        bestD = d;
        best = gr;
      }
    }
    best?.lineIndices.push(i);
  });
  return groups;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/*
 * Raw evidence weights. Raw sum / SCORE_FULL, clamped, is the 0..1 score.
 * Typical outcomes (full catalog):
 *   number+total+name ...................... 0.95 → 1.00
 *   number+total+set code .................. 0.80 → 0.94
 *   number+near-total+name (190/195 read) .. 0.80 → 0.94
 *   number+total only ...................... 0.55 → 0.65 (ties across same-size sets → low margin)
 *   name + HP .............................. 0.48 → 0.56 (many printings → low margin)
 *   name only .............................. 0.38 → 0.45
 */
const SCORE_NUM = { clean: 0.3, noisy: 0.24, loose: 0.16 } as const;
const SCORE_TOTAL = 0.25;
/** Total read with one wrong digit (e.g. 198 → 195); only counts when the number also matches. */
const SCORE_TOTAL_NEAR = 0.1;
const SCORE_ABBR = [0.2, 0.1] as const; // by distance 0 / 1
const SCORE_NAME = 0.4;
/** Pokédex number on the card's Pokédex line: identifies the species as surely as the name. */
const SCORE_DEX = 0.3;
const SCORE_HP = { explicit: 0.1, loose: 0.06 } as const;
/** Newest printing wins ties (most scans are of recent cards). */
const SCORE_RECENCY = 0.02;
const SCORE_FULL = 0.85;
/**
 * Groups whose best card scores below this are dropped (noise). A name-only
 * hit with a glued badge and no HP scores ~0.39 (0.4 × 0.78 strength + recency),
 * and the UI never auto-adds, so 0.35 keeps those visible as low-confidence chips.
 */
const MIN_SCORE = 0.35;
/** `confident` thresholds. */
const CONFIDENT_SCORE = 0.75;
const CONFIDENT_MARGIN = 0.1;
const MAX_ALTERNATIVES = 12;
/** Cap on printings pulled in per name hit (popular names have 100+). */
const MAX_PRINTINGS_PER_NAME = 60;

/** Same length, exactly one differing digit. */
function nearTotal(a: number, b: number): boolean {
  const sa = String(a);
  const sb = String(b);
  if (sa.length !== sb.length || sa === sb) return false;
  let d = 0;
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) d++;
  return d === 1;
}

interface GroupEvidence {
  numbers: NumberObservation[];
  codes: SetCodeObservation[];
  hps: HpObservation[];
  dexes: DexObservation[];
  /** name → weighted strength (best over lines in the group). */
  names: Map<string, { strength: number; raw: string }>;
}

function collectEvidence(
  group: CardGroup,
  obs: FrameObservations,
  nameInfo: Map<number, NameLineInfo>,
  medianH: number,
): GroupEvidence {
  const inGroup = new Set(group.lineIndices);
  const cb = group.cardBox;
  const relY = (b: Box) => (b.y + b.h / 2 - cb.y) / cb.h;
  const relX = (b: Box) => (b.x + b.w / 2 - cb.x) / cb.w;
  const nameBox = group.nameLine !== undefined ? obs.lines[group.nameLine].bbox : undefined;
  const names = new Map<string, { strength: number; raw: string }>();
  for (const li of group.lineIndices) {
    const info = nameInfo.get(li);
    if (!info) continue;
    const b = obs.lines[li].bbox;
    // Names live in the top ~15% of the card; elsewhere (rules text, flavour)
    // a Pokémon name is weak evidence.
    const pos = li === group.nameLine || relY(b) < 0.15 ? 1 : 0.35;
    for (const h of info.hits) {
      const s = nameStrength(h, b.h, medianH) * pos;
      const prev = names.get(h.name);
      if (!prev || s > prev.strength) names.set(h.name, { strength: s, raw: obs.lines[li].text });
    }
  }
  return {
    numbers: obs.numbers.filter((n) => inGroup.has(n.lineIndex)),
    dexes: obs.dexes.filter((d) => inGroup.has(d.lineIndex)),
    // Set codes are printed next to the number at the bottom.
    codes: obs.setCodes.filter((c) => inGroup.has(c.lineIndex) && (c.lineIndex === group.numberLine || relY(c.bbox) > 0.8)),
    // HP is printed on the name's row, to its right. Relative to the name
    // line this is scale-independent (the card outline may be off by ±25%);
    // without a name line, fall back to the card outline: explicit HP in the
    // top quarter, loose HP (bare "90") top 15% and right half — attack damage
    // like "30" sits mid-card and must not count.
    hps: obs.hps.filter((h) => {
      if (nameBox) {
        const dy = Math.abs(h.bbox.y + h.bbox.h / 2 - (nameBox.y + nameBox.h / 2));
        const right = h.bbox.x >= nameBox.x + nameBox.w * 0.5 && h.bbox.x <= nameBox.x + cb.w;
        if (h.lineIndex === group.nameLine || (right && dy <= Math.max(nameBox.h, h.bbox.h))) return true;
      }
      if (!inGroup.has(h.lineIndex)) return false;
      return h.explicit ? relY(h.bbox) < 0.25 : relY(h.bbox) < 0.15 && relX(h.bbox) > 0.5;
    }),
    names,
  };
}

interface Scored {
  card: CatalogCard;
  set: CatalogSet;
  raw: number;
  evidence: string[];
}

function scoreCard(card: CatalogCard, set: CatalogSet, ev: GroupEvidence, index: ScanIndex): Scored {
  let raw = 0;
  const evidence: string[] = [];
  const canon = canonicalNum(card.num);

  // Number (+ total): best single number observation.
  let numPart = 0;
  let numEv = '';
  for (const n of ev.numbers) {
    if (n.num !== canon) continue;
    let s = SCORE_NUM[n.quality];
    let e = `number ${n.num}`;
    if (n.total !== undefined) {
      if (n.total === set.official) {
        s += SCORE_TOTAL;
        e += `/${n.total}`;
      } else if (set.official > 0 && nearTotal(n.total, set.official)) {
        s += SCORE_TOTAL_NEAR;
        e += `/${n.total}≈${set.official}`;
      } else if (n.totalPrefix && canon.startsWith(n.totalPrefix)) {
        // "TG05/TG30": subset numbering, the total is not set.official.
        s += SCORE_TOTAL_NEAR;
        e += `/${n.totalPrefix}${n.total}`;
      }
    }
    if (s > numPart) {
      numPart = s;
      numEv = e;
    }
  }
  if (numPart) {
    raw += numPart;
    evidence.push(numEv);
  }

  const abbr = set.abbr.split(':')[0].trim().toUpperCase();
  if (abbr) {
    const c = ev.codes.filter((x) => x.abbr === abbr).sort((a, b) => a.distance - b.distance)[0];
    if (c) {
      raw += SCORE_ABBR[c.distance];
      evidence.push(`set ${c.code}${c.distance ? `≈${abbr}` : ''}`);
    }
  }

  const norm = index.normNameById.get(card.id) ?? normalizeName(card.name);
  const nm = ev.names.get(norm);
  if (nm) {
    raw += SCORE_NAME * nm.strength;
    evidence.push(`name "${nm.raw.trim()}"`);
  }

  if (card.dex) {
    const d = ev.dexes.find((x) => card.dex!.includes(x.dex));
    if (d) {
      raw += SCORE_DEX;
      evidence.push(`dex #${d.dex}`);
    }
  }

  if (card.hp !== undefined) {
    const h = ev.hps.filter((x) => x.hp === card.hp).sort((a, b) => Number(b.explicit) - Number(a.explicit))[0];
    if (h) {
      raw += h.explicit ? SCORE_HP.explicit : SCORE_HP.loose;
      evidence.push(`HP ${h.hp}`);
    }
  }

  raw += SCORE_RECENCY * (index.setRecency.get(set.id) ?? 0);
  return { card, set, raw, evidence };
}

function candidatePool(ev: GroupEvidence, index: ScanIndex): Map<string, CatalogCard> {
  const pool = new Map<string, CatalogCard>();
  const add = (c: CatalogCard | undefined) => {
    if (c) pool.set(c.id, c);
  };
  for (const n of ev.numbers) {
    const sets = new Set<CatalogSet>();
    if (n.total !== undefined) {
      for (const s of index.setsByOfficial.get(n.total) ?? []) sets.add(s);
      // One-digit-off totals (OCR misread) — the number must still match.
      for (const [off, list] of index.setsByOfficial) if (nearTotal(off, n.total)) for (const s of list) sets.add(s);
    }
    for (const c of ev.codes) for (const s of index.setsByAbbr.get(c.abbr) ?? []) sets.add(s);
    if (n.totalPrefix) {
      // Subset numbering (TG/GG/SV): search every set; cheap, few sets have them.
      for (const s of index.catalog.sets) sets.add(s);
    }
    for (const s of sets) add(index.cardBySetNum.get(`${s.id}|${n.num}`));
  }
  for (const [name] of ev.names) {
    for (const c of (index.cardsByName.get(name) ?? []).slice(0, MAX_PRINTINGS_PER_NAME)) add(c);
  }
  for (const d of ev.dexes) {
    for (const c of (index.cardsByDex.get(d.dex) ?? []).slice(0, MAX_PRINTINGS_PER_NAME)) add(c);
  }
  return pool;
}

function scoreOf(raw: number): number {
  return Math.max(0, Math.min(1, raw / SCORE_FULL));
}

/**
 * Turn one frame's observations into ranked candidates, one per physical card.
 * Pure and deterministic.
 */
export function matchObservations(obs: FrameObservations, index: ScanIndex): ScanCandidate[] {
  const medianH = median(obs.lines.map((l) => l.bbox.h));
  const nameInfo = new Map<number, NameLineInfo>();
  for (const n of obs.names) {
    const hits = findNames(n.norm, index);
    if (hits.length === 0) continue;
    const strength = nameStrength(hits[0], obs.lines[n.lineIndex].bbox.h, medianH);
    nameInfo.set(n.lineIndex, { lineIndex: n.lineIndex, hits, strength });
  }

  const groups = groupCards(obs, nameInfo);
  const out: ScanCandidate[] = [];
  for (const g of groups) {
    const ev = collectEvidence(g, obs, nameInfo, medianH);
    const pool = candidatePool(ev, index);
    const scored: Scored[] = [];
    for (const card of pool.values()) {
      const set = index.setById.get(card.set);
      if (set) scored.push(scoreCard(card, set, ev, index));
    }
    if (scored.length === 0) continue;
    scored.sort((a, b) => b.raw - a.raw || a.card.id.localeCompare(b.card.id));
    const best = scored[0];
    const score = scoreOf(best.raw);
    if (score < MIN_SCORE) continue;
    const alternatives: ScanAlternative[] = scored.slice(1, 1 + MAX_ALTERNATIVES).map((s) => ({
      card: s.card,
      set: s.set,
      score: scoreOf(s.raw),
      evidence: s.evidence,
    }));
    const margin = score - (alternatives[0]?.score ?? 0);
    // bbox = union of the lines that produced evidence for the best card.
    const contributing = new Set<number>();
    if (g.nameLine !== undefined) contributing.add(g.nameLine);
    if (g.numberLine !== undefined) contributing.add(g.numberLine);
    for (const n of ev.numbers) contributing.add(n.lineIndex);
    for (const d of ev.dexes) if (best.card.dex?.includes(d.dex)) contributing.add(d.lineIndex);
    out.push({
      key: best.card.id,
      card: best.card,
      set: best.set,
      score,
      margin,
      confident: score >= CONFIDENT_SCORE && margin >= CONFIDENT_MARGIN,
      evidence: best.evidence,
      bbox: unionBox([...contributing].map((i) => obs.lines[i].bbox)),
      cardBox: g.cardBox,
      alternatives,
    });
  }
  // Reading order (rows of cards, then left to right) for a stable chip order.
  const rowH = median(out.map((c) => c.cardBox.h)) * 0.75 || 1;
  const row = (c: ScanCandidate) => Math.floor((c.cardBox.y + c.cardBox.h / 2) / rowH);
  out.sort((a, b) => row(a) - row(b) || a.cardBox.x - b.cardBox.x || a.key.localeCompare(b.key));
  return out;
}

/** parseLines + matchObservations in one call. */
export function scanLines(lines: readonly RecognizedLine[], index: ScanIndex): ScanCandidate[] {
  return matchObservations(parseLines(lines, index.parseContext), index);
}

/** The Pokémon TCG matcher: this file's pipeline over an index built once. */
export function createPokemonMatcher(catalog: Catalog): ScanMatcher {
  const index = buildScanIndex(catalog);
  return { game: 'pokemon', scanLines: (lines) => scanLines(lines, index) };
}
