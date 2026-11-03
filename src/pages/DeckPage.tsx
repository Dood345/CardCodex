/**
 * One deck: its cards in the game's sections (src/pages/DeckSections.tsx) with how many the collection covers,
 * a search box that adds cards straight into it, one tap to put every
 * missing card on the wishlist, and sharing as a small file that opens in a
 * friend's CardCodex (src/data/deck-file.ts) or as a message (the deck list
 * plus a code any CardCodex can import, src/data/deck-code.ts).
 */
import { useMemo, useState } from 'react';
import { useCatalog, useGame } from '@/app/context';
import { useSettings } from '@/app/settings';
import { copyText, shareFile, shareMessage, shareText } from '@/app/share';
import { formatCardNumber } from '@/data/catalog';
import { useCollection } from '@/data/collection';
import type { DeckCard } from '@/data/db';
import { deckShareText, encodeDeck } from '@/data/deck-code';
import { deckFileName, encodeDeckFile } from '@/data/deck-file';
import { adjustDeckCard, deleteDeck, moveDeckCard, qtyOf, renameDeck, summarizeDeck, useDeck, wantMissing } from '@/data/decks';
import { searchCards } from '@/data/search';
import type { CatalogCard, CatalogSet } from '@/data/types';
import { gameById } from '@/games';
import { EmptyState, Sheet, Toast, TopBar, useToast } from '@/ui/components';
import { HeartIcon, ShareIcon } from '@/ui/icons';
import { navigate } from '@/ui/router';
import type { CatalogIndex } from '@/data/catalog';
import { DeckRow, DeckSections } from './DeckSections';

export { DeckRow };

/** "SVI 057/198" for Pokémon, the set code for Yu-Gi-Oh!. */
export function printingLabel(card: CatalogCard, set: CatalogSet | undefined): string {
  const num = formatCardNumber(card, set);
  return card.pc !== undefined || !set?.abbr ? num : `${set.abbr} ${num}`;
}

/** The lines of the share message: "4× Charizard ex · OBF 125/197", side-deck lines marked "· side". */
export function deckLines(cards: readonly DeckCard[], index: CatalogIndex): string[] {
  return cards.map((c) => {
    const card = index.cardsById.get(c.cardId);
    const set = card && index.setsById.get(card.set);
    return `${c.qty}× ${card ? card.name : c.cardId}${card ? ` · ${printingLabel(card, set)}` : ''}${c.zone === 'side' ? ' · side' : ''}`;
  });
}

export default function DeckPage({ id }: { id: string }) {
  const index = useCatalog();
  const game = useGame();
  const collection = useCollection();
  const { deck, loaded } = useDeck(id);
  const [, update] = useSettings();
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [toast, showToast] = useToast();

  const summary = useMemo(() => (deck ? summarizeDeck(deck.cards, collection) : null), [deck, collection]);
  const results = useMemo(() => (query.trim() ? searchCards(index, query, {}, collection, 24).cards : []), [index, query, collection]);

  if (!loaded) return <TopBar title="Deck" backTo="/collection" />;
  if (!deck) {
    return (
      <>
        <TopBar title="Unknown deck" backTo="/collection" />
        <EmptyState title="No such deck" hint="It may have been deleted." />
      </>
    );
  }
  if (deck.game !== game.id) {
    const other = gameById(deck.game);
    return (
      <>
        <TopBar title={deck.name} backTo="/collection" />
        <EmptyState
          title={`A ${other.name} deck`}
          hint={`Switch to ${other.short} to open it; your collection keeps both games.`}
          action={
            <button type="button" className="btn primary" onClick={() => update({ game: deck.game })}>
              Switch to {other.short}
            </button>
          }
        />
      </>
    );
  }
  const s = summary!;

  const payload = { game: deck.game, name: deck.name, cards: deck.cards };
  const title = `${deck.name} (CardCodex deck)`;
  const shareAsFile = async () => {
    setSharing(false);
    setBusy(true);
    try {
      const msg = shareMessage(await shareFile(deckFileName(deck.name), encodeDeckFile(payload), title));
      if (msg) showToast(msg);
    } finally {
      setBusy(false);
    }
  };
  const shareAsMessage = async () => {
    setSharing(false);
    setBusy(true);
    try {
      const code = await encodeDeck(payload);
      const msg = shareMessage(await shareText(title, deckShareText(payload, game.name, deckLines(deck.cards, index), code)));
      if (msg) showToast(msg);
    } finally {
      setBusy(false);
    }
  };
  const copyCode = async () => {
    setSharing(false);
    showToast((await copyText(await encodeDeck(payload))) ? 'Deck code copied.' : 'Could not copy here.');
  };
  const wishlist = async () => {
    const n = await wantMissing(deck.cards, collection);
    showToast(n ? `${n} ${n === 1 ? 'card' : 'cards'} added to your wishlist.` : 'Everything missing is already on your wishlist.');
  };
  const remove = async () => {
    setConfirmDelete(false);
    await deleteDeck(deck.id);
    navigate('/collection', true);
  };

  return (
    <>
      <TopBar
        title={deck.name}
        subtitle={`${s.total} ${s.total === 1 ? 'card' : 'cards'} · ${s.covered} owned · ${s.short} missing`}
        backTo="/collection"
        actions={
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setDraft(deck.name);
              setRenaming(true);
            }}
          >
            Rename
          </button>
        }
      >
        <div className="toolbar">
          <input
            className="search-input"
            type="search"
            placeholder="Add cards: name, set code, number…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </div>
      </TopBar>

      {query.trim() &&
        (results.length ? (
          <section className="deck-section">
            <h2 className="section-title">Add to the deck</h2>
            <div className="scan-candidates">
              {results.map((card) => (
                <DeckRow
                  key={card.id}
                  card={card}
                  set={index.setsById.get(card.set)}
                  qty={qtyOf(deck.cards, card.id)}
                  collection={collection}
                  onAdjust={(d) => void adjustDeckCard(deck.id, card.id, d)}
                />
              ))}
            </div>
          </section>
        ) : (
          <p className="deck-hint">No cards match.</p>
        ))}

      <section className="deck-actions">
        <button type="button" className="btn primary" onClick={() => void wishlist()} disabled={s.needs.length === 0}>
          <HeartIcon size={18} /> Add {s.needs.length ? `${s.needs.length} missing` : 'missing'} to wishlist
        </button>
        <button type="button" className="btn" onClick={() => setSharing(true)} disabled={busy || deck.cards.length === 0}>
          <ShareIcon size={18} /> Share
        </button>
        <button type="button" className="btn ghost danger" onClick={() => setConfirmDelete(true)}>
          Delete
        </button>
      </section>
      <DeckSections
        game={game}
        cards={deck.cards}
        index={index}
        collection={collection}
        edits={{
          adjust: (cardId, zone, d) => void adjustDeckCard(deck.id, cardId, d, zone),
          move: (cardId, from, to) => void moveDeckCard(deck.id, cardId, from, to),
        }}
        empty={<EmptyState title="An empty deck" hint="Search above to add cards, or open any card and tap “Add to deck”." />}
      />

      <Sheet open={sharing} onClose={() => setSharing(false)} title={`Share ${deck.name}`}>
        <p>
          The deck file opens in a friend's CardCodex with their own owned and missing counts. A message does for chats that take no
          files: they paste it into Decks → Import.
        </p>
        <div className="sheet-actions stack">
          <button type="button" className="btn primary" onClick={() => void shareAsFile()}>
            <ShareIcon size={18} /> Send the deck file
          </button>
          <button type="button" className="btn" onClick={() => void shareAsMessage()}>
            Send as a message
          </button>
          <button type="button" className="btn ghost" onClick={() => void copyCode()}>
            Copy the code
          </button>
        </div>
      </Sheet>
      <Sheet open={renaming} onClose={() => setRenaming(false)} title="Rename deck">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setRenaming(false);
            void renameDeck(deck.id, draft);
          }}
        >
          <input className="search-input" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus autoComplete="off" />
          <div className="sheet-actions">
            <button type="button" className="btn ghost" onClick={() => setRenaming(false)}>
              Cancel
            </button>
            <button type="submit" className="btn primary">
              Save
            </button>
          </div>
        </form>
      </Sheet>
      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this deck?">
        <p>“{deck.name}” will be removed. Your collection and wishlist are not affected.</p>
        <div className="sheet-actions">
          <button type="button" className="btn ghost" onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
          <button type="button" className="btn danger" onClick={() => void remove()}>
            Delete
          </button>
        </div>
      </Sheet>
      <Toast message={toast} />
    </>
  );
}
