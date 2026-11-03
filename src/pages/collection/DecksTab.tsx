/**
 * The Decks tab of the Collection: every deck of the active game with how
 * much of it the collection covers, a box to start a new one, and the
 * import of a friend's deck file or share text (either opens the import
 * page, src/pages/DeckImportPage.tsx).
 */
import { useRef, useState } from 'react';
import { useCatalog, useGame } from '@/app/context';
import { useCollection } from '@/data/collection';
import { findDeckCode } from '@/data/deck-code';
import { DECK_FILE_ROUTE, holdDeckFile } from '@/data/deck-file';
import { createDeck, summarizeDeck, useDecks } from '@/data/decks';
import { cardImageUrl } from '@/data/types';
import { EmptyState, Img, Sheet } from '@/ui/components';
import { DeckIcon, PlusIcon } from '@/ui/icons';
import { href, navigate } from '@/ui/router';

export function DecksTab() {
  const index = useCatalog();
  const game = useGame();
  const collection = useCollection();
  const decks = useDecks(game.id);
  const [name, setName] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const create = async () => {
    const deck = await createDeck(game.id, name || 'New deck');
    setName('');
    navigate(`/decks/${deck.id}`);
  };
  const openImport = () => {
    const code = findDeckCode(pasted);
    if (!code) {
      setError('No CardCodex deck code in that text.');
      return;
    }
    setImportOpen(false);
    setPasted('');
    setError(null);
    navigate(`/decks/import/${code}`);
  };
  const openFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      holdDeckFile({ name: file.name, text: await file.text() });
    } catch {
      setError('Could not read that file.');
      return;
    }
    setImportOpen(false);
    setPasted('');
    setError(null);
    navigate(DECK_FILE_ROUTE);
  };

  return (
    <div className="decks">
      <form
        className="deck-new"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input className="search-input" placeholder="New deck name…" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        <button type="submit" className="btn primary">
          <PlusIcon size={18} /> New deck
        </button>
        <button type="button" className="btn" onClick={() => setImportOpen(true)}>
          Import
        </button>
      </form>
      {decks.length === 0 ? (
        <EmptyState
          title="No decks yet"
          hint="Build a deck from cards you own and cards you are still after, put what is missing on your wishlist in one tap, and share it with a friend as a message."
        />
      ) : (
        <div className="deck-list">
          {decks.map((d) => {
            const s = summarizeDeck(d.cards, collection);
            const first = d.cards[0] && index.cardsById.get(d.cards[0].cardId);
            const set = first && index.setsById.get(first.set);
            const pct = s.total ? Math.round((s.covered / s.total) * 100) : 0;
            return (
              <a key={d.id} className="deck-row" href={href(`/decks/${d.id}`)}>
                <div className="deck-cover">{first && set ? <Img src={cardImageUrl(first, set.series, 'low')} alt="" /> : <DeckIcon size={22} />}</div>
                <div className="deck-body">
                  <div className="deck-name">{d.name}</div>
                  <div className="deck-sub">
                    {s.total} {s.total === 1 ? 'card' : 'cards'} · {s.covered} owned{s.short ? ` · ${s.short} missing` : s.total ? ' · complete' : ''}
                  </div>
                </div>
                <div className={`deck-pct${pct === 100 && s.total ? ' complete' : ''}`}>{pct}%</div>
              </a>
            );
          })}
        </div>
      )}
      <Sheet open={importOpen} onClose={() => setImportOpen(false)} title="Import a deck">
        <p>Open the deck file (.ccdeck) a friend sent, or paste their message or just its CCD1… code.</p>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          Open a deck file…
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(e) => {
            void openFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <textarea className="deck-paste" rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste here…" />
        {error && <p className="error">{error}</p>}
        <div className="sheet-actions">
          <button type="button" className="btn ghost" onClick={() => setImportOpen(false)}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={openImport} disabled={!pasted.trim()}>
            Open deck
          </button>
        </div>
      </Sheet>
    </div>
  );
}
