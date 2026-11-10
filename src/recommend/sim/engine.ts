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
  taken: number;
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
  };
}

const cardOf = (p: Player, i: number) => p.d.cards[i];

/** Draw effects are passed up when they would leave fewer cards than this in the deck. */
const DECK_RESERVE = 6;

function draw(p: Player, n: number): number {
  let k = 0;
  for (; k < n && p.deck.length; k++) {
    const i = p.deck.pop()!;
    p.hand.push(i);
    if (p.d.cards[i].unread) p.unreadDraws++;
  }
  return k;
}

function newMon(c: SimCard, turn: number): Mon {
  return { c, under: [], energy: [], dmg: 0, entered: turn, abilityTurn: -1, restTurn: 0, restAtk: '' };
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
  for (const a of m.c.attacks) if (a.damage > 0 && (!best || a.damage > best.damage)) best = a;
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
  for (const a of m.c.attacks) if (a.damage > 0 && missing(a.cost, m.energy) === '' && (!best || a.damage > best.damage)) best = a;
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

function matches(c: SimCard, f: CardFilter): boolean {
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
function bestInDeck(p: Player, f: CardFilter, to: 'hand' | 'bench' | 'attach', targets: Mon[] | null, minWant: number, shallow = false, top = 0): number {
  let best = -1;
  let bestW = minWant;
  // The top of the deck is the end of the array.
  for (let j = top > 0 ? Math.max(0, p.deck.length - top) : 0; j < p.deck.length; j++) {
    const c = cardOf(p, p.deck[j]);
    if (!matches(c, f)) continue;
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

function search(g: Game, p: Player, e: Extract<Effect, { k: 'search' }>, self: Mon | null): number {
  let got = 0;
  for (let k = 0; k < e.n; k++) {
    if (e.to === 'bench' && p.bench.length >= g.rules.benchSize) break;
    const targets = e.to === 'attach' ? attachTargets(p, e.target ?? { where: 'any' }, self) : null;
    if (e.top && e.top - got <= 0) break;
    const j = bestInDeck(p, e.f, e.to, targets, e.to === 'bench' ? 2 : 1, false, e.top ? e.top - got : 0);
    if (j < 0) break;
    const i = p.deck[j];
    p.deck.splice(j, 1);
    const c = cardOf(p, i);
    if (e.to === 'hand') p.hand.push(i);
    else if (e.to === 'bench') p.bench.push(newMon(c, p.turn));
    else energyTarget(p, c, targets!)!.energy.push(c);
    got++;
  }
  shuffleInPlace(p.deck, p.rng);
  return got;
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

function recover(p: Player, e: Extract<Effect, { k: 'recover' }>): number {
  let got = 0;
  for (let k = 0; k < e.n; k++) {
    const j = p.discard.findIndex((i) => matches(cardOf(p, i), e.f));
    if (j < 0) break;
    p.hand.push(p.discard[j]);
    p.discard.splice(j, 1);
    got++;
  }
  return got;
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
    const d = atk ? damageAgainst(m, o?.active ?? null, atk.damage) : 0;
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

function runEffects(g: Game, p: Player, o: Player | null, fx: ParsedText, self: Mon | null): void {
  if (fx.chance < 1 && p.rng.next() >= fx.chance) return;
  for (const e of fx.effects) {
    switch (e.k) {
      case 'draw':
        draw(p, e.n);
        break;
      case 'drawUntil':
        draw(p, e.n - p.hand.length);
        break;
      case 'discardHandDraw':
        p.discard.push(...p.hand);
        p.hand.length = 0;
        draw(p, e.n);
        break;
      case 'shuffleHandDraw':
        shuffleHandDraw(p, e.n, e.bottom);
        break;
      case 'search':
        search(g, p, e, self);
        break;
      case 'attach':
        attachFrom(p, e, self);
        break;
      case 'recover':
        recover(p, e);
        break;
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
    }
  }
}

/** Would the effect do the plan any good now? */
function useful(g: Game, p: Player, o: Player | null, fx: ParsedText, self: Mon | null): boolean {
  for (const e of fx.effects) {
    switch (e.k) {
      case 'draw':
        if (p.deck.length - e.n >= DECK_RESERVE) return true;
        break;
      case 'drawUntil':
        if (p.hand.length < e.n - 1 && p.deck.length - (e.n - p.hand.length) >= DECK_RESERVE) return true;
        break;
      case 'discardHandDraw':
      case 'shuffleHandDraw':
        if (drawValue(p, e) > 1) return true;
        break;
      case 'search': {
        if (e.to === 'bench' && p.bench.length >= g.rules.benchSize) break;
        const targets = e.to === 'attach' ? attachTargets(p, e.target ?? { where: 'any' }, self) : null;
        if (bestInDeck(p, e.f, e.to, targets, e.to === 'bench' ? 10 : 25) >= 0) return true;
        break;
      }
      case 'attach': {
        const src = e.from === 'hand' ? p.hand : p.discard;
        const targets = attachTargets(p, e.target, self);
        for (const i of src) if (matches(cardOf(p, i), e.f) && energyTarget(p, cardOf(p, i), targets)) return true;
        break;
      }
      case 'recover':
        if ((energyNeed(p) || retreatBlocked(p)) && p.discard.some((i) => matches(cardOf(p, i), e.f))) return true;
        break;
      case 'stack':
        if (p.deck.length > DECK_RESERVE && bestInDeck(p, { k: 'any' }, 'hand', null, 40) >= 0) return true;
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
  if (p.deck.length - drawn < DECK_RESERVE) return -1;
  let keep = 0;
  for (const i of p.hand) if (want(p, cardOf(p, i), true) >= 40) keep++;
  const bonus = stuck(p) ? 4 : 0;
  if (e.k === 'discardHandDraw') return Math.min(e.n, p.deck.length) - keep * 1.2 + bonus;
  if (e.k === 'shuffleHandDraw') return (e.n < 0 ? p.prizes.length : e.n) - p.hand.length * 0.5 - keep * 0.7 + bonus;
  if (e.k === 'draw') return Math.min(e.n, p.deck.length);
  if (e.k === 'drawUntil') return Math.max(0, e.n - p.hand.length);
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

function abilityUsable(p: Player, m: Mon, ab: ParsedAbility): boolean {
  if (!ab.fx.effects.length) return false;
  if (ab.trigger !== 'turn' && ab.trigger !== 'repeat') return false;
  if (ab.activeOnly && p.active !== m) return false;
  if (ab.trigger === 'turn' && m.abilityTurn === p.turn) return false;
  if (ab.limitName && p.limitNames.includes(ab.limitName)) return false;
  if (ab.vstar && p.vstarUsed) return false;
  return true;
}

function useAbility(g: Game, p: Player, o: Player | null, endsTurn: boolean): boolean {
  for (const m of inPlay(p)) {
    for (const ab of m.c.abilities) {
      if (ab.fx.endsTurn !== endsTurn || !abilityUsable(p, m, ab) || !useful(g, p, o, ab.fx, m)) continue;
      m.abilityTurn = p.turn;
      if (ab.limitName) p.limitNames.push(ab.limitName);
      if (ab.vstar) p.vstarUsed = true;
      p.acted++;
      g.trace?.(`ability ${ab.name}`);
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
    if (c.kind !== 'trainer' || !c.fx || c.unread) continue;
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
  g.trace?.(`item ${c.name}`);
  runEffects(g, p, o, c.fx!, null);
  return true;
}

function playStadium(g: Game, p: Player, o: Player | null): boolean {
  if (p.stadiumDone) return false;
  for (let j = 0; j < p.hand.length; j++) {
    const c = cardOf(p, p.hand[j]);
    if (c.tt !== 'Stadium' || c.unread || !c.fx) continue;
    if (g.stadium && g.stadium.c.key === c.key) continue;
    if (!useful(g, p, o, c.fx, null) && !(g.stadium && g.stadium.owner !== p)) continue;
    removeFromHand(p, j);
    if (g.stadium) g.stadium.owner.discard.push(g.stadium.c.i);
    g.stadium = { c, owner: p };
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
  if (!useful(g, p, o, s.c.fx, null)) return false;
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
  if (p.first && p.turn === 1 && !g.rules.firstPlayerSupporterTurn1) return false;
  let at = -1;
  let best = 0.75;
  for (let j = 0; j < p.hand.length; j++) {
    const c = cardOf(p, p.hand[j]);
    if (c.tt !== 'Supporter' || c.unread || !c.fx) continue;
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
  for (const i of p.hand) if (cardOf(p, i).unread) p.unreadDraws++;
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

/** Damage after Weakness and Resistance of the defending Pokémon (none in a solo game). */
export function damageAgainst(att: Mon, def: Mon | null, base: number): number {
  if (!def || base <= 0) return base;
  let d = base;
  for (const w of def.c.weak) if (w.t && att.c.types.includes(w.t)) d = d * w.mul + w.add;
  for (const r of def.c.resist) if (r.t && att.c.types.includes(r.t)) d -= r.amt;
  return Math.max(0, d);
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
    if (atk.damage > 0) {
      const d = damageAgainst(a, def, atk.damage);
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
  if (use.fx?.effects.length) runEffects(g, p, o, use.fx, a);
  if (use.rest) {
    a.restTurn = p.turn + 1;
    a.restAtk = use.rest === 1 ? '' : use.name;
  }
  if (use.damage <= 0) return 0;
  const d = def ? bestD : use.damage;
  if (p.turn <= p.damage.length) p.damage[p.turn - 1] += d;
  if (!p.firstOnline && p.d.plan && a.c.key === p.d.plan.attacker) p.firstOnline = p.turn;
  if (o && def) {
    def.dmg += d;
    if (def.dmg >= def.c.hp) knockOut(g, p, o);
  }
  return d;
}

function knockOut(g: Game, p: Player, o: Player): void {
  const m = o.active!;
  o.discard.push(m.c.i, ...m.under);
  for (const e of m.energy) o.discard.push(e.i);
  o.active = null;
  const n = Math.min(m.c.prize, p.prizes.length);
  for (let k = 0; k < n; k++) p.hand.push(p.prizes.pop()!);
  p.taken += n;
  if (!p.prizes.length) {
    g.winner = p;
    g.ending = 'prizes';
    return;
  }
  if (!o.bench.length) {
    if (g.rules.noPokemonLoses) {
      g.winner = p;
      g.ending = 'no Pokémon';
    }
    return;
  }
  promote(o, p);
}

/** After a knockout: the ready main attacker, else the hardest hitter, else the main line, else the most HP left, a multi-Prize Pokémon counting 100 HP less per extra Prize. */
function promote(o: Player, p: Player): void {
  let at = 0;
  let best = -Infinity;
  for (let j = 0; j < o.bench.length; j++) {
    const m = o.bench[j];
    const atk = bestPayable(m);
    const s = mainReady(o, m)
      ? 10000
      : atk
        ? 5000 + damageAgainst(m, p.active, atk.damage)
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
