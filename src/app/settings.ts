/**
 * Per-device preferences in localStorage (active game, theme, grid density,
 * scanner engine). Wrapped in try/catch: storage can be unavailable in
 * private windows and the app must still render.
 */
import { useCallback, useEffect, useState } from 'react';
import { isGameId, type GameId } from '@/games/ids';

export type Theme = 'system' | 'dark' | 'light';
export type TileSize = 'small' | 'medium' | 'large';

export interface Settings {
  /** Which card game the app shows. The collection keeps every game's cards. */
  game: GameId;
  theme: Theme;
  tileSize: TileSize;
  /** Dim cards you don't own in set binders. */
  dimMissing: boolean;
  /** Prefer the on-device ML Kit engine on Android when available. */
  scanEngine: 'auto' | 'tesseract';
  /** Scanner mode the Scan tab opens in. */
  scanMode: 'cards' | 'page';
  /** Binder page layout id (see PAGE_LAYOUTS in src/scanner/page.ts). */
  pageLayout: string;
  /**
   * Where the page guide sat the last time a page was scanned, per layout id,
   * as fractions of the visible camera view. The next scan starts from it, so
   * a binder photographed from the same spot needs no lining up.
   */
  pageFrames: Record<string, { x: number; y: number; w: number; h: number }>;
  /** Binder-page mode presses the shutter by itself once the grid holds steady (src/scanner/autocapture.ts). */
  autoCapture: boolean;
  /** The guided tour was completed or skipped. */
  tourDone: boolean;
  /** Self-hosted mirror of the YGOPRODeck image folders ("" = YGOPRODeck itself). */
  ygoImageBase: string;
}

const KEY = 'cardcodex.settings';
const DEFAULTS: Settings = {
  game: 'pokemon',
  theme: 'system',
  tileSize: 'medium',
  dimMissing: true,
  scanEngine: 'auto',
  scanMode: 'cards',
  pageLayout: '3x3',
  pageFrames: {},
  autoCapture: true,
  tourDone: false,
  ygoImageBase: '',
};

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const s = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
    if (!isGameId(s.game)) s.game = DEFAULTS.game;
    return s;
  } catch {
    return DEFAULTS;
  }
}

function write(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const listeners = new Set<() => void>();
let current = read();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  write(current);
  applyTheme(current.theme);
  for (const l of listeners) l();
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [state, setState] = useState(current);
  useEffect(() => {
    const l = () => setState(current);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  const update = useCallback((patch: Partial<Settings>) => updateSettings(patch), []);
  return [state, update];
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0f1115' : '#f6f7fb');
}

applyTheme(current.theme);
