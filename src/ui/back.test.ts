import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(), minimizeApp: vi.fn() } }));

import { backHandlerCount, pushBackHandler, runBackHandlers } from './back';

describe('back handler stack', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    cleanups.splice(0).forEach((c) => c());
  });

  it('runs the newest handler first and reports when none is registered', () => {
    const calls: string[] = [];
    expect(runBackHandlers()).toBe(false);
    cleanups.push(pushBackHandler(() => void calls.push('camera')));
    cleanups.push(pushBackHandler(() => void calls.push('sheet')));
    expect(runBackHandlers()).toBe(true);
    expect(calls).toEqual(['sheet']);
  });

  it('falls through a handler that declines, and forgets removed ones', () => {
    const calls: string[] = [];
    const removeCamera = pushBackHandler(() => void calls.push('camera'));
    cleanups.push(pushBackHandler(() => {
      calls.push('declined');
      return false;
    }));
    expect(runBackHandlers()).toBe(true);
    expect(calls).toEqual(['declined', 'camera']);
    removeCamera();
    calls.length = 0;
    expect(runBackHandlers()).toBe(false); // only the declining one is left
    expect(calls).toEqual(['declined']);
    expect(backHandlerCount()).toBe(1);
  });
});
