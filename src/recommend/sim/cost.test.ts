/**
 * Attack costs and own-side effects: Energy discarded from the attacker or
 * any of the player's Pokémon, Energy put back into the hand or deck, damage
 * to itself and to its own Bench with the Knock Outs that follow, the
 * attacker returning to the hand, and optional costs paid for a bonus. Real
 * cards by catalog id; assertions on the shipped text.
 */
import { describe, expect, it } from 'vitest';
import { compileDeck, type SimCard } from './cards';
import { attack, newPlayer, type Game, type Mon, type Player } from './engine';
import { loadEvaluator } from './fixtures';
import { POKEMON_RULES_PAR_2023 } from './rules';

const { ev } = loadEvaluator();

const IDS = {
  bolt: 'svp-145', // Raging Bolt ex 240 HP: Bellowing Thunder LF 70×, discard any amount of Basic Energy from your Pokémon
  garchomp: 'svp-204', // Cynthia's Garchomp ex: Draconic Buster FF 260, discard all Energy
  cyndaquil: 'sv10-032', // Ethan's Cyndaquil: Ember R 30, discard an Energy
  oddish: 'me02.5-001', // Erika's Oddish 60 HP: Reckless Charge G 30, 10 damage to itself
  meowth: 'me03-062', // Meowth ex: Tuck Tail CCC 60, put this Pokémon and all attached cards into your hand
  chienpao: 'svp-152', // Chien-Pao: Icicle Loop WWC 120, put an Energy attached to this Pokémon into your hand
  ogerpon: 'sv06-064', // Wellspring Mask Ogerpon ex: Torrential Pump, you may shuffle 3 Energy into your deck; if you do, 120 to a Benched Pokémon
  manectric: 'me01-050', // Mega Manectric ex: Riotous Blasting LLL 200+, you may discard all Energy and do 130 more
  hariyama: 'me01-073', // Hariyama 150 HP: Wild Press FFF 210, 70 damage to itself
  heatran: 'sv06-123', // Heatran: Steel Burst MCC 50×, discard all Metal Energy, 50 for each card discarded
  greninja: 'mep-081', // Mega Greninja ex: Ninja Spinner WW 120+, you may put a Water Energy into your hand and do 80 more
  charizard: 'sv04.5-054', // Charizard ex, 330 HP
  charmander: 'sv04.5-007', // 70 HP
  fire: 'sve-002',
  water: 'sve-003',
  lightning: 'sve-004',
  fighting: 'sve-006',
  metal: 'sve-008',
};

function compiled(ids: string[]) {
  const d = compileDeck(ev, ids.map((cardId) => ({ cardId, qty: 1 })));
  return { d, card: (id: string): SimCard => d.cards.find((c) => c.card.id === id)! };
}
const game = (): Game => ({ rules: POKEMON_RULES_PAR_2023, stadium: null, winner: null, ending: '', guards: 0 });
const mon = (c: SimCard, energy: SimCard[] = [], dmg = 0): Mon => ({ c, under: [], energy, dmg, entered: 0, abilityTurn: -1, restTurn: 0, restAtk: '', movedTurn: 0 });
function seat(d: ReturnType<typeof compileDeck>, active: Mon | null, bench: Mon[] = []): Player {
  const p = newPlayer(d, 7, false, 6, 5);
  p.turn = 3;
  p.active = active;
  p.bench = bench;
  for (let k = 0; k < 6; k++) p.prizes.push(0);
  return p;
}

describe('reading attack costs', () => {
  const { card } = compiled(Object.values(IDS));
  const atk = (id: string, name: string) => card(id).attacks.find((a) => a.name === name)!;

  it('reads the wordings of real cards', () => {
    const bolt = atk(IDS.bolt, 'Bellowing Thunder').fx!;
    expect(bolt.effects).toEqual([{ k: 'discardAnyEnergy', type: undefined, basic: true, special: undefined }]);
    expect(bolt.mods).toEqual([{ k: 'times', n: 70, per: { k: 'discarded' } }]);
    expect(bolt.followed).toBe(true);
    expect(atk(IDS.garchomp, 'Draconic Buster').fx?.effects).toEqual([{ k: 'discardSelfEnergy', n: 99, all: true, type: undefined, basic: undefined, special: undefined, may: undefined }]);
    expect(atk(IDS.cyndaquil, 'Ember').fx?.effects).toMatchObject([{ k: 'discardSelfEnergy', n: 1 }]);
    expect(atk(IDS.oddish, 'Reckless Charge').fx?.effects).toEqual([{ k: 'selfDamage', n: 10 }]);
    expect(atk(IDS.meowth, 'Tuck Tail').fx?.effects).toEqual([{ k: 'selfToHand' }]);
    expect(atk(IDS.chienpao, 'Icicle Loop').fx?.effects).toMatchObject([{ k: 'energyToHand', n: 1 }]);
    const pump = atk(IDS.ogerpon, 'Torrential Pump').fx!;
    expect(pump.effects).toMatchObject([{ k: 'energyToDeck', n: 3, may: true }, { k: 'benchDamage', n: 120, how: 'one', ifPaid: true }]);
    expect(pump.sentences.map((s) => s.status)).toEqual(['read', 'read', 'noop']);
    const blast = atk(IDS.manectric, 'Riotous Blasting').fx!;
    expect(blast.effects).toMatchObject([{ k: 'discardSelfEnergy', all: true, may: true }]);
    expect(blast.mods).toEqual([{ k: 'bonus', n: 130, if: { k: 'paid' } }]);
    expect(blast.followed).toBe(true);
    const burst = atk(IDS.heatran, 'Steel Burst').fx!;
    expect(burst.effects).toMatchObject([{ k: 'discardSelfEnergy', all: true, type: 'M' }]);
    expect(burst.mods).toEqual([{ k: 'times', n: 50, per: { k: 'discarded' } }]);
    expect(atk(IDS.greninja, 'Ninja Spinner').fx).toMatchObject({ effects: [{ k: 'energyToHand', n: 1, type: 'W', may: true }], mods: [{ k: 'bonus', n: 80, if: { k: 'paid' } }], followed: true });
    for (const [id, name] of [[IDS.garchomp, 'Draconic Buster'], [IDS.cyndaquil, 'Ember'], [IDS.oddish, 'Reckless Charge'], [IDS.meowth, 'Tuck Tail'], [IDS.chienpao, 'Icicle Loop'], [IDS.hariyama, 'Wild Press'], [IDS.heatran, 'Steel Burst']]) {
      expect(atk(id, name).fx?.followed, `${id} ${name}`).toBe(true);
    }
  });

  it('expects the typical two cards discarded and half of an optional bonus', () => {
    expect(card(IDS.bolt).attacks.find((a) => a.name === 'Bellowing Thunder')?.expected).toBe(140);
    expect(card(IDS.manectric).attacks.find((a) => a.name === 'Riotous Blasting')?.expected).toBe(265);
  });
});

describe('paying attack costs in a game', () => {
  it('discards the Energy the text says and keeps attacking only when it can pay again', () => {
    const { d, card } = compiled([IDS.cyndaquil, IDS.garchomp, IDS.heatran, IDS.fire, IDS.fighting, IDS.metal]);
    const fire = card(IDS.fire);
    const g = game();
    const p = seat(d, mon(card(IDS.cyndaquil), [fire, fire]));
    expect(attack(g, p, null)).toBe(30);
    expect(p.active?.energy.length).toBe(1);
    expect(p.discard).toEqual([fire.i]);
    // Draconic Buster strips everything: the next turn has nothing to attack with.
    const fighting = card(IDS.fighting);
    const q = seat(d, mon(card(IDS.garchomp), [fighting, fighting]));
    expect(attack(g, q, null)).toBe(260);
    expect(q.active?.energy.length).toBe(0);
    q.turn = 4;
    expect(attack(g, q, null)).toBe(0);
    // Steel Burst discards its Metal Energy and hits for each: two Metal and a Fire give 100.
    const metal = card(IDS.metal);
    const r = seat(d, mon(card(IDS.heatran), [metal, metal, fire]));
    expect(attack(g, r, null)).toBe(100);
    expect(r.active?.energy).toEqual([fire]);
  });

  it('discards any amount for a Knock Out, from the Bench first, and everything when no Knock Out is in reach', () => {
    const { d, card } = compiled([IDS.bolt, IDS.charizard, IDS.charmander, IDS.fire, IDS.lightning, IDS.fighting]);
    const fire = card(IDS.fire);
    const g = game();
    // A duel: the Charizard ex across the table has 200 HP left, three Basic Energy do 210.
    const me = seat(d, mon(card(IDS.bolt), [card(IDS.lightning), card(IDS.fighting)]), [mon(card(IDS.charmander), [fire, fire, fire, fire])]);
    const them = seat(d, mon(card(IDS.charizard), [], 130));
    expect(attack(g, me, them)).toBe(210);
    expect(them.active).toBeNull();
    expect(me.bench[0].energy.length).toBe(1);
    expect(me.active?.energy.length).toBe(2);
    // Solo: the mirror has Raging Bolt's own 240 HP, four cards do 280: the Bench's three and one of its own.
    const solo = seat(d, mon(card(IDS.bolt), [card(IDS.lightning), card(IDS.fighting)]), [mon(card(IDS.charmander), [fire, fire, fire])]);
    expect(attack(g, solo, null)).toBe(280);
    expect(solo.bench[0].energy.length).toBe(0);
    expect(solo.active?.energy.length).toBe(1);
  });

  it('pays an optional cost for a Knock Out and otherwise keeps its Energy', () => {
    const { d, card } = compiled([IDS.manectric, IDS.charizard, IDS.charmander, IDS.lightning]);
    const l = card(IDS.lightning);
    const g = game();
    // Riotous Blasting: 200 does not Knock Out a 330 HP Charizard ex, 330 does.
    const me = seat(d, mon(card(IDS.manectric), [l, l, l]));
    const them = seat(d, mon(card(IDS.charizard)));
    expect(attack(g, me, them)).toBe(330);
    expect(me.active?.energy.length).toBe(0);
    expect(them.active).toBeNull();
    // Against a Charmander 200 already Knocks Out: the Energy stays.
    const me2 = seat(d, mon(card(IDS.manectric), [l, l, l]));
    const them2 = seat(d, mon(card(IDS.charmander)));
    expect(attack(g, me2, them2)).toBe(200);
    expect(me2.active?.energy.length).toBe(3);
  });

  it('damages itself, and is Knocked Out by its own attack when that is enough, giving up its Prize cards in a duel', () => {
    const { d, card } = compiled([IDS.oddish, IDS.hariyama, IDS.charmander, IDS.fire, IDS.fighting]);
    const grass = card(IDS.fire);
    const g = game();
    const p = seat(d, mon(card(IDS.oddish), [grass]), [mon(card(IDS.charmander))]);
    p.active!.energy = [card(IDS.fighting)];
    // Oddish attacks for Grass: give it a Grass-providing stand-in by paying with any Energy through a Colorless-like check.
    p.active = mon(card(IDS.hariyama), [card(IDS.fighting), card(IDS.fighting), card(IDS.fighting)]);
    expect(attack(g, p, null)).toBe(210);
    expect(p.active?.dmg).toBe(70);
    p.turn = 4;
    attack(g, p, null);
    p.turn = 5;
    attack(g, p, null);
    // 210 damage to itself over three turns: Knocked Out, the Charmander takes its place.
    expect(p.active?.c.name).toBe('Charmander');
    expect(p.discard).toContain(card(IDS.hariyama).i);
    // In a duel the opponent takes the Prize card.
    const me = seat(d, mon(card(IDS.hariyama), [card(IDS.fighting), card(IDS.fighting), card(IDS.fighting)], 140), [mon(card(IDS.charmander))]);
    const them = seat(d, mon(card(IDS.charmander), [], 0), [mon(card(IDS.charmander))]);
    attack(g, me, them);
    expect(them.taken).toBe(1);
    expect(me.active?.c.name).toBe('Charmander');
  });

  it('returns Meowth ex to the hand with everything attached, and only with a Benched Pokémon behind it', () => {
    const { d, card } = compiled([IDS.meowth, IDS.charmander, IDS.fire]);
    const fire = card(IDS.fire);
    const g = game();
    const p = seat(d, mon(card(IDS.meowth), [fire, fire, fire]), [mon(card(IDS.charmander))]);
    expect(attack(g, p, null)).toBe(60);
    expect(p.active?.c.name).toBe('Charmander');
    expect(p.hand.filter((i) => i === card(IDS.meowth).i).length).toBe(1);
    expect(p.hand.filter((i) => i === fire.i).length).toBe(3);
    // Alone on the table it keeps its seat: Tuck Tail is not used.
    const q = seat(d, mon(card(IDS.meowth), [fire, fire, fire]));
    attack(g, q, null);
    expect(q.active?.c.name).toBe('Meowth ex');
  });

  it('puts an Energy back into the hand', () => {
    const { d, card } = compiled([IDS.chienpao, IDS.water]);
    const w = card(IDS.water);
    const g = game();
    const p = seat(d, mon(card(IDS.chienpao), [w, w, w]));
    expect(attack(g, p, null)).toBe(120);
    expect(p.active?.energy.length).toBe(2);
    expect(p.hand).toEqual([w.i]);
  });
});
