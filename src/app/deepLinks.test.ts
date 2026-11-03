import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigate = vi.fn();
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(), getLaunchUrl: vi.fn() } }));
vi.mock('@capacitor/filesystem', () => ({ Encoding: { UTF8: 'utf8' }, Filesystem: { readFile: vi.fn() } }));
vi.mock('@/ui/router', () => ({ navigate: (...a: unknown[]) => navigate(...a) }));

import { heldDeckFile } from '@/data/deck-file';
import { isFileUrl, openFileUrl, openUrl, routeForUrl } from './deepLinks';

describe('routeForUrl', () => {
  it('opens a deck link on the import page and ignores anything else', () => {
    expect(routeForUrl('cardcodex://deck/CCD1.abcDEF123_-')).toBe('/decks/import/CCD1.abcDEF123_-');
    expect(routeForUrl('https://example.com/?x=CCD1.abcDEF123')).toBe('/decks/import/CCD1.abcDEF123');
    expect(routeForUrl('cardcodex://something')).toBeNull();
    expect(routeForUrl('')).toBeNull();
  });
});

describe('opened files', () => {
  beforeEach(() => navigate.mockReset());

  it('tells content and file URLs from links', () => {
    expect(isFileUrl('content://com.android.providers.downloads.documents/document/123')).toBe(true);
    expect(isFileUrl('file:///sdcard/Download/Fire.ccdeck')).toBe(true);
    expect(isFileUrl('cardcodex://deck/CCD1.abcd')).toBe(false);
    expect(isFileUrl('https://example.com/x.ccdeck')).toBe(false);
  });

  it('reads the file, holds its text and goes to the import page', async () => {
    await openFileUrl('content://x/1', async () => '{"cardcodex":"deck"}');
    expect(heldDeckFile()).toEqual({ text: '{"cardcodex":"deck"}' });
    expect(navigate).toHaveBeenCalledWith('/decks/import/file');
    await openFileUrl('content://x/2', async () => {
      throw new Error('denied');
    });
    expect(heldDeckFile()).toEqual({ error: 'Could not read that file.' });
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('sends links to the import route and ignores the rest', () => {
    openUrl('cardcodex://deck/CCD1.abcDEF123');
    expect(navigate).toHaveBeenCalledWith('/decks/import/CCD1.abcDEF123');
    openUrl(undefined);
    openUrl('cardcodex://nothing');
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
