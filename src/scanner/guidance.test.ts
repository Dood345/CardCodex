import { describe, expect, it } from 'vitest';
import type { RgbaImage } from './grid';
import { ASPECT_TOLERANCE, MIN_CARD_PX, MIN_LUMA, MIN_SHARPNESS, PITCH_TOLERANCE, adviseCapture, sharpness, wantedCardPx, type GuidanceMetrics } from './guidance';

/** Grey image from a luma function. */
function grey(w: number, h: number, f: (x: number, y: number) => number): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, Math.round(f(x, y))));
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Box blur of radius r (grey images). */
function blur(img: RgbaImage, r: number): RgbaImage {
  const { width: w, height: h, data } = img;
  return grey(w, h, (x, y) => {
    let s = 0;
    let n = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const xx = Math.max(0, Math.min(w - 1, x + dx));
        const yy = Math.max(0, Math.min(h - 1, y + dy));
        s += data[(yy * w + xx) * 4];
        n++;
      }
    }
    return s / n;
  });
}

describe('sharpness', () => {
  // Text-like content: 2 px dark strokes every 9 px on a light ground, both ways.
  const text = grey(120, 60, (x, y) => (x % 9 < 2 || y % 9 < 2 ? 40 : 220));

  it('scores sharp edges high and drops as the image blurs', () => {
    const sharp = sharpness(text);
    expect(sharp.score).toBeGreaterThan(2.5);
    expect(sharp.edgeShare).toBeGreaterThan(0.1);
    expect(sharp.luma).toBeGreaterThan(120);
    const soft = sharpness(blur(text, 1));
    const softer = sharpness(blur(text, 2));
    expect(soft.score).toBeLessThan(sharp.score * 0.6);
    expect(softer.score).toBeLessThan(soft.score);
  });

  it('reports no edges on a flat image and the mean luma', () => {
    const flat = sharpness(grey(40, 40, () => 90));
    expect(flat.score).toBe(0);
    expect(flat.edgeShare).toBe(0);
    expect(flat.luma).toBeCloseTo(90);
  });

  it('is nearly independent of the image size and contrast', () => {
    const big = sharpness(grey(240, 120, (x, y) => (x % 9 < 2 || y % 9 < 2 ? 40 : 220)));
    const dim = sharpness(grey(120, 60, (x, y) => (x % 9 < 2 || y % 9 < 2 ? 80 : 160)));
    const ref = sharpness(text).score;
    expect(Math.abs(big.score - ref) / ref).toBeLessThan(0.1);
    expect(Math.abs(dim.score - ref) / ref).toBeLessThan(0.1);
  });
});

describe('wantedCardPx', () => {
  it('asks for MIN_CARD_PX on a still and when the view can give it, less when it cannot', () => {
    expect(wantedCardPx(1000, 3, 1, false)).toBe(MIN_CARD_PX);
    expect(wantedCardPx(1440, 3, 2.1, true)).toBe(MIN_CARD_PX); // 1440·2.1/3·0.85 = 857 > 500
    expect(wantedCardPx(1440, 3, 1, true)).toBeCloseTo((1440 / 3) * 0.85); // preview-only captures: 408
  });
});

describe('adviseCapture', () => {
  const good: GuidanceMetrics = {
    cardPx: 900,
    cardPxWanted: MIN_CARD_PX,
    aspectRatio: 1.02,
    colWidthRatio: 1.01,
    rowHeightRatio: 0.99,
    sharpness: 3,
    luma: 130,
  };

  it('says nothing when the shot should read', () => {
    expect(adviseCapture(good)).toBeNull();
    expect(adviseCapture({ ...good, colWidthRatio: null, rowHeightRatio: null, sharpness: null, luma: null })).toBeNull();
  });

  it('asks to move closer when the cards are too small, before anything else', () => {
    const a = adviseCapture({ ...good, cardPx: 380, aspectRatio: 1.2, luma: 20, sharpness: 0.1 });
    expect(a?.kind).toBe('closer');
    expect(a?.label).toBe('Move closer');
    expect(a?.detail).toContain('380');
    expect(adviseCapture({ ...good, cardPx: 380 }, false)?.detail).toContain('this photo');
  });

  it('asks to flatten the phone for a squashed grid or a keystone', () => {
    expect(adviseCapture({ ...good, aspectRatio: 1 + ASPECT_TOLERANCE + 0.01 })?.kind).toBe('flatten');
    expect(adviseCapture({ ...good, aspectRatio: 1 - ASPECT_TOLERANCE - 0.01 })?.kind).toBe('flatten');
    const bottom = adviseCapture({ ...good, rowHeightRatio: 1 + PITCH_TOLERANCE + 0.01 });
    expect(bottom?.kind).toBe('flatten');
    expect(bottom?.detail).toContain('bottom');
    const left = adviseCapture({ ...good, colWidthRatio: 1 - PITCH_TOLERANCE - 0.01 });
    expect(left?.kind).toBe('flatten');
    expect(left?.detail).toContain('left');
    expect(adviseCapture({ ...good, rowHeightRatio: 1 + PITCH_TOLERANCE - 0.01 })).toBeNull();
  });

  it('asks for light before stillness', () => {
    expect(adviseCapture({ ...good, luma: MIN_LUMA - 1, sharpness: 0.1 })?.kind).toBe('light');
    const still = adviseCapture({ ...good, sharpness: MIN_SHARPNESS - 0.1 });
    expect(still?.kind).toBe('still');
    expect(still?.label).toBe('Hold still');
    expect(adviseCapture({ ...good, sharpness: MIN_SHARPNESS - 0.1 }, false)?.detail).toContain('photo');
  });
});
