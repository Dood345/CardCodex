/**
 * The games CardCodex knows. One is active at a time (Settings → Game); its
 * profile drives catalog loading, the browse tab, card facts and the scanner.
 */
import type { GameId } from './ids';
import { mtg } from './mtg';
import { pokemon } from './pokemon';
import type { GameProfile } from './types';
import { ygo } from './ygo';

export const GAMES: readonly GameProfile[] = [pokemon, ygo, mtg];

export function gameById(id: GameId): GameProfile {
  return GAMES.find((g) => g.id === id) ?? pokemon;
}

export type { GameId } from './ids';
export type { GameProfile } from './types';
