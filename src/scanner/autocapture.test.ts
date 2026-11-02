import { describe, expect, it } from 'vitest';
import { AUTO_FITS, AUTO_IDLE, AUTO_MIN_CONFIDENCE, AUTO_TOLERANCE, PHOTO_SEARCH_PAD, autoReady, autoStep, searchRegion } from './autocapture';

const frac = (x: number, y = 0.1) => ({ x, y, w: 0.8, h: 0.6 });

describe('autoStep / autoReady', () => {
  it('becomes ready after AUTO_FITS confident fits that hold within tolerance', () => {
    let s = AUTO_IDLE;
    for (let i = 0; i < AUTO_FITS; i++) {
      expect(autoReady(s, true)).toBe(false);
      s = autoStep(s, { confidence: 0.7, frac: frac(0.1 + i * 0.005) });
    }
    expect(s.fits).toBe(AUTO_FITS);
    expect(autoReady(s, true)).toBe(true);
  });

  it('never fires while capture advice is pending', () => {
    let s = AUTO_IDLE;
    for (let i = 0; i < AUTO_FITS + 2; i++) s = autoStep(s, { confidence: 0.9, frac: frac(0.1) });
    expect(autoReady(s, false)).toBe(false);
    expect(autoReady(s, true)).toBe(true);
  });

  it('starts over when the fit moves, loses confidence or is missed', () => {
    let s = autoStep(AUTO_IDLE, { confidence: 0.8, frac: frac(0.1) });
    s = autoStep(s, { confidence: 0.8, frac: frac(0.1 + AUTO_TOLERANCE + 0.01) });
    expect(s.fits).toBe(1); // moved: a new run of one
    s = autoStep(s, { confidence: AUTO_MIN_CONFIDENCE - 0.01, frac: frac(0.1 + AUTO_TOLERANCE + 0.01) });
    expect(s).toEqual(AUTO_IDLE);
    s = autoStep(autoStep(AUTO_IDLE, { confidence: 0.8, frac: frac(0.2) }), null);
    expect(s).toEqual(AUTO_IDLE);
  });
});

describe('searchRegion', () => {
  it('grows the box by the pad on each side and clamps it to the frame', () => {
    const r = searchRegion({ x: 500, y: 400, w: 1000, h: 500 }, 4000, 3000);
    expect(r.x).toBeCloseTo(500 - 1000 * PHOTO_SEARCH_PAD);
    expect(r.y).toBeCloseTo(400 - 500 * PHOTO_SEARCH_PAD);
    expect(r.w).toBeCloseTo(1000 * (1 + 2 * PHOTO_SEARCH_PAD));
    expect(r.h).toBeCloseTo(500 * (1 + 2 * PHOTO_SEARCH_PAD));
    const edge = searchRegion({ x: 0, y: 0, w: 4000, h: 3000 }, 4000, 3000);
    expect(edge).toEqual({ x: 0, y: 0, w: 4000, h: 3000 });
    const corner = searchRegion({ x: 100, y: 200, w: 1000, h: 500 }, 4000, 3000);
    expect(corner.x).toBe(0);
    expect(corner.w).toBeCloseTo(100 + 1000 * (1 + PHOTO_SEARCH_PAD));
  });
});
