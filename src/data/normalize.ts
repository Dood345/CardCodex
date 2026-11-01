/**
 * Text normalization shared by search and indexing: lowercase, strip
 * diacritics ("Flabébé" → "flabebe"), fold symbols ("Nidoran♀" → "nidoran f",
 * "Farfetch'd" → "farfetchd"), keep only letters/digits/spaces.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/♀/g, ' f')
    .replace(/♂/g, ' m')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Tokens of a normalized query string. */
export function tokenize(input: string): string[] {
  const n = normalizeText(input);
  return n ? n.split(' ') : [];
}
