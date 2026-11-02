/**
 * Yu-Gi-Oh! matcher: observations (parse.ts) → one ScanCandidate per card.
 *
 * Reuses the Pokémon index for what is game-neutral (name lookup with
 * trigram + edit-distance fuzziness, set recency) and adds passcode and
 * printed-code lookups, which are exact identifiers:
 *   passcode → the card (all its printings), code → the printing.
 *
 * Card geometry (fractions of the card height H; card is 59×86 mm, w = 0.686 h;
 * measured on 813×1185 renders): name centre 0.08 H (text ≈ H/22), set code
 * centre 0.725 H right-aligned at 0.905 W (≈ H/55), type line 0.77 H
 * (Spell/Trap: 0.145 H), ATK/DEF centre 0.925 H right-aligned at 0.92 W
 * (≈ H/45), passcode centre 0.962 H from 0.04 W (≈ H/60), rules text ≈ H/55.
 */
import type { Catalog, CatalogCard, CatalogSet } from '../../data/types';
import { buildScanIndex, findNames, nameStrength, type NameHit, type ScanIndex } from '../match';
import { normalizeName } from '../ocr-normalize';
import { boxCenter, containsPoint, median, unionBox } from '../ocr-normalize';
import type { Box, RecognizedLine, ScanAlternative, ScanCandidate, ScanMatcher } from '../types';
import { parseYgoLines, type YgoFrameObservations, type YgoParseContext } from './parse';

export interface YgoScanIndex {
  base: ScanIndex;
  /** Passcode (main or alternate art) → printings, newest first. */
  byPasscode: Map<number, CatalogCard[]>;
  /** Wildcard keys ("4698_414") → passcodes, for one-digit-off reads. */
  passcodeWild: Map<string, number[]>;
  /** Printed code → printings (normally one; a few codes were printed on two cards). */
  byCode: Map<string, CatalogCard[]>;
  /** Code prefix → codes, for one-character-off reads. */
  codesByPrefix: Map<string, string[]>;
  parseContext: YgoParseContext;
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}

function wildKeys(digits: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < digits.length; i++) out.push(digits.slice(0, i) + '_' + digits.slice(i + 1));
  return out;
}

/** Build the index. O(printings); ~150 ms for the full 38k-printing catalog. */
export function buildYgoScanIndex(catalog: Catalog): YgoScanIndex {
  const base = buildScanIndex(catalog, { maxNameWords: 8 });
  const byPasscode = new Map<number, CatalogCard[]>();
  const byCode = new Map<string, CatalogCard[]>();
  const codesByPrefix = new Map<string, string[]>();
  const rec = (c: CatalogCard) => base.setRecency.get(c.set) ?? 0;
  for (const c of catalog.cards) {
    if (c.pc !== undefined) {
      push(byPasscode, c.pc, c);
      if (c.alt) for (const a of c.alt) push(byPasscode, a, c);
    }
    const code = c.num.toUpperCase();
    push(byCode, code, c);
  }
  const newestFirst = (a: CatalogCard, b: CatalogCard) => rec(b) - rec(a) || a.id.localeCompare(b.id);
  for (const list of byPasscode.values()) list.sort(newestFirst);
  const passcodeWild = new Map<string, number[]>();
  for (const pc of byPasscode.keys()) {
    const d = String(pc).padStart(8, '0');
    for (const k of wildKeys(d)) push(passcodeWild, k, pc);
  }
  for (const code of byCode.keys()) push(codesByPrefix, code.split('-')[0], code);
  return {
    base,
    byPasscode,
    passcodeWild,
    byCode,
    codesByPrefix,
    parseContext: {
      passcodes: new Set(byPasscode.keys()),
      codes: new Set(byCode.keys()),
      prefixes: new Set(codesByPrefix.keys()),
    },
  };
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

const CARD_ASPECT = 59 / 86;
const H_PER_NAME = 22;
const H_PER_CODE = 55;
const H_PER_STATS = 45;
const H_PER_PASSCODE = 60;
const H_PER_RULES = 55;
const RULES_MIN_LETTERS = 12;
const RULES_MIN_WORDS = 4;
const RULES_MIN_CONFIDENCE = 0.75;
const NAME_ANCHOR_MIN = 0.72;

interface Group {
  cardBox: Box;
  lineIndices: number[];
  anchor: 'passcode' | 'code' | 'stats' | 'name';
  anchorLine: number;
}

interface NameLineInfo {
  lineIndex: number;
  hits: NameHit[];
  strength: number;
}

const rectFrom = {
  passcode(b: Box, H: number): Box {
    const W = H * CARD_ASPECT;
    return { x: b.x - 0.04 * W, y: b.y + b.h / 2 - 0.962 * H, w: W, h: H };
  },
  code(b: Box, H: number): Box {
    const W = H * CARD_ASPECT;
    return { x: b.x + b.w + 0.095 * W - W, y: b.y + b.h / 2 - 0.725 * H, w: W, h: H };
  },
  stats(b: Box, H: number): Box {
    const W = H * CARD_ASPECT;
    return { x: b.x + b.w + 0.08 * W - W, y: b.y + b.h / 2 - 0.925 * H, w: W, h: H };
  },
  name(b: Box, H: number): Box {
    const W = H * CARD_ASPECT;
    return { x: b.x - 0.076 * W, y: b.y + b.h / 2 - 0.08 * H, w: W, h: H };
  },
};

function grow(b: Box, f: number): Box {
  return { x: b.x - b.w * f, y: b.y - b.h * f, w: b.w * (1 + 2 * f), h: b.h * (1 + 2 * f) };
}

/**
 * Group lines into physical cards. Anchors in order of reliability: passcode
 * lines, printed-code lines, ATK/DEF lines, strong name lines. Each anchor
 * outside every card found so far opens a new card outline; every other line
 * joins the card whose outline contains its centre.
 */
export function groupYgoCards(obs: YgoFrameObservations, nameInfo: Map<number, NameLineInfo>): Group[] {
  const lines = obs.lines;
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
  const frameH = rulesH * H_PER_RULES;
  const scaleFor = (own: number) => frameH || own;
  const groups: Group[] = [];
  const used = new Set<number>();
  const inExisting = (li: number) => {
    const c = boxCenter(lines[li].bbox);
    return groups.some((g) => containsPoint(grow(g.cardBox, 0.05), c.x, c.y));
  };
  const open = (li: number, anchor: Group['anchor'], perLine: number) => {
    if (used.has(li) || inExisting(li)) return;
    used.add(li);
    const b = lines[li].bbox;
    groups.push({ cardBox: rectFrom[anchor](b, scaleFor(b.h * perLine)), lineIndices: [], anchor, anchorLine: li });
  };
  for (const p of obs.passcodes) open(p.lineIndex, 'passcode', H_PER_PASSCODE);
  for (const c of obs.codes) open(c.lineIndex, 'code', H_PER_CODE);
  for (const s of obs.stats) open(s.lineIndex, 'stats', H_PER_STATS);
  const names = [...nameInfo.values()].filter((n) => n.strength >= NAME_ANCHOR_MIN).sort((a, b) => b.strength - a.strength || a.lineIndex - b.lineIndex);
  for (const n of names) open(n.lineIndex, 'name', H_PER_NAME);

  lines.forEach((l, i) => {
    const own = groups.find((g) => g.anchorLine === i);
    if (own) {
      own.lineIndices.push(i);
      return;
    }
    const c = boxCenter(l.bbox);
    let best: Group | undefined;
    let bestD = Infinity;
    for (const g of groups) {
      if (!containsPoint(grow(g.cardBox, 0.05), c.x, c.y)) continue;
      const gc = boxCenter(g.cardBox);
      const d = Math.hypot((c.x - gc.x) / g.cardBox.w, (c.y - gc.y) / g.cardBox.h);
      if (d < bestD) {
        bestD = d;
        best = g;
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
 * Raw weights; raw / SCORE_FULL clamped to 0..1 is the score.
 *   passcode + code .................. ≥1.0 (the printing, beyond doubt)
 *   code + name / code + ATK/DEF ..... 0.95 / 0.82
 *   passcode alone ................... 0.73 (card known, printing not: all printings tie → "?")
 *   code alone ....................... 0.71 ("?" — one misread character would pick a neighbour)
 *   name + ATK/DEF + type ............ 0.65; name alone 0.47
 */
const SCORE_PASSCODE = 0.6;
const SCORE_PASSCODE_NEAR = 0.35;
const SCORE_CODE = 0.6;
const SCORE_CODE_NEAR = 0.3;
const SCORE_NAME = 0.4;
const SCORE_STATS_BOTH = 0.1;
const SCORE_STATS_ONE = 0.05;
const SCORE_KIND = 0.05;
const SCORE_RECENCY = 0.02;
const SCORE_FULL = 0.85;
const MIN_SCORE = 0.35;
const CONFIDENT_SCORE = 0.75;
const CONFIDENT_MARGIN = 0.1;
const MAX_ALTERNATIVES = 12;
const MAX_PRINTINGS_PER_NAME = 60;

interface Evidence {
  passcodes: { pc: number; near: boolean; lineIndex: number }[];
  codes: { code: string; near: boolean; lineIndex: number }[];
  stats: YgoFrameObservations['stats'];
  kinds: string[];
  names: Map<string, { strength: number; raw: string }>;
}

function hamming1(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length && d <= 1; i++) if (a[i] !== b[i]) d++;
  return d === 1;
}

function collectEvidence(g: Group, obs: YgoFrameObservations, nameInfo: Map<number, NameLineInfo>, medianH: number, index: YgoScanIndex): Evidence {
  const inGroup = new Set(g.lineIndices);
  const cb = g.cardBox;
  const relY = (b: Box) => (b.y + b.h / 2 - cb.y) / cb.h;
  const ev: Evidence = { passcodes: [], codes: [], stats: [], kinds: [], names: new Map() };

  for (const p of obs.passcodes) {
    if (!inGroup.has(p.lineIndex)) continue;
    const pc = Number(p.digits);
    if (p.known) ev.passcodes.push({ pc, near: false, lineIndex: p.lineIndex });
    else {
      const near = new Set<number>();
      for (const k of wildKeys(p.digits)) for (const c of index.passcodeWild.get(k) ?? []) near.add(c);
      for (const c of near) ev.passcodes.push({ pc: c, near: true, lineIndex: p.lineIndex });
    }
  }
  for (const c of obs.codes) {
    if (!inGroup.has(c.lineIndex)) continue;
    if (c.known) ev.codes.push({ code: c.code, near: false, lineIndex: c.lineIndex });
    else {
      for (const cand of index.codesByPrefix.get(c.prefix) ?? []) {
        if (hamming1(cand, c.code)) ev.codes.push({ code: cand, near: true, lineIndex: c.lineIndex });
      }
    }
  }
  // ATK/DEF sit in the bottom fifth; anything higher is rules text quoting stats.
  ev.stats = obs.stats.filter((s) => inGroup.has(s.lineIndex) && relY(s.bbox) > 0.78);
  for (const k of obs.kinds) if (inGroup.has(k.lineIndex)) ev.kinds.push(...k.words.map((w) => w.toLowerCase()));
  for (const li of g.lineIndices) {
    const info = nameInfo.get(li);
    if (!info) continue;
    const b = obs.lines[li].bbox;
    // Names live in the top ~15% of the card; a name quoted in rules text is weak evidence.
    const pos = li === g.anchorLine && g.anchor === 'name' ? 1 : relY(b) < 0.15 ? 1 : 0.35;
    for (const h of info.hits) {
      const s = nameStrength(h, b.h, medianH) * pos;
      const prev = ev.names.get(h.name);
      if (!prev || s > prev.strength) ev.names.set(h.name, { strength: s, raw: obs.lines[li].text });
    }
  }
  return ev;
}

interface Scored {
  card: CatalogCard;
  set: CatalogSet;
  raw: number;
  evidence: string[];
  lines: number[];
}

function scoreCard(card: CatalogCard, set: CatalogSet, ev: Evidence, index: YgoScanIndex): Scored {
  let raw = 0;
  const evidence: string[] = [];
  const lines: number[] = [];

  const pcs = new Set<number>([card.pc ?? -1, ...(card.alt ?? [])]);
  const pcHit = ev.passcodes.filter((p) => pcs.has(p.pc)).sort((a, b) => Number(a.near) - Number(b.near))[0];
  if (pcHit) {
    raw += pcHit.near ? SCORE_PASSCODE_NEAR : SCORE_PASSCODE;
    evidence.push(`passcode ${pcHit.near ? '≈' : ''}${pcHit.pc}`);
    lines.push(pcHit.lineIndex);
  }

  const code = card.num.toUpperCase();
  const codeHit = ev.codes.filter((c) => c.code === code).sort((a, b) => Number(a.near) - Number(b.near))[0];
  if (codeHit) {
    raw += codeHit.near ? SCORE_CODE_NEAR : SCORE_CODE;
    evidence.push(`code ${codeHit.near ? '≈' : ''}${code}`);
    lines.push(codeHit.lineIndex);
  }

  const nm = ev.names.get(index.base.normNameById.get(card.id) ?? normalizeName(card.name));
  if (nm) {
    raw += SCORE_NAME * nm.strength;
    evidence.push(`name "${nm.raw.trim()}"`);
  }

  if (card.atk !== undefined || card.def !== undefined) {
    let best = 0;
    let e = '';
    for (const s of ev.stats) {
      const atkOk = s.atk !== undefined && s.atk === card.atk;
      const defOk = s.def !== undefined && s.def === card.def;
      const linkOk = s.link !== undefined && card.frame === 'link' && s.link === card.lv;
      const v = (atkOk && (defOk || linkOk)) ? SCORE_STATS_BOTH : atkOk || defOk || linkOk ? SCORE_STATS_ONE : 0;
      if (v > best) {
        best = v;
        e = s.link !== undefined ? `ATK ${s.atk ?? '?'} LINK-${s.link}` : `ATK/DEF ${s.atk ?? '?'}/${s.def ?? '?'}`;
      }
    }
    if (best) {
      raw += best;
      evidence.push(e);
    }
  }

  if (ev.kinds.length) {
    const race = card.race?.toLowerCase();
    const cat = card.cat.toLowerCase();
    const hit = ev.kinds.find((k) => (race && k === race) || k === `${cat} card`);
    if (hit) {
      raw += SCORE_KIND;
      evidence.push(`type ${hit}`);
    }
  }

  raw += SCORE_RECENCY * (index.base.setRecency.get(set.id) ?? 0);
  return { card, set, raw, evidence, lines };
}

function candidatePool(ev: Evidence, index: YgoScanIndex): Map<string, CatalogCard> {
  const pool = new Map<string, CatalogCard>();
  const add = (list: CatalogCard[] | undefined, max = Infinity) => {
    if (list) for (const c of list.slice(0, max)) pool.set(c.id, c);
  };
  for (const p of ev.passcodes) add(index.byPasscode.get(p.pc));
  for (const c of ev.codes) add(index.byCode.get(c.code));
  for (const [name] of ev.names) add(index.base.cardsByName.get(name), MAX_PRINTINGS_PER_NAME);
  return pool;
}

const scoreOf = (raw: number) => Math.max(0, Math.min(1, raw / SCORE_FULL));

/** Observations → ranked candidates, one per physical card. Pure and deterministic. */
export function matchYgo(obs: YgoFrameObservations, index: YgoScanIndex): ScanCandidate[] {
  const medianH = median(obs.lines.map((l) => l.bbox.h));
  const nameInfo = new Map<number, NameLineInfo>();
  for (const n of obs.names) {
    const hits = findNames(n.norm, index.base);
    if (hits.length === 0) continue;
    nameInfo.set(n.lineIndex, { lineIndex: n.lineIndex, hits, strength: nameStrength(hits[0], obs.lines[n.lineIndex].bbox.h, medianH) });
  }
  const groups = groupYgoCards(obs, nameInfo);
  const out: ScanCandidate[] = [];
  for (const g of groups) {
    const ev = collectEvidence(g, obs, nameInfo, medianH, index);
    const scored: Scored[] = [];
    for (const card of candidatePool(ev, index).values()) {
      const set = index.base.setById.get(card.set);
      if (set) scored.push(scoreCard(card, set, ev, index));
    }
    if (!scored.length) continue;
    scored.sort((a, b) => b.raw - a.raw || a.card.id.localeCompare(b.card.id));
    const best = scored[0];
    const score = scoreOf(best.raw);
    if (score < MIN_SCORE) continue;
    const alternatives: ScanAlternative[] = scored
      .slice(1, 1 + MAX_ALTERNATIVES)
      .map((s) => ({ card: s.card, set: s.set, score: scoreOf(s.raw), evidence: s.evidence }));
    // Margin from the raw sums: passcode + name + stats put every printing of
    // a card at the 1.0 ceiling, and only the printed code separates them.
    const margin = Math.max(0, Math.min(1, (best.raw - (scored[1]?.raw ?? 0)) / SCORE_FULL));
    const contributing = new Set<number>([g.anchorLine, ...best.lines]);
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
  const rowH = median(out.map((c) => c.cardBox.h)) * 0.75 || 1;
  const row = (c: ScanCandidate) => Math.floor((c.cardBox.y + c.cardBox.h / 2) / rowH);
  out.sort((a, b) => row(a) - row(b) || a.cardBox.x - b.cardBox.x || a.key.localeCompare(b.key));
  return out;
}

export function scanYgoLines(lines: readonly RecognizedLine[], index: YgoScanIndex): ScanCandidate[] {
  return matchYgo(parseYgoLines(lines, index.parseContext), index);
}

/**
 * The Yu-Gi-Oh! matcher over an index built once per catalog. Artwork hashes
 * (public/data/ygo/hashes.json) are keyed by passcode, the picture's own id:
 * `artworkCards` turns a hit into every printing of the card (an alternate
 * artwork's passcode resolves to the same printings; the catalog does not say
 * which printing carries which art), and `lookup` takes a printing id or a
 * passcode (→ its newest printing).
 */
export function createYgoMatcher(catalog: Catalog): ScanMatcher {
  const index = buildYgoScanIndex(catalog);
  const cardById = new Map(catalog.cards.map((c) => [c.id, c]));
  const printings = (id: string) => (/^\d+$/.test(id) ? index.byPasscode.get(Number(id)) : undefined) ?? [];
  return {
    game: 'ygo',
    scanLines: (lines) => scanYgoLines(lines, index),
    lookup: (id) => {
      const card = cardById.get(id) ?? printings(id)[0];
      const set = card && index.base.setById.get(card.set);
      return card && set ? { card, set } : undefined;
    },
    artworkCards: (id) => printings(id).map((c) => c.id),
  };
}
