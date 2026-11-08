/**
 * Yu-Gi-Oh! browse tab: every archetype with how many of its distinct cards
 * you own. The Pokédex equivalent for a game without species.
 */
import { useMemo, useRef } from 'react';
import { useCatalog } from '@/app/context';
import { useCollection } from '@/data/collection';
import { normalizeText } from '@/data/normalize';
import { cardImageUrl } from '@/data/types';
import { archetypeCover } from '@/games/ygo';
import { CardBack } from '@/ui/CardBack';
import { Chip, EmptyState, Img, TopBar } from '@/ui/components';
import { GameSwitch } from '@/ui/GameSwitch';
import { GearIcon } from '@/ui/icons';
import { QUICK_SCROLL_MIN, QuickScroll } from '@/ui/QuickScroll';
import { initialOf, sectionsBy, type Section } from '@/ui/quick-scroll';
import { href } from '@/ui/router';
import { useSticky } from '@/ui/sticky';

type OwnedFilter = 'all' | 'owned' | 'missing';
type Sort = 'name' | 'size';

const NO_SECTIONS: Section[] = [];

export default function ArchetypesPage() {
  const index = useCatalog();
  const collection = useCollection();
  // Filters outlive the page, so coming back from an archetype shows the same list.
  const [query, setQuery] = useSticky('arch:query', '');
  const [owned, setOwned] = useSticky<OwnedFilter>('arch:owned', 'all');
  const [sort, setSort] = useSticky<Sort>('arch:sort', 'name');
  const gridRef = useRef<HTMLDivElement>(null);

  // Distinct owned cards (passcodes) per archetype.
  const progress = useMemo(() => {
    const m = new Map<string, Set<number>>();
    for (const e of collection.values()) {
      if (e.qty <= 0) continue;
      const c = index.cardsById.get(e.cardId);
      if (!c?.arc || c.pc === undefined) continue;
      let s = m.get(c.arc);
      if (!s) m.set(c.arc, (s = new Set()));
      s.add(c.pc);
    }
    return m;
  }, [collection, index]);

  const visible = useMemo(() => {
    const q = normalizeText(query);
    const list = index.archetypes.filter((a) => {
      const got = progress.get(a.name)?.size ?? 0;
      if (owned === 'owned' && got === 0) return false;
      if (owned === 'missing' && got > 0) return false;
      return !q || normalizeText(a.name).includes(q);
    });
    return sort === 'size' ? [...list].sort((a, b) => b.unique - a.unique || a.name.localeCompare(b.name)) : list;
  }, [index, query, owned, sort, progress]);

  // Quick scroll zone: letters when the list is alphabetical, a plain thumb when sorted by size.
  const quick = visible.length >= QUICK_SCROLL_MIN;
  const sections = useMemo(() => (sort === 'name' ? sectionsBy(visible, (a) => initialOf(a.name)) : NO_SECTIONS), [visible, sort]);

  return (
    <>
      <TopBar
        title="Archetypes"
        subtitle={`${progress.size} / ${index.archetypes.length} archetypes started`}
        actions={
          <>
            <GameSwitch />
            <a className="icon-btn" href={href('/settings')} aria-label="Settings">
              <GearIcon />
            </a>
          </>
        }
      >
        <div className="toolbar">
          <input
            className="search-input"
            type="search"
            placeholder="Archetype name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="chip-row">
          <Chip active={owned === 'all'} onClick={() => setOwned('all')}>
            All
          </Chip>
          <Chip active={owned === 'owned'} onClick={() => setOwned('owned')}>
            Collected
          </Chip>
          <Chip active={owned === 'missing'} onClick={() => setOwned('missing')}>
            Missing
          </Chip>
          <span className="chip-sep" />
          <Chip active={sort === 'name'} onClick={() => setSort('name')}>
            A–Z
          </Chip>
          <Chip active={sort === 'size'} onClick={() => setSort('size')}>
            Largest first
          </Chip>
        </div>
      </TopBar>
      <div ref={gridRef} className={`arch-grid${quick ? ' with-quick-scroll' : ''}`}>
        {visible.map((a) => {
          const got = progress.get(a.name)?.size ?? 0;
          const cover = archetypeCover(index, a.name);
          const state = got > 0 ? 'owned' : 'missing';
          return (
            <a key={a.name} className={`arch-tile arch-${state}`} href={href(`/archetypes/${encodeURIComponent(a.name)}`)}>
              <div className="arch-art">
                <Img src={cover ? cardImageUrl(cover, '', 'low') : undefined} alt="" className="arch-art-img" fallback={<CardBack game="ygo" />} />
              </div>
              <div className="arch-name" title={a.name}>
                {a.name}
              </div>
              <div className="arch-count">
                {got}/{a.unique} cards
              </div>
            </a>
          );
        })}
      </div>
      {visible.length === 0 && <EmptyState title="No archetypes match" hint="Cards outside any archetype are on the Search tab." />}
      {quick && <QuickScroll gridRef={gridRef} count={visible.length} sections={sections} labelAt={(i) => visible[i].name} />}
    </>
  );
}
