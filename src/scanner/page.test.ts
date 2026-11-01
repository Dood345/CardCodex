import { describe, expect, it } from 'vitest';
import { PAGE_LAYOUTS, pageLayout, pageRect, pocketBoxes } from './page';

describe('pageRect', () => {
  it('keeps the page aspect and fits inside the frame minus the margin', () => {
    const layout = pageLayout('3x3');
    const r = pageRect(1000, 1400, layout);
    const aspect = (3 * 63) / (3 * 88);
    expect(r.w / r.h).toBeCloseTo(aspect, 3);
    expect(r.x).toBeGreaterThanOrEqual(30 - 1e-6);
    expect(r.y).toBeGreaterThanOrEqual(30 - 1e-6);
    expect(r.x + r.w).toBeLessThanOrEqual(1000 - 30 + 1e-6);
    expect(r.y + r.h).toBeLessThanOrEqual(1400 - 30 + 1e-6);
    // Centred.
    expect(r.x + r.w / 2).toBeCloseTo(500, 6);
    expect(r.y + r.h / 2).toBeCloseTo(700, 6);
  });

  it('is width-limited in a portrait frame and height-limited in a landscape one', () => {
    const layout = pageLayout('3x3');
    const portrait = pageRect(1000, 2000, layout);
    expect(portrait.w).toBeCloseTo(1000 - 60, 6);
    const landscape = pageRect(2000, 1000, layout);
    expect(landscape.h).toBeCloseTo(1000 - 60, 6);
  });
});

describe('pocketBoxes', () => {
  it('produces one cell per pocket in row-major order with card-shaped, non-overlapping boxes', () => {
    for (const layout of PAGE_LAYOUTS) {
      const pockets = pocketBoxes(1200, 1600, layout);
      expect(pockets).toHaveLength(layout.cols * layout.rows);
      pockets.forEach((p, i) => {
        expect(p.index).toBe(i);
        expect(p.row).toBe(Math.floor(i / layout.cols));
        expect(p.col).toBe(i % layout.cols);
        expect(p.box.w / p.box.h).toBeCloseTo(63 / 88, 3);
      });
      for (let a = 0; a < pockets.length; a++) {
        for (let b = a + 1; b < pockets.length; b++) {
          const A = pockets[a].box;
          const B = pockets[b].box;
          const overlap = A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it('applies the inset inside each cell', () => {
    const layout = pageLayout('2x2');
    const tight = pocketBoxes(1000, 1000, layout, { inset: 0 });
    const inset = pocketBoxes(1000, 1000, layout, { inset: 0.1 });
    expect(inset[0].box.w).toBeCloseTo(tight[0].box.w * 0.8, 6);
    expect(inset[0].box.x).toBeCloseTo(tight[0].box.x + tight[0].box.w * 0.1, 6);
  });

  it('falls back to 3x3 for unknown layout ids', () => {
    expect(pageLayout('nope').id).toBe('3x3');
  });
});
