/**
 * The maths behind the quick scroll zone (QuickScroll.tsx): a list's
 * sections and the mapping between a point along the zone and a position
 * in the list.
 *
 * With sections (the Pokédex by hundreds, archetypes by first letter) the
 * zone is divided equally between them, as a contacts index is: every
 * label is readable whatever the section's size, dragging across a label
 * moves through that section, and a tap on a label jumps to its start.
 * Without sections the zone maps to the list proportionally.
 */

export interface Section {
  label: string;
  /** Index of the section's first item. */
  start: number;
}

/** Consecutive runs of items sharing a label, in list order. */
export function sectionsBy<T>(items: readonly T[], labelOf: (item: T) => string): Section[] {
  const out: Section[] = [];
  items.forEach((item, i) => {
    const label = labelOf(item);
    if (!out.length || out[out.length - 1].label !== label) out.push({ label, start: i });
  });
  return out;
}

/** Index letter for a name: its first letter, upper-cased and unaccented; '#' when it starts with anything else. */
export function initialOf(name: string): string {
  const first = name.trim().normalize('NFD').replace(/[̀-ͯ]/g, '')[0]?.toUpperCase() ?? '#';
  return /[A-Z]/.test(first) ? first : '#';
}

/**
 * A label short enough for the zone, for a section named by a phrase: a year
 * stays a year ("2024"), a phrase becomes its initials ("Scarlet & Violet" →
 * "SV", "Call of Legends" → "COL"), one word its first three letters
 * ("Platinum" → "PLA").
 */
export function shortLabel(name: string): string {
  const text = name.trim();
  if (/^\d{2,4}$/.test(text)) return text;
  const words = text.split(/[^\p{L}\p{N}']+/u).filter(Boolean);
  if (!words.length) return '#';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .map((w) => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

/** Hundreds label for a Pokédex number: "1" up to 99, then "100", "200", … */
export function hundredOf(id: number): string {
  const h = Math.floor(id / 100) * 100;
  return String(h || 1);
}

const clamp01 = (f: number) => Math.min(0.999999, Math.max(0, f));

/** Fractional list position (0 ≤ p < count) for a point `f` (0–1) along the zone. */
export function positionAt(f: number, count: number, sections: readonly Section[]): number {
  if (count <= 0) return 0;
  f = clamp01(f);
  const n = sections.length;
  if (n < 2) return f * count;
  const i = Math.min(n - 1, Math.floor(f * n));
  const start = sections[i].start;
  const end = i + 1 < n ? sections[i + 1].start : count;
  return start + (f * n - i) * (end - start);
}

/** Point along the zone (0–1) where item `index` sits: the inverse of positionAt. */
export function fractionOf(index: number, count: number, sections: readonly Section[]): number {
  if (count <= 0) return 0;
  const n = sections.length;
  if (n < 2) return clamp01(index / count);
  let i = 0;
  while (i + 1 < n && sections[i + 1].start <= index) i++;
  const start = sections[i].start;
  const end = i + 1 < n ? sections[i + 1].start : count;
  const within = end > start ? (index - start) / (end - start) : 0;
  return clamp01((i + within) / n);
}

/** Draw every k-th label so that drawn labels are at least `minGap` px apart in a zone `height` px tall. */
export function labelStride(sectionCount: number, height: number, minGap: number): number {
  if (sectionCount <= 0 || height <= 0) return 1;
  return Math.max(1, Math.ceil((sectionCount * minGap) / height));
}
