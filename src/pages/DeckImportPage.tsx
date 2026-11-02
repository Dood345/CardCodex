/**
 * A deck arriving from a friend: the code from a share message or a
 * cardcodex://deck/ link, decoded and shown against the collection, with
 * one tap to keep it as a deck of your own.
 */
import { useEffect, useState } from 'react';
import { useCatalog, useGame } from '@/app/context';
import { useSettings } from '@/app/settings';
import { useCollection } from '@/data/collection';
import { decodeDeck, type DeckShare } from '@/data/deck-code';
import { createDeck, summarizeDeck } from '@/data/decks';
import { gameById } from '@/games';
import { EmptyState, TopBar } from '@/ui/components';
import { href, navigate } from '@/ui/router';
import { DeckRow } from './DeckPage';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; share: DeckShare };

export default function DeckImportPage({ code }: { code: string }) {
  const index = useCatalog();
  const game = useGame();
  const collection = useCollection();
  const [, update] = useSettings();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    decodeDeck(code)
      .then((share) => {
        if (!cancelled) setState({ status: 'ok', share });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (state.status === 'loading') return <TopBar title="Shared deck" subtitle="Reading the deck…" backTo="/collection" />;
  if (state.status === 'error') {
    return (
      <>
        <TopBar title="Shared deck" backTo="/collection" />
        <EmptyState
          title="Could not read that deck"
          hint={state.message}
          action={
            <a className="btn" href={href('/collection')}>
              Back to the collection
            </a>
          }
        />
      </>
    );
  }
  const { share } = state;
  if (share.game !== game.id) {
    const other = gameById(share.game);
    return (
      <>
        <TopBar title={share.name} backTo="/collection" />
        <EmptyState
          title={`A ${other.name} deck`}
          hint={`Switch to ${other.short} to see its cards and keep it.`}
          action={
            <button type="button" className="btn primary" onClick={() => update({ game: share.game })}>
              Switch to {other.short}
            </button>
          }
        />
      </>
    );
  }
  const known = share.cards.filter((c) => index.cardsById.has(c.cardId));
  const unknown = share.cards.length - known.length;
  const s = summarizeDeck(known, collection);
  const save = async () => {
    setSaving(true);
    const deck = await createDeck(share.game, share.name, known);
    navigate(`/decks/${deck.id}`, true);
  };

  return (
    <>
      <TopBar title={share.name} subtitle={`Shared ${game.short} deck · ${s.total} ${s.total === 1 ? 'card' : 'cards'} · you own ${s.covered}`} backTo="/collection" />
      <section className="deck-actions">
        <button type="button" className="btn primary" onClick={() => void save()} disabled={saving || known.length === 0}>
          Keep this deck
        </button>
        <a className="btn ghost" href={href('/collection')}>
          Not now
        </a>
      </section>
      {unknown > 0 && (
        <p className="deck-hint">
          {unknown} {unknown === 1 ? 'card is' : 'cards are'} not in this catalog and will be left out.
        </p>
      )}
      {known.length === 0 ? (
        <EmptyState title="Nothing to import" hint="None of the cards in this deck are in the catalog." />
      ) : (
        <section className="deck-section">
          <div className="scan-candidates">
            {known.map((c) => {
              const card = index.cardsById.get(c.cardId)!;
              return <DeckRow key={c.cardId} card={card} set={index.setsById.get(card.set)} qty={c.qty} collection={collection} />;
            })}
          </div>
        </section>
      )}
    </>
  );
}
