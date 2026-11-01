import { describe, expect, it } from 'vitest';
import { buildIndex } from '@/data/catalog';
import { expandYgoCatalog, levelLabel, ygoCategory } from './catalog';
import { ygoFile } from './fixture.test-util';

describe('expandYgoCatalog', () => {
  const catalog = expandYgoCatalog(ygoFile);

  it('makes one prefixed card per printing, in file order', () => {
    expect(catalog.game).toBe('ygo');
    expect(catalog.cards.map((c) => c.id)).toEqual([
      'ygo:LOB-001',
      'ygo:LOB-EN001',
      'ygo:LOB-005',
      'ygo:SDK-001',
      'ygo:SDK-033',
      'ygo:PRM-EN001',
      'ygo:PRM-EN001~84013237',
    ]);
  });

  it('carries the card facts onto every printing', () => {
    const bewd = catalog.cards[1];
    expect(bewd).toMatchObject({
      set: 'lob',
      num: 'LOB-EN001',
      name: 'Blue-Eyes White Dragon',
      cat: 'Monster',
      pc: 89631139,
      types: ['LIGHT'],
      race: 'Dragon',
      lv: 8,
      atk: 3000,
      def: 2500,
      arc: 'Blue-Eyes',
      rarity: 'Ultra Rare / Ultimate Rare',
      sub: 'Normal Monster',
      alt: [89631140],
    });
    const mst = catalog.cards[4];
    expect(mst.cat).toBe('Spell');
    expect(mst.types).toBeUndefined();
    expect(mst.race).toBe('Quick-Play');
  });

  it('groups sets by release year with no printed denominator', () => {
    expect(catalog.sets[0]).toMatchObject({ id: 'lob', series: '2002', seriesName: '2002', official: 0, total: 126, abbr: 'LOB' });
    expect(catalog.sets[2]).toMatchObject({ series: 'undated', seriesName: 'Undated' });
  });

  it('indexes printings by passcode and archetype, newest set first', () => {
    const index = buildIndex(catalog, []);
    expect(index.game).toBe('ygo');
    expect(index.cardsByPasscode.get(89631139)?.map((c) => c.id)).toEqual(['ygo:SDK-001', 'ygo:LOB-001', 'ygo:LOB-EN001']);
    expect(index.cardsByArchetype.get('Dark Magician')?.map((c) => c.id)).toEqual(['ygo:LOB-005', 'ygo:PRM-EN001']);
    expect(index.archetypes.map((a) => a.name)).toEqual(['Blue-Eyes', 'Dark Magician', 'Utopia']);
    expect(index.archetypes[0].unique).toBe(1);
    expect(index.cardsBySet.get('lob')?.map((c) => c.num)).toEqual(['LOB-001', 'LOB-EN001', 'LOB-005']);
    expect(index.series.map((s) => s.id)).toEqual(['2002', 'undated']);
  });
});

describe('labels', () => {
  it('classifies API types and names the level stat by frame', () => {
    expect(ygoCategory('Flip Tuner Effect Monster')).toBe('Monster');
    expect(ygoCategory('Trap Card')).toBe('Trap');
    expect(ygoCategory('Skill Card')).toBe('Skill');
    expect(levelLabel({ frame: 'xyz_pendulum' })).toBe('Rank');
    expect(levelLabel({ frame: 'link' })).toBe('Link');
    expect(levelLabel({ frame: 'effect' })).toBe('Level');
  });
});
