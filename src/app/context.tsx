import { createContext, useContext } from 'react';
import type { CatalogIndex } from '@/data/catalog';

const CatalogContext = createContext<CatalogIndex | null>(null);

export const CatalogProvider = CatalogContext.Provider;

/** The loaded catalog index. Only rendered pages call this, so it is never null. */
export function useCatalog(): CatalogIndex {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error('Catalog not loaded');
  return ctx;
}
