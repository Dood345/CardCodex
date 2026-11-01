/**
 * Yu-Gi-Oh! observations from OCR lines. Pure; no catalog access beyond the
 * small `YgoParseContext` (known passcodes, printed codes and code prefixes),
 * which the matcher derives from its index.
 *
 * What a card offers (measured on 813×1185 renders; see match.ts for the
 * geometry): the name (top), the set code under the artwork on the right
 * ("LOB-EN005", ~2% of the card height tall), the type line in brackets
 * ("[Spellcaster / Normal]", "[Spell Card]"), "ATK/2500 DEF/2100" bottom
 * right, and the 8-digit passcode bottom-left (~1.6% tall, the smallest
 * print on the card). Passcode and set code each identify the card outright,
 * so both are validated against the catalog instead of a loose regex.
 */
import { parseName } from '../parse';
import { toDigits } from '../ocr-normalize';
import type { Box, NameObservation, RecognizedLine } from '../types';

export interface YgoParseContext {
  /** Every passcode in the catalog (alternate arts included). */
  passcodes: ReadonlySet<number>;
  /** Every printed code ("LOB-EN005"), upper-case. */
  codes: ReadonlySet<string>;
  /** Every code prefix ("LOB"), upper-case. */
  prefixes: ReadonlySet<string>;
}

/** 8-digit passcode as read. `known` = exact catalog hit; the matcher also tries one-digit-off. */
export interface PasscodeObservation {
  kind: 'passcode';
  digits: string;
  known: boolean;
  noisy: boolean;
  raw: string;
  bbox: Box;
  lineIndex: number;
}

/** Printed set code. `code` is the best normalized reading ("LOB-EN005"); `known` = exact catalog hit. */
export interface CodeObservation {
  kind: 'code';
  code: string;
  prefix: string;
  known: boolean;
  noisy: boolean;
  raw: string;
  bbox: Box;
  lineIndex: number;
}

/** "ATK/2500 DEF/2100" or "ATK/2000 LINK-2". A "?" stat is undefined. */
export interface StatsObservation {
  kind: 'stats';
  atk?: number;
  def?: number;
  link?: number;
  raw: string;
  bbox: Box;
  lineIndex: number;
}

/** Bracketed type line: ["Spellcaster", "Normal"], ["Spell Card"], ["Zombie", "Tuner", "Effect"]. */
export interface KindObservation {
  kind: 'kind';
  words: string[];
  raw: string;
  bbox: Box;
  lineIndex: number;
}

export interface YgoFrameObservations {
  lines: RecognizedLine[];
  passcodes: PasscodeObservation[];
  codes: CodeObservation[];
  stats: StatsObservation[];
  kinds: KindObservation[];
  names: NameObservation[];
}

/** Digit-ish characters OCR emits for the tiny passcode print. */
const DIGITISH = '[0-9OoDQIlSsBZzGbgq|!]';

/**
 * Passcodes: eight digit-ish characters, optionally split 4+4 by a space
 * (Tesseract sometimes breaks the number at the slightly wider gap), with at
 * least five real digits so no word ever qualifies.
 */
export function parsePasscodes(line: RecognizedLine, lineIndex: number, ctx: YgoParseContext): PasscodeObservation[] {
  const out: PasscodeObservation[] = [];
  const re = new RegExp(`(?<![0-9A-Za-z])(${DIGITISH}{4})\\s?(${DIGITISH}{4})(?![0-9A-Za-z])`, 'g');
  for (let m = re.exec(line.text); m; m = re.exec(line.text)) {
    const tok = m[1] + m[2];
    if ((tok.match(/[0-9]/g) ?? []).length < 5) continue;
    const d = toDigits(tok);
    if (!d || d.digits.length !== 8) continue;
    out.push({
      kind: 'passcode',
      digits: d.digits,
      known: ctx.passcodes.has(Number(d.digits)),
      noisy: d.noisy,
      raw: m[0],
      bbox: line.bbox,
      lineIndex,
    });
  }
  return out;
}

/** Letter ↔ digit confusions in the letter part of a code ("EN0O5": the O is a 0, the 0 is a 0). */
const TO_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z', '6': 'G' };
const TO_DIGIT: Record<string, string> = { O: '0', I: '1', S: '5', B: '8', Z: '2', G: '6', L: '1', D: '0', Q: '0' };

/** Both spellings of each confusable character, bounded to 32 variants. */
function variants(s: string): string[] {
  let out = [''];
  for (const ch of s) {
    const alts = new Set([ch]);
    if (TO_LETTER[ch]) alts.add(TO_LETTER[ch]);
    if (TO_DIGIT[ch]) alts.add(TO_DIGIT[ch]);
    if (out.length * alts.size > 32) {
      out = out.map((p) => p + ch);
      continue;
    }
    out = out.flatMap((p) => [...alts].map((a) => p + a));
  }
  return out;
}

/**
 * Normalize the body of a code ("EN0O5" → "EN005"): leading letters stay
 * letters (digits read there become letters), the rest become digits, with
 * an optional trailing letter kept ("ENA01", "EN001A", "ENSE1", "ENTKN").
 */
function normalizeBody(body: string): string[] {
  const up = body.toUpperCase();
  const out = new Set<string>([up]);
  const m = /^([A-Z0-9]{0,3}?)([0-9ODQILSBZG|!]{1,3})([A-Z]?)$/.exec(up);
  if (!m) return [...out];
  const letters = [...m[1]].map((c) => TO_LETTER[c] ?? c).join('');
  // Upper-cased "l" (a 1 read as an ell) is not in the digit-confusion table.
  const asDigits = (t: string) => toDigits(t.replace(/L/g, '1'));
  const digits = asDigits(m[2]);
  if (digits) out.add(`${letters}${digits.digits}${m[3]}`);
  // A trailing I/L/O/S/B is more often a misread last digit ("EN00l") than a real suffix letter.
  if (m[3] && TO_DIGIT[m[3]]) {
    const all = asDigits(m[2] + m[3]);
    if (all) out.add(`${letters}${all.digits}`);
  }
  return [...out];
}

function lookupCode(prefixRaw: string, bodyRaw: string, ctx: YgoParseContext): { code: string; prefix: string; known: boolean; noisy: boolean } | null {
  const prefixes = variants(prefixRaw.toUpperCase()).filter((p) => ctx.prefixes.has(p));
  const bodies = normalizeBody(bodyRaw);
  // Exact hit first (any prefix variant × any body spelling).
  for (const p of prefixes) {
    for (const b of bodies) {
      const code = `${p}-${b}`;
      if (ctx.codes.has(code)) {
        return { code, prefix: p, known: true, noisy: p !== prefixRaw.toUpperCase() || b !== bodyRaw.toUpperCase() };
      }
    }
  }
  // Known prefix, unknown body: hand the best spelling to the matcher for a one-character search.
  if (prefixes.length) {
    const b = bodies[bodies.length - 1];
    return { code: `${prefixes[0]}-${b}`, prefix: prefixes[0], known: false, noisy: true };
  }
  return null;
}

/**
 * Printed set codes: PREFIX-BODY with the hyphen possibly read as another
 * dash, an underscore, a tilde or a space, or dropped altogether ("LOBEN005").
 * Every candidate is validated against the catalog's prefixes and codes.
 */
export function parseCodes(line: RecognizedLine, lineIndex: number, ctx: YgoParseContext): CodeObservation[] {
  const out: CodeObservation[] = [];
  const seen = new Set<string>();
  const add = (hit: ReturnType<typeof lookupCode>, raw: string) => {
    if (!hit || seen.has(hit.code)) return;
    seen.add(hit.code);
    out.push({ kind: 'code', ...hit, raw, bbox: line.bbox, lineIndex });
  };
  const text = line.text;
  // 1) With a separator.
  const re = /(?<![A-Za-z0-9])([A-Za-z0-9]{2,6})\s?[-–—_~]\s?([A-Za-z0-9|!]{2,8})(?![A-Za-z0-9])/g;
  for (let m = re.exec(text); m; m = re.exec(text)) add(lookupCode(m[1], m[2], ctx), m[0]);
  if (out.length) return out;
  // 2) Separator lost: try every split of an alphanumeric token that has a digit.
  const re2 = /(?<![A-Za-z0-9])([A-Za-z0-9]{5,14})(?![A-Za-z0-9])/g;
  for (let m = re2.exec(text); m; m = re2.exec(text)) {
    const tok = m[1];
    if (!/[0-9]/.test(tok)) continue;
    for (let k = 2; k <= 6 && k <= tok.length - 2; k++) {
      const hit = lookupCode(tok.slice(0, k), tok.slice(k), ctx);
      if (hit?.known) {
        add(hit, tok);
        break;
      }
    }
  }
  // 3) Separator read as a space: "LOB EN005".
  if (!out.length) {
    const re3 = /(?<![A-Za-z0-9])([A-Za-z0-9]{2,6}) ([A-Za-z]{2}[0-9OoIlSB]{2,4}[A-Z]?)(?![A-Za-z0-9])/g;
    for (let m = re3.exec(text); m; m = re3.exec(text)) {
      const hit = lookupCode(m[1], m[2], ctx);
      if (hit?.known) add(hit, m[0]);
    }
  }
  return out;
}

function statValue(tok: string): number | undefined {
  if (tok === '?' || tok === '') return undefined;
  const d = toDigits(tok);
  if (!d) return undefined;
  const v = Number(d.digits);
  return v <= 10000 ? v : undefined;
}

/** "ATK/2500 DEF/2100", "ATK/ 0 DEF/1800", "ATK/2000 LINK-2", "ATK/? DEF/?" (with OCR confusions). */
export function parseStats(line: RecognizedLine, lineIndex: number): StatsObservation | null {
  const t = line.text;
  const m = /ATK\s*[/:.]?\s*([0-9OoIlSB]{1,5}|\?)\s*(?:DEF|0EF|OEF|DEE)\s*[/:.]?\s*([0-9OoIlSB]{1,5}|\?)/i.exec(t);
  if (m) {
    const atk = statValue(m[1]);
    const def = statValue(m[2]);
    if (atk === undefined && def === undefined && !/\?/.test(m[0])) return null;
    return { kind: 'stats', atk, def, raw: m[0], bbox: line.bbox, lineIndex };
  }
  const l = /ATK\s*[/:.]?\s*([0-9OoIlSB]{1,5}|\?)\s*LINK\s*[-–—]?\s*([0-9OoIl])/i.exec(t);
  if (l) {
    const link = statValue(l[2]);
    return { kind: 'stats', atk: statValue(l[1]), link, raw: l[0], bbox: line.bbox, lineIndex };
  }
  return null;
}

/** "[Zombie/Tuner/Effect]", "[ SPELL CARD ]", "[Dragon / Normal]" (brackets may be lost or read as I/l/1). */
export function parseKind(line: RecognizedLine, lineIndex: number): KindObservation | null {
  const t = line.text.trim();
  // Brackets are often half lost ("[SPELLCASTER/NORMAL"): one bracket-ish
  // character on either side is enough; with none, the line must contain a slash.
  // An I/l/1 only counts as a bracket when it cannot be part of the word:
  // leading before a capital ("IDragon"), trailing after a lower-case letter
  // as a capital I or a 1 ("NormalI"), never the l of "Normal".
  const stripped = t.replace(/^(?:[\[({|]|[Il1](?=[A-Z ]))\s*/, '').replace(/\s*(?:[\])}|]|(?<=[a-z])[I1])$/, '');
  const bracketed = stripped !== t;
  const m = bracketed
    ? /^([A-Za-z][A-Za-z -]*(?:\s*\/\s*[A-Za-z][A-Za-z -]*){0,4})$/.exec(stripped)
    : /^([A-Za-z][A-Za-z-]*(?:\s*\/\s*[A-Za-z][A-Za-z-]*){1,4})$/.exec(t);
  if (!m) return null;
  const words = m[1]
    .split('/')
    .map((w) => w.trim().replace(/\s+/g, ' '))
    .filter((w) => w.length >= 3);
  if (!words.length) return null;
  return { kind: 'kind', words, raw: m[0], bbox: line.bbox, lineIndex };
}

/** Parse all lines of a frame. Pure and deterministic. */
export function parseYgoLines(lines: readonly RecognizedLine[], ctx: YgoParseContext): YgoFrameObservations {
  const res: YgoFrameObservations = { lines: [...lines], passcodes: [], codes: [], stats: [], kinds: [], names: [] };
  lines.forEach((line, i) => {
    if (!line.text.trim()) return;
    res.passcodes.push(...parsePasscodes(line, i, ctx));
    res.codes.push(...parseCodes(line, i, ctx));
    const st = parseStats(line, i);
    if (st) res.stats.push(st);
    const k = parseKind(line, i);
    if (k) res.kinds.push(k);
    const name = parseName(line, i);
    if (name) res.names.push(name);
  });
  return res;
}
