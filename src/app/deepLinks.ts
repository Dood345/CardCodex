/**
 * Things that open the app on something, delivered by the Capacitor App
 * plugin whether the app was running or is started by them: a
 * `cardcodex://deck/<code>` link (the scheme the Android manifest claims)
 * opens a shared deck for import, and a `.ccdeck` file tapped in a chat or
 * the Files app arrives as a content:// URL, is read here and lands on the
 * same page (src/data/deck-file.ts).
 */
import { App } from '@capacitor/app';
import { Encoding, Filesystem } from '@capacitor/filesystem';
import { findDeckCode } from '@/data/deck-code';
import { DECK_FILE_ROUTE, holdDeckFile } from '@/data/deck-file';
import { navigate } from '@/ui/router';
import { isNative } from './platform';

/** The in-app route an opened URL stands for, or null when it is none of ours. */
export function routeForUrl(url: string): string | null {
  const code = findDeckCode(url);
  return code ? `/decks/import/${code}` : null;
}

/** A file the system asks us to open: content:// (a tapped attachment or download) or file://. */
export function isFileUrl(url: string): boolean {
  return /^(content|file):/i.test(url);
}

async function readText(path: string): Promise<string> {
  const r = await Filesystem.readFile({ path, encoding: Encoding.UTF8 });
  return typeof r.data === 'string' ? r.data : r.data.text();
}

/** Read an opened file and go to the import page, which shows the deck or why it could not be read. */
export async function openFileUrl(url: string, read: (path: string) => Promise<string> = readText): Promise<void> {
  try {
    holdDeckFile({ text: await read(url) });
  } catch {
    holdDeckFile({ error: 'Could not read that file.' });
  }
  navigate(DECK_FILE_ROUTE);
}

/** What an opened URL leads to. */
export function openUrl(url: string | undefined): void {
  if (!url) return;
  const route = routeForUrl(url);
  if (route) navigate(route);
  else if (isFileUrl(url)) void openFileUrl(url);
}

export function installDeepLinks(): () => void {
  if (!isNative()) return () => undefined;
  let removed = false;
  let remove: (() => void) | undefined;
  void App.addListener('appUrlOpen', ({ url }) => openUrl(url)).then((h) => {
    if (removed) void h.remove();
    else remove = () => void h.remove();
  });
  // Started by the link or the file: the event may have fired before the listener existed.
  void App.getLaunchUrl()
    .then((launch) => openUrl(launch?.url))
    .catch(() => undefined);
  return () => {
    removed = true;
    remove?.();
  };
}
