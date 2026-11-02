/**
 * One deck: its cards by category with how many the collection covers,
 * a search box that adds cards straight into it, one tap to put every
 * missing card on the wishlist, and sharing as a message (the deck list
 * plus a code any CardCodex can import, src/data/deck-code.ts).
 */
import { useMemo, useState } from 'react';
import { useCatalog, useGame } from '@/app/context';
import { useSettings } from '@/app/settings';
import { copyText, shareMessage, shareText } from '@/app/share';
import { formatCardNumber } from '@/data/catalog';
import { useCollection, type CollectionMap } from '@/data/collection';
import type { DeckCard } from '@/data/db';
import { deckShareText, encodeDeck } from '@/data/deck-code';
import { adjustDeckCard, deleteDeck, qtyOf, renameDeck, sizeHint, summarizeDeck, useDeck, wantMissing } from '@/data/decks';
import { searchCards } from '@/data/search';
import { cardImageUrl, type CatalogCard, type CatalogSet } from '@/data/types';
import { gameById } from '@/games';
import { EmptyState, Sheet, Toast, TopBar, useToast } from '@/ui/components';
import { HeartIcon, MinusIcon, PlusIcon, ShareIcon } from '@/ui/icons';
import { href, navigate } from '@/ui/router';
import type { CatalogIndex } from '@/data/catalog';

/** "SVI 057/198" for Pokémon, the set code for Yu-Gi-Oh!. */
export function printingLabel(card: CatalogCard, set: CatalogSet | undefined): string {
  const num = formatCardNumber(card, set);
  return card.pc !== undefined || !set?.abbr ? num : `${set.abbr} ${num}`;
}

/** The lines of the share message: "4× Charizard ex · OBF 125/197". */
export function deckLines(cards: readonly DeckCard[], index: CatalogIndex): string[] {
  return cards.map((c) => {
    const card = index.cardsById.get(c.cardId);
    const set = card && index.setsById.get(card.set);
    return `${c.qty}× ${card ? card.name : c.cardId}${card ? ` · ${printingLabel(card, set)}` : ''}`;
  });
}

interface Row {
  card: CatalogCard;
  set: CatalogSet | undefined;
  qty: number;
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
  const [toast, showToast] = useToast();

  const summary = useMemo(() => (deck ? summarizeDeck(deck.cards, collection) : null), [deck, collection]);
  const results = useMemo(() => (query.trim() ? searchCards(index, query, {}, collection, 24).cards : []), [index, query, collection]);
  const sections = useMemo(() => {
    if (!deck) return [];
    const byCat = new Map<string, Row[]>();
    let unknown = 0;
    for (const c of deck.cards) {
      const card = index.cardsById.get(c.cardId);
      if (!card) {
        unknown++;
        continue;
      }
      const rows = byCat.get(card.cat) ?? [];
      rows.push({ card, set: index.setsById.get(card.set), qty: c.qty });
      byCat.set(card.cat, rows);
    }
    const order = [...game.categories, ...[...byCat.keys()].filter((k) => !(game.categories as readonly string[]).includes(k))];
    return { list: order.filter((k) => byCat.has(k)).map((k) => ({ label: k, rows: byCat.get(k)!, count: byCat.get(k)!.reduce((n, r) => n + r.qty, 0) })), unknown };
  }, [deck, index, game.categories]);

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
  const hint = sizeHint(game.id, s.total);
  const secs = Array.isArray(sections) ? { list: [], unknown: 0 } : sections;

  const share = async () => {
    setBusy(true);
    try {
      const payload = { game: deck.game, name: deck.name, cards: deck.cards };
      const code = await encodeDeck(payload);
      const text = deckShareText(payload, game.name, deckLines(deck.cards, index), code);
      const msg = shareMessage(await shareText(`${deck.name} (CardCodex deck)`, text));
      if (msg) showToast(msg);
    } finally {
      setBusy(false);
    }
  };
  const copyCode = async () => {
    const code = await encodeDeck({ game: deck.game, name: deck.name, cards: deck.cards });
    showToast((await copyText(code)) ? 'Deck code copied.' : 'Could not copy here.');
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
        <button type="button" className="btn" onClick={() => void share()} disabled={busy || deck.cards.length === 0}>
          <ShareIcon size={18} /> Share
        </button>
        <button type="button" className="btn ghost" onClick={() => void copyCode()} disabled={deck.cards.length === 0}>
          Copy code
        </button>
        <button type="button" className="btn ghost danger" onClick={() => setConfirmDelete(true)}>
          Delete
        </button>
      </section>
      {hint && <p className="deck-hint">{hint}</p>}

      {deck.cards.length === 0 ? (
        <EmptyState title="An empty deck" hint="Search above to add cards, or open any card and tap “Add to deck”." />
      ) : (
        secs.list.map((sec) => (
          <section key={sec.label} className="deck-section">
            <h2 className="section-title">
              {sec.label} · {sec.count}
            </h2>
            <div className="scan-candidates">
              {sec.rows.map((r) => (
                <DeckRow
                  key={r.card.id}
                  card={r.card}
                  set={r.set}
                  qty={r.qty}
                  collection={collection}
                  onAdjust={(d) => void adjustDeckCard(deck.id, r.card.id, d)}
                />
              ))}
            </div>
          </section>
        ))
      )}
      {secs.unknown > 0 && (
        <p className="deck-hint">
          {secs.unknown} {secs.unknown === 1 ? 'card is' : 'cards are'} not in this catalog (another game, or no longer listed).
        </p>
      )}

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

/** One deck line: picture (opens the card), name, printing, deck count against the owned count, and a stepper for the deck count. */
export function DeckRow({
  card,
  set,
  qty,
  collection,
  onAdjust,
}: {
  card: CatalogCard;
  set: CatalogSet | undefined;
  qty: number;
  collection: CollectionMap;
  onAdjust?: (delta: number) => void;
}) {
  const owned = collection.get(card.id)?.qty ?? 0;
  const short = Math.max(0, qty - owned);
  return (
    <div className={`scan-candidate deck-card${short ? ' deck-short' : ''}`}>
      <a href={href(`/card/${card.id}`)} aria-label={`Open ${card.name}`}>
        <img src={set ? cardImageUrl(card, set.series, 'low') : undefined} alt="" />
      </a>
      <div className="cand-body">
        <div className="cand-name">{card.name}</div>
        <div className="cand-sub">
          {set?.name ?? card.set} · {formatCardNumber(card, set)}
        </div>
        <div className="cand-sub">
          {qty ? `${qty} in deck · ` : ''}own {owned}
          {short ? ` · ${short} missing` : ''}
        </div>
      </div>
      {onAdjust && (
        <div className="stepper stepper-sm">
          <button type="button" className="stepper-btn" aria-label={`Remove one ${card.name} from the deck`} disabled={qty <= 0} onClick={() => onAdjust(-1)}>
            <MinusIcon size={16} />
          </button>
          <span className="stepper-value">{qty}</span>
          <button type="button" className="stepper-btn" aria-label={`Add one ${card.name} to the deck`} onClick={() => onAdjust(1)}>
            <PlusIcon size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
