/**
 * Items and Supporters the pilot now follows in full: searches narrowed by
 * Rule Box or owner, "instead" draw alternatives, both players shuffling,
 * "only if" conditions, recovery of Pokémon and Trainers from the discard
 * pile, Energy moves, looks that keep some cards and discard the rest,
 * Crispin's split search, Gwynn's discard-and-draw, healing. Real cards by
 * catalog id; assertions on the shipped text and on arranged tables.
 */
import { describe, expect, it } from 'vitest';
import { compileDeck, type SimCard } from './cards';
import { attack, mainPhase, maxHp, newPlayer, type Game, type Mon, type Player } from './engine';
import { loadEvaluator } from './fixtures';
import { playtest } from './playtest';
import { POKEMON_RULES_PAR_2023 } from './rules';

const { ev } = loadEvaluator();

const IDS = {
  pad: 'me03-081', // Poké Pad: a Pokémon that doesn't have a Rule Box
  stretcher: 'sv06.5-061', // Night Stretcher: a Pokémon or a Basic Energy card from the discard pile
  lana: 'sv06.5-061',
  lanasAid: 'sv06-155', // Lana's Aid: up to 3 Pokémon without a Rule Box and Basic Energy
  energySwitch: 'me01-115', // Move a Basic Energy from 1 of your Pokémon to another
  guidance: 'sv05-147', // Explorer's Guidance: top 6, keep 2, discard the rest
  crispin: 'sv07-133', // 2 Basic Energy of different types: 1 to hand, 1 attached
  gwynn: 'me05-078', // discard up to 2 Pokémon without a Rule Box, draw 3 each
  potion: 'me03-083', // Heal 30 from 1 of your Pokémon
  iceCream: 'me02-091', // Heal 80 from the Active with 3 or more Energy
  gong: 'me01-116', // Fighting Gong: a Basic Fighting Energy or a Basic Fighting Pokémon
  brock: 'sv09-146', // up to 2 Basic Pokémon or 1 Evolution Pokémon
  carmine: 'sv06-145', // first turn allowed going first; discard hand, draw 5
  ariana: 'sv10-171', // draw until 5, or 8 with only Team Rocket's Pokémon in play
  lacey: 'sv07-139', // shuffle, draw 4, or 8 when the opponent has 3 or fewer Prize cards
  judge: 'me03-076', // each player shuffles and draws 4
  bugSet: 'sv06-143', // Bug Catching Set: top 7, up to 2 in any combination of Grass Pokémon and Basic Grass Energy
  ethan: 'sv10-165', // Ethan's Adventure: up to 3 in any combination of Ethan's Pokémon and Basic Fire Energy
  cyndaquil: 'sv10-032', // Ethan's Cyndaquil
  bulbasaur: 'me01-001', // a Basic Grass Pokémon
  grass: 'sve-001',
  riolu: 'sv07-081', // Punch FC 30, a Fighting Basic
  premium: 'me01-124', // Premium Power Pro: this turn your Fighting Pokémon's attacks do 30 more
  blackBelt: 'svp-219', // Black Belt's Training: 40 more to the opponent's Active Pokémon ex
  gladion: 'me05-077', // Gladion's Final Battle: last card in hand; 80 more from Pokémon without a Rule Box
  kieran: 'sv06-154', // Kieran: Choose 1: a switch, or 30 more to an Active ex or V
  stamp: 'sv06-165', // Unfair Stamp: only after a Knock Out; each shuffles, you draw 5, they draw 2
  recycler: 'sv10-164', // Energy Recycler: up to 5 Basic Energy into the deck
  drayton: 'sv08-174', // top 7: a Pokémon and a Trainer card
  proton: 'sv10-177', // up to 3 Basic Team Rocket's Pokémon; first turn allowed
  charizard: 'sv04.5-054',
  charmeleon: 'sv04.5-008',
  charmander: 'sv04.5-007',
  pidgey: 'sv04.5-196',
  fire: 'sve-002',
  fighting: 'sve-006',
  water: 'sve-003',
};

function compiled(ids: string[], qty = 1) {
  const d = compileDeck(ev, ids.map((cardId) => ({ cardId, qty })));
  return { d, card: (id: string): SimCard => d.cards.find((c) => c.card.id === id)! };
}
const game = (): Game => ({ rules: POKEMON_RULES_PAR_2023, stadium: null, winner: null, ending: '', guards: 0 });
const mon = (c: SimCard, energy: SimCard[] = [], dmg = 0): Mon => ({ c, under: [], energy, dmg, entered: 0, abilityTurn: -1, restTurn: 0, restAtk: '', movedTurn: 0 });
/** A player on turn `turn` with the given hand and deck (top of the deck last). */
function table(d: ReturnType<typeof compileDeck>, active: Mon | null, hand: SimCard[], deck: SimCard[], turn = 3, first = false): Player {
  const p = newPlayer(d, 7, first, 6, 5);
  p.turn = turn;
  p.active = active;
  p.hand = hand.map((c) => c.i);
  p.deck = deck.map((c) => c.i);
  for (let k = 0; k < 6; k++) p.prizes.push(0);
  return p;
}
const names = (p: Player, xs: number[]) => xs.map((i) => p.d.cards[i].name);

describe('reading Items and Supporters', () => {
  const { card } = compiled(Object.values(IDS));
  const fx = (id: string) => card(id).fx!;

  it('reads the filters, alternatives and conditions of real cards, every sentence followed', () => {
    expect(fx(IDS.pad).effects[0]).toMatchObject({ k: 'search', f: { k: 'pokemon', ruleBox: false } });
    expect(fx(IDS.stretcher).effects).toEqual([{ k: 'recover', n: 1, f: { k: 'pokemon' }, alts: [{ k: 'energy', basic: true }] }]);
    expect(fx(IDS.lanasAid).effects).toEqual([{ k: 'recover', n: 3, f: { k: 'pokemon', ruleBox: false }, alts: [{ k: 'energy', basic: true }] }]);
    expect(fx(IDS.energySwitch).effects).toEqual([{ k: 'moveEnergy', n: 1, basic: true, from: 'any', to: 'any' }]);
    expect(fx(IDS.guidance).effects).toEqual([{ k: 'search', n: 2, f: { k: 'any' }, to: 'hand', top: 6, discardRest: true }]);
    expect(fx(IDS.crispin).effects).toEqual([
      { k: 'search', n: 1, f: { k: 'energy', basic: true }, to: 'hand', distinctTypes: true },
      { k: 'search', n: 1, f: { k: 'energy', basic: true }, to: 'attach', target: { where: 'any' }, distinctFrom: 0 },
    ]);
    expect(fx(IDS.gwynn).effects).toEqual([{ k: 'discardDraw', max: 2, f: { k: 'pokemon', ruleBox: false }, per: 3 }]);
    expect(fx(IDS.potion).effects).toMatchObject([{ k: 'heal', n: 30, target: 'any' }]);
    expect(fx(IDS.iceCream).effects).toMatchObject([{ k: 'heal', n: 80, target: 'active', minEnergy: 3 }]);
    expect(fx(IDS.gong).effects).toEqual([{ k: 'search', n: 1, f: { k: 'energy', basic: true, type: 'F' }, to: 'hand', target: undefined, alts: [{ k: 'pokemon', basic: true, type: 'F' }], distinctTypes: undefined }]);
    expect(fx(IDS.brock).effects[0]).toMatchObject({ k: 'search', n: 2, f: { k: 'pokemon', basic: true }, alts: [{ k: 'pokemon', evolution: true }] });
    expect(fx(IDS.carmine)).toMatchObject({ firstTurnOk: true, effects: [{ k: 'discardHandDraw', n: 5 }] });
    expect(fx(IDS.ariana).effects).toEqual([{ k: 'drawUntil', n: 5, alt: { if: { k: 'allInPlay', t: { owner: "Team Rocket's" } }, n: 8 } }]);
    expect(fx(IDS.lacey).effects).toEqual([{ k: 'shuffleHandDraw', n: 4, bottom: false, alt: { if: { k: 'prizes', side: 'opponent', max: 3 }, n: 8 } }]);
    expect(fx(IDS.judge).effects).toEqual([{ k: 'shuffleHandDraw', n: 4, bottom: false, both: true }]);
    expect(fx(IDS.stamp)).toMatchObject({ cond: { k: 'koLastTurn' }, effects: [{ k: 'shuffleHandDraw', n: 5, bottom: false, both: true, oppN: 2 }] });
    expect(fx(IDS.recycler).effects).toEqual([{ k: 'recoverToDeck', n: 5, f: { k: 'energy', basic: true }, alts: undefined }]);
    expect(fx(IDS.drayton).effects).toMatchObject([
      { k: 'search', n: 1, f: { k: 'pokemon' }, top: 7 },
      { k: 'search', n: 1, f: { k: 'trainer' }, top: 7 },
    ]);
    expect(fx(IDS.proton)).toMatchObject({ firstTurnOk: true, effects: [{ k: 'search', n: 3, f: { k: 'pokemon', basic: true, owner: "Team Rocket's" } }] });
    for (const id of [IDS.pad, IDS.stretcher, IDS.lanasAid, IDS.energySwitch, IDS.guidance, IDS.crispin, IDS.gwynn, IDS.potion, IDS.iceCream, IDS.gong, IDS.brock, IDS.carmine, IDS.ariana, IDS.lacey, IDS.judge, IDS.stamp, IDS.recycler, IDS.drayton, IDS.proton]) {
      expect(fx(id).followed, card(id).name).toBe(true);
      expect(card(id).unread, card(id).name).toBe('');
    }
  });
});

describe('playing them', () => {
  it('keeps Poké Pad off a Pokémon ex, and Night Stretcher takes the Pokémon the plan wants back from the discard pile', () => {
    const { d, card } = compiled([IDS.pad, IDS.stretcher, IDS.charizard, IDS.charmeleon, IDS.charmander, IDS.fire], 2);
    const g = game();
    // Poké Pad with only Charizard ex in the deck: nothing is fetched; with a Charmander there, Charmander.
    const p = table(d, mon(card(IDS.charmander)), [card(IDS.pad)], [card(IDS.charizard), card(IDS.fire)]);
    mainPhase(g, p, null);
    expect(names(p, p.hand)).not.toContain('Charizard ex');
    const q = table(d, mon(card(IDS.charmander)), [card(IDS.pad)], [card(IDS.charizard), card(IDS.charmander), card(IDS.fire)]);
    mainPhase(g, q, null);
    expect(q.bench.map((m) => m.c.name)).toContain('Charmander');
    // Night Stretcher: with the Active's Energy in place, the Charmeleon the line needs is what comes back.
    const r = table(d, mon(card(IDS.charmander), [card(IDS.fire), card(IDS.fire)]), [card(IDS.stretcher)], [card(IDS.fire)]);
    r.discard = [card(IDS.fire).i, card(IDS.charmeleon).i];
    mainPhase(g, r, null);
    expect(r.active?.c.name).toBe('Charmeleon');
    expect(r.discard.length).toBe(2);
  });

  it('draws the alternative when its condition holds, for both players when the card says so', () => {
    const { d, card } = compiled([IDS.lacey, IDS.judge, IDS.stamp, IDS.charmander, IDS.fire], 4);
    const g = game();
    const fires = (n: number) => new Array<SimCard>(n).fill(card(IDS.fire));
    // Lacey: 4 cards, or 8 while the opponent has 3 or fewer Prize cards.
    const me = table(d, mon(card(IDS.charmander)), [card(IDS.lacey)], fires(12));
    const them = table(d, mon(card(IDS.charmander)), fires(3), fires(10));
    // The turn's Energy attachment follows the draw, so the hand and the Active together hold what was drawn.
    const drawn = (p: Player) => p.hand.length + (p.active?.energy.length ?? 0);
    mainPhase(g, me, them);
    expect(drawn(me)).toBe(4);
    const me2 = table(d, mon(card(IDS.charmander)), [card(IDS.lacey)], fires(12));
    them.prizes = [0, 0, 0];
    mainPhase(g, me2, them);
    expect(drawn(me2)).toBe(8);
    // Judge: the opponent's hand of three becomes four from their deck.
    const me3 = table(d, mon(card(IDS.charmander)), [card(IDS.judge)], fires(12));
    const them3 = table(d, mon(card(IDS.charmander)), fires(3), fires(10));
    mainPhase(g, me3, them3);
    expect(drawn(me3)).toBe(4);
    expect(them3.hand.length).toBe(4);
    expect(them3.deck.length).toBe(9);
    // Unfair Stamp: only after a Knock Out on the opponent's last turn; then five for me, two for them.
    const me4 = table(d, mon(card(IDS.charmander)), [card(IDS.stamp)], fires(12));
    const them4 = table(d, mon(card(IDS.charmander)), fires(3), fires(10));
    mainPhase(g, me4, them4);
    expect(names(me4, me4.hand)).toContain('Unfair Stamp');
    me4.koBefore = me4.turn;
    mainPhase(g, me4, them4);
    expect(names(me4, me4.hand)).not.toContain('Unfair Stamp');
    expect(drawn(me4)).toBe(5);
    expect(them4.hand.length).toBe(2);
  });

  it('moves an Energy from a Pokémon that does not need it to the attacker that does', () => {
    const { d, card } = compiled([IDS.energySwitch, IDS.charizard, IDS.charmeleon, IDS.charmander, IDS.pidgey, IDS.fire], 2);
    const g = game();
    const fire = card(IDS.fire);
    const p = table(d, mon(card(IDS.charizard), [fire]), [card(IDS.energySwitch)], [fire]);
    p.bench = [mon(card(IDS.pidgey), [fire, fire])];
    mainPhase(g, p, null);
    expect(p.active?.energy.length).toBe(2);
    expect(p.bench[0].energy.length).toBe(1);
  });

  it('keeps two of the top six with Explorer\'s Guidance and discards the rest; Crispin takes one Energy and attaches another type', () => {
    const { d, card } = compiled([IDS.guidance, IDS.crispin, IDS.charmander, IDS.fire, IDS.water, IDS.fighting], 3);
    const g = game();
    const fire = card(IDS.fire);
    const p = table(d, mon(card(IDS.charmander)), [card(IDS.guidance)], [fire, fire, fire, card(IDS.charmander), fire, fire, fire, card(IDS.charmander)]);
    mainPhase(g, p, null);
    // Two cards kept (Fire Energy, which the plan's attack lacks, over a second Charmander), four discarded with the Item.
    expect(p.deck.length).toBe(2);
    expect(p.discard.length).toBe(5);
    expect(p.hand.length + p.active!.energy.length + p.bench.length).toBe(2);
    expect(p.active!.energy.length).toBe(1);
    // Crispin: one Energy in hand and one of another type attached to the Active.
    const q = table(d, mon(card(IDS.charmander)), [card(IDS.crispin)], [card(IDS.water), fire, card(IDS.fighting)]);
    mainPhase(g, q, null);
    // The Fire the attack lacks goes to the hand; the other type is attached only where a Pokémon needs it, and here none does.
    const got = [...names(q, q.hand), ...q.active!.energy.map((e) => e.name)].filter((n) => n.endsWith('Energy'));
    expect(got).toEqual(['Fire Energy']);
    expect(q.deck.length).toBe(2);
  });

  it('discards spare Pokémon for Gwynn and heals with Potion only when something is hurt', () => {
    const { d, card } = compiled([IDS.gwynn, IDS.potion, IDS.charizard, IDS.charmander, IDS.pidgey, IDS.fire], 4);
    const g = game();
    const fire = card(IDS.fire);
    // Three Pidgeys in hand with no plan for them: two go for six cards.
    const p = table(d, mon(card(IDS.charmander)), [card(IDS.gwynn), card(IDS.pidgey), card(IDS.pidgey), card(IDS.pidgey)], new Array<SimCard>(14).fill(fire));
    p.bench = [mon(card(IDS.pidgey)), mon(card(IDS.pidgey)), mon(card(IDS.pidgey)), mon(card(IDS.pidgey)), mon(card(IDS.pidgey))];
    mainPhase(g, p, null);
    expect(p.hand.length + p.active!.energy.length).toBe(7);
    expect(p.discard.filter((i) => d.cards[i].name === 'Pidgey').length).toBe(2);
    // Potion: played on a damaged Active, kept otherwise.
    const q = table(d, mon(card(IDS.charmander), [], 40), [card(IDS.potion)], [fire]);
    mainPhase(g, q, null);
    expect(q.active?.dmg).toBe(10);
    const r = table(d, mon(card(IDS.charmander)), [card(IDS.potion)], [fire]);
    mainPhase(g, r, null);
    expect(names(r, r.hand)).toContain('Potion');
  });

  it('lets Carmine be played on the first turn going first, and reports an idle Potion', () => {
    const { d, card } = compiled([IDS.carmine, IDS.charmander, IDS.fire], 4);
    const g = game();
    const fire = card(IDS.fire);
    const p = table(d, mon(card(IDS.charmander)), [card(IDS.carmine), fire, fire], new Array<SimCard>(14).fill(fire), 1, true);
    mainPhase(g, p, null);
    expect(p.hand.length).toBe(5);
    expect(p.discard).toContain(card(IDS.carmine).i);
    const r = playtest(ev, [{ cardId: IDS.charmander, qty: 4 }, { cardId: IDS.potion, qty: 2 }, { cardId: IDS.fire, qty: 54 }], { games: 30, seed: 1 });
    expect(r.idle).toEqual([{ id: IDS.potion, name: 'Potion', copies: 2, reason: 'heal' }]);
  });

  it('shares one count across the kinds of an "in any combination of" search, from the deck or from the top cards', () => {
    const { d, card } = compiled([IDS.bugSet, IDS.ethan, IDS.cyndaquil, IDS.bulbasaur, IDS.grass, IDS.fire], 2);
    const set = card(IDS.bugSet).fx!;
    expect(set.followed).toBe(true);
    expect(set.effects).toHaveLength(1);
    expect(set.effects[0]).toMatchObject({ k: 'search', n: 2, to: 'hand', top: 7 });
    expect((set.effects[0] as { alts?: unknown[] }).alts).toHaveLength(1);
    const adventure = card(IDS.ethan).fx!;
    expect(adventure.followed).toBe(true);
    expect(adventure.effects[0]).toMatchObject({ k: 'search', n: 3, to: 'hand' });
    expect((adventure.effects[0] as { alts?: unknown[] }).alts).toHaveLength(1);
    // Bug Catching Set on a table, in a Grass deck: the Active wants Energy, the top seven hold a Bulbasaur and Grass Energy; two cards leave the deck.
    const g = game();
    const { d: dg, card: cardG } = compiled([IDS.bugSet, IDS.bulbasaur, IDS.grass], 2);
    const grass = cardG(IDS.grass);
    const bulba = cardG(IDS.bulbasaur);
    const p = table(dg, mon(bulba), [cardG(IDS.bugSet)], [grass, grass, grass, grass, bulba, grass, grass, grass]);
    mainPhase(g, p, null);
    expect(p.discard).toContain(cardG(IDS.bugSet).i);
    expect(p.deck).toHaveLength(6);
    // Ethan's Adventure takes three in any combination: with one Ethan's Cyndaquil in the deck, the rest is Fire Energy.
    const fire = card(IDS.fire);
    const cynda = card(IDS.cyndaquil);
    const q = table(d, mon(cynda, [fire]), [card(IDS.ethan)], [fire, fire, fire, cynda, fire]);
    mainPhase(g, q, null);
    expect(q.discard).toContain(card(IDS.ethan).i);
    expect(q.deck).toHaveLength(2);
    expect([...q.hand, ...(q.bench[0] ? [q.bench[0].c.i] : [])].filter((i) => i === cynda.i)).toHaveLength(1);
  });

  it('reads a damage bonus for the turn and plays it when it makes a Knock Out, or in a solo game when the plan attacks', () => {
    const { d, card } = compiled([IDS.premium, IDS.blackBelt, IDS.gladion, IDS.kieran, IDS.riolu, IDS.charmander, IDS.fighting, IDS.fire], 2);
    expect(card(IDS.premium).fx).toMatchObject({ effects: [{ k: 'damageBoost', statics: [{ k: 'damage', n: 30, t: { type: 'F' } }] }], followed: true });
    expect(card(IDS.blackBelt).fx).toMatchObject({ effects: [{ k: 'damageBoost', statics: [{ k: 'damage', n: 40, vs: { suffix: 'ex' } }] }], followed: true });
    expect(card(IDS.gladion).fx).toMatchObject({ cond: { k: 'lastCardInHand' }, effects: [{ k: 'damageBoost', statics: [{ k: 'damage', n: 80, ruleBoxFree: true }] }], followed: true });
    expect(card(IDS.kieran).fx).toMatchObject({ effects: [{ k: 'choose', options: [[{ k: 'switch' }], [{ k: 'damageBoost', statics: [{ k: 'damage', n: 30, vs: { suffixAny: ['ex', 'V'] } }] }]] }], followed: true });
    const fighting = card(IDS.fighting);
    // A duel: Punch does 30; with Premium Power Pro 60, which Knocks Out a Charmander with 50 HP left.
    const g = game();
    const me = table(d, mon(card(IDS.riolu), [fighting, fighting]), [card(IDS.premium)], [fighting]);
    const them = table(d, mon(card(IDS.charmander)), [], [card(IDS.fire)]);
    them.active!.dmg = maxHp(them, them.active!) - 50;
    mainPhase(g, me, them);
    expect(me.discard).toContain(card(IDS.premium).i);
    expect(me.turnStatics).toHaveLength(1);
    expect(attack(g, me, them)).toBe(60);
    expect(them.active).toBeNull();
    // Without a Knock Out in it, the Item stays in hand; Black Belt's Training reaches only a Pokémon ex, so it stays too.
    const g2 = game();
    const me2 = table(d, mon(card(IDS.riolu), [fighting, fighting]), [card(IDS.premium), card(IDS.blackBelt)], [fighting]);
    const them2 = table(d, mon(card(IDS.charmander)), [], [card(IDS.fire)]);
    mainPhase(g2, me2, them2);
    expect(me2.hand).toContain(card(IDS.premium).i);
    expect(me2.hand).toContain(card(IDS.blackBelt).i);
    expect(attack(g2, me2, them2)).toBe(30);
    // Solo: in a deck whose plan is Riolu's Punch, the attacker is ready, so the bonus is played and the mirror takes 60.
    const g3 = game();
    const { d: d3, card: card3 } = compiled([IDS.premium, IDS.riolu, IDS.fighting], 2);
    const f3 = card3(IDS.fighting);
    const solo = table(d3, mon(card3(IDS.riolu), [f3, f3]), [card3(IDS.premium)], [f3]);
    mainPhase(g3, solo, null);
    expect(solo.discard).toContain(card3(IDS.premium).i);
    expect(attack(g3, solo, null)).toBe(60);
  });
});
