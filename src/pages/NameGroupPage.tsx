/**
 * Every printing of one Trainer or Energy name (`#/dex/name/<key>`), the
 * Pokédex's counterpart of a species page for cards that have no species.
 */
import { useMemo } from 'react';
import { useCatalog } from '@/app/context';
import { useCollection } from '@/data/collection';
import { nameGroup } from '@/data/name-groups';
import { CardGrid, CardTile, Chip, EmptyState, ProgressBar, TopBar } from '@/ui/components';
import { useSticky } from '@/ui/sticky';

type Filter = 'all' | 'owned' | 'missing';

const CATEGORY_LABEL: Record<string, string> = { Trainer: 'Trainer', Energy: 'Energy', Pokemon: 'Pokémon' };

export default function NameGroupPage({ nameKey }: { nameKey: string }) {
  const index = useCatalog();
  const collection = useCollection();
  const [filter, setFilter] = useSticky<Filter>('name:filter', 'all');
  const group = useMemo(() => nameGroup(index, nameKey), [index, nameKey]);

  if (!group) {
    return (
      <>
        <TopBar title="Unknown card" backTo="/dex" />
        <EmptyState title="No such card name" hint="It may belong to another game, or the catalog may have changed." />
      </>
    );
  }
  const cat = CATEGORY_LABEL[group.cards[0].cat] ?? group.cards[0].cat;
  const ownedCount = group.cards.filter((c) => (collection.get(c.id)?.qty ?? 0) > 0).length;
  const visible = group.cards.filter((c) => {
    const owned = (collection.get(c.id)?.qty ?? 0) > 0;
    if (filter === 'owned') return owned;
    if (filter === 'missing') return !owned;
    return true;
  });

  return (
    <>
      <TopBar title={group.name} subtitle={`${cat} · ${group.cards.length} ${group.cards.length === 1 ? 'printing' : 'printings'}`} backTo="/dex">
        <div className="name-progress">
          <ProgressBar value={ownedCount} max={group.cards.length} label={`${ownedCount} of ${group.cards.length} ${group.name} cards collected`} />
        </div>
        <div className="chip-row">
          <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </Chip>
          <Chip active={filter === 'owned'} onClick={() => setFilter('owned')}>
            Collected
          </Chip>
          <Chip active={filter === 'missing'} onClick={() => setFilter('missing')}>
            Missing
          </Chip>
        </div>
      </TopBar>
      {visible.length === 0 ? (
        <EmptyState title={filter === 'owned' ? `No ${group.name} collected yet` : 'Nothing missing'} />
      ) : (
        <CardGrid>
          {visible.map((c) => (
            <CardTile key={c.id} card={c} set={index.setsById.get(c.set)} entry={collection.get(c.id)} showSet />
          ))}
        </CardGrid>
      )}
    </>
  );
}
