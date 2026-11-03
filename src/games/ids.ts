/**
 * Game identifiers and the card-id namespace rule. Pure; safe to import from
 * anywhere (data layer, tests, scanner).
 *
 * Card ids are global across games because the collection store is keyed by
 * card id alone. The original Pokémon catalog keeps its bare TCGdex ids
 * ("sv01-057") so existing collections need no migration; every later game
 * prefixes its ids ("ygo:LOB-EN001", "mtg:lea-161").
 */
export type GameId = 'pokemon' | 'ygo' | 'mtg';

export const GAME_IDS: readonly GameId[] = ['pokemon', 'ygo', 'mtg'];

export const YGO_ID_PREFIX = 'ygo:';
/** Magic ids are `mtg:<lowercase set code>-<collector number>`; numbers may carry letters or ★. */
export const MTG_ID_PREFIX = 'mtg:';

export function isGameId(v: unknown): v is GameId {
  return v === 'pokemon' || v === 'ygo' || v === 'mtg';
}

/** Which game a card id belongs to (by its prefix). */
export function gameOfId(cardId: string): GameId {
  if (cardId.startsWith(YGO_ID_PREFIX)) return 'ygo';
  if (cardId.startsWith(MTG_ID_PREFIX)) return 'mtg';
  return 'pokemon';
}
