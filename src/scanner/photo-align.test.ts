import { describe, expect, it } from 'vitest';
import { lumaImage, type HashWindow, type LumaImage } from './hash';
import { ALIGN_MIN, findGuide, judgePhoto, searchRegion } from './photo-align';
import type { Box } from './types';

/** A scene with structure everywhere: smooth blobs, so neighbouring positions differ and no two places look alike. */
function scene(x: number, y: number): number {
  return 128 + 60 * Math.sin(x * 0.045 + 1.3) * Math.cos(y * 0.031) + 40 * Math.sin((x + 2 * y) * 0.017) + 25 * Math.cos(x * 0.011 - y * 0.052);
}

/** A grey image of `scene` seen through the window at (ox, oy), `w`×`h` px, each pixel covering `scale` scene units. */
function view(ox: number, oy: number, w: number, h: number, scale = 1, gain = 1, lift = 0, paint: (x: number, y: number) => number = scene): LumaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = paint(ox + x * scale, oy + y * scale) * gain + lift;
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return lumaImage(data, w, h);
}

// The guide at the press: 180×250 scene units at (400, 300). The photo region around it: the guide plus a third each way.
const GUIDE = { x: 400, y: 300, w: 180, h: 250 };
const PAD = 0.32;
const REGION = { x: GUIDE.x - GUIDE.w * PAD, y: GUIDE.y - GUIDE.h * PAD, w: GUIDE.w * (1 + 2 * PAD), h: GUIDE.h * (1 + 2 * PAD) };
const NOMINAL: HashWindow = { x: PAD / (1 + 2 * PAD), y: PAD / (1 + 2 * PAD), w: 1 / (1 + 2 * PAD), h: 1 / (1 + 2 * PAD) };
const template = () => view(GUIDE.x, GUIDE.y, 180, 250);
/** The photo region when the camera moved by (mx, my) scene units between the press and the photo. */
const photo = (mx: number, my: number, gain = 1, lift = 0) => view(REGION.x + mx, REGION.y + my, Math.round(REGION.w), Math.round(REGION.h), 1, gain, lift);

describe('findGuide', () => {
  it('finds the guide where it is expected when nothing moved', () => {
    const s = findGuide(template(), photo(0, 0), NOMINAL);
    expect(s.dx).toBeCloseTo(0, 5);
    expect(s.dy).toBeCloseTo(0, 5);
    expect(s.score).toBeGreaterThan(0.98);
  });

  it('follows the card when the hand moved before the photo', () => {
    // The camera moved 36 units right and 25 down: the framed picture sits that much left and up in the photo.
    const s = findGuide(template(), photo(36, 25), NOMINAL);
    expect(s.dx).toBeCloseTo(-36 / GUIDE.w, 1);
    expect(s.dy).toBeCloseTo(-25 / GUIDE.h, 1);
    expect(s.score).toBeGreaterThan(0.9);
    const back = findGuide(template(), photo(-27, 40), NOMINAL);
    expect(back.dx).toBeCloseTo(27 / GUIDE.w, 1);
    expect(back.dy).toBeCloseTo(-40 / GUIDE.h, 1);
  });

  it('does not mind that the photo is brighter or darker than the preview', () => {
    const s = findGuide(template(), photo(18, -15, 1.5, 20), NOMINAL);
    expect(s.dx).toBeCloseTo(-18 / GUIDE.w, 1);
    expect(s.dy).toBeCloseTo(15 / GUIDE.h, 1);
    expect(s.score).toBeGreaterThan(0.9);
  });

  it('scores low when the photo shows something else', () => {
    // Another card on another table: stripes and a blob, nothing like the framed scene.
    const other = (x: number, y: number) => 120 + 70 * Math.sign(Math.sin(y * 0.09)) * Math.cos(x * 0.004) + 50 * Math.exp(-((x - 480) ** 2 + (y - 520) ** 2) / 9000);
    const elsewhere = view(REGION.x, REGION.y, Math.round(REGION.w), Math.round(REGION.h), 1, 1, 0, other);
    expect(findGuide(template(), elsewhere, NOMINAL).score).toBeLessThan(ALIGN_MIN);
  });

  it('finds nothing in a featureless picture, and does not wander off in one', () => {
    const flat = view(0, 0, Math.round(REGION.w), Math.round(REGION.h), 1, 1, 0, () => 120);
    const s = findGuide(view(0, 0, 180, 250, 1, 1, 0, () => 120), flat, NOMINAL);
    expect(s.score).toBeLessThan(ALIGN_MIN);
    expect(s.dx).toBeCloseTo(0, 5);
    expect(s.dy).toBeCloseTo(0, 5);
  });

  it('never looks outside the region it was given', () => {
    // The guide at the very corner of the region: only moves back into it are tried.
    const corner: HashWindow = { x: 0, y: 0, w: NOMINAL.w, h: NOMINAL.h };
    const s = findGuide(template(), photo(0, 0), corner);
    expect(s.dx).toBeGreaterThanOrEqual(0);
    expect(s.dy).toBeGreaterThanOrEqual(0);
  });
});

describe('searchRegion', () => {
  it('grows the guide by the reach and stays inside the frame', () => {
    const r = searchRegion({ x: 400, y: 300, w: 200, h: 280 }, { w: 2000, h: 1500 });
    expect(r.x).toBeCloseTo(400 - 200 * 0.32);
    expect(r.w).toBeCloseTo(200 * 1.64);
    expect(r.h).toBeCloseTo(280 * 1.64);
    const edge = searchRegion({ x: 10, y: 5, w: 200, h: 280 }, { w: 230, h: 300 });
    expect(edge).toEqual({ x: 0, y: 0, w: 230, h: 300 });
  });
});

describe('judgePhoto', () => {
  const guide: Box = { x: 1000, y: 800, w: 900, h: 1260 };
  const frame = { w: 3000, h: 4000 };

  it('uses the photo as it is when the view held still', () => {
    expect(judgePhoto({ dx: 0, dy: 0, score: 0.97 }, guide, frame)).toEqual({ use: 'photo', guide });
    expect(judgePhoto({ dx: 0.02, dy: -0.02, score: 0.9 }, guide, frame)).toEqual({ use: 'photo', guide });
  });

  it('moves the guide onto the card when the view shifted', () => {
    const v = judgePhoto({ dx: -0.2, dy: 0.1, score: 0.9 }, guide, frame);
    expect(v).toEqual({ use: 'photo-moved', guide: { x: 1000 - 180, y: 800 + 126, w: 900, h: 1260 } });
  });

  it('falls back to what was framed at the press when the photo lost the card', () => {
    expect(judgePhoto({ dx: 0, dy: 0, score: 0.2 }, guide, frame)).toEqual({ use: 'preview', why: 'not found' });
    // Found, but shifted so far that part of the card is outside the photo.
    const low: Box = { x: 1000, y: 2700, w: 900, h: 1260 };
    expect(judgePhoto({ dx: 0, dy: 0.3, score: 0.9 }, low, frame)).toEqual({ use: 'preview', why: 'cut off' });
    expect(judgePhoto({ dx: -0.3, dy: 0, score: 0.9 }, { x: 100, y: 800, w: 900, h: 1260 }, frame)).toEqual({ use: 'preview', why: 'cut off' });
  });
});
