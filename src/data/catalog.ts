/**
 * Catalog loading and in-memory indexing.
 *
 * One game's catalog is loaded at a time (the active game in Settings) and
 * indexed into Maps so every page can answer "cards in set X", "cards
 * featuring species Y / archetype Z" and "card with id W" synchronously.
 */
import { isNative } from '@/app/platform';
import type { GameId } from '@/games/ids';
import { expandYgoCatalog, type YgoCatalogFile } from '@/games/ygo/catalog';
import {
  dataCacheMode,
  dataFileUrl,
  parseManifest,
  resolveManifest,
  usesManifest,
  versionMismatch,
  versionOf,
  type DataManifest,
} from './manifest';
import type { Catalog, CatalogCard, CatalogSet, Species, SpeciesFile } from './types';
import { normalizeText } from './normalize';

export interface SeriesGroup {
  id: string;
  name: string;
  /** Sets in this series, newest first. */
  sets: CatalogSet[];
}

/** A Yu-Gi-Oh! archetype and its printings. */
export interface Archetype {
  name: string;
  /** All printings, newest set first. */
  cards: CatalogCard[];
  /** Distinct cards (passcodes). */
  unique: number;
}

export interface CatalogIndex {
  game: GameId;
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
  /** Printings of a Yu-Gi-Oh! card (by passcode, alternate arts included), newest set first. */
  cardsByPasscode: Map<number, CatalogCard[]>;
  /** Printings per archetype, newest set first. */
  cardsByArchetype: Map<string, CatalogCard[]>;
  /** Archetypes sorted by name (empty for Pokémon). */
  archetypes: Archetype[];
  speciesById: Map<number, Species>;
  /** Series newest first, each with its sets newest first. */
  series: SeriesGroup[];
  /** Precomputed search text per card id (see search.ts). */
  searchText: Map<string, { name: string; all: string }>;
  /** Distinct rarity strings in display order (by frequency). */
  rarities: string[];
  /** Distinct `CatalogCard.types` values (energy types / attributes). */
  types: string[];
}

const DATA_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/data`;
const MANIFEST_URL = `${DATA_BASE}/manifest.json`;
/** localStorage key of the last manifest seen (web build only). */
const REMEMBERED_MANIFEST_KEY = 'cardcodex.dataManifest';

/**
 * How the catalogs are fetched, and why.
 *
 * The files are several MB and change only when a builder rewrites them, so
 * the web build asks for them with `cache: 'force-cache'`: an unchanged catalog
 * must never be downloaded twice. A static host cannot tell the browser
 * "still current" for a URL that never changes without a round trip per file,
 * so the versioning is moved into the URL: the small public/data/manifest.json
 * (fetched with `no-cache`, one conditional request per start) carries a
 * content hash per file and the catalog is requested as
 * `catalog.json?v=<hash>`. Unchanged → same URL → cache hit; rebuilt and
 * deployed → new URL → one download, and the browser, the service worker and
 * the host's CDN all miss exactly once. The service worker keeps one version
 * of each file for offline use (public/sw.js). This was chosen over a
 * stale-while-revalidate worker because it needs no second parse of a 3 MB
 * file to notice a change, no "reload for new data" prompt, and no ETag
 * support from the host, and because it also busts CDN caches.
 *
 * Dev keeps `no-cache` on plain URLs so a rebuilt catalog shows on the next
 * reload; the Android build reads bundled assets (a new APK is a new catalog),
 * so it keeps `force-cache` on plain URLs. Neither fetches the manifest.
 */
async function loadManifest(): Promise<DataManifest | null> {
  if (!usesManifest({ dev: import.meta.env.DEV, native: isNative() })) return null;
  return resolveManifest({
    fetchFresh: async () => {
      const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
      if (!res.ok) return null;
      return parseManifest(await res.json());
    },
    remembered: readRememberedManifest(),
    remember: rememberManifest,
  });
}

function readRememberedManifest(): DataManifest | null {
  try {
    const raw = localStorage.getItem(REMEMBERED_MANIFEST_KEY);
    return raw ? parseManifest(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function rememberManifest(manifest: DataManifest): void {
  try {
    localStorage.setItem(REMEMBERED_MANIFEST_KEY, JSON.stringify(manifest));
  } catch {
    /* storage disabled or full: the next start simply waits for the manifest */
  }
}

/** Fetches one data file (path relative to public/data) at the manifest's version. */
async function fetchJson<T extends { builtAt?: string }>(file: string, manifest: DataManifest | null): Promise<T> {
  const version = versionOf(manifest, file);
  const url = dataFileUrl(DATA_BASE, file, version);
  const cache = dataCacheMode({ dev: import.meta.env.DEV, native: isNative(), versioned: !!version });
  const res = await fetch(url, { cache });
  if (!res.ok) throw new Error(`Failed to load ${url}: HTTP ${res.status}`);
  const data = (await res.json()) as T;
  if (versionMismatch(manifest, file, data)) {
    console.warn(`[catalog] ${file} v=${version} was built ${data.builtAt}; manifest expected ${manifest?.files[file]?.builtAt}`);
  }
  return data;
}

/** Fetches a game's catalog JSON and builds the index. */
export async function loadCatalog(game: GameId = 'pokemon'): Promise<CatalogIndex> {
  const manifest = await loadManifest();
  if (game === 'ygo') {
    const file = await fetchJson<YgoCatalogFile>('ygo/catalog.json', manifest);
    return buildIndex(expandYgoCatalog(file), []);
  }
  const [catalog, speciesFile] = await Promise.all([
    fetchJson<Catalog>('catalog.json', manifest),
    fetchJson<SpeciesFile>('species.json', manifest),
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
  const cardsByPasscode = new Map<number, CatalogCard[]>();
  const cardsByArchetype = new Map<string, CatalogCard[]>();
  const searchText = new Map<string, { name: string; all: string }>();
  const rarityCount = new Map<string, number>();
  const typeSet = new Set<string>();
  const push = <K,>(m: Map<K, CatalogCard[]>, k: K, c: CatalogCard) => {
    const l = m.get(k);
    if (l) l.push(c);
    else m.set(k, [c]);
  };

  for (const card of catalog.cards) {
    cardsById.set(card.id, card);
    push(cardsBySet, card.set, card);
    if (card.dex) for (const dex of card.dex) push(cardsByDex, dex, card);
    const normName = normalizeText(card.name);
    push(cardsByName, normName, card);
    if (card.pc !== undefined) {
      push(cardsByPasscode, card.pc, card);
      if (card.alt) for (const a of card.alt) push(cardsByPasscode, a, card);
    }
    if (card.arc) push(cardsByArchetype, card.arc, card);

    const set = setsById.get(card.set);
    const setText = set ? `${normalizeText(set.name)} ${set.abbr.toLowerCase()}` : '';
    const extra = [card.pc, card.arc && normalizeText(card.arc), card.race && normalizeText(card.race)].filter(Boolean).join(' ');
    searchText.set(card.id, {
      name: normName,
      all: `${normName} | ${setText} ${card.num.toLowerCase()} ${card.id} ${card.set} ${set?.official ?? ''} ${extra}`,
    });

    if (card.rarity) rarityCount.set(card.rarity, (rarityCount.get(card.rarity) ?? 0) + 1);
    if (card.types) for (const t of card.types) typeSet.add(t);
  }

  // Newest printing first for species, name, passcode and archetype groups.
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
  for (const list of cardsByPasscode.values()) list.sort(byRecency);
  for (const list of cardsByArchetype.values()) list.sort(byRecency);
  const archetypes: Archetype[] = [...cardsByArchetype.entries()]
    .map(([name, cards]) => ({ name, cards, unique: new Set(cards.map((c) => c.pc)).size }))
    .sort((a, b) => a.name.localeCompare(b.name));

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
    game: catalog.game ?? 'pokemon',
    catalog,
    species,
    setsById,
    cardsById,
    cardsBySet,
    cardsByDex,
    cardsByName,
    cardsByPasscode,
    cardsByArchetype,
    archetypes,
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

/**
 * Printed number for display: with the set's denominator and zero padding
 * ("057/198") when the game numbers cards that way, else as printed ("LOB-EN001").
 */
export function formatCardNumber(card: CatalogCard, set: CatalogSet | undefined): string {
  if (!set) return card.num;
  const official = set.official;
  if (!official) return card.num;
  const width = String(official).length;
  const num = /^\d+$/.test(card.num) ? card.num.padStart(width, '0') : card.num;
  return `${num}/${official}`;
}
