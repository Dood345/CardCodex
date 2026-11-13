/**
 * The printed labels (Single Strike, Rapid Strike, Fusion Strike, Ancient, Future, Tera) in the
 * pilot: tests on Pokémon and cards, the texts that name them, and the engine applying them. Real
 * cards by catalog id; assertions on what the shipped text and labels say.
 */
import { describe, expect, it } from 'vitest';
import { compileDeck, type SimCard } from './cards';
import { duel } from './duel';
import { attack, benchLimit, mainPhase, newPlayer, sweep, type Game, type Mon, type Player } from './engine';
import { loadEvaluator } from './fixtures';
import { POKEMON_RULES_PAR_2023 } from './rules';

const { ev } = loadEvaluator();

const IDS = {
  orb: 'sv08-189', // Tera Orb: search for a Tera Pokémon
  drum: 'sv05-141', // Awakening Drum: draw a card for each of your Ancient Pokémon in play
  pod: 'sv05-158', // Reboot Pod: a Basic Energy from the discard pile to each of your Future Pokémon
  trumpet: 'sv07-135', // Glass Trumpet: only with a Tera Pokémon in play; up to 2 Benched Colorless Pokémon get an Energy from the discard pile
  sada: 'sv04-170', // Professor Sada's Vitality: up to 2 Ancient Pokémon get an Energy from the discard pile
  areaZero: 'sv07-131', // Area Zero Underdepths: a Bench of 8 with a Tera Pokémon in play
  mine: 'me02.5-197', // Nighttime Mine: attacks of Tera Pokémon cost Colorless more
  crystal: 'sv07-142', // Sparkling Crystal: the Tera holder's attacks cost 1 Energy less
  ancientCapsule: 'sv04-159', // +60 HP and no Special Conditions for an Ancient holder
  futureCapsule: 'sv04-164', // no Retreat Cost and 20 more damage for a Future holder
  briar: 'sv07-132', // Briar: with exactly 2 Prize cards left for the opponent, a Knock Out by a Tera Pokémon takes 1 more
  milotic: 'sv08-042', // Milotic ex: Sparkling Scales prevents damage and effects from Tera Pokémon
  ironThornsEx: 'sv06-077', // Iron Thorns ex: Initialization, Rule Box Pokémon have no Abilities except Future Pokémon; Volt Cyclone LCC 140
  ironCrown: 'svp-146', // Iron Crown ex: Cobalt Command, your Future Pokémon's attacks do 20 more, except Iron Crown ex
  screamTail: 'sv05-077', // Scream Tail: heal 100 from 1 of your Benched Ancient Pokémon
  koraidon: 'svp-091', // Koraidon: 30 for each of your Ancient Pokémon in play
  roaringMoon: 'sv05-109', // Roaring Moon: 10 more for each Ancient card in your discard pile
  roaringMoonEx: 'sv04-124', // Roaring Moon ex (Ancient)
  terapagos: 'sv07-128', // Terapagos ex (Tera): Crown Opal GWL 180
  charizardTera: 'sv03-125', // Charizard ex (Tera)
  magcargo: 'sv06-029', // Magcargo ex: Hot Magma Burns
  wailord: 'me05-016', // Wailord ex, a Water Pokémon
  tyranitarV: 'swsh5-97', // Single Strike
  chesnaughtV: 'swsh12-015', // no label
  singleStrikeEnergy: 'swsh5-141',
  bubbly: 'me04-084', // Bubbly Water Energy: the Water holder cannot be given Special Conditions
  charmander: 'sv04.5-007',
  fire: 'sve-002',
  water: 'sve-003',
  lightning: 'sve-004',
  psychic: 'sve-005',
  fighting: 'sve-006',
  darkness: 'sve-007',
  grass: 'sve-001',
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

describe('reading the printed labels', () => {
  const { card } = compiled(Object.values(IDS));
  const ability = (id: string) => card(id).abilities[0].fx;
  const atk = (id: string, name: string) => card(id).attacks.find((a) => a.name === name)!;

  it('carries the labels on the simulator cards', () => {
    expect(card(IDS.charizardTera).labels).toEqual(['Tera']);
    expect(card(IDS.ironThornsEx).labels).toEqual(['Future']);
    expect(card(IDS.roaringMoonEx).labels).toEqual(['Ancient']);
    expect(card(IDS.tyranitarV).labels).toEqual(['Single Strike']);
    expect(card(IDS.chesnaughtV).labels).toEqual([]);
    expect(card(IDS.singleStrikeEnergy).labels).toEqual(['Single Strike']);
  });

  it('reads Trainers that name a label, every sentence followed', () => {
    expect(card(IDS.orb).fx).toMatchObject({ effects: [{ k: 'search', n: 1, f: { k: 'pokemon', label: 'Tera' }, to: 'hand' }], followed: true });
    expect(card(IDS.drum).fx).toMatchObject({ effects: [{ k: 'draw', n: 1, per: { label: 'Ancient' } }], followed: true });
    expect(card(IDS.pod).fx).toMatchObject({ effects: [{ k: 'attach', from: 'discard', f: { k: 'energy', basic: true }, target: { where: 'any', t: { label: 'Future' }, each: true } }], followed: true });
    expect(card(IDS.trumpet).fx).toMatchObject({ cond: { k: 'inPlay', side: 'self', t: { label: 'Tera' } }, effects: [{ k: 'attach', n: 2, from: 'discard', target: { where: 'bench', distinct: true } }], followed: true });
    expect(card(IDS.sada).fx).toMatchObject({ effects: [{ k: 'attach', n: 2, from: 'discard', target: { where: 'any', t: { label: 'Ancient' }, distinct: true } }, { k: 'draw', n: 3, if: { k: 'did' } }], followed: true });
    expect(card(IDS.areaZero).fx).toMatchObject({ statics: [{ k: 'benchSize', n: 8, t: { label: 'Tera' } }], followed: true });
    expect(card(IDS.mine).fx).toMatchObject({ statics: [{ k: 'costMore', n: 1, t: { label: 'Tera' } }], followed: true });
    expect(card(IDS.crystal).fx).toMatchObject({ statics: [{ k: 'costLess', n: 1, t: { label: 'Tera' } }], followed: true });
    expect(card(IDS.ancientCapsule).fx).toMatchObject({ statics: [{ k: 'hp', delta: 60, t: { label: 'Ancient' } }, { k: 'noConditions', t: { label: 'Ancient' } }], followed: true });
    expect(card(IDS.futureCapsule).fx).toMatchObject({ statics: [{ k: 'retreat', delta: -99, t: { label: 'Future' } }, { k: 'damage', n: 20, t: { label: 'Future' } }], followed: true });
    expect(card(IDS.briar).fx).toMatchObject({ cond: { k: 'prizes', side: 'opponent', exactly: [2] }, effects: [{ k: 'damageBoost', statics: [{ k: 'prizeMore', n: 1, t: { label: 'Tera' } }] }], followed: true });
  });

  it('reads Abilities, attacks and Special Energy that name a label', () => {
    expect(ability(IDS.ironCrown)).toMatchObject({ statics: [{ k: 'damage', n: 20, t: { label: 'Future', notNames: ['iron crown ex'] }, scope: 'own' }], followed: true });
    expect(ability(IDS.milotic)).toMatchObject({ statics: [{ k: 'preventDamage', from: { label: 'Tera' } }, { k: 'preventEffects', from: { label: 'Tera' } }], followed: true });
    expect(ability(IDS.ironThornsEx)).toMatchObject({ statics: [{ k: 'noAbilities', t: { ruleBox: true, notLabel: 'Future' }, activeOnly: true, scope: 'both' }], followed: true });
    expect(atk(IDS.screamTail, 'Supportive Singing').fx).toMatchObject({ effects: [{ k: 'heal', n: 100, target: 'any', t: { label: 'Ancient' }, bench: true }], followed: true });
    expect(atk(IDS.koraidon, 'Primordial Beatdown').fx).toMatchObject({ mods: [{ k: 'times', n: 30, per: { k: 'inPlay', side: 'self', t: { label: 'Ancient' } } }], followed: true });
    expect(atk(IDS.roaringMoon, 'Vengeance Fletching').fx).toMatchObject({ mods: [{ k: 'plus', n: 10, per: { k: 'discard', side: 'self', t: { label: 'Ancient' } } }], followed: true });
    expect(card(IDS.singleStrikeEnergy).fx?.followed).toBe(true);
    expect(card(IDS.singleStrikeEnergy).energy?.onlyKeys?.has(card(IDS.tyranitarV).key)).toBe(true);
    expect(card(IDS.singleStrikeEnergy).energy?.onlyKeys?.has(card(IDS.chesnaughtV).key)).toBe(false);
    expect(card(IDS.bubbly).fx).toMatchObject({ statics: [{ k: 'noConditions', t: { type: 'W' } }], followed: true });
  });
});

describe('in a game', () => {
  it('attaches Single Strike Energy only to a Single Strike Pokémon', () => {
    const { d, card } = compiled([IDS.tyranitarV, IDS.chesnaughtV, IDS.singleStrikeEnergy, IDS.darkness], 2);
    const g = game();
    const p = seat(g, d, mon(card(IDS.chesnaughtV)), [card(IDS.singleStrikeEnergy)], [card(IDS.darkness)]);
    mainPhase(g, p, null);
    expect(p.active!.energy).toHaveLength(0);
    expect(p.hand).toContain(card(IDS.singleStrikeEnergy).i);
    const q = seat(g, d, mon(card(IDS.chesnaughtV)), [card(IDS.singleStrikeEnergy)], [card(IDS.darkness)]);
    q.bench = [mon(card(IDS.tyranitarV))];
    mainPhase(g, q, null);
    expect(q.bench[0].energy.map((e) => e.name)).toEqual(['Single Strike Energy']);
  });

  it('widens the Bench to 8 under Area Zero Underdepths while a Tera Pokémon is in play, and discards the extra when it leaves', () => {
    const { d, card } = compiled([IDS.areaZero, IDS.terapagos, IDS.charmander, IDS.fire], 8);
    const g = game();
    const p = seat(g, d, mon(card(IDS.terapagos)));
    g.stadium = { c: card(IDS.areaZero), owner: p };
    expect(benchLimit(p)).toBe(8);
    const fill = () => {
      p.bench = [];
      for (let k = 0; k < 7; k++) p.bench.push(mon(card(IDS.charmander)));
    };
    fill();
    sweep(g, p, null);
    expect(p.bench).toHaveLength(7);
    // The Tera Pokémon leaves: the limit falls to 5 and the last Benched go to the discard pile, no Prize cards.
    p.active = mon(card(IDS.charmander));
    expect(benchLimit(p)).toBe(5);
    sweep(g, p, null);
    expect(p.bench).toHaveLength(5);
    expect(p.discard.filter((i) => d.cards[i].name === 'Charmander')).toHaveLength(2);
    expect(p.taken).toBe(0);
  });

  it('adds Cobalt Command to a Future attacker, draws for Ancient Pokémon in play, and keeps Special Conditions off a Bubbly Water holder', () => {
    const { d, card } = compiled([IDS.ironThornsEx, IDS.ironCrown, IDS.drum, IDS.roaringMoonEx, IDS.koraidon, IDS.charmander, IDS.lightning, IDS.fire, IDS.magcargo, IDS.wailord, IDS.bubbly, IDS.water], 2);
    const g = game();
    const l = card(IDS.lightning);
    // Volt Cyclone 140, plus 20 with Iron Crown ex on the Bench.
    const me = seat(g, d, mon(card(IDS.ironThornsEx), [l, l, l]));
    me.bench = [mon(card(IDS.ironCrown))];
    const wall = seat(g, d, mon(card(IDS.charmander)), [], [card(IDS.fire)]);
    wall.active!.dmg = 0;
    expect(attack(g, me, wall)).toBe(160);
    // Awakening Drum with two Ancient Pokémon in play draws two.
    const g2 = game();
    const fire = card(IDS.fire);
    const q = seat(g2, d, mon(card(IDS.roaringMoonEx)), [card(IDS.drum)], [fire, fire, fire, fire, fire, fire, fire, fire, fire, fire, fire, fire, fire, fire, fire, fire, fire, fire, fire, fire, fire, fire, fire, fire, fire, fire]);
    q.bench = [mon(card(IDS.koraidon))];
    const before = q.deck.length;
    mainPhase(g2, q, null);
    expect(q.discard).toContain(card(IDS.drum).i);
    expect(before - q.deck.length).toBeGreaterThanOrEqual(2);
    // Hot Magma Burns, but not a Wailord ex holding Bubbly Water Energy.
    const g3 = game();
    const f = card(IDS.fire);
    const lava = seat(g3, d, mon(card(IDS.magcargo), [f, f]));
    const wet = seat(g3, d, mon(card(IDS.wailord), [card(IDS.bubbly)]), [], [card(IDS.water)]);
    expect(attack(g3, lava, wet)).toBe(70);
    expect(wet.active!.cond?.has('Burned') ?? false).toBe(false);
    const dry = seat(g3, d, mon(card(IDS.wailord), [card(IDS.water)]), [], [card(IDS.water)]);
    attack(g3, lava, dry);
    expect(dry.active!.cond?.has('Burned')).toBe(true);
  });

  it('plays Briar for the extra Prize card when a Tera Pokémon makes the Knock Out', () => {
    const { d, card } = compiled([IDS.briar, IDS.terapagos, IDS.charmander, IDS.grass, IDS.water, IDS.lightning, IDS.fire], 2);
    const g = game();
    const me = seat(g, d, mon(card(IDS.terapagos), [card(IDS.grass), card(IDS.water), card(IDS.lightning)]), [card(IDS.briar)], [card(IDS.fire)]);
    const them = seat(g, d, mon(card(IDS.charmander)), [], [card(IDS.fire)]);
    them.prizes = [0, 0];
    mainPhase(g, me, them);
    expect(me.discard).toContain(card(IDS.briar).i);
    attack(g, me, them);
    expect(me.taken).toBe(2);
    // A duel runs with these cards and ends.
    const r = duel(ev, [{ cardId: IDS.terapagos, qty: 4 }, { cardId: IDS.briar, qty: 4 }, { cardId: IDS.grass, qty: 18 }, { cardId: IDS.water, qty: 17 }, { cardId: IDS.lightning, qty: 17 }], [{ cardId: IDS.charmander, qty: 4 }, { cardId: IDS.fire, qty: 56 }], { games: 10, seed: 1 });
    expect(r.wins + r.losses + r.draws).toBe(10);
    expect(r.guards).toBe(0);
  });
});
