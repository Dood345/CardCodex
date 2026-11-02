/**
 * Hand a piece of text to whatever the person wants to send it with: the
 * Android share sheet (Messenger, Quick Share, mail…) through the Capacitor
 * Share plugin, the browser's share sheet where there is one, else the
 * clipboard. No server is involved; the text is the whole payload.
 */
import { Share } from '@capacitor/share';
import { isNative } from './platform';

export type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'unavailable';

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
      // The plugin rejects when the sheet is dismissed.
      return /cancel/i.test(e instanceof Error ? e.message : String(e)) ? 'cancelled' : 'unavailable';
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

/** What to tell the person after `shareText`, if anything. */
export function shareMessage(outcome: ShareOutcome): string | null {
  switch (outcome) {
    case 'copied':
      return 'Copied to the clipboard: paste it to a friend.';
    case 'unavailable':
      return 'Sharing is not available here.';
    default:
      return null;
  }
}
