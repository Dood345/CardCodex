/**
 * Head-to-head races between the Charizard ex fixture, damaged copies of it
 * and random piles of its years.
 */
import { describe, expect, it } from 'vitest';
import { compileDeck } from './cards';
import { duel, duelGame } from './duel';
import { damageAgainst, type Mon } from './engine';
import { CHARIZARD, deck, loadEvaluator, randomPile, withBlanks } from './fixtures';

const { index, ev } = loadEvaluator();
const cards = deck(CHARIZARD);
const noCandy = withBlanks(cards, ['sv04.5-089']);
const LONG = { timeout: 60000 };
const se = (p: number, n: number) => Math.sqrt((p * (1 - p)) / n);

describe('duel', () => {
  it('splits a deck against itself about evenly', LONG, () => {
    const r = duel(ev, cards, cards, { games: 1000, seed: 1 });
    expect(r.wins + r.losses + r.draws).toBe(1000);
    expect(Math.abs(r.winRate - 0.5)).toBeLessThan(4 * se(0.5, 1000));
    expect(r.ci[0]).toBeLessThan(0.5);
    expect(r.ci[1]).toBeGreaterThan(0.5);
    expect(Math.abs(r.meanScoreDiff)).toBeLessThan(0.5);
    expect(r.planA).toBe(r.planB);
  });

  it('beats random piles of its years nearly always', LONG, () => {
    for (const s of [3, 4, 5]) {
      const r = duel(ev, cards, randomPile(index, s, 2023, 2024), { games: 300, seed: 2 });
      expect(r.winRate, `pile ${s}`).toBeGreaterThan(0.9);
      expect(r.meanScoreDiff).toBeGreaterThan(3);
    }
  });

  it('gives antisymmetric win rates: A over B plus B over A is about 1', LONG, () => {
    const n = 1000;
    const ab = duel(ev, cards, noCandy, { games: n, seed: 3 });
    const ba = duel(ev, noCandy, cards, { games: n, seed: 3 });
    expect(ab.winRate).toBeGreaterThan(0.6);
    expect(Math.abs(ab.winRate + ba.winRate - 1)).toBeLessThan(4 * Math.sqrt(se(ab.winRate, n) ** 2 + se(ba.winRate, n) ** 2));
    expect(ab.meanScoreDiff).toBeCloseTo(-ba.meanScoreDiff, 0);
  });

  it('is deterministic for a seed', LONG, () => {
    const a = duel(ev, cards, noCandy, { games: 200, seed: 9 });
    const b = duel(ev, cards, noCandy, { games: 200, seed: 9 });
    const c = duel(ev, cards, noCandy, { games: 200, seed: 10 });
    expect({ ...a, ms: 0 }).toEqual({ ...b, ms: 0 });
    expect({ ...c, ms: 0 }).not.toEqual({ ...a, ms: 0 });
    expect(duelGame(ev, cards, noCandy, 9, 17)).toEqual(duelGame(ev, cards, noCandy, 9, 17));
  });

  it('alternates who goes first and ends games by the rules', LONG, () => {
    const games = Array.from({ length: 40 }, (_, i) => duelGame(ev, cards, cards, 4, i));
    expect(games.filter((g) => g.aFirst).length).toBe(20);
    for (const g of games) {
      expect(['prizes', 'no Pokémon', 'deck out', 'turn limit']).toContain(g.ending);
      if (g.ending === 'prizes') expect(Math.max(g.aPrizes, g.bPrizes)).toBe(6);
      expect(g.aPrizes).toBeLessThanOrEqual(6);
      expect(g.bPrizes).toBeLessThanOrEqual(6);
    }
  });

  it('applies Weakness and Resistance as printed, to the Active only', () => {
    const charizard = index.cardsById.get('sv04.5-054')!; // Weakness: Grass ×2
    const pidgey = index.cardsById.get('sv04.5-196')!; // Resistance: Fighting -30
    const grass = index.catalog.cards.find((c) => c.cat === 'Pokemon' && c.set.startsWith('sv') && c.types?.length === 1 && c.types[0] === 'Grass')!;
    const fighting = index.catalog.cards.find((c) => c.cat === 'Pokemon' && c.set.startsWith('sv') && c.types?.length === 1 && c.types[0] === 'Fighting')!;
    const d = compileDeck(ev, [charizard, pidgey, grass, fighting].map((c) => ({ cardId: c.id, qty: 1 })));
    const mon = (id: string): Mon => ({ c: d.cards.find((c) => c.card.id === id)!, under: [], energy: [], dmg: 0, entered: 0, abilityTurn: -1 });
    expect(damageAgainst(mon(grass.id), mon(charizard.id), 60)).toBe(120);
    expect(damageAgainst(mon(fighting.id), mon(pidgey.id), 60)).toBe(30);
    expect(damageAgainst(mon(fighting.id), mon(pidgey.id), 20)).toBe(0);
    expect(damageAgainst(mon(grass.id), null, 60)).toBe(60);
  });
});
