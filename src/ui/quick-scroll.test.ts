import { describe, expect, it } from 'vitest';
import { fractionOf, hundredOf, initialOf, labelStride, positionAt, sectionsBy, type Section } from './quick-scroll';

describe('sections', () => {
  it('groups consecutive items by label and reads initials and hundreds', () => {
    expect(sectionsBy(['Abyss', 'Aqua', 'Blue-Eyes', '@Ignister', 'Zoodiac'], initialOf)).toEqual([
      { label: 'A', start: 0 },
      { label: 'B', start: 2 },
      { label: '#', start: 3 },
      { label: 'Z', start: 4 },
    ]);
    expect(initialOf('Élan')).toBe('E');
    expect(initialOf('6 Samurai')).toBe('#');
    expect(initialOf('')).toBe('#');
    expect([1, 99, 100, 151, 1000, 1025].map(hundredOf)).toEqual(['1', '1', '100', '100', '1000', '1000']);
  });
});

describe('zone mapping', () => {
  // 100 items: A has 60, B 10, C 30. Each section gets a third of the zone.
  const sections: Section[] = [
    { label: 'A', start: 0 },
    { label: 'B', start: 60 },
    { label: 'C', start: 70 },
  ];

  it('divides the zone equally between sections and the list proportionally without them', () => {
    expect(positionAt(0, 100, sections)).toBe(0);
    expect(positionAt(1 / 3, 100, sections)).toBeCloseTo(60);
    expect(positionAt(0.5, 100, sections)).toBeCloseTo(65);
    expect(positionAt(2 / 3, 100, sections)).toBeCloseTo(70);
    expect(positionAt(1, 100, sections)).toBeLessThan(100);
    expect(positionAt(0.5, 100, [])).toBe(50);
    expect(positionAt(0.5, 100, [{ label: 'A', start: 0 }])).toBe(50);
    expect(positionAt(-1, 100, sections)).toBe(0);
    expect(positionAt(0.5, 0, sections)).toBe(0);
  });

  it('inverts: an item maps back to the point that reaches it', () => {
    for (const index of [0, 1, 30, 59, 60, 65, 69, 70, 85, 99]) {
      const f = fractionOf(index, 100, sections);
      expect(Math.floor(positionAt(f, 100, sections) + 1e-6)).toBe(index);
    }
    expect(fractionOf(60, 100, sections)).toBeCloseTo(1 / 3);
    expect(fractionOf(25, 100, [])).toBe(0.25);
    expect(fractionOf(99, 100, sections)).toBeLessThan(1);
  });

  it('thins labels when the zone is too short for all of them', () => {
    expect(labelStride(26, 600, 13)).toBe(1);
    expect(labelStride(26, 300, 13)).toBe(2);
    expect(labelStride(26, 100, 13)).toBe(4);
    expect(labelStride(0, 100, 13)).toBe(1);
  });
});
