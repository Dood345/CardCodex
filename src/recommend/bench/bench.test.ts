/**
 * The benchmark's own arithmetic, and a small run on decks the engine builds
 * from shipped data, so CI notices when the score stops telling a deck from a
 * damaged copy. The full run over local corpora is `npm run deck-bench`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildIndex } from '@/data/catalog';
import type { DeckCard } from '@/data/db';
import type { Catalog, SpeciesFile } from '@/data/types';
import { buildTextIndex, type CardTextFile } from '../card-text';
import { createPokemonEvaluator } from '../pokemon';
import type { SuggestOptions } from '../builder';
import { compareReports, formatReport, roundRobin, runBench, scoreJudges, type BenchDeck, type BenchReport, type Corpus, type Judge } from './bench';
import { builtCorpus, pokemonSeeds } from './built';
import { copiesOf, DAMAGES, eraPool, linesOf, randomPile, swapAny, swapKind } from './damage';
import { auc, mean, pairedWins, ranks, spearman } from './metrics';
import { duelJudge, playtestJudges, simulatedDuel } from './sim-judges';
import { mulberry32, shuffled } from './rng';

const dataDir = new URL('../../../public/data/', import.meta.url);
const read = <T,>(f: string): T => JSON.parse(readFileSync(new URL(f, dataDir), 'utf8')) as T;
const index = buildIndex(read<Catalog>('catalog.json'), read<SpeciesFile>('species.json').species);
const ev = createPokemonEvaluator({ index, text: buildTextIndex(read<CardTextFile>('text.json')) });

const options: SuggestOptions = { source: 'catalog', collection: new Map(), format: 'standard' };
const pool = ev.pool(options);
const seeds = pokemonSeeds(ev, pool);

describe('metrics', () => {
  it('counts paired wins and the area under the curve with ties as half', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([])).toBe(0);
    expect(pairedWins([3, 2, 1], [1, 2, 3])).toBeCloseTo(0.5);
    expect(pairedWins([5, 5], [1, 2])).toBe(1);
    expect(auc([3, 4], [1, 2])).toBe(1);
    expect(auc([1, 2], [3, 4])).toBe(0);
    expect(auc([1, 3], [2, 2])).toBe(0.5);
    expect(auc([2], [2])).toBe(0.5);
  });

  it('ranks with shared ranks and correlates them', () => {
    expect(ranks([10, 30, 20, 20])).toEqual([1, 4, 2.5, 2.5]);
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    expect(spearman([1, 1, 1], [1, 2, 3])).toBe(0);
    expect(spearman([1], [1])).toBe(0);
  });
});

describe('seeded randomness', () => {
  it('repeats for a seed and differs between seeds', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const c = mulberry32(8);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect([c(), c(), c()]).not.toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(shuffled(mulberry32(1), [1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('damage', () => {
  const cards: DeckCard[] = builtCorpus(ev, seeds.slice(0, 1), options, pool).decks[0].cards;
  const era = eraPool(ev, index, cards);

  it('expands a deck to copies and back', () => {
    expect(copiesOf(cards)).toHaveLength(60);
    expect(copiesOf(linesOf(copiesOf(cards)))).toHaveLength(60);
    expect(
      linesOf(['a', 'a', 'b'], [{ cardId: 'x', qty: 2, zone: 'side' }]),
    ).toEqual([
      { cardId: 'a', qty: 2 },
      { cardId: 'b', qty: 1 },
      { cardId: 'x', qty: 2, zone: 'side' },
    ]);
  });

  it('draws the pool from the deck’s own years, one printing per name', () => {
    expect(era.all.length).toBeGreaterThan(500);
    expect(new Set(era.all.map((c) => c.name)).size).toBe(era.all.length);
    expect(era.byKind.pokemon.length + era.byKind.trainer.length + era.byKind.energy.length).toBe(era.all.length);
    expect(eraPool(ev, index, cards)).toBe(era);
    const pile = randomPile(era, 60, mulberry32(3));
    expect(pile).toHaveLength(60);
    expect(pile.every((l) => l.qty === 1)).toBe(true);
  });

  it('swaps the stated number of copies and keeps the deck size', () => {
    const before = copiesOf(cards).sort();
    for (const n of [6, 12, 24]) {
      const after = copiesOf(swapAny(n).apply(cards, era, mulberry32(n), ev)).sort();
      expect(after).toHaveLength(60);
      const left = [...before];
      let kept = 0;
      for (const id of after) {
        const i = left.indexOf(id);
        if (i >= 0) {
          left.splice(i, 1);
          kept++;
        }
      }
      // A random replacement can be a card the deck already plays, so at least 60 − n stay.
      expect(kept).toBeGreaterThanOrEqual(60 - n);
      expect(kept).toBeLessThan(60);
    }
  });

  it('swaps within a kind without changing how many cards of that kind there are', () => {
    const count = (list: DeckCard[], kind: string) => copiesOf(list).filter((id) => ev.kindOf(ev.card(id)!) === kind).length;
    const out = swapKind('trainer', 1 / 3, 't', 't').apply(cards, era, mulberry32(5), ev);
    expect(count(out, 'trainer')).toBe(count(cards, 'trainer'));
    expect(count(out, 'pokemon')).toBe(count(cards, 'pokemon'));
    expect(copiesOf(out).sort()).not.toEqual(copiesOf(cards).sort());
  });
});

describe('round robin', () => {
  it('turns pairwise win rates into a strength per deck', () => {
    const decks: BenchDeck[] = ['a', 'b', 'c'].map((id) => ({ id, name: id, cards: [] }));
    const power: Record<string, number> = { a: 3, b: 2, c: 1 };
    const s = roundRobin(decks, (x, y) => power[x.id] / (power[x.id] + power[y.id]));
    expect(s[0]).toBeGreaterThan(s[1]);
    expect(s[1]).toBeGreaterThan(s[2]);
    expect(s[0] + s[1] + s[2]).toBeCloseTo(1.5);
    expect(roundRobin(decks.slice(0, 1), () => 1)).toEqual([0.5]);
  });
});

describe('benchmark run', () => {
  const corpus = builtCorpus(ev, seeds, options, pool);
  const judges = scoreJudges(ev);
  const report = runBench(ev, index, corpus, judges, { seed: 1, repeats: 5 });
  const total = report.judges.find((j) => j.id === 'total')!;

  it('picks one Stage 2 seed per type and builds a full deck from each', () => {
    expect(seeds.length).toBeGreaterThanOrEqual(6);
    expect(corpus.decks).toHaveLength(seeds.length);
    for (const d of corpus.decks) {
      expect(copiesOf(d.cards), d.name).toHaveLength(60);
      expect(ev.score(d.cards).issues, d.name).toEqual([]);
    }
  });

  it('is the same for the same seed', () => {
    expect(runBench(ev, index, corpus, judges, { seed: 1, repeats: 5 })).toEqual(report);
    expect(runBench(ev, index, corpus, judges, { seed: 2, repeats: 5 })).not.toEqual(report);
  });

  it('has the score tell a built deck from a pile and from every damaged copy', () => {
    expect(report.decks).toBe(seeds.length);
    expect(report.judges.map((j) => j.id)).toContain('part:energy');
    expect(total.pile).toBe(1);
    expect(total.order).toBeGreaterThan(0.9);
    // Swapped Energy is the score's known blind spot (the Energy part barely moves); the floor is what it reaches today.
    for (const d of DAMAGES) expect(total.damage[d.id], d.id).toBeGreaterThan(d.id === 'energy' ? 0.6 : 0.9);
  });

  it('reports the correlation with real strength when the corpus knows it', () => {
    const ranked: Corpus = { ...corpus, decks: corpus.decks.map((d, i) => ({ ...d, strength: i })) };
    const echo: Judge = { id: 'echo', label: 'Echo', rate: (cards) => ranked.decks.findIndex((d) => d.cards === cards) };
    const r = runBench(ev, index, ranked, [echo], { repeats: 1 });
    expect(r.judges[0].strength).toBeCloseTo(1);
    expect(total.strength).toBeUndefined();
  });

  it('runs on an even sample when asked to', () => {
    const r = runBench(ev, index, corpus, judges.slice(0, 1), { repeats: 1, maxDecks: 3 });
    expect(r.decks).toBeGreaterThan(1);
    expect(r.decks).toBeLessThanOrEqual(Math.ceil(corpus.decks.length / Math.ceil(corpus.decks.length / 3)));
  });

  it('takes the playtest simulator as judges: a built deck plays better than a pile', { timeout: 60_000 }, () => {
    const played = playtestJudges(ev, { games: 100, seed: 1 });
    expect(played.map((j) => j.id)).toEqual(['sim:online3', 'sim:online4', 'sim:damage', 'sim:live']);
    const r = runBench(ev, index, corpus, played, { repeats: 2, maxDecks: 6 });
    const damage = r.judges.find((j) => j.id === 'sim:damage')!;
    // Twelve pairs only, so the floor is loose; the full run (npm run deck-bench) holds the real numbers.
    expect(damage.pile).toBeGreaterThan(0.6);
    expect(damage.mean).toBeGreaterThan(20);
    expect(damage.order).toBeGreaterThan(0.5);
  });

  it('takes simulated duels as a judge and as round-robin strength', { timeout: 120_000 }, () => {
    const few: Corpus = { ...corpus, decks: corpus.decks.slice(0, 4) };
    const judge = duelJudge(ev, few, { field: 4, games: 10 });
    const r = runBench(ev, index, few, [judge], { repeats: 1 });
    expect(r.judges[0].id).toBe('sim:duel');
    // A built deck beats a random pile of its years at winning, too.
    expect(r.judges[0].pile).toBeGreaterThan(0.7);
    const strengths = roundRobin(few.decks, simulatedDuel(ev, { games: 10 }));
    expect(strengths).toHaveLength(4);
    expect(strengths.reduce((a, b) => a + b, 0)).toBeCloseTo(2, 5);
    for (const s of strengths) expect(s).toBeGreaterThanOrEqual(0);
  });

  it('prints a table and names what fell behind a baseline', () => {
    const table = formatReport(report);
    expect(table).toContain('| Judge | Mean | Beats pile | Beats swap-6 |');
    expect(table).toContain('| Score |');
    expect(compareReports(report, report)).toEqual([]);
    const worse: BenchReport = {
      ...report,
      judges: report.judges.map((j) => (j.id === 'total' ? { ...j, pile: j.pile - 0.1, damage: { ...j.damage, 'swap-6': j.damage['swap-6'] - 0.02 } } : j)),
    };
    expect(compareReports(worse, report)).toEqual(['built: total pile fell from 1.000 to 0.900']);
    expect(compareReports({ ...report, judges: [] }, report)[0]).toBe('built: judge total is missing');
  });
});
