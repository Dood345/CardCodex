/**
 * Attack damage that is not the printed number: "+" and "×" damage that
 * scales by a count (Energy attached, Benched Pokémon, damage counters,
 * Prize cards taken, cards in a hand or discard pile, heads flipped), bonus
 * damage on a condition, attacks that do nothing unless something holds, and
 * damage that ignores Weakness, Resistance or effects. The wordings are read
 * in effects.ts (`parseDamageMods`); this file holds the model and the one
 * figure every caller shares: `expectedDamage(base, mods, view)`.
 *
 * A `DamageView` answers the counts and conditions for one board. The
 * engine builds one from a game (engine.ts `gameView`), where coins are
 * flipped with the game's seeded generator; the plan choice (cards.ts) and
 * the score's Power part (pokemon.ts) use `staticView`, a stated typical
 * board, so the deck page never names two different attacks. In a solo game
 * the opponent is a mirror: every count or check of the opponent's side reads
 * the pilot's own side.
 */

export type Side = 'self' | 'opponent' | 'both';

/** The five Special Conditions (rulebook p. 15–16). */
export type SpecialCondition = 'Asleep' | 'Burned' | 'Confused' | 'Paralyzed' | 'Poisoned';

/** A test on a Pokémon in play, as attack text names it ("Pokémon ex", "Basic Pokémon", "Fire Pokémon", "Lunatone"). */
export interface PokeTest {
  basic?: boolean;
  evolution?: boolean;
  stage?: number;
  type?: string;
  suffix?: string;
  /** Normalized card name(s); any of them. */
  names?: string[];
  /** An Ability of this name. */
  ability?: string;
  /** An attack of this name. */
  attack?: string;
  /** Owner prefix of the card name ("Hop's", "Team Rocket's"). */
  owner?: string;
  /** Not of this type letter ("non-Darkness"). */
  notType?: string;
  /** Not these normalized names ("except any Iron Crown ex"). */
  notNames?: string[];
  /** "that don't have a Rule Box" (false): no ex, V, VMAX, VSTAR, GX, EX, Radiant or Mega Pokémon; "with a Rule Box" (true). */
  ruleBox?: boolean;
  /** Any of these suffixes ("Active Pokémon ex and Active Pokémon V"). */
  suffixAny?: string[];
  /** A printed label the card carries (card-text.ts CARD_LABELS): "Future Pokémon", "Tera Pokémon", "Single Strike Pokémon". */
  label?: string;
  /** Not this label ("except for Future Pokémon"). */
  notLabel?: string;
}

/** ex, V, VMAX, VSTAR, GX, EX, Radiant and Mega Pokémon carry a Rule Box. */
export const hasRuleBoxLike = (c: { suffix: string; name: string }) => !!c.suffix || /^Radiant |^Mega /.test(c.name);

/**
 * What a Tool does to the Pokémon it is attached to, or a Stadium to every Pokémon matching `t`
 * (both players'), while it is in play. Read in effects.ts `parseStatics`; applied by the engine's
 * `maxHp`, `retreatCost`, attack damage, Knock Outs, Abilities, evolving and benching.
 */
/**
 * Whom a static effect reaches: the holder only (a Tool, "This Pokémon"), the owner's Pokémon
 * matching `t` ("your Basic Pokémon"), every Pokémon in play ("both yours and your opponent's",
 * Stadiums), or the opponent's ("each of your opponent's Dragon Pokémon").
 */
export type StaticScope = 'self' | 'own' | 'both' | 'opponent';

export type StaticEffect = {
  scope?: StaticScope;
  /** Only while the Pokémon with the Ability is in the Active Spot. */
  activeOnly?: boolean;
} & (
  /** Retreat Cost changed by `delta` (-99: none); `noCostBelowHp`: none while that little HP remains. */
  | { k: 'retreat'; delta: number; t?: PokeTest; noCostBelowHp?: number }
  | { k: 'hp'; delta: number; t?: PokeTest }
  /** Attacks of a matching Pokémon do `n` more damage to the opponent's Active (`vs`: only one of that kind); `ruleBoxFree`: only a holder without a Rule Box; `perPrizeTaken`: `n` for each Prize card the opponent has taken. */
  | { k: 'damage'; n: number; t?: PokeTest; vs?: PokeTest; ruleBoxFree?: boolean; perPrizeTaken?: boolean }
  /** A Knock Out of the holder gives `n` fewer Prize cards; `once`: one Knock Out per game (Legacy Energy). */
  | { k: 'prizeLess'; n: number; t?: PokeTest; once?: boolean }
  /** The holder, damaged by an attack in the Active Spot, puts `n` damage counters on the attacker (Spiky Energy, Punk Helmet). */
  | { k: 'hitBack'; n: number; t?: PokeTest }
  /** An Energy discarded by its holder's own attack comes back to it after the attack (Boomerang Energy). */
  | { k: 'boomerang' }
  /** The card is discarded at the end of its owner's turn (Ignition Energy). */
  | { k: 'discardAtTurnEnd' }
  /** Effects of the opponent's attacks (Special Conditions, locks, counters placed) are not done to the holder (Hide 'n' Sneak, Mist Energy); `from`: only from such attackers (Milotic ex's Sparkling Scales). */
  | { k: 'preventEffects'; from?: PokeTest }
  /** The holder cannot be given Special Conditions (`only`: that one) and recovers from them (Ancient Booster Energy Capsule, Bubbly Water Energy, Impact Energy). */
  | { k: 'noConditions'; only?: SpecialCondition; t?: PokeTest }
  /** A player with a matching Pokémon in play may have `n` Pokémon on the Bench (Area Zero Underdepths). */
  | { k: 'benchSize'; n: number; t: PokeTest }
  /** A Knock Out by a matching attacker this turn takes `n` more Prize cards (Briar). */
  | { k: 'prizeMore'; n: number; t?: PokeTest }
  /** Matching Pokémon's attacks cost `n` Colorless more (Nighttime Mine). */
  | { k: 'costMore'; n: number; t?: PokeTest }
  /** Damage from the opponent's attacks to matching Benched Pokémon is prevented (Flower Curtain, Battle Cage). */
  | { k: 'preventBenchDamage'; t?: PokeTest }
  /** The holder's owner draws `n` when it is damaged by an attack in the Active Spot. */
  | { k: 'drawWhenHit'; n: number }
  /** The holder's attacks (or the one named) cost `n` Colorless less, times `per` when given (Bloodmoon Ursaluna ex). */
  | { k: 'costLess'; n: number; t?: PokeTest; attack?: string; per?: Count }
  /** Each Basic Energy of the type attached to matching Pokémon provides two (Meganium's Wild Growth). */
  | { k: 'energyDouble'; type: string; t?: PokeTest }
  /** Matching Pokémon's Weakness becomes the type `to` (Lillie's Clefairy ex's Fairy Zone). */
  | { k: 'weakness'; to: string; t: PokeTest }
  /** All damage from attacks of matching attackers is prevented (Crustle's Mysterious Rock Inn). */
  | { k: 'preventDamage'; from: PokeTest }
  | { k: 'noAbilities'; t: PokeTest }
  | { k: 'noTools' }
  /** A Basic matching `t` put onto a Bench gets `n` damage counters. */
  | { k: 'benchCounters'; n: number; t: PokeTest }
  /** Matching Pokémon may evolve into matching Pokémon the turn they are played (not on the first turn). */
  | { k: 'evolveSameTurn'; t: PokeTest }
  /** Matching Pokémon take `delta` less damage from the opponent's attacks. */
  | { k: 'damageTaken'; delta: number; t?: PokeTest }
);

/** A test on a card in a hand or discard pile. */
export interface CardTest {
  energy?: boolean;
  basicEnergy?: boolean;
  energyType?: string;
  supporter?: boolean;
  /** A card whose name holds this text. */
  nameHas?: string;
  /** A Pokémon with an Ability of this name. */
  ability?: string;
  pokemon?: boolean;
  /** A card carrying this printed label ("Ancient card", "Future Supporter card", "Fusion Strike Energy"). */
  label?: string;
}

export type Count =
  | { k: 'heads'; flips: number | 'untilTails' | { per: Count } }
  /** `type`: one or more type letters, any of them ("for each Fire Energy and each Lightning Energy"). */
  | { k: 'energy'; on: 'self' | 'all' | 'opponentActive' | 'opponentAll' | 'bothActive'; type?: string; basic?: boolean; special?: boolean }
  | { k: 'bench'; side: Side; t?: PokeTest }
  | { k: 'inPlay'; side: Side; t?: PokeTest }
  | { k: 'counters'; on: 'self' | 'opponentActive' | 'opponentAll' | 'bench' }
  | { k: 'prizesTaken'; side: 'self' | 'opponent' }
  | { k: 'hand'; side: 'self' | 'opponent' }
  | { k: 'discard'; side: 'self' | 'opponent'; t: CardTest }
  | { k: 'retreatCost'; on: 'opponentActive' }
  /** Cards the attack's own text discarded "in this way" (engine.ts `Player.attackDiscarded`). */
  | { k: 'discarded' }
  /** Energy cards among the `n` cards the attack's own text discards from the top of a deck (`both`: one deck each): a deck's share of Energy on the static board. */
  | { k: 'milledEnergy'; n: number; both?: boolean };

export type Cond =
  /** Heads on one coin. */
  | { k: 'coin' }
  | { k: 'opponentActive'; t: PokeTest; not?: boolean }
  | { k: 'opponentActiveDamaged'; not?: boolean }
  | { k: 'selfDamaged'; not?: boolean }
  /** This Pokémon has Energy of a kind attached, or at least `extra` beyond the attack's cost. */
  | { k: 'selfEnergy'; type?: string; special?: boolean; extra?: number }
  | { k: 'selfTool' }
  | { k: 'movedThisTurn' }
  /** One of your Pokémon (of an owner) was Knocked Out by an attack during the opponent's last turn. */
  | { k: 'koLastTurn'; owner?: string }
  | { k: 'stadium'; not?: boolean }
  /** At least `min` Pokémon matching `t` on a side's Bench or in play. */
  | { k: 'inPlay'; side: Side; t: PokeTest; min: number; bench?: boolean; not?: boolean }
  | { k: 'energyInPlay'; type?: string; min: number }
  | { k: 'discard'; side: 'self' | 'opponent'; t: CardTest; min: number }
  | { k: 'prizes'; side: 'self' | 'opponent'; max?: number; exactly?: number[] }
  | { k: 'prizesMore'; side: 'self' | 'opponent' }
  | { k: 'hand'; side: 'self' | 'opponent'; max?: number; exactly?: number }
  | { k: 'sameType' }
  | { k: 'sameEnergy' }
  | { k: 'benchDamaged' }
  /** The optional cost of this attack was paid ("If you do, …"). */
  | { k: 'paid' }
  /** Every Pokémon in play on your side matches. */
  | { k: 'allInPlay'; t: PokeTest }
  /** Your first turn, going second. */
  | { k: 'firstTurnSecond' }
  /** The card being played is the last card in your hand. */
  | { k: 'lastCardInHand' }
  /** The effect before this one in the same text did something ("If you attached Energy in this way, …"). */
  | { k: 'did' }
  /** The opponent's Active Pokémon (or this one) has the Special Condition ("affected by a Special Condition": any). */
  | { k: 'condition'; on: 'opponentActive' | 'self'; c: SpecialCondition | 'any' }
  | { k: 'not'; c: Cond }
  | { k: 'any'; cs: Cond[] };

export type DamageMod =
  /** base + n per count ("30 more damage for each …"). */
  | { k: 'plus'; n: number; per: Count }
  /** n per count, the printed number being the multiplier ("20× … for each …"). */
  | { k: 'times'; n: number; per: Count }
  | { k: 'minus'; n: number; per: Count }
  | { k: 'bonus'; n: number; if: Cond }
  /** "this attack does nothing" unless the condition holds. */
  | { k: 'nothing'; unless: Cond }
  | { k: 'ignore'; weakness?: boolean; resistance?: boolean; effects?: boolean }
  /** "If you go second, you can't use this attack during your first turn." */
  | { k: 'firstTurnBarred' };

/** What a Pokémon card looks like to a `PokeTest` (a SimCard, or the evaluator's features). */
export interface PokeLike {
  stage: number;
  /** Type letters. */
  types: string;
  suffix: string;
  /** Normalized name. */
  key: string;
  name: string;
  abilities: readonly { name: string }[];
  attacks: readonly { name: string }[];
  /** Printed labels (card-text.ts CARD_LABELS), [] for most cards. */
  labels: readonly string[];
}

/** What a card looks like to a `CardTest`. */
export interface CardLike {
  kind: 'pokemon' | 'trainer' | 'energy';
  basicEnergy: boolean;
  provides: string;
  tt: string;
  name: string;
  abilities: readonly { name: string }[];
  labels: readonly string[];
}

export function pokeMatches(c: PokeLike, t: PokeTest): boolean {
  if (t.basic && c.stage !== 0) return false;
  if (t.evolution && c.stage === 0) return false;
  if (t.stage !== undefined && c.stage !== t.stage) return false;
  if (t.type && !c.types.includes(t.type)) return false;
  if (t.suffix && c.suffix !== t.suffix) return false;
  if (t.suffixAny && !t.suffixAny.includes(c.suffix)) return false;
  if (t.names && !t.names.includes(c.key)) return false;
  if (t.ability && !c.abilities.some((a) => a.name === t.ability)) return false;
  if (t.attack && !c.attacks.some((a) => a.name === t.attack)) return false;
  if (t.owner && !c.name.startsWith(t.owner)) return false;
  if (t.notType && c.types.includes(t.notType)) return false;
  if (t.notNames && t.notNames.includes(c.key)) return false;
  if (t.ruleBox === false && hasRuleBoxLike(c)) return false;
  if (t.ruleBox === true && !hasRuleBoxLike(c)) return false;
  if (t.label && !c.labels.includes(t.label)) return false;
  if (t.notLabel && c.labels.includes(t.notLabel)) return false;
  return true;
}

export function cardMatches(c: CardLike, t: CardTest): boolean {
  if ((t.energy || t.basicEnergy || t.energyType) && c.kind !== 'energy') return false;
  if (t.basicEnergy && !c.basicEnergy) return false;
  if (t.energyType && c.provides !== t.energyType) return false;
  if (t.supporter && c.tt !== 'Supporter') return false;
  if (t.pokemon && c.kind !== 'pokemon') return false;
  if (t.nameHas && !c.name.includes(t.nameHas)) return false;
  if (t.ability && !c.abilities.some((a) => a.name === t.ability)) return false;
  if (t.label && !c.labels.includes(t.label)) return false;
  return true;
}

/** Whether an Energy card provides a type among `type` (letters, any of them), and is basic or special as asked. */
export const energyMatches = (e: { provides: string; basicEnergy: boolean }, type?: string, basic?: boolean, special?: boolean): boolean =>
  (!type || e.provides === '*' || [...e.provides].some((ch) => type.includes(ch))) && (!basic || e.basicEnergy) && (!special || !e.basicEnergy);

/** What a deck holds, for the static view: whether a condition's means are in the list at all. */
export interface DeckSupply {
  /** Copies of Pokémon matching the test. */
  pokemon(t: PokeTest): number;
  /** Copies of Energy of the type (letters, any) and kind. */
  energy(type?: string, special?: boolean): number;
}

export interface DamageView {
  /** The number the count stands for on this board (an expectation when nothing is rolled). */
  count(c: Count): number;
  /** 0..1: whether the condition holds (a probability for the static view). */
  holds(c: Cond): number;
}

/** Expected number of heads: n flips give n/2; flipping until tails gives 1. */
export function expectedHeads(flips: number | 'untilTails'): number {
  return flips === 'untilTails' ? 1 : flips / 2;
}

/**
 * The damage an attack does on this board, before Weakness and Resistance: the printed base plus
 * what its text adds. With a rolling view the result is one outcome; with an expectation view it
 * is the mean. "Nothing unless" multiplies by the chance the condition holds.
 */
export function expectedDamage(base: number, mods: readonly DamageMod[], view: DamageView): number {
  let d = base;
  let scale = 1;
  for (const m of mods) {
    switch (m.k) {
      case 'plus':
        d += m.n * view.count(m.per);
        break;
      case 'times':
        d = m.n * view.count(m.per);
        break;
      case 'minus':
        d -= m.n * view.count(m.per);
        break;
      case 'bonus':
        d += m.n * view.holds(m.if);
        break;
      case 'nothing':
        scale *= view.holds(m.unless);
        break;
      case 'ignore':
      case 'firstTurnBarred':
        break;
    }
  }
  return Math.max(0, d) * scale;
}

/**
 * The stated typical board behind the plan choice and the score's Power part. Counts: the attacker
 * carries exactly its cost in Energy (two more across its side), each player has three Benched
 * Pokémon (four in play), five cards in hand, no Prize cards taken and no damage counters (a
 * deck opens with its plan before the opponent has taken anything), a discard pile of three
 * Energy and two Supporters, and an Active with a Retreat Cost of two; a count narrowed to a kind
 * of Pokémon or card is one, and so is a count of the opponent's Energy of a type (Sunflora's
 * Redirected Sunlight, 60 per Fire Energy on the opponent's Pokémon, was credited 180).
 *
 * Conditions are credited by whether the pilot can bring them about: a coin, the opponent's side,
 * damage taken, a Knock Out, a Stadium, the hand and the Prize cards count half (the game decides);
 * Energy of a type on this Pokémon or in play, and a named or kind of Pokémon in play, count in
 * full when the deck holds the means (`supply`; assumed when none is given) and nothing otherwise;
 * extra Energy beyond the cost counts half when the deck has it; a Tool attached, having moved up
 * this turn and cards in a discard pile count nothing, because nothing in the pilot works toward
 * them.
 */
export function staticView(costN: number, supply?: DeckSupply): DamageView {
  const count = (c: Count): number => {
    switch (c.k) {
      case 'heads':
        return typeof c.flips === 'object' ? count(c.flips.per) / 2 : expectedHeads(c.flips);
      case 'energy': {
        // A typed count of the opponent's Energy is credited one card: nothing says the opponent plays that type.
        if (c.type && (c.on === 'opponentActive' || c.on === 'opponentAll')) return 1;
        const own = c.type || c.basic || c.special ? Math.max(1, Math.ceil(costN / 2)) : costN;
        return c.on === 'self' || c.on === 'opponentActive' ? own : c.on === 'bothActive' ? 2 * own : own + 2;
      }
      case 'bench':
        return (c.t ? 1 : 3) * (c.side === 'both' ? 2 : 1);
      case 'inPlay':
        return (c.t ? 1 : 4) * (c.side === 'both' ? 2 : 1);
      case 'counters':
        return 0;
      case 'prizesTaken':
        return 0;
      case 'hand':
        return 5;
      case 'discard':
        return c.t.energy || c.t.basicEnergy || c.t.energyType ? 3 : c.t.supporter ? 2 : 1;
      case 'retreatCost':
        return 2;
      case 'discarded':
        return 2;
      case 'milledEnergy': {
        // The deck's own share of Energy when known (a third of a typical deck); the opponent's a third.
        const own = supply ? Math.min(1, supply.energy() / 60) : 1 / 3;
        return c.both ? c.n * (own + 1 / 3) : c.n * own;
      }
    }
  };
  const holds = (c: Cond): number => {
    switch (c.k) {
      case 'not':
        return 1 - holds(c.c);
      case 'any':
        return Math.max(...c.cs.map(holds));
      case 'selfEnergy':
        if (c.extra !== undefined) return !supply || supply.energy() >= costN + c.extra ? 0.5 : 0;
        return !supply || supply.energy(c.type, c.special) > 0 ? 1 : 0;
      case 'energyInPlay':
        return !supply || supply.energy(c.type) >= c.min ? 1 : 0;
      case 'inPlay':
        if (c.side === 'opponent') return 0.5;
        return (!supply || supply.pokemon(c.t) >= c.min) !== !!c.not ? 1 : 0;
      case 'selfTool':
      case 'movedThisTurn':
      case 'discard':
        return 0;
      case 'paid':
        return 0.5;
      default:
        return 0.5;
    }
  };
  return { count, holds };
}

/**
 * Damage a turn an attack keeps up: its expected damage, halved for one that rests its user, with
 * half of the card's next attack (at no higher cost) when only the attack itself is barred.
 */
export function sustainedOf<A extends { expected: number; rest: 0 | 1 | 2 | 3; costN: number; damage: number; drain: number; miss?: number }>(a: A, attacks: readonly A[]): number {
  // Energy the attack takes from its user comes back one card a turn, so the attack lands every max(1, drain)
  // turns: a one-Energy discard is covered by the turn's attachment, "discard all" of an FF attack waits a turn.
  // A Special Condition the attack puts on its user costs a share of its next turns (`miss`).
  const own = a.expected / Math.max(1, a.drain) / (1 + (a.miss ?? 0));
  if (!a.rest || a.damage <= 0) return own;
  let other = 0;
  if (a.rest >= 2) for (const b of attacks) if (b !== a && !b.rest && b.costN <= a.costN) other = Math.max(other, b.expected / Math.max(1, b.drain));
  // Once per stay in the Active Spot (rest 3): one use, then the other attack over a stay of about three turns.
  if (a.rest === 3) return (own + 2 * other) / 3;
  return (own + other) / 2;
}
