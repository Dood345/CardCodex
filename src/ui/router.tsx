/**
 * Tiny hash router. Hash routes work identically on a static host, inside the
 * Capacitor WebView and on GitHub Pages, with no server configuration.
 *
 * Routes:
 *   #/dex                 Pokédex grid
 *   #/dex/:id             Species page
 *   #/sets                Series/sets
 *   #/sets/:id            Set binder
 *   #/card/:id            Card detail
 *   #/search?q=...        Search
 *   #/collection          Collection + wishlist
 *   #/scan                Camera scanner
 *   #/settings            Settings / data
 *
 * The main pane's scroll position is remembered per history entry
 * (src/ui/scroll-memory.ts): a fresh page starts at the top, a page the
 * user comes back to is where they left it.
 */
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { mainPane } from './pane';
import { noteNavigation, primeScrollMemory, settlePane } from './scroll-memory';

export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/dex';
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  const segments = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { path, segments, query: new URLSearchParams(queryPart) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    primeScrollMemory();
    const onChange = () => {
      // Before the re-render, while the old page is still on screen.
      noteNavigation(mainPane());
      setRoute(parseHash(window.location.hash));
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/**
 * Go to `path`. With `replace` the current history entry is rewritten in
 * place (its state, and so its scroll-memory key, kept) and the router is
 * told at once, since replaceState fires no event of its own.
 */
export function navigate(path: string, replace = false): void {
  const hash = href(path);
  if (window.location.hash === hash) return;
  if (!replace) {
    window.location.hash = hash;
    return;
  }
  const oldURL = window.location.href;
  try {
    window.history.replaceState(window.history.state, '', hash);
  } catch {
    window.location.replace(hash);
    return;
  }
  const detail = { oldURL, newURL: window.location.href };
  window.dispatchEvent(typeof HashChangeEvent === 'function' ? new HashChangeEvent('hashchange', detail) : new Event('hashchange'));
}

export function back(fallback = '/dex'): void {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback, true);
}

export function href(path: string): string {
  return `#${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Settles the main pane after each route change, before paint: a fresh
 * page at the top, a revisited page where the user left it, the same page
 * (a rewritten query) untouched.
 */
export function usePaneScroll(route: Route): void {
  const key = `${route.path}?${route.query.toString()}`;
  useLayoutEffect(() => {
    const main = mainPane();
    if (main) settlePane(main);
  }, [key]);
}

/** Returns the current query string value and a setter that rewrites the hash. */
export function useQueryParam(route: Route, name: string): [string, (v: string) => void] {
  const value = route.query.get(name) ?? '';
  const set = useCallback(
    (v: string) => {
      const q = new URLSearchParams(route.query);
      if (v) q.set(name, v);
      else q.delete(name);
      const qs = q.toString();
      navigate(`${route.path}${qs ? `?${qs}` : ''}`, true);
    },
    [route, name],
  );
  return [value, set];
}
