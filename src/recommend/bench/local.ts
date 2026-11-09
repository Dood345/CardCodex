/**
 * Deck corpora on the developer's machine. Deck lists we may not ship (no
 * licence, or terms that allow private use only) live under
 * scripts/.cache/decks/<corpus>/, which git ignores; the benchmark reads them
 * there and only its aggregate numbers are ever committed.
 *
 * A corpus folder holds JSON files, each an array of decks:
 *   { "id": "...", "name": "...", "strength": 0.61,
 *     "cards": [{ "id": "base1-47", "name": "Diglett", "count": 3 }, ...] }
 * `strength` is optional (a win rate, or a placing turned so that higher is
 * better). A card is found by id, else by name (its newest printing). Files
 * whose name starts with "_" are skipped. Node only: never imported by the app.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogIndex } from '@/data/catalog';
import type { DeckCard } from '@/data/db';
import { normalizeText } from '@/data/normalize';
import type { BenchDeck, Corpus } from './bench';

interface FileDeck {
  id: string;
  name: string;
  strength?: number;
  cards: { id?: string; name?: string; count: number }[];
}

export interface LocalCorpus extends Corpus {
  /** Decks left out because more than three of their copies were not in the catalog. */
  skipped: number;
}

export function readCorpus(dir: string, id: string, index: CatalogIndex): LocalCorpus {
  const decks: BenchDeck[] = [];
  let skipped = 0;
  for (const file of readdirSync(dir).sort()) {
    if (file.startsWith('_') || !file.endsWith('.json')) continue;
    const list = JSON.parse(readFileSync(join(dir, file), 'utf8')) as FileDeck[];
    if (!Array.isArray(list)) continue;
    for (const d of list) {
      const cards: DeckCard[] = [];
      let lost = 0;
      for (const l of d.cards ?? []) {
        const card = (l.id && index.cardsById.get(l.id)) || (l.name && index.cardsByName.get(normalizeText(l.name))?.[0]);
        if (!card) {
          lost += l.count;
          continue;
        }
        const line = cards.find((c) => c.cardId === card.id);
        if (line) line.qty += l.count;
        else cards.push({ cardId: card.id, qty: l.count });
      }
      if (lost > 3 || !cards.length) {
        skipped++;
        continue;
      }
      const deck: BenchDeck = { id: d.id, name: d.name, cards };
      if (typeof d.strength === 'number') deck.strength = d.strength;
      decks.push(deck);
    }
  }
  return { id, label: id, decks, skipped };
}

/** Every corpus folder under `root` (scripts/.cache/decks), empty when the folder does not exist. */
export function readCorpora(root: string, index: CatalogIndex): LocalCorpus[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => readCorpus(join(root, e.name), e.name, index))
    .filter((c) => c.decks.length > 0);
}
