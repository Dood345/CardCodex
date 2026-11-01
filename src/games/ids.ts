/**
 * Game identifiers and the card-id namespace rule. Pure; safe to import from
 * anywhere (data layer, tests, scanner).
 *
 * Card ids are global across games because the collection store is keyed by
 * card id alone. The original Pokémon catalog keeps its bare TCGdex ids
 * ("sv01-057") so existing collections need no migration; every later game
 * prefixes its ids ("ygo:LOB-EN001").
 */
export type GameId = 'pokemon' | 'ygo';

export const GAME_IDS: readonly GameId[] = ['pokemon', 'ygo'];

export const YGO_ID_PREFIX = 'ygo:';

export function isGameId(v: unknown): v is GameId {
  return v === 'pokemon' || v === 'ygo';
}

/** Which game a card id belongs to (by its prefix). */
export function gameOfId(cardId: string): GameId {
  return cardId.startsWith(YGO_ID_PREFIX) ? 'ygo' : 'pokemon';
}
