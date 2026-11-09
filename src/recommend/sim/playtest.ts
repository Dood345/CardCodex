/**
 * Practice draws in bulk: `playtest` plays seeded solo games of a Pokémon
 * deck with the greedy pilot (engine.ts) and reports how fast and how
 * reliably it does what it is built to do. No opponent: attacks hit nothing,
 * damage is the printed number.
 */
import type { DeckCard } from '@/data/db';
import type { PokemonEvaluator } from '../pokemon';
import { compileDeck, type CompiledDeck } from './cards';
import { attack, beginTurn, keyPieceStuck, mainPhase, newPlayer, setup, type Game } from './engine';
import { mixSeed } from './rng';
import { POKEMON_RULES_PAR_2023, type PokemonRuleSet } from './rules';
import type { PlaytestOptions, PokemonPlaytestReport } from './types';

const compiled = new WeakMap<PokemonEvaluator, Map<string, CompiledDeck>>();

/** Compile a deck once per evaluator and list (keyed by the list's ids and counts). */
export function compiledDeck(ev: PokemonEvaluator, cards: readonly DeckCard[]): CompiledDeck {
  let m = compiled.get(ev);
  if (!m) compiled.set(ev, (m = new Map()));
  const key = cards.map((c) => `${c.cardId}:${c.qty}${c.zone ? `:${c.zone}` : ''}`).join(',');
  let d = m.get(key);
  if (!d) {
    d = compileDeck(ev, cards);
    if (m.size > 200) m.clear();
    m.set(key, d);
  }
  return d;
}

export function firstOf(options: { first?: 'alternate' | 'first' | 'second' }, game: number): boolean {
  return options.first === 'first' ? true : options.first === 'second' ? false : game % 2 === 0;
}

export function playtest(ev: PokemonEvaluator, cards: readonly DeckCard[], options: PlaytestOptions, rules: PokemonRuleSet = POKEMON_RULES_PAR_2023): PokemonPlaytestReport {
  const t0 = performance.now();
  const d = compiledDeck(ev, cards);
  const turns = Math.max(1, Math.floor(options.turns ?? 6));
  const games = Math.max(0, Math.floor(options.games));
  const dmgTurns = Math.min(6, turns);
  const report: PokemonPlaytestReport = {
    game: 'pokemon',
    games,
    seed: options.seed,
    turns,
    plan: d.plan ? d.plan.detail : 'No attack to build toward',
    cannotOpen: d.basics === 0,
    mulliganRate: 0,
    meanMulligans: 0,
    onlineBy: new Array<number>(turns).fill(0),
    meanOnlineTurn: turns + 1,
    deadTurnRate: 0,
    keyPieceStuckRate: 0,
    unread: d.unread,
    unreadCopies: d.unread.reduce((n, u) => n + u.copies, 0),
    unreadDrawsPerGame: 0,
    ms: 0,
    meanDamagePerTurn: 0,
    damageByTurn: new Array<number>(turns).fill(0),
  };
  if (report.cannotOpen || !games) {
    report.ms = performance.now() - t0;
    return report;
  }
  let mulliganGames = 0;
  let mulligans = 0;
  let onlineSum = 0;
  let deadTurns = 0;
  let turnsPlayed = 0;
  let stuck = 0;
  let unreadDraws = 0;
  for (let gi = 0; gi < games; gi++) {
    const g: Game = { rules, stadium: null, winner: null, ending: '' };
    const p = newPlayer(d, mixSeed(options.seed, gi), firstOf(options, gi), turns, rules.benchSize);
    setup(g, p);
    if (p.mulligans) mulliganGames++;
    mulligans += p.mulligans;
    if (keyPieceStuck(p)) stuck++;
    for (let t = 0; t < turns; t++) {
      if (!beginTurn(g, p)) break;
      mainPhase(g, p, null);
      attack(g, p, null);
      turnsPlayed++;
    }
    deadTurns += p.deadTurns;
    unreadDraws += p.unreadDraws;
    const on = p.firstOnline || turns + 1;
    onlineSum += on;
    for (let t = on; t <= turns; t++) report.onlineBy[t - 1]++;
    for (let t = 0; t < turns; t++) report.damageByTurn[t] += p.damage[t];
  }
  report.mulliganRate = mulliganGames / games;
  report.meanMulligans = mulligans / games;
  report.onlineBy = report.onlineBy.map((n) => n / games);
  report.meanOnlineTurn = onlineSum / games;
  report.deadTurnRate = turnsPlayed ? deadTurns / turnsPlayed : 0;
  report.keyPieceStuckRate = stuck / games;
  report.unreadDrawsPerGame = unreadDraws / games;
  report.damageByTurn = report.damageByTurn.map((n) => n / games);
  report.meanDamagePerTurn = report.damageByTurn.slice(0, dmgTurns).reduce((a, b) => a + b, 0) / dmgTurns;
  report.ms = performance.now() - t0;
  return report;
}
