/**
 * Basic Energy cards that print no name. Since Sun & Moon most basic Energy
 * cards carry only the word "ENERGY", the type's symbol and a copyright line:
 * no name, number or set code for the text matcher, and a design shared by
 * every type, so the luma-only artwork hashes put Darkness, Water and
 * Fighting within a few bits of each other.
 *
 * When a frame's text is such a header and nothing else identified the card,
 * the card is matched against the basic Energy reference images only. The
 * artwork hash finds the design and where the card sits; then the picture of
 * the big symbol and the colour of the art under it (energy-features.ts,
 * references in public/data/energy-refs.json built by
 * scripts/build-energy-refs.mjs) pick the type among the look-alikes.
 *
 * The result is never confident: the printing in hand may not be in the
 * catalog at all (the unnumbered Sword & Shield Energy is not), so the user
 * confirms it, with the other printings of that Energy and the other types
 * as alternatives.
 */
import { fetchDataJson } from '@/data/catalog';
import type { CardLookup } from './artwork';
import { loadHashTable } from './artwork';
import { BASIC_ENERGY, chromaticity, correlation, ENERGY_THUMB, energyColor, normalizeCells, nudged, symbolCells } from './energy-features';
import type { RgbaImage } from './grid';
import { HASH_WORDS, lumaImage, matchPocket, windowOf, type HashTable, type HashWindow } from './hash';
import { LIVE_COARSE, LIVE_FINE, liveArtworkRegion } from './live-artwork';
import type { Box, RecognizedLine, ScanAlternative, ScanCandidate } from './types';

export { BASIC_ENERGY } from './energy-features';

const NAMED_ENERGY = /\b(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy)\s+Energy\b/i;

/** No reference image this far from the photo (bits of 128) is the same design. */
export const ENERGY_HASH_MAX = 36;
/** References within this many bits of the nearest one count as look-alikes of the same design. */
export const ENERGY_FAMILY_BITS = 12;
/**
 * The symbol must correlate at least this well with the chosen reference's. A tilted photo of the right card
 * reaches 0.80 to 0.93; what decides is the lead over the next type, below.
 */
export const ENERGY_SYMBOL_MIN = 0.7;
/** How much a chromaticity distance takes off a symbol correlation. */
export const ENERGY_COLOR_WEIGHT = 0.5;
/** The best type must lead the next by this much (correlation less the colour penalty). */
export const ENERGY_MARGIN = 0.06;
/** Margin around the expected outline that is sampled, so the alignment search has room. */
export const ENERGY_PAD = 0.15;
/** Small moves of the card outline tried when comparing symbols: the hash alignment is within a probe step, not exact. */
const NUDGES: readonly [number, number, number][] = [-0.02, -0.01, 0, 0.01, 0.02].flatMap((dx) =>
  [-0.02, -0.01, 0, 0.01, 0.02].flatMap((dy) => [0.96, 1, 1.04].map((s): [number, number, number] => [dx, dy, s])),
);

export interface EnergyRefFile {
  version: number;
  builtAt: string;
  game: string;
  /** Side of each symbol thumbnail, in cells. */
  thumb: number;
  ids: string[];
  /** Mean [r, g, b] of the art band per id, 0..255. */
  rgb: number[];
  /** base64 of `ids.length × thumb²` bytes: each symbol's cell means, row by row. */
  symbols: string;
}

export interface EnergyReferences {
  /** The artwork hashes of the basic Energy printings only. */
  table: HashTable;
  /** Chromaticity (r, g, b shares) per table entry. */
  chroma: Float32Array;
  /** Normalised symbol thumbnail per table entry, `cells` values each. */
  symbols: Float32Array;
  cells: number;
}

function decodeBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The energy-only hash table with the reference symbols and colours in the same order; null when nothing lines up. */
export function energyReferences(table: HashTable, file: EnergyRefFile): EnergyReferences | null {
  const cells = file.thumb * file.thumb;
  const raw = decodeBytes(file.symbols);
  if (file.thumb !== ENERGY_THUMB || raw.length !== file.ids.length * cells || file.rgb.length !== file.ids.length * 3) return null;
  const ids: string[] = [];
  const rows: number[] = [];
  const chroma: number[] = [];
  const kept: number[] = [];
  file.ids.forEach((id, i) => {
    const row = table.indexOf.get(id);
    if (row === undefined) return;
    ids.push(id);
    rows.push(row);
    kept.push(i);
    chroma.push(...chromaticity(file.rgb[i * 3], file.rgb[i * 3 + 1], file.rgb[i * 3 + 2]));
  });
  if (!ids.length) return null;
  const words = new Uint32Array(ids.length * HASH_WORDS);
  rows.forEach((row, k) => words.set(table.words.subarray(row * HASH_WORDS, (row + 1) * HASH_WORDS), k * HASH_WORDS));
  const symbols = new Float32Array(ids.length * cells);
  kept.forEach((i, k) => symbols.set(normalizeCells(raw.subarray(i * cells, (i + 1) * cells)), k * cells));
  return { table: { spec: table.spec, ids, words, indexOf: new Map(ids.map((id, i) => [id, i])) }, chroma: Float32Array.from(chroma), symbols, cells };
}

const loaded = new Map<string, Promise<EnergyReferences | null>>();

/** The game's Energy references, fetched once; null for a game without them (only Pokémon has Energy). */
export function loadEnergyReferences(game: string): Promise<EnergyReferences | null> {
  if (game !== 'pokemon') return Promise.resolve(null);
  let p = loaded.get(game);
  if (!p) {
    p = (async () => {
      try {
        const [table, file] = await Promise.all([loadHashTable(game), fetchDataJson<EnergyRefFile>('energy-refs.json')]);
        return table && file.game === game ? energyReferences(table, file) : null;
      } catch (e) {
        console.warn('[scanner] Energy references unavailable:', e);
        return null;
      }
    })();
    loaded.set(game, p);
  }
  return p;
}

/**
 * The "ENERGY" header line of a card that prints no Energy name, or null:
 * a line that is just the word (a "Basic" before it and a stray character
 * the symbol was read as are allowed), in a frame where no line names a type
 * of Energy. A card that prints "Darkness Energy" goes through the text
 * matcher like any other.
 */
export function bareEnergyHeader(lines: readonly RecognizedLine[]): RecognizedLine | null {
  if (lines.some((l) => NAMED_ENERGY.test(l.text))) return null;
  return lines.find((l) => /^(BASIC)?ENERGY[A-Z0-9]{0,2}$/.test(l.text.toUpperCase().replace(/[^A-Z0-9]/g, ''))) ?? null;
}

/**
 * The card outline for a header line, when nothing better says where the
 * card is: on these designs "ENERGY" runs from about 3 % to 32 % of the
 * card's width, centred 3.5 % down from its top. A rough start; the
 * alignment search refines it.
 */
export function energyBoxFromHeader(header: Box, cardAspect = 63 / 88): Box {
  const w = header.w / 0.29;
  const h = w / cardAspect;
  return { x: header.x - 0.03 * w, y: header.y + header.h / 2 - 0.035 * h, w, h };
}

export interface EnergyMatch {
  id: string;
  type: string;
  /** Hash distance to this reference (bits of 128). */
  hash: number;
  /** Correlation of the photo's symbol with this reference's, −1..1. */
  symbol: number;
  /** Chromaticity distance of the art under the symbol. */
  colour: number;
  /** `symbol` less the colour penalty: the higher, the better. */
  score: number;
}

export interface EnergyResult {
  /** The best reference of each type among the look-alikes, best first. */
  matches: EnergyMatch[];
  /** Where the card sits in the sampled image. */
  window: HashWindow;
}

/**
 * The basic Energy references that look like the card in `img` (a padded
 * crop, RGBA), the best of each type, best first; null when no reference is
 * the same design. `nominal` is where the card is expected in the crop;
 * `typeOf` names a reference's type (from its card name), so a reference the
 * catalog no longer has is skipped.
 */
export function matchBareEnergy(refs: EnergyReferences, img: RgbaImage, nominal: HashWindow, typeOf: (id: string) => string | undefined): EnergyResult | null {
  const luma = lumaImage(img.data, img.width, img.height);
  const { hits } = matchPocket(refs.table, luma, nominal, { coarse: LIVE_COARSE, fine: LIVE_FINE, k: Math.min(64, refs.table.ids.length) });
  const nearest = hits[0];
  if (!nearest?.window || nearest.distance > ENERGY_HASH_MAX) return null;
  const window = nearest.window;
  // The photo's symbol at the found outline and a few nudges of it, and its art colour, measured once.
  const probes = NUDGES.map(([dx, dy, s]) => normalizeCells(symbolCells(luma, nudged(window, dx, dy, s))));
  const colourOf = chromaticity(...energyColor(img.data, img.width, img.height, window));
  const best = new Map<string, EnergyMatch>();
  for (const h of hits) {
    if (h.distance > nearest.distance + ENERGY_FAMILY_BITS) break;
    const type = typeOf(h.id);
    if (!type) continue;
    let symbol = -1;
    for (const p of probes) symbol = Math.max(symbol, correlation(p, refs.symbols, h.index * refs.cells));
    const k = h.index * 3;
    const colour = Math.hypot(colourOf[0] - refs.chroma[k], colourOf[1] - refs.chroma[k + 1], colourOf[2] - refs.chroma[k + 2]);
    const score = symbol - ENERGY_COLOR_WEIGHT * colour;
    const prev = best.get(type);
    if (!prev || score > prev.score) best.set(type, { id: h.id, type, hash: h.distance, symbol, colour, score });
  }
  return { matches: [...best.values()].sort((a, b) => b.score - a.score), window };
}

/** True when the best match is a real one: its symbol is the photo's, and no other type comes close. */
export function acceptEnergy(matches: readonly EnergyMatch[]): boolean {
  const best = matches[0];
  if (!best || best.symbol < ENERGY_SYMBOL_MIN) return false;
  return matches.length < 2 || best.score - matches[1].score >= ENERGY_MARGIN;
}

export interface BareEnergyInput {
  lines: readonly RecognizedLine[];
  frame: { w: number; h: number };
  /** Where the user framed the card (a snapped photo), when known. */
  guide?: Box;
  refs: EnergyReferences;
  lookup: CardLookup;
  /** `region` of the frame as RGBA, about 272 px wide. */
  sample(region: Box): RgbaImage;
}

/**
 * The candidate for a card that shows only "ENERGY", or null when the frame
 * has no such header or no basic Energy matches by picture. The candidate is
 * the look-alike reference, unsure, with the other pictured printings of that
 * Energy (nearest the card's copyright year first) and then the other types
 * as alternatives.
 */
export function scanBareEnergy({ lines, frame, guide, refs, lookup, sample }: BareEnergyInput): ScanCandidate | null {
  const header = bareEnergyHeader(lines);
  if (!header) return null;
  const box = guide ?? energyBoxFromHeader(header.bbox, refs.table.spec.cardAspect);
  const region = liveArtworkRegion(box, frame, ENERGY_PAD);
  if (!region) return null;
  const typeOf = (id: string) => {
    const name = lookup(id)?.card.name;
    return name ? BASIC_ENERGY.exec(name)?.[1] : undefined;
  };
  const result = matchBareEnergy(refs, sample(region), windowOf(box, region), typeOf);
  if (!result || !acceptEnergy(result.matches)) return null;
  const { matches, window: w } = result;
  const best = matches[0];
  const found = lookup(best.id);
  if (!found) return null;

  const year = Number(/((?:19|20)\d{2})\s*Pok/i.exec(lines.map((l) => l.text).join(' '))?.[1]) || 0;
  const yearOf = (id: string) => Number(lookup(id)?.set.releaseDate?.slice(0, 4)) || 0;
  const score = Math.max(0.3, Math.min(0.7, best.score - 0.25));
  const alt = (id: string, s: number, evidence: string[]): ScanAlternative | null => {
    const f = lookup(id);
    return f ? { card: f.card, set: f.set, score: s, evidence } : null;
  };
  // The same Energy in its other pictured printings: the one in hand is often one of them.
  const samePrintings = refs.table.ids
    .filter((id) => id !== best.id && typeOf(id) === best.type)
    .sort((a, b) => Math.abs(yearOf(a) - year) - Math.abs(yearOf(b) - year) || yearOf(b) - yearOf(a) || (a < b ? -1 : 1))
    .slice(0, 7)
    .map((id) => alt(id, score - 0.05, [`${best.type} Energy, another printing`]));
  const otherTypes = matches.slice(1, 6).map((m) => alt(m.id, Math.max(0.05, m.score - 0.35), [`symbol ${m.type} ${Math.round(m.symbol * 100)}%`]));
  const alternatives = [...samePrintings, ...otherTypes].filter((a): a is ScanAlternative => a !== null);
  const cardBox: Box = { x: region.x + w.x * region.w, y: region.y + w.y * region.h, w: w.w * region.w, h: w.h * region.h };
  return {
    key: found.card.id,
    card: found.card,
    set: found.set,
    score,
    margin: best.score - (matches[1]?.score ?? 0),
    // The printing is a guess even when the type is certain: the user confirms it.
    confident: false,
    evidence: ['text "ENERGY"', `symbol ${best.type} ${Math.round(best.symbol * 100)}%`, `artwork ${best.hash}`],
    bbox: cardBox,
    cardBox,
    alternatives,
  };
}

/**
 * `found` with the bare-Energy candidate put first when there is one and
 * nothing in the frame was identified for certain; a candidate sitting on the
 * same card (its centre inside the Energy's outline) gives way to it.
 */
export function withBareEnergy(found: readonly ScanCandidate[], input: BareEnergyInput): ScanCandidate[] {
  if (found.some((c) => c.confident)) return [...found];
  const energy = scanBareEnergy(input);
  if (!energy) return [...found];
  const b = energy.cardBox;
  const inside = (c: ScanCandidate) => {
    const cx = c.cardBox.x + c.cardBox.w / 2;
    const cy = c.cardBox.y + c.cardBox.h / 2;
    return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
  };
  return [energy, ...found.filter((c) => !inside(c))];
}
