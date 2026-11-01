import { describe, expect, it } from 'vitest';
import { edgeProfiles, fit1D, fitGrid, fitSingleCard, pitchCandidates, type RgbaImage } from './grid';

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
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = x0 + c * (cardW + gap);
      const cy = y0 + r * (cardH + gap);
      const art: Rgb = [60 + rnd() * 120, 60 + rnd() * 120, 60 + rnd() * 120];
      for (let y = cy; y < cy + cardH; y++) {
        for (let x = cx; x < cx + cardW; x++) {
          const u = x - cx;
          const v = y - cy;
          const onBorder = u < bw || cardW - 1 - u < bw || v < bw || cardH - 1 - v < bw;
          // Art frame: dark outline at 10%..90% width, 15%..55% height.
          const inArt = u >= cardW * 0.1 && u <= cardW * 0.9 && v >= cardH * 0.15 && v <= cardH * 0.55;
          const onArtFrame = inArt && (u < cardW * 0.1 + 1.5 || u > cardW * 0.9 - 1.5 || v < cardH * 0.15 + 1.5 || v > cardH * 0.55 - 1.5);
          // Text box lines below the art.
          const textLine = v > cardH * 0.62 && v < cardH * 0.92 && Math.round(v) % 6 === 0 && u > cardW * 0.12 && u < cardW * 0.85;
          let col: Rgb;
          if (onBorder) col = border;
          else if (onArtFrame) col = [30, 30, 30];
          else if (inArt) col = [art[0] + ((Math.floor(u / 7) + Math.floor(v / 9)) % 2 ? 30 : -30), art[1], art[2]];
          else if (textLine) col = [50, 50, 50];
          else col = [235, 232, 210];
          put(x, y, col);
        }
      }
    }
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
