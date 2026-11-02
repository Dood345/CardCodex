/**
 * The Android back button, done the way the system suggests: whatever is on
 * top closes first. A sheet closes, a photo closes, a live camera returns to
 * the mode choice, a page review is left (resumable), and only with nothing
 * open does the app go back in its history, or hide itself at the root.
 *
 * Views register a handler while they have something to close
 * (`useBackHandler(active, close)`); the newest registration wins. The
 * Capacitor App plugin delivers the hardware button on Android
 * (`installBackButton`, once, in App.tsx); in a browser the handlers are
 * only reached through Escape or the views' own buttons, the browser's back
 * stays the browser's.
 */
import { useEffect, useRef } from 'react';
import { App } from '@capacitor/app';
import { isNative } from '@/app/platform';

/** Return false to decline (the next handler down is tried). */
export type BackHandler = () => boolean | void;

const stack: BackHandler[] = [];

/** Register `handler` on top of the stack; the returned function removes it. */
export function pushBackHandler(handler: BackHandler): () => void {
  stack.push(handler);
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Run the topmost handler that accepts; true when one did. */
export function runBackHandlers(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]() !== false) return true;
  }
  return false;
}

/** Number of registered handlers (tests). */
export function backHandlerCount(): number {
  return stack.length;
}

/** While `active`, the back button calls `handler` (always the latest one passed). */
export function useBackHandler(active: boolean, handler: () => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    return pushBackHandler(() => {
      ref.current();
    });
  }, [active]);
}

/**
 * Hook the hardware button up (Android only; a no-op elsewhere). With a
 * listener registered, Capacitor leaves the decision to us: a handler, else
 * the WebView's history, else the app is sent to the background rather than
 * killed, so the camera and the catalog come back instantly.
 */
export function installBackButton(): () => void {
  if (!isNative()) return () => undefined;
  let removed = false;
  let remove: (() => void) | undefined;
  void App.addListener('backButton', ({ canGoBack }) => {
    if (runBackHandlers()) return;
    if (canGoBack || window.history.length > 1) window.history.back();
    else void App.minimizeApp();
  }).then((h) => {
    if (removed) void h.remove();
    else remove = () => void h.remove();
  });
  return () => {
    removed = true;
    remove?.();
  };
}
