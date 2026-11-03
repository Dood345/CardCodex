/**
 * Scryfall card objects → the Magic catalog file (./catalog.ts). Pure, and
 * free of runtime imports so scripts/build-mtg-catalog.mjs can import this
 * file straight from Node (type stripping) while vitest tests the same code.
 *
 * Source: the `default_cards` bulk file (every card object, English where an
 * English printing exists) and the /sets list, both from
 * https://api.scryfall.com. Only fields the catalog keeps are typed here.
 */
import type { MtgCardRow, MtgCatalogFile, MtgPrintingRow, MtgSetRow } from './catalog';

export interface ScryfallFace {
  name?: string;
  type_line?: string;
  mana_cost?: string;
  cmc?: number;
  colors?: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  oracle_id?: string;
}

export interface ScryfallCard extends ScryfallFace {
  id: string;
  name: string;
  lang: string;
  layout: string;
  set: string;
  set_name: string;
  set_type: string;
  collector_number: string;
  released_at?: string;
  rarity: string;
  digital?: boolean;
  oversized?: boolean;
  games?: string[];
  artist?: string;
  card_faces?: ScryfallFace[];
}

export interface ScryfallSet {
  code: string;
  name: string;
  released_at?: string;
  set_type: string;
  digital?: boolean;
}

/** Set types that are not collectible game cards (tokens, art cards, gold-bordered replicas, minigame inserts) or exist only online. */
export const SKIPPED_SET_TYPES = new Set(['token', 'memorabilia', 'minigame', 'alchemy']);
/** Layouts that are not game cards, wherever they were printed. */
export const SKIPPED_LAYOUTS = new Set(['token', 'double_faced_token', 'emblem', 'art_series']);

/** Why a Scryfall card is left out of the catalog, or null when it is kept. */
export function skipReason(c: ScryfallCard): string | null {
  if (c.lang !== 'en') return 'not English';
  if (c.digital || (c.games && !c.games.includes('paper'))) return 'digital only';
  if (SKIPPED_SET_TYPES.has(c.set_type)) return `${c.set_type} set`;
  if (SKIPPED_LAYOUTS.has(c.layout)) return `${c.layout} layout`;
  // Planes, schemes, Vanguard and oversized commanders: display pieces, not deck cards.
  if (c.oversized) return 'oversized';
  if (!oracleIdOf(c)) return 'no Oracle id';
  return null;
}

/** Reversible cards carry their Oracle id on the faces only. */
export function oracleIdOf(c: ScryfallCard): string | undefined {
  return c.oracle_id ?? c.card_faces?.[0]?.oracle_id;
}

/** The Oracle-level row of a card (same for every printing). */
export function cardRowOf(c: ScryfallCard): MtgCardRow {
  const front = c.card_faces?.[0] ?? {};
  const pick = <K extends keyof ScryfallFace>(k: K): ScryfallFace[K] => c[k] ?? front[k];
  const typeLine = c.type_line ?? (c.card_faces ?? []).map((f) => f.type_line ?? '').join(' // ');
  // Reversible cards print the same card on both sides ("Sol Ring // Sol Ring"): name it once, like its other printings.
  const same = (s: string) => {
    const parts = s.split(' // ');
    return parts.length > 1 && parts.every((p) => p === parts[0]) ? parts[0] : s;
  };
  const row: MtgCardRow = {
    oid: oracleIdOf(c) ?? '',
    name: same(c.name.trim()),
    tl: same(typeLine),
    mv: pick('cmc') ?? 0,
  };
  const cost = pick('mana_cost');
  if (cost) row.cost = cost;
  const colors = pick('colors') ?? [];
  const col = 'WUBRG'.split('').filter((l) => colors.includes(l)).join('');
  if (col) row.col = col;
  const pow = pick('power');
  const tou = pick('toughness');
  if (pow !== undefined) row.pow = pow;
  if (tou !== undefined) row.tou = tou;
  const loy = pick('loyalty');
  if (loy !== undefined) row.loy = loy;
  const def = pick('defense');
  if (def !== undefined) row.def = def;
  return row;
}

/** Collector-number order: plain numbers by value ("2" < "10" < "10a"), then the rest ("PF19-1", "★1"). */
export function compareCollector(a: string, b: string): number {
  const ma = /^(\d+)(.*)$/.exec(a);
  const mb = /^(\d+)(.*)$/.exec(b);
  if (ma && mb) return Number(ma[1]) - Number(mb[1]) || ma[2].localeCompare(mb[2], 'en');
  if (ma) return -1;
  if (mb) return 1;
  return a.localeCompare(b, 'en', { numeric: true });
}

export interface BuildResult {
  file: MtgCatalogFile;
  /** Cards left out, by reason. */
  skipped: Map<string, number>;
  /** Set codes the cards named that /sets did not list (built from the cards instead). */
  synthesizedSets: string[];
}

/**
 * Builds the catalog file. `cards` may be any iterable (the script streams the
 * bulk file); `sets` is Scryfall's /sets list. Throws on a duplicate printing id.
 */
export function buildMtgCatalog(cards: Iterable<ScryfallCard>, sets: ScryfallSet[], builtAt: string): BuildResult {
  const skipped = new Map<string, number>();
  const setInfo = new Map(sets.map((s) => [s.code.toLowerCase(), s]));
  const rows = new Map<string, MtgCardRow>();
  interface Pending {
    oid: string;
    set: string;
    num: string;
    rarity: string;
    sid: string;
    artist: string;
  }
  const pending: Pending[] = [];
  const seen = new Set<string>();
  const synthesized = new Map<string, { name: string; date: string }>();

  for (const c of cards) {
    const reason = skipReason(c);
    if (reason) {
      skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
      continue;
    }
    const set = c.set.toLowerCase();
    const num = c.collector_number.trim();
    const key = `${set}-${num}`;
    if (seen.has(key)) throw new Error(`duplicate printing ${key} (${c.name})`);
    seen.add(key);
    const oid = oracleIdOf(c)!;
    if (!rows.has(oid)) rows.set(oid, cardRowOf(c));
    if (!setInfo.has(set) && !synthesized.has(set)) synthesized.set(set, { name: c.set_name, date: c.released_at ?? '' });
    pending.push({ oid, set, num, rarity: (c.rarity || '').charAt(0), sid: c.id, artist: (c.artist ?? '').trim() });
  }

  // Sets that have printings, oldest first (then by code), as the other games' files.
  const countBySet = new Map<string, number>();
  for (const p of pending) countBySet.set(p.set, (countBySet.get(p.set) ?? 0) + 1);
  const setRows: MtgSetRow[] = [...countBySet.keys()]
    .map((id) => {
      const s = setInfo.get(id);
      const syn = synthesized.get(id);
      return { id, name: s?.name ?? syn?.name ?? id.toUpperCase(), date: s?.released_at ?? syn?.date ?? '', total: countBySet.get(id) ?? 0 };
    })
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.id.localeCompare(b.id));
  const setIndex = new Map(setRows.map((s, i) => [s.id, i]));

  // Cards by name (then Oracle id) and artists by name: stable across rebuilds, so diffs stay small.
  const cardRows = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.oid.localeCompare(b.oid));
  const cardIndex = new Map(cardRows.map((r, i) => [r.oid, i]));
  const artists = [...new Set(pending.map((p) => p.artist).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en'));
  const artistIndex = new Map(artists.map((a, i) => [a, i]));

  const printings: MtgPrintingRow[] = pending.map((p) => [
    cardIndex.get(p.oid)!,
    setIndex.get(p.set)!,
    p.num,
    p.rarity,
    p.sid,
    p.artist ? artistIndex.get(p.artist)! : -1,
  ]);
  printings.sort((a, b) => a[1] - b[1] || compareCollector(a[2], b[2]));

  return {
    file: { version: 1, game: 'mtg', builtAt, sets: setRows, cards: cardRows, artists, printings },
    skipped,
    synthesizedSets: [...synthesized.keys()],
  };
}
