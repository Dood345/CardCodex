import { useMemo } from 'react';
import { useCatalog, useGame } from '@/app/context';
import { computeStats, useCollection } from '@/data/collection';
import { setRecency } from '@/data/catalog';
import type { CatalogCard, CatalogSet } from '@/data/types';
import { CardGrid, CardTile, Chip, EmptyState, SetBadge, TopBar } from '@/ui/components';
import { GameSwitch } from '@/ui/GameSwitch';
import { GearIcon } from '@/ui/icons';
import { href } from '@/ui/router';
import { useSticky } from '@/ui/sticky';

type Tab = 'owned' | 'wanted';

interface Group {
  set: CatalogSet;
  cards: CatalogCard[];
  copies: number;
}

export default function CollectionPage() {
  const index = useCatalog();
  const game = useGame();
  const collection = useCollection();
  const [tab, setTab] = useSticky<Tab>(`${game.id}:collection:tab`, 'owned');
  const [open, setOpen] = useSticky<Set<string>>(`${game.id}:collection:open`, () => new Set());

  const stats = useMemo(() => computeStats(collection, index), [collection, index]);

  const groups = useMemo(() => {
    const bySet = new Map<string, Group>();
    for (const e of collection.values()) {
      const include = tab === 'owned' ? e.qty > 0 : !!e.wanted;
      if (!include) continue;
      const card = index.cardsById.get(e.cardId);
      const set = card && index.setsById.get(card.set);
      if (!card || !set) continue;
      let g = bySet.get(set.id);
      if (!g) bySet.set(set.id, (g = { set, cards: [], copies: 0 }));
      g.cards.push(card);
      g.copies += e.qty;
    }
    const list = [...bySet.values()];
    for (const g of list) {
      const order = new Map((index.cardsBySet.get(g.set.id) ?? []).map((c, i) => [c.id, i]));
      g.cards.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
    list.sort((a, b) => (setRecency(a.set) < setRecency(b.set) ? 1 : -1));
    return list;
  }, [collection, index, tab]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <TopBar
        title="Collection"
        subtitle={`${stats.totalCopies} ${stats.totalCopies === 1 ? 'card' : 'cards'} · ${stats.uniqueCards} unique`}
        actions={
          <>
            <GameSwitch compact />
            <a className="icon-btn" href={href('/settings')} aria-label="Settings">
              <GearIcon />
            </a>
          </>
        }
      >
        <div className="stat-row">
          <Stat value={stats.totalCopies} label="cards" />
          <Stat value={stats.uniqueCards} label="unique" />
          <Stat value={stats.groupsOwned} label={game.groupLabel} />
          <Stat value={stats.setsTouched} label="sets" />
          <Stat value={stats.wanted} label="wanted" />
        </div>
        <div className="chip-row">
          <Chip active={tab === 'owned'} onClick={() => setTab('owned')}>
            Owned
          </Chip>
          <Chip active={tab === 'wanted'} onClick={() => setTab('wanted')}>
            Wishlist
          </Chip>
        </div>
      </TopBar>

      {groups.length === 0 ? (
        <EmptyState
          title={tab === 'owned' ? 'Your collection is empty' : 'Your wishlist is empty'}
          hint={
            tab === 'owned'
              ? 'Scan cards with the camera, or open a set and use Quick add.'
              : 'Open any card and tap “Add to wishlist”.'
          }
          action={
            <div className="empty-actions">
              <a className="btn primary" href={href('/scan')}>
                Scan cards
              </a>
              <a className="btn" href={href('/sets')}>
                Browse sets
              </a>
            </div>
          }
        />
      ) : (
        groups.map((g) => {
          const expanded = open.has(g.set.id) || groups.length <= 3;
          return (
            <section key={g.set.id} className="collection-group">
              <button type="button" className="group-header" onClick={() => toggle(g.set.id)} aria-expanded={expanded}>
                <SetBadge set={g.set} size={32} />
                <span className="group-title">{g.set.name}</span>
                <span className="group-meta">
                  {g.cards.length} {tab === 'owned' ? `unique · ${g.copies} ${g.copies === 1 ? 'card' : 'cards'}` : 'wanted'}{' '}
                  {expanded ? '▾' : '▸'}
                </span>
              </button>
              {expanded && (
                <CardGrid>
                  {g.cards.map((c) => (
                    <CardTile key={c.id} card={c} set={g.set} entry={collection.get(c.id)} />
                  ))}
                </CardGrid>
              )}
            </section>
          );
        })
      )}
    </>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value.toLocaleString()}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
