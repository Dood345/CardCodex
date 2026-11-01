import { useEffect, useMemo, useState } from 'react';
import { useCatalog } from '@/app/context';
import { useCollection } from '@/data/collection';
import { searchCards, searchSpecies, type OwnedFilter, type SearchFilters } from '@/data/search';
import type { CardCategory } from '@/data/types';
import { speciesSpriteUrl } from '@/data/types';
import { CardGrid, CardTile, Chip, EmptyState, TopBar, dexNumber } from '@/ui/components';
import { EnergyIcon } from '@/ui/icons';
import { href, useQueryParam, type Route } from '@/ui/router';

const PAGE = 120;

export default function SearchPage({ route }: { route: Route }) {
  const index = useCatalog();
  const collection = useCollection();
  const [q, setQ] = useQueryParam(route, 'q');
  const [text, setText] = useState(q);
  const [owned, setOwned] = useState<OwnedFilter>('any');
  const [cat, setCat] = useState<CardCategory | ''>('');
  const [type, setType] = useState('');
  const [rarity, setRarity] = useState('');
  const [series, setSeries] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [showFilters, setShowFilters] = useState(false);

  // Debounce typing into the URL (so back/forward and sharing keep the query).
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (text !== q) setQ(text);
    }, 200);
    return () => window.clearTimeout(t);
  }, [text, q, setQ]);
  useEffect(() => setLimit(PAGE), [q, owned, cat, type, rarity, series]);

  const filters: SearchFilters = useMemo(() => ({ owned, cat, type, rarity, series }), [owned, cat, type, rarity, series]);
  const hasFilter = owned !== 'any' || !!cat || !!type || !!rarity || !!series;
  const result = useMemo(
    () => (q.trim() || hasFilter ? searchCards(index, q, filters, collection, limit) : { cards: [], total: 0 }),
    [index, q, filters, collection, limit, hasFilter],
  );
  const species = useMemo(() => (q.trim() && !/\//.test(q) ? searchSpecies(index, q, 8) : []), [index, q]);

  return (
    <>
      <TopBar title="Search" subtitle={q.trim() || hasFilter ? `${result.total} cards` : 'Cards, sets, numbers like 57/198'}>
        <div className="toolbar">
          <input
            className="search-input"
            type="search"
            placeholder="Pikachu, Base Set, SVI, 004/102…"
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
              {(['', 'Pokemon', 'Trainer', 'Energy'] as const).map((c) => (
                <Chip key={c || 'all'} active={cat === c} onClick={() => setCat(c)}>
                  {c || 'All kinds'}
                </Chip>
              ))}
            </div>
            <div className="chip-row">
              <Chip active={type === ''} onClick={() => setType('')}>
                Any type
              </Chip>
              {index.types.map((t) => (
                <Chip key={t} active={type === t} onClick={() => setType(type === t ? '' : t)}>
                  <EnergyIcon type={t} size={16} /> {t}
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
              <select className="select" value={series} onChange={(e) => setSeries(e.target.value)} aria-label="Series">
                <option value="">Any series</option>
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

      {species.length > 0 && (
        <div className="species-strip">
          {species.map((s) => (
            <a key={s.id} className="species-pill" href={href(`/dex/${s.id}`)}>
              <img src={speciesSpriteUrl(s.id)} alt="" width={36} height={36} loading="lazy" />
              <span>
                {dexNumber(s.id)} {s.name}
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
              <button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE)}>
                Show more ({result.total - result.cards.length} left)
              </button>
            </div>
          )}
        </>
      ) : q.trim() || hasFilter ? (
        <EmptyState title="No cards found" hint="Try a shorter name, a set code like SVI, or a number like 25/102." />
      ) : (
        <EmptyState title="Find any card" hint="Search by Pokémon, card name, set, set code or printed number." />
      )}
    </>
  );
}
