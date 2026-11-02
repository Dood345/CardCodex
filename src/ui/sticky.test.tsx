// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { resetSticky, useSticky } from './sticky';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ onRender }: { onRender: (value: number, set: (n: number | ((p: number) => number)) => void) => void }) {
  const [value, set] = useSticky('test:n', 1);
  onRender(value, set);
  return null;
}

describe('useSticky', () => {
  it('keeps the value across an unmount and a remount, like a page coming back', () => {
    resetSticky();
    const host = document.createElement('div');
    let value = 0;
    let setter: (n: number | ((p: number) => number)) => void = () => undefined;
    const probe = (
      <Probe
        onRender={(v, s) => {
          value = v;
          setter = s;
        }}
      />
    );
    let root: Root = createRoot(host);
    act(() => root.render(probe));
    expect(value).toBe(1);
    act(() => setter(5));
    expect(value).toBe(5);
    act(() => setter((p) => p + 1));
    expect(value).toBe(6);
    act(() => root.unmount());

    root = createRoot(host);
    act(() => root.render(probe));
    expect(value).toBe(6);
    act(() => root.unmount());

    resetSticky();
    root = createRoot(host);
    act(() => root.render(probe));
    expect(value).toBe(1);
    act(() => root.unmount());
  });
});
