/**
 * Basic Energy cards that print no name, on a real photo: the unnumbered
 * 2020 Darkness Energy in scripts/fixtures/cards (the card that was not
 * identified), against the shipped artwork hashes and Energy colours.
 */
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Catalog, CatalogCard, CatalogSet } from '@/data/types';
import { isBasicEnergy } from '@/games/deck-rules';
import type { RgbaImage } from './grid';
import { decodeHashFile, type HashFile } from './hash';
import {
  acceptEnergy,
  bareEnergyHeader,
  BASIC_ENERGY,
  energyBoxFromHeader,
  energyReferences,
  scanBareEnergy,
  withBareEnergy,
  type EnergyMatch,
  type EnergyRefFile,
  type EnergyReferences,
} from './energy';
import { chromaticity, correlation, ENERGY_THUMB, normalizeCells } from './energy-features';
import type { Box, RecognizedLine, ScanCandidate } from './types';

const root = new URL('../../', import.meta.url);
const json = <T,>(f: string): T => JSON.parse(readFileSync(new URL(f, root), 'utf8')) as T;
const catalog = json<Catalog>('public/data/catalog.json');
const cards = new Map(catalog.cards.map((c) => [c.id, c]));
const sets = new Map(catalog.sets.map((s) => [s.id, s]));
const lookup = (id: string): { card: CatalogCard; set: CatalogSet } | undefined => {
  const card = cards.get(id);
  const set = card && sets.get(card.set);
  return card && set ? { card, set } : undefined;
};
const file = json<EnergyRefFile>('public/data/energy-refs.json');
const refs: EnergyReferences = energyReferences(decodeHashFile(json<HashFile>('public/data/hashes.json')), file)!;

const line = (text: string, bbox: Box): RecognizedLine => ({ text, bbox, confidence: 0.9 });

// The photo (720×959): the card spans about x 160–563, y 220–783; "ENERGY" sits at x 165–290, y 233–247.
const CARD: Box = { x: 160, y: 220, w: 403, h: 563 };
const HEADER = line('ENERGY', { x: 165, y: 233, w: 125, h: 14 });
const COPYRIGHT = line('©2020 Pokémon / Nintendo / Creatures / GAME FREAK', { x: 280, y: 902, w: 170, h: 8 });
let photo: RgbaImage;
/** `region` of an RGBA image resampled 272 px wide (area average), as the app's canvas sampler does. */
function sampler(img: RgbaImage, tint: [number, number, number] = [1, 1, 1]) {
  return (region: Box): RgbaImage => {
    const width = 272;
    const height = Math.max(1, Math.round((width * region.h) / region.w));
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sx0 = Math.floor(region.x + (x / width) * region.w);
        const sx1 = Math.max(sx0 + 1, Math.floor(region.x + ((x + 1) / width) * region.w));
        const sy0 = Math.floor(region.y + (y / height) * region.h);
        const sy1 = Math.max(sy0 + 1, Math.floor(region.y + ((y + 1) / height) * region.h));
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let sy = sy0; sy < sy1; sy++) {
          for (let sx = sx0; sx < sx1; sx++) {
            if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
            const i = (sy * img.width + sx) * 4;
            r += img.data[i];
            g += img.data[i + 1];
            b += img.data[i + 2];
            n++;
          }
        }
        const o = (y * width + x) * 4;
        data[o] = n ? (r / n) * tint[0] : 255;
        data[o + 1] = n ? (g / n) * tint[1] : 255;
        data[o + 2] = n ? (b / n) * tint[2] : 255;
        data[o + 3] = 255;
      }
    }
    return { width, height, data };
  };
}

beforeAll(async () => {
  const { data, info } = await sharp(readFileSync(new URL('scripts/fixtures/cards/darkness-energy-2020-photo.jpg', root))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  photo = { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) };
});

describe('the header of a card that prints only "ENERGY"', () => {
  const b = { x: 0, y: 0, w: 10, h: 4 };
  it('is recognised alone, with "Basic" before it or a stray character the symbol was read as', () => {
    expect(bareEnergyHeader([line('ENERGY', b)])?.text).toBe('ENERGY');
    expect(bareEnergyHeader([line('Energy', b)])).not.toBeNull();
    expect(bareEnergyHeader([line('ENERGY @', b)])).not.toBeNull();
    expect(bareEnergyHeader([line('Basic Energy', b)])).not.toBeNull();
    expect(bareEnergyHeader([line('E N E R G Y', b)])).not.toBeNull();
  });

  it('is not a card that names its Energy, nor a line that merely mentions Energy', () => {
    expect(bareEnergyHeader([line('ENERGY', b), line('Darkness Energy', b)])).toBeNull();
    expect(bareEnergyHeader([line('Basic Fire Energy', b)])).toBeNull();
    expect(bareEnergyHeader([line('Attach a Basic Energy card from your hand', b)])).toBeNull();
    expect(bareEnergyHeader([line('Special Energy', b)])).toBeNull();
    expect(bareEnergyHeader([line('Phantump', b), line('Seed Bomb 20', b)])).toBeNull();
    expect(bareEnergyHeader([])).toBeNull();
  });

  it('places the card from the header within a few per cent', () => {
    const box = energyBoxFromHeader(HEADER.bbox);
    expect(Math.abs(box.x - CARD.x) / CARD.w).toBeLessThan(0.06);
    expect(Math.abs(box.y - CARD.y) / CARD.h).toBeLessThan(0.06);
    expect(Math.abs(box.w - CARD.w) / CARD.w).toBeLessThan(0.08);
    expect(box.w / box.h).toBeCloseTo(63 / 88, 5);
  });
});

describe('Energy references', () => {
  it('cover the basic Energy printings that have a hash, in the same order as their table', () => {
    expect(file.game).toBe('pokemon');
    expect(file.thumb).toBe(ENERGY_THUMB);
    expect(file.rgb.length).toBe(file.ids.length * 3);
    expect(refs.table.ids).toEqual(file.ids);
    expect(refs.chroma.length).toBe(refs.table.ids.length * 3);
    expect(refs.cells).toBe(ENERGY_THUMB * ENERGY_THUMB);
    expect(refs.symbols.length).toBe(refs.table.ids.length * refs.cells);
    const types = new Set(refs.table.ids.map((id) => BASIC_ENERGY.exec(cards.get(id)!.name)?.[1]));
    expect([...types].sort()).toEqual(['Darkness', 'Fairy', 'Fighting', 'Fire', 'Grass', 'Lightning', 'Metal', 'Psychic', 'Water']);
    for (const id of file.ids) expect(BASIC_ENERGY.test(cards.get(id)?.name ?? ''), id).toBe(true);
  });

  it('hold basic Energy only: the older Special "Darkness Energy" and "Metal Energy" print their name and are never offered', () => {
    for (const id of file.ids) expect(isBasicEnergy(cards.get(id)!), id).toBe(true);
    for (const special of ['neo1-104', 'hgss3-79', 'col1-86', 'dp5-95']) expect(file.ids, special).not.toContain(special);
    expect(file.ids).toContain('swsh12.5-158');
  });

  it('are refused when the file does not fit the code that reads it', () => {
    const table = decodeHashFile(json<HashFile>('public/data/hashes.json'));
    expect(energyReferences(table, { ...file, thumb: 16 })).toBeNull();
    expect(energyReferences(table, { ...file, rgb: file.rgb.slice(3) })).toBeNull();
    expect(energyReferences(table, { ...file, ids: [] , rgb: [], symbols: '' })).toBeNull();
  });

  it('tell the types of one design apart by their symbols', () => {
    // The Crown Zenith basic Energy share the design of the unnumbered Sword & Shield ones.
    const ids = ['152', '153', '154', '155', '156', '157', '158', '159'].map((n) => `swsh12.5-${n}`);
    const at = (id: string) => refs.symbols.subarray(refs.table.indexOf.get(id)! * refs.cells, (refs.table.indexOf.get(id)! + 1) * refs.cells);
    for (const a of ids) {
      expect(correlation(at(a), at(a))).toBeCloseTo(1, 4);
      for (const b of ids) if (a !== b) expect(correlation(at(a), at(b)), `${a} vs ${b}`).toBeLessThan(0.93);
    }
  });

  it('measures colour without brightness and correlation without exposure', () => {
    const c = chromaticity(10, 20, 70);
    expect(c[0] + c[1] + c[2]).toBeCloseTo(1);
    expect(chromaticity(0, 0, 0)).toEqual([0, 0, 0]);
    const cells = [10, 40, 90, 20, 60, 30];
    const brighter = cells.map((v) => v * 1.8 + 25);
    expect(correlation(normalizeCells(cells), normalizeCells(brighter))).toBeCloseTo(1, 5);
    expect(correlation(normalizeCells(cells), normalizeCells(cells.map((v) => 100 - v)))).toBeCloseTo(-1, 5);
    expect(Array.from(normalizeCells([5, 5, 5]))).toEqual([0, 0, 0]);
  });
});

describe('the unnumbered 2020 Darkness Energy photo', () => {
  const frame = () => ({ w: photo.width, h: photo.height });

  it('is a Darkness Energy when the user framed it (a snapped photo)', () => {
    const c = scanBareEnergy({ lines: [HEADER, COPYRIGHT], frame: frame(), guide: CARD, refs, lookup, sample: sampler(photo) })!;
    expect(c).not.toBeNull();
    expect(c.card.name).toBe('Darkness Energy');
    // The printing in hand is not in the catalog, so the match is offered, never added by itself.
    expect(c.confident).toBe(false);
    expect(c.evidence.some((e) => /^symbol Darkness \d+%$/.test(e))).toBe(true);
    expect(c.evidence[0]).toBe('text "ENERGY"');
    expect(c.margin).toBeGreaterThan(0.05);
    // The outline sits on the card.
    expect(Math.abs(c.cardBox.x - CARD.x)).toBeLessThan(CARD.w * 0.08);
    expect(Math.abs(c.cardBox.y - CARD.y)).toBeLessThan(CARD.h * 0.08);
    expect(Math.abs(c.cardBox.w - CARD.w)).toBeLessThan(CARD.w * 0.12);
  });

  it('is found from the header alone, with no guide (live view, a photo from the gallery)', () => {
    const c = scanBareEnergy({ lines: [HEADER, COPYRIGHT], frame: frame(), refs, lookup, sample: sampler(photo) })!;
    expect(c).not.toBeNull();
    expect(c.card.name).toBe('Darkness Energy');
  });

  it('offers the other printings of that Energy first, nearest its copyright year, then the other types', () => {
    const c = scanBareEnergy({ lines: [HEADER, COPYRIGHT], frame: frame(), guide: CARD, refs, lookup, sample: sampler(photo) })!;
    // Newer printings are named "Basic Darkness Energy": the type decides, not the exact name.
    const typeOf = (name: string) => BASIC_ENERGY.exec(name)?.[1];
    const same = c.alternatives.filter((a) => typeOf(a.card.name) === 'Darkness');
    const others = c.alternatives.filter((a) => typeOf(a.card.name) !== 'Darkness');
    expect(same.length).toBeGreaterThanOrEqual(3);
    expect(others.length).toBeGreaterThanOrEqual(2);
    expect(c.alternatives.indexOf(same[same.length - 1])).toBeLessThan(c.alternatives.indexOf(others[0]));
    const year = (a: (typeof same)[number]) => Number(a.set.releaseDate.slice(0, 4));
    expect(Math.abs(year(same[0]) - 2020)).toBeLessThanOrEqual(Math.abs(year(same[same.length - 1]) - 2020));
    for (const a of others) expect(BASIC_ENERGY.test(a.card.name), a.card.name).toBe(true);
    expect(c.alternatives.every((a) => a.card.id !== c.card.id)).toBe(true);
  });

  it('is still a Darkness Energy in a different light: the symbol decides, the colour only nudges', () => {
    for (const tint of [[1.25, 1, 0.8], [0.8, 1, 1.25], [0.6, 0.6, 0.6]] as [number, number, number][]) {
      const c = scanBareEnergy({ lines: [HEADER, COPYRIGHT], frame: frame(), guide: CARD, refs, lookup, sample: sampler(photo, tint) });
      expect(c?.card.name, tint.join(',')).toBe('Darkness Energy');
    }
  });

  it('is left alone when the picture is not an Energy card at all', () => {
    // The same header over a patch of the carpet beside the card.
    const carpet: Box = { x: 10, y: 800, w: 110, h: 154 };
    expect(scanBareEnergy({ lines: [HEADER, COPYRIGHT], frame: frame(), guide: carpet, refs, lookup, sample: sampler(photo) })).toBeNull();
  });

  it('is not looked for without the header, or when the card names its Energy', () => {
    expect(scanBareEnergy({ lines: [COPYRIGHT], frame: frame(), guide: CARD, refs, lookup, sample: sampler(photo) })).toBeNull();
    expect(scanBareEnergy({ lines: [HEADER, line('Darkness Energy', HEADER.bbox)], frame: frame(), guide: CARD, refs, lookup, sample: sampler(photo) })).toBeNull();
  });

  it('goes first among the results, replaces a wrong guess on the same card, and yields to a confident read', () => {
    const other = lookup('bw8-121')!; // Ether: the Trainer the luma hash confused this photo with
    const guess = (confident: boolean, box: Box): ScanCandidate => ({ key: 'x', card: other.card, set: other.set, score: 0.4, margin: 0.1, confident, evidence: [], bbox: box, cardBox: box, alternatives: [] });
    const input = { lines: [HEADER, COPYRIGHT], frame: frame(), guide: CARD, refs, lookup, sample: sampler(photo) };
    const replaced = withBareEnergy([guess(false, CARD)], input);
    expect(replaced.map((c) => c.card.name)).toEqual(['Darkness Energy']);
    const elsewhere: Box = { x: 600, y: 10, w: 100, h: 140 };
    expect(withBareEnergy([guess(false, elsewhere)], input).map((c) => c.card.name)).toEqual(['Darkness Energy', 'Ether']);
    expect(withBareEnergy([guess(true, CARD)], input).map((c) => c.card.name)).toEqual(['Ether']);
    expect(withBareEnergy([], { ...input, lines: [COPYRIGHT] })).toEqual([]);
  });
});

describe('acceptEnergy', () => {
  const m = (type: string, symbol: number, colour = 0): EnergyMatch => ({ id: type, type, hash: 20, symbol, colour, score: symbol - 0.5 * colour });
  it('wants the symbol to be the photo\'s and no other type nearly as close', () => {
    expect(acceptEnergy([m('Darkness', 0.9), m('Grass', 0.78)])).toBe(true);
    expect(acceptEnergy([m('Fire', 0.9), m('Water', 0.88)])).toBe(false);
    // Colour breaks the tie between two symbols that look alike.
    expect(acceptEnergy([m('Fire', 0.9, 0.02), m('Water', 0.88, 0.4)])).toBe(true);
    expect(acceptEnergy([m('Darkness', 0.65), m('Metal', 0.4)])).toBe(false);
    expect(acceptEnergy([m('Darkness', 0.9)])).toBe(true);
    expect(acceptEnergy([])).toBe(false);
  });
});
