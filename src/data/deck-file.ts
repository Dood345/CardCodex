/**
 * A deck as a small file: `<name>.ccdeck`, JSON inside, the same deck the
 * share code carries (src/data/deck-code.ts). It goes out through the share
 * sheet (src/app/share.ts) and comes back in through the Android file
 * association (src/app/deepLinks.ts) or the picker in Decks → Import; either
 * way the opened text is held here for the import page, which decodes it.
 */
import type { DeckCard } from './db';
import { decodeDeck, findDeckCode, type DeckShare } from './deck-code';
import { isGameId } from '@/games/ids';

export const DECK_FILE_EXT = '.ccdeck';
/** The import page reads the held file at this route (src/pages/DeckImportPage.tsx). */
export const DECK_FILE_ROUTE = '/decks/import/file';
export const NOT_A_DECK_FILE = 'That file is not a CardCodex deck.';

/** A safe file name for a deck: letters, digits and dashes, then the extension. */
export function deckFileName(name: string): string {
  const safe = name
    .normalize('NFKD')
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `${safe || 'deck'}${DECK_FILE_EXT}`;
}

/** The text of a deck file. */
export function encodeDeckFile(deck: DeckShare, at: Date = new Date()): string {
  return JSON.stringify(
    {
      cardcodex: 'deck',
      v: 1,
      game: deck.game,
      name: deck.name,
      // `side: true` marks a side-deck line; a 1.5.0 reader ignores it and puts the copies in the deck.
      cards: deck.cards.map((c) => (c.zone === 'side' ? { id: c.cardId, qty: c.qty, side: true } : { id: c.cardId, qty: c.qty })),
      exportedAt: at.toISOString(),
    },
    null,
    2,
  );
}

/**
 * The deck in an opened file: a .ccdeck file, or a saved share message with
 * a code in it. Throws on anything else.
 */
export async function decodeDeckText(text: string): Promise<DeckShare> {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      throw new Error(NOT_A_DECK_FILE);
    }
    const r = raw as { cardcodex?: unknown; v?: unknown; game?: unknown; name?: unknown; cards?: unknown };
    if (!r || r.cardcodex !== 'deck' || r.v !== 1 || !isGameId(r.game) || typeof r.name !== 'string' || !Array.isArray(r.cards)) {
      throw new Error(NOT_A_DECK_FILE);
    }
    const cards: DeckCard[] = [];
    for (const line of r.cards as ({ id?: unknown; qty?: unknown; side?: unknown } | null)[]) {
      if (!line || typeof line.id !== 'string') continue;
      const qty = Math.min(99, Math.floor(Number(line.qty)));
      if (qty > 0) cards.push(line.side === true ? { cardId: line.id, qty, zone: 'side' } : { cardId: line.id, qty });
    }
    return { game: r.game, name: r.name.trim().slice(0, 80) || 'Shared deck', cards };
  }
  if (findDeckCode(text)) return decodeDeck(text);
  throw new Error(NOT_A_DECK_FILE);
}

/** An opened file, waiting for the import page: its text, or why it could not be read. */
export interface HeldDeckFile {
  name?: string;
  text?: string;
  error?: string;
}

let held: HeldDeckFile | null = null;

export function holdDeckFile(file: HeldDeckFile): void {
  held = file;
}

/** The last opened file. Stays until another is opened, so the page survives a re-render. */
export function heldDeckFile(): HeldDeckFile | null {
  return held;
}
