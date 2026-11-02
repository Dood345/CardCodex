/**
 * One archetype: its distinct cards (newest printing shown, copies summed
 * over all printings) or every printing, with owned/missing filters.
 */
import { useMemo } from 'react';
import { useCatalog } from '@/app/context';
import { useCollection } from '@/data/collection';
import type { CollectionEntry } from '@/data/db';
import { cardImageUrl, type CatalogCard } from '@/data/types';
import { archetypeCover } from '@/games/ygo';
import { CardGrid, CardTile, Chip, EmptyState, Img, ProgressBar, TopBar } from '@/ui/components';
import { useSticky } from '@/ui/sticky';

type Filter = 'all' | 'owned' | 'missing';

interface Unique {
  card: CatalogCard;
  qty: number;
  wanted: boolean;
  printings: number;
}

export default function ArchetypePage({ name }: { name: string }) {
  const index = useCatalog();
  const collection = useCollection();
  const [filter, setFilter] = useSticky<Filter>('arch:filter', 'all');
  const [allPrintings, setAllPrintings] = useSticky('arch:printings', false);
  const printings = useMemo(() => index.cardsByArchetype.get(name) ?? [], [index, name]);

  const unique = useMemo(() => {
    const m = new Map<number, Unique>();
    for (const c of printings) {
      const e = collection.get(c.id);
      const key = c.pc ?? -1;
      const u = m.get(key) ?? { card: c, qty: 0, wanted: false, printings: 0 };
      u.qty += e?.qty ?? 0;
      u.wanted ||= !!e?.wanted;
      u.printings++;
      m.set(key, u);
    }
    return [...m.values()];
  }, [printings, collection]);

  if (!printings.length) {
    return (
      <>
        <TopBar title="Unknown archetype" backTo="/archetypes" />
        <EmptyState title="No such archetype" hint={name} />
      </>
    );
  }

  const ownedUnique = unique.filter((u) => u.qty > 0).length;
  const cover = archetypeCover(index, name);
  const visibleUnique = unique.filter((u) => (filter === 'owned' ? u.qty > 0 : filter === 'missing' ? u.qty === 0 : true));
  const visiblePrintings = printings.filter((c) => {
    const owned = (collection.get(c.id)?.qty ?? 0) > 0;
    return filter === 'owned' ? owned : filter === 'missing' ? !owned : true;
  });
  const entryFor = (u: Unique): CollectionEntry | undefined =>
    u.qty > 0 || u.wanted ? { cardId: u.card.id, qty: u.qty, wanted: u.wanted ? 1 : 0, addedAt: 0, updatedAt: 0 } : undefined;

  return (
    <>
      <TopBar
        title={name}
        subtitle={`${unique.length} ${unique.length === 1 ? 'card' : 'cards'} · ${printings.length} ${printings.length === 1 ? 'printing' : 'printings'}`}
        backTo="/archetypes"
      />
      <section className="arch-hero">
        {cover && (
          <div className="arch-hero-art">
            <Img src={cardImageUrl(cover, '', 'low')} alt={cover.name} eager />
          </div>
        )}
        <div className="species-info">
          <ProgressBar value={ownedUnique} max={unique.length} label={`${ownedUnique} of ${unique.length} ${name} cards collected`} />
        </div>
      </section>
      <div className="chip-row">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </Chip>
        <Chip active={filter === 'owned'} onClick={() => setFilter('owned')}>
          Owned
        </Chip>
        <Chip active={filter === 'missing'} onClick={() => setFilter('missing')}>
          Missing
        </Chip>
        <span className="chip-sep" />
        <Chip active={!allPrintings} onClick={() => setAllPrintings(false)}>
          Cards
        </Chip>
        <Chip active={allPrintings} onClick={() => setAllPrintings(true)}>
          All printings
        </Chip>
      </div>
      {allPrintings ? (
        visiblePrintings.length ? (
          <CardGrid>
            {visiblePrintings.map((c) => (
              <CardTile key={c.id} card={c} set={index.setsById.get(c.set)} entry={collection.get(c.id)} showSet />
            ))}
          </CardGrid>
        ) : (
          <EmptyState title="Nothing here" />
        )
      ) : visibleUnique.length ? (
        <CardGrid>
          {visibleUnique.map((u) => (
            <CardTile
              key={u.card.id}
              card={u.card}
              set={index.setsById.get(u.card.set)}
              entry={entryFor(u)}
              sub={`${u.printings} ${u.printings === 1 ? 'printing' : 'printings'}`}
            />
          ))}
        </CardGrid>
      ) : (
        <EmptyState title="Nothing here" hint={filter === 'owned' ? 'You do not own any of these yet.' : undefined} />
      )}
    </>
  );
}
