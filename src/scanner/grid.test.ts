import { describe, expect, it } from 'vitest';
import { cropRgba, edgeProfiles, fit1D, fitGrid, fitSingleCard, perspectiveCheck, pitchCandidates, refineEdge, sizeTrend, type Fit1D, type RgbaImage } from './grid';

/** Deterministic noise. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

type Rgb = [number, number, number];

interface PageSpec {
  w: number;
  h: number;
  cols: number;
  rows: number;
  x0: number;
  y0: number;
  cardW: number;
  cardH: number;
  gap: number;
  /** Page/background colour and card border colour. */
  bg?: Rgb;
  border?: Rgb;
  noise?: number;
  /** Keystone: column c is scaled by 1 + keystoneX·(c − (cols−1)/2), row r by 1 + keystoneY·(r − (rows−1)/2) (pitch and card alike). */
  keystoneX?: number;
  keystoneY?: number;
}

/**
 * A synthetic binder page: bordered cards on a plain page. Each card has the
 * same inner structure (an art frame and a text box with dark outlines), as
 * real cards do, so the fitter has the same wrong answers available.
 */
function synthPage(spec: PageSpec): RgbaImage {
  const { w, h, cols, rows, x0, y0, cardW, cardH, gap } = spec;
  const bg = spec.bg ?? [40, 40, 40];
  const border = spec.border ?? [220, 200, 60];
  const noise = spec.noise ?? 8;
  const rnd = lcg(7);
  const data = new Uint8ClampedArray(w * h * 4);
  const put = (x: number, y: number, c: Rgb) => {
    const i = (y * w + x) * 4;
    data[i] = c[0] + (rnd() - 0.5) * noise;
    data[i + 1] = c[1] + (rnd() - 0.5) * noise;
    data[i + 2] = c[2] + (rnd() - 0.5) * noise;
    data[i + 3] = 255;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, bg);
  const bw = Math.max(2, Math.round(cardW * 0.05)); // border width
  const kx = spec.keystoneX ?? 0;
  const ky = spec.keystoneY ?? 0;
  let cy = y0;
  for (let r = 0; r < rows; r++) {
    const sy = 1 + ky * (r - (rows - 1) / 2);
    const ch = Math.round(cardH * sy);
    let cx = x0;
    for (let c = 0; c < cols; c++) {
      const sx = 1 + kx * (c - (cols - 1) / 2);
      const cw = Math.round(cardW * sx);
      const art: Rgb = [60 + rnd() * 120, 60 + rnd() * 120, 60 + rnd() * 120];
      for (let y = cy; y < cy + ch; y++) {
        for (let x = cx; x < cx + cw; x++) {
          const u = x - cx;
          const v = y - cy;
          const onBorder = u < bw || cw - 1 - u < bw || v < bw || ch - 1 - v < bw;
          // Art frame: dark outline at 10%..90% width, 15%..55% height.
          const inArt = u >= cw * 0.1 && u <= cw * 0.9 && v >= ch * 0.15 && v <= ch * 0.55;
          const onArtFrame = inArt && (u < cw * 0.1 + 1.5 || u > cw * 0.9 - 1.5 || v < ch * 0.15 + 1.5 || v > ch * 0.55 - 1.5);
          // Text box lines below the art.
          const textLine = v > ch * 0.62 && v < ch * 0.92 && Math.round(v) % 6 === 0 && u > cw * 0.12 && u < cw * 0.85;
          let col: Rgb;
          if (onBorder) col = border;
          else if (onArtFrame) col = [30, 30, 30];
          else if (inArt) col = [art[0] + ((Math.floor(u / 7) + Math.floor(v / 9)) % 2 ? 30 : -30), art[1], art[2]];
          else if (textLine) col = [50, 50, 50];
          else col = [235, 232, 210];
          if (x >= 0 && x < w && y >= 0 && y < h) put(x, y, col);
        }
      }
      cx += cw + Math.round(gap * sx);
    }
    cy += ch + Math.round(gap * sy);
  }
  return { width: w, height: h, data };
}

const PAGE_3x3: PageSpec = { w: 320, h: 430, cols: 3, rows: 3, x0: 30, y0: 40, cardW: 84, cardH: 118, gap: 6 };

describe('edgeProfiles', () => {
  it('peaks at the card edges', () => {
    const p = edgeProfiles(synthPage(PAGE_3x3));
    const at = (x: number) => Math.max(p.cols.abs[x - 1], p.cols.abs[x], p.cols.abs[x + 1]);
    // Left edge of the first column and right edge of the last (x = 30 + 2*90 + 84 = 294).
    expect(at(30)).toBeGreaterThan(3);
    expect(at(294)).toBeGreaterThan(3);
    // The plain part of a border, away from any edge.
    expect(p.cols.abs[62]).toBeLessThan(at(30) / 2);
  });
});

describe('pitchCandidates', () => {
  it('puts the card pitch first', () => {
    const p = edgeProfiles(synthPage(PAGE_3x3));
    const c = pitchCandidates(p.cols.abs, 3);
    expect(Math.abs(c[0] - 90)).toBeLessThanOrEqual(1);
    const r = pitchCandidates(p.rows.abs, 3);
    expect(Math.abs(r[0] - 124)).toBeLessThanOrEqual(1);
  });
});

describe('fit1D', () => {
  it('recovers start, size and gap of three equal items at a given pitch', () => {
    const p = edgeProfiles(synthPage(PAGE_3x3));
    const f = fit1D(p.cols, 3, 90);
    expect(f).not.toBeNull();
    expect(Math.abs(f!.start - 30)).toBeLessThanOrEqual(1);
    expect(Math.abs(f!.size - 84)).toBeLessThanOrEqual(2);
    expect(Math.abs(f!.gap - 6)).toBeLessThanOrEqual(2);
    expect(f!.confidence).toBeGreaterThan(0.5);
  });
});

describe('fitGrid', () => {
  const near = (fit: ReturnType<typeof fitGrid>, x: number, y: number, w: number, h: number, tol = 3) => {
    expect(fit).not.toBeNull();
    expect(Math.abs(fit!.box.x - x)).toBeLessThanOrEqual(tol);
    expect(Math.abs(fit!.box.y - y)).toBeLessThanOrEqual(tol);
    expect(Math.abs(fit!.box.w - w)).toBeLessThanOrEqual(tol);
    expect(Math.abs(fit!.box.h - h)).toBeLessThanOrEqual(tol);
  };

  it('finds a 3×3 page of yellow-bordered cards on a dark page', () => {
    const fit = fitGrid(synthPage(PAGE_3x3), { cols: 3, rows: 3 });
    near(fit, 30, 40, 264, 366);
    expect(fit!.confidence).toBeGreaterThan(0.5);
  });

  it('finds yellow-bordered cards on a white page (weak in luminance, strong in blue)', () => {
    const fit = fitGrid(synthPage({ ...PAGE_3x3, bg: [238, 238, 236] }), { cols: 3, rows: 3 });
    near(fit, 30, 40, 264, 366);
  });

  it('finds dark-bordered cards on a light page (inverted sign)', () => {
    const fit = fitGrid(synthPage({ ...PAGE_3x3, bg: [220, 220, 220], border: [30, 25, 20] }), { cols: 3, rows: 3 });
    near(fit, 30, 40, 264, 366);
    expect(fit!.cols.sign).toBe(-1);
  });

  it('handles an off-centre page and other layouts', () => {
    const spec: PageSpec = { w: 320, h: 320, cols: 2, rows: 2, x0: 90, y0: 20, cardW: 80, cardH: 112, gap: 10 };
    near(fitGrid(synthPage(spec), { cols: 2, rows: 2 }), 90, 20, 170, 234);
  });

  it('returns null for a page with no cards', () => {
    const rnd = lcg(3);
    const data = new Uint8ClampedArray(320 * 430 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = data[i + 1] = data[i + 2] = 90 + (rnd() - 0.5) * 40;
      data[i + 3] = 255;
    }
    expect(fitGrid({ width: 320, height: 430, data }, { cols: 3, rows: 3 })).toBeNull();
  });

  it('rejects a fit whose columns and rows disagree with the card aspect', () => {
    // Vertical stripes only: strong column edges, no row structure.
    const w = 320;
    const h = 430;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = Math.floor(x / 55) % 2 ? 200 : 40;
        data[i + 3] = 255;
      }
    }
    expect(fitGrid({ width: w, height: h, data }, { cols: 3, rows: 3 })).toBeNull();
  });
});

describe('cropRgba', () => {
  it('copies the box, clamped to the image', () => {
    const img = synthPage({ ...PAGE_3x3, w: 40, h: 30, cols: 1, rows: 1, x0: 5, y0: 5, cardW: 20, cardH: 20 });
    const crop = cropRgba(img, { x: 10.4, y: 20, w: 100, h: 100 });
    expect(crop.width).toBe(30);
    expect(crop.height).toBe(10);
    // Pixel (12, 22) of the image is (2, 2) of the crop.
    const i = (22 * 40 + 12) * 4;
    const j = (2 * 30 + 2) * 4;
    expect([...crop.data.subarray(j, j + 4)]).toEqual([...img.data.subarray(i, i + 4)]);
    expect(cropRgba(img, { x: 50, y: 0, w: 10, h: 10 }).width).toBe(0);
  });
});

describe('refineEdge', () => {
  const profile = (peaks: Record<number, number>, length = 60): Float32Array => {
    const p = new Float32Array(length).fill(0.6);
    for (const [x, v] of Object.entries(peaks)) p[Number(x)] = v;
    return p;
  };

  it('takes the significant peak nearest to the prediction, not the strongest in the window', () => {
    // A pocket seam (5) sits 4 px outside the card edge (3); the prediction is 1 px off the edge.
    expect(refineEdge(profile({ 20: 3, 16: 5 }), 21, 6)).toBeCloseTo(20, 1);
    // Without a nearer peak the seam is taken.
    expect(refineEdge(profile({ 16: 5 }), 19, 6)).toBeCloseTo(16, 1);
  });

  it('interpolates to a fraction of a pixel and ignores peaks below the average level', () => {
    // Peak values 2, 4, 3 at 29, 30, 31: the vertex lies to the right of 30.
    const r = refineEdge(profile({ 29: 2, 30: 4, 31: 3 }), 30, 3);
    expect(r).toBeGreaterThan(30);
    expect(r).toBeLessThan(30.5);
    expect(refineEdge(profile({ 30: 0.9 }), 30, 3)).toBe(30); // nothing significant: the prediction stands
    expect(refineEdge(profile({ 30: 3 }), 40, 3)).toBe(40); // outside the window
  });
});

describe('sizeTrend', () => {
  const fit = (start: number, size: number, gap: number): Fit1D => ({ start, size, gap, score: 1, sign: 1, confidence: 1, parts: { edges: 1, fill: 1, gap: 0 } });

  it('reads the ratio of the last item to the first from the refined edges', () => {
    // Three items whose widths grow 80, 84, 88 at a pitch of 90 (fit assumes 84 everywhere).
    const p = new Float32Array(320).fill(0.5);
    const edges = [10, 89, 100, 183, 190, 277];
    for (const x of edges) p[x] = 4;
    const r = sizeTrend(p, fit(10, 84, 6), 3)!;
    expect(r).toBeCloseTo(88 / 80, 1);
    expect(sizeTrend(p, fit(10, 84, 6), 1)).toBeNull();
  });
});

describe('perspectiveCheck', () => {
  it('reads ~1 on a flat page and the keystone on a tilted one', () => {
    const flat = synthPage(PAGE_3x3);
    const f = fitGrid(flat, { cols: 3, rows: 3 })!;
    const p = perspectiveCheck(flat, f, { cols: 3, rows: 3 });
    expect(Math.abs(p.colWidthRatio! - 1)).toBeLessThan(0.03);
    expect(Math.abs(p.rowHeightRatio! - 1)).toBeLessThan(0.03);

    // Right side nearer the camera: columns 4% wider per step (last/first = 87/81 = 1.074). Pocket
    // gaps of 10 px keep the fit's items the cards rather than the pitch (a 6 px gap is absorbed).
    // The detector is conservative (the fit's prior absorbs part of the keystone; the nearest
    // peak to a prediction is sometimes the inner edge of the border): it reads about a third of
    // it, in the right direction, and nothing on the untilted axis.
    const tilted = synthPage({ ...PAGE_3x3, x0: 14, gap: 10, keystoneX: 0.04 });
    const ft = fitGrid(tilted, { cols: 3, rows: 3 })!;
    expect(ft).not.toBeNull();
    const pt = perspectiveCheck(tilted, ft, { cols: 3, rows: 3 });
    expect(pt.colWidthRatio!).toBeGreaterThan(1.015);
    expect(Math.abs(pt.rowHeightRatio! - 1)).toBeLessThan(0.03);
  });
});

describe('fitSingleCard', () => {
  it('tightens a padded pocket crop to the card inside it', () => {
    // One card of 176×246 inside a 200×270 crop: a cell plus 6% margin, with the grid a little off.
    const img = synthPage({ w: 200, h: 270, cols: 1, rows: 1, x0: 15, y0: 10, cardW: 176, cardH: 246, gap: 0 });
    const fit = fitSingleCard(img);
    expect(fit).not.toBeNull();
    expect(Math.abs(fit!.x - 15)).toBeLessThanOrEqual(2);
    expect(Math.abs(fit!.y - 10)).toBeLessThanOrEqual(2);
    expect(Math.abs(fit!.w - 176)).toBeLessThanOrEqual(3);
    expect(Math.abs(fit!.h - 246)).toBeLessThanOrEqual(3);
  });

  it('declines when there is no card', () => {
    const rnd = lcg(5);
    const data = new Uint8ClampedArray(200 * 270 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = data[i + 1] = data[i + 2] = 120 + (rnd() - 0.5) * 30;
      data[i + 3] = 255;
    }
    expect(fitSingleCard({ width: 200, height: 270, data })).toBeNull();
  });
});
