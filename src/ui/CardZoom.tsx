/**
 * A card, large, over whatever screen you are on: the full picture, its name
 * and printing, and a link to its card page. For lists whose rows show a
 * thumbnail too small to read (a deck's lines): tap a row to check the card
 * without leaving the list. Tapping the picture or the dark area, the Android
 * back button and Escape all close it.
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { formatCardNumber } from '@/data/catalog';
import { cardImageUrl, type CatalogCard, type CatalogSet } from '@/data/types';
import { useBackHandler } from './back';
import { CardPlaceholder, Img } from './components';
import { href } from './router';

/** Physical card proportions by id prefix: Yu-Gi-Oh! cards are a little narrower than Pokémon and Magic cards. */
export function cardAspect(card: Pick<CatalogCard, 'pc'>): string {
  return card.pc !== undefined ? '59 / 86' : '63 / 88';
}

export function CardZoom({
  card,
  set,
  note,
  onClose,
}: {
  card: CatalogCard;
  set: CatalogSet | undefined;
  /** A line under the printing, e.g. "2 in deck · own 3". */
  note?: string;
  onClose: () => void;
}) {
  useBackHandler(true, onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="card-zoom" role="dialog" aria-modal="true" aria-label={card.name} onClick={onClose}>
      <button type="button" className="card-zoom-art" style={{ aspectRatio: cardAspect(card) }} aria-label={`Close the larger view of ${card.name}`} onClick={onClose}>
        <Img src={set ? cardImageUrl(card, set.series, 'high') : undefined} alt={card.name} className="card-zoom-img" fallback={<CardPlaceholder card={card} />} eager />
      </button>
      <div className="card-zoom-caption" onClick={(e) => e.stopPropagation()}>
        <div className="card-zoom-name">{card.name}</div>
        <div className="card-zoom-sub">
          {set?.name ?? card.set} · {formatCardNumber(card, set)}
        </div>
        {note && <div className="card-zoom-sub">{note}</div>}
        <div className="card-zoom-actions">
          <a className="btn" href={href(`/card/${card.id}`)} onClick={onClose}>
            Card page
          </a>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
