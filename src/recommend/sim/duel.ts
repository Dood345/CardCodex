/**
 * Head-to-head races: two greedy pilots (engine.ts) play each other. Attacks
 * damage the opposing Active Pokémon after Weakness and Resistance; a Knock
 * Out takes as many Prize cards as the Pokémon is worth (rules.ts
 * `prizeValue`); a player wins on their last Prize card, when the opponent
 * has no Pokémon to promote, or when the opponent cannot draw at the start
 * of their turn. Who goes first alternates by game. No disruption and no
 * gust in this cut: Iono resolves only for its player, Boss's Orders is
 * unread, and nothing damages the Bench.
 */
import type { DeckCard } from '@/data/db';
import type { PokemonEvaluator } from '../pokemon';
import { attack, beginTurn, checkup, mainPhase, newPlayer, setup, type Game, type Player } from './engine';
import { compiledDeck } from './playtest';
import { mixSeed } from './rng';
import { POKEMON_RULES_PAR_2023, type PokemonRuleSet } from './rules';
import { wilson, type DuelOptions, type DuelReport } from './types';

export interface DuelGame {
  /** 1: A won, 0: B won, 0.5: draw. */
  result: number;
  aFirst: boolean;
  turns: number;
  aPrizes: number;
  bPrizes: number;
  ending: string;
  /** Loop guards that fired in the game (`Game.guards`). */
  guards: number;
}

/** One game; `seed` and the game number give each seat its own random stream. */
export function duelGame(ev: PokemonEvaluator, a: readonly DeckCard[], b: readonly DeckCard[], seed: number, game: number, maxTurns = 60, rules: PokemonRuleSet = POKEMON_RULES_PAR_2023, trace?: (line: string) => void): DuelGame {
  const da = compiledDeck(ev, a);
  const db = compiledDeck(ev, b);
  const aFirst = game % 2 === 0;
  const pa = newPlayer(da, mixSeed(seed, game, 0), aFirst, maxTurns, rules.benchSize);
  const pb = newPlayer(db, mixSeed(seed, game, 1), !aFirst, maxTurns, rules.benchSize);
  const g: Game = { rules, stadium: null, winner: null, ending: '', guards: 0, trace };
  const result = (winner: Player | null, ending: string, turns: number): DuelGame => ({
    result: winner === pa ? 1 : winner === pb ? 0 : 0.5,
    aFirst,
    turns,
    aPrizes: pa.taken,
    bPrizes: pb.taken,
    ending,
    guards: g.guards,
  });
  const okA = setup(g, pa);
  const okB = setup(g, pb);
  if (!okA || !okB) return result(okA ? pa : okB ? pb : null, 'no Basic', 0);
  // p. 18: the player who did not have to start over may draw a card for each extra mulligan.
  for (const [p, o] of [
    [pa, pb],
    [pb, pa],
  ] as const) {
    const extra = Math.max(0, o.mulligans - p.mulligans) * rules.opponentDrawsPerMulligan;
    for (let k = 0; k < extra && p.deck.length; k++) p.hand.push(p.deck.pop()!);
  }
  const first = aFirst ? pa : pb;
  const second = aFirst ? pb : pa;
  for (let t = 0; t < maxTurns; t++) {
    const p = t % 2 === 0 ? first : second;
    const o = p === pa ? pb : pa;
    if (trace) trace(`--- ${p === pa ? 'A' : 'B'}`);
    if (!beginTurn(g, p)) return result(o, 'deck out', t + 1);
    mainPhase(g, p, o);
    attack(g, p, o);
    if (!g.winner) checkup(g, p, o);
    if (g.winner) return result(g.winner, g.ending, t + 1);
  }
  return result(null, 'turn limit', maxTurns);
}

export function duel(ev: PokemonEvaluator, a: readonly DeckCard[], b: readonly DeckCard[], options: DuelOptions, rules: PokemonRuleSet = POKEMON_RULES_PAR_2023): DuelReport {
  const t0 = performance.now();
  const games = Math.max(0, Math.floor(options.games));
  const maxTurns = Math.max(2, Math.floor(options.maxTurns ?? 60));
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let firstScore = 0;
  let turns = 0;
  let diff = 0;
  const endings: Record<string, number> = {};
  let guards = 0;
  for (let gi = 0; gi < games; gi++) {
    const r = duelGame(ev, a, b, options.seed, gi, maxTurns, rules);
    if (r.result === 1) wins++;
    else if (r.result === 0) losses++;
    else draws++;
    firstScore += r.aFirst ? r.result : 1 - r.result;
    turns += r.turns;
    diff += r.aPrizes - r.bPrizes;
    endings[r.ending] = (endings[r.ending] ?? 0) + 1;
    guards += r.guards;
  }
  const winRate = games ? (wins + draws / 2) / games : 0.5;
  return {
    game: 'pokemon',
    games,
    seed: options.seed,
    wins,
    losses,
    draws,
    winRate,
    ci: wilson(winRate, games),
    firstPlayerWinRate: games ? firstScore / games : 0.5,
    meanTurns: games ? turns / games : 0,
    meanScoreDiff: games ? diff / games : 0,
    endings,
    guards,
    planA: compiledDeck(ev, a).plan?.detail ?? 'No attack to build toward',
    planB: compiledDeck(ev, b).plan?.detail ?? 'No attack to build toward',
    ms: performance.now() - t0,
  };
}
