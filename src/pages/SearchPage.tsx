import { useEffect, useMemo, useState } from 'react';
import { useCatalog, useGame } from '@/app/context';
import { useCollection } from '@/data/collection';
import { searchCards, type OwnedFilter, type SearchFilters } from '@/data/search';
import type { CardCategory } from '@/data/types';
import { CardGrid, CardTile, Chip, EmptyState, TopBar } from '@/ui/components';
import { href, useQueryParam, type Route } from '@/ui/router';
import { useSticky } from '@/ui/sticky';

const PAGE = 120;

export default function SearchPage({ route }: { route: Route }) {
  const index = useCatalog();
  const game = useGame();
  const collection = useCollection();
  const [q, setQ] = useQueryParam(route, 'q');
  const [text, setText] = useState(q);
  // Filters and the "show more" depth outlive the page, so coming back from a card shows the same results.
  const [owned, setOwned] = useSticky<OwnedFilter>(`${game.id}:search:owned`, 'any');
  const [cat, setCat] = useSticky<CardCategory | ''>(`${game.id}:search:cat`, '');
  const [type, setType] = useSticky(`${game.id}:search:type`, '');
  const [rarity, setRarity] = useSticky(`${game.id}:search:rarity`, '');
  const [series, setSeries] = useSticky(`${game.id}:search:series`, '');
  const [showFilters, setShowFilters] = useSticky(`${game.id}:search:showFilters`, false);
  // How many results are shown, for the query and filters they were shown for; any other search starts at one page.
  const [more, setMore] = useSticky<{ of: string; limit: number }>(`${game.id}:search:more`, { of: '', limit: PAGE });

  // Debounce typing into the URL (so back/forward and sharing keep the query).
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (text !== q) setQ(text);
    }, 200);
    return () => window.clearTimeout(t);
  }, [text, q, setQ]);

  const filters: SearchFilters = useMemo(() => ({ owned, cat, type, rarity, series }), [owned, cat, type, rarity, series]);
  const resultKey = JSON.stringify([q, owned, cat, type, rarity, series]);
  const limit = more.of === resultKey ? more.limit : PAGE;
  const hasFilter = owned !== 'any' || !!cat || !!type || !!rarity || !!series;
  const result = useMemo(
    () => (q.trim() || hasFilter ? searchCards(index, q, filters, collection, limit) : { cards: [], total: 0 }),
    [index, q, filters, collection, limit, hasFilter],
  );
  const groups = useMemo(() => game.quickGroups(index, q), [game, index, q]);
  const { TypeIcon } = game;

  return (
    <>
      <TopBar title="Search" subtitle={q.trim() || hasFilter ? `${result.total} cards` : game.text.searchSubtitle}>
        <div className="toolbar">
          <input
            className="search-input"
            type="search"
            placeholder={game.text.searchPlaceholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
            autoComplete="off"
            enterKeyHint="search"
          />
          <button type="button" className={`btn ghost${hasFilter ? ' has-filter' : ''}`} onClick={() => setShowFilters((v) => !v)}>
            Filters{hasFilter ? ' •' : ''}
          </button>
        </div>
        {showFilters && (
          <div className="filters">
            <div className="chip-row">
              {(['any', 'owned', 'missing', 'wanted'] as OwnedFilter[]).map((o) => (
                <Chip key={o} active={owned === o} onClick={() => setOwned(o)}>
                  {o === 'any' ? 'Any' : o[0].toUpperCase() + o.slice(1)}
                </Chip>
              ))}
              <span className="chip-sep" />
              <Chip active={cat === ''} onClick={() => setCat('')}>
                All kinds
              </Chip>
              {game.categories.map((c) => (
                <Chip key={c} active={cat === c} onClick={() => setCat(cat === c ? '' : c)}>
                  {c}
                </Chip>
              ))}
            </div>
            <div className="chip-row">
              <Chip active={type === ''} onClick={() => setType('')}>
                Any {game.typeLabel.toLowerCase()}
              </Chip>
              {index.types.map((t) => (
                <Chip key={t} active={type === t} onClick={() => setType(type === t ? '' : t)}>
                  <TypeIcon type={t} size={16} /> {t}
                </Chip>
              ))}
            </div>
            <div className="toolbar">
              <select className="select" value={rarity} onChange={(e) => setRarity(e.target.value)} aria-label="Rarity">
                <option value="">Any rarity</option>
                {index.rarities.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <select className="select" value={series} onChange={(e) => setSeries(e.target.value)} aria-label={game.seriesLabel}>
                <option value="">Any {game.seriesLabel.toLowerCase()}</option>
                {index.series.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </TopBar>

      {groups.length > 0 && (
        <div className="species-strip">
          {groups.map((g) => (
            <a key={g.key} className="species-pill" href={href(g.href)}>
              {g.img && <img src={g.img} alt="" width={36} height={36} loading="lazy" className={g.pixel ? '' : 'smooth'} />}
              <span>
                {g.sub ? `${g.sub} · ` : ''}
                {g.name}
              </span>
            </a>
          ))}
        </div>
      )}

      {result.cards.length > 0 ? (
        <>
          <CardGrid>
            {result.cards.map((c) => (
              <CardTile key={c.id} card={c} set={index.setsById.get(c.set)} entry={collection.get(c.id)} showSet />
            ))}
          </CardGrid>
          {result.total > result.cards.length && (
            <div className="load-more">
              <button type="button" className="btn" onClick={() => setMore({ of: resultKey, limit: limit + PAGE })}>
                Show more ({result.total - result.cards.length} left)
              </button>
            </div>
          )}
        </>
      ) : q.trim() || hasFilter ? (
        <EmptyState title="No cards found" hint={game.text.searchEmptyHint} />
      ) : (
        <EmptyState title="Find any card" hint={game.text.searchFindHint} />
      )}
    </>
  );
}
