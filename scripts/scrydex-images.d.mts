// Types for scripts/scrydex-images.mjs, so src/data/card-images.test.ts can import its pure helpers.
export const SCRYDEX_IMAGES: string;
export function md5(buf: Uint8Array): string;
export function nameKey(name: string): string;
export function numberKey(num: string | number): string;

export interface ScrydexExpansion {
  id: string;
  slug: string;
  name: string;
}
export interface ScrydexCard {
  id: string;
  name: string;
  num: string;
  /** Picture base URL as the expansion page gives it, without the size. */
  image: string;
}
interface CardLike {
  id: string;
  set: string;
  num: string;
  name: string;
  img?: true | string;
}

export function parseExpansionList(html: string): ScrydexExpansion[];
export function parseExpansionPage(html: string): { cards: ScrydexCard[]; next?: string };
export function expansionCandidates(set: { id: string; name: string }, expansions: ScrydexExpansion[]): string[];
export function pairCards<C extends CardLike>(cards: C[], setCards: CardLike[], expansionCards: ScrydexCard[]): { pairs: Map<C, ScrydexCard>; byName: number; mismatched: string[] };
export function scrydexPlaceholder(cacheDir: string, options?: { noCache?: boolean }): Promise<{ md5: string; bytes: number }>;
