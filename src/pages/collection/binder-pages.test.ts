import { describe, expect, it } from 'vitest';
import { fixtureCatalog } from '@/scanner/fixtures.test-util';
import { pageLabel, pageOf, paginate, type Pocket } from './binder-pages';

describe('binder pages', () => {
  it('cuts a list into pages, the last one short, and keeps one empty page for nothing', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const pages = paginate(items, 9);
    expect(pages.map((p) => p.length)).toEqual([9, 9, 2]);
    expect(pages[2]).toEqual([18, 19]);
    expect(paginate(items, 12).map((p) => p.length)).toEqual([12, 8]);
    expect(paginate([], 9)).toEqual([[]]);
    expect(paginate(items, 0).length).toBe(20); // never fewer than one per page
  });

  it('finds the page of an item', () => {
    expect(pageOf(0, 9)).toBe(0);
    expect(pageOf(8, 9)).toBe(0);
    expect(pageOf(9, 9)).toBe(1);
    expect(pageOf(26, 12)).toBe(2);
    expect(pageOf(-3, 9)).toBe(0);
  });

  it('labels a page by its sets', () => {
    const pocket = (id: string): Pocket => {
      const card = fixtureCatalog.cards.find((c) => c.id === id)!;
      return { card, set: fixtureCatalog.sets.find((s) => s.id === card.set)! };
    };
    const a = pocket('sv01-057');
    const b = pocket('base1-4');
    expect(pageLabel([a, a])).toBe(a.set.name);
    expect(pageLabel([a, a, b])).toBe(`${a.set.name} → ${b.set.name}`);
    expect(pageLabel([])).toBe('Empty page');
  });
});
