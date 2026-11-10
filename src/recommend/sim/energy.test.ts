/**
 * Special Energy beyond the type it provides: what a card gives its holder
 * (Neo Upper Energy only on a Stage 2, Team Rocket's Energy two at a time and
 * only to Team Rocket's Pokémon), a draw on attaching (Enriching), counters
 * on the attacker (Spiky), a Prize card withheld once (Legacy), and an Energy
 * that returns after its holder's attack discards it (Boomerang). Real cards
 * by catalog id.
 */
import { describe, expect, it } from 'vitest';
import { compileDeck, type SimCard } from './cards';
import { attack, knockOut, mainPhase, missing, newPlayer, type Game, type Mon, type Player } from './engine';
import { loadEvaluator } from './fixtures';
import { POKEMON_RULES_PAR_2023 } from './rules';

const { ev } = loadEvaluator();

const IDS = {
  mist: 'sv05-161', // Mist Energy: prevent all effects (unread: nothing to prevent yet)
  neoUpper: 'sv05-162', // Neo Upper Energy: every type, 2 at a time, on a Stage 2
  boomerang: 'sv06-166',
  legacy: 'sv06-167', // every type, 1 at a time; 1 fewer Prize card, once per game
  enriching: 'sv08-191', // draw 4 when attached from the hand
  spiky: 'sv09-159', // 2 damage counters on the attacker
  rocket: 'sv10-182', // Team Rocket's Energy: only Team Rocket's Pokémon; 2 of Psychic and Darkness
  rocketMewtwo: 'svp-205', // Team Rocket's Mewtwo ex: Erasure Ball PPC 160+
  telepathic: 'me03-088', // Telepathic Psychic Energy: onto a Psychic Pokémon, two Basic Psychic to the Bench
  ignition: 'sv10.5w-086', // Ignition Energy: CCC on an Evolution Pokémon; discarded at the end of the turn
  doubleTurbo: 'swsh9-151', // Double Turbo Energy: two Colorless, attacks do 20 less
  magnetic: 'me04-085', // Magnetic Metal Energy: a Metal holder has no Retreat Cost
  charizard: 'sv04.5-054', // Stage 2, Burning Darkness RR
  charmander: 'sv04.5-007',
  cyndaquil: 'sv10-032', // Ethan's Cyndaquil: Ember R 30, discard an Energy
  dudunsparce: 'sv05-129', // Land Crush CCC 90
  fire: 'sve-002',
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

describe('reading Special Energy', () => {
  it('reads the rule, the draw and the standing effects of real cards', () => {
    const { card } = compiled([IDS.mist, IDS.neoUpper, IDS.boomerang, IDS.legacy, IDS.enriching, IDS.spiky, IDS.rocket, IDS.rocketMewtwo, IDS.charizard, IDS.charmander, IDS.telepathic, IDS.ignition, IDS.doubleTurbo, IDS.magnetic]);
    expect(card(IDS.neoUpper)).toMatchObject({ provides: 'C', energy: { amount: 1, onlyKeys: null, upgrades: [{ types: '*', amount: 2 }] } });
    expect([...card(IDS.neoUpper).energy!.upgrades[0].keys]).toEqual(['charizard ex']);
    expect(card(IDS.rocket)).toMatchObject({ provides: 'PD', energy: { amount: 2 } });
    expect([...card(IDS.rocket).energy!.onlyKeys!]).toEqual(['team rockets mewtwo ex']);
    expect(card(IDS.legacy)).toMatchObject({ provides: '*', energy: { amount: 1 } });
    expect(card(IDS.legacy).fx?.statics).toEqual([{ k: 'prizeLess', n: 1, t: undefined, scope: 'self', once: true }]);
    expect(card(IDS.enriching).fx?.effects).toEqual([{ k: 'onAttach', t: undefined, effects: [{ k: 'draw', n: 4 }] }]);
    expect(card(IDS.telepathic).fx?.effects).toMatchObject([{ k: 'onAttach', t: { type: 'P' }, effects: [{ k: 'search', n: 2, to: 'bench', f: { k: 'pokemon', basic: true, type: 'P' } }] }]);
    expect(card(IDS.ignition)).toMatchObject({ provides: 'C', energy: { amount: 1, upgrades: [{ types: 'C', amount: 3 }] } });
    expect(card(IDS.ignition).fx?.statics).toEqual([{ k: 'discardAtTurnEnd', scope: 'self' }]);
    expect(card(IDS.doubleTurbo)).toMatchObject({ provides: 'C', energy: { amount: 2 } });
    expect(card(IDS.doubleTurbo).fx?.statics).toEqual([{ k: 'damage', n: -20, scope: 'self' }]);
    expect(card(IDS.magnetic).fx?.statics).toEqual([{ k: 'retreat', delta: -99, t: { type: 'M' }, scope: 'self' }]);
    expect(card(IDS.spiky).fx?.statics).toEqual([{ k: 'hitBack', n: 2, t: undefined, scope: 'self' }]);
    expect(card(IDS.boomerang).fx?.statics).toEqual([{ k: 'boomerang', scope: 'self' }]);
    for (const id of [IDS.neoUpper, IDS.boomerang, IDS.legacy, IDS.enriching, IDS.spiky, IDS.rocket, IDS.telepathic, IDS.ignition, IDS.doubleTurbo, IDS.magnetic]) expect(card(id).fx?.followed, card(id).name).toBe(true);
    // Mist Energy: "prevent all effects of attacks" is a standing effect now that attacks have effects.
    expect(card(IDS.mist).fx?.statics).toEqual([{ k: 'preventEffects', scope: 'self' }]);
    expect(card(IDS.mist).fx?.followed).toBe(true);
  });
});

describe('Special Energy in play', () => {
  it('pays with Neo Upper Energy only on a Stage 2, and keeps Team Rocket\'s Energy for Team Rocket\'s Pokémon', () => {
    const { d, card } = compiled([IDS.neoUpper, IDS.rocket, IDS.rocketMewtwo, IDS.charizard, IDS.charmander, IDS.fire]);
    const g = game();
    const neo = card(IDS.neoUpper);
    // Burning Darkness costs RR: Neo Upper counts as two of any type on Charizard ex, as one Colorless on Charmander.
    const z = seat(g, d, mon(card(IDS.charizard), [neo]));
    expect(attack(g, z, null)).toBe(180);
    const c = seat(g, d, mon(card(IDS.charmander), [neo]));
    expect(attack(g, c, null)).toBe(0);
    expect(missing('RR', [{ provides: 'C', basicEnergy: false }])).toBe('RR');
    // Team Rocket's Energy from the hand goes to Team Rocket's Mewtwo ex in the Active Spot, never to the Charizard ex the plan leads with.
    const rocket = card(IDS.rocket);
    const p = seat(g, d, mon(card(IDS.rocketMewtwo)), [rocket], [card(IDS.fire)]);
    p.bench = [mon(card(IDS.charizard))];
    mainPhase(g, p, null);
    expect(p.bench[0].energy.length).toBe(0);
    expect(p.active!.energy.map((e) => e.name)).toEqual(["Team Rocket's Energy"]);
    // Two at a time: Erasure Ball (PPC) is one Energy short with the one card, paid with a second.
    const m = seat(g, d, mon(card(IDS.rocketMewtwo), [rocket]));
    expect(attack(g, m, null)).toBe(0);
    m.active!.energy.push(rocket);
    expect(attack(g, m, null)).toBeGreaterThan(0);
  });

  it('draws four when Enriching Energy is attached from the hand', () => {
    // Dudunsparce's Land Crush costs CCC, which a Colorless Energy pays; the pilot never attaches one where Fire is needed.
    const { d, card } = compiled([IDS.enriching, IDS.dudunsparce, IDS.fire], 4);
    const g = game();
    const fire = card(IDS.fire);
    const p = seat(g, d, mon(card(IDS.dudunsparce)), [card(IDS.enriching)], new Array<SimCard>(10).fill(fire));
    mainPhase(g, p, null);
    expect(p.active!.energy.map((e) => e.name)).toEqual(['Enriching Energy']);
    expect(p.hand.length).toBe(4);
    // Ignition Energy pays three Colorless on an Evolution Pokémon for the turn, then leaves.
    const { d: d2, card: card2 } = compiled([IDS.ignition, IDS.charizard, IDS.charmander, IDS.dudunsparce, IDS.fire], 2);
    const z = seat(g, d2, mon(card2(IDS.dudunsparce), [card2(IDS.ignition)]));
    z.active!.under = [card2(IDS.charmander).i];
    expect(attack(g, z, null)).toBe(90);
    expect(z.active!.energy.length).toBe(0);
    expect(z.discard.map((i) => d2.cards[i].name)).toEqual(['Ignition Energy']);
  });

  it('puts Spiky Energy\'s counters on the attacker, withholds Legacy Energy\'s Prize card once, and brings Boomerang Energy back', () => {
    const { d, card } = compiled([IDS.spiky, IDS.legacy, IDS.boomerang, IDS.charizard, IDS.charmander, IDS.cyndaquil, IDS.fire], 2);
    const g = game();
    const fire = card(IDS.fire);
    const me = seat(g, d, mon(card(IDS.charizard), [fire, fire]));
    const them = seat(g, d, mon(card(IDS.charizard), [card(IDS.spiky)]));
    expect(attack(g, me, them)).toBe(180);
    expect(me.active!.dmg).toBe(20);
    // Legacy Energy: the first Knock Out gives one Prize card, the next two.
    const g2 = game();
    const taker = seat(g2, d, mon(card(IDS.charmander)));
    const victim = seat(g2, d, mon(card(IDS.charizard), [card(IDS.legacy)], 330), [], []);
    victim.bench = [mon(card(IDS.charizard), [card(IDS.legacy)], 330)];
    knockOut(g2, taker, victim);
    expect(taker.taken).toBe(1);
    knockOut(g2, taker, victim);
    expect(taker.taken).toBe(3);
    // Ember discards an Energy (the last attached, Boomerang Energy), which comes straight back.
    const q = seat(g, d, mon(card(IDS.cyndaquil), [fire, card(IDS.boomerang)]));
    expect(attack(g, q, null)).toBe(30);
    expect(q.active!.energy.map((e) => e.name).sort()).toEqual(['Boomerang Energy', 'Fire Energy']);
    expect(q.discard.length).toBe(0);
  });
});
