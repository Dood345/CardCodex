import { describe, expect, it } from 'vitest';
import { coverTransform, mapBox, orientLike, previewToPhoto } from './camera';
import { updateTracks, type Track } from './tracker';
import type { ScanCandidate } from './types';
import { fixtureCatalog } from './fixtures.test-util';

describe('coverTransform', () => {
  it('crops the sides of a landscape frame in a portrait element', () => {
    // 1280×720 frame in a 360×640 element: height-limited, scale 640/720.
    const t = coverTransform(1280, 720, 360, 640);
    expect(t.scale).toBeCloseTo(640 / 720);
    expect(t.offsetY).toBeCloseTo(0);
    expect(t.offsetX).toBeCloseTo((360 - 1280 * (640 / 720)) / 2); // ≈ -388.9
    // Frame centre maps to element centre.
    const c = mapBox({ x: 640, y: 360, w: 0, h: 0 }, t);
    expect(c.x).toBeCloseTo(180);
    expect(c.y).toBeCloseTo(320);
  });

  it('crops top/bottom of a frame wider-than-tall element', () => {
    const t = coverTransform(1280, 720, 1000, 300);
    expect(t.scale).toBeCloseTo(1000 / 1280);
    expect(t.offsetX).toBeCloseTo(0);
    expect(t.offsetY).toBeCloseTo((300 - 720 * (1000 / 1280)) / 2);
  });

  it('is identity for an exact fit and scales boxes', () => {
    expect(coverTransform(640, 480, 640, 480)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
    const t = coverTransform(640, 480, 1280, 960);
    expect(mapBox({ x: 10, y: 20, w: 30, h: 40 }, t)).toEqual({ x: 20, y: 40, w: 60, h: 80 });
  });

  it('survives an unknown frame size', () => {
    expect(coverTransform(0, 0, 100, 100)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });
});

describe('previewToPhoto', () => {
  it('is a pure scale when the preview and the photo have the same aspect', () => {
    // A 4:3 preview of a 4:3 sensor, both portrait: 1440×1920 → 3024×4032.
    const t = previewToPhoto({ w: 1440, h: 1920 }, { w: 3024, h: 4032 });
    expect(t.scale).toBeCloseTo(2.1);
    expect(t.offsetX).toBeCloseTo(0);
    expect(t.offsetY).toBeCloseTo(0);
    const b = mapBox({ x: 100, y: 200, w: 300, h: 400 }, t);
    expect(b.x).toBeCloseTo(210);
    expect(b.y).toBeCloseTo(420);
    expect(b.w).toBeCloseTo(630);
    expect(b.h).toBeCloseTo(840);
  });

  it('places a 16:9 preview as a centred band of the 4:3 photo (the long sides match)', () => {
    // Portrait 1080×1920 preview: the sensor's long side is fully used, the short side is cropped.
    const t = previewToPhoto({ w: 1080, h: 1920 }, { w: 3024, h: 4032 });
    expect(t.scale).toBeCloseTo(4032 / 1920);
    expect(t.offsetY).toBeCloseTo(0);
    expect(t.offsetX).toBeCloseTo((3024 - 1080 * (4032 / 1920)) / 2); // 378
    // The preview's centre is the photo's centre.
    const c = mapBox({ x: 540, y: 960, w: 0, h: 0 }, t);
    expect(c.x).toBeCloseTo(1512);
    expect(c.y).toBeCloseTo(2016);
  });

  it('places a preview wider than the photo as a centred horizontal band', () => {
    // Landscape 640×360 preview of a 1280×960 photo (the emulator's shapes).
    const t = previewToPhoto({ w: 640, h: 360 }, { w: 1280, h: 960 });
    expect(t.scale).toBeCloseTo(2);
    expect(t.offsetX).toBeCloseTo(0);
    expect(t.offsetY).toBeCloseTo((960 - 720) / 2);
  });

  it('is the identity for unknown sizes', () => {
    expect(previewToPhoto({ w: 0, h: 0 }, { w: 100, h: 100 })).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });
});

describe('orientLike', () => {
  it('swaps the sides of a landscape size to match a portrait one, and leaves matching or square sizes alone', () => {
    expect(orientLike({ w: 4032, h: 3024 }, { w: 1440, h: 1920 })).toEqual({ w: 3024, h: 4032 });
    expect(orientLike({ w: 3024, h: 4032 }, { w: 1440, h: 1920 })).toEqual({ w: 3024, h: 4032 });
    expect(orientLike({ w: 4032, h: 3024 }, { w: 1920, h: 1440 })).toEqual({ w: 4032, h: 3024 });
    expect(orientLike({ w: 1000, h: 1000 }, { w: 1440, h: 1920 })).toEqual({ w: 1000, h: 1000 });
    expect(orientLike({ w: 4032, h: 3024 }, { w: 500, h: 500 })).toEqual({ w: 4032, h: 3024 });
  });
});

describe('updateTracks', () => {
  const [base1] = fixtureCatalog.sets;
  const sv01 = fixtureCatalog.sets[1];
  const cand = (cardId: string, x: number, score: number): ScanCandidate => {
    const card = fixtureCatalog.cards.find((c) => c.id === cardId)!;
    const set = card.set === 'base1' ? base1 : sv01;
    const box = { x, y: 0, w: 300, h: 420 };
    return { key: cardId, card, set, score, margin: 0.2, confident: false, evidence: [], bbox: box, cardBox: box, alternatives: [] };
  };

  it('keeps a stable track id, holds for 2 s, and resists a one-frame flip', () => {
    let tracks: Track[] = [];
    tracks = updateTracks(tracks, [cand('sv01-057', 0, 0.9)], 0);
    const id = tracks[0].id;
    tracks = updateTracks(tracks, [cand('sv01-057', 10, 0.9)], 900);
    // One frame reads a different card at the same place: identity holds.
    tracks = updateTracks(tracks, [cand('base1-4', 12, 0.6)], 1800);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe(id);
    expect(tracks[0].shown.card.id).toBe('sv01-057');
    expect(tracks[0].shown.key).toBe(id);
    expect(tracks[0].shown.cardBox.x).toBe(12); // latest geometry
    expect(tracks[0].shown.alternatives[0].card.id).toBe('base1-4');
    // Not seen for > 2 s: dropped.
    expect(updateTracks(tracks, [], 1800 + 1999)).toHaveLength(1);
    expect(updateTracks(tracks, [], 1800 + 2001)).toHaveLength(0);
  });

  it('keeps the track id across slow (Tesseract-speed) frames when hold is stretched', () => {
    // useCardScanner passes hold = max(2000, 2.5 × avg recognition time).
    const hold = 2.5 * 2700;
    let tracks = updateTracks([], [cand('sv01-057', 0, 0.9)], 0, hold);
    const id = tracks[0].id;
    tracks = updateTracks(tracks, [cand('sv01-057', 5, 0.9)], 2700, hold);
    tracks = updateTracks(tracks, [cand('sv01-057', 9, 0.9)], 5400, hold);
    expect(tracks.map((t) => t.id)).toEqual([id]);
    // With the plain 2 s hold the same timing would lose the track.
    const t0 = updateTracks([], [cand('sv01-057', 0, 0.9)], 0, 2000);
    expect(updateTracks(t0, [cand('sv01-057', 5, 0.9)], 2700, 2000)[0].id).not.toBe(t0[0].id);
  });

  it('keeps two cards apart', () => {
    const tracks = updateTracks([], [cand('sv01-057', 0, 0.9), cand('base1-4', 400, 0.9)], 0);
    expect(tracks.map((t) => t.shown.card.id)).toEqual(['sv01-057', 'base1-4']);
  });

  it('builds stability while frames agree and does not flip when reads alternate', () => {
    let tracks = updateTracks([], [cand('sv01-057', 0, 0.6)], 0);
    expect(tracks[0].shown.stability).toBeLessThan(0.5); // ramps in
    tracks = updateTracks(tracks, [cand('sv01-057', 1, 0.6)], 500);
    tracks = updateTracks(tracks, [cand('sv01-057', 2, 0.6)], 1000);
    expect(tracks[0].shown.stability).toBeCloseTo(1, 5);
    expect(tracks[0].shown.confident).toBe(true); // pool agreement alone
    // The OCR now alternates between two cards of similar score.
    const shown: string[] = [];
    let t = 1500;
    for (let i = 0; i < 6; i++, t += 500) {
      tracks = updateTracks(tracks, [cand(i % 2 ? 'sv01-057' : 'base1-4', 3, 0.55)], t);
      shown.push(tracks[0].shown.card.id);
    }
    // At most one switch over six alternating frames, and both stay listed.
    const switches = shown.filter((id, i) => i > 0 && id !== shown[i - 1]).length;
    expect(switches).toBeLessThanOrEqual(1);
    expect(tracks[0].shown.stability!).toBeLessThan(0.75);
    expect(tracks[0].shown.alternatives.map((a) => a.card.id)).toContain(shown.at(-1) === 'sv01-057' ? 'base1-4' : 'sv01-057');
    expect(tracks[0].shown.confident).toBe(false);
  });

  it('switches once a challenger clearly leads the pool', () => {
    let tracks = updateTracks([], [cand('sv01-057', 0, 0.6)], 0);
    tracks = updateTracks(tracks, [cand('base1-4', 0, 0.6)], 500);
    expect(tracks[0].shown.card.id).toBe('sv01-057'); // hysteresis
    tracks = updateTracks(tracks, [cand('base1-4', 0, 0.6)], 1000);
    tracks = updateTracks(tracks, [cand('base1-4', 0, 0.6)], 1500);
    expect(tracks[0].shown.card.id).toBe('base1-4');
    expect(tracks[0].shown.key).toBe(tracks[0].id);
  });

  it('starts over at once when a confident read of an unrelated card takes the spot (card swapped)', () => {
    let tracks = updateTracks([], [cand('sv01-057', 0, 0.9)], 0);
    tracks = updateTracks(tracks, [cand('sv01-057', 0, 0.9)], 500);
    tracks = updateTracks(tracks, [cand('sv01-057', 0, 0.9)], 1000);
    const id = tracks[0].id;
    tracks = updateTracks(tracks, [{ ...cand('base1-4', 0, 0.85), confident: true }], 1500);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).not.toBe(id);
    expect(tracks[0].shown.card.id).toBe('base1-4');
  });

  it('lets a card that is always listed second accumulate pool weight', () => {
    const withAlt = (id: string, altId: string): ScanCandidate => {
      const c = cand(id, 0, 0.5);
      const alt = cand(altId, 0, 0.45);
      return { ...c, alternatives: [{ card: alt.card, set: alt.set, score: 0.45, evidence: ['name'] }] };
    };
    let tracks = updateTracks([], [withAlt('sv01-057', 'base1-4')], 0);
    tracks = updateTracks(tracks, [withAlt('sv01-057', 'base1-4')], 500);
    const alt = tracks[0].shown.alternatives.find((a) => a.card.id === 'base1-4');
    expect(alt).toBeDefined();
    expect(alt!.score).toBeGreaterThan(0.2); // its share of the pool
    expect(alt!.score).toBeLessThan(0.5);
  });
});
