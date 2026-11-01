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
 */
import { useCallback, useEffect, useState } from 'react';

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
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(path: string, replace = false): void {
  const hash = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (replace) window.location.replace(hash);
  else window.location.hash = hash;
}

export function back(fallback = '/dex'): void {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback, true);
}

export function href(path: string): string {
  return `#${path.startsWith('/') ? path : `/${path}`}`;
}

/** Scrolls the main pane to the top when the route changes. */
export function useScrollTopOnRoute(key: string): void {
  useEffect(() => {
    const main = document.getElementById('main');
    if (main) main.scrollTo({ top: 0 });
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
