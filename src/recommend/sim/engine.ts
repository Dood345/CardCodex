/**
 * The Pokémon game engine and its greedy pilot, shared by the practice-draw
 * playtest (one player, no opponent) and the head-to-head duel.
 *
 * The pilot plays toward the deck's plan (cards.ts: the main attacker line).
 * Each turn it draws, then repeats the first action that applies until none
 * does: bench a Basic, evolve, Rare Candy, use an Ability, play an Item, play
 * or use a Stadium, attach the turn's Energy, play the turn's Supporter, move
 * a ready attacker up (Switch or retreat); then it attacks. Searches fetch
 * the card the plan misses most (`want`), discards drop what it wants least.
 * Cards whose text was not read (cards.ts `unread`) are never played.
 *
 * State is mutated in place for speed; a game is reproduced from its seed.
 */
import type { CompiledDeck, SimAttack, SimCard } from './cards';
import { cardMatches, energyMatches, expectedDamage, expectedHeads, pokeMatches, type Cond, type Count, type DamageMod, type DamageView } from './damage';
import type { AttachTarget, CardFilter, Effect, ParsedAbility, ParsedText } from './effects';
import { Rng, shuffleInPlace } from './rng';
import type { PokemonRuleSet } from './rules';

export interface Mon {
  c: SimCard;
  /** Table indices of the cards under it (earlier stages, Tools), discarded with it. */
  under: number[];
  energy: SimCard[];
  dmg: number;
  /** Own turn it entered play or last evolved (0: during setup). */
  entered: number;
  /** Own turn its once-per-turn Ability was last used. */
  abilityTurn: number;
  /** Own turn during which its last attack bars it from attacking (0: none); lifted when it leaves the Active Spot. */
  restTurn: number;
  /** The one attack barred during `restTurn`, "" for all of them. */
  restAtk: string;
  /** Own turn it last moved from the Bench to the Active Spot by a retreat or switch (0: never). */
  movedTurn: number;
}

export interface Player {
  d: CompiledDeck;
  rng: Rng;
  /** Table indices; the top of the deck is the end of the array. */
  deck: number[];
  hand: number[];
  prizes: number[];
  discard: number[];
  active: Mon | null;
  bench: Mon[];
  /** Own turns begun. */
  turn: number;
  first: boolean;
  benchSize: number;
  energyDone: number;
  supporterDone: number;
  retreatDone: number;
  stadiumDone: boolean;
  stadiumTurn: number;
  limitNames: string[];
  vstarUsed: boolean;
  /** Actions this turn (cards played from the hand, Abilities, retreats). */
  acted: number;
  turnEnded: boolean;
  // statistics
  mulligans: number;
  /** Own turn the main attacker first attacked, 0 when not yet. */
  firstOnline: number;
  /** Damage per own turn. */
  damage: number[];
  deadTurns: number;
  unreadDraws: number;
  /** Table indices of cards that reached the hand, and of Trainers played, this game. */
  held: Set<number>;
  played: Set<number>;
  taken: number;
  /** Own turn before which one of this player's Pokémon was Knocked Out by an attack (0: none), and its name. */
  koBefore: number;
  koName: string;
  /** During an attack: cards its own text discarded "in this way", and whether its optional cost was paid. */
  attackDiscarded: number;
  attackPaid: boolean;
}

export interface Game {
  rules: PokemonRuleSet;
  stadium: { c: SimCard; owner: Player } | null;
  /** Set when the game is over. */
  winner: Player | null;
  ending: string;
  /** Debugging: called with each action when set. */
  trace?: (line: string) => void;
}

const names = (p: Player, xs: readonly number[]) => xs.map((i) => p.d.cards[i].name).join(', ');

export function newPlayer(d: CompiledDeck, seed: number, first: boolean, turns: number, benchSize: number): Player {
  return {
    d,
    rng: new Rng(seed),
    deck: d.list.slice(),
    hand: [],
    prizes: [],
    discard: [],
    active: null,
    bench: [],
    turn: 0,
    first,
    benchSize,
    energyDone: 0,
    supporterDone: 0,
    retreatDone: 0,
    stadiumDone: false,
    stadiumTurn: 0,
    limitNames: [],
    vstarUsed: false,
    acted: 0,
    turnEnded: false,
    mulligans: 0,
    firstOnline: 0,
    damage: new Array<number>(Math.max(1, turns)).fill(0),
    deadTurns: 0,
    unreadDraws: 0,
    taken: 0,
    held: new Set(),
    played: new Set(),
    koBefore: 0,
    koName: '',
    attackDiscarded: 0,
    attackPaid: false,
  };
}

const cardOf = (p: Player, i: number) => p.d.cards[i];

/**
 * Draw effects are passed up when they would leave fewer cards than this in the deck: one draw a turn for
 * the Knock Outs still needed (a Prize card each) and two more, never under six. Decking out loses, and a
 * game that drags on (nothing across the table to Knock Out) is where a pilot that draws every turn loses.
 */
const reserve = (p: Player) => Math.max(6, p.prizes.length + 2);
/** The deck is getting thin: from here on the pilot draws only into a hand of fewer than five cards. */
const thin = (p: Player) => p.deck.length < 20;
const glutted = (p: Player) => thin(p) && p.hand.length >= 5;

function draw(p: Player, n: number): number {
  let k = 0;
  for (; k < n && p.deck.length; k++) {
    const i = p.deck.pop()!;
    p.hand.push(i);
    if (p.d.cards[i].unread) p.unreadDraws++;
    p.held.add(i);
  }
  return k;
}

function newMon(c: SimCard, turn: number): Mon {
  return { c, under: [], energy: [], dmg: 0, entered: turn, abilityTurn: -1, restTurn: 0, restAtk: '', movedTurn: 0 };
}

function* inPlay(p: Player): Generator<Mon> {
  if (p.active) yield p.active;
  yield* p.bench;
}

function hasInPlay(p: Player, key: string): boolean {
  if (!key) return false;
  if (p.active?.c.key === key) return true;
  for (const m of p.bench) if (m.c.key === key) return true;
  return false;
}

function removeFromHand(p: Player, at: number): number {
  const i = p.hand[at];
  p.hand.splice(at, 1);
  return i;
}

/* ---------- Energy ---------- */

/** The cost letters `energy` leaves unpaid ("" = payable). Typed symbols take a matching Energy first, then any-type Energy. */
export function missing(cost: string, energy: readonly SimCard[]): string {
  if (!cost) return '';
  let used = 0; // bit mask over energy (at most 31 attached)
  let out = '';
  let colorless = 0;
  for (const ch of cost) {
    if (ch === 'C') {
      colorless++;
      continue;
    }
    let j = -1;
    for (let k = 0; k < energy.length; k++) if (!(used & (1 << k)) && energy[k].provides === ch) {
      j = k;
      break;
    }
    if (j < 0) for (let k = 0; k < energy.length; k++) if (!(used & (1 << k)) && (energy[k].provides.includes(ch) || energy[k].provides === '*')) {
      j = k;
      break;
    }
    if (j < 0) out += ch;
    else used |= 1 << j;
  }
  let free = 0;
  for (let k = 0; k < energy.length; k++) if (!(used & (1 << k))) free++;
  for (; colorless > 0; colorless--) {
    if (free > 0) free--;
    else out += 'C';
  }
  return out;
}

const covers = (e: SimCard, ch: string) => ch === 'C' || e.provides === '*' || e.provides.includes(ch);

/** The attack a Pokémon is being built for: the plan's attack on the main line, else its strongest. */
function targetAttack(p: Player, m: Mon): SimAttack | null {
  const plan = p.d.plan;
  if (plan && plan.line.includes(m.c.key)) return plan.attack;
  let best: SimAttack | null = null;
  for (const a of m.c.attacks) if (a.damage > 0 && (!best || a.expected > best.expected)) best = a;
  return best ?? m.c.attacks[0] ?? null;
}

/** An Active off the main line, short of its Retreat Cost, with the line waiting on the Bench: Energy on it buys the retreat. */
function payingRetreat(p: Player, m: Mon): boolean {
  const plan = p.d.plan;
  if (!plan || m !== p.active || plan.line.includes(m.c.key) || m.energy.length >= m.c.retreat || bestPayable(m)) return false;
  return p.bench.some((b) => plan.line.includes(b.c.key));
}

function needs(p: Player, m: Mon, e: SimCard): boolean {
  if (payingRetreat(p, m)) return true;
  const a = targetAttack(p, m);
  if (!a) return false;
  const miss = missing(a.cost, m.energy);
  for (const ch of miss) if (covers(e, ch)) return true;
  return false;
}

/** The main line's most advanced Pokémon in play (Active first on a tie). */
function lineLead(p: Player): Mon | null {
  const plan = p.d.plan;
  if (!plan) return null;
  let best: Mon | null = null;
  let bestDepth = 99;
  for (const m of inPlay(p)) {
    const d = plan.line.indexOf(m.c.key);
    if (d >= 0 && d < bestDepth) {
      best = m;
      bestDepth = d;
    }
  }
  return best;
}

/** Energy the plan still lacks after what is attached to the line's lead and what is in the hand (less one copy of `without`). */
function energyNeed(p: Player, without: SimCard | null = null): string {
  const plan = p.d.plan;
  if (!plan) return '';
  const lead = lineLead(p);
  const pool: SimCard[] = lead ? lead.energy.slice() : [];
  let skipped = false;
  for (const i of p.hand) {
    const c = cardOf(p, i);
    if (c.kind !== 'energy') continue;
    if (c === without && !skipped) {
      skipped = true;
      continue;
    }
    pool.push(c);
  }
  return missing(plan.attack.cost, pool);
}

/** Barred this turn by the attack `m` used on its last one ("During your next turn, this Pokémon can't attack"). */
function resting(p: Player, m: Mon, atk: SimAttack): boolean {
  return m.restTurn === p.turn && (!m.restAtk || m.restAtk === atk.name);
}

/** Can `m` use the plan's attack right now? */
function mainReady(p: Player, m: Mon): boolean {
  const plan = p.d.plan;
  return !!plan && m.c.key === plan.attacker && !resting(p, m, plan.attack) && missing(plan.attack.cost, m.energy) === '';
}

function bestPayable(m: Mon): SimAttack | null {
  let best: SimAttack | null = null;
  for (const a of m.c.attacks) if (a.damage > 0 && missing(a.cost, m.energy) === '' && (!best || a.expected > best.expected)) best = a;
  return best;
}

/* ---------- what the plan wants ---------- */

function handCount(p: Player, test: (c: SimCard) => boolean): number {
  let n = 0;
  for (const i of p.hand) if (test(cardOf(p, i))) n++;
  return n;
}

const isCandy = (c: SimCard) => c.kind === 'trainer' && !!c.fx?.effects.some((e) => e.k === 'rareCandy');
const isSwitchCard = (c: SimCard) => c.kind === 'trainer' && !c.unread && !!c.fx && isSwitchOnly(c.fx);
const isSupporter = (c: SimCard) => c.tt === 'Supporter' && !c.unread && !!c.fx;

/** A better attacker waits on the Bench and the Active can neither retreat (too little Energy) nor be switched from the hand. */
function retreatBlocked(p: Player): boolean {
  const a = p.active;
  if (!a || a.energy.length >= a.c.retreat) return false;
  if (p.hand.some((i) => isSwitchCard(cardOf(p, i)))) return false;
  return !!switchTarget(p, null);
}

/**
 * How much the plan wants `c` now, 0..100: searches take the most wanted
 * card from the deck, discards drop the least wanted card of the hand.
 * `inHand`: `c` is a card of the hand being weighed against the rest, so
 * other copies in hand are what make it spare.
 */
export function want(p: Player, c: SimCard, inHand = false, shallow = false): number {
  const plan = p.d.plan;
  const others = (test: (h: SimCard) => boolean) => handCount(p, test) - (inHand && test(c) ? 1 : 0);
  if (c.kind === 'pokemon') {
    const room = p.bench.length < p.benchSize;
    const spare = others((h) => h.key === c.key);
    if (plan) {
      const depth = plan.line.indexOf(c.key);
      if (depth >= 0) {
        if (depth === plan.line.length - 1) {
          let n = spare;
          for (const m of inPlay(p)) if (plan.line.includes(m.c.key)) n++;
          return !room ? 5 : n === 0 ? 100 : n < 2 ? 70 : 25;
        }
        const onto = hasInPlay(p, c.from) || (c.stage === 2 && hasInPlay(p, c.candyBase) && p.d.rareCandy > 0);
        if (spare) return 30;
        if (depth === 0) return onto ? 95 : 65;
        return hasInPlay(p, c.from) ? (others(isCandy) ? 45 : 80) : 35;
      }
    }
    if (p.d.support.has(c.key)) {
      if (c.basic) return !room ? 5 : hasInPlay(p, c.key) || spare ? 20 : 60;
      return spare ? 20 : hasInPlay(p, c.from) || (c.stage === 2 && hasInPlay(p, c.candyBase)) ? 75 : 40;
    }
    if (c.basic) return room ? 15 : 3;
    return hasInPlay(p, c.from) ? 20 : 5;
  }
  if (c.kind === 'energy') {
    if (retreatBlocked(p) && !handCount(p, (h) => h.kind === 'energy' && h !== c)) return 85;
    const need = energyNeed(p, inHand ? c : null);
    if (!need) return 20;
    for (const ch of need) if (ch !== 'C' && covers(c, ch)) return 85;
    return need.includes('C') ? 60 : 5;
  }
  if (c.unread || !c.fx) return 1;
  if (isCandy(c)) {
    if (others(isCandy)) return 25;
    for (const i of p.hand) {
      const h = cardOf(p, i);
      if (h.stage === 2 && hasInPlay(p, h.candyBase)) return 90;
    }
    return 45;
  }
  if (isSwitchCard(c)) {
    if (others(isSwitchCard)) return 15;
    if (!inHand && retreatBlocked(p)) return 95;
    return switchTarget(p, null) || (p.active && plan && !plan.line.includes(p.active.c.key)) ? 70 : 30;
  }
  if (isSupporter(c)) return others(isSupporter) ? 25 : 55;
  if (shallow) return 30;
  // An Item is worth what it would fetch (one level deep), or a few cards when it draws.
  let v = 10;
  for (const e of c.fx.effects) {
    if (e.k === 'search' && e.to !== 'attach') {
      if (e.to === 'bench' && p.bench.length >= p.benchSize) continue;
      const j = bestInDeck(p, e.f, e.to, null, 0, true);
      // A look at the top few cards finds the card less often than a search of the whole deck.
      if (j >= 0) v = Math.max(v, 0.9 * want(p, cardOf(p, p.deck[j]), false, true) * (c.fx.discardCost ? 0.8 : 1) * (e.top ? 0.6 : 1));
    } else if (e.k === 'draw' || e.k === 'attach' || (e.k === 'search' && e.to === 'attach')) v = Math.max(v, 35);
  }
  return v;
}

/** No Pokémon of the main line in play or in hand: the hand cannot start the plan. */
function stuck(p: Player): boolean {
  const plan = p.d.plan;
  if (!plan || lineLead(p)) return false;
  for (const i of p.hand) if (plan.line.includes(cardOf(p, i).key)) return false;
  return true;
}

/** ex, V, VMAX, VSTAR, GX, EX, Radiant and Mega Pokémon carry a Rule Box. */
const hasRuleBox = (c: SimCard) => c.prize > 1 || /^Radiant /.test(c.name);

function matches(c: SimCard, f: CardFilter): boolean {
  if (!matchesKind(c, f)) return false;
  if (f.ruleBox === false && hasRuleBox(c)) return false;
  if (f.owner && !c.name.startsWith(f.owner)) return false;
  if (f.nameHas && !c.name.includes(f.nameHas)) return false;
  return true;
}

/** The effect's filter or any of its alternatives. */
function matchesAny(c: SimCard, e: { f: CardFilter; alts?: CardFilter[] }): boolean {
  if (matches(c, e.f)) return true;
  return !!e.alts && e.alts.some((f) => matches(c, f));
}

function matchesKind(c: SimCard, f: CardFilter): boolean {
  switch (f.k) {
    case 'any':
      return true;
    case 'pokemon':
      return (
        c.kind === 'pokemon' &&
        (!f.basic || c.basic) &&
        (!f.evolution || c.stage > 0) &&
        (!f.stage || c.stage === f.stage) &&
        (!f.type || c.types.includes(f.type)) &&
        (!f.hpMax || c.hp <= f.hpMax) &&
        (!f.suffix || c.suffix === f.suffix || (f.suffix === 'V' && (c.suffix === 'VMAX' || c.suffix === 'VSTAR')))
      );
    case 'trainer':
      return c.kind === 'trainer' && (!f.tt || c.tt === f.tt);
    case 'energy':
      return c.kind === 'energy' && (!f.basic || c.basicEnergy) && (!f.type || c.provides === f.type || (!f.basic && c.provides === '*'));
  }
}

/* ---------- effects ---------- */

function attachTargets(p: Player, t: AttachTarget, self: Mon | null): Mon[] {
  const out: Mon[] = [];
  const ok = (m: Mon) => !t.type || m.c.types.includes(t.type);
  if (t.where === 'self') {
    if (self) out.push(self);
  } else if (t.where === 'active') {
    if (p.active && ok(p.active)) out.push(p.active);
  } else {
    if (t.where === 'any' && p.active && ok(p.active)) out.push(p.active);
    for (const m of p.bench) if (ok(m)) out.push(m);
  }
  // The main line first, most advanced first; an Active paying its retreat right after the line's lead.
  const plan = p.d.plan;
  const depth = (m: Mon) => (plan ? (plan.line.indexOf(m.c.key) + 1 || (payingRetreat(p, m) ? 1.5 : 99)) : 99);
  out.sort((a, b) => depth(a) - depth(b));
  return out;
}

/** Where an Energy card should go among `targets`, or null when none needs it. */
function energyTarget(p: Player, e: SimCard, targets: Mon[]): Mon | null {
  for (const m of targets) if (needs(p, m, e)) return m;
  return null;
}

/** Most wanted card in the deck matching the effect, as an index into the deck, or -1. */
function bestInDeck(p: Player, f: CardFilter | { f: CardFilter; alts?: CardFilter[] }, to: 'hand' | 'bench' | 'attach', targets: Mon[] | null, minWant: number, shallow = false, top = 0, skip?: (c: SimCard) => boolean): number {
  let best = -1;
  let bestW = minWant;
  const fe = 'f' in f ? f : { f };
  // The top of the deck is the end of the array.
  for (let j = top > 0 ? Math.max(0, p.deck.length - top) : 0; j < p.deck.length; j++) {
    const c = cardOf(p, p.deck[j]);
    if (!matchesAny(c, fe) || skip?.(c)) continue;
    if (to === 'bench' && !c.basic) continue;
    let w: number;
    if (to === 'attach') w = c.kind === 'energy' && targets && energyTarget(p, c, targets) ? 50 : -1;
    else w = want(p, c, false, shallow);
    if (w > bestW) {
      bestW = w;
      best = j;
    }
  }
  return best;
}

/** `notType`: an Energy type already fetched by another effect of the card (Crispin's "of different types"). Returns the types fetched. */
function search(g: Game, p: Player, e: Extract<Effect, { k: 'search' }>, self: Mon | null, notType = ''): string {
  let got = 0;
  let types = notType;
  for (let k = 0; k < e.n; k++) {
    if (e.to === 'bench' && p.bench.length >= g.rules.benchSize) break;
    const targets = e.to === 'attach' ? attachTargets(p, e.target ?? { where: 'any' }, self) : null;
    if (e.top && e.top - got <= 0) break;
    const skip = e.distinctTypes || notType ? (c: SimCard) => c.kind === 'energy' && [...c.provides].some((ch) => types.includes(ch)) : undefined;
    const j = bestInDeck(p, e, e.to, targets, e.to === 'bench' ? 2 : 1, false, e.top ? e.top - got : 0, skip);
    if (j < 0) break;
    const i = p.deck[j];
    p.deck.splice(j, 1);
    const c = cardOf(p, i);
    if (e.to === 'hand') p.hand.push(i);
    else if (e.to === 'bench') p.bench.push(newMon(c, p.turn));
    else energyTarget(p, c, targets!)!.energy.push(c);
    if (c.kind === 'energy') types += c.provides;
    got++;
  }
  // "Discard the other cards": the rest of the looked-at cards leave the deck.
  if (e.top && e.discardRest) for (let k = 0; k < e.top - got && p.deck.length; k++) p.discard.push(p.deck.pop()!);
  shuffleInPlace(p.deck, p.rng);
  return types.slice(notType.length);
}

function attachFrom(p: Player, e: Extract<Effect, { k: 'attach' }>, self: Mon | null): number {
  let got = 0;
  const src = e.from === 'hand' ? p.hand : p.discard;
  for (let k = 0; k < e.n; k++) {
    const targets = attachTargets(p, e.target, self);
    let pick = -1;
    let to: Mon | null = null;
    for (let j = 0; j < src.length && !to; j++) {
      const c = cardOf(p, src[j]);
      if (!matches(c, e.f)) continue;
      to = energyTarget(p, c, targets);
      if (to) pick = j;
    }
    if (!to) break;
    const c = cardOf(p, src[pick]);
    src.splice(pick, 1);
    to.energy.push(c);
    got++;
  }
  return got;
}

/** The most wanted card of the discard pile matching the effect (above `minWant`), as an index, or -1. */
function bestInDiscard(p: Player, e: { f: CardFilter; alts?: CardFilter[] }, minWant: number): number {
  let best = -1;
  let bestW = minWant;
  for (let j = 0; j < p.discard.length; j++) {
    const c = cardOf(p, p.discard[j]);
    if (!matchesAny(c, e)) continue;
    const w = want(p, c);
    if (w > bestW) {
      bestW = w;
      best = j;
    }
  }
  return best;
}

function recover(p: Player, e: Extract<Effect, { k: 'recover' | 'recoverToDeck' }>): number {
  let got = 0;
  for (let k = 0; k < e.n; k++) {
    const j = bestInDiscard(p, e, e.k === 'recover' ? 0 : 39);
    if (j < 0) break;
    (e.k === 'recover' ? p.hand : p.deck).push(p.discard[j]);
    p.discard.splice(j, 1);
    got++;
  }
  if (e.k === 'recoverToDeck' && got) shuffleInPlace(p.deck, p.rng);
  return got;
}

/** An Energy on a Pokémon that does not need it, and a Pokémon that does: the pair an Energy move serves, or null. */
function energyMove(p: Player, e: Extract<Effect, { k: 'moveEnergy' }>): [Mon, SimCard, Mon] | null {
  const sources = e.from === 'bench' ? p.bench : [...inPlay(p)];
  const targets = e.to === 'active' ? (p.active ? [p.active] : []) : attachTargets(p, { where: 'any' }, null);
  for (const to of targets) {
    for (const from of sources) {
      if (from === to) continue;
      for (const x of from.energy) {
        if (e.basic && !x.basicEnergy) continue;
        if (needs(p, from, x) || !needs(p, to, x)) continue;
        return [from, x, to];
      }
    }
  }
  return null;
}

/** Cards of the hand the plan wants least that an effect may discard (Gwynn), lowest first. */
function spareInHand(p: Player, f: CardFilter, maxWant: number): number[] {
  const out: { at: number; w: number }[] = [];
  for (let j = 0; j < p.hand.length; j++) {
    const c = cardOf(p, p.hand[j]);
    if (!matches(c, f)) continue;
    const w = want(p, c, true);
    if (w <= maxWant) out.push({ at: j, w });
  }
  return out.sort((a, b) => a.w - b.w).map((x) => x.at);
}

/** The Pokémon a heal may reach, most damaged first. */
function healTargets(p: Player, e: Extract<Effect, { k: 'heal' }>): Mon[] {
  const all = e.target === 'active' ? (p.active ? [p.active] : []) : [...inPlay(p)];
  return all.filter((m) => m.dmg > 0 && (e.minEnergy === undefined || m.energy.length >= e.minEnergy) && (e.maxHpLeft === undefined || m.c.hp - m.dmg <= e.maxHpLeft)).sort((a, b) => b.dmg - a.dmg);
}

/** Whether a Trainer's "only if" holds now (its conditions never read the attacker, so the Active stands in). */
function condHolds(g: Game, p: Player, o: Player | null, c: Cond): boolean {
  const stand: Mon = p.active ?? { c: p.d.cards[0], under: [], energy: [], dmg: 0, entered: 0, abilityTurn: -1, restTurn: 0, restAtk: '', movedTurn: 0 };
  const atk: SimAttack = stand.c.attacks[0] ?? { name: '', cost: '', costN: 0, damage: 0, printed: '', fx: null, expected: 0, drain: 0, rest: 0, sustained: 0 };
  return gameView(g, p, o, stand, atk, false).holds(c) >= 1;
}

/** A Trainer may be played now: its "only if" holds and it is not barred on the first turn. */
function playable(g: Game, p: Player, o: Player | null, fx: ParsedText): boolean {
  if (fx.notFirstTurn && p.turn === 1) return false;
  return !fx.cond || condHolds(g, p, o, fx.cond);
}

/** The Benched Pokémon that should be Active, or null when the Active is the right one. */
function switchTarget(p: Player, o: Player | null): Mon | null {
  const a = p.active;
  if (!a || mainReady(p, a)) return null;
  for (const m of p.bench) if (mainReady(p, m)) return m;
  if (bestPayable(a)) return null;
  let best: Mon | null = null;
  let bestD = 0;
  for (const m of p.bench) {
    const atk = bestPayable(m);
    const d = atk ? damageAgainst(m, o?.active ?? null, atk.expected, atk.fx?.mods) : 0;
    if (d > bestD) {
      best = m;
      bestD = d;
    }
  }
  return best;
}

function swapActive(p: Player, m: Mon): void {
  const at = p.bench.indexOf(m);
  if (at < 0 || !p.active) return;
  // Effects of its own attack leave a Pokémon that goes to the Bench.
  p.active.restTurn = 0;
  p.bench[at] = p.active;
  p.active = m;
  m.movedTurn = p.turn;
}

function shuffleHandDraw(p: Player, n: number, bottom: boolean): void {
  const count = n < 0 ? p.prizes.length : n;
  if (bottom) {
    shuffleInPlace(p.hand, p.rng);
    p.deck.unshift(...p.hand);
  } else {
    p.deck.push(...p.hand);
    shuffleInPlace(p.deck, p.rng);
  }
  p.hand.length = 0;
  draw(p, count);
}

/** The `n` most wanted cards of the deck, each of a different name, put on top of it: the most wanted is drawn first. */
function stack(p: Player, n: number): void {
  const picked: number[] = [];
  for (let k = 0; k < n; k++) {
    let at = -1;
    let w = 1;
    for (let j = 0; j < p.deck.length; j++) {
      const c = cardOf(p, p.deck[j]);
      if (picked.some((i) => cardOf(p, i).key === c.key)) continue;
      const v = want(p, c);
      if (v > w) {
        w = v;
        at = j;
      }
    }
    if (at < 0) break;
    picked.push(p.deck[at]);
    p.deck.splice(at, 1);
  }
  shuffleInPlace(p.deck, p.rng);
  for (let k = picked.length - 1; k >= 0; k--) p.deck.push(picked[k]);
}

/** Effects of an attack's own text that come after its damage. */
const POST_DAMAGE = new Set<Effect['k']>(['selfDamage', 'benchDamageOwn', 'selfToHand']);

/**
 * Pay an optional attack cost? Yes when the damage it adds Knocks Out the defender (the mirror of
 * the attacker in a solo game), or is worth more than the attacks the lost Energy would have
 * powered (`lost` Energy, each a turn of the attack's own base damage).
 */
function payWorthIt(g: Game, p: Player, o: Player | null, m: Mon, fx: ParsedText, lost: number): boolean {
  const atk = m.c.attacks.find((a) => a.fx === fx);
  if (!atk) return false;
  const view = gameView(g, p, o, m, atk, false);
  const unpaid = expectedDamage(atk.damage, atk.fx?.mods.filter((x) => !(x.k === 'bonus' && x.if.k === 'paid')) ?? [], view);
  const paid = expectedDamage(atk.damage, atk.fx?.mods ?? [], { count: view.count, holds: (c) => (c.k === 'paid' ? 1 : view.holds(c)) });
  const def = o?.active ?? m;
  const left = def.c.hp - def.dmg;
  if (damageAgainst(m, o?.active ?? null, paid, atk.fx?.mods) >= left && damageAgainst(m, o?.active ?? null, unpaid, atk.fx?.mods) < left) return true;
  return paid - unpaid >= lost * Math.max(10, unpaid);
}

/** The Energy of `m` an attack's cost may take: `type` letters (any), basic or special only. */
function costEnergy(m: Mon, type?: string, basic?: boolean, special?: boolean): SimCard[] {
  return m.energy.filter((e) => energyMatches(e, type, basic, special));
}

function removeEnergy(m: Mon, e: SimCard): void {
  const at = m.energy.lastIndexOf(e);
  if (at >= 0) m.energy.splice(at, 1);
}

/** A Pokémon of `p` leaves play Knocked Out by its own side: the opponent takes its Prize cards. */
function ownKnockOut(g: Game, p: Player, o: Player | null, m: Mon): void {
  p.discard.push(m.c.i, ...m.under);
  for (const e of m.energy) p.discard.push(e.i);
  if (m === p.active) p.active = null;
  else p.bench.splice(p.bench.indexOf(m), 1);
  g.trace?.(`${m.c.name} Knocked Out by its own side`);
  if (o) takePrizes(g, o, p, m.c.prize);
}

/** `p` takes `n` Prize cards for Knocking Out a Pokémon of `o`; the game ends when they were the last. */
function takePrizes(g: Game, p: Player, o: Player, n: number): void {
  if (g.winner) return;
  const k = Math.min(n, p.prizes.length);
  for (let i = 0; i < k; i++) p.hand.push(p.prizes.pop()!);
  p.taken += k;
  if (!p.prizes.length) {
    g.winner = p;
    g.ending = 'prizes';
  } else if (!o.active && !o.bench.length && g.rules.noPokemonLoses) {
    g.winner = p;
    g.ending = 'no Pokémon';
  }
}

/** After the Active left play: promote from the Bench, or lose for having no Pokémon (a solo game plays on with none). */
function refillActive(g: Game, p: Player, o: Player | null): void {
  if (p.active || g.winner) return;
  if (p.bench.length) promote(p, o);
  else if (o && g.rules.noPokemonLoses) {
    g.winner = o;
    g.ending = 'no Pokémon';
  }
}

function runEffects(g: Game, p: Player, o: Player | null, fx: ParsedText, self: Mon | null, phase: 'all' | 'pre' | 'post' = 'all'): void {
  if (phase !== 'post' && fx.chance < 1 && p.rng.next() >= fx.chance) return;
  const altN = (e: { n: number; alt?: { if: Cond; n: number } }) => (e.alt && condHolds(g, p, o, e.alt.if) ? e.alt.n : e.n);
  const fetched: string[] = [];
  for (const [idx, e] of fx.effects.entries()) {
    if (phase !== 'all' && (phase === 'post') !== POST_DAMAGE.has(e.k)) continue;
    switch (e.k) {
      case 'draw':
        draw(p, altN(e));
        break;
      case 'drawUntil':
        draw(p, altN(e) - p.hand.length);
        break;
      case 'discardHandDraw':
        p.discard.push(...p.hand);
        p.hand.length = 0;
        draw(p, e.n);
        break;
      case 'shuffleHandDraw':
        shuffleHandDraw(p, altN(e), e.bottom);
        // Judge, Iono, Unfair Stamp: the opponent shuffles and draws too.
        if (e.both && o) shuffleHandDraw(o, e.oppN ?? e.n, e.bottom);
        break;
      case 'search':
        fetched[idx] = search(g, p, e, self, e.distinctFrom !== undefined ? (fetched[e.distinctFrom] ?? '') : '');
        break;
      case 'attach':
        attachFrom(p, e, self);
        break;
      case 'recover':
      case 'recoverToDeck':
        recover(p, e);
        break;
      case 'moveEnergy': {
        for (let k = 0; k < e.n; k++) {
          const mv = energyMove(p, e);
          if (!mv) break;
          const [from, x, to] = mv;
          removeEnergy(from, x);
          to.energy.push(x);
          g.trace?.(`moves ${x.name} from ${from.c.name} to ${to.c.name}`);
        }
        break;
      }
      case 'discardDraw': {
        const spare = spareInHand(p, e.f, 25).slice(0, e.max).sort((a, b) => b - a);
        for (const at of spare) p.discard.push(removeFromHand(p, at));
        draw(p, e.per * spare.length);
        break;
      }
      case 'heal': {
        const targets = healTargets(p, e);
        for (const m of e.target === 'each' ? targets : targets.slice(0, 1)) m.dmg = Math.max(0, m.dmg - e.n);
        break;
      }
      case 'stack':
        stack(p, e.n);
        break;
      case 'switch': {
        const m = switchTarget(p, o);
        if (m) swapActive(p, m);
        break;
      }
      case 'rareCandy':
        break;
      case 'discardSelfEnergy': {
        if (!self) break;
        const pool = costEnergy(self, e.type, e.basic, e.special);
        const n = Math.min(e.all ? pool.length : e.n, pool.length);
        if (!n || (e.may && !payWorthIt(g, p, o, self, fx, n))) break;
        for (const x of pool.slice(pool.length - n)) {
          removeEnergy(self, x);
          p.discard.push(x.i);
        }
        p.attackDiscarded += n;
        p.attackPaid = true;
        g.trace?.(`discards ${n} Energy from ${self.c.name}`);
        break;
      }
      case 'discardAnyEnergy': {
        // As many as a Knock Out needs (the mirror's HP in a solo game), else every one: the attack hits for them.
        if (!self) break;
        const atk = self.c.attacks.find((a) => a.fx === fx);
        const per = atk?.fx?.mods.find((x) => (x.k === 'times' || x.k === 'plus') && x.per.k === 'discarded');
        const def = o?.active ?? self;
        const left = def.c.hp - def.dmg;
        const base = per?.k === 'plus' ? (atk?.damage ?? 0) : 0;
        const need = per && per.k !== 'ignore' && per.k !== 'firstTurnBarred' && per.k !== 'bonus' && per.k !== 'nothing' && per.n > 0 ? Math.ceil(Math.max(0, left - base) / per.n) : 99;
        const pool: [Mon, SimCard][] = [];
        for (const m of p.bench) for (const x of costEnergy(m, e.type, e.basic, e.special)) pool.push([m, x]);
        for (const x of costEnergy(self, e.type, e.basic, e.special)) pool.push([self, x]);
        const n = Math.min(need, pool.length);
        for (const [m, x] of pool.slice(0, n)) {
          removeEnergy(m, x);
          p.discard.push(x.i);
        }
        p.attackDiscarded += n;
        if (n) p.attackPaid = true;
        g.trace?.(`discards ${n} Energy from its Pokémon`);
        break;
      }
      case 'energyToHand':
      case 'energyToDeck': {
        if (!self) break;
        const pool = costEnergy(self, e.k === 'energyToHand' ? e.type : undefined);
        const n = Math.min(e.k === 'energyToDeck' && e.all ? pool.length : e.n, pool.length);
        if (!n || (e.may && !payWorthIt(g, p, o, self, fx, n))) break;
        for (const x of pool.slice(pool.length - n)) {
          removeEnergy(self, x);
          if (e.k === 'energyToHand') p.hand.push(x.i);
          else p.deck.push(x.i);
        }
        if (e.k === 'energyToDeck') shuffleInPlace(p.deck, p.rng);
        p.attackPaid = true;
        break;
      }
      case 'millSelf':
        for (let k = 0; k < e.n && p.deck.length; k++) p.discard.push(p.deck.pop()!);
        break;
      case 'discardHand': {
        if (e.may) {
          // Only cards the plan wants least.
          let spare = 0;
          for (const i of p.hand) if (want(p, cardOf(p, i), true) <= 10) spare++;
          if (spare < e.n) break;
        }
        discardLeast(p, e.n);
        p.attackPaid = true;
        break;
      }
      case 'selfDamage': {
        if (!self || (e.ifPaid && !p.attackPaid)) break;
        self.dmg += e.n;
        if (self.dmg >= self.c.hp) {
          ownKnockOut(g, p, o, self);
          refillActive(g, p, o);
        }
        break;
      }
      case 'benchDamageOwn': {
        const targets = e.each ? p.bench.slice() : p.bench.length ? [p.bench.reduce((a, b) => (b.c.hp - b.dmg > a.c.hp - a.dmg ? b : a))] : [];
        for (const m of targets) m.dmg += e.n;
        for (const m of targets) if (m.dmg >= m.c.hp && p.bench.includes(m)) ownKnockOut(g, p, o, m);
        break;
      }
      case 'selfToHand': {
        if (!self) break;
        p.hand.push(self.c.i, ...self.under, ...self.energy.map((x) => x.i));
        if (self === p.active) p.active = null;
        else p.bench.splice(p.bench.indexOf(self), 1);
        g.trace?.(`${self.c.name} returns to the hand`);
        refillActive(g, p, o);
        break;
      }
    }
  }
}

/** Would the effect do the plan any good now? */
function useful(g: Game, p: Player, o: Player | null, fx: ParsedText, self: Mon | null): boolean {
  for (const e of fx.effects) {
    switch (e.k) {
      case 'draw':
        if (p.deck.length - e.n >= reserve(p) && !glutted(p)) return true;
        break;
      case 'drawUntil':
        if (p.hand.length < e.n - 1 && p.deck.length - (e.n - p.hand.length) >= reserve(p)) return true;
        break;
      case 'discardHandDraw':
      case 'shuffleHandDraw':
        if (drawValue(p, e) > 1) return true;
        break;
      case 'search': {
        if (e.to === 'bench' && p.bench.length >= g.rules.benchSize) break;
        // A look that discards the rest thins the deck like a draw.
        if (e.top && e.discardRest && p.deck.length - e.top < reserve(p)) break;
        const targets = e.to === 'attach' ? attachTargets(p, e.target ?? { where: 'any' }, self) : null;
        if (bestInDeck(p, e, e.to, targets, e.to === 'bench' ? 10 : 25) >= 0) return true;
        break;
      }
      case 'attach': {
        const src = e.from === 'hand' ? p.hand : p.discard;
        const targets = attachTargets(p, e.target, self);
        for (const i of src) if (matches(cardOf(p, i), e.f) && energyTarget(p, cardOf(p, i), targets)) return true;
        break;
      }
      case 'recover':
        if (bestInDiscard(p, e, 39) >= 0) return true;
        break;
      case 'recoverToDeck':
        if (bestInDiscard(p, e, 49) >= 0) return true;
        break;
      case 'moveEnergy':
        if (energyMove(p, e)) return true;
        break;
      case 'discardDraw': {
        const spare = Math.min(e.max, spareInHand(p, e.f, 25).length);
        if (spare && p.deck.length - e.per * spare >= reserve(p) && !glutted(p)) return true;
        break;
      }
      case 'heal':
        if (healTargets(p, e).some((m) => m.dmg >= Math.min(30, e.n))) return true;
        break;
      case 'stack':
        if (p.deck.length > reserve(p) && bestInDeck(p, { k: 'any' }, 'hand', null, 40) >= 0) return true;
        break;
      case 'switch':
        if (switchTarget(p, o)) return true;
        break;
      case 'rareCandy':
        break;
    }
  }
  return false;
}

/** Cards gained by a hand-replacing draw, less what the hand already held that the plan wants. */
function drawValue(p: Player, e: Effect): number {
  // Drawing the deck thin loses the game at the start of a later turn (rules: deckOutLoses).
  const drawn = e.k === 'shuffleHandDraw' ? (e.n < 0 ? p.prizes.length : e.n) - p.hand.length : e.k === 'drawUntil' ? e.n - p.hand.length : 'n' in e ? e.n : 0;
  if (p.deck.length - drawn < reserve(p)) return -1;
  let keep = 0;
  for (const i of p.hand) if (want(p, cardOf(p, i), true) >= 40) keep++;
  const bonus = stuck(p) ? 4 : 0;
  // Cards drawn into a hand that already holds plenty are worth less: nothing in them is needed yet.
  const glut = thin(p) ? Math.max(0, p.hand.length - 4) : 0;
  if (e.k === 'discardHandDraw') return Math.min(e.n, p.deck.length) - keep * 1.2 + bonus - glut;
  if (e.k === 'shuffleHandDraw') return (e.n < 0 ? p.prizes.length : e.n) - p.hand.length * 0.5 - keep * 0.7 + bonus - glut;
  if (e.k === 'draw') return Math.min(e.n, p.deck.length) - glut;
  if (e.k === 'drawUntil') return Math.max(0, e.n - p.hand.length);
  if (e.k === 'discardDraw') return e.per * Math.min(e.max, spareInHand(p, e.f, 25).length) * 0.8 - glut;
  return 0;
}

/** What playing a Supporter is worth now, in cards. */
function supporterValue(g: Game, p: Player, o: Player | null, fx: ParsedText): number {
  let v = 0;
  for (const e of fx.effects) {
    if (e.k === 'search') {
      if (e.to === 'bench' && p.bench.length >= g.rules.benchSize) continue;
      const targets = e.to === 'attach' ? attachTargets(p, e.target ?? { where: 'any' }, null) : null;
      const j = bestInDeck(p, e.f, e.to, targets, 5);
      if (j >= 0) v += (e.to === 'attach' ? 50 : want(p, cardOf(p, p.deck[j]))) / 25 + 0.5 * (e.n - 1);
    } else if (e.k === 'stack') {
      // The card arrives with the next draw, not now: worth about half a search.
      const j = bestInDeck(p, { k: 'any' }, 'hand', null, 40);
      if (j >= 0) v += want(p, cardOf(p, p.deck[j])) / 50 + 0.3 * (e.n - 1);
    } else if (e.k === 'switch') v += switchTarget(p, o) ? 2 : 0;
    else if (e.k === 'moveEnergy' || e.k === 'heal' || e.k === 'recoverToDeck') v += useful(g, p, o, { ...fx, effects: [e] }, null) ? 1.5 : 0;
    else if (e.k === 'discardDraw') v += Math.max(0, drawValue(p, e));
    else if (e.k === 'attach' || e.k === 'recover') v += useful(g, p, o, { ...fx, effects: [e] }, null) ? 1.5 * e.n : 0;
    else v += drawValue(p, e);
  }
  return v * fx.chance;
}

/** Discard the `n` cards the plan wants least (an Item's cost). */
function discardLeast(p: Player, n: number): void {
  for (let k = 0; k < n && p.hand.length; k++) {
    let at = 0;
    let low = Infinity;
    for (let j = 0; j < p.hand.length; j++) {
      const w = want(p, cardOf(p, p.hand[j]), true);
      if (w < low) {
        low = w;
        at = j;
      }
    }
    p.discard.push(removeFromHand(p, at));
  }
}

/* ---------- actions ---------- */

function triggerAbilities(g: Game, p: Player, o: Player | null, m: Mon, trigger: 'bench' | 'evolve'): void {
  for (const ab of m.c.abilities) {
    if (ab.trigger !== trigger || !ab.fx.effects.length) continue;
    if (ab.vstar && p.vstarUsed) continue;
    if (ab.fx.cond && !condHolds(g, p, o, ab.fx.cond)) continue;
    if (!useful(g, p, o, ab.fx, m)) continue;
    if (ab.vstar) p.vstarUsed = true;
    g.trace?.(`ability ${ab.name}`);
    runEffects(g, p, o, ab.fx, m);
  }
}

function benchBasic(g: Game, p: Player, o: Player | null): boolean {
  const room = g.rules.benchSize - p.bench.length;
  if (room <= 0) return false;
  let at = -1;
  let bestW = -1;
  for (let j = 0; j < p.hand.length; j++) {
    const c = cardOf(p, p.hand[j]);
    if (!c.basic) continue;
    const w = want(p, c);
    // Keep a Bench spot free for the plan rather than fill it with a Pokémon nothing calls for.
    if (w <= 15 && room <= 1) continue;
    if (w > bestW) {
      bestW = w;
      at = j;
    }
  }
  if (at < 0) return false;
  const m = newMon(cardOf(p, removeFromHand(p, at)), p.turn);
  p.bench.push(m);
  p.acted++;
  g.trace?.(`bench ${m.c.name}`);
  triggerAbilities(g, p, o, m, 'bench');
  return true;
}

function canEvolve(g: Game, p: Player, m: Mon): boolean {
  return (g.rules.evolveOnOwnFirstTurn || p.turn > 1) && (g.rules.evolveOnTurnPlayed || m.entered < p.turn);
}

function evolve(g: Game, p: Player, o: Player | null, m: Mon, c: SimCard): void {
  g.trace?.(`evolve ${m.c.name} → ${c.name}`);
  m.under.push(m.c.i);
  m.c = c;
  m.entered = p.turn;
  p.acted++;
  triggerAbilities(g, p, o, m, 'evolve');
}

function evolveAny(g: Game, p: Player, o: Player | null): boolean {
  let at = -1;
  let onto: Mon | null = null;
  let bestW = -1;
  for (let j = 0; j < p.hand.length; j++) {
    const c = cardOf(p, p.hand[j]);
    if (c.kind !== 'pokemon' || !c.from) continue;
    for (const m of inPlay(p)) {
      if (m.c.key !== c.from || !canEvolve(g, p, m)) continue;
      const w = want(p, c);
      if (w > bestW) {
        bestW = w;
        at = j;
        onto = m;
      }
    }
  }
  if (!onto) return false;
  evolve(g, p, o, onto, cardOf(p, removeFromHand(p, at)));
  return true;
}

/** Rare Candy, by its own text: not on your first turn, not on a Basic put into play this turn. */
function playCandy(g: Game, p: Player, o: Player | null): boolean {
  if (p.turn <= 1) return false;
  const candyAt = p.hand.findIndex((i) => isCandy(cardOf(p, i)));
  if (candyAt < 0) return false;
  for (let j = 0; j < p.hand.length; j++) {
    const c = cardOf(p, p.hand[j]);
    if (c.stage !== 2 || !c.candyBase) continue;
    for (const m of inPlay(p)) {
      if (m.c.key !== c.candyBase || m.c.stage !== 0 || m.entered >= p.turn) continue;
      const stageId = p.hand[j];
      p.discard.push(p.hand[candyAt]);
      p.hand = p.hand.filter((_, k) => k !== candyAt && k !== j);
      evolve(g, p, o, m, cardOf(p, stageId));
      return true;
    }
  }
  return false;
}

function abilityUsable(g: Game, p: Player, o: Player | null, m: Mon, ab: ParsedAbility): boolean {
  if (!ab.fx.effects.length) return false;
  if (ab.trigger !== 'turn' && ab.trigger !== 'repeat') return false;
  if (ab.activeOnly && p.active !== m) return false;
  if (ab.trigger === 'turn' && m.abilityTurn === p.turn) return false;
  if (ab.limitName && p.limitNames.includes(ab.limitName)) return false;
  if (ab.vstar && p.vstarUsed) return false;
  if (ab.fx.cond && !condHolds(g, p, o, ab.fx.cond)) return false;
  // A discard cost ("You must discard a card from your hand in order to use this Ability"): only with a spare card of the kind.
  if (ab.fx.discardCost && spareInHand(p, ab.fx.discardCostF ?? { k: 'any' }, 30).length < ab.fx.discardCost) return false;
  return true;
}

function useAbility(g: Game, p: Player, o: Player | null, endsTurn: boolean): boolean {
  for (const m of inPlay(p)) {
    for (const ab of m.c.abilities) {
      if (ab.fx.endsTurn !== endsTurn || !abilityUsable(g, p, o, m, ab) || !useful(g, p, o, ab.fx, m)) continue;
      m.abilityTurn = p.turn;
      if (ab.limitName) p.limitNames.push(ab.limitName);
      if (ab.vstar) p.vstarUsed = true;
      p.acted++;
      g.trace?.(`ability ${ab.name}`);
      if (ab.fx.discardCost) {
        const spare = spareInHand(p, ab.fx.discardCostF ?? { k: 'any' }, 30).slice(0, ab.fx.discardCost).sort((a, b) => b - a);
        for (const at of spare) p.discard.push(removeFromHand(p, at));
      }
      runEffects(g, p, o, ab.fx, m);
      if (ab.fx.endsTurn) p.turnEnded = true;
      return true;
    }
  }
  return false;
}

const isSwitchOnly = (fx: ParsedText) => fx.effects.length > 0 && fx.effects.every((e) => e.k === 'switch');
const hasV = (p: Player) => {
  for (const m of inPlay(p)) if (m.c.suffix === 'V' || m.c.suffix === 'VSTAR' || m.c.suffix === 'VMAX') return true;
  return false;
};

function playItem(g: Game, p: Player, o: Player | null): boolean {
  let at = -1;
  let lowCost = Infinity;
  for (let j = 0; j < p.hand.length; j++) {
    const c = cardOf(p, p.hand[j]);
    if (c.kind !== 'trainer' || !c.fx || c.unread || !playable(g, p, o, c.fx)) continue;
    if (c.tt === 'Tool') {
      // A Tool read here lends a VSTAR Power (Forest Seal Stone): it needs a Pokémon V and the game's one VSTAR Power.
      if (p.vstarUsed || !hasV(p)) continue;
    } else if (c.tt !== 'Item') continue;
    if (isCandy(c) || isSwitchOnly(c.fx)) continue;
    const cost = c.fx.discardCost;
    if (cost > p.hand.length - 1) continue;
    if (!useful(g, p, o, c.fx, null)) continue;
    if (cost) {
      // Pay a discard only for a piece the plan wants badly, with cards it wants less to pay with.
      const s = c.fx.effects.find((e) => e.k === 'search');
      if (!s || s.k !== 'search') continue;
      const j2 = bestInDeck(p, s.f, s.to, null, 59);
      if (j2 < 0) continue;
      const top = want(p, cardOf(p, p.deck[j2]));
      let cheap = 0;
      for (let k = 0; k < p.hand.length; k++) if (k !== j && want(p, cardOf(p, p.hand[k]), true) < top - 20) cheap++;
      if (cheap < cost) continue;
    }
    if (cost < lowCost) {
      lowCost = cost;
      at = j;
    }
  }
  if (at < 0) return false;
  const c = cardOf(p, removeFromHand(p, at));
  p.discard.push(c.i);
  if (c.tt === 'Tool') p.vstarUsed = true;
  if (c.fx!.discardCost) discardLeast(p, c.fx!.discardCost);
  p.acted++;
  p.played.add(c.i);
  g.trace?.(`item ${c.name}`);
  runEffects(g, p, o, c.fx!, null);
  return true;
}

function playStadium(g: Game, p: Player, o: Player | null): boolean {
  if (p.stadiumDone) return false;
  for (let j = 0; j < p.hand.length; j++) {
    const c = cardOf(p, p.hand[j]);
    if (c.tt !== 'Stadium' || c.unread || !c.fx || !playable(g, p, o, c.fx)) continue;
    if (g.stadium && g.stadium.c.key === c.key) continue;
    if (!useful(g, p, o, c.fx, null) && !(g.stadium && g.stadium.owner !== p)) continue;
    removeFromHand(p, j);
    if (g.stadium) g.stadium.owner.discard.push(g.stadium.c.i);
    g.stadium = { c, owner: p };
    p.played.add(c.i);
    p.stadiumDone = true;
    p.acted++;
    return true;
  }
  return false;
}

function useStadium(g: Game, p: Player, o: Player | null): boolean {
  const s = g.stadium;
  if (!s || !s.c.fx || p.stadiumTurn === p.turn) return false;
  if (s.owner !== p && !s.c.shared) return false;
  if (!playable(g, p, o, s.c.fx) || !useful(g, p, o, s.c.fx, null)) return false;
  p.stadiumTurn = p.turn;
  p.acted++;
  runEffects(g, p, o, s.c.fx, null);
  return true;
}

function attachEnergy(g: Game, p: Player): boolean {
  if (p.energyDone >= g.rules.energyPerTurn) return false;
  const a = p.active;
  // A ready attacker waits on the Bench behind an Active one Energy short of retreating: pay the retreat first.
  if (a && a.c.retreat - a.energy.length === 1 && p.retreatDone < g.rules.retreatsPerTurn && switchTarget(p, null) && !p.hand.some((i) => isSwitchCard(cardOf(p, i)))) {
    const j = p.hand.findIndex((i) => cardOf(p, i).kind === 'energy');
    if (j >= 0) {
      a.energy.push(cardOf(p, removeFromHand(p, j)));
      p.energyDone++;
      p.acted++;
      g.trace?.(`energy → ${a.c.name} (to retreat)`);
      return true;
    }
  }
  // The main line, most advanced first; anything else only when it is Active.
  const plan = p.d.plan;
  const targets = attachTargets(p, { where: 'any' }, null).filter((m) => m === a || (plan && plan.line.includes(m.c.key)));
  for (const m of targets) {
    // An Energy that pays a typed symbol before one that only pays Colorless.
    let pick = -1;
    const atk = targetAttack(p, m);
    if (!atk) continue;
    const miss = missing(atk.cost, m.energy);
    if (!miss) continue;
    for (let pass = 0; pass < 2 && pick < 0; pass++) {
      for (let j = 0; j < p.hand.length; j++) {
        const e = cardOf(p, p.hand[j]);
        if (e.kind !== 'energy') continue;
        const ok = pass === 0 ? [...miss].some((ch) => ch !== 'C' && covers(e, ch)) : miss.includes('C');
        if (ok) {
          pick = j;
          break;
        }
      }
    }
    if (pick >= 0) {
      m.energy.push(cardOf(p, removeFromHand(p, pick)));
      p.energyDone++;
      p.acted++;
      g.trace?.(`energy → ${m.c.name}`);
      return true;
    }
  }
  return false;
}

function playSupporter(g: Game, p: Player, o: Player | null): boolean {
  if (p.supporterDone >= g.rules.supportersPerTurn) return false;
  let at = -1;
  let best = 0.75;
  for (let j = 0; j < p.hand.length; j++) {
    const c = cardOf(p, p.hand[j]);
    if (c.tt !== 'Supporter' || c.unread || !c.fx || !playable(g, p, o, c.fx)) continue;
    // p. 12: no Supporter on the first player's first turn, unless the card says it may ("If you go first, …").
    if (p.first && p.turn === 1 && !g.rules.firstPlayerSupporterTurn1 && !c.fx.firstTurnOk) continue;
    const v = supporterValue(g, p, o, c.fx);
    if (v > best) {
      best = v;
      at = j;
    }
  }
  if (at < 0) return false;
  const c = cardOf(p, removeFromHand(p, at));
  p.discard.push(c.i);
  p.supporterDone++;
  p.acted++;
  p.played.add(c.i);
  g.trace?.(`supporter ${c.name}`);
  runEffects(g, p, o, c.fx!, null);
  return true;
}

function moveUp(g: Game, p: Player, o: Player | null): boolean {
  const m = switchTarget(p, o);
  if (!m || !p.active) return false;
  const s = p.hand.findIndex((i) => {
    const c = cardOf(p, i);
    return c.kind === 'trainer' && c.tt === 'Item' && !c.unread && !!c.fx && isSwitchOnly(c.fx) && c.fx.chance === 1;
  });
  if (s >= 0) {
    p.discard.push(removeFromHand(p, s));
    swapActive(p, m);
    g.trace?.(`item Switch to ${m.c.name}`);
    p.acted++;
    return true;
  }
  const a = p.active;
  if (p.retreatDone < g.rules.retreatsPerTurn && a.energy.length >= a.c.retreat) {
    for (let k = 0; k < a.c.retreat; k++) p.discard.push(a.energy.pop()!.i);
    swapActive(p, m);
    g.trace?.(`retreat to ${m.c.name}`);
    p.retreatDone++;
    p.acted++;
    return true;
  }
  return false;
}

/* ---------- turns ---------- */

/** Mulligan until a Basic, choose the Active, bench the other Basics, set the Prize cards. False when the deck has no Basic. */
export function setup(g: Game, p: Player): boolean {
  if (!p.d.basics) return false;
  for (;;) {
    shuffleInPlace(p.deck, p.rng);
    for (let k = 0; k < g.rules.openingHand && p.deck.length; k++) p.hand.push(p.deck.pop()!);
    if (p.hand.some((i) => cardOf(p, i).basic)) break;
    p.mulligans++;
    p.deck.push(...p.hand);
    p.hand.length = 0;
  }
  for (const i of p.hand) {
    if (cardOf(p, i).unread) p.unreadDraws++;
    p.held.add(i);
  }
  // Active: the main line's Basic (it evolves in place), else the cheapest to retreat.
  const plan = p.d.plan;
  let at = -1;
  let best = -Infinity;
  for (let j = 0; j < p.hand.length; j++) {
    const c = cardOf(p, p.hand[j]);
    if (!c.basic) continue;
    const s = (plan && plan.line.includes(c.key) ? 100 : 0) - c.retreat * 10 + c.hp / 100;
    if (s > best) {
      best = s;
      at = j;
    }
  }
  p.active = newMon(cardOf(p, removeFromHand(p, at)), 0);
  for (let j = p.hand.length - 1; j >= 0 && p.bench.length < g.rules.benchSize; j--) {
    const c = cardOf(p, p.hand[j]);
    if (c.basic) p.bench.push(newMon(cardOf(p, removeFromHand(p, j)), 0));
  }
  for (let k = 0; k < g.rules.prizes && p.deck.length; k++) p.prizes.push(p.deck.pop()!);
  g.trace?.(`setup: ${p.mulligans} mulligans; active ${p.active.c.name}; bench ${p.bench.map((m) => m.c.name).join(', ')}; hand ${names(p, p.hand)}; prizes ${names(p, p.prizes)}`);
  return true;
}

/** Start of a turn: reset the per-turn limits and draw. False when the deck is empty (the player loses). */
export function beginTurn(g: Game, p: Player): boolean {
  p.turn++;
  p.energyDone = 0;
  p.supporterDone = 0;
  p.retreatDone = 0;
  p.stadiumDone = false;
  p.limitNames.length = 0;
  p.acted = 0;
  p.turnEnded = false;
  if (p.first && p.turn === 1 && !g.rules.firstPlayerDrawsTurn1) return true;
  if (!p.deck.length) return !g.rules.deckOutLoses;
  draw(p, 1);
  g.trace?.(`turn ${p.turn}${p.first ? ' (first)' : ''}: drew ${p.d.cards[p.hand[p.hand.length - 1]].name}; hand ${names(p, p.hand)}`);
  return true;
}

/** Everything before the attack. */
export function mainPhase(g: Game, p: Player, o: Player | null): void {
  for (let guard = 0; guard < 200; guard++) {
    if (benchBasic(g, p, o)) continue;
    if (evolveAny(g, p, o)) continue;
    if (playCandy(g, p, o)) continue;
    if (moveUp(g, p, o)) continue;
    if (useAbility(g, p, o, false)) continue;
    if (playItem(g, p, o)) continue;
    if (playStadium(g, p, o)) continue;
    if (useStadium(g, p, o)) continue;
    if (attachEnergy(g, p)) continue;
    if (playSupporter(g, p, o)) continue;
    break;
  }
  const attackBarred = p.first && p.turn === 1 && !g.rules.firstPlayerAttacksTurn1;
  // An Ability that ends the turn (Rotom V's Instant Charge) only when there is no attack to lose.
  if (attackBarred || !p.active || !bestPayable(p.active)) useAbility(g, p, o, true);
  if (p.acted === 0) p.deadTurns++;
  if (g.trace) g.trace(`  end: active ${p.active?.c.name} [${p.active?.energy.map((e) => e.provides).join('')}] bench ${p.bench.map((m) => `${m.c.name}[${m.energy.map((e) => e.provides).join('')}]`).join(', ')}; hand ${names(p, p.hand)}`);
}

/** Damage after Weakness and Resistance of the defending Pokémon (none in a solo game), unless the attack's text ignores them. */
export function damageAgainst(att: Mon, def: Mon | null, base: number, mods?: readonly DamageMod[]): number {
  if (!def || base <= 0) return base;
  let d = base;
  const ignore = mods?.find((m) => m.k === 'ignore');
  if (!(ignore?.k === 'ignore' && ignore.weakness)) for (const w of def.c.weak) if (w.t && att.c.types.includes(w.t)) d = d * w.mul + w.add;
  if (!(ignore?.k === 'ignore' && ignore.resistance)) for (const r of def.c.resist) if (r.t && att.c.types.includes(r.t)) d -= r.amt;
  return Math.max(0, d);
}

/* ---------- damage that is not the printed number ---------- */

/**
 * The board an attack's text reads, for `expectedDamage`. `o` is the opponent; in a solo game
 * (`o` null) the opponent is a mirror and every count of the other side reads the pilot's own.
 * With `roll` the coins are flipped on the player's stream; without it they count their expectation.
 */
export function gameView(g: Game, p: Player, o: Player | null, m: Mon, atk: SimAttack, roll: boolean): DamageView {
  const opp = o ?? p;
  const mons = (side: 'self' | 'opponent' | 'both', bench: boolean): Mon[] => {
    const out: Mon[] = [];
    if (side !== 'opponent') out.push(...(bench ? p.bench : [...inPlay(p)]));
    if (side !== 'self') out.push(...(bench ? opp.bench : [...inPlay(opp)]));
    return out;
  };
  const flip = () => p.rng.next() < 0.5;
  const count = (c: Count): number => {
    switch (c.k) {
      case 'heads': {
        if (typeof c.flips === 'object') {
          const n = Math.round(count(c.flips.per));
          if (!roll) return n / 2;
          let h = 0;
          for (let k = 0; k < n; k++) if (flip()) h++;
          return h;
        }
        if (!roll) return expectedHeads(c.flips);
        let h = 0;
        if (c.flips === 'untilTails') while (flip()) h++;
        else for (let k = 0; k < c.flips; k++) if (flip()) h++;
        return h;
      }
      case 'energy': {
        const pool: SimCard[] = [];
        if (c.on === 'self' || c.on === 'bothActive') pool.push(...m.energy);
        if (c.on === 'all') for (const x of inPlay(p)) pool.push(...x.energy);
        if ((c.on === 'opponentActive' || c.on === 'bothActive') && opp.active) pool.push(...opp.active.energy);
        if (c.on === 'opponentAll') for (const x of inPlay(opp)) pool.push(...x.energy);
        return pool.filter((e) => energyMatches(e, c.type, c.basic, c.special)).length;
      }
      case 'bench':
        return mons(c.side, true).filter((x) => !c.t || pokeMatches(x.c, c.t)).length;
      case 'inPlay':
        return mons(c.side, false).filter((x) => !c.t || pokeMatches(x.c, c.t)).length;
      case 'counters': {
        const xs = c.on === 'self' ? [m] : c.on === 'opponentActive' ? (opp.active ? [opp.active] : []) : c.on === 'opponentAll' ? [...inPlay(opp)] : p.bench;
        return xs.reduce((n, x) => n + Math.floor(x.dmg / 10), 0);
      }
      case 'prizesTaken':
        return c.side === 'self' ? p.taken : opp.taken;
      case 'hand':
        return c.side === 'self' ? p.hand.length : opp.hand.length;
      case 'discard':
        return (c.side === 'self' ? p : opp).discard.filter((i) => cardMatches(cardOf(p, i), c.t)).length;
      case 'retreatCost':
        return opp.active?.c.retreat ?? 0;
      case 'discarded':
        return roll ? p.attackDiscarded : Math.min(2, [...inPlay(p)].reduce((n, x) => n + x.energy.length, 0));
    }
  };
  const holds = (c: Cond): number => {
    switch (c.k) {
      case 'coin':
        return roll ? (flip() ? 1 : 0) : 0.5;
      case 'not':
        return 1 - holds(c.c);
      case 'any':
        return Math.max(...c.cs.map(holds));
      case 'opponentActive': {
        const a = opp.active;
        const yes = !!a && pokeMatches(a.c, c.t);
        return yes !== !!c.not ? 1 : 0;
      }
      case 'opponentActiveDamaged':
        return (opp.active ? opp.active.dmg > 0 : false) !== !!c.not ? 1 : 0;
      case 'selfDamaged':
        return m.dmg > 0 !== !!c.not ? 1 : 0;
      case 'selfEnergy':
        if (c.extra !== undefined) return m.energy.length - atk.costN >= c.extra ? 1 : 0;
        return m.energy.some((e) => energyMatches(e, c.type, undefined, c.special)) ? 1 : 0;
      case 'selfTool':
        return 0;
      case 'movedThisTurn':
        return m.movedTurn === p.turn ? 1 : 0;
      case 'koLastTurn':
        return p.koBefore === p.turn && (!c.owner || p.koName.startsWith(c.owner)) ? 1 : 0;
      case 'stadium':
        return !!g.stadium !== !!c.not ? 1 : 0;
      case 'inPlay': {
        const n = mons(c.side, !!c.bench).filter((x) => pokeMatches(x.c, c.t)).length;
        return n >= c.min !== !!c.not ? 1 : 0;
      }
      case 'energyInPlay': {
        let n = 0;
        for (const x of inPlay(p)) n += x.energy.filter((e) => energyMatches(e, c.type)).length;
        return n >= c.min ? 1 : 0;
      }
      case 'discard':
        return (c.side === 'self' ? p : opp).discard.filter((i) => cardMatches(cardOf(p, i), c.t)).length >= c.min ? 1 : 0;
      case 'prizes': {
        const left = (c.side === 'self' ? p : opp).prizes.length;
        if (c.max !== undefined) return left <= c.max ? 1 : 0;
        return c.exactly?.includes(left) ? 1 : 0;
      }
      case 'prizesMore':
        return (c.side === 'self' ? p.prizes.length > opp.prizes.length : opp.prizes.length > p.prizes.length) ? 1 : 0;
      case 'hand': {
        const n = (c.side === 'self' ? p : opp).hand.length;
        if (c.max !== undefined) return n <= c.max ? 1 : 0;
        return n === c.exactly ? 1 : 0;
      }
      case 'sameType': {
        const theirs = new Set<string>();
        for (const x of inPlay(opp)) for (const ch of x.c.types) theirs.add(ch);
        for (const x of inPlay(p)) for (const ch of x.c.types) if (theirs.has(ch)) return 1;
        return 0;
      }
      case 'sameEnergy':
        return opp.active && opp.active.energy.length === m.energy.length ? 1 : 0;
      case 'benchDamaged':
        return p.bench.some((x) => x.dmg > 0) ? 1 : 0;
      case 'paid':
        return roll ? (p.attackPaid ? 1 : 0) : 0.5;
      case 'allInPlay': {
        const xs = [...inPlay(p)];
        return xs.length && xs.every((x) => pokeMatches(x.c, c.t)) ? 1 : 0;
      }
      case 'firstTurnSecond':
        return p.turn === 1 && !p.first ? 1 : 0;
      case 'lastCardInHand':
        return p.hand.length === 1 ? 1 : 0;
    }
  };
  return { count, holds };
}

/** The attack step. Returns the damage done (base damage when there is no opponent). */
export function attack(g: Game, p: Player, o: Player | null): number {
  if (p.turnEnded || !p.active) return 0;
  if (p.first && p.turn === 1 && !g.rules.firstPlayerAttacksTurn1) return 0;
  const a = p.active;
  const def = o?.active ?? null;
  let best: SimAttack | null = null;
  let bestD = 0;
  let setupAtk: SimAttack | null = null;
  for (const atk of a.c.attacks) {
    if (resting(p, a, atk) || missing(atk.cost, a.energy) !== '') continue;
    if (atk.fx?.mods.some((x) => x.k === 'firstTurnBarred') && p.turn === 1 && !p.first) continue;
    // Never leave the table empty: an attack that returns its user to the hand needs a Benched Pokémon behind it.
    if (atk.fx?.effects.some((x) => x.k === 'selfToHand') && !p.bench.length) continue;
    if (atk.damage > 0) {
      // Chosen on its expectation (coins at their mean), then rolled.
      const d = damageAgainst(a, def, expectedDamage(atk.damage, atk.fx?.mods ?? [], gameView(g, p, o, a, atk, false)), atk.fx?.mods);
      if (d > bestD) {
        bestD = d;
        best = atk;
      }
    } else if (!setupAtk && atk.fx && atk.fx.effects.length && useful(g, p, o, atk.fx, a)) setupAtk = atk;
  }
  const kos = !!def && bestD >= def.c.hp - def.dmg;
  const use = best && (bestD >= 50 || kos || !setupAtk) ? best : setupAtk;
  if (!use) return 0;
  g.trace?.(`attack ${use.name}`);
  p.attackDiscarded = 0;
  p.attackPaid = false;
  if (use.fx?.effects.length) runEffects(g, p, o, use.fx, a, 'pre');
  if (use.rest) {
    a.restTurn = p.turn + 1;
    a.restAtk = use.rest === 1 ? '' : use.name;
  }
  let d = 0;
  if (use.damage > 0) {
    d = damageAgainst(a, def, use.fx?.mods.length ? expectedDamage(use.damage, use.fx.mods, gameView(g, p, o, a, use, true)) : use.damage, use.fx?.mods);
    if (p.turn <= p.damage.length) p.damage[p.turn - 1] += d;
    if (!p.firstOnline && p.d.plan && a.c.key === p.d.plan.attacker) p.firstOnline = p.turn;
    if (o && def) {
      def.dmg += d;
      if (def.dmg >= def.c.hp) knockOut(g, p, o);
    }
  }
  if (use.fx?.effects.length && !g.winner) runEffects(g, p, o, use.fx, a, 'post');
  return d;
}

export function knockOut(g: Game, p: Player, o: Player): void {
  const m = o.active!;
  o.discard.push(m.c.i, ...m.under);
  for (const e of m.energy) o.discard.push(e.i);
  o.active = null;
  o.koBefore = o.turn + 1;
  o.koName = m.c.name;
  takePrizes(g, p, o, m.c.prize);
  if (g.winner) return;
  promote(o, p);
}

/** After a knockout: the ready main attacker, else the hardest hitter, else the main line, else the most HP left, a multi-Prize Pokémon counting 100 HP less per extra Prize. */
function promote(o: Player, p: Player | null): void {
  let at = 0;
  let best = -Infinity;
  for (let j = 0; j < o.bench.length; j++) {
    const m = o.bench[j];
    const atk = bestPayable(m);
    const s = mainReady(o, m)
      ? 10000
      : atk
        ? 5000 + damageAgainst(m, p?.active ?? null, atk.expected, atk.fx?.mods)
        : (o.d.plan?.line.includes(m.c.key) ? 3000 : 0) + m.c.hp - m.dmg - 100 * (m.c.prize - 1);
    if (s > best) {
      best = s;
      at = j;
    }
  }
  o.active = o.bench[at];
  o.bench.splice(at, 1);
}

/** Whether every copy of a card the plan needs sits in the Prize cards. */
export function keyPieceStuck(p: Player): boolean {
  const plan = p.d.plan;
  if (!plan) return false;
  const total = new Map<string, number>();
  const prized = new Map<string, number>();
  let candy = 0;
  let candyPrized = 0;
  for (const i of p.d.list) {
    const c = cardOf(p, i);
    total.set(c.key, (total.get(c.key) ?? 0) + 1);
    if (isCandy(c)) candy++;
  }
  for (const i of p.prizes) {
    const c = cardOf(p, i);
    prized.set(c.key, (prized.get(c.key) ?? 0) + 1);
    if (isCandy(c)) candyPrized++;
  }
  const allPrized = (k: string) => (total.get(k) ?? 0) > 0 && prized.get(k) === total.get(k);
  if (allPrized(plan.attacker) || allPrized(plan.root)) return true;
  // A Stage 2 attacker needs its Stage 1 unless Rare Candy is left.
  if (plan.line.length === 3 && allPrized(plan.line[1]) && candy === candyPrized) return true;
  return false;
}
