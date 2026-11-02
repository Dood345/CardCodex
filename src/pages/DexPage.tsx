import { useMemo, useRef } from 'react';
import { useCatalog } from '@/app/context';
import { useCollection } from '@/data/collection';
import { normalizeText } from '@/data/normalize';
import { Chip, SpeciesTile, TopBar, dexNumber } from '@/ui/components';
import { GameSwitch } from '@/ui/GameSwitch';
import { GearIcon } from '@/ui/icons';
import { QUICK_SCROLL_MIN, QuickScroll } from '@/ui/QuickScroll';
import { hundredOf, sectionsBy } from '@/ui/quick-scroll';
import { href } from '@/ui/router';
import { useSticky } from '@/ui/sticky';

type OwnedFilter = 'all' | 'owned' | 'missing';

const GENERATIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export default function DexPage() {
  const index = useCatalog();
  const collection = useCollection();
  // Filters outlive the page, so coming back from a Pokémon shows the same list.
  const [query, setQuery] = useSticky('dex:query', '');
  const [gen, setGen] = useSticky<number>('dex:gen', 0);
  const [owned, setOwned] = useSticky<OwnedFilter>('dex:owned', 'all');
  const gridRef = useRef<HTMLDivElement>(null);

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
    return index.species.filter((s) => {
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
  }, [index, query, gen, owned, progress]);

  // Quick scroll zone by hundreds of Pokédex numbers, once the list is long enough to need one.
  const quick = visible.length >= QUICK_SCROLL_MIN;
  const sections = useMemo(() => sectionsBy(visible, (s) => hundredOf(s.id)), [visible]);

  return (
    <>
      <TopBar
        title="Pokédex"
        subtitle={`${speciesCollected} / ${index.species.length} species in your collection`}
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
          <Chip active={gen === 0} onClick={() => setGen(0)}>
            All gens
          </Chip>
          {GENERATIONS.map((g) => (
            <Chip key={g} active={gen === g} onClick={() => setGen(g)}>
              Gen {g}
            </Chip>
          ))}
        </div>
      </TopBar>
      <div ref={gridRef} className={`species-grid${quick ? ' with-quick-scroll' : ''}`}>
        {visible.map((s) => (
          <SpeciesTile
            key={s.id}
            species={s}
            owned={progress.get(s.id) ?? 0}
            total={index.cardsByDex.get(s.id)?.length ?? 0}
          />
        ))}
      </div>
      {visible.length === 0 && <div className="empty">No species match.</div>}
      {quick && (
        <QuickScroll
          gridRef={gridRef}
          count={visible.length}
          sections={sections}
          labelAt={(i) => `${dexNumber(visible[i].id)} ${visible[i].name}`}
        />
      )}
    </>
  );
}
