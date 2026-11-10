/**
 * A deck's cards laid out by its game's rules (src/games/deck-rules.ts),
 * shared by the deck page and the import page: the section counts
 * ("Main 40 · Extra 15 · Side 15"), the size and copy-limit reminders, then
 * each section's lines. Pokémon has one section and shows its lines by
 * category as before; Yu-Gi-Oh! shows Main (by Monster / Spell / Trap),
 * Extra and Side, and on the deck page each line can send a copy to or
 * from the side deck.
 */
import { useState, type ReactNode } from 'react';
import { formatCardNumber, type CatalogIndex } from '@/data/catalog';
import type { CollectionMap } from '@/data/collection';
import type { DeckCard } from '@/data/db';
import { claimText, deckSections, limitHint, overLimit, unlimitedTwin, type Claim, type Claims, type DeckZone, type OverLimit, type PlacedLine } from '@/data/decks';
import { cardImageUrl, type CatalogCard, type CatalogSet } from '@/data/types';
import type { GameProfile } from '@/games';
import type { DeckRules } from '@/games/deck-rules';
import { CardZoom } from '@/ui/CardZoom';
import { Sheet } from '@/ui/components';
import { MinusIcon, PlusIcon } from '@/ui/icons';

export interface DeckEdits {
  /** Add or remove copies of a line. */
  adjust(cardId: string, zone: DeckZone, delta: number): void;
  /** Move one copy between the deck proper and the side deck. */
  move(cardId: string, from: DeckZone, to: DeckZone): void;
  /**
   * Swap the printings `from` for `to` on every line; with `moveOwned`, the owned copies recorded under `from`
   * move to `to` as well (they were entered as the wrong printing). Left out where a deck cannot be edited.
   */
  replace?(from: readonly string[], to: string, moveOwned: boolean): void;
}

/** Copies per section, the size reminders and the over-the-limit reminder. */
export function DeckSections({
  game,
  cards,
  index,
  collection,
  edits,
  empty,
  rules = game.deckRules,
  claims,
}: {
  game: GameProfile;
  /** The rules this deck follows when not the game's default (a Commander deck). */
  rules?: DeckRules;
  /** Owned copies other decks have first call on (src/data/decks.ts, `claimsBefore`); none when every deck counts every copy. */
  claims?: Claims;
  cards: readonly DeckCard[];
  index: CatalogIndex;
  collection: CollectionMap;
  edits?: DeckEdits;
  /** Shown instead of the lines when the deck has none. */
  empty?: ReactNode;
}) {
  const placed = deckSections(rules, cards, index, collection, claims);
  const over = overLimit(rules, cards, index);
  const limits = limitHint(rules, over);
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
      {over.map((o) => {
        const twin = unlimitedTwin(rules, o.name, index, collection);
        return twin ? <TwinFix key={o.name} over={o} twin={twin} index={index} rules={rules} collection={collection} replace={edits?.replace} /> : null;
      })}

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
                        <PlacedRow key={`${l.cardId}|${l.zone ?? ''}`} line={l} index={index} rules={rules} collection={collection} edits={edits} claimed={claims?.get(l.cardId)} />
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

const printingOf = (card: CatalogCard, index: CatalogIndex) => {
  const set = index.setsById.get(card.set);
  return `${set?.name ?? card.set} · ${formatCardNumber(card, set)}`;
};

/**
 * A card over its limit that also exists, under the same name, as a card
 * without one: "Darkness Energy" is basic Energy in every set since 2007 and
 * a Special Energy with an effect in fifteen older ones, and someone entering
 * the basic Energy they hold can pick the old printing without knowing. Says
 * so, and offers to switch the deck (and the owned copies) to the other.
 */
function TwinFix({
  over,
  twin,
  index,
  rules,
  collection,
  replace,
}: {
  over: OverLimit;
  twin: CatalogCard;
  index: CatalogIndex;
  rules: DeckRules;
  collection: CollectionMap;
  replace?: DeckEdits['replace'];
}) {
  const [open, setOpen] = useState(false);
  const [moveOwned, setMoveOwned] = useState(true);
  const from = over.ids.map((id) => index.cardsById.get(id)).filter((c): c is CatalogCard => !!c);
  if (!from.length) return null;
  const kind = rules.cardNote?.(from[0]) ?? 'a limited printing';
  const twinKind = rules.cardNote?.(twin) ?? 'The other printing';
  const owned = over.ids.reduce((n, id) => n + (collection.get(id)?.qty ?? 0), 0);
  const where = from.map((c) => printingOf(c, index)).join(', ');
  return (
    <div className="deck-twin">
      <p className="deck-hint">
        These {over.name} are {kind} ({where}), limited to {over.limit}. {twinKind} of the same name has no limit.
      </p>
      {replace && (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Switch to {twinKind}
        </button>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title={`Switch to ${twinKind}?`}>
        <p>
          The deck's {over.qty} {over.name} become the printing from {printingOf(twin, index)}, which is {twinKind} and has no copy limit.
        </p>
        {owned > 0 && (
          <label className="build-check">
            <input type="checkbox" checked={moveOwned} onChange={(e) => setMoveOwned(e.target.checked)} />
            Also move my {owned} owned {owned === 1 ? 'copy' : 'copies'} to that printing
          </label>
        )}
        <div className="sheet-actions">
          <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setOpen(false);
              replace?.(over.ids, twin.id, moveOwned && owned > 0);
            }}
          >
            Switch
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function PlacedRow({
  line,
  index,
  rules,
  collection,
  edits,
  claimed,
}: {
  line: PlacedLine;
  index: CatalogIndex;
  rules: DeckRules;
  claimed?: Claim;
  collection: CollectionMap;
  edits?: DeckEdits;
}) {
  const card = index.cardsById.get(line.cardId)!;
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
      claimed={claimed}
      tag={rules.cardNote?.(card)}
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
  claimed,
  tag,
  place = 'deck',
  extra,
}: {
  card: CatalogCard;
  set: CatalogSet | undefined;
  qty: number;
  collection: CollectionMap;
  onAdjust?: (delta: number) => void;
  available?: number;
  /** Owned copies other decks have first call on, shown as "2 in Fire deck". */
  claimed?: Claim;
  /** The kind of card where it decides the copy limit: "Special Energy" (`DeckRules.cardNote`). */
  tag?: string;
  place?: string;
  extra?: ReactNode;
}) {
  const owned = collection.get(card.id)?.qty ?? 0;
  const short = Math.max(0, qty - (available ?? owned));
  // The thumbnail is too small to read: tapping the picture or the text shows the card large (src/ui/CardZoom.tsx).
  const [zoomed, setZoomed] = useState(false);
  const counts = `${qty ? `${qty} in ${place} · ` : ''}own ${owned}${claimed ? ` · ${claimText(claimed)}` : ''}${short ? ` · ${short} missing` : ''}`;
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
      <button type="button" className="deck-thumb" aria-label={`Show ${card.name} larger`} onClick={() => setZoomed(true)}>
        <img src={set ? cardImageUrl(card, set.series, 'low') : undefined} alt="" />
      </button>
      <div className="cand-body" onClick={() => setZoomed(true)}>
        <div className="cand-name">{card.name}</div>
        <div className="cand-sub">
          {set?.name ?? card.set} · {formatCardNumber(card, set)}
          {tag ? ` · ${tag}` : ''}
        </div>
        <div className="cand-sub">{counts}</div>
      </div>
      {zoomed && <CardZoom card={card} set={set} note={counts} onClose={() => setZoomed(false)} />}
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
