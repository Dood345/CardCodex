/**
 * Public types of the camera card-recognition module.
 *
 * Coordinate convention: every `Box` is in SOURCE-FRAME pixels, i.e. the
 * pixel space of the (possibly downscaled) canvas that was handed to the
 * recognizer. `useCardScanner` exposes that space as `frameSize`; map it onto
 * the on-screen `<video>` with `coverTransform` (camera.ts).
 */
import type { CatalogCard, CatalogSet } from '../data/types';

/** Axis-aligned rectangle in source-frame pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One line of text as returned by an OCR engine. */
export interface RecognizedLine {
  text: string;
  bbox: Box;
  /** Engine confidence mapped to 0..1 (ML Kit gives none; see mlkit.ts). */
  confidence: number;
}

/** Which OCR engine produced a result. */
export type EngineName = 'mlkit' | 'tesseract';

/**
 * Collector number as printed at the bottom-left, e.g. "057/198" or
 * "TG01/TG30". `num` is canonical (see `canonicalNum`): upper-case letter
 * prefix + digits without leading zeros ("57", "TG1", "SWSH123").
 */
export interface NumberObservation {
  kind: 'number';
  num: string;
  /** Printed denominator (== CatalogSet.official), absent for bare numbers. */
  total?: number;
  /** Letter prefix of the denominator ("TG" in "TG01/TG30"), if any. */
  totalPrefix?: string;
  /** How the number was recovered; 'loose' = guessed separator ("47102"). */
  quality: 'clean' | 'noisy' | 'loose';
  raw: string;
  bbox: Box;
  lineIndex: number;
}

/** A 2–4 character token that resembles a printed set code ("SVI", "PAL"). */
export interface SetCodeObservation {
  kind: 'setCode';
  /** Token as read (upper-cased). */
  code: string;
  /** Catalog abbreviation it matched (base part, e.g. "BRS" for "BRS:TG"). */
  abbr: string;
  /** Edit distance between `code` and `abbr` (0 or 1). */
  distance: number;
  bbox: Box;
  lineIndex: number;
}

/** Hit points. `explicit` = the letters "HP" were read next to the value. */
export interface HpObservation {
  kind: 'hp';
  hp: number;
  explicit: boolean;
  bbox: Box;
  lineIndex: number;
}

/** A line considered as a potential card name (normalized, see `normalizeName`). */
export interface NameObservation {
  kind: 'name';
  /** Normalized line text. */
  norm: string;
  raw: string;
  bbox: Box;
  lineIndex: number;
}

/**
 * National Pokédex number from the Pokédex line printed on Pokémon cards since
 * the Black & White era: "NO. 0204 Bagworm Pokémon HT: 2' WT: 15.9 lbs." (SV),
 * "NO. 162 Long Body Pokémon" (SWSH). Often the only line OCR reads cleanly on
 * a card whose name is set in a stylised font, so it is a strong species cue.
 */
export interface DexObservation {
  kind: 'dex';
  dex: number;
  raw: string;
  bbox: Box;
  lineIndex: number;
}

export type Observation =
  | NumberObservation
  | SetCodeObservation
  | HpObservation
  | NameObservation
  | DexObservation;

/** Everything parsed from one frame's lines. */
export interface FrameObservations {
  lines: RecognizedLine[];
  numbers: NumberObservation[];
  setCodes: SetCodeObservation[];
  hps: HpObservation[];
  names: NameObservation[];
  dexes: DexObservation[];
}

/**
 * A game's matcher: OCR lines of one frame → one candidate per physical card.
 * Built once per loaded catalog by the game profile (src/games); the camera
 * hook and the binder-page scanner only ever call `scanLines`.
 */
export interface ScanMatcher {
  readonly game: string;
  scanLines(lines: readonly RecognizedLine[]): ScanCandidate[];
}

/** One ranked alternative for a detected card (for tap-to-correct). */
export interface ScanAlternative {
  card: CatalogCard;
  set: CatalogSet;
  /** 0..1, same scale as ScanCandidate.score. */
  score: number;
  evidence: string[];
}

/**
 * One detected PHYSICAL card in a frame: the best guess plus alternatives.
 * The UI draws one tappable chip per candidate at `bbox`.
 */
export interface ScanCandidate {
  /**
   * Stable key for React lists / tracking. In `matchObservations` output it is
   * the best card's id; `useCardScanner` replaces it with a track id that
   * survives the best guess changing between frames.
   */
  key: string;
  card: CatalogCard;
  set: CatalogSet;
  /** 0..1 confidence of the best guess (see match.ts for the scale). */
  score: number;
  /** Score gap to the first alternative (0..1). Small margin = ambiguous. */
  margin: number;
  /** True when score and margin are high enough to add without asking. */
  confident: boolean;
  /** Human-readable reasons, e.g. ["number 57/198", "name \"Wugtrio\""]. */
  evidence: string[];
  /** Union of contributing lines (source-frame px). */
  bbox: Box;
  /** Estimated outline of the whole physical card (source-frame px). */
  cardBox: Box;
  /** Other plausible cards, best first (excludes `card`). Up to ~12. */
  alternatives: ScanAlternative[];
}
