/**
 * A corpus the engine builds itself, from data that ships: one deck per seed
 * card. The score judges like these decks by construction (the builder climbs
 * the score), so what this corpus tests is everything else: that the builder
 * still finishes legal decks, and that judges independent of the score (a
 * playtest, a win rate) agree the built decks are good.
 */
import type { CatalogCard } from '@/data/types';
import { buildDeck, type SuggestOptions } from '../builder';
import type { PokemonEvaluator } from '../pokemon';
import type { DeckEvaluator } from '../types';
import type { Corpus } from './bench';

export function builtCorpus(ev: DeckEvaluator, seeds: readonly CatalogCard[], options: SuggestOptions, pool = ev.pool(options)): Corpus {
  return {
    id: 'built',
    label: `Decks built from ${seeds.length} seeds`,
    decks: seeds.map((seed) => ({ id: `built-${seed.id}`, name: seed.name, cards: buildDeck(ev, [seed.id], options, pool).cards })),
  };
}

/**
 * Pokémon seeds picked by rule, not by taste: per Energy type, the Stage 2
 * Pokémon of the pool whose best attack keeps up the most damage a turn
 * (`sustained`: the printed number read with its text, halved for an attack
 * that rests its user or discards its Energy; ties to the lower id),
 * `perType` of them.
 */
export function pokemonSeeds(ev: PokemonEvaluator, pool: readonly CatalogCard[], perType = 1): CatalogCard[] {
  const byType = new Map<string, { card: CatalogCard; damage: number }[]>();
  for (const card of pool) {
    const f = ev.features(card);
    if (!f.isPokemon || f.stage !== 'Stage 2' || !f.best || !f.types.length) continue;
    const type = f.types[0];
    let list = byType.get(type);
    if (!list) byType.set(type, (list = []));
    list.push({ card, damage: f.best.sustained });
  }
  const out: CatalogCard[] = [];
  for (const type of [...byType.keys()].sort()) {
    const list = byType.get(type)!.sort((a, b) => b.damage - a.damage || (a.card.id < b.card.id ? -1 : 1));
    out.push(...list.slice(0, perType).map((x) => x.card));
  }
  return out;
}
