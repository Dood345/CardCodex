/**
 * A deck's cards laid out by its game's rules (src/games/deck-rules.ts),
 * shared by the deck page and the import page: the section counts
 * ("Main 40 · Extra 15 · Side 15"), the size and copy-limit reminders, then
 * each section's lines. Pokémon has one section and shows its lines by
 * category as before; Yu-Gi-Oh! shows Main (by Monster / Spell / Trap),
 * Extra and Side, and on the deck page each line can send a copy to or
 * from the side deck.
 */
import type { ReactNode } from 'react';
import { formatCardNumber, type CatalogIndex } from '@/data/catalog';
import type { CollectionMap } from '@/data/collection';
import type { DeckCard } from '@/data/db';
import { deckSections, limitHint, overLimit, type DeckZone, type PlacedLine } from '@/data/decks';
import { cardImageUrl, type CatalogCard, type CatalogSet } from '@/data/types';
import type { GameProfile } from '@/games';
import { MinusIcon, PlusIcon } from '@/ui/icons';
import { href } from '@/ui/router';

export interface DeckEdits {
  /** Add or remove copies of a line. */
  adjust(cardId: string, zone: DeckZone, delta: number): void;
  /** Move one copy between the deck proper and the side deck. */
  move(cardId: string, from: DeckZone, to: DeckZone): void;
}

/** Copies per section, the size reminders and the over-the-limit reminder. */
export function DeckSections({
  game,
  cards,
  index,
  collection,
  edits,
  empty,
}: {
  game: GameProfile;
  cards: readonly DeckCard[];
  index: CatalogIndex;
  collection: CollectionMap;
  edits?: DeckEdits;
  /** Shown instead of the lines when the deck has none. */
  empty?: ReactNode;
}) {
  const rules = game.deckRules;
  const placed = deckSections(rules, cards, index, collection);
  const limits = limitHint(rules, overLimit(rules, cards, index));
  const multi = rules.sections.length > 1;
  const unknown = cards.filter((c) => !index.cardsById.has(c.cardId)).length;

  return (
    <>
      {multi && (
        <p className="deck-counts" aria-label="Cards per section">
          {placed.map((p, i) => (
            <span key={p.section.id} className={p.hint ? 'deck-count off' : 'deck-count'}>
              {i > 0 && ' · '}
              {p.section.label} {p.total}
            </span>
          ))}
        </p>
      )}
      {placed.map((p) => p.hint && <p key={p.section.id} className="deck-hint">{p.hint}</p>)}
      {limits && <p className="deck-hint deck-limit">{limits}</p>}

      {cards.length === 0
        ? empty
        : placed.map((p) => {
            const known = p.lines.filter((l) => index.cardsById.has(l.cardId));
            if (!known.length) return null;
            // The deck proper is grouped by category (Pokémon / Trainer / Energy, Monster / Spell / Trap).
            const groups = p.section.id === 'main' ? byCategory(known, index, game) : [{ label: '', lines: known }];
            const heading = multi ? `${p.section.label} · ${p.total}` : null;
            return (
              <div key={p.section.id} className={multi ? 'deck-zone' : undefined}>
                {heading && <h2 className="deck-zone-title">{heading}</h2>}
                {groups.map((g) => (
                  <section key={g.label || p.section.id} className="deck-section">
                    {g.label && (
                      <h3 className="section-title">
                        {g.label} · {g.lines.reduce((n, l) => n + l.qty, 0)}
                      </h3>
                    )}
                    <div className="scan-candidates">
                      {g.lines.map((l) => (
                        <PlacedRow key={`${l.cardId}|${l.zone ?? ''}`} line={l} index={index} game={game} collection={collection} edits={edits} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            );
          })}
      {unknown > 0 && (
        <p className="deck-hint">
          {unknown} {unknown === 1 ? 'card is' : 'cards are'} not in this catalog (another game, or no longer listed).
        </p>
      )}
    </>
  );
}

function byCategory(lines: PlacedLine[], index: CatalogIndex, game: GameProfile): { label: string; lines: PlacedLine[] }[] {
  const byCat = new Map<string, PlacedLine[]>();
  for (const l of lines) {
    const cat = index.cardsById.get(l.cardId)!.cat;
    const list = byCat.get(cat) ?? [];
    list.push(l);
    byCat.set(cat, list);
  }
  const order = [...game.categories, ...[...byCat.keys()].filter((k) => !(game.categories as readonly string[]).includes(k))];
  return order.filter((k) => byCat.has(k)).map((k) => ({ label: k, lines: byCat.get(k)! }));
}

function PlacedRow({
  line,
  index,
  game,
  collection,
  edits,
}: {
  line: PlacedLine;
  index: CatalogIndex;
  game: GameProfile;
  collection: CollectionMap;
  edits?: DeckEdits;
}) {
  const card = index.cardsById.get(line.cardId)!;
  const rules = game.deckRules;
  const side = line.zone === 'side';
  // Where a copy goes when it leaves the side deck: Extra for Fusion, Synchro, Xyz and Link monsters.
  const back = rules.sections.find((s) => s.id === rules.sectionOf(card, {}))?.label ?? 'Main';
  const sideLabel = rules.sections.find((s) => s.id === 'side')?.label ?? 'Side';
  const move =
    edits && rules.side ? (
      <button
        type="button"
        className="btn ghost small deck-move"
        aria-label={side ? `Move one ${card.name} back to ${back}` : `Move one ${card.name} to ${sideLabel}`}
        onClick={() => edits.move(card.id, line.zone, side ? undefined : 'side')}
      >
        {side ? `To ${back}` : `To ${sideLabel}`}
      </button>
    ) : undefined;
  return (
    <DeckRow
      card={card}
      set={index.setsById.get(card.set)}
      qty={line.qty}
      available={line.available}
      collection={collection}
      onAdjust={edits ? (d) => edits.adjust(card.id, line.zone, d) : undefined}
      place={side ? 'side' : 'deck'}
      extra={move}
    />
  );
}

/**
 * One deck line: picture (opens the card), name, printing, deck count against the owned count, and a stepper for the deck count.
 * `available` is the owned copies this line can use when the card also sits in another section (defaults to every owned copy);
 * `place` names where the copies sit ("2 in side"); `extra` goes under the stepper.
 */
export function DeckRow({
  card,
  set,
  qty,
  collection,
  onAdjust,
  available,
  place = 'deck',
  extra,
}: {
  card: CatalogCard;
  set: CatalogSet | undefined;
  qty: number;
  collection: CollectionMap;
  onAdjust?: (delta: number) => void;
  available?: number;
  place?: string;
  extra?: ReactNode;
}) {
  const owned = collection.get(card.id)?.qty ?? 0;
  const short = Math.max(0, qty - (available ?? owned));
  const stepper = onAdjust && (
    <div className="stepper stepper-sm">
      <button type="button" className="stepper-btn" aria-label={`Remove one ${card.name} from the deck`} disabled={qty <= 0} onClick={() => onAdjust(-1)}>
        <MinusIcon size={16} />
      </button>
      <span className="stepper-value">{qty}</span>
      <button type="button" className="stepper-btn" aria-label={`Add one ${card.name} to the deck`} onClick={() => onAdjust(1)}>
        <PlusIcon size={16} />
      </button>
    </div>
  );
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
          {qty ? `${qty} in ${place} · ` : ''}own {owned}
          {short ? ` · ${short} missing` : ''}
        </div>
      </div>
      {extra ? (
        <div className="deck-controls">
          {stepper}
          {extra}
        </div>
      ) : (
        stepper
      )}
    </div>
  );
}
