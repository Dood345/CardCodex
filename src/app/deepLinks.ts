/**
 * Links that open the app on something: `cardcodex://deck/<code>` (the
 * scheme the Android manifest claims) opens a shared deck for import. The
 * Capacitor App plugin delivers the URL whether the app was running or is
 * started by the link.
 */
import { App } from '@capacitor/app';
import { findDeckCode } from '@/data/deck-code';
import { navigate } from '@/ui/router';
import { isNative } from './platform';

/** The in-app route an opened URL stands for, or null when it is none of ours. */
export function routeForUrl(url: string): string | null {
  const code = findDeckCode(url);
  return code ? `/decks/import/${code}` : null;
}

export function installDeepLinks(): () => void {
  if (!isNative()) return () => undefined;
  let removed = false;
  let remove: (() => void) | undefined;
  const open = (url: string | undefined) => {
    const route = url && routeForUrl(url);
    if (route) navigate(route);
  };
  void App.addListener('appUrlOpen', ({ url }) => open(url)).then((h) => {
    if (removed) void h.remove();
    else remove = () => void h.remove();
  });
  // Started by the link: the event may have fired before the listener existed.
  void App.getLaunchUrl()
    .then((launch) => open(launch?.url))
    .catch(() => undefined);
  return () => {
    removed = true;
    remove?.();
  };
}
