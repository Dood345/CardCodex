/**
 * "From my binder" on the deck page: a tall sheet over the cards in hand (or
 * the wishlist), set by set in number order like the Collection binder, with
 * a stepper on each tile that puts copies into the deck. A name search and a
 * set filter narrow the list. Nothing about the deck model changes: the
 * steppers call adjustDeckCard like the deck page's own rows.
 */
import { useMemo, useState } from 'react';
import { useCatalog } from '@/app/context';
import { useCollection } from '@/data/collection';
import type { DeckCard } from '@/data/db';
import { adjustDeckCard, qtyOf } from '@/data/decks';
import { groupBySet, type BinderTab } from '@/pages/collection/binder-pages';
import { CardTile, Chip, SetBadge, Sheet } from '@/ui/components';
import { MinusIcon, PlusIcon } from '@/ui/icons';
import { countCards, filterGroups, SET_CHIPS_MAX, setsOf } from './from-binder';

export function FromBinderSheet({
  open,
  onClose,
  deckId,
  cards,
}: {
  open: boolean;
  onClose: () => void;
  deckId: string;
  cards: readonly DeckCard[];
}) {
  const index = useCatalog();
  const collection = useCollection();
  const [tab, setTab] = useState<BinderTab>('owned');
  const [query, setQuery] = useState('');
  const [setPick, setSetPick] = useState('');

  const groups = useMemo(() => (open ? groupBySet(collection, index, tab) : []), [open, collection, index, tab]);
  const sets = useMemo(() => setsOf(groups), [groups]);
  // A set filter left over from the other tab (no such set there) means "all sets".
  const setId = sets.some((s) => s.set.id === setPick) ? setPick : '';
  const shown = useMemo(() => filterGroups(groups, query, setId), [groups, query, setId]);

  return (
    <Sheet open={open} onClose={onClose} title="From my binder" className="from-binder-sheet">
      <div className="from-binder-head">
        <div className="chip-row inline">
          <Chip active={tab === 'owned'} onClick={() => setTab('owned')}>
            Owned
          </Chip>
          <Chip active={tab === 'wanted'} onClick={() => setTab('wanted')}>
            Wishlist
          </Chip>
        </div>
        <input
          className="search-input"
          type="search"
          placeholder="Filter by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          aria-label="Filter by name"
        />
        {sets.length > 1 &&
          (sets.length <= SET_CHIPS_MAX ? (
            <div className="chip-row inline" role="group" aria-label="Set">
              <Chip active={!setId} onClick={() => setSetPick('')}>
                All sets
              </Chip>
              {sets.map((s) => (
                <Chip key={s.set.id} active={setId === s.set.id} onClick={() => setSetPick(s.set.id)}>
                  {s.set.name}
                </Chip>
              ))}
            </div>
          ) : (
            <select className="select" value={setId} onChange={(e) => setSetPick(e.target.value)} aria-label="Set">
              <option value="">All sets ({sets.length})</option>
              {sets.map((s) => (
                <option key={s.set.id} value={s.set.id}>
                  {s.set.name} · {s.count}
                </option>
              ))}
            </select>
          ))}
      </div>

      <div className="from-binder-list">
        {shown.length === 0 ? (
          <p className="from-binder-empty">
            {groups.length === 0
              ? tab === 'owned'
                ? 'No cards in your collection yet. Scan some, or use Quick add on a set.'
                : 'Your wishlist is empty.'
              : 'No cards match.'}
          </p>
        ) : (
          shown.map((g) => (
            <section key={g.set.id} className="from-binder-group">
              <div className="from-binder-set">
                <SetBadge set={g.set} size={24} />
                <span className="from-binder-set-name">{g.set.name}</span>
                <span className="from-binder-set-count">{g.cards.length}</span>
              </div>
              <div className="card-grid from-binder-grid">
                {g.cards.map((card) => {
                  const qty = qtyOf(cards, card.id);
                  return (
                    <div key={card.id} className={`from-binder-cell${qty ? ' in-deck' : ''}`}>
                      <CardTile card={card} set={g.set} entry={collection.get(card.id)} onClick={() => void adjustDeckCard(deckId, card.id, 1)} />
                      <div className="stepper stepper-sm from-binder-stepper">
                        <button type="button" className="stepper-btn" aria-label={`Remove one ${card.name} from the deck`} disabled={qty <= 0} onClick={() => void adjustDeckCard(deckId, card.id, -1)}>
                          <MinusIcon size={16} />
                        </button>
                        <span className="stepper-value" aria-label="In the deck">
                          {qty}
                        </span>
                        <button type="button" className="stepper-btn" aria-label={`Add one ${card.name} to the deck`} onClick={() => void adjustDeckCard(deckId, card.id, 1)}>
                          <PlusIcon size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>

      <div className="sheet-actions from-binder-foot">
        <span className="from-binder-total">
          {cards.reduce((n, c) => n + c.qty, 0)} in the deck · {countCards(shown)} shown
        </span>
        <button type="button" className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
