/**
 * Attack damage that is not the printed number: what the parser reads from
 * real cards (by catalog id, asserting on the shipped text), what the shared
 * expected figure says on the typical board, and what lands in an arranged
 * game, solo (the opponent a mirror) and head-to-head.
 */
import { describe, expect, it } from 'vitest';
import { compileDeck, type SimCard } from './cards';
import { expectedDamage, staticView } from './damage';
import { parseCond, parseCount, parsePokeTest } from './damage-text';
import { attack, gameView, knockOut, newPlayer, type Game, type Mon, type Player } from './engine';
import { parseText } from './effects';
import { loadEvaluator } from './fixtures';
import { POKEMON_RULES_PAR_2023 } from './rules';

const { ev, index } = loadEvaluator();

const IDS = {
  kangaskhan: 'me01-104', // Mega Kangaskhan ex: Rapid-Fire Combo 200+, flip until tails, 50 more per heads
  combusken: 'sv10-041', // Double Kick 40×, flip 2 coins, 40 for each heads
  clefairy: 'sv09-056', // Lillie's Clefairy ex: Full Moon Rondo 20+, 20 more per Benched Pokémon (both)
  moltres: 'me02-014', // Fighting Wings 20+, 90 more if the opponent's Active is a Pokémon ex
  solrock: 'me01-075', // Cosmic Beam 70, nothing without Lunatone on the Bench; ignores Weakness and Resistance
  terapagos: 'sv07-128', // Unified Beatdown 30×, per own Benched Pokémon; not on the first turn going second
  excadrill: 'me05-065', // Mega Excadrill ex: Maximum Drilling 200+, 130 more with 2 extra Energy
  reshiram: 'sv09-116', // N's Reshiram: Powerful Rage 20×, per damage counter on itself
  pecharunt: 'sv06.5-039', // Irritated Outburst 60×, per Prize card the opponent has taken
  mankey: 'sv10-090', // Wild Kick 30, flip a coin, if tails nothing
  bundle: 'sv08-055', // Iron Bundle: Gusting Collision 200-, 50 less per Colorless in the opponent's Active's Retreat Cost
  charizard: 'sv04.5-054', // Charizard ex (a Pokémon ex, Burning Darkness 180+ per Prize card the opponent has taken)
  charmander: 'sv04.5-007',
  fire: 'sve-002',
  lightning: 'sve-004',
  psychic: 'sve-005',
  fighting: 'sve-006',
  darkness: 'sve-007',
  metal: 'sve-008',
  magcargo: 'sv06-029', // Magcargo ex: Ground Burn 140+, the top card of each deck discarded, 140 more per Energy card among them
  gouging: 'sv05-038', // Gouging Fire ex: Blaze Blitz 260, not again until it leaves the Active Spot; Heat Blast 60
  ultraBall: 'sv04.5-091',
};

function compiled(ids: string[]) {
  const d = compileDeck(ev, ids.map((cardId) => ({ cardId, qty: 1 })));
  return { d, card: (id: string): SimCard => d.cards.find((c) => c.card.id === id)! };
}

const game = (): Game => ({ rules: POKEMON_RULES_PAR_2023, stadium: null, winner: null, ending: '', guards: 0 });
const mon = (c: SimCard, energy: SimCard[] = [], dmg = 0): Mon => ({ c, under: [], energy, dmg, entered: 0, abilityTurn: -1, restTurn: 0, restAtk: '', movedTurn: 0 });

/** A player on turn 3 with `active` up and `bench` behind it; energy is Fire. */
function seat(d: ReturnType<typeof compileDeck>, active: Mon, bench: Mon[] = [], first = false): Player {
  const p = newPlayer(d, 7, first, 6, 5);
  p.turn = 3;
  p.active = active;
  p.bench = bench;
  for (let k = 0; k < 6; k++) p.prizes.push(0);
  return p;
}

describe('reading damage text', () => {
  it('reads the scaling, bonus, nothing-unless and ignore wordings of real cards', () => {
    const { card } = compiled(Object.values(IDS));
    const atk = (id: string, name: string) => card(id).attacks.find((a) => a.name === name)!;
    expect(atk(IDS.kangaskhan, 'Rapid-Fire Combo').fx?.mods).toEqual([{ k: 'plus', n: 50, per: { k: 'heads', flips: 'untilTails' } }]);
    expect(atk(IDS.combusken, 'Double Kick').fx?.mods).toEqual([{ k: 'times', n: 40, per: { k: 'heads', flips: 2 } }]);
    expect(atk(IDS.clefairy, 'Full Moon Rondo').fx?.mods).toEqual([{ k: 'plus', n: 20, per: { k: 'bench', side: 'both' } }]);
    expect(atk(IDS.moltres, 'Fighting Wings').fx?.mods).toEqual([{ k: 'bonus', n: 90, if: { k: 'opponentActive', t: { suffix: 'ex' } } }]);
    expect(atk(IDS.solrock, 'Cosmic Beam').fx?.mods).toEqual([
      { k: 'nothing', unless: { k: 'inPlay', side: 'self', t: { names: ['lunatone'] }, min: 1, bench: true } },
      { k: 'ignore', weakness: true, resistance: true },
    ]);
    expect(atk(IDS.terapagos, 'Unified Beatdown').fx?.mods).toEqual([{ k: 'firstTurnBarred' }, { k: 'times', n: 30, per: { k: 'bench', side: 'self' } }]);
    expect(atk(IDS.excadrill, 'Maximum Drilling').fx?.mods).toEqual([{ k: 'bonus', n: 130, if: { k: 'selfEnergy', extra: 2 } }]);
    expect(atk(IDS.reshiram, 'Powerful Rage').fx?.mods).toEqual([{ k: 'times', n: 20, per: { k: 'counters', on: 'self' } }]);
    expect(atk(IDS.pecharunt, 'Irritated Outburst').fx?.mods).toEqual([{ k: 'times', n: 60, per: { k: 'prizesTaken', side: 'opponent' } }]);
    expect(atk(IDS.mankey, 'Wild Kick').fx?.mods).toEqual([{ k: 'nothing', unless: { k: 'coin' } }]);
    expect(atk(IDS.bundle, 'Gusting Collision').fx?.mods).toEqual([{ k: 'minus', n: 50, per: { k: 'retreatCost', on: 'opponentActive' } }]);
    // Every one of these texts is now followed in full.
    for (const [id, name] of [[IDS.kangaskhan, 'Rapid-Fire Combo'], [IDS.combusken, 'Double Kick'], [IDS.clefairy, 'Full Moon Rondo'], [IDS.moltres, 'Fighting Wings'], [IDS.solrock, 'Cosmic Beam'], [IDS.terapagos, 'Unified Beatdown'], [IDS.mankey, 'Wild Kick'], [IDS.bundle, 'Gusting Collision']]) {
      expect(atk(id, name).fx?.followed, `${id} ${name}`).toBe(true);
    }
  });

  it('reads the older wordings and the pieces: tests on Pokémon, counts, conditions', () => {
    expect(parseText('Does 10 damage plus 10 more damage for each Energy attached to the Defending Pokémon.', 'attack').mods).toEqual([{ k: 'plus', n: 10, per: { k: 'energy', on: 'opponentActive' } }]);
    expect(parseText('If the Defending Pokémon is Pokémon-ex, this attack does 30 damage plus 30 more damage.', 'attack').mods).toEqual([{ k: 'bonus', n: 30, if: { k: 'opponentActive', t: { suffix: 'ex' } } }]);
    expect(parseText('Flip a coin. If heads, this attack does 30 more damage.', 'attack')).toMatchObject({ mods: [{ k: 'bonus', n: 30, if: { k: 'coin' } }], chance: 1, followed: true });
    expect(parsePokeTest('Basic Pokémon')).toEqual({ basic: true });
    expect(parsePokeTest('Stage 2 Pokémon')).toEqual({ stage: 2 });
    expect(parsePokeTest('Fire Pokémon')).toEqual({ type: 'R' });
    expect(parsePokeTest('Beedrill and Beedrill ex')).toEqual({ names: ['beedrill', 'beedrill ex'] });
    expect(parsePokeTest("Hop's Pokémon")).toEqual({ owner: "Hop's" });
    expect(parsePokeTest('Pokémon that have the Round attack')).toEqual({ attack: 'Round' });
    expect(parseCount('Fire Energy and each Lightning Energy attached to all of your Pokémon', null)).toEqual({ k: 'energy', on: 'all', type: 'RL' });
    expect(parseCount('Supporter card that has "Team Rocket" in its name in your discard pile', null)).toEqual({ k: 'discard', side: 'self', t: { supporter: true, nameHas: 'Team Rocket' } });
    expect(parseCount('of your Pokémon in play that has the Round attack', null)).toEqual({ k: 'inPlay', side: 'self', t: { attack: 'Round' } });
    expect(parseCond('any of your Pokémon were Knocked Out by damage from an attack during your opponent\'s last turn')).toEqual({ k: 'koLastTurn', owner: undefined });
    expect(parseCond('you have 4 or more Pokémon that have the Hide \'n\' Sneak Ability in your discard pile')).toEqual({ k: 'discard', side: 'self', t: { pokemon: true, ability: "Hide 'n' Sneak" }, min: 4 });
    expect(parseCond("your opponent's Active Pokémon is Poisoned")).toBeNull();
  });

  it('leaves a sentence it cannot count unread', () => {
    const fx = parseText('This attack does 20 damage for each of your Benched Pokémon that has a maximum HP of 30.', 'attack');
    expect(fx.mods).toEqual([]);
    expect(fx.followed).toBe(false);
  });
});

describe('the shared expected figure', () => {
  it('is one number for the features, the plan and the sim', () => {
    const kanga = ev.features(index.cardsById.get(IDS.kangaskhan)!);
    // 200 + 50 per heads, flipping until tails: one head expected.
    expect(kanga.best).toMatchObject({ name: 'Rapid-Fire Combo', damage: 200, printed: '200+', expected: 250, sustained: 250 });
    const { d, card } = compiled([IDS.kangaskhan, IDS.fire]);
    expect(card(IDS.kangaskhan).attacks[0].expected).toBe(250);
    expect(d.plan?.detail).toBe("Mega Kangaskhan ex's Rapid-Fire Combo (CCC, 200+, about 250)");
    // A conditional bonus counts half on the typical board; a count narrowed to a kind counts one.
    expect(ev.features(index.cardsById.get(IDS.moltres)!).best?.expected).toBe(65);
    expect(ev.features(index.cardsById.get(IDS.clefairy)!).best?.expected).toBe(20 + 20 * 6);
    expect(ev.features(index.cardsById.get(IDS.mankey)!).attacks.find((a) => a.name === 'Wild Kick')?.expected).toBe(15);
    expect(expectedDamage(30, [{ k: 'times', n: 30, per: { k: 'bench', side: 'self' } }], staticView(2))).toBe(90);
    expect(expectedDamage(200, [{ k: 'minus', n: 50, per: { k: 'retreatCost', on: 'opponentActive' } }], staticView(3))).toBe(100);
  });

  it('shows in the score through the Power part', () => {
    const power = ev.score([{ cardId: IDS.kangaskhan, qty: 3 }, { cardId: IDS.fire, qty: 10 }]).parts.find((p) => p.id === 'power')!;
    expect(power.detail).toMatch(/^Mega Kangaskhan ex's Rapid-Fire Combo for 250 against/);
  });
});

describe('in a game', () => {
  it('flips the coins on the game stream and counts the Bench, the mirror standing in for the opponent', () => {
    const { d, card } = compiled([IDS.combusken, IDS.clefairy, IDS.charmander, IDS.fire, IDS.psychic]);
    const fire = card(IDS.fire);
    const g = game();
    // Double Kick: 0, 40 or 80 over many seeds, 40 on average.
    const seen = new Set<number>();
    let sum = 0;
    for (let s = 0; s < 200; s++) {
      const p = seat(d, mon(card(IDS.combusken), [fire, fire]));
      p.rng.s = s;
      const dmg = attack(g, p, null);
      seen.add(dmg);
      sum += dmg;
    }
    expect([...seen].sort()).toEqual([0, 40, 80]);
    expect(sum / 200).toBeGreaterThan(30);
    expect(sum / 200).toBeLessThan(50);
    // Full Moon Rondo with two Benched Pokémon: the mirror opponent has two as well, 20 + 20 × 4.
    const p = seat(d, mon(card(IDS.clefairy), [card(IDS.psychic), fire]), [mon(card(IDS.charmander)), mon(card(IDS.charmander))]);
    expect(attack(g, p, null)).toBe(100);
  });

  it('reads the Bench, its own damage and the extra Energy', () => {
    const { d, card } = compiled([IDS.solrock, IDS.reshiram, IDS.excadrill, IDS.charmander, IDS.fire, IDS.lightning, IDS.metal, IDS.fighting]);
    const fire = card(IDS.fire);
    const metal = card(IDS.metal);
    const lunatone = index.cardsByName.get('lunatone')?.find((c) => c.set === 'me01');
    expect(lunatone).toBeDefined();
    const dl = compiled([IDS.solrock, lunatone!.id, IDS.fighting]);
    const g = game();
    // Cosmic Beam does nothing without Lunatone on the Bench.
    expect(attack(g, seat(dl.d, mon(dl.card(IDS.solrock), [dl.card(IDS.fighting)])), null)).toBe(0);
    expect(attack(g, seat(dl.d, mon(dl.card(IDS.solrock), [dl.card(IDS.fighting)]), [mon(dl.card(lunatone!.id))]), null)).toBe(70);
    // Powerful Rage: 20 per damage counter on itself.
    expect(attack(g, seat(d, mon(card(IDS.reshiram), [fire, card(IDS.lightning)], 50)), null)).toBe(100);
    // Maximum Drilling: 130 more with two Energy beyond the cost.
    expect(attack(g, seat(d, mon(card(IDS.excadrill), [metal, metal, metal])), null)).toBe(200);
    expect(attack(g, seat(d, mon(card(IDS.excadrill), [metal, metal, metal, fire, fire])), null)).toBe(330);
  });

  it('keeps Unified Beatdown for the second turn of the player going second', () => {
    const { d, card } = compiled([IDS.terapagos, IDS.charmander, IDS.fire]);
    const fire = card(IDS.fire);
    const g = game();
    const p = seat(d, mon(card(IDS.terapagos), [fire, fire]), [mon(card(IDS.charmander))]);
    p.turn = 1;
    expect(attack(g, p, null)).toBe(0);
    p.turn = 2;
    expect(attack(g, p, null)).toBe(30);
  });

  it('reads the opponent in a duel: a Pokémon ex across the table, Prize cards taken, Weakness ignored', () => {
    const { d, card } = compiled([IDS.moltres, IDS.pecharunt, IDS.solrock, IDS.charizard, IDS.charmander, IDS.fire, IDS.darkness]);
    const fire = card(IDS.fire);
    const dark = card(IDS.darkness);
    const g = game();
    const me = seat(d, mon(card(IDS.moltres), [fire]));
    const them = seat(d, mon(card(IDS.charizard)));
    expect(attack(g, me, them)).toBe(110);
    const them2 = seat(d, mon(card(IDS.charmander)));
    me.active = mon(card(IDS.moltres), [fire]);
    expect(attack(g, me, them2)).toBe(20);
    // Irritated Outburst counts the Prize cards the opponent has taken: none, then two after a Knock Out.
    const pech = seat(d, mon(card(IDS.pecharunt), [dark, dark]));
    const opp = seat(d, mon(card(IDS.charmander)), [mon(card(IDS.charmander))]);
    pech.active!.dmg = 0;
    expect(gameView(g, pech, opp, pech.active!, pech.active!.c.attacks[0], false).count({ k: 'prizesTaken', side: 'opponent' })).toBe(0);
    const mine = seat(d, mon(card(IDS.charizard)));
    opp.active = mine.active;
    knockOut(g, opp, mine);
    expect(opp.taken).toBe(2);
    expect(attack(g, pech, opp)).toBe(120);
    // Cosmic Beam ignores Weakness: Charmander is weak to Water, not Fighting, so a Water attacker is the check.
    const water = index.catalog.cards.find((c) => c.cat === 'Pokemon' && c.set === 'sv04.5' && c.types?.join() === 'Water' && !c.stage?.startsWith('Stage'))!;
    const dw = compiled([IDS.solrock, water.id, IDS.charmander, IDS.fire]);
    const defender = seat(dw.d, mon(dw.card(IDS.charmander)));
    const sol = seat(dw.d, mon(dw.card(IDS.solrock), [dw.card(IDS.fire)]), [mon(dw.card(water.id))]);
    expect(sol.active?.c.attacks[0].cost).toBe('F');
    // Without Lunatone the attack does nothing whatever the Weakness; the ignore flag is tested on damageAgainst through the view.
    expect(attack(g, sol, defender)).toBe(0);
  });

  it('counts the Energy an attack mills from the top of the decks, and uses a once-per-stay attack once', () => {
    // Ground Burn on the static board: each deck gives up a card, a third of a deck is Energy (the deck's own share when known).
    const { d, card } = compiled([IDS.magcargo, IDS.gouging, IDS.charizard, IDS.charmander, IDS.fire, IDS.ultraBall]);
    const ground = card(IDS.magcargo).attacks.find((a) => a.name === 'Ground Burn')!;
    expect(ground.fx).toMatchObject({ effects: [{ k: 'millSelf', n: 1 }, { k: 'millOpp', n: 1 }], mods: [{ k: 'plus', n: 140, per: { k: 'milledEnergy', n: 1, both: true } }], followed: true });
    expect(expectedDamage(140, ground.fx!.mods, staticView(3))).toBeCloseTo(140 + 140 * (2 / 3), 6);
    // In a game the real top cards count: an Energy on each deck is two, 420.
    const fire = card(IDS.fire);
    const g = game();
    const me = seat(d, mon(card(IDS.magcargo), [fire, fire, fire]));
    me.deck = [card(IDS.ultraBall).i, fire.i];
    const them = seat(d, mon(card(IDS.charizard)));
    them.deck = [fire.i];
    expect(attack(g, me, them)).toBe(420);
    expect(me.deck.length + them.deck.length).toBe(1);
    expect(me.discard.includes(fire.i) && them.discard.includes(fire.i)).toBe(true);
    // Blaze Blitz once, then Heat Blast while the Pokémon stays in the Active Spot; the figures say so.
    const blitz = card(IDS.gouging).attacks.find((a) => a.name === 'Blaze Blitz')!;
    expect(blitz).toMatchObject({ rest: 3, expected: 260, sustained: (260 + 2 * 60) / 3 });
    expect(blitz.fx?.followed).toBe(true);
    const g2 = game();
    const gf = seat(d, mon(card(IDS.gouging), [fire, fire, fire]));
    const wall = seat(d, mon(card(IDS.charizard)));
    expect(attack(g2, gf, wall)).toBe(260);
    expect(gf.active!.restTurn).toBe(Infinity);
    gf.turn++;
    wall.active!.dmg = 0;
    expect(attack(g2, gf, wall)).toBe(60);
    gf.turn++;
    expect(attack(g2, gf, wall)).toBe(60);
  });
});
