/** The Settings text about the recommender must say what the evaluators really measure. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildIndex } from '@/data/catalog';
import type { Catalog, SpeciesFile } from '@/data/types';
import { GAME_IDS } from '@/games/ids';
import { expandMtgCatalog, type MtgCatalogFile } from '@/games/mtg/catalog';
import { expandYgoCatalog, type YgoCatalogFile } from '@/games/ygo/catalog';
import { aboutRecommender } from './about';
import { PLAY_GAMES } from './advice';
import { buildTextIndex, type CardTextFile } from './card-text';
import { hasRecommender } from './index';
import { createMtgEvaluator } from './mtg';
import { buildMtgTextIndex, type MtgTextFile } from './mtg-text';
import { createPokemonEvaluator } from './pokemon';
import type { DeckEvaluator } from './types';
import { createYgoEvaluator } from './ygo';
import { buildYgoTextIndex, type YgoTextFile } from './ygo-text';

const dataDir = new URL('../../public/data/', import.meta.url);
const read = <T,>(f: string): T => JSON.parse(readFileSync(new URL(f, dataDir), 'utf8')) as T;

const evaluators: Record<string, () => DeckEvaluator> = {
  pokemon: () =>
    createPokemonEvaluator({
      index: buildIndex(read<Catalog>('catalog.json'), read<SpeciesFile>('species.json').species),
      text: buildTextIndex(read<CardTextFile>('text.json')),
    }),
  ygo: () =>
    createYgoEvaluator({
      index: buildIndex(expandYgoCatalog(read<YgoCatalogFile>('ygo/catalog.json')), []),
      text: buildYgoTextIndex(read<YgoTextFile>('ygo/text.json')),
    }),
  mtg: () =>
    createMtgEvaluator({
      index: buildIndex(expandMtgCatalog(read<MtgCatalogFile>('mtg/catalog.json')), []),
      text: buildMtgTextIndex(read<MtgTextFile>('mtg/text.json')),
      format: 'any',
    }),
};

/** "Draw and search" is mentioned when the text has "draw and search"; "Basic Pokémon" likewise. */
const mentions = (text: string, label: string) => text.toLowerCase().includes(label.toLowerCase());

describe('how decks are recommended (Settings → About)', () => {
  it('has a text for every game with a recommender, and for no other', () => {
    for (const game of GAME_IDS) expect(aboutRecommender(game) !== null, game).toBe(hasRecommender(game));
  });

  for (const game of Object.keys(evaluators)) {
    it(`names every part the ${game} deck check shows`, { timeout: 60_000 }, () => {
      const about = aboutRecommender(game as Parameters<typeof aboutRecommender>[0])!;
      const labels = evaluators[game]()
        .score([])
        .parts.map((p) => p.label);
      expect(labels.length).toBeGreaterThanOrEqual(7);
      for (const label of labels) expect(mentions(about.parts, label), `${game}: "${label}" is not in the text`).toBe(true);
    });
  }

  it('says the same things in every game, and what is particular to each', () => {
    const pokemon = aboutRecommender('pokemon')!.paragraphs.join(' ');
    const ygo = aboutRecommender('ygo')!.paragraphs.join(' ');
    const mtg = aboutRecommender('mtg')!.paragraphs.join(' ');
    for (const text of [pokemon, ygo, mtg]) {
      expect(text).toMatch(/on this device/);
      expect(text).toMatch(/Nothing is uploaded/);
      expect(text).toMatch(/score out of 100/);
      expect(text).toMatch(/knows nothing about tournament results/);
    }
    // The copy rule is stated whole: basic Energy has no limit, Special Energy counts toward the four.
    expect(pokemon).toMatch(/four copies of a card by name, Special Energy included, and any number of basic Energy/);
    // Only Pokémon decks are played, with the number of games the screens really use.
    expect(pokemon).toContain(`${PLAY_GAMES} practice games`);
    expect(pokemon).toMatch(/Tune by playing/);
    // What the pilot does with card text, and the two reasons a card sits unused.
    expect(pokemon).toMatch(/plays the cards as they are written/);
    expect(pokemon).toMatch(/Trainers, Tools, Stadiums, Abilities and Special Energy/);
    expect(pokemon).toMatch(/With nobody across the table/);
    expect(pokemon).toMatch(/Tera, Future and Ancient/);
    expect(ygo).not.toMatch(/test pilot plays/);
    expect(ygo).toMatch(/scored, not played/);
    expect(mtg).toMatch(/scored, not played/);
    expect(ygo).toMatch(/Extra Deck is filled/);
    expect(mtg).not.toMatch(/Extra Deck/);
  });
});
