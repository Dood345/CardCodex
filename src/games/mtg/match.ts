/**
 * Magic: The Gathering scan matcher: THE SCANNER'S SEAM.
 *
 * A deliberately minimal matcher so the Scan tab runs for Magic while the real
 * one is built. It reads two kinds of OCR lines and nothing else:
 *   - a name line (top-left of the card): matched exactly, after
 *     normalisation, against Oracle names and the front-face names of
 *     double-faced cards;
 *   - collector lines (bottom-left on cards since 2023: "0161 C" over
 *     "BLB • EN"; "161/280 R" on older modern frames): a number and a
 *     3–5 letter set code that names one printing.
 * It returns at most one candidate per frame (single-card scanning), not the
 * per-card boxes the binder-page scanner needs. No artwork hashes exist for
 * Magic yet (`hashFileFor` in src/scanner/artwork.ts returns null), so
 * `artworkCards` is absent.
 *
 * The real matcher belongs in src/scanner/mtg/ next to the Yu-Gi-Oh! one, with
 * its own card OCR geometry, fuzzy name matching and per-card grouping of
 * lines; `createMatcher` in ./index.tsx is the one place to swap it in.
 */
import { normalizeText } from '@/data/normalize';
import type { Catalog, CatalogCard, CatalogSet } from '@/data/types';
import type { Box, RecognizedLine, ScanAlternative, ScanCandidate, ScanMatcher } from '@/scanner/types';

const MAX_ALTERNATIVES = 12;

/** "0161 C", "161/280 R", "161" → "161" (leading zeros dropped as Scryfall numbers have none). */
const NUMBER_RE = /\b0*(\d{1,4}[a-z]?)(?:\s*\/\s*\d{1,4})?(?:\s+[CURMSLTPD])?\b/i;
const SET_CODE_RE = /\b([A-Z0-9]{3,5})\b/g;

function union(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function createMtgMatcher(catalog: Catalog): ScanMatcher {
  const setById = new Map<string, CatalogSet>(catalog.sets.map((s) => [s.id, s]));
  const cardById = new Map<string, CatalogCard>();
  /** Normalised name (whole name and each face of "A // B") → printings, newest set first. */
  const byName = new Map<string, CatalogCard[]>();
  const recency = (c: CatalogCard) => setById.get(c.set)?.releaseDate ?? '';
  for (const card of catalog.cards) {
    cardById.set(card.id, card);
    const names = new Set([card.name, ...card.name.split(' // ')].map(normalizeText));
    for (const n of names) {
      const list = byName.get(n);
      if (list) list.push(card);
      else byName.set(n, [card]);
    }
  }
  for (const list of byName.values()) list.sort((a, b) => (recency(a) < recency(b) ? 1 : recency(a) > recency(b) ? -1 : 0));

  const withSet = (card: CatalogCard) => {
    const set = setById.get(card.set);
    return set ? { card, set } : undefined;
  };

  function scanLines(lines: readonly RecognizedLine[]): ScanCandidate[] {
    if (!lines.length) return [];
    let nameHit: { cards: CatalogCard[]; line: RecognizedLine; text: string } | undefined;
    const numbers: { num: string; line: RecognizedLine }[] = [];
    const codes: { code: string; line: RecognizedLine }[] = [];
    for (const line of lines) {
      const norm = normalizeText(line.text);
      const cards = norm.length >= 3 ? byName.get(norm) : undefined;
      if (cards && !nameHit) nameHit = { cards, line, text: line.text.trim() };
      const n = NUMBER_RE.exec(line.text);
      if (n) numbers.push({ num: n[1].toLowerCase(), line });
      for (const m of line.text.toUpperCase().matchAll(SET_CODE_RE)) {
        if (setById.has(m[1].toLowerCase())) codes.push({ code: m[1].toLowerCase(), line });
      }
    }

    // A printing named by set code + collector number.
    let printing: { card: CatalogCard; lines: RecognizedLine[] } | undefined;
    for (const c of codes) {
      for (const n of numbers) {
        const card = cardById.get(`mtg:${c.code}-${n.num}`);
        if (card && (!nameHit || nameHit.cards.includes(card))) {
          printing = { card, lines: [c.line, n.line] };
          break;
        }
      }
      if (printing) break;
    }

    let best: CatalogCard | undefined;
    let score = 0;
    const evidence: string[] = [];
    if (printing) {
      best = printing.card;
      score = nameHit ? 0.95 : 0.7;
      evidence.push(`number ${printing.card.set.toUpperCase()} ${printing.card.num}`);
      if (nameHit) evidence.push(`name "${nameHit.text}"`);
    } else if (nameHit) {
      best = nameHit.cards[0];
      score = nameHit.cards.length === 1 ? 0.8 : 0.6;
      evidence.push(`name "${nameHit.text}"`);
    }
    const found = best && withSet(best);
    if (!found) return [];

    const pool = nameHit?.cards ?? [];
    const alternatives: ScanAlternative[] = pool
      .filter((c) => c.id !== found.card.id)
      .slice(0, MAX_ALTERNATIVES)
      .flatMap((c) => {
        const s = setById.get(c.set);
        return s ? [{ card: c, set: s, score: score * 0.9, evidence: [`same name, ${s.name}`] }] : [];
      });
    const used = [nameHit?.line, ...(printing?.lines ?? [])].filter((l): l is RecognizedLine => !!l);
    return [
      {
        key: found.card.id,
        card: found.card,
        set: found.set,
        score,
        margin: alternatives.length ? score * 0.1 : score,
        // A name alone cannot tell the printings apart; ask unless it is the only one.
        confident: !!printing || alternatives.length === 0,
        evidence,
        bbox: union(used.map((l) => l.bbox)),
        cardBox: union(lines.map((l) => l.bbox)),
        alternatives,
      },
    ];
  }

  return {
    game: 'mtg',
    scanLines,
    lookup: (id) => {
      const card = cardById.get(id);
      return card && withSet(card);
    },
  };
}
