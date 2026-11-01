/**
 * Card and species search over the in-memory catalog index.
 *
 * Matching is token-based: every query token must appear in the card's
 * search text (name, set name, set code, number, id). Results are ranked by
 * how well the NAME matches (exact > prefix > word prefix > substring > other
 * field), then by set recency. A token like "57/198" or "057/198" is treated
 * as a printed number and matched against number + set denominator.
 */
import type { CatalogIndex } from './catalog';
import { setRecency } from './catalog';
import type { CardCategory, CatalogCard, Species } from './types';
import { normalizeText, tokenize } from './normalize';
import type { CollectionMap } from './collection';

export type OwnedFilter = 'any' | 'owned' | 'missing' | 'wanted';

export interface SearchFilters {
  owned?: OwnedFilter;
  cat?: CardCategory | '';
  type?: string;
  rarity?: string;
  set?: string;
  series?: string;
}

export interface SearchResult {
  cards: CatalogCard[];
  /** Total matches before `limit` was applied. */
  total: number;
}

const NUMBER_RE = /^(\d+)\s*\/\s*(\d+)$/;

function nameRank(name: string, query: string, tokens: string[]): number {
  if (!query) return 5;
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(` ${query}`)) return 2;
  if (tokens.every((t) => name === t || name.startsWith(t) || name.includes(` ${t}`))) return 3;
  if (tokens.every((t) => name.includes(t))) return 4;
  return 6;
}

function passesFilters(
  card: CatalogCard,
  filters: SearchFilters,
  collection: CollectionMap | undefined,
  index: CatalogIndex,
): boolean {
  if (filters.cat && card.cat !== filters.cat) return false;
  if (filters.type && !(card.types ?? []).includes(filters.type)) return false;
  if (filters.rarity && card.rarity !== filters.rarity) return false;
  if (filters.set && card.set !== filters.set) return false;
  if (filters.series) {
    const set = index.setsById.get(card.set);
    if (!set || set.series !== filters.series) return false;
  }
  if (filters.owned && filters.owned !== 'any') {
    const e = collection?.get(card.id);
    const owned = !!e && e.qty > 0;
    if (filters.owned === 'owned' && !owned) return false;
    if (filters.owned === 'missing' && owned) return false;
    if (filters.owned === 'wanted' && !(e && e.wanted)) return false;
  }
  return true;
}

export function searchCards(
  index: CatalogIndex,
  query: string,
  filters: SearchFilters = {},
  collection?: CollectionMap,
  limit = 200,
): SearchResult {
  const raw = query.trim();
  // Printed-number query: "57/198" → number 57 in a set whose denominator is 198.
  const numMatch = NUMBER_RE.exec(raw);
  let numberQuery: { num: number; official: number } | undefined;
  let tokens: string[] = [];
  let normQuery = '';
  if (numMatch) {
    numberQuery = { num: Number(numMatch[1]), official: Number(numMatch[2]) };
  } else {
    normQuery = normalizeText(raw);
    tokens = tokenize(raw);
  }

  const scored: { card: CatalogCard; rank: number; recency: string }[] = [];
  for (const card of index.catalog.cards) {
    if (!passesFilters(card, filters, collection, index)) continue;
    let rank = 5;
    if (numberQuery) {
      const set = index.setsById.get(card.set);
      if (!set || set.official !== numberQuery.official) continue;
      if (!/^\d+$/.test(card.num) || Number(card.num) !== numberQuery.num) continue;
      rank = 0;
    } else if (tokens.length) {
      const text = index.searchText.get(card.id);
      if (!text) continue;
      let ok = true;
      for (const t of tokens) {
        if (!text.all.includes(t)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      rank = nameRank(text.name, normQuery, tokens);
    }
    const set = index.setsById.get(card.set);
    scored.push({ card, rank, recency: set ? setRecency(set) : '' });
  }
  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.recency !== b.recency) return a.recency < b.recency ? 1 : -1;
    return 0;
  });
  return { cards: scored.slice(0, limit).map((s) => s.card), total: scored.length };
}

/** Species matching a name fragment or a dex number. */
export function searchSpecies(index: CatalogIndex, query: string, limit = 50): Species[] {
  const raw = query.trim();
  if (!raw) return index.species.slice(0, limit);
  if (/^#?\d+$/.test(raw)) {
    const id = Number(raw.replace('#', ''));
    const s = index.speciesById.get(id);
    return s ? [s] : [];
  }
  const q = normalizeText(raw);
  const starts: Species[] = [];
  const contains: Species[] = [];
  for (const s of index.species) {
    const n = normalizeText(s.name);
    if (n.startsWith(q)) starts.push(s);
    else if (n.includes(q)) contains.push(s);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}
