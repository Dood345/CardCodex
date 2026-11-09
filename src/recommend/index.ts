/**
 * Which games have a deck recommender, and how to get one. The evaluator and
 * its card text load on first use (the text file is megabytes the Pokédex,
 * search and scanner never need), once per catalog.
 */
import type { CatalogIndex } from '@/data/catalog';
import type { GameId } from '@/games/ids';
import { fetchDataJson } from '@/data/catalog';
import { loadCardText } from './card-text';
import type { DeckEvaluator } from './types';
import type { YgoTextFile } from './ygo-text';

type Loader = (index: CatalogIndex) => Promise<DeckEvaluator | null>;

const LOADERS: Partial<Record<GameId, Loader>> = {
  pokemon: async (index) => {
    const [text, mod, play] = await Promise.all([loadCardText('pokemon'), import('./pokemon'), import('./pokemon-play')]);
    return text ? play.withPokemonPlaytest(mod.createPokemonEvaluator({ index, text })) : null;
  },
  ygo: async (index) => {
    const [file, mod, textMod, practice] = await Promise.all([
      fetchDataJson<YgoTextFile>('ygo/text.json'),
      import('./ygo'),
      import('./ygo-text'),
      import('./practice'),
    ]);
    const text = textMod.buildYgoTextIndex(file);
    // The Forbidden & Limited list changes the copy limits, so each format has its own evaluator.
    const made = new Map<string, DeckEvaluator>();
    const make = (format: string): DeckEvaluator => {
      let ev = made.get(format);
      if (!ev) {
        const base = mod.createYgoEvaluator({ index, text, format });
        ev = { ...base, forFormat: make, practice: (cards, seed) => practice.dealPlain(base, cards, seed, mod.OPENING_HAND) };
        made.set(format, ev);
      }
      return ev;
    };
    return make('tcg');
  },
  mtg: async (index) => {
    const [textMod, mod, practice] = await Promise.all([import('./mtg-text'), import('./mtg'), import('./practice')]);
    const text = await textMod.loadMtgText();
    if (!text) return null;
    // Legality and the restricted list follow the format, so each format has its own evaluator (caches shared).
    const base = mod.createMtgEvaluator({ index, text, format: 'any' });
    const made = new Map<string, DeckEvaluator>();
    const make = (format: string): DeckEvaluator => {
      let ev = made.get(format);
      if (!ev) {
        const forFormat = base.withFormat(format);
        ev = {
          ...forFormat,
          forFormat: make,
          // An opening hand of seven; mulligans are the player's call, so none is taken here.
          practice: (cards, seed) => practice.dealPlain(forFormat, cards, seed, 7),
          seedIdeas: (pool, count) => mod.mtgSeeds(forFormat, pool, 2).slice(0, count),
        };
        made.set(format, ev);
      }
      return ev;
    };
    return make('any');
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
