import { useMemo } from 'react';
import { useCatalog } from '@/app/context';
import { useSettings } from '@/app/settings';
import { adjustQty, useCollection, progressOf } from '@/data/collection';
import { setLogoUrl } from '@/data/types';
import { CardGrid, CardTile, Chip, EmptyState, Img, ProgressBar, SetBadge, Toast, TopBar, useToast } from '@/ui/components';
import { navigate } from '@/ui/router';
import { useSticky } from '@/ui/sticky';

type Filter = 'all' | 'owned' | 'missing' | 'wanted';

export default function SetPage({ id }: { id: string }) {
  const index = useCatalog();
  const collection = useCollection();
  const [settings] = useSettings();
  const [filter, setFilter] = useSticky<Filter>('set:filter', 'all');
  const [quickAdd, setQuickAdd] = useSticky('set:quickAdd', false);
  const [toast, showToast] = useToast();
  const set = index.setsById.get(id);
  const cards = useMemo(() => index.cardsBySet.get(id) ?? [], [index, id]);

  if (!set) {
    return (
      <>
        <TopBar title="Unknown set" backTo="/sets" />
        <EmptyState title="No such set" />
      </>
    );
  }

  const p = progressOf(cards, collection);
  const visible = cards.filter((c) => {
    const e = collection.get(c.id);
    const owned = (e?.qty ?? 0) > 0;
    if (filter === 'owned') return owned;
    if (filter === 'missing') return !owned;
    if (filter === 'wanted') return !!e?.wanted;
    return true;
  });
  const logo = setLogoUrl(set);

  return (
    <>
      <TopBar
        title={set.name}
        subtitle={`${set.seriesName}${set.abbr ? ` · ${set.abbr}` : ''}${set.releaseDate ? ` · ${set.releaseDate}` : ''}`}
        backTo="/sets"
        actions={<SetBadge set={set} size={40} />}
      >
        <div className="set-hero">
          {logo && <Img src={logo} alt={set.name} className="set-logo" eager />}
          <ProgressBar value={p.owned} max={p.total} label={`${p.owned} of ${p.total} cards collected`} />
        </div>
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
          <Chip active={filter === 'wanted'} onClick={() => setFilter('wanted')}>
            Wanted
          </Chip>
          <span className="chip-sep" />
          <Chip active={quickAdd} onClick={() => setQuickAdd((v) => !v)} color="var(--accent)">
            {quickAdd ? '✓ Tap a card = +1' : 'Quick add'}
          </Chip>
        </div>
      </TopBar>
      {visible.length ? (
        <CardGrid>
          {visible.map((c) => (
            <CardTile
              key={c.id}
              card={c}
              set={set}
              entry={collection.get(c.id)}
              dim={settings.dimMissing}
              onClick={
                quickAdd
                  ? () => {
                      void adjustQty(c.id, 1);
                      showToast(`+1 ${c.name}`);
                    }
                  : () => navigate(`/card/${c.id}`)
              }
            />
          ))}
        </CardGrid>
      ) : (
        <EmptyState title="No cards match this filter" />
      )}
      <Toast message={toast} />
    </>
  );
}
