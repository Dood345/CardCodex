/** Small Yu-Gi-Oh! catalog fixture shared by catalog and scanner tests (not a test file). */
import type { YgoCatalogFile } from './catalog';

export const ygoFile: YgoCatalogFile = {
  version: 1,
  game: 'ygo',
  builtAt: '2026-01-01T00:00:00Z',
  sets: [
    { id: 'lob', name: 'Legend of Blue Eyes White Dragon', code: 'LOB', date: '2002-03-08', total: 126 },
    { id: 'sdk', name: 'Starter Deck: Kaiba', code: 'SDK', date: '2002-03-29', total: 50 },
    { id: 'promo', name: 'Mystery Promo', code: 'PRM', date: '', total: 0 },
  ],
  cards: [
    { pc: 89631139, name: 'Blue-Eyes White Dragon', type: 'Normal Monster', frame: 'normal', race: 'Dragon', attr: 'LIGHT', atk: 3000, def: 2500, lv: 8, arc: 'Blue-Eyes', alt: [89631140] },
    { pc: 46986414, name: 'Dark Magician', type: 'Normal Monster', frame: 'normal', race: 'Spellcaster', attr: 'DARK', atk: 2500, def: 2100, lv: 7, arc: 'Dark Magician' },
    { pc: 5318639, name: 'Mystical Space Typhoon', type: 'Spell Card', frame: 'spell', race: 'Quick-Play' },
    { pc: 84013237, name: 'Number 39: Utopia', type: 'XYZ Monster', frame: 'xyz', race: 'Warrior', attr: 'LIGHT', atk: 2500, def: 2000, lv: 4, arc: 'Utopia' },
  ],
  printings: [
    [0, 0, 'LOB-001', 'Ultra Rare'],
    [0, 0, 'LOB-EN001', 'Ultra Rare / Ultimate Rare'],
    [1, 0, 'LOB-005', 'Ultra Rare'],
    [0, 1, 'SDK-001', 'Common'],
    [2, 1, 'SDK-033', 'Common'],
    // Two different cards printed with the same code.
    [1, 2, 'PRM-EN001', 'Super Rare'],
    [3, 2, 'PRM-EN001', 'Super Rare'],
  ],
};
