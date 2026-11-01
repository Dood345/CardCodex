/**
 * Pure extraction of observations (collector number, set code, HP, name
 * candidates) from OCR lines. No DOM and no catalog access beyond the small
 * optional `ParseContext` (which the matcher derives from its index).
 *
 * The heuristics were tuned on Tesseract output for TCGdex scans
 * (scripts/scan-check.mjs). Real readings that drove them:
 *   "[¢) 057/198 &"  (SV, set-code box unreadable)     → 57/198
 *   "(JBI 190/195 %" (true value "SVI 190/198")         → 190/195, matcher tolerates the total
 *   "47102 x"        (Base Set "4/102", slash read as 7) → loose 4/102 when 102 is a known total
 *   "$25 Wugtrio" / "»90@" / "w110" / "#330"            → name line junk + HP without "HP"
 */
import type {
  DexObservation,
  FrameObservations,
  HpObservation,
  NameObservation,
  NumberObservation,
  RecognizedLine,
  SetCodeObservation,
} from './types';
import { NUMBER_PREFIXES, normalizeName, toDigits } from './ocr-normalize';

/** Optional catalog-derived knowledge that sharpens parsing. */
export interface ParseContext {
  /** Upper-case printed set codes (base part before ":", non-empty). */
  abbrs?: ReadonlySet<string>;
  /** Every `CatalogSet.official` value > 0. Enables the "47102" heuristic. */
  knownTotals?: ReadonlySet<number>;
}

// ---------------------------------------------------------------------------
// Collector numbers
// ---------------------------------------------------------------------------

interface NumPart {
  prefix: string;
  digits: string;
  noisy: boolean;
}

/** Split a known letter prefix ("TG", "SWSH", ...) off a token, case-insensitively. */
function splitPrefix(tok: string): { prefix: string; rest: string } | null {
  const up = tok.toUpperCase();
  for (const p of NUMBER_PREFIXES) {
    if (up.startsWith(p) && tok.length > p.length) {
      const rest = tok.slice(p.length);
      // "H" is also a common OCR artefact; only accept prefix + real digits.
      if (/^[0-9]/.test(rest)) return { prefix: p, rest };
    }
  }
  return null;
}

/**
 * Interpret the token LEFT of the separator: the collector number is its
 * trailing 1–3 digit-ish characters (anything before is the set-code box or
 * noise, e.g. "SVI057" or "BIM057").
 */
function parseLeft(tok: string): NumPart | null {
  const pre = splitPrefix(tok);
  if (pre) {
    const d = toDigits(pre.rest);
    if (d && d.digits.length <= 3) return { prefix: pre.prefix, digits: d.digits, noisy: d.noisy };
  }
  for (let k = Math.min(3, tok.length); k >= 1; k--) {
    const d = toDigits(tok.slice(-k));
    if (d) return { prefix: '', digits: d.digits, noisy: d.noisy || k < tok.length };
  }
  return null;
}

/**
 * Interpret the token RIGHT of the separator: the printed total is its
 * leading 1–3 digit-ish characters; a real 4th digit means it's not a total
 * (e.g. a year).
 */
function parseRight(tok: string): NumPart | null {
  const pre = splitPrefix(tok);
  const prefix = pre ? pre.prefix : '';
  const body = pre ? pre.rest : tok;
  for (let k = Math.min(3, body.length); k >= 1; k--) {
    if (/[0-9]/.test(body.charAt(k))) continue;
    const d = toDigits(body.slice(0, k));
    if (d) return { prefix, digits: d.digits, noisy: d.noisy || k < body.length };
  }
  return null;
}

function numObs(
  left: NumPart,
  total: number | undefined,
  totalPrefix: string,
  quality: NumberObservation['quality'],
  raw: string,
  line: RecognizedLine,
  lineIndex: number,
): NumberObservation {
  const n = String(Number(left.digits));
  return {
    kind: 'number',
    num: `${left.prefix}${n}`,
    total,
    totalPrefix: totalPrefix || undefined,
    quality,
    raw,
    bbox: line.bbox,
    lineIndex,
  };
}

/**
 * Extract collector numbers ("057/198", "TG01/TG30", "25 / 102", "O57/1O2")
 * from one line. Separators: "/", "\", "|" (any spacing); "I"/"l" between
 * digit groups when no real separator exists; "7" (loose) only when the
 * remainder is a known set total.
 */
export function parseNumbers(
  line: RecognizedLine,
  lineIndex: number,
  ctx: ParseContext = {},
): NumberObservation[] {
  const out: NumberObservation[] = [];
  const text = line.text.replace(/\s*([/\\|])\s*/g, '$1');

  // 1) Explicit separator. The left token may not contain "|" so that
  //    "057|198" splits at the bar rather than reading it as a 1.
  const re = /([A-Za-z0-9!]{1,8})[/\\|]([A-Za-z0-9|!]{1,8})/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const left = parseLeft(m[1]);
    const right = parseRight(m[2]);
    if (!left || !right) continue;
    const total = Number(right.digits);
    if (!(total > 0)) continue; // "/0" never matches (sets with official 0 exist)
    // Secret rares exceed the total, but never by more than ~2x
    // (e.g. 258/198 in SVI); larger left numbers are misreads.
    if (!left.prefix && !right.prefix && Number(left.digits) > total * 2 + 20) continue;
    const quality = left.noisy || right.noisy ? 'noisy' : 'clean';
    out.push(numObs(left, total, right.prefix, quality, m[0], line, lineIndex));
  }
  if (out.length) return out;

  // 2) "057I198" / "57l102": I or l used as the slash (no real separator on the line).
  const reI = /(?<![A-Za-z0-9])([0-9OoD]{1,3})\s?[Il]\s?([0-9OoD]{2,3})(?![A-Za-z0-9])/g;
  for (let m = reI.exec(line.text); m; m = reI.exec(line.text)) {
    const l = toDigits(m[1]);
    const r = toDigits(m[2]);
    if (!l || !r || !(Number(r.digits) > 0)) continue;
    out.push(numObs({ prefix: '', digits: l.digits, noisy: true }, Number(r.digits), '', 'noisy', m[0], line, lineIndex));
  }
  if (out.length) return out;

  // 3) "47102" for "4/102": the thin slash read as "7". Only accepted when
  //    the remainder is a real set total, otherwise any 4–6 digit number with
  //    a 7 in it (years, weights) would match.
  if (ctx.knownTotals) {
    const reD = /(?<![0-9])([0-9]{4,6})(?![0-9])/g;
    for (let m = reD.exec(line.text); m; m = reD.exec(line.text)) {
      const s = m[1];
      for (let p = 1; p <= 3 && p < s.length - 2; p++) {
        if (s[p] !== '7') continue;
        const rest = s.slice(p + 1);
        if (rest.length < 2 || rest.length > 3 || !ctx.knownTotals.has(Number(rest))) continue;
        if (rest.startsWith('0')) continue;
        out.push(
          numObs({ prefix: '', digits: s.slice(0, p), noisy: true }, Number(rest), '', 'loose', s, line, lineIndex),
        );
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Set codes
// ---------------------------------------------------------------------------

/** Hamming distance for equal-length strings (OCR substitutions, not indels). */
function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/**
 * Find printed set codes on a line. Rules (to keep false positives low):
 * - token must be written in capitals/digits in the OCR text (codes are
 *   printed upper-case; lower-case words are rules text);
 * - 2-character codes ("BS", "EX") only exact and only on a line that also
 *   has a collector number;
 * - 3–4 character codes may differ by one substituted character
 *   ("SVl" → "SVI"); every abbr at distance ≤ 1 is reported.
 * Real-world note: on SV cards the code sits in a dark box that Tesseract
 * mostly misreads ("JBI", "BIM", "[SBT"), so the matcher weights this low.
 */
export function parseSetCodes(
  line: RecognizedLine,
  lineIndex: number,
  ctx: ParseContext,
  hasNumber: boolean,
): SetCodeObservation[] {
  const out: SetCodeObservation[] = [];
  if (!ctx.abbrs || ctx.abbrs.size === 0) return out;
  for (const tok of line.text.split(/[^A-Za-z0-9]+/)) {
    if (tok.length < 2 || tok.length > 4) continue;
    if (!/^[A-Z0-9]+$/.test(tok) || !/[A-Z]/.test(tok)) continue;
    if (tok.length === 2) {
      if (hasNumber && ctx.abbrs.has(tok)) {
        out.push({ kind: 'setCode', code: tok, abbr: tok, distance: 0, bbox: line.bbox, lineIndex });
      }
      continue;
    }
    if (ctx.abbrs.has(tok)) {
      out.push({ kind: 'setCode', code: tok, abbr: tok, distance: 0, bbox: line.bbox, lineIndex });
      continue;
    }
    for (const abbr of ctx.abbrs) {
      if (abbr.length === tok.length && hamming(abbr, tok) === 1) {
        out.push({ kind: 'setCode', code: tok, abbr, distance: 1, bbox: line.bbox, lineIndex });
      }
    }
  }
  return out;
}

/**
 * Bare collector numbers next to a set code, e.g. "PAL 123" or "SVP EN 045"
 * (promos and some modern prints have no "/total").
 */
function parseBareNumbers(
  line: RecognizedLine,
  lineIndex: number,
  codes: SetCodeObservation[],
): NumberObservation[] {
  if (codes.length === 0) return [];
  const out: NumberObservation[] = [];
  const toks = line.text.split(/\s+/);
  const codeSet = new Set(codes.map((c) => c.code));
  for (let i = 0; i < toks.length; i++) {
    const clean = toks[i].replace(/[^A-Za-z0-9]/g, '');
    if (!codeSet.has(clean)) continue;
    // Allow one short language token in between ("SVP EN 045").
    for (let j = i + 1; j <= i + 2 && j < toks.length; j++) {
      const t = toks[j].replace(/[^A-Za-z0-9|!]/g, '');
      const d = /^[0-9OoIl]{1,3}$/.test(t) ? toDigits(t) : null;
      if (d) {
        out.push({
          kind: 'number',
          num: String(Number(d.digits)),
          quality: 'noisy',
          raw: `${clean} ${t}`,
          bbox: line.bbox,
          lineIndex,
        });
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// HP
// ---------------------------------------------------------------------------

/** Plausible printed HP: 30..400 in steps of 10 (HP 10/20 cards don't exist in English print). */
function plausibleHp(v: number): boolean {
  return v >= 30 && v <= 400 && v % 10 === 0;
}

/**
 * HP values. Explicit: "HP 120", "120 HP", "HP120" (with O/S/I confusions).
 * Loose: a short token that is just a 2–3 digit multiple of ten with up to
 * two junk characters around it ("»90@", "w110", "#330"): on SV cards the
 * small "HP" glyphs are usually lost. Loose values are only trusted by the
 * matcher when the line sits at name height on the right side of a card
 * (attack damage like "30" is otherwise indistinguishable).
 */
export function parseHp(line: RecognizedLine, lineIndex: number): HpObservation[] {
  const out: HpObservation[] = [];
  const seen = new Set<number>();
  const push = (hp: number, explicit: boolean) => {
    if (!plausibleHp(hp) || seen.has(hp)) return;
    seen.add(hp);
    out.push({ kind: 'hp', hp, explicit, bbox: line.bbox, lineIndex });
  };
  const reA = /HP\s*([0-9OoSIl]{2,3})(?![0-9])/gi;
  for (let m = reA.exec(line.text); m; m = reA.exec(line.text)) {
    const d = toDigits(m[1]);
    if (d) push(Number(d.digits), true);
  }
  const reB = /(?<![0-9A-Za-z])([0-9OoSIl]{2,3})\s*HP/gi;
  for (let m = reB.exec(line.text); m; m = reB.exec(line.text)) {
    const d = toDigits(m[1]);
    if (d) push(Number(d.digits), true);
  }
  if (out.length) return out;
  for (const tok of line.text.split(/\s+/)) {
    const m = /^[^0-9A-Za-z]{0,2}[A-Za-z]?([0-9]{2,3})[^0-9]{0,2}$/.exec(tok);
    if (m) push(Number(m[1]), false);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * Every line with at least three letters is a potential name. The fuzzy
 * lookup against catalog names happens in the matcher (it needs the index).
 */
export function parseName(line: RecognizedLine, lineIndex: number): NameObservation | null {
  const norm = normalizeName(line.text);
  if ((norm.match(/[a-z]/g) ?? []).length < 3) return null;
  return { kind: 'name', norm, raw: line.text, bbox: line.bbox, lineIndex };
}

// ---------------------------------------------------------------------------
// Pokédex number
// ---------------------------------------------------------------------------

/** Highest National Pokédex number in the species list. */
const MAX_DEX = 1025;

/**
 * "NO. 0204 …" / "No. 162 …" on the Pokédex line (see DexObservation). The
 * digits must follow "NO" directly (with an optional dot), so "No Pokémon in
 * play" in rules text never matches; O/I confusions inside the digits are
 * tolerated ("NO. O2O4").
 */
export function parseDex(line: RecognizedLine, lineIndex: number): DexObservation | null {
  const m = /(?:^|[^A-Za-z])N[Oo0]\.?\s*([0-9OoIl]{1,4})(?![0-9A-Za-z])/.exec(line.text);
  if (!m) return null;
  const d = toDigits(m[1]);
  if (!d) return null;
  const dex = Number(d.digits);
  if (!Number.isInteger(dex) || dex < 1 || dex > MAX_DEX) return null;
  return { kind: 'dex', dex, raw: m[0].trim(), bbox: line.bbox, lineIndex };
}

// ---------------------------------------------------------------------------
// Whole frame
// ---------------------------------------------------------------------------

/** Parse all lines of a frame into observations. Pure and deterministic. */
export function parseLines(lines: readonly RecognizedLine[], ctx: ParseContext = {}): FrameObservations {
  const res: FrameObservations = { lines: [...lines], numbers: [], setCodes: [], hps: [], names: [], dexes: [] };
  lines.forEach((line, i) => {
    if (!line.text.trim()) return;
    const nums = parseNumbers(line, i, ctx);
    const codes = parseSetCodes(line, i, ctx, nums.length > 0);
    if (nums.length === 0) nums.push(...parseBareNumbers(line, i, codes));
    res.numbers.push(...nums);
    res.setCodes.push(...codes);
    res.hps.push(...parseHp(line, i));
    const name = parseName(line, i);
    if (name) res.names.push(name);
    const dex = parseDex(line, i);
    if (dex) res.dexes.push(dex);
  });
  return res;
}
