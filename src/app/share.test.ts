import { afterEach, describe, expect, it, vi } from 'vitest';

const share = vi.fn();
let native = false;
vi.mock('@capacitor/share', () => ({ Share: { share: (...a: unknown[]) => share(...a) } }));
vi.mock('./platform', () => ({ isNative: () => native }));

import { shareMessage, shareText } from './share';

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
