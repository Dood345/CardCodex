import { useMemo } from 'react';
import { useCatalog, useGame } from '@/app/context';
import { useCollection, progressOf } from '@/data/collection';
import { normalizeText } from '@/data/normalize';
import { SetRow, TopBar } from '@/ui/components';
import { GameSwitch } from '@/ui/GameSwitch';
import { GearIcon } from '@/ui/icons';
import { href } from '@/ui/router';
import { useSticky } from '@/ui/sticky';

export default function SetsPage() {
  const index = useCatalog();
  const game = useGame();
  const collection = useCollection();
  const [query, setQuery] = useSticky(`${game.id}:sets:query`, '');
  const [collapsed, setCollapsed] = useSticky<Set<string>>(`${game.id}:sets:collapsed`, () => new Set());

  const q = normalizeText(query);
  const groups = useMemo(
    () =>
      index.series
        .map((g) => ({
          ...g,
          sets: g.sets.filter(
            (s) => !q || normalizeText(s.name).includes(q) || s.abbr.toLowerCase().includes(q) || s.id.includes(q),
          ),
        }))
        .filter((g) => g.sets.length > 0),
    [index, q],
  );

  const touched = useMemo(() => {
    const sets = new Set<string>();
    for (const e of collection.values()) {
      if (e.qty > 0) {
        const c = index.cardsById.get(e.cardId);
        if (c) sets.add(c.set);
      }
    }
    return sets.size;
  }, [collection, index]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <TopBar
        title="Sets"
        subtitle={`${touched} of ${index.catalog.sets.length} sets started`}
        actions={
          // Where Sets is the browse tab (Magic), it carries the game switch and Settings like the other browse tabs.
          game.browse.path === '/sets' ? (
            <>
              <GameSwitch />
              <a className="icon-btn" href={href('/settings')} aria-label="Settings">
                <GearIcon />
              </a>
            </>
          ) : undefined
        }
      >
        <div className="toolbar">
          <input
            className="search-input"
            type="search"
            placeholder="Set name or code…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </div>
      </TopBar>
      <div className="series-list">
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.id) && !q;
          return (
            <section key={g.id} className="series-group">
              <button type="button" className="series-header" onClick={() => toggle(g.id)} aria-expanded={!isCollapsed}>
                <span className="series-name">{g.name}</span>
                <span className="series-meta">
                  {g.sets.length} sets {isCollapsed ? '▸' : '▾'}
                </span>
              </button>
              {!isCollapsed &&
                g.sets.map((set) => {
                  const cards = index.cardsBySet.get(set.id) ?? [];
                  const p = progressOf(cards, collection);
                  return <SetRow key={set.id} set={set} owned={p.owned} total={p.total} index={index} />;
                })}
            </section>
          );
        })}
      </div>
    </>
  );
}
