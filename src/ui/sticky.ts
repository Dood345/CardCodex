/**
 * Page state that outlives the page. A page unmounts whenever the route
 * changes (opening a card from the Pokédex unmounts the Pokédex), so plain
 * useState forgets the filter or sort the user had on, and coming back
 * shows a different list from the one they left, which also defeats the
 * scroll memory (src/ui/scroll-memory.ts). This keeps the value in memory
 * for the rest of the app's life, per key, and is otherwise useState. Keys
 * name the page and the value, with the game in front where the page is
 * shared between games; a component keeps the same key for its whole life.
 */
import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

const store = new Map<string, unknown>();

export function useSticky<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (store.has(key)) return store.get(key) as T;
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });
  const set = useCallback(
    (next: SetStateAction<T>) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        store.set(key, v);
        return v;
      });
    },
    [key],
  );
  return [value, set];
}

/** Forget every sticky value (tests). */
export function resetSticky(): void {
  store.clear();
}
