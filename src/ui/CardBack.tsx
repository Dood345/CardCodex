/**
 * A drawn card back: the placeholder for a card whose picture is missing or
 * has not loaded. The publishers' real backs are their artwork, so this is
 * our own, in each game's colour with its icon. It fills whatever card-shaped
 * box it is given.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { CatalogCard } from '@/data/types';
import { gameById } from '@/games';
import { gameOfId, type GameId } from '@/games/ids';

const BACK_COLORS: Record<GameId, string> = { pokemon: '#2457a8', ygo: '#6a3d8f', mtg: '#7a4a24' };

export function CardBack({ game, label, children }: { game: GameId; label?: string; children?: ReactNode }) {
  const { Icon } = gameById(game);
  return (
    <div className="card-back" style={{ '--back': BACK_COLORS[game] } as CSSProperties}>
      <div className="card-back-inner">
        {children ?? <Icon size={28} />}
        {label && <span className="card-back-label">{label}</span>}
      </div>
    </div>
  );
}

/** The back for a card of whichever game its id belongs to. */
export function CardBackFor({ card, label = true, children }: { card: CatalogCard; label?: boolean; children?: ReactNode }) {
  return (
    <CardBack game={gameOfId(card.id)} label={label ? card.name : undefined}>
      {children}
    </CardBack>
  );
}
