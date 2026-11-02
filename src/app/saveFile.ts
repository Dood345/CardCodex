/**
 * Save a file where the user can find it.
 *
 * In the Android WebView neither path the web uses works: `navigator.share`
 * refuses files (`canShare({files})` is false in a WebView) and an `<a download>`
 * on a blob URL does nothing (Capacitor sets no download listener), so an export
 * used to end with a "done" toast and no file. On Android the Capacitor
 * Filesystem plugin writes the file into the public Downloads folder instead
 * (then Documents, then the share sheet as a last resort); Android 11+ needs no
 * storage permission for files the app creates there, older versions are asked.
 * In a browser it is an ordinary download.
 */
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { isNative } from './platform';

export type SavedWhere = 'downloads' | 'documents' | 'share' | 'browser';

export interface SavedFile {
  where: SavedWhere;
  /** Native URI of the written file, when one was written. */
  uri?: string;
}

const TEXT_TYPES = /^(text\/|application\/json)/;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.readAsDataURL(blob);
  });
}

async function writeNative(blob: Blob, directory: Directory, path: string): Promise<string> {
  const text = TEXT_TYPES.test(blob.type);
  const data = text ? await blob.text() : await blobToBase64(blob);
  const { uri } = await Filesystem.writeFile({ path, directory, data, recursive: true, ...(text ? { encoding: Encoding.UTF8 } : {}) });
  return uri;
}

/** Where a native save is tried, in order. */
export const NATIVE_TARGETS: readonly { directory: Directory; folder: string; where: SavedWhere }[] = [
  { directory: Directory.ExternalStorage, folder: 'Download/', where: 'downloads' },
  { directory: Directory.Documents, folder: '', where: 'documents' },
];

/**
 * Save `blob` as `name`. Resolves with where it went; rejects when nothing
 * worked (callers then fall back to showing the content).
 */
export async function saveFile(blob: Blob, name: string): Promise<SavedFile> {
  if (isNative()) {
    try {
      const status = await Filesystem.checkPermissions();
      if (status.publicStorage !== 'granted') await Filesystem.requestPermissions();
    } catch {
      /* no permission concept on this version: the writes below decide */
    }
    let lastError: unknown;
    for (const t of NATIVE_TARGETS) {
      try {
        return { where: t.where, uri: await writeNative(blob, t.directory, `${t.folder}${name}`) };
      } catch (e) {
        lastError = e;
        console.warn(`[save] ${t.where} refused ${name}:`, e);
      }
    }
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    const file = new File([blob], name, { type: blob.type });
    if (nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: name });
      return { where: 'share' };
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'nowhere to save the file'));
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { where: 'browser' };
}

/** One line for a toast: where `name` went. */
export function savedMessage(saved: SavedFile, name: string): string {
  switch (saved.where) {
    case 'downloads':
      return `Saved to Downloads/${name}`;
    case 'documents':
      return `Saved to Documents/${name}`;
    case 'share':
      return `Shared ${name}`;
    default:
      return `Downloaded ${name}`;
  }
}
