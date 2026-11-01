/**
 * Artwork evidence for the scanner: loading the hash table and merging the
 * nearest hashes of a pocket into the OCR candidates.
 *
 * The hash names the *picture*; printings that reuse it (Base Set / Base Set 2
 * / Legendary Collection, Evolutions reprints) sit a few bits apart, so the
 * printing has to come from the OCR'd collector number or set code. Hence the
 * merge (`mergeArtworkEvidence`): a hash match ranks that picture's printings
 * first; a number or set code read among them makes the pocket confident; a
 * match alone is an unsure candidate with the printings as alternatives.
 *
 * Distances (Hamming, of 128 bits) measured on the fixture pages
 * (scripts/hash-bench.mjs): the right card at 5–14 bits (a textured holo at
 * 27), other cards at ≥ 26, unrelated cards ~64; printings of one picture
 * within ~6 bits of each other.
 */
import type { CatalogCard, CatalogSet } from '../data/types';
import { decodeHashFile, type HashFile, type HashHit, type HashTable } from './hash';
import type { Box, ScanAlternative, ScanCandidate } from './types';

/** A hit at or below this is the picture on the card. */
export const ARTWORK_MATCH_BITS = 24;
/** Hits up to this are listed as alternatives with a small bonus; beyond it they are noise. */
export const ARTWORK_WEAK_BITS = 32;
/** Hits within this many bits of the best one show the same picture (reprints). */
export const ARTWORK_GROUP_BITS = 6;
const MAX_ALTERNATIVES = 12;

/**
 * Score bonus (on `ScanCandidate.score`'s 0..1 scale) for a hit at `distance`:
 * 0.9 for an identical picture, 0.55 at the match limit, then fading to 0 at
 * the weak limit. A strong match outranks a name-only OCR read (~0.45) on its
 * own and, added to one, caps the score; it stays below a clean number + total
 * + name read (0.95–1) so a confident OCR identification is not overturned by
 * a picture alone.
 */
export function artworkBonus(distance: number): number {
  if (distance <= ARTWORK_MATCH_BITS) return 0.55 + (0.35 * (ARTWORK_MATCH_BITS - distance)) / ARTWORK_MATCH_BITS;
  if (distance <= ARTWORK_WEAK_BITS) return (0.25 * (ARTWORK_WEAK_BITS - distance)) / (ARTWORK_WEAK_BITS - ARTWORK_MATCH_BITS);
  return 0;
}

/** The hits that show the best hit's picture (within `ARTWORK_GROUP_BITS` of it, none beyond the weak limit). */
export function sameArtworkGroup(hits: readonly HashHit[]): HashHit[] {
  if (!hits.length || hits[0].distance > ARTWORK_WEAK_BITS) return [];
  const limit = Math.min(ARTWORK_WEAK_BITS, hits[0].distance + ARTWORK_GROUP_BITS);
  return hits.filter((h) => h.distance <= limit);
}

/** Resolves a catalog id (the matcher knows its catalog; see `ScanMatcher.lookup`). */
export type CardLookup = (cardId: string) => { card: CatalogCard; set: CatalogSet } | undefined;

interface Pooled {
  card: CatalogCard;
  set: CatalogSet;
  ocrScore: number;
  ocrEvidence: string[];
  ocrConfident: boolean;
  distance?: number;
  score: number;
}

const PRINTING_EVIDENCE = /^(number|set) /;
const SPECIES_EVIDENCE = /^(name|dex) /;

/**
 * Merge a pocket's OCR candidates with the nearest artwork hashes (best
 * first, as `matchPocket` returns them). Pure. `region` is the crop (crop px)
 * and becomes the box of a candidate the OCR never saw.
 *
 * Every card named by either side is scored `min(1, OCR score + artworkBonus)`;
 * the best is the candidate. It is confident when the picture matched and the
 * OCR read a number or set code for it (or its name, when the picture exists
 * in one printing only), or when the OCR was already confident and the picture
 * does not point at a different card.
 */
export function mergeArtworkEvidence(ocr: readonly ScanCandidate[], hits: readonly HashHit[], lookup: CardLookup, region: Box): ScanCandidate[] {
  const group = sameArtworkGroup(hits);
  if (!group.length) return [...ocr];

  const pool = new Map<string, Pooled>();
  const pooled = (card: CatalogCard, set: CatalogSet): Pooled => {
    let p = pool.get(card.id);
    if (!p) {
      p = { card, set, ocrScore: 0, ocrEvidence: [], ocrConfident: false, score: 0 };
      pool.set(card.id, p);
    }
    return p;
  };
  const addOcr = (a: ScanAlternative | ScanCandidate, confident: boolean) => {
    const p = pooled(a.card, a.set);
    if (a.score > p.ocrScore) {
      p.ocrScore = a.score;
      p.ocrEvidence = a.evidence;
    }
    p.ocrConfident ||= confident;
  };
  for (const c of ocr) {
    addOcr(c, c.confident);
    for (const a of c.alternatives) addOcr(a, false);
  }
  for (const h of hits) {
    if (h.distance > ARTWORK_WEAK_BITS) break;
    const found = lookup(h.id);
    if (!found) continue;
    const p = pooled(found.card, found.set);
    if (p.distance === undefined || h.distance < p.distance) p.distance = h.distance;
  }
  for (const p of pool.values()) p.score = Math.min(1, p.ocrScore + (p.distance === undefined ? 0 : artworkBonus(p.distance)));

  const ranked = [...pool.values()].sort(
    (a, b) =>
      b.score - a.score ||
      (a.distance ?? 999) - (b.distance ?? 999) ||
      (b.set.releaseDate || '').localeCompare(a.set.releaseDate || '') ||
      a.card.id.localeCompare(b.card.id),
  );
  const evidenceOf = (p: Pooled) => (p.distance === undefined ? p.ocrEvidence : [...p.ocrEvidence, `artwork ${p.distance}`]);
  const best = ranked[0];
  const alternatives: ScanAlternative[] = ranked.slice(1, 1 + MAX_ALTERNATIVES).map((p) => ({ card: p.card, set: p.set, score: p.score, evidence: evidenceOf(p) }));
  const margin = best.score - (alternatives[0]?.score ?? 0);

  const hashStrong = best.distance !== undefined && best.distance <= ARTWORK_MATCH_BITS;
  const printing = best.ocrEvidence.some((e) => PRINTING_EVIDENCE.test(e));
  const species = best.ocrEvidence.some((e) => SPECIES_EVIDENCE.test(e));
  const inGroup = group.some((h) => h.id === best.card.id);
  const groupPrintings = new Set(group.map((h) => h.id)).size;
  const contradiction = hits[0].distance <= ARTWORK_MATCH_BITS && !inGroup;
  const confident = (hashStrong && (printing || (species && groupPrintings === 1))) || (best.ocrConfident && !contradiction);

  // Boxes: the OCR candidate's when the OCR saw this card or any card (one card per pocket), else the crop.
  const seen = ocr.find((c) => c.card.id === best.card.id) ?? ocr[0];
  const first: ScanCandidate = {
    key: best.card.id,
    card: best.card,
    set: best.set,
    score: best.score,
    margin,
    confident,
    evidence: evidenceOf(best),
    bbox: seen?.bbox ?? region,
    cardBox: seen?.cardBox ?? region,
    alternatives,
  };
  // Other physical cards the OCR saw in the crop (a neighbour's edge) stay behind the pocket's card.
  const rest = ocr.filter((c) => c !== seen && c.card.id !== best.card.id);
  return [first, ...rest];
}

/* ---------- loading the table ---------- */

const DATA_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/data`;

/** The data file holding a game's hashes, or null when the game has none (Yu-Gi-Oh! is not hashed yet). */
export function hashFileFor(game: string): string | null {
  return game === 'pokemon' ? 'hashes.json' : null;
}

const tables = new Map<string, Promise<HashTable | null>>();

/**
 * The game's hash table, fetched once (the promise is shared) and decoded;
 * null when the game has no table or the file is missing or stale (a spec
 * mismatch is logged, and the scanner just runs without artwork evidence).
 *
 * MERGE NOTE (branch claude/catalog-cache-freshness): the catalogs are fetched
 * there through `fetchJson(file, manifest)` in src/data/catalog.ts, whose URL
 * carries `?v=<sha256 prefix>` from public/data/manifest.json so the web build
 * can keep `force-cache`. This fetch should go through the same helper, and
 * `hashes.json` needs an entry in the manifest (scripts/data-manifest.mjs) —
 * a one-line change here once both branches are on main.
 */
export function loadHashTable(game: string): Promise<HashTable | null> {
  const file = hashFileFor(game);
  if (!file) return Promise.resolve(null);
  let p = tables.get(game);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(`${DATA_BASE}/${file}`, { cache: import.meta.env.DEV ? 'no-cache' : 'force-cache' });
        if (!res.ok) {
          console.warn(`[scanner] no artwork hash table for ${game}: HTTP ${res.status}`);
          return null;
        }
        return decodeHashFile((await res.json()) as HashFile);
      } catch (e) {
        console.warn(`[scanner] artwork hash table for ${game} unusable:`, e);
        return null;
      }
    })();
    tables.set(game, p);
  }
  return p;
}

/** Forget loaded tables (tests). */
export function resetHashTables(): void {
  tables.clear();
}
