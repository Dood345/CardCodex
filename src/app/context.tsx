import { createContext, useContext } from 'react';
import type { CatalogIndex } from '@/data/catalog';
import { gameById } from '@/games';
import type { GameProfile } from '@/games/types';

const CatalogContext = createContext<CatalogIndex | null>(null);

export const CatalogProvider = CatalogContext.Provider;

/** The loaded catalog index. Only rendered pages call this, so it is never null. */
export function useCatalog(): CatalogIndex {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error('Catalog not loaded');
  return ctx;
}

/** The profile of the game whose catalog is loaded. */
export function useGame(): GameProfile {
  return gameById(useCatalog().game);
}
