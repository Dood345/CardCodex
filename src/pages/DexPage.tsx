import { useMemo, useRef } from 'react';
import { useCatalog } from '@/app/context';
import { useCollection } from '@/data/collection';
import { nameGroups, ownedIn } from '@/data/name-groups';
import { normalizeText } from '@/data/normalize';
import { asListSort, sortList, type ListSort } from '@/data/sorting';
import type { CardCategory } from '@/data/types';
import { Chip, SpeciesTile, TopBar, dexNumber } from '@/ui/components';
import { GameSwitch } from '@/ui/GameSwitch';
import { GearIcon } from '@/ui/icons';
import { NameTile } from '@/ui/NameTile';
import { QUICK_SCROLL_MIN, QuickScroll } from '@/ui/QuickScroll';
import { hundredOf, initialOf, sectionsBy, type Section } from '@/ui/quick-scroll';
import { href } from '@/ui/router';
import { useSticky } from '@/ui/sticky';

type OwnedFilter = 'all' | 'owned' | 'missing';

const GENERATIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const NO_SECTIONS: Section[] = [];
/** The Pokédex shows species; Trainer and Energy cards, which have none, are grouped by name instead (src/data/name-groups.ts). */
const CATEGORIES: { cat: CardCategory; label: string; noun: string }[] = [
  { cat: 'Pokemon', label: 'Pokémon', noun: 'species' },
  { cat: 'Trainer', label: 'Trainers', noun: 'trainers' },
  { cat: 'Energy', label: 'Energy', noun: 'energy cards' },
];

export default function DexPage() {
  const index = useCatalog();
  const collection = useCollection();
  // Filters outlive the page, so coming back from a Pokémon shows the same list.
  const [query, setQuery] = useSticky('dex:query', '');
  const [gen, setGen] = useSticky<number>('dex:gen', 0);
  const [owned, setOwned] = useSticky<OwnedFilter>('dex:owned', 'all');
  const [cat, setCat] = useSticky<CardCategory>('dex:cat', 'Pokemon');
  const [storedSort, setSort] = useSticky<ListSort>('dex:sort', 'natural');
  const sort = asListSort(storedSort);
  const gridRef = useRef<HTMLDivElement>(null);
  const bySpecies = cat === 'Pokemon';

  // Distinct owned cards per species. O(entries), cheap on every change.
  const progress = useMemo(() => {
    const owned = new Map<number, number>();
    for (const e of collection.values()) {
      if (e.qty <= 0) continue;
      const card = index.cardsById.get(e.cardId);
      if (!card?.dex) continue;
      for (const d of card.dex) owned.set(d, (owned.get(d) ?? 0) + 1);
    }
    return owned;
  }, [collection, index]);

  const speciesCollected = progress.size;

  const visible = useMemo(() => {
    const q = normalizeText(query);
    const asNumber = /^\d+$/.test(q) ? Number(q) : null;
    const list = index.species.filter((s) => {
      if (gen && s.gen !== gen) return false;
      const total = index.cardsByDex.get(s.id)?.length ?? 0;
      const got = progress.get(s.id) ?? 0;
      if (owned === 'owned' && got === 0) return false;
      if (owned === 'missing' && (got > 0 || total === 0)) return false;
      if (q) {
        if (asNumber !== null) return s.id === asNumber;
        if (!normalizeText(s.name).includes(q)) return false;
      }
      return true;
    });
    return sortList(
      list,
      sort,
      (s) => s.name,
      (s) => progress.get(s.id) ?? 0,
    );
  }, [index, query, gen, owned, progress, sort]);

  // Trainers and Energy: one entry per card name, with the owned printings counted the same way.
  const groups = useMemo(() => (bySpecies ? [] : nameGroups(index, cat)), [index, cat, bySpecies]);
  const groupOwned = useMemo(() => new Map(groups.map((g) => [g.key, ownedIn(g, collection)])), [groups, collection]);
  const visibleGroups = useMemo(() => {
    const q = normalizeText(query);
    const list = groups.filter((g) => {
      const got = groupOwned.get(g.key) ?? 0;
      if (owned === 'owned' && got === 0) return false;
      if (owned === 'missing' && got > 0) return false;
      return !q || g.key.includes(q);
    });
    // Names already come A–Z, so only "most owned" reorders them.
    return sortList(
      list,
      sort === 'owned' ? 'owned' : 'natural',
      (g) => g.name,
      (g) => groupOwned.get(g.key) ?? 0,
    );
  }, [groups, groupOwned, query, owned, sort]);
  const groupsCollected = useMemo(() => [...groupOwned.values()].filter((n) => n > 0).length, [groupOwned]);
  const noun = CATEGORIES.find((c) => c.cat === cat)?.noun ?? 'cards';

  // Quick scroll zone by hundreds of Pokédex numbers (or initials), once the list is long enough to need one.
  const count = bySpecies ? visible.length : visibleGroups.length;
  const quick = count >= QUICK_SCROLL_MIN;
  // The labels follow the order: hundreds by number, letters by name, a plain thumb by cards owned.
  const sections = useMemo(() => {
    if (sort === 'owned') return NO_SECTIONS;
    if (!bySpecies) return sectionsBy(visibleGroups, (g) => initialOf(g.name));
    return sort === 'name' ? sectionsBy(visible, (s) => initialOf(s.name)) : sectionsBy(visible, (s) => hundredOf(s.id));
  }, [bySpecies, visible, visibleGroups, sort]);

  return (
    <>
      <TopBar
        title="Pokédex"
        subtitle={
          bySpecies
            ? `${speciesCollected} / ${index.species.length} species in your collection`
            : `${groupsCollected} / ${groups.length} ${noun} in your collection`
        }
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
            placeholder="Name or number…"
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
          {CATEGORIES.map((c) => (
            <Chip key={c.cat} active={cat === c.cat} onClick={() => setCat(c.cat)}>
              {c.label}
            </Chip>
          ))}
          <span className="chip-sep" />
          <Chip active={sort !== 'owned' && (!bySpecies || sort === 'natural')} onClick={() => setSort('natural')}>
            {bySpecies ? 'By number' : 'A–Z'}
          </Chip>
          {bySpecies && (
            <Chip active={sort === 'name'} onClick={() => setSort('name')}>
              A–Z
            </Chip>
          )}
          <Chip active={sort === 'owned'} onClick={() => setSort('owned')}>
            Most owned
          </Chip>
          {bySpecies && (
            <>
              <span className="chip-sep" />
              <Chip active={gen === 0} onClick={() => setGen(0)}>
                All gens
              </Chip>
              {GENERATIONS.map((g) => (
                <Chip key={g} active={gen === g} onClick={() => setGen(g)}>
                  Gen {g}
                </Chip>
              ))}
            </>
          )}
        </div>
      </TopBar>
      <div ref={gridRef} className={`species-grid${quick ? ' with-quick-scroll' : ''}`}>
        {bySpecies
          ? visible.map((s) => (
              <SpeciesTile key={s.id} species={s} owned={progress.get(s.id) ?? 0} total={index.cardsByDex.get(s.id)?.length ?? 0} />
            ))
          : visibleGroups.map((g) => <NameTile key={g.key} group={g} owned={groupOwned.get(g.key) ?? 0} />)}
      </div>
      {count === 0 && <div className="empty">{bySpecies ? 'No species match.' : `No ${noun} match.`}</div>}
      {quick && (
        <QuickScroll
          gridRef={gridRef}
          count={count}
          sections={sections}
          labelAt={(i) => (bySpecies ? `${dexNumber(visible[i].id)} ${visible[i].name}` : visibleGroups[i].name)}
        />
      )}
    </>
  );
}
