/**
 * Whether the guided tour is showing. Not persisted: completion lives in
 * settings (`tourDone`); this is only the "open right now" flag so Settings
 * can restart the tour from anywhere.
 */
import { useSyncExternalStore } from 'react';

let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function openTour(): void {
  open = true;
  emit();
}

export function closeTour(): void {
  open = false;
  emit();
}

export function useTourOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => open,
    () => false,
  );
}
