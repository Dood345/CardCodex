/**
 * Hand something to whatever the person wants to send it with: the Android
 * share sheet (Messenger, Quick Share, mail…) through the Capacitor Share
 * plugin, the browser's share sheet where there is one, else the clipboard
 * for a text or a download for a file. No server is involved; the text or
 * the file is the whole payload.
 */
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNative } from './platform';
import { saveFile } from './saveFile';

export type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'saved' | 'unavailable';

/** The plugin rejects when the sheet is dismissed. */
function outcomeOf(e: unknown): ShareOutcome {
  return /cancel/i.test(e instanceof Error ? e.message : String(e)) ? 'cancelled' : 'unavailable';
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function shareText(title: string, text: string): Promise<ShareOutcome> {
  if (isNative()) {
    try {
      await Share.share({ title, text, dialogTitle: title });
      return 'shared';
    } catch (e) {
      return outcomeOf(e);
    }
  }
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch {
      // Dismissed, or the browser declined: fall back to the clipboard.
    }
  }
  return (await copyText(text)) ? 'copied' : 'unavailable';
}

/**
 * Share a small text file called `name`. On Android it is written to the
 * app's cache and handed to the share sheet through the FileProvider; in a
 * browser the share sheet takes it where that works with files, else it is
 * downloaded.
 */
export async function shareFile(name: string, text: string, title: string, type = 'application/octet-stream'): Promise<ShareOutcome> {
  if (isNative()) {
    let uri: string;
    try {
      ({ uri } = await Filesystem.writeFile({ path: `share/${name}`, data: text, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true }));
    } catch {
      return 'unavailable';
    }
    try {
      await Share.share({ title, dialogTitle: title, files: [uri] });
      return 'shared';
    } catch (e) {
      return outcomeOf(e);
    }
  }
  const file = new File([text], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // The browser declined: fall back to a download.
    }
  }
  try {
    await saveFile(file, name);
    return 'saved';
  } catch {
    return 'unavailable';
  }
}

/** What to tell the person after `shareText` or `shareFile`, if anything. */
export function shareMessage(outcome: ShareOutcome): string | null {
  switch (outcome) {
    case 'copied':
      return 'Copied to the clipboard: paste it to a friend.';
    case 'saved':
      return 'Saved as a download.';
    case 'unavailable':
      return 'Sharing is not available here.';
    default:
      return null;
  }
}
