/**
 * "Add to deck" on a card page: a sheet with every deck of the active game
 * and a stepper for this card's count in each, plus a line to start a new
 * deck with the card in it.
 */
import { useState } from 'react';
import { useGame } from '@/app/context';
import { adjustDeckCard, createDeck, qtyOf, useDecks } from '@/data/decks';
import type { CatalogCard } from '@/data/types';
import { Sheet } from './components';
import { DeckIcon, MinusIcon, PlusIcon } from './icons';

export function AddToDeckButton({ card }: { card: CatalogCard }) {
  const game = useGame();
  const decks = useDecks(game.id);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const inDecks = decks.filter((d) => qtyOf(d.cards, card.id) > 0).length;

  const createWithCard = async () => {
    await createDeck(game.id, name || 'New deck', [{ cardId: card.id, qty: 1 }]);
    setName('');
  };

  return (
    <>
      <button type="button" className={`btn ${inDecks ? 'primary' : 'ghost'}`} onClick={() => setOpen(true)}>
        <DeckIcon size={18} /> {inDecks ? `In ${inDecks} ${inDecks === 1 ? 'deck' : 'decks'}` : 'Add to deck'}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`${card.name} in your decks`}>
        {decks.length === 0 && <p>No decks yet. Start one below with this card in it.</p>}
        <div className="deck-picks">
          {decks.map((d) => {
            const qty = qtyOf(d.cards, card.id);
            const total = d.cards.reduce((n, c) => n + c.qty, 0);
            return (
              <div key={d.id} className="deck-pick">
                <div className="deck-body">
                  <div className="deck-name">{d.name}</div>
                  <div className="deck-sub">
                    {total} {total === 1 ? 'card' : 'cards'}
                  </div>
                </div>
                <div className="stepper stepper-sm">
                  <button type="button" className="stepper-btn" aria-label={`Remove one from ${d.name}`} disabled={qty <= 0} onClick={() => void adjustDeckCard(d.id, card.id, -1)}>
                    <MinusIcon size={16} />
                  </button>
                  <span className="stepper-value">{qty}</span>
                  <button type="button" className="stepper-btn" aria-label={`Add one to ${d.name}`} onClick={() => void adjustDeckCard(d.id, card.id, 1)}>
                    <PlusIcon size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <form
          className="deck-new"
          onSubmit={(e) => {
            e.preventDefault();
            void createWithCard();
          }}
        >
          <input className="search-input" placeholder="New deck name…" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <button type="submit" className="btn">
            <PlusIcon size={18} /> New deck
          </button>
        </form>
        <div className="sheet-actions">
          <button type="button" className="btn primary" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      </Sheet>
    </>
  );
}
