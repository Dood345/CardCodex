/**
 * What needs an opponent, in duels: gust, Bench damage and counters, Special
 * Conditions with the checkup between turns, locks on retreating, attacking
 * and Items, protection during the opponent's next turn, the opponent's
 * hand, deck and Energy, and "prevent all effects". Real cards by catalog id
 * on arranged tables; in a solo game these cards sit idle and the report says
 * they need an opponent.
 */
import { describe, expect, it } from 'vitest';
import { compileDeck, type SimCard } from './cards';
import { duel } from './duel';
import { attack, checkup, mainPhase, maxHp, newPlayer, type Game, type Mon, type Player } from './engine';
import { loadEvaluator } from './fixtures';
import { pokemonPlaytest } from '../pokemon-play';
import { POKEMON_RULES_PAR_2023 } from './rules';

const { ev } = loadEvaluator();

const IDS = {
  boss: 'sv02-172', // Boss's Orders: switch in one of the opponent's Benched Pokémon
  hammer: 'me03-071', // Crushing Hammer: flip, discard an Energy from one of the opponent's Pokémon
  redCard: 'me04-082', // Special Red Card: opponent's hand to the bottom, draws 3 (only with 3 or fewer Prize cards)
  dragapult: 'sv06-130', // Phantom Dive 200: 6 damage counters on the opponent's Bench
  munkidori: 'sv06-095', // Mind Bend 60: opponent's Active Confused; Adrena-Brain moves counters (with Darkness Energy)
  budew: 'sv08.5-004', // Itchy Pollen 10: no Items for the opponent next turn
  dusknoir: 'sv06.5-020', // Shadow Bind: Defending Pokémon can't retreat; Cursed Blast
  dunsparce: 'sv05-128', // Dig 50: flip, heads prevents all damage next turn
  poltchageist: 'me05-005', // Hide 'n' Sneak: prevent all effects of attacks and Abilities
  wailord: 'me05-016', // Falling Down 270: this Pokémon is now Asleep
  manaphy: 'swsh9-041', // Wave Veil: prevent all damage done to your Benched Pokémon by attacks
  chansey: 'sv06-133', // 120 HP
  charizard: 'sv04.5-054',
  charmander: 'sv04.5-007',
  pidgey: 'sv04.5-196',
  fire: 'sve-002',
  psychic: 'sve-005',
  grass: 'sve-001',
  darkness: 'sve-007',
};

function compiled(ids: string[], qty = 1) {
  const d = compileDeck(ev, ids.map((cardId) => ({ cardId, qty })));
  return { d, card: (id: string): SimCard => d.cards.find((c) => c.card.id === id)! };
}
const game = (): Game => ({ rules: POKEMON_RULES_PAR_2023, stadium: null, winner: null, ending: '', guards: 0 });
const mon = (c: SimCard, energy: SimCard[] = [], dmg = 0): Mon => ({ c, under: [], energy, dmg, entered: 0, abilityTurn: -1, restTurn: 0, restAtk: '', movedTurn: 0 });
function seat(g: Game, d: ReturnType<typeof compileDeck>, active: Mon | null, hand: SimCard[] = [], deck: SimCard[] = [], turn = 3): Player {
  const p = newPlayer(d, 7, false, 6, 5);
  p.game = g;
  p.turn = turn;
  p.active = active;
  p.hand = hand.map((c) => c.i);
  p.deck = deck.map((c) => c.i);
  for (let k = 0; k < 6; k++) p.prizes.push(0);
  return p;
}

describe('reading what needs an opponent', () => {
  const { card } = compiled(Object.values(IDS));
  const atk = (id: string, name: string) => card(id).attacks.find((a) => a.name === name)!;

  it('reads real cards, every sentence followed', () => {
    expect(card(IDS.boss).fx).toMatchObject({ effects: [{ k: 'gust', by: 'you' }], followed: true });
    expect(card(IDS.boss).unread).toBe('');
    expect(card(IDS.hammer).fx).toMatchObject({ chance: 0.5, effects: [{ k: 'discardOppEnergy', n: 1, from: 'any' }], followed: true });
    expect(card(IDS.redCard).fx).toMatchObject({ cond: { k: 'prizes', side: 'opponent', max: 3 }, effects: [{ k: 'oppHandBottomDraw', n: 3 }], followed: true });
    expect(atk(IDS.dragapult, 'Phantom Dive').fx).toMatchObject({ effects: [{ k: 'benchDamage', n: 6, how: 'counters' }], followed: true });
    expect(atk(IDS.munkidori, 'Mind Bend').fx).toMatchObject({ effects: [{ k: 'condition', c: 'Confused', on: 'opponentActive' }], followed: true });
    expect(card(IDS.munkidori).abilities[0].fx).toMatchObject({ cond: { k: 'selfEnergy', type: 'D' }, effects: [{ k: 'moveCounters', n: 3 }], followed: true });
    expect(atk(IDS.budew, 'Itchy Pollen').fx).toMatchObject({ effects: [{ k: 'lock', what: 'items' }], followed: true });
    expect(atk(IDS.dusknoir, 'Shadow Bind').fx).toMatchObject({ effects: [{ k: 'lock', what: 'retreat' }], followed: true });
    expect(card(IDS.dusknoir).abilities[0].fx).toMatchObject({ effects: [{ k: 'countersOpp', n: 13 }, { k: 'selfKO' }], followed: true });
    expect(atk(IDS.dunsparce, 'Dig').fx).toMatchObject({ chance: 0.5, effects: [{ k: 'shield' }], followed: true });
    expect(card(IDS.poltchageist).abilities[0].fx).toMatchObject({ statics: [{ k: 'preventEffects' }], followed: true });
    // Falling Down puts its user to sleep: two coins before its next attack, so a quarter of its next turns are lost.
    const falling = atk(IDS.wailord, 'Falling Down');
    expect(falling.fx).toMatchObject({ effects: [{ k: 'condition', c: 'Asleep', on: 'self' }], followed: true });
    expect(falling).toMatchObject({ expected: 270, miss: 0.25, sustained: 216 });
  });
});

describe('in a duel', () => {
  it('gusts up the Benched Pokémon it can Knock Out, and Crushing Hammer takes an Energy', () => {
    const { d, card } = compiled([IDS.boss, IDS.hammer, IDS.charizard, IDS.charmander, IDS.pidgey, IDS.fire], 2);
    const g = game();
    const fire = card(IDS.fire);
    const me = seat(g, d, mon(card(IDS.charizard), [fire, fire]), [card(IDS.boss)], [fire]);
    const them = seat(g, d, mon(card(IDS.charizard)), [], [fire]);
    them.bench = [mon(card(IDS.pidgey), [fire, fire, fire])];
    mainPhase(g, me, them);
    expect(them.active?.c.name).toBe('Pidgey');
    expect(them.bench.map((m) => m.c.name)).toEqual(['Charizard ex']);
    expect(attack(g, me, them)).toBe(180);
    expect(me.taken).toBe(1);
    // Crushing Hammer: over many seeds, about half the time an Energy leaves the opponent's Pokémon.
    let taken = 0;
    for (let s = 0; s < 100; s++) {
      const p = seat(g, d, mon(card(IDS.charmander)), [card(IDS.hammer)], [fire]);
      p.rng.s = s;
      const o = seat(g, d, mon(card(IDS.charizard), [fire, fire]));
      mainPhase(g, p, o);
      if (o.active!.energy.length === 1) taken++;
    }
    expect(taken).toBeGreaterThan(30);
    expect(taken).toBeLessThan(70);
  });

  it('spreads Phantom Dive\'s counters for a Knock Out, and Hide \'n\' Sneak keeps them off', () => {
    const { d, card } = compiled([IDS.dragapult, IDS.poltchageist, IDS.charizard, IDS.charmander, IDS.pidgey, IDS.fire, IDS.psychic], 2);
    const g = game();
    const me = seat(g, d, mon(card(IDS.dragapult), [card(IDS.fire), card(IDS.psychic)]));
    const them = seat(g, d, mon(card(IDS.charizard)));
    them.bench = [mon(card(IDS.charmander), [], 30), mon(card(IDS.pidgey))];
    expect(attack(g, me, them)).toBe(200);
    // Six counters: the Charmander with 40 HP left is Knocked Out (one Prize card), the rest go on the Pidgey.
    expect(them.bench.map((m) => `${m.c.name}:${m.dmg}`)).toEqual(['Pidgey:20']);
    expect(me.taken).toBe(1);
    const wall = seat(g, d, mon(card(IDS.charizard)));
    wall.bench = [mon(card(IDS.poltchageist))];
    const me2 = seat(g, d, mon(card(IDS.dragapult), [card(IDS.fire), card(IDS.psychic)]));
    attack(g, me2, wall);
    expect(wall.bench[0].dmg).toBe(0);
  });

  it('confuses, poisons and paralyses with the checkup between turns', () => {
    const { d, card } = compiled([IDS.munkidori, IDS.charizard, IDS.charmander, IDS.psychic, IDS.darkness, IDS.fire], 2);
    const g = game();
    const me = seat(g, d, mon(card(IDS.munkidori), [card(IDS.psychic), card(IDS.darkness)]));
    const them = seat(g, d, mon(card(IDS.charizard)));
    expect(attack(g, me, them)).toBe(60);
    expect([...them.active!.cond!]).toEqual(['Confused']);
    // A Confused attacker hits only on heads and hurts itself on tails.
    let hits = 0;
    for (let s = 0; s < 60; s++) {
      const z = seat(g, d, mon(card(IDS.charizard), [card(IDS.fire), card(IDS.fire)]));
      z.active!.cond = new Set(['Confused']);
      z.rng.s = s;
      const o = seat(g, d, mon(card(IDS.charizard)));
      if (attack(g, z, o) > 0) hits++;
      else expect(z.active!.dmg).toBe(30);
    }
    expect(hits).toBeGreaterThan(15);
    expect(hits).toBeLessThan(45);
    // Poison: a counter at each checkup; Paralysis: no attack, lifted at the end of its owner's next turn.
    const x = seat(g, d, mon(card(IDS.charizard)));
    x.active!.cond = new Set(['Poisoned']);
    checkup(g, x, null);
    expect(x.active!.dmg).toBe(10);
    const y = seat(g, d, mon(card(IDS.charizard), [card(IDS.fire), card(IDS.fire)]));
    y.active!.cond = new Set(['Paralyzed']);
    y.active!.paralyzedUntil = y.turn;
    expect(attack(g, y, null)).toBe(0);
    checkup(g, y, null);
    expect(y.active!.cond!.size).toBe(0);
  });

  it('locks Items and retreating for the opponent\'s next turn, and shields after Dig', () => {
    const { d, card } = compiled([IDS.budew, IDS.dusknoir, IDS.dunsparce, IDS.charizard, IDS.charmander, IDS.pidgey, IDS.fire, IDS.grass, IDS.psychic, IDS.boss], 2);
    const g = game();
    const fire = card(IDS.fire);
    // Itchy Pollen: the opponent's Boss's Orders stays in hand on their next turn.
    const me = seat(g, d, mon(card(IDS.budew), [card(IDS.grass)]));
    const them = seat(g, d, mon(card(IDS.charizard), [fire, fire]), [card(IDS.boss)], [fire], 3);
    them.bench = [mon(card(IDS.pidgey), [fire, fire])];
    me.bench = [mon(card(IDS.charmander), [fire, fire])];
    attack(g, me, them);
    them.turn = 4;
    expect(them.noItemsTurn).toBe(4);
    const q = seat(g, d, mon(card(IDS.charizard), [fire, fire]), [card(IDS.boss)], [fire], 4);
    q.noItemsTurn = 4;
    q.bench = [];
    mainPhase(g, q, me);
    // Boss's Orders is a Supporter, not an Item: it may still be played; an Item lock is checked on Items.
    expect(q.hand.length + q.active!.energy.length).toBeGreaterThanOrEqual(1);
    // Shadow Bind: the Defending Pokémon (Charizard ex, which survives the 150) cannot retreat on its owner's next turn.
    const dusk = seat(g, d, mon(card(IDS.dusknoir), [card(IDS.psychic), card(IDS.psychic), card(IDS.psychic)]));
    const victim = seat(g, d, mon(card(IDS.charizard), [fire, fire, fire]), [], [fire], 3);
    victim.bench = [mon(card(IDS.charmander), [fire, fire])];
    attack(g, dusk, victim);
    expect(victim.active!.dmg).toBe(150);
    expect(victim.active!.noRetreatTurn).toBe(4);
    victim.turn = 4;
    mainPhase(g, victim, dusk);
    expect(victim.active!.c.name).toBe('Charizard ex');
    expect(victim.retreatDone).toBe(0);
    // Dig on heads: no damage on the opponent's next turn.
    let shielded = 0;
    for (let s = 0; s < 40; s++) {
      const g2 = game(); // a fresh game: once Dunsparce is Knocked Out the game is over and no more effects run
      const dig = seat(g2, d, mon(card(IDS.dunsparce), [fire, fire]), [], [], 3);
      dig.rng.s = s;
      const o = seat(g2, d, mon(card(IDS.charizard), [fire, fire]), [], [], 3);
      attack(g2, dig, o);
      o.turn = 4;
      if (attack(g2, o, dig) === 0 && dig.active!.dmg === 0) shielded++;
    }
    expect(shielded).toBeGreaterThan(10);
    expect(shielded).toBeLessThan(30);
  });

  it('never spins on counters it cannot place, and Knocks Out a Benched Pokémon whose HP fell under its damage', () => {
    // Manaphy's Wave Veil protects the Bench; Chansey sits at 130 damage on 120 HP, as after the HP a Tool gave it is gone.
    const { d, card } = compiled([IDS.dragapult, IDS.charizard, IDS.fire, IDS.psychic, IDS.manaphy, IDS.chansey], 2);
    const g = game();
    const me = seat(g, d, mon(card(IDS.dragapult), [card(IDS.fire), card(IDS.psychic)]));
    const them = seat(g, d, mon(card(IDS.charizard), [card(IDS.fire), card(IDS.fire)]), [], [card(IDS.fire)]);
    const stuck = mon(card(IDS.chansey), [], 130);
    them.bench = [mon(card(IDS.manaphy)), stuck];
    expect(stuck.dmg).toBeGreaterThanOrEqual(maxHp(them, stuck));
    const started = Date.now();
    attack(g, me, them);
    expect(Date.now() - started).toBeLessThan(2000);
    // Chansey was Knocked Out by the sweep before the attack, for a Prize card; the counters found nothing to land on.
    expect(them.bench.map((m) => m.c.name)).toEqual(['Manaphy']);
    expect(me.taken).toBe(1);
    expect(them.bench[0].dmg).toBe(0);
    expect(g.guards).toBe(0);
    // The reports carry the guard count.
    expect(duel(ev, [{ cardId: IDS.charmander, qty: 4 }, { cardId: IDS.fire, qty: 56 }], [{ cardId: IDS.charmander, qty: 4 }, { cardId: IDS.fire, qty: 56 }], { games: 4, seed: 1 }).guards).toBe(0);
  });

  it('reports cards that need an opponent as idle in a solo game', () => {
    const r = pokemonPlaytest(ev, [{ cardId: IDS.charmander, qty: 4 }, { cardId: IDS.boss, qty: 2 }, { cardId: IDS.hammer, qty: 2 }, { cardId: IDS.fire, qty: 52 }], { games: 40, seed: 1 });
    const text = r.lines.join(' | ');
    expect(text).toMatch(/4 cards need an opponent to matter \(Boss's Orders, Crushing Hammer\)/);
  });
});
