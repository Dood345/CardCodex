/**
 * Which games have a deck recommender, and how to get one. The evaluator and
 * its card text load on first use (the text file is megabytes the Pokédex,
 * search and scanner never need), once per catalog.
 */
import type { CatalogIndex } from '@/data/catalog';
import type { GameId } from '@/games/ids';
import { loadCardText } from './card-text';
import type { DeckEvaluator } from './types';

type Loader = (index: CatalogIndex) => Promise<DeckEvaluator | null>;

const LOADERS: Partial<Record<GameId, Loader>> = {
  pokemon: async (index) => {
    const [text, mod] = await Promise.all([loadCardText('pokemon'), import('./pokemon')]);
    return text ? mod.createPokemonEvaluator({ index, text }) : null;
  },
};

/** True when the game has an evaluator, so the deck screens can offer the check and the builder. */
export function hasRecommender(game: GameId): boolean {
  return LOADERS[game] !== undefined;
}

const loaded = new WeakMap<CatalogIndex, Promise<DeckEvaluator | null>>();

/** The evaluator for a catalog's game, built once per catalog; null when the game has none. */
export function loadEvaluator(index: CatalogIndex): Promise<DeckEvaluator | null> {
  let p = loaded.get(index);
  if (!p) {
    const load = LOADERS[index.game];
    p = load ? load(index) : Promise.resolve(null);
    loaded.set(index, p);
    // A failed fetch should be retried the next time someone asks.
    p.catch(() => loaded.delete(index));
  }
  return p;
}
