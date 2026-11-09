/**
 * Yu-Gi-Oh! card text: each card's effect, an Extra Deck monster's materials
 * line, the Pendulum Effect and the card's status on the TCG Forbidden &
 * Limited list, shipped as public/data/ygo/text.json
 * (scripts/build-ygo-text.mjs, from the YGOPRODeck cardinfo download) and read
 * only by the deck recommender (src/recommend/ygo.ts).
 *
 * Keyed by passcode: every printing of a card (one CatalogCard each) shares
 * its text, so the file holds each card once. Normal Monsters carry flavour
 * text, not rules, and are left out.
 */

export interface YgoTextFile {
  version: number;
  game: 'ygo';
  builtAt: string;
  source: { name: string; url: string; fetchedAt: string };
  /** Passcodes; the arrays below are parallel to it. */
  pc: number[];
  /** Monster effect (materials line removed) or Spell/Trap text. */
  fx: string[];
  /** Materials line of a Fusion, Synchro, Xyz or Link monster, "" when none. */
  mt: string[];
  /** Pendulum Effect, "" when none. */
  pe: string[];
  /** Passcode → TCG status: 0 Forbidden, 1 Limited, 2 Semi-Limited; absent cards are Unlimited. */
  ban: Record<string, number>;
}

export interface YgoText {
  /** Effect text ("" when the card has none). */
  fx: string;
  /** Materials line ("" when none). */
  mt: string;
  /** Pendulum Effect ("" when none). */
  pe: string;
}

export interface YgoTextIndex {
  builtAt: string;
  /** When the YGOPRODeck data was downloaded. */
  fetchedAt: string;
  byPc: Map<number, YgoText>;
  /** Copies the TCG list allows, by passcode: 0, 1 or 2; absent means 3. */
  tcgLimit: Map<number, number>;
}

/** Copies of a card a TCG deck may hold under the list: 0 Forbidden, 1 Limited, 2 Semi-Limited, 3 otherwise. */
export function tcgLimitOf(index: YgoTextIndex, pc: number | undefined): number {
  return pc === undefined ? 3 : (index.tcgLimit.get(pc) ?? 3);
}

export const TCG_STATUS = ['Forbidden', 'Limited', 'Semi-Limited'] as const;

export function buildYgoTextIndex(file: YgoTextFile): YgoTextIndex {
  const byPc = new Map<number, YgoText>();
  for (let i = 0; i < file.pc.length; i++) byPc.set(file.pc[i], { fx: file.fx[i] ?? '', mt: file.mt[i] ?? '', pe: file.pe[i] ?? '' });
  const tcgLimit = new Map<number, number>();
  for (const [pc, v] of Object.entries(file.ban)) tcgLimit.set(Number(pc), v);
  return { builtAt: file.builtAt, fetchedAt: file.source?.fetchedAt ?? '', byPc, tcgLimit };
}
