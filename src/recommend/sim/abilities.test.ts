/**
 * Abilities: conditions and costs on activated ones, "in this way" follow-ups,
 * looks at the top of the deck, and passive Abilities as standing effects
 * (free retreat, damage boosts, Energy doubling, Weakness changed, damage
 * prevented from a kind of attacker). Real cards by catalog id.
 */
import { describe, expect, it } from 'vitest';
import { compileDeck, type SimCard } from './cards';
import { attack, mainPhase, newPlayer, retreatCost, type Game, type Mon, type Player } from './engine';
import { loadEvaluator } from './fixtures';
import { POKEMON_RULES_PAR_2023 } from './rules';

const { ev } = loadEvaluator();

const IDS = {
  fezandipiti: 'sv06.5-038', // Flip the Script: after a Knock Out last turn, draw 3
  latias: 'sv08-076', // Skyliner: Basic Pokémon have no Retreat Cost
  meganium: 'me01-010', // Wild Growth: each Basic Grass Energy provides GG
  drakloak: 'sv06-129', // Recon Directive: top 2, one to the hand, the other to the bottom
  dudunsparce: 'sv05-129', // Run Away Draw: draw 3, then shuffle itself into the deck
  crustle: 'sv10-012', // Mysterious Rock Inn: no damage from a Pokémon ex
  ironcrown: 'svp-146', // Cobalt Command: Future Pokémon (except Iron Crown ex) do 20 more
  chienpao: 'svp-152', // Snow Sink: discard a Stadium when benched
  ursaluna: 'svp-177', // Seasoned Skill: Blood Moon costs 1 less per Prize card the opponent has taken
  hydrapple: 'sv07-014', // Ripening Charge: attach a Grass from hand, heal 30 from that Pokémon
  metang: 'svp-090', // Metal Maker: top 4, attach the Basic Metal Energy there
  tatsugiri: 'svp-118', // Attract Customers: top 6, a Supporter to the hand
  lunatone: 'me01-074', // Lunar Cycle: with Solrock in play, discard a Basic Fighting Energy to draw 3
  zoroark: 'sv09-098', // Trade: discard a card to draw 2
  clefairy: 'sv09-056', // Lillie's Clefairy ex: Fairy Zone, Dragon Pokémon's Weakness becomes Psychic
  dragapult: 'sv06-130', // Dragapult ex, Dragon, 320 HP
  charizard: 'sv04.5-054', // Charizard ex, a Pokémon ex
  charmander: 'sv04.5-007',
  mountain: 'sv08-177', // Gravity Mountain (a Stadium)
  iono: 'sv04.5-080', // a Supporter
  fire: 'sve-002',
  grass: 'sve-001',
  metal: 'sve-008',
  psychic: 'sve-005',
  fighting: 'sve-006',
};

function compiled(ids: string[], qty = 1) {
  const d = compileDeck(ev, ids.map((cardId) => ({ cardId, qty })));
  return { d, card: (id: string): SimCard => d.cards.find((c) => c.card.id === id)! };
}
const game = (): Game => ({ rules: POKEMON_RULES_PAR_2023, stadium: null, winner: null, ending: '' });
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
const names = (p: Player, xs: number[]) => xs.map((i) => p.d.cards[i].name);

describe('reading Abilities', () => {
  const { card } = compiled(Object.values(IDS));
  const ab = (id: string, name: string) => card(id).abilities.find((a) => a.name === name)!;

  it('reads conditions, costs, follow-ups and looks on activated Abilities, every sentence followed', () => {
    expect(ab(IDS.fezandipiti, 'Flip the Script').fx).toMatchObject({ cond: { k: 'koLastTurn' }, effects: [{ k: 'draw', n: 3 }], followed: true });
    expect(ab(IDS.dudunsparce, 'Run Away Draw').fx).toMatchObject({ effects: [{ k: 'draw', n: 3 }, { k: 'selfToDeck', if: { k: 'did' } }], followed: true });
    expect(ab(IDS.drakloak, 'Recon Directive').fx).toMatchObject({ effects: [{ k: 'search', n: 1, top: 2, f: { k: 'any' } }], followed: true });
    expect(ab(IDS.hydrapple, 'Ripening Charge').fx).toMatchObject({ effects: [{ k: 'attach', from: 'hand' }, { k: 'heal', n: 30, target: 'that', if: { k: 'did' } }], followed: true });
    expect(ab(IDS.metang, 'Metal Maker').fx).toMatchObject({ effects: [{ k: 'search', n: 99, top: 4, to: 'attach', f: { k: 'energy', basic: true, type: 'M' } }], followed: true });
    expect(ab(IDS.tatsugiri, 'Attract Customers').fx).toMatchObject({ effects: [{ k: 'search', n: 1, top: 6, f: { k: 'trainer', tt: 'Supporter' } }], followed: true });
    expect(ab(IDS.tatsugiri, 'Attract Customers').activeOnly).toBe(true);
    expect(ab(IDS.lunatone, 'Lunar Cycle').fx).toMatchObject({ cond: { k: 'inPlay', t: { names: ['solrock'] } }, discardCost: 1, discardCostF: { k: 'energy', basic: true, type: 'F' }, effects: [{ k: 'draw', n: 3 }], followed: true });
    expect(ab(IDS.zoroark, 'Trade').fx).toMatchObject({ discardCost: 1, effects: [{ k: 'draw', n: 2 }], followed: true });
    expect(ab(IDS.chienpao, 'Snow Sink')).toMatchObject({ trigger: 'bench', fx: { effects: [{ k: 'discardStadium' }], followed: true } });
  });

  it('reads passive Abilities into standing effects', () => {
    expect(ab(IDS.latias, 'Skyliner').fx.statics).toEqual([{ k: 'retreat', delta: -99, t: { basic: true }, scope: 'own' }]);
    expect(ab(IDS.meganium, 'Wild Growth').fx).toMatchObject({ statics: [{ k: 'energyDouble', type: 'G', scope: 'own' }], followed: true });
    expect(ab(IDS.crustle, 'Mysterious Rock Inn').fx).toMatchObject({ statics: [{ k: 'preventDamage', from: { suffix: 'ex' }, scope: 'self' }], followed: true });
    // "Future Pokémon" is a kind the card data does not mark: Cobalt Command stays unread.
    expect(ab(IDS.ironcrown, 'Cobalt Command').fx.followed).toBe(false);
    expect(ab(IDS.ursaluna, 'Seasoned Skill').fx).toMatchObject({ statics: [{ k: 'costLess', n: 1, attack: 'Blood Moon', per: { k: 'prizesTaken', side: 'opponent' } }], followed: true });
    expect(ab(IDS.clefairy, 'Fairy Zone').fx).toMatchObject({ statics: [{ k: 'weakness', to: 'P', t: { type: 'N' }, scope: 'opponent' }], followed: true });
    for (const [id, name] of [[IDS.latias, 'Skyliner'], [IDS.meganium, 'Wild Growth'], [IDS.crustle, 'Mysterious Rock Inn'], [IDS.ursaluna, 'Seasoned Skill'], [IDS.clefairy, 'Fairy Zone']]) {
      expect(ab(id, name).fx.followed, name).toBe(true);
      expect(ab(id, name).fx.unread, name).toBe('');
    }
  });
});

describe('Abilities in play', () => {
  it('draws with Flip the Script only after a Knock Out, and Run Away Draw puts Dudunsparce back into the deck', () => {
    const { d, card } = compiled([IDS.fezandipiti, IDS.dudunsparce, IDS.charmander, IDS.fire], 4);
    const g = game();
    const fire = card(IDS.fire);
    const fires = (n: number) => new Array<SimCard>(n).fill(fire);
    const p = seat(g, d, mon(card(IDS.charmander)), [], fires(20));
    p.bench = [mon(card(IDS.fezandipiti))];
    mainPhase(g, p, null);
    expect(p.hand.length + p.active!.energy.length).toBe(0);
    p.koBefore = p.turn;
    mainPhase(g, p, null);
    expect(p.hand.length + p.active!.energy.length).toBe(3);
    const q = seat(g, d, mon(card(IDS.charmander)), [], fires(20));
    q.bench = [mon(card(IDS.dudunsparce))];
    mainPhase(g, q, null);
    expect(q.hand.length + q.active!.energy.length).toBe(3);
    expect(q.bench.length).toBe(0);
    expect(q.deck.length).toBe(18);
  });

  it('keeps Lunar Cycle for a table with Solrock and a spare Fighting Energy, and Trade pays a card', () => {
    const { d, card } = compiled([IDS.lunatone, IDS.zoroark, IDS.charmander, IDS.fire, IDS.fighting], 4);
    const g = game();
    const fire = card(IDS.fire);
    const fires = (n: number) => new Array<SimCard>(n).fill(fire);
    const p = seat(g, d, mon(card(IDS.charmander)), [card(IDS.fighting), card(IDS.fighting)], fires(20));
    p.bench = [mon(card(IDS.lunatone))];
    mainPhase(g, p, null);
    // No Solrock: nothing drawn (one of the hand's two Fighting Energy is attached, to Lunatone).
    expect(p.hand.length + p.active!.energy.length + p.bench.reduce((n, m) => n + m.energy.length, 0)).toBe(2);
    expect(p.discard.length).toBe(0);
    const q = seat(g, d, mon(card(IDS.charmander)), [fire, fire, fire], fires(20));
    q.bench = [mon(card(IDS.zoroark))];
    mainPhase(g, q, null);
    // Trade: one Fire discarded, two drawn.
    expect(q.discard.length).toBe(1);
    expect(q.hand.length + q.active!.energy.length).toBe(4);
  });

  it('takes the Retreat Cost off Basics under Skyliner, doubles Grass under Wild Growth, and attaches from the top with Metal Maker', () => {
    const { d, card } = compiled([IDS.latias, IDS.meganium, IDS.metang, IDS.charmander, IDS.grass, IDS.metal, IDS.fire], 4);
    const g = game();
    const p = seat(g, d, mon(card(IDS.charmander)));
    expect(retreatCost(p, p.active!)).toBe(1);
    p.bench = [mon(card(IDS.latias))];
    expect(retreatCost(p, p.active!)).toBe(0);
    // Latias ex is a Basic itself, so its own printed cost goes too.
    expect(card(IDS.latias).retreat).toBeGreaterThan(0);
    expect(retreatCost(p, p.bench[0])).toBe(0);
    // Solar Beam costs GGCC: two Grass pay it under Wild Growth.
    const grass = card(IDS.grass);
    const q = seat(g, d, mon(card(IDS.meganium), [grass, grass]));
    expect(attack(g, q, null)).toBe(140);
    const r = seat(g, d, mon(card(IDS.meganium), [grass, grass]));
    r.active!.c = card(IDS.charmander);
    expect(attack(g, r, null)).toBe(0);
    // Metal Maker: the Basic Metal Energy among the top four go onto Pokémon that need them.
    const metal = card(IDS.metal);
    const s = seat(g, d, mon(card(IDS.metang)), [], [card(IDS.fire), metal, card(IDS.fire), metal, card(IDS.fire)]);
    mainPhase(g, s, null);
    expect(s.active!.energy.filter((e) => e.name === 'Metal Energy').length).toBe(2);
    expect(s.deck.length).toBe(3);
  });

  it('adds Cobalt Command\'s damage, changes Weakness with Fairy Zone, and prevents a Pokémon ex\'s damage with Mysterious Rock Inn', () => {
    const { d, card } = compiled([IDS.clefairy, IDS.crustle, IDS.dragapult, IDS.charizard, IDS.charmander, IDS.psychic, IDS.fire], 2);
    const g = game();
    const psychic = card(IDS.psychic);
    // Fairy Zone: Dragapult ex (Dragon) becomes weak to Psychic while Lillie's Clefairy ex is on my side.
    const me = seat(g, d, mon(card(IDS.clefairy), [psychic, card(IDS.fire)]));
    const them = seat(g, d, mon(card(IDS.dragapult)));
    them.bench = [mon(card(IDS.charmander))];
    const dmg = attack(g, me, them);
    // Full Moon Rondo 20 plus 20 per Benched Pokémon (one of theirs), doubled by the Weakness.
    expect(dmg).toBe((20 + 20) * 2);
    // Mysterious Rock Inn: Charizard ex does nothing to Crustle.
    const ex = seat(g, d, mon(card(IDS.charizard), [card(IDS.fire), card(IDS.fire)]));
    const wall = seat(g, d, mon(card(IDS.crustle)));
    expect(attack(g, ex, wall)).toBe(0);
    expect(wall.active?.dmg).toBe(0);
  });

  it('discards the opponent\'s Stadium with Snow Sink when benched', () => {
    const { d, card } = compiled([IDS.chienpao, IDS.mountain, IDS.charizard, IDS.charmander, IDS.fire], 2);
    const g = game();
    const them = seat(g, d, mon(card(IDS.charmander)));
    g.stadium = { c: card(IDS.mountain), owner: them };
    const me = seat(g, d, mon(card(IDS.charizard)), [card(IDS.chienpao)], [card(IDS.fire)]);
    mainPhase(g, me, them);
    expect(me.bench.map((m) => m.c.name)).toContain('Chien-Pao');
    expect(g.stadium).toBeNull();
    expect(names(them, them.discard)).toContain('Gravity Mountain');
  });
});
