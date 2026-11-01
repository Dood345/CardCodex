import { useEffect, useMemo, useState } from 'react';
import { useCatalog } from '@/app/context';
import { adjustQty, setNote, toggleWanted, useCollection, useEntry } from '@/data/collection';
import { VARIANT_KEYS, VARIANT_LABELS } from '@/data/db';
import { formatCardNumber } from '@/data/catalog';
import { cardImageUrl } from '@/data/types';
import { normalizeText } from '@/data/normalize';
import { CardGrid, CardTile, EmptyState, Img, QtyStepper, SetBadge, TopBar, CardPlaceholder, dexNumber } from '@/ui/components';
import { EnergyIcon, HeartIcon, MinusIcon, PlusIcon } from '@/ui/icons';
import { href } from '@/ui/router';

export default function CardPage({ id }: { id: string }) {
  const index = useCatalog();
  const collection = useCollection();
  const entry = useEntry(id);
  const card = index.cardsById.get(id);
  const set = card ? index.setsById.get(card.set) : undefined;
  const [showVariants, setShowVariants] = useState(false);
  const [note, setNoteText] = useState(entry?.note ?? '');
  useEffect(() => setNoteText(entry?.note ?? ''), [entry?.note, id]);
  useEffect(() => {
    if (entry?.variants) setShowVariants(true);
  }, [entry?.variants]);

  const otherPrintings = useMemo(() => {
    if (!card) return [];
    return (index.cardsByName.get(normalizeText(card.name)) ?? []).filter((c) => c.id !== card.id);
  }, [index, card]);

  if (!card || !set) {
    return (
      <>
        <TopBar title="Unknown card" backTo="/search" />
        <EmptyState title="No such card" hint={id} />
      </>
    );
  }

  const qty = entry?.qty ?? 0;
  const wanted = !!entry?.wanted;
  const speciesList = (card.dex ?? []).map((d) => index.speciesById.get(d)).filter((s): s is NonNullable<typeof s> => !!s);

  return (
    <>
      <TopBar title={card.name} subtitle={`${set.name} · ${formatCardNumber(card, set)}`} backTo={`/sets/${set.id}`} />
      <section className="card-detail">
        <div className="card-detail-art">
          <Img
            src={cardImageUrl(card, set.series, 'high')}
            alt={card.name}
            className="card-detail-img"
            fallback={<CardPlaceholder card={card} />}
            eager
          />
        </div>
        <div className="card-detail-body">
          <div className="owned-panel">
            <div className="owned-row">
              <div>
                <div className="owned-label">In collection</div>
                <div className="owned-status">{qty > 0 ? `${qty} ${qty === 1 ? 'copy' : 'copies'}` : 'Not owned'}</div>
              </div>
              <QtyStepper cardId={card.id} qty={qty} size="lg" />
            </div>
            <div className="owned-actions">
              <button
                type="button"
                className={`btn ${wanted ? 'primary' : ''}`}
                onClick={() => void toggleWanted(card.id)}
                aria-pressed={wanted}
              >
                <HeartIcon size={18} filled={wanted} /> {wanted ? 'On wishlist' : 'Add to wishlist'}
              </button>
              <button type="button" className="btn ghost" onClick={() => setShowVariants((v) => !v)}>
                {showVariants ? 'Hide variants' : 'Track variants'}
              </button>
            </div>
            {showVariants && (
              <div className="variants">
                {VARIANT_KEYS.map((k) => {
                  const n = entry?.variants?.[k] ?? (k === 'normal' && !entry?.variants ? qty : 0);
                  return (
                    <div key={k} className="variant-row">
                      <span className="variant-name">{VARIANT_LABELS[k]}</span>
                      <div className="stepper stepper-sm">
                        <button
                          type="button"
                          className="stepper-btn"
                          aria-label={`Remove one ${VARIANT_LABELS[k]}`}
                          disabled={n <= 0}
                          onClick={() => void adjustQty(card.id, -1, k)}
                        >
                          <MinusIcon size={16} />
                        </button>
                        <span className="stepper-value">{n}</span>
                        <button
                          type="button"
                          className="stepper-btn"
                          aria-label={`Add one ${VARIANT_LABELS[k]}`}
                          onClick={() => void adjustQty(card.id, 1, k)}
                        >
                          <PlusIcon size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <dl className="facts">
            <dt>Set</dt>
            <dd>
              <a className="link-row" href={href(`/sets/${set.id}`)}>
                <SetBadge set={set} size={28} /> {set.name}
                {set.abbr ? ` (${set.abbr})` : ''}
              </a>
            </dd>
            <dt>Number</dt>
            <dd>{formatCardNumber(card, set)}</dd>
            <dt>Category</dt>
            <dd>
              {card.cat}
              {card.stage ? ` · ${card.stage}` : ''}
            </dd>
            {card.types && (
              <>
                <dt>Type</dt>
                <dd className="type-icons">
                  {card.types.map((t) => (
                    <span key={t} className="type-icon-label">
                      <EnergyIcon type={t} size={20} /> {t}
                    </span>
                  ))}
                </dd>
              </>
            )}
            {card.hp !== undefined && (
              <>
                <dt>HP</dt>
                <dd>{card.hp}</dd>
              </>
            )}
            {card.rarity && (
              <>
                <dt>Rarity</dt>
                <dd>{card.rarity}</dd>
              </>
            )}
            {speciesList.length > 0 && (
              <>
                <dt>Pokédex</dt>
                <dd className="species-links">
                  {speciesList.map((s) => (
                    <a key={s.id} className="species-link" href={href(`/dex/${s.id}`)}>
                      <img src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${s.id}.png`} alt="" width={32} height={32} />
                      {dexNumber(s.id)} {s.name}
                    </a>
                  ))}
                </dd>
              </>
            )}
            <dt>Card id</dt>
            <dd className="mono">{card.id}</dd>
          </dl>

          <label className="note-field">
            <span>Note</span>
            <textarea
              value={note}
              placeholder="Condition, where it's stored, trade notes…"
              rows={2}
              onChange={(e) => setNoteText(e.target.value)}
              onBlur={() => {
                if ((entry?.note ?? '') !== note.trim()) void setNote(card.id, note);
              }}
            />
          </label>
        </div>
      </section>

      {otherPrintings.length > 0 && (
        <section>
          <h2 className="section-title">Other printings of {card.name}</h2>
          <CardGrid>
            {otherPrintings.map((c) => (
              <CardTile key={c.id} card={c} set={index.setsById.get(c.set)} entry={collection.get(c.id)} showSet />
            ))}
          </CardGrid>
        </section>
      )}
    </>
  );
}
