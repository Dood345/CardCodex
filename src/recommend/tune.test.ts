/** Tuning a built deck by playing it, on the real Pokémon catalog and card text. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildIndex } from '@/data/catalog';
import type { DeckCard } from '@/data/db';
import type { Catalog, SpeciesFile } from '@/data/types';
import { mainCount } from './advice';
import { pokemonSeeds } from './bench/built';
import { buildDeck, type SuggestOptions } from './builder';
import { buildTextIndex, type CardTextFile } from './card-text';
import { createPokemonEvaluator } from './pokemon';
import { pokemonPlaytest, withPokemonPlaytest } from './pokemon-play';
import { canTune, tuneByPlay, tuneRound, tuneStart } from './tune';

const dataDir = new URL('../../public/data/', import.meta.url);
const read = <T,>(f: string): T => JSON.parse(readFileSync(new URL(f, dataDir), 'utf8')) as T;
const index = buildIndex(read<Catalog>('catalog.json'), read<SpeciesFile>('species.json').species);
const plain = createPokemonEvaluator({ index, text: buildTextIndex(read<CardTextFile>('text.json')) });
const ev = withPokemonPlaytest(plain);

const options: SuggestOptions = { source: 'catalog', collection: new Map(), format: 'standard' };
const pool = ev.pool(options);
// Seeds by rule: the strongest Stage 2 of each Energy type in Standard; the first is the deck under test.
const seed = pokemonSeeds(plain, pool)[0];
const built = buildDeck(ev, [seed.id], options, pool);

describe('playtest summary', () => {
  it('says how the deck played, in lines a player reads', () => {
    const s = pokemonPlaytest(plain, built.cards, { games: 200, seed: 1 });
    expect(s.games).toBe(200);
    expect(s.plan).toContain(seed.name);
    expect(s.value).toBeGreaterThan(0);
    expect(s.lines[0]).toMatch(/^Attacks by turn 3 in \d+% of games, by turn 4 in \d+%$/);
    expect(s.lines[1]).toMatch(/^\d+ damage a turn over the first 6 turns$/);
    expect(s.lines[2]).toMatch(/^Something to play on \d+% of turns$/);
    expect(pokemonPlaytest(plain, built.cards, { games: 200, seed: 1 })).toEqual(s);
  });

  it('reports a deck that cannot start', () => {
    const energyOnly: DeckCard[] = built.cards.filter((l) => ev.kindOf(ev.card(l.cardId)!) === 'energy');
    const s = pokemonPlaytest(plain, energyOnly, { games: 50, seed: 1 });
    expect(s.value).toBe(0);
    expect(s.lines[0]).toMatch(/no Basic Pokémon/);
  });
});

describe('tuning by play', () => {
  it('is on offer only for an evaluator that can play', () => {
    expect(canTune(ev)).toBe(true);
    expect(canTune(plain)).toBe(false);
    expect(tuneByPlay(plain, built.cards, options, pool)).toBeNull();
    expect(tuneRound(plain, tuneStart(built.cards), options, pool).done).toBe(true);
  });

  it('makes a built deck play better and keeps it legal and about its seed', { timeout: 120_000 }, () => {
    const r = tuneByPlay(ev, built.cards, { ...options, rounds: 5, keep: new Set([seed.name]) }, pool)!;
    expect(r.steps.length).toBeGreaterThan(0);
    // Judged on games no round has seen.
    expect(r.after.value).toBeGreaterThan(r.before.value);
    expect(mainCount(ev, r.cards)).toBe(60);
    expect(ev.score(r.cards).issues).toEqual([]);
    expect(r.cards.some((l) => ev.card(l.cardId)!.name === seed.name)).toBe(true);
    expect(r.after.plan).toContain(seed.name);
    for (const s of r.steps) {
      expect(s.to).toBeGreaterThan(s.from);
      expect(s.out.name).not.toBe(s.in.name);
    }
    // One copy out and one in per step: the lists differ by exactly the steps.
    const qty = (cards: readonly DeckCard[]) => {
      const m = new Map<string, number>();
      for (const l of cards) m.set(l.cardId, (m.get(l.cardId) ?? 0) + l.qty);
      return m;
    };
    const before = qty(built.cards);
    for (const s of r.steps) {
      before.set(s.out.id, (before.get(s.out.id) ?? 0) - 1);
      before.set(s.in.id, (before.get(s.in.id) ?? 0) + 1);
    }
    const after = qty(r.cards);
    for (const [id, n] of before) expect(after.get(id) ?? 0, id).toBe(n);
  });

  it('goes one round at a time for the screens and stops when nothing helps', { timeout: 120_000 }, () => {
    let state = tuneStart(built.cards);
    expect(state).toMatchObject({ round: 0, done: false, steps: [] });
    state = tuneRound(ev, state, { ...options, keep: new Set([seed.name]) }, pool);
    expect(state.round).toBe(1);
    expect(mainCount(ev, state.cards)).toBe(60);
    // The same round again from the same state gives the same answer.
    expect(tuneRound(ev, tuneStart(built.cards), { ...options, keep: new Set([seed.name]) }, pool)).toEqual(state);
    const stopped = tuneRound(ev, { ...state, done: true }, options, pool);
    expect(stopped.done).toBe(true);
    expect(stopped.cards).toEqual(state.cards);
  });
});
