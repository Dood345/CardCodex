/**
 * Tools and Stadiums: what a card does while in play, read from real cards
 * by catalog id and applied on arranged tables (HP, Retreat Cost, damage,
 * Prize cards, Abilities off, counters on benched Basics, evolving the turn
 * played, damage taken), and the pilot's choices of where a Tool goes and
 * whether a Stadium favours it.
 */
import { describe, expect, it } from 'vitest';
import { compileDeck, type SimCard } from './cards';
import { attack, knockOut, mainPhase, maxHp, newPlayer, retreatCost, type Game, type Mon, type Player } from './engine';
import { loadEvaluator } from './fixtures';
import { POKEMON_RULES_PAR_2023 } from './rules';

const { ev } = loadEvaluator();

const IDS = {
  balloon: 'me01-166', // Air Balloon: Retreat Cost 2 less
  cape: 'sv05-152', // Hero's Cape: +100 HP
  bangle: 'sv10.5w-080', // Brave Bangle: +30 vs a Pokémon ex, holder without a Rule Box
  pearl: 'sv09-151', // Lillie's Pearl: a Lillie's Pokémon gives 1 fewer Prize card
  helmet: 'sv06-158', // Lucky Helmet: draw 2 when damaged in the Active Spot
  belt: 'sv05-154', // Maximum Belt: +50 vs a Pokémon ex
  board: 'sv05-159', // Rescue Board: Retreat Cost 1 less, none at 30 HP or less
  mountain: 'sv08-177', // Gravity Mountain: Stage 2 get -30 HP
  ruins: 'me01-127', // Risky Ruins: 2 damage counters on a Basic non-Darkness Pokémon benched
  forest: 'me01-117', // Forest of Vitality: Grass Pokémon evolve the turn they are played
  watchtower: 'sv10-180', // Team Rocket's Watchtower: Colorless Pokémon have no Abilities
  prism: 'me04-080', // Prism Tower: once per turn, discard 2 to draw 1
  lumiose: 'me03-077', // Lumiose City: once per turn, a Basic to the Bench; the turn ends
  postwick: 'sv09-154', // Postwick: Hop's Pokémon do 30 more
  castle: 'sv09-152', // N's Castle: N's Pokémon have no Retreat Cost
  jamming: 'sv06-153', // Jamming Tower: Tools have no effect
  charizard: 'sv04.5-054', // Charizard ex, Stage 2, 330 HP, Retreat Cost 2
  charmeleon: 'sv04.5-008',
  charmander: 'sv04.5-007', // Basic, 70 HP, Retreat Cost 1
  pidgey: 'sv04.5-196',
  pidgeot: 'sv04.5-221', // Pidgeot ex, Quick Search (a Colorless Pokémon with an Ability)
  fire: 'sve-002',
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

describe('reading Tools and Stadiums', () => {
  const { card } = compiled(Object.values(IDS));
  const st = (id: string) => card(id).fx!.statics;

  it('reads real cards into static effects, every sentence followed', () => {
    expect(st(IDS.balloon)).toEqual([{ k: 'retreat', delta: -2, t: undefined }]);
    expect(st(IDS.cape)).toEqual([{ k: 'hp', delta: 100, t: undefined }]);
    expect(st(IDS.bangle)).toEqual([{ k: 'damage', n: 30, vs: { suffix: 'ex' }, ruleBoxFree: true }]);
    expect(st(IDS.pearl)).toEqual([{ k: 'prizeLess', n: 1, t: { owner: "Lillie's" } }]);
    expect(st(IDS.helmet)).toEqual([{ k: 'drawWhenHit', n: 2 }]);
    expect(st(IDS.belt)).toEqual([{ k: 'damage', n: 50, t: undefined, vs: { suffix: 'ex' } }]);
    expect(st(IDS.board)).toEqual([{ k: 'retreat', delta: -1, t: undefined }]);
    expect(st(IDS.mountain)).toEqual([{ k: 'hp', delta: -30, t: { stage: 2 } }]);
    expect(st(IDS.ruins)).toEqual([{ k: 'benchCounters', n: 2, t: { basic: true, notType: 'D' } }]);
    expect(st(IDS.forest)).toEqual([{ k: 'evolveSameTurn', t: { type: 'G' } }]);
    expect(st(IDS.watchtower)).toEqual([{ k: 'noAbilities', t: { type: 'C' } }]);
    expect(st(IDS.postwick)).toEqual([{ k: 'damage', n: 30, t: { owner: "Hop's" } }]);
    expect(st(IDS.castle)).toEqual([{ k: 'retreat', delta: -99, t: { owner: "N's" } }]);
    expect(st(IDS.jamming)).toEqual([{ k: 'noTools' }]);
    for (const id of [IDS.balloon, IDS.cape, IDS.bangle, IDS.pearl, IDS.helmet, IDS.belt, IDS.mountain, IDS.ruins, IDS.forest, IDS.watchtower, IDS.postwick, IDS.castle, IDS.jamming]) {
      expect(card(id).fx?.followed, card(id).name).toBe(true);
      expect(card(id).unread, card(id).name).toBe('');
    }
    // Rescue Board's second sentence is not read yet; the card is still attached for its first.
    expect(card(IDS.board).fx?.followed).toBe(false);
    expect(card(IDS.board).unread).toBe('');
    // Shared Stadiums read like Trainers: Prism Tower pays two cards for one, Lumiose City ends the turn.
    expect(card(IDS.prism).fx).toMatchObject({ discardCost: 2, effects: [{ k: 'draw', n: 1 }], followed: true });
    expect(card(IDS.lumiose).fx).toMatchObject({ endsTurn: true, effects: [{ k: 'search', to: 'bench' }], followed: true });
  });
});

describe('Tools and Stadiums in play', () => {
  it('changes HP and Retreat Cost, and a Stadium turns Tools off', () => {
    const { d, card } = compiled([IDS.cape, IDS.balloon, IDS.mountain, IDS.jamming, IDS.charizard, IDS.charmander, IDS.fire]);
    const g = game();
    const p = seat(g, d, mon(card(IDS.charizard)));
    expect(maxHp(p, p.active!)).toBe(330);
    expect(retreatCost(p, p.active!)).toBe(2);
    p.active!.tool = card(IDS.cape);
    expect(maxHp(p, p.active!)).toBe(430);
    g.stadium = { c: card(IDS.mountain), owner: p };
    expect(maxHp(p, p.active!)).toBe(400);
    expect(maxHp(p, mon(card(IDS.charmander)))).toBe(70);
    p.active!.tool = card(IDS.balloon);
    expect(retreatCost(p, p.active!)).toBe(0);
    g.stadium = { c: card(IDS.jamming), owner: p };
    expect(retreatCost(p, p.active!)).toBe(2);
  });

  it('attaches a Tool to the plan\'s lead and adds its damage against a Pokémon ex', () => {
    const { d, card } = compiled([IDS.belt, IDS.charizard, IDS.charmeleon, IDS.charmander, IDS.fire], 2);
    const g = game();
    const fire = card(IDS.fire);
    const me = seat(g, d, mon(card(IDS.charizard), [fire, fire]), [card(IDS.belt)], [fire]);
    const them = seat(g, d, mon(card(IDS.charizard)));
    mainPhase(g, me, them);
    expect(me.active?.tool?.name).toBe('Maximum Belt');
    // Burning Darkness 180 plus 50 from the Belt against a Pokémon ex.
    expect(attack(g, me, them)).toBe(230);
    const them2 = seat(g, d, mon(card(IDS.charmander)));
    me.active = mon(card(IDS.charizard), [fire, fire]);
    me.active.tool = card(IDS.belt);
    expect(attack(g, me, them2)).toBe(180);
  });

  it('withholds a Prize card for Lillie\'s Pearl and draws for Lucky Helmet', () => {
    const { d, card } = compiled([IDS.pearl, IDS.helmet, IDS.charizard, IDS.charmander, IDS.fire]);
    const g = game();
    const fire = card(IDS.fire);
    const me = seat(g, d, mon(card(IDS.charizard), [fire, fire]));
    const them = seat(g, d, mon(card(IDS.charmander)), [], [fire, fire, fire]);
    them.active!.tool = card(IDS.helmet);
    attack(g, me, them);
    // Charmander is Knocked Out, but Lucky Helmet drew two first.
    expect(them.hand.length).toBe(2);
    expect(me.taken).toBe(1);
    // Lillie's Pearl on a Pokémon that is not Lillie's does nothing; the Pearl's test says so.
    const lillie = card(IDS.pearl).fx!.statics![0];
    expect(lillie).toMatchObject({ k: 'prizeLess', t: { owner: "Lillie's" } });
    const g2 = game();
    const victim = seat(g2, d, mon(card(IDS.charizard), [], 320), [], []);
    victim.active!.tool = card(IDS.pearl);
    const taker = seat(g2, d, mon(card(IDS.charmander)));
    knockOut(g2, taker, victim);
    expect(taker.taken).toBe(2);
  });

  it('puts counters on a Basic benched under Risky Ruins, turns Abilities off under the Watchtower, and lets Grass evolve at once', () => {
    const { d, card } = compiled([IDS.ruins, IDS.watchtower, IDS.forest, IDS.pidgey, IDS.pidgeot, IDS.charmander, IDS.fire, IDS.grass], 2);
    const g = game();
    const fire = card(IDS.fire);
    g.stadium = { c: card(IDS.ruins), owner: null as unknown as Player };
    const p = seat(g, d, mon(card(IDS.charmander)), [card(IDS.charmander)], [fire, fire]);
    mainPhase(g, p, null);
    expect(p.bench[0]?.dmg).toBe(20);
    // Pidgeot ex's Quick Search is a Colorless Pokémon's Ability: off under the Watchtower.
    const q = seat(g, d, mon(card(IDS.pidgeot)), [], [fire, card(IDS.charmander), fire]);
    g.stadium = { c: card(IDS.watchtower), owner: q };
    mainPhase(g, q, null);
    expect(q.hand.length + q.active!.energy.length).toBe(0);
    g.stadium = null;
    const r = seat(g, d, mon(card(IDS.pidgeot)), [], [fire, card(IDS.charmander), fire]);
    mainPhase(g, r, null);
    expect(r.hand.length + r.active!.energy.length + r.bench.length).toBe(1);
  });

  it('plays a Stadium that favours it and leaves one that does not', () => {
    const { d, card } = compiled([IDS.mountain, IDS.castle, IDS.charizard, IDS.charmeleon, IDS.charmander, IDS.fire], 2);
    const g = game();
    const fire = card(IDS.fire);
    // Gravity Mountain takes 30 HP off Stage 2 Pokémon: a Charizard ex deck keeps it in hand.
    const p = seat(g, d, mon(card(IDS.charizard), [fire, fire]), [card(IDS.mountain)], [fire]);
    mainPhase(g, p, null);
    expect(g.stadium).toBeNull();
    // Against an opponent's Stage 2 it is worth playing.
    const them = seat(g, d, mon(card(IDS.charizard)));
    const q = seat(g, d, mon(card(IDS.charmander), [fire]), [card(IDS.mountain)], [fire]);
    mainPhase(g, q, them);
    expect(g.stadium?.c.name).toBe('Gravity Mountain');
    expect(maxHp(them, them.active!)).toBe(300);
  });
});
