/**
 * The colours a person can choose in Settings → Appearance, on top of the light or dark theme: an accent
 * colour (buttons, the active tab, the quick scroll, progress bars) and, in the dark theme, a true black
 * background for OLED screens.
 *
 * The values here are the ones src/styles.css applies (`:root[data-accent='…']`, `:root[data-black]`);
 * themes.test.ts holds the two together and checks each accent stays readable on both themes.
 */

export interface Accent {
  id: string;
  label: string;
  /** Buttons, links, the active tab. */
  accent: string;
  /** The same colour a step lighter: the active tab's label and icon, hover and pressed states. */
  strong: string;
  /** Text on the accent. */
  fg: string;
}

/**
 * The first is the default: the Pokédex red the app has always had. Every accent has to read on the dark, the
 * black and the light background alike, which rules out the bright yellows (amber on white is 2.1 to 1).
 */
export const ACCENTS: readonly Accent[] = [
  { id: 'red', label: 'Red', accent: '#e3350d', strong: '#ff4a22', fg: '#ffffff' },
  { id: 'blue', label: 'Blue', accent: '#2563eb', strong: '#3b82f6', fg: '#ffffff' },
  { id: 'green', label: 'Green', accent: '#15803d', strong: '#1a9a4a', fg: '#ffffff' },
  { id: 'teal', label: 'Teal', accent: '#0f766e', strong: '#14958b', fg: '#ffffff' },
  { id: 'purple', label: 'Purple', accent: '#8b5cf6', strong: '#9b72f8', fg: '#ffffff' },
  { id: 'pink', label: 'Pink', accent: '#db2777', strong: '#ec4899', fg: '#ffffff' },
];

export type AccentId = string;
export const DEFAULT_ACCENT = ACCENTS[0].id;

export function isAccentId(v: unknown): v is AccentId {
  return typeof v === 'string' && ACCENTS.some((a) => a.id === v);
}

/** The page backgrounds, for the browser's theme colour (the status bar on a phone). */
export const PAGE_BG = { dark: '#0f1115', black: '#000000', light: '#f6f7fb' } as const;

/** Relative luminance of a `#rrggbb` colour (WCAG 2). */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** Contrast ratio of two `#rrggbb` colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Put the appearance on the document: the theme, the accent and the true black background. `systemDark`:
 * what the device asks for, used when the theme is "system".
 */
export function applyAppearance(a: { theme: 'system' | 'dark' | 'light'; accent: AccentId; trueBlack: boolean }, systemDark: boolean, root: HTMLElement, meta: Element | null): void {
  if (a.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', a.theme);
  if (isAccentId(a.accent) && a.accent !== DEFAULT_ACCENT) root.setAttribute('data-accent', a.accent);
  else root.removeAttribute('data-accent');
  if (a.trueBlack) root.setAttribute('data-black', 'on');
  else root.removeAttribute('data-black');
  const dark = a.theme === 'dark' || (a.theme === 'system' && systemDark);
  if (meta) meta.setAttribute('content', dark ? (a.trueBlack ? PAGE_BG.black : PAGE_BG.dark) : PAGE_BG.light);
}
