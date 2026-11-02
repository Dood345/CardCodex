import { useMemo } from 'react';
import { useCatalog } from '@/app/context';
import { useCollection } from '@/data/collection';
import { speciesArtworkUrl } from '@/data/types';
import { CardGrid, CardTile, Chip, EmptyState, Img, ProgressBar, TopBar, TypePill, dexNumber } from '@/ui/components';
import { GAME_TYPE_COLORS } from '@/ui/icons';
import { href } from '@/ui/router';
import { useSticky } from '@/ui/sticky';

type Filter = 'all' | 'owned' | 'missing';

export default function SpeciesPage({ id }: { id: number }) {
  const index = useCatalog();
  const collection = useCollection();
  const [filter, setFilter] = useSticky<Filter>('species:filter', 'all');
  const species = index.speciesById.get(id);
  const cards = useMemo(() => index.cardsByDex.get(id) ?? [], [index, id]);

  if (!species) {
    return (
      <>
        <TopBar title="Unknown Pokémon" backTo="/dex" />
        <EmptyState title="No such species" />
      </>
    );
  }

  const ownedCount = cards.filter((c) => (collection.get(c.id)?.qty ?? 0) > 0).length;
  const visible = cards.filter((c) => {
    const owned = (collection.get(c.id)?.qty ?? 0) > 0;
    if (filter === 'owned') return owned;
    if (filter === 'missing') return !owned;
    return true;
  });
  const t1 = GAME_TYPE_COLORS[species.types[0] ?? ''] ?? '#888';
  const t2 = GAME_TYPE_COLORS[species.types[1] ?? species.types[0] ?? ''] ?? t1;
  const prev = index.speciesById.get(id - 1);
  const next = index.speciesById.get(id + 1);

  return (
    <>
      <TopBar
        title={species.name}
        subtitle={`${dexNumber(species.id)} · Generation ${species.gen}`}
        backTo="/dex"
        actions={
          <div className="pager">
            {prev ? (
              <a className="btn ghost" href={href(`/dex/${prev.id}`)} title={prev.name}>
                ‹ {dexNumber(prev.id)}
              </a>
            ) : null}
            {next ? (
              <a className="btn ghost" href={href(`/dex/${next.id}`)} title={next.name}>
                {dexNumber(next.id)} ›
              </a>
            ) : null}
          </div>
        }
      />
      <section className="species-hero" style={{ '--t1': t1, '--t2': t2 } as React.CSSProperties}>
        <div className="species-art">
          <Img src={speciesArtworkUrl(species.id)} alt={species.name} className="species-art-img" eager />
        </div>
        <div className="species-info">
          <div className="type-row">
            {species.types.map((t) => (
              <TypePill key={t} type={t} />
            ))}
          </div>
          <ProgressBar
            value={ownedCount}
            max={cards.length}
            label={
              cards.length
                ? `${ownedCount} of ${cards.length} ${species.name} cards collected`
                : `No ${species.name} cards in the catalog yet`
            }
          />
        </div>
      </section>
      <div className="chip-row">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
          All ({cards.length})
        </Chip>
        <Chip active={filter === 'owned'} onClick={() => setFilter('owned')}>
          Owned ({ownedCount})
        </Chip>
        <Chip active={filter === 'missing'} onClick={() => setFilter('missing')}>
          Missing ({cards.length - ownedCount})
        </Chip>
      </div>
      {visible.length ? (
        <CardGrid>
          {visible.map((c) => (
            <CardTile key={c.id} card={c} set={index.setsById.get(c.set)} entry={collection.get(c.id)} showSet />
          ))}
        </CardGrid>
      ) : (
        <EmptyState title="Nothing here" hint={filter === 'owned' ? 'You do not own any of these yet.' : undefined} />
      )}
    </>
  );
}
