/**
 * Magic card text: Oracle text, keywords, colour identity, the mana a card
 * produces, the faces of multi-faced cards and constructed-format legality,
 * shipped as public/data/mtg/text.json (scripts/build-mtg-text.mjs, from
 * Scryfall's oracle_cards bulk file) and loaded only by the deck recommender
 * (./mtg.ts). The card browser, search and scanner never need it.
 *
 * Text belongs to the Oracle card, which every printing shares, so the file is
 * keyed by Oracle id (its first `idLength` hex digits, which the script keeps
 * distinct). Fields the catalog already has (name, front face's mana cost,
 * type line, mana value, colours, power, toughness, loyalty) are not repeated.
 */
import { fetchDataJson } from '@/data/catalog';

/** Legality bit order in the file. Mirrors FORMATS in scripts/build-mtg-text.mjs. */
export const MTG_TEXT_FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper'] as const;
export type MtgTextFormat = (typeof MTG_TEXT_FORMATS)[number];

/** The data file under public/data. */
export const MTG_TEXT_FILE = 'mtg/text.json';

/** One face of a multi-faced card (split, adventure, transform, modal double-faced, flip, meld). */
export interface MtgFaceText {
  /** Face name. */
  n: string;
  /** Face type line. */
  t: string;
  /** Face mana cost in brace notation. */
  c?: string;
  /** Face Oracle text, reminder text removed. */
  o?: string;
  p?: string;
  /** Toughness. */
  d?: string;
  /** Loyalty. */
  l?: string;
}

export interface MtgCardTextRow {
  /** Oracle text without reminder text (single-faced cards). */
  o?: string;
  /** Faces of a multi-faced card, in printed order. */
  f?: MtgFaceText[];
  /** Keyword indices into `MtgTextFile.keywords`. */
  k?: number[];
  /** Colour identity as WUBRG letters; absent for colourless. */
  ci?: string;
  /** Mana the card can produce, WUBRGC letters (Scryfall's produced_mana). */
  pm?: string;
  /** Bit i: legal (or restricted) in MTG_TEXT_FORMATS[i]. */
  lg: number;
  /** Bit i: restricted (one copy) in MTG_TEXT_FORMATS[i]. */
  rs?: number;
}

export interface MtgTextFile {
  version: number;
  game: 'mtg';
  builtAt: string;
  /** Which Scryfall file the text came from, with its date. */
  source: string;
  formats: string[];
  keywords: string[];
  /** Hex digits of the Oracle id (dashes dropped) that make a key. */
  idLength: number;
  ids: string[];
  cards: MtgCardTextRow[];
}

export interface MtgTextEntry {
  /** Oracle text of every face, faces separated by a line "//". */
  text: string;
  faces: MtgFaceText[];
  keywords: string[];
  /** Colour identity, WUBRG letters. */
  identity: string;
  /** Mana produced, WUBRGC letters. */
  produces: string;
  /** Formats the card is legal (or restricted) in. */
  legal: ReadonlySet<string>;
  /** Formats in which the card is restricted to one copy. */
  restricted: ReadonlySet<string>;
}

export interface MtgTextIndex {
  game: 'mtg';
  builtAt: string;
  source: string;
  /** Entries by key (see `keyOf`). */
  byKey: Map<string, MtgTextEntry>;
  /** The key of an Oracle id. */
  keyOf(oid: string): string;
  /** The entry of an Oracle id, if the file has it. */
  get(oid: string | undefined): MtgTextEntry | undefined;
}

const EMPTY: ReadonlySet<string> = new Set();

function formatsOf(bits: number | undefined, formats: readonly string[]): ReadonlySet<string> {
  if (!bits) return EMPTY;
  const out = new Set<string>();
  formats.forEach((f, i) => {
    if (bits & (1 << i)) out.add(f);
  });
  return out;
}

/** Pure: the file as lookups by Oracle id. */
export function buildMtgTextIndex(file: MtgTextFile): MtgTextIndex {
  const byKey = new Map<string, MtgTextEntry>();
  // Legality sets are shared between cards with the same bits (a few dozen distinct values).
  const sets = new Map<number, ReadonlySet<string>>();
  const setOf = (bits: number | undefined) => {
    const b = bits ?? 0;
    let s = sets.get(b);
    if (!s) sets.set(b, (s = formatsOf(b, file.formats)));
    return s;
  };
  for (let i = 0; i < file.ids.length; i++) {
    const row = file.cards[i];
    if (!row) continue;
    const faces = row.f ?? [];
    byKey.set(file.ids[i], {
      text: faces.length ? faces.map((f) => f.o ?? '').join('\n//\n') : (row.o ?? ''),
      faces,
      keywords: (row.k ?? []).map((k) => file.keywords[k]).filter(Boolean),
      identity: row.ci ?? '',
      produces: row.pm ?? '',
      legal: setOf(row.lg),
      restricted: row.rs ? setOf(row.rs) : EMPTY,
    });
  }
  const keyOf = (oid: string) => oid.replace(/-/g, '').slice(0, file.idLength).toLowerCase();
  return {
    game: 'mtg',
    builtAt: file.builtAt,
    source: file.source,
    byKey,
    keyOf,
    get: (oid) => (oid ? byKey.get(keyOf(oid)) : undefined),
  };
}

let loaded: Promise<MtgTextIndex | null> | undefined;

/** The Magic card text, fetched once; null when the file is not for Magic. */
export function loadMtgText(): Promise<MtgTextIndex | null> {
  loaded ??= fetchDataJson<MtgTextFile>(MTG_TEXT_FILE).then((f) => (f.game === 'mtg' ? buildMtgTextIndex(f) : null));
  return loaded;
}
