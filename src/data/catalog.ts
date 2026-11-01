/**
 * Catalog loading and in-memory indexing.
 *
 * The catalog (every English TCG card) and the species list ship as static
 * JSON under /data. They are loaded once at startup and indexed into Maps so
 * every page can answer "cards in set X", "cards featuring species Y" and
 * "card with id Z" synchronously.
 */
import type { Catalog, CatalogCard, CatalogSet, Species, SpeciesFile } from './types';
import { normalizeText } from './normalize';

export interface SeriesGroup {
  id: string;
  name: string;
  /** Sets in this series, newest first. */
  sets: CatalogSet[];
}

export interface CatalogIndex {
  catalog: Catalog;
  species: Species[];
  setsById: Map<string, CatalogSet>;
  cardsById: Map<string, CatalogCard>;
  /** Cards in catalog (number) order per set. */
  cardsBySet: Map<string, CatalogCard[]>;
  /** Cards featuring a species (National Dex id), newest set first. */
  cardsByDex: Map<number, CatalogCard[]>;
  /** Cards sharing a normalized name (all printings), newest set first. */
  cardsByName: Map<string, CatalogCard[]>;
  speciesById: Map<number, Species>;
  /** Series newest first, each with its sets newest first. */
  series: SeriesGroup[];
  /** Precomputed search text per card id (see search.ts). */
  searchText: Map<string, { name: string; all: string }>;
  /** Distinct rarity strings in display order (by frequency). */
  rarities: string[];
  /** Distinct TCG types. */
  types: string[];
}

const DATA_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/data`;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`Failed to load ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Fetches catalog + species JSON and builds the index. */
export async function loadCatalog(): Promise<CatalogIndex> {
  const [catalog, speciesFile] = await Promise.all([
    fetchJson<Catalog>(`${DATA_BASE}/catalog.json`),
    fetchJson<SpeciesFile>(`${DATA_BASE}/species.json`),
  ]);
  return buildIndex(catalog, speciesFile.species);
}

/** Set release order key: newer first; unknown dates sort last. */
export function setRecency(set: CatalogSet): string {
  return set.releaseDate || '0000-00-00';
}

/** Builds all lookup maps. Pure; also used by tests with fixture catalogs. */
export function buildIndex(catalog: Catalog, species: Species[]): CatalogIndex {
  const setsById = new Map<string, CatalogSet>();
  for (const set of catalog.sets) setsById.set(set.id, set);

  const cardsById = new Map<string, CatalogCard>();
  const cardsBySet = new Map<string, CatalogCard[]>();
  const cardsByDex = new Map<number, CatalogCard[]>();
  const cardsByName = new Map<string, CatalogCard[]>();
  const searchText = new Map<string, { name: string; all: string }>();
  const rarityCount = new Map<string, number>();
  const typeSet = new Set<string>();

  for (const card of catalog.cards) {
    cardsById.set(card.id, card);
    let list = cardsBySet.get(card.set);
    if (!list) cardsBySet.set(card.set, (list = []));
    list.push(card);

    if (card.dex) {
      for (const dex of card.dex) {
        let dl = cardsByDex.get(dex);
        if (!dl) cardsByDex.set(dex, (dl = []));
        dl.push(card);
      }
    }
    const normName = normalizeText(card.name);
    let nl = cardsByName.get(normName);
    if (!nl) cardsByName.set(normName, (nl = []));
    nl.push(card);

    const set = setsById.get(card.set);
    const setText = set ? `${normalizeText(set.name)} ${set.abbr.toLowerCase()}` : '';
    searchText.set(card.id, {
      name: normName,
      all: `${normName} | ${setText} ${card.num.toLowerCase()} ${card.id} ${card.set} ${set?.official ?? ''}`,
    });

    if (card.rarity) rarityCount.set(card.rarity, (rarityCount.get(card.rarity) ?? 0) + 1);
    if (card.types) for (const t of card.types) typeSet.add(t);
  }

  // Newest printing first for species and name groups.
  const byRecency = (a: CatalogCard, b: CatalogCard) => {
    const sa = setsById.get(a.set);
    const sb = setsById.get(b.set);
    const ra = sa ? setRecency(sa) : '';
    const rb = sb ? setRecency(sb) : '';
    if (ra !== rb) return ra < rb ? 1 : -1;
    return 0; // keep catalog (number) order within a set
  };
  for (const list of cardsByDex.values()) list.sort(byRecency);
  for (const list of cardsByName.values()) list.sort(byRecency);

  const speciesById = new Map<number, Species>();
  for (const s of species) speciesById.set(s.id, s);

  // Series groups, newest first (by the newest set in the series).
  const seriesMap = new Map<string, SeriesGroup>();
  for (const set of catalog.sets) {
    let g = seriesMap.get(set.series);
    if (!g) seriesMap.set(set.series, (g = { id: set.series, name: set.seriesName, sets: [] }));
    g.sets.push(set);
  }
  const series = [...seriesMap.values()];
  for (const g of series) g.sets.sort((a, b) => (setRecency(a) < setRecency(b) ? 1 : setRecency(a) > setRecency(b) ? -1 : a.id < b.id ? -1 : 1));
  series.sort((a, b) => {
    const ra = a.sets[0] ? setRecency(a.sets[0]) : '';
    const rb = b.sets[0] ? setRecency(b.sets[0]) : '';
    return ra < rb ? 1 : ra > rb ? -1 : 0;
  });

  const rarities = [...rarityCount.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
  const types = [...typeSet].sort();

  return {
    catalog,
    species,
    setsById,
    cardsById,
    cardsBySet,
    cardsByDex,
    cardsByName,
    speciesById,
    series,
    searchText,
    rarities,
    types,
  };
}

/** Numeric-aware comparison of printed card numbers ("2" < "10" < "TG01"). */
export function compareCardNum(a: string, b: string): number {
  const na = /^\d+$/.test(a);
  const nb = /^\d+$/.test(b);
  if (na && nb) return Number(a) - Number(b);
  if (na) return -1;
  if (nb) return 1;
  return a.localeCompare(b, undefined, { numeric: true });
}

/** Printed number with the set's denominator, e.g. "057/198". */
export function formatCardNumber(card: CatalogCard, set: CatalogSet | undefined): string {
  if (!set) return card.num;
  const official = set.official;
  if (!official) return card.num;
  const width = String(official).length;
  const num = /^\d+$/.test(card.num) ? card.num.padStart(width, '0') : card.num;
  return `${num}/${official}`;
}
