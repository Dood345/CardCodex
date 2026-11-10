/**
 * A starter deck (src/data/starter-decks.ts) shown against the collection,
 * with one tap to copy it into a deck of your own. Looks like the shared-deck
 * page (src/pages/DeckImportPage.tsx).
 */
import { useState } from 'react';
import { useCatalog, useGame } from '@/app/context';
import { useCollection } from '@/data/collection';
import { createDeck, summarizeDeck, useClaims } from '@/data/decks';
import { toDeckCards, useStarterDecks } from '@/data/starter-decks';
import { EmptyState, TopBar } from '@/ui/components';
import { href, navigate } from '@/ui/router';
import { DeckRow } from './DeckPage';

export default function StarterDeckPage({ id }: { id: string }) {
  const index = useCatalog();
  const game = useGame();
  const collection = useCollection();
  // Not a saved deck yet: every saved deck has first call on the copies it uses.
  const claims = useClaims(game.id, undefined, collection);
  const decks = useStarterDecks(game.id);
  const [saving, setSaving] = useState(false);

  if (!decks) return <TopBar title="Starter deck" subtitle="Loading…" backTo="/collection" />;
  const deck = decks.find((d) => d.id === id);
  if (!deck) {
    return (
      <>
        <TopBar title="Starter deck" backTo="/collection" />
        <EmptyState
          title="No such starter deck"
          hint={`There is no starter deck with that name for ${game.short}.`}
          action={
            <a className="btn" href={href('/collection')}>
              Back to the collection
            </a>
          }
        />
      </>
    );
  }
  const known = toDeckCards(deck).filter((c) => index.cardsById.has(c.cardId));
  const unknown = deck.cards.length - known.length;
  const s = summarizeDeck(known, collection, claims);
  const save = async () => {
    setSaving(true);
    const copy = await createDeck(deck.game, deck.name, known);
    navigate(`/decks/${copy.id}`, true);
  };

  return (
    <>
      <TopBar title={deck.name} subtitle={`Starter deck · ${s.total} ${s.total === 1 ? 'card' : 'cards'} · you own ${s.covered}`} backTo="/collection" />
      <section className="deck-actions">
        <button type="button" className="btn primary" onClick={() => void save()} disabled={saving || known.length === 0}>
          Keep this deck
        </button>
        <a className="btn ghost" href={href('/collection')}>
          Not now
        </a>
      </section>
      <p className="deck-hint starter-note">{deck.note}</p>
      <p className="deck-hint starter-source">
        Source:{' '}
        <a href={deck.source.url} target="_blank" rel="noreferrer">
          {deck.source.name}
        </a>
      </p>
      {unknown > 0 && (
        <p className="deck-hint">
          {unknown} {unknown === 1 ? 'card is' : 'cards are'} not in this catalog and will be left out.
        </p>
      )}
      {known.length === 0 ? (
        <EmptyState title="Nothing to copy" hint="None of the cards in this deck are in the catalog." />
      ) : (
        <section className="deck-section">
          <div className="scan-candidates">
            {known.map((c) => {
              const card = index.cardsById.get(c.cardId)!;
              return <DeckRow
                  key={c.cardId}
                  card={card}
                  set={index.setsById.get(card.set)}
                  qty={c.qty}
                  collection={collection}
                  claimed={claims?.get(c.cardId)}
                  available={Math.max(0, (collection.get(c.cardId)?.qty ?? 0) - (claims?.get(c.cardId)?.qty ?? 0))}
                />;
            })}
          </div>
        </section>
      )}
    </>
  );
}
