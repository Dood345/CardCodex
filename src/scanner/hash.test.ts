import { describe, expect, it } from 'vitest';
import {
  ART_WINDOW,
  CARD_WINDOW,
  COARSE_PROBES,
  FINE_PROBES,
  HASH_BITS,
  HASH_GRID,
  HASH_SPEC,
  HASH_WORDS,
  alignmentProbes,
  cellMeans,
  decodeHashFile,
  decodeHashes,
  dhashWords,
  encodeHashes,
  hammingDistance,
  hashCard,
  hashCardIn,
  hashDistances,
  hashTableFrom,
  hashToHex,
  hexToHash,
  lumaImage,
  lumaIntegral,
  matchPocket,
  nearestByHash,
  popcount32,
  subWindow,
  windowOf,
} from './hash';

/** Deterministic PRNG (mulberry32) so every seed gives an unrelated picture. */
function rng(seed: number): () => number {
  let a = (seed * 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A smooth, busy synthetic "card": per channel a sum of low-frequency sines
 * with seeded amplitudes, frequencies and phases, so every cell mean is
 * distinct, shifts perturb it gently and different seeds are unrelated.
 */
function synthetic(width: number, height: number, seed = 1, shiftX = 0, shiftY = 0): Uint8ClampedArray {
  const r = rng(seed);
  const terms = Array.from({ length: 3 }, () =>
    Array.from({ length: 6 }, () => ({ amp: 15 + 30 * r(), fx: 0.5 + 5 * r(), fy: 0.5 + 5 * r(), ph: 2 * Math.PI * r() })),
  );
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = (x + shiftX) / width;
      const v = (y + shiftY) / height;
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        let val = 128;
        for (const t of terms[c]) val += t.amp * Math.sin(2 * Math.PI * (t.fx * u + t.fy * v) + t.ph);
        data[i + c] = val;
      }
      data[i + 3] = 255;
    }
  }
  return data;
}

describe('lumaIntegral / cellMeans', () => {
  it('averages luma over whole-pixel cells and composites transparency over white', () => {
    // 4×2 image: left half black opaque, right half fully transparent (→ white).
    const w = 4;
    const h = 2;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const x = i % w;
      data[i * 4 + 3] = x < 2 ? 255 : 0;
    }
    const integral = lumaIntegral(data, w, h);
    const means = cellMeans(integral, w, h, CARD_WINDOW, 2, 1);
    expect(means[0]).toBeCloseTo(0, 6);
    expect(means[1]).toBeCloseTo(255, 6);
    // One cell over everything: half black, half white.
    expect(cellMeans(integral, w, h, CARD_WINDOW, 1, 1)[0]).toBeCloseTo(127.5, 6);
  });

  it('never produces an empty cell, even when the grid is finer than the pixels', () => {
    const data = synthetic(6, 5);
    const means = cellMeans(lumaIntegral(data, 6, 5), 6, 5, ART_WINDOW, HASH_GRID.cols, HASH_GRID.rows);
    expect(means.every((m) => Number.isFinite(m) && m >= 0 && m <= 255)).toBe(true);
  });
});

describe('dhashWords', () => {
  it('sets one bit per left<right comparison, most significant first', () => {
    const cols = 9;
    const rows = 8;
    const means = new Float64Array(cols * rows);
    // Row 0 strictly increasing → its 8 bits set; everything else decreasing → 0.
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) means[r * cols + c] = r === 0 ? c : cols - c;
    const [hi, lo] = dhashWords(means, cols, rows);
    expect(hi).toBe(0xff000000);
    expect(lo).toBe(0);
  });
});

describe('hashCard', () => {
  const W = 245;
  const H = 337;

  it('is deterministic, 128 bits, and round-trips through hex', () => {
    const img = synthetic(W, H);
    const a = hashCard(img, W, H);
    const b = hashCard(img, W, H);
    expect(a).toHaveLength(HASH_WORDS);
    expect(hammingDistance(a, b)).toBe(0);
    const hex = hashToHex(a);
    expect(hex).toMatch(/^[0-9a-f]{32}$/);
    expect(hashToHex(hexToHash(hex))).toBe(hex);
    expect(() => hexToHash('zz')).toThrow();
  });

  it('ignores brightness and contrast changes', () => {
    const img = synthetic(W, H);
    const dim = new Uint8ClampedArray(img.length);
    for (let i = 0; i < img.length; i += 4) {
      dim[i] = img[i] * 0.6 + 20;
      dim[i + 1] = img[i + 1] * 0.6 + 20;
      dim[i + 2] = img[i + 2] * 0.6 + 20;
      dim[i + 3] = 255;
    }
    expect(hammingDistance(hashCard(img, W, H), hashCard(dim, W, H))).toBeLessThanOrEqual(2);
  });

  it('is the same at a different resolution of the same picture', () => {
    const a = hashCard(synthetic(W, H), W, H);
    const b = hashCard(synthetic(2 * W, 2 * H), 2 * W, 2 * H);
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(4);
  });

  it('changes a few bits for a 1 % shift, more for 3 %, and about half for a different picture', () => {
    // Measured on reference card images in the browser: ~13 bits per 1 % of shift, 28–41 at 3 %, ~64 between unrelated cards.
    const base = hashCard(synthetic(W, H), W, H);
    const shift1 = hashCard(synthetic(W, H, 1, 0.01 * W, 0.01 * H), W, H);
    const shift3 = hashCard(synthetic(W, H, 1, 0.03 * W, 0.03 * H), W, H);
    const other = hashCard(synthetic(W, H, 5), W, H);
    const d1 = hammingDistance(base, shift1);
    const d3 = hammingDistance(base, shift3);
    const dOther = hammingDistance(base, other);
    expect(d1).toBeLessThanOrEqual(20);
    expect(d3).toBeGreaterThanOrEqual(d1);
    expect(dOther).toBeGreaterThan(d3 + 10);
    expect(dOther).toBeGreaterThanOrEqual(40);
  });
});

describe('popcount32 / hammingDistance', () => {
  it('counts bits', () => {
    expect(popcount32(0)).toBe(0);
    expect(popcount32(0xffffffff)).toBe(32);
    expect(popcount32(0x80000001)).toBe(2);
    expect(hammingDistance(new Uint32Array([0, 0, 0, 0]), new Uint32Array([0xffffffff, 0, 0, 1]))).toBe(33);
    expect(hammingDistance(new Uint32Array([1, 2, 3, 4, 5, 6, 7, 8]), new Uint32Array([5, 6, 7, 8]), 4, 0)).toBe(0);
  });
});

describe('table', () => {
  const ids = ['a-1', 'a-2', 'b-1'];
  const hashes = [hexToHash('00000000000000000000000000000000'), hexToHash('ffffffff000000000000000000000000'), hexToHash('0000000f000000000000000000000000')];
  const table = hashTableFrom(ids, hashes);

  it('encodes and decodes the words losslessly', () => {
    const words = new Uint32Array([0, 0xffffffff, 0x12345678, 0x80000000, 1, 2, 3, 4]);
    const b64 = encodeHashes(words);
    expect(decodeHashes(b64)).toEqual(words);
    const file = { version: 1, builtAt: '', game: 'pokemon', spec: HASH_SPEC, ids: ['x', 'y'], hashes: b64 };
    const t = decodeHashFile(file);
    expect(t.ids).toEqual(['x', 'y']);
    expect(t.indexOf.get('y')).toBe(1);
    expect(hashToHex(t.words, 4)).toBe('00000001000000020000000300000004');
    expect(() => decodeHashFile({ ...file, spec: 'other' })).toThrow(/spec/);
    expect(() => decodeHashFile({ ...file, ids: ['x'] })).toThrow(/words/);
  });

  it('ranks by Hamming distance, nearest first', () => {
    const probe = hexToHash('00000001000000000000000000000000');
    const hits = nearestByHash(table, probe, 2);
    expect(hits.map((h) => h.id)).toEqual(['a-1', 'b-1']);
    expect(hits.map((h) => h.distance)).toEqual([1, 3]);
    expect(nearestByHash(table, probe, 5)).toHaveLength(3);
    expect(nearestByHash(table, probe, 5, 2)).toHaveLength(1);
  });

  it('takes the best distance over several probes', () => {
    const probes = [hexToHash('ffffffff000000000000000000000000'), hexToHash('0000000f000000000000000000000000')];
    const d = hashDistances(table, probes);
    expect([...d]).toEqual([4, 0, 0]);
    expect(nearestByHash(table, probes, 1)[0].id).toBe('a-2');
    expect(hashDistances(table, []).every((v) => v === HASH_BITS)).toBe(true);
  });
});

describe('hashCardIn', () => {
  it('equals hashCard over the whole image and composes windows', () => {
    const W = 120;
    const H = 165;
    const img = synthetic(W, H, 3);
    const luma = lumaImage(img, W, H);
    expect(hashToHex(hashCardIn(luma))).toBe(hashToHex(hashCard(img, W, H)));
    expect(hashToHex(hashCardIn(luma, CARD_WINDOW))).toBe(hashToHex(hashCard(img, W, H)));
    expect(subWindow({ x: 0.5, y: 0.5, w: 0.5, h: 0.25 }, { x: 0.2, y: 0.4, w: 0.6, h: 0.5 })).toEqual({ x: 0.6, y: 0.6, w: 0.3, h: 0.125 });
    expect(windowOf({ x: 110, y: 220, w: 300, h: 420 }, { x: 100, y: 200, w: 320, h: 460 })).toEqual({ x: 10 / 320, y: 20 / 460, w: 300 / 320, h: 420 / 460 });
  });

  it('hashes a card pasted into a larger image the same as the card alone', () => {
    // A 100×140 card at (20, 30) inside a 140×200 white "pocket".
    const cw = 100;
    const ch = 140;
    const card = synthetic(cw, ch, 2);
    const W = 140;
    const H = 200;
    const page = new Uint8ClampedArray(W * H * 4).fill(255);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) for (let k = 0; k < 4; k++) page[((y + 30) * W + x + 20) * 4 + k] = card[(y * cw + x) * 4 + k];
    const inPage = hashCardIn(lumaImage(page, W, H), { x: 20 / W, y: 30 / H, w: cw / W, h: ch / H });
    expect(hammingDistance(inPage, hashCard(card, cw, ch))).toBe(0);
  });
});

describe('matchPocket', () => {
  // Reference "cards" at 245×337, and a page where card 3 sits in a pocket 2.5 % off and 4 % smaller than its cell.
  const RW = 245;
  const RH = 337;
  const ids = Array.from({ length: 12 }, (_, i) => `syn-${i}`);
  const table = hashTableFrom(
    ids,
    ids.map((_, i) => hashCard(synthetic(RW, RH, 10 + i), RW, RH)),
  );
  const cellW = 260;
  const cellH = 358;
  const pad = 0.06;
  const W = Math.round(cellW * (1 + 2 * pad));
  const H = Math.round(cellH * (1 + 2 * pad));
  const cardW = Math.round(cellW * 0.96);
  const cardH = Math.round(cellH * 0.96);
  const ox = Math.round(cellW * pad + (cellW - cardW) / 2 + 0.025 * cellW);
  const oy = Math.round(cellH * pad + (cellH - cardH) / 2 - 0.025 * cellH);
  const page = new Uint8ClampedArray(W * H * 4).fill(235);
  const card = synthetic(cardW, cardH, 13);
  for (let y = 0; y < cardH; y++) for (let x = 0; x < cardW; x++) for (let k = 0; k < 4; k++) page[((y + oy) * W + x + ox) * 4 + k] = card[(y * cardW + x) * 4 + k];
  const luma = lumaImage(page, W, H);
  const nominal = { x: pad / (1 + 2 * pad), y: pad / (1 + 2 * pad), w: 1 / (1 + 2 * pad), h: 1 / (1 + 2 * pad) };

  it('finds the card despite the offset, closer than the nominal cell does', () => {
    const atCell = hashDistances(table, hashCardIn(luma, nominal))[3];
    const m = matchPocket(table, luma, nominal, { k: 3 });
    expect(m.hits[0].id).toBe('syn-3');
    expect(m.hits[0].distance).toBeLessThan(atCell);
    expect(m.hits[0].distance).toBeLessThanOrEqual(12);
    expect(m.hits[1].distance - m.hits[0].distance).toBeGreaterThanOrEqual(10);
    expect(m.distances[3]).toBe(m.hits[0].distance);
    expect(m.hits).toHaveLength(3);
  });

  it('refines only the shortlist and ranks the rest by their coarse distance', () => {
    const m = matchPocket(table, luma, nominal, { shortlist: 1, k: 12 });
    const coarse = hashDistances(table, alignmentProbes(nominal, COARSE_PROBES).map((w) => hashCardIn(luma, w)));
    let refined = 0;
    for (let i = 0; i < ids.length; i++) {
      if (m.distances[i] < coarse[i]) refined++;
      else expect(m.distances[i]).toBe(coarse[i]);
    }
    expect(refined).toBeLessThanOrEqual(1);
    expect(m.hits).toHaveLength(1);
  });

  it('uses the documented probe grids', () => {
    expect(alignmentProbes({ x: 0, y: 0, w: 1, h: 1 }, COARSE_PROBES)).toHaveLength(75);
    expect(alignmentProbes({ x: 0, y: 0, w: 1, h: 1 }, FINE_PROBES)).toHaveLength(13 * 13 * 7);
  });
});

describe('alignmentProbes', () => {
  it('covers shifts and scales around the cell centre', () => {
    const cell = { x: 100, y: 200, w: 300, h: 420 };
    const probes = alignmentProbes(cell);
    expect(probes).toHaveLength(27);
    const centred = probes.find((p) => p.w === 300 && p.x === 100 && p.y === 200);
    expect(centred).toBeDefined();
    for (const p of probes) {
      expect(p.w / p.h).toBeCloseTo(300 / 420, 6);
      expect(Math.abs(p.x + p.w / 2 - 250)).toBeLessThanOrEqual(9 + 1e-9);
      expect(Math.abs(p.y + p.h / 2 - 410)).toBeLessThanOrEqual(12.6 + 1e-9);
    }
    expect(alignmentProbes(cell, { shifts: [0], scales: [1] })).toEqual([cell]);
  });
});

describe('reference image fixtures (sharp-decoded, the build script path)', () => {
  // Two TCGdex low-resolution images checked in under scripts/fixtures/cards/. The recorded hex is
  // what scripts/build-hashes.mjs wrote for them; hashing the same bytes here must reproduce it, and
  // the entry in public/data/hashes.json (when the table exists) must be the same hash.
  const FIXTURES: [string, string][] = [
    ['sv03.5-010', 'dcd8cf85d3cace66b98d9c8e8d8b0515'],
    ['base1-55', '7973697963574753f46165e46ce9e896'],
  ];

  it.each(FIXTURES)('%s hashes to its recorded value and matches the table', async (id, hex) => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sharp = (await import('sharp')).default;
    const root = path.resolve(__dirname, '..', '..');
    const file = path.join(root, 'scripts', 'fixtures', 'cards', `${id}.webp`);
    const { data, info } = await sharp(fs.readFileSync(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([245, 337]);
    const hash = hashCard(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
    expect(hashToHex(hash)).toBe(hex);
    const tablePath = path.join(root, 'public', 'data', 'hashes.json');
    if (fs.existsSync(tablePath)) {
      const table = decodeHashFile(JSON.parse(fs.readFileSync(tablePath, 'utf8')));
      const i = table.indexOf.get(id);
      if (i !== undefined) expect(hashToHex(table.words, i * HASH_WORDS)).toBe(hex);
    }
  });
});
