import { describe, expect, it } from 'vitest';
import { fixtureCatalog } from '@/scanner/fixtures.test-util';
import { addToSession, aggregateLog, sessionTotal } from './session-list';

const card = (id: string) => {
  const c = fixtureCatalog.cards.find((x) => x.id === id)!;
  return { card: c, set: fixtureCatalog.sets.find((s) => s.id === c.set)! };
};

describe('addToSession', () => {
  it('aggregates copies per card, newest first, and drops a card taken back to zero', () => {
    const a = card('sv01-057');
    const b = card('base1-4');
    let list = addToSession([], a.card, a.set, 1, 1000);
    list = addToSession(list, b.card, b.set, 3, 2000);
    expect(list.map((e) => [e.card.id, e.qty])).toEqual([
      ['base1-4', 3],
      ['sv01-057', 1],
    ]);
    list = addToSession(list, a.card, a.set, 1, 3000);
    expect(list.map((e) => [e.card.id, e.qty, e.at])).toEqual([
      ['sv01-057', 2, 3000],
      ['base1-4', 3, 2000],
    ]);
    expect(sessionTotal(list)).toBe(5);
    // An undo keeps the row where it is in time and removes it at zero.
    list = addToSession(list, a.card, a.set, -1, 4000);
    expect(list[0]).toMatchObject({ qty: 1, at: 3000 });
    list = addToSession(list, a.card, a.set, -1, 5000);
    expect(list.map((e) => e.card.id)).toEqual(['base1-4']);
    expect(addToSession([], a.card, a.set, -1, 1)).toEqual([]);
  });
});

describe('aggregateLog', () => {
  it('folds the scan log into one row per card, newest first, counting adds and skipping unknown cards', () => {
    const lookup = (id: string) => (fixtureCatalog.cards.some((c) => c.id === id) ? card(id) : undefined);
    const rows = [
      { cardId: 'sv01-057', at: 500 },
      { cardId: 'gone-1', at: 450 },
      { cardId: 'base1-4', at: 400 },
      { cardId: 'sv01-057', at: 300 },
      { cardId: 'base1-4', at: 200 },
      { cardId: 'base1-4', at: 100 },
    ];
    expect(aggregateLog(rows, lookup).map((e) => [e.card.id, e.qty, e.at])).toEqual([
      ['sv01-057', 2, 500],
      ['base1-4', 3, 400],
    ]);
    expect(aggregateLog(rows, lookup, 1).map((e) => [e.card.id, e.qty])).toEqual([['sv01-057', 2]]);
  });
});
