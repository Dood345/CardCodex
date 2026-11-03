import { afterEach, describe, expect, it, vi } from 'vitest';

const share = vi.fn();
const writeFile = vi.fn();
const saveFile = vi.fn();
let native = false;
vi.mock('@capacitor/share', () => ({ Share: { share: (...a: unknown[]) => share(...a) } }));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: { writeFile: (...a: unknown[]) => writeFile(...a) },
}));
vi.mock('./saveFile', () => ({ saveFile: (...a: unknown[]) => saveFile(...a) }));
vi.mock('./platform', () => ({ isNative: () => native }));

import { shareFile, shareMessage, shareText } from './share';

describe('shareText', () => {
  afterEach(() => {
    share.mockReset();
    vi.unstubAllGlobals();
  });

  it('uses the native share sheet on the phone and reads a dismissal as cancelled', async () => {
    native = true;
    share.mockResolvedValueOnce({ activityType: 'x' });
    expect(await shareText('Deck', 'text')).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'Deck', text: 'text', dialogTitle: 'Deck' });
    share.mockRejectedValueOnce(new Error('Share canceled'));
    expect(await shareText('Deck', 'text')).toBe('cancelled');
    share.mockRejectedValueOnce(new Error('no apps'));
    expect(await shareText('Deck', 'text')).toBe('unavailable');
  });

  it('falls back to the clipboard in a browser without a share sheet', async () => {
    native = false;
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await shareText('Deck', 'text')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('text');
    vi.stubGlobal('navigator', {});
    expect(await shareText('Deck', 'text')).toBe('unavailable');
    expect(shareMessage('copied')).toMatch(/Copied/);
    expect(shareMessage('shared')).toBeNull();
  });
});

describe('shareFile', () => {
  afterEach(() => {
    share.mockReset();
    writeFile.mockReset();
    saveFile.mockReset();
    vi.unstubAllGlobals();
  });

  it('writes the file to the cache and hands it to the native share sheet', async () => {
    native = true;
    writeFile.mockResolvedValueOnce({ uri: 'file:///cache/share/Fire.ccdeck' });
    share.mockResolvedValueOnce({});
    expect(await shareFile('Fire.ccdeck', '{}', 'Fire (CardCodex deck)')).toBe('shared');
    expect(writeFile).toHaveBeenCalledWith({ path: 'share/Fire.ccdeck', data: '{}', directory: 'CACHE', encoding: 'utf8', recursive: true });
    expect(share).toHaveBeenCalledWith({ title: 'Fire (CardCodex deck)', dialogTitle: 'Fire (CardCodex deck)', files: ['file:///cache/share/Fire.ccdeck'] });
    writeFile.mockResolvedValueOnce({ uri: 'file:///x' });
    share.mockRejectedValueOnce(new Error('Share canceled'));
    expect(await shareFile('a.ccdeck', '{}', 'a')).toBe('cancelled');
    writeFile.mockRejectedValueOnce(new Error('disk'));
    expect(await shareFile('a.ccdeck', '{}', 'a')).toBe('unavailable');
    expect(share).toHaveBeenCalledTimes(2);
  });

  it('downloads the file in a browser whose share sheet takes no files', async () => {
    native = false;
    vi.stubGlobal('navigator', {});
    saveFile.mockResolvedValueOnce({ where: 'browser' });
    expect(await shareFile('a.ccdeck', '{}', 'a')).toBe('saved');
    expect(saveFile).toHaveBeenCalledTimes(1);
    const [file, name] = saveFile.mock.calls[0] as [File, string];
    expect(name).toBe('a.ccdeck');
    expect(file.name).toBe('a.ccdeck');
    expect(await file.text()).toBe('{}');
    expect(shareMessage('saved')).toMatch(/download/);
  });

  it('uses the browser share sheet when it takes files', async () => {
    native = false;
    const navShare = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share: navShare, canShare: () => true });
    expect(await shareFile('a.ccdeck', '{}', 'a')).toBe('shared');
    expect(navShare).toHaveBeenCalledTimes(1);
    navShare.mockRejectedValueOnce(new DOMException('x', 'AbortError'));
    expect(await shareFile('a.ccdeck', '{}', 'a')).toBe('cancelled');
    expect(saveFile).not.toHaveBeenCalled();
  });
});
