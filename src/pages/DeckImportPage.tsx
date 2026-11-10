/**
 * A deck arriving from a friend: the code from a share message or a
 * cardcodex://deck/ link, or a .ccdeck file opened from a chat or the
 * picker (held by src/data/deck-file.ts), decoded and shown against the
 * collection, with one tap to keep it as a deck of your own.
 */
import { useEffect, useState } from 'react';
import { useCatalog, useGame } from '@/app/context';
import { useSettings } from '@/app/settings';
import { useCollection } from '@/data/collection';
import { decodeDeck, type DeckShare } from '@/data/deck-code';
import { decodeDeckText, heldDeckFile } from '@/data/deck-file';
import { createDeck, summarizeDeck, useClaims } from '@/data/decks';
import { gameById } from '@/games';
import { EmptyState, TopBar } from '@/ui/components';
import { href, navigate } from '@/ui/router';
import { DeckSections } from './DeckSections';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; share: DeckShare };

export default function DeckImportPage({ code }: { code: string }) {
  const index = useCatalog();
  const game = useGame();
  const collection = useCollection();
  // Not a saved deck yet: every saved deck has first call on the copies it uses.
  const claims = useClaims(game.id, undefined, collection);
  const [, update] = useSettings();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    const read = async (): Promise<DeckShare> => {
      if (code !== 'file') return decodeDeck(code);
      const held = heldDeckFile();
      if (!held) throw new Error('Open the deck file again.');
      if (held.error) throw new Error(held.error);
      return decodeDeckText(held.text ?? '');
    };
    read()
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
  const s = summarizeDeck(known, collection, claims);
  const save = async () => {
    setSaving(true);
    const deck = await createDeck(share.game, share.name, known, share.rules);
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
      <DeckSections
        game={game}
        cards={known}
        index={index}
        collection={collection}
        claims={claims}
        empty={<EmptyState title="Nothing to import" hint="None of the cards in this deck are in the catalog." />}
      />
    </>
  );
}
