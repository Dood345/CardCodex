/**
 * Where each page was scrolled, so that going back lands where the user
 * left off instead of at the top.
 *
 * Every history entry gets a key, kept in `history.state`: the one thing a
 * hash router can attach to an entry that survives going back and forward.
 * Leaving an entry records where the main pane was, as an anchor rather
 * than a pixel count: the path of child indices from the pane down to the
 * element at the top of its visible part, plus how far that element's top
 * was above the line. Tiles off screen only have estimated heights
 * (`content-visibility: auto`), so a page that renders again puts the same
 * tile at a different scrollTop, while the tile itself is where the user
 * was. The scrollTop is kept too, for when the path no longer resolves.
 *
 * Coming back to an entry (Android back, the browser's back or forward)
 * puts that element back under the top bar once the page has rendered,
 * correcting for a moment while the page is still filling in (the
 * collection arrives from the database a tick later); a fresh page starts
 * at the top; a hash rewritten in place on the same page (the search box
 * updating ?q=) leaves the pane alone.
 */
import { contentLine, firstBelow, settleAlign, TAKEOVER_EVENTS } from './pane';

export interface ScrollMark {
  /** Child indices from the pane down to the element at the top of its visible part. */
  path: number[];
  /** How far above the content line that element's top was (px). */
  offset: number;
  /** The pane's scrollTop, for when the path no longer resolves. */
  top: number;
}

/** How the current page was reached. */
export type Arrival = 'fresh' | 'revisit' | 'same';

interface Entry {
  key: string;
  arrival: Arrival;
}

/** Deepest anchor: pane → list → tile is three levels; a few more for nested groups. */
const MAX_DEPTH = 6;
/** How many frames a restore waits for its anchor to appear while the page fills in (about a second). */
const RESTORE_FRAMES = 60;

const marks = new Map<string, ScrollMark>();
let entry: Entry | null = null;
let lastHref = '';
let lastPath = '';
let counter = 0;
/** Ends the restore in progress, if any. */
let stopRestore: (() => void) | null = null;

function hashPath(href: string): string {
  const i = href.indexOf('#');
  return (i < 0 ? '' : href.slice(i + 1)).split('?')[0];
}

function stateKey(): string | null {
  const s: unknown = window.history.state;
  return s && typeof s === 'object' && typeof (s as { key?: unknown }).key === 'string' ? (s as { key: string }).key : null;
}

/** Gives the current history entry a key (kept in its state) and returns it. */
function tag(): string {
  const key = `${Date.now().toString(36)}-${(counter++).toString(36)}`;
  try {
    const s: unknown = window.history.state;
    window.history.replaceState({ ...(s && typeof s === 'object' ? s : {}), key }, '');
  } catch {
    // Throttled or blocked: the entry stays untagged and reads as fresh next time.
  }
  return key;
}

function ensureEntry(): Entry {
  if (!entry) {
    entry = { key: stateKey() ?? tag(), arrival: 'same' };
    lastHref = window.location.href;
    lastPath = hashPath(lastHref);
  }
  return entry;
}

/** Adopt the entry the app started on. Call before listening for hash changes. */
export function primeScrollMemory(): void {
  ensureEntry();
}

/** The element at the top of the pane's visible part, as a path from the pane. */
function anchorOf(pane: HTMLElement): { path: number[]; offset: number } | null {
  const line = contentLine(pane);
  const path: number[] = [];
  let el: Element = pane;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const kids = el.children;
    if (!kids.length) break;
    let i = -1;
    if (depth === 0) {
      // Pane children in flow only: not the sticky top bar, not fixed overlays like the quick scroll zone.
      for (let k = 0; k < kids.length; k++) {
        const pos = getComputedStyle(kids[k]).position;
        if (pos === 'sticky' || pos === 'fixed' || pos === 'absolute') continue;
        if (kids[k].getBoundingClientRect().bottom > line) {
          i = k;
          break;
        }
      }
    } else i = firstBelow(kids, line);
    if (i < 0) break;
    path.push(i);
    el = kids[i];
    // A tile is as deep as we need to go.
    if (el instanceof HTMLAnchorElement || el instanceof HTMLButtonElement) break;
  }
  return path.length ? { path, offset: line - el.getBoundingClientRect().top } : null;
}

function resolve(pane: HTMLElement, path: readonly number[]): Element | null {
  let el: Element = pane;
  for (const i of path) {
    const kid = el.children[i];
    if (!kid) return null;
    el = kid;
  }
  return el === pane ? null : el;
}

/** Where `pane` is now, for a later `restoreScroll`. */
export function measureScroll(pane: HTMLElement): ScrollMark {
  const anchor = anchorOf(pane);
  return { path: anchor?.path ?? [], offset: anchor?.offset ?? 0, top: pane.scrollTop };
}

/**
 * Puts `pane` back at `mark`: the anchor under the content line once its
 * path resolves (the old scrollTop meanwhile, for a page that is still
 * filling in), then holds it there while the page's layout settles
 * (`settleAlign`). Ends early when the user takes over or another
 * navigation happens.
 */
export function restoreScroll(pane: HTMLElement, mark: ScrollMark): void {
  stopRestore?.();
  let frames = RESTORE_FRAMES;
  let fellBack = false;
  let handle = 0;
  let stopSettle: (() => void) | null = null;
  const stop = () => {
    if (handle) cancelAnimationFrame(handle);
    handle = 0;
    stopSettle?.();
    stopSettle = null;
    for (const type of TAKEOVER_EVENTS) pane.removeEventListener(type, stop);
    if (stopRestore === stop) stopRestore = null;
  };
  const step = () => {
    handle = 0;
    const el = resolve(pane, mark.path);
    if (el) {
      stopSettle = settleAlign(pane, el, () => contentLine(pane), mark.offset);
      return;
    }
    if (!fellBack) {
      pane.scrollTop = mark.top;
      fellBack = true;
    }
    if (--frames > 0 && typeof requestAnimationFrame === 'function') handle = requestAnimationFrame(step);
    else stop();
  };
  stopRestore = stop;
  for (const type of TAKEOVER_EVENTS) pane.addEventListener(type, stop, { passive: true });
  step();
}

/**
 * The hash changed (the router calls this before it re-renders, while the
 * old page is still on screen): remember where it was scrolled and work out
 * how the new page is reached. A tagged entry is a revisit, an untagged one
 * is fresh, the same entry with its hash rewritten is the same page, or a
 * fresh one when the path itself changed.
 */
export function noteNavigation(pane: HTMLElement | null): void {
  const prev = ensureEntry();
  const href = window.location.href;
  if (href === lastHref) return;
  const path = hashPath(href);
  const pathChanged = path !== lastPath;
  lastHref = href;
  lastPath = path;
  if (pane) marks.set(prev.key, measureScroll(pane));
  stopRestore?.();
  const key = stateKey();
  if (key === prev.key) prev.arrival = pathChanged ? 'fresh' : 'same';
  else if (key) entry = { key, arrival: 'revisit' };
  else entry = { key: tag(), arrival: 'fresh' };
}

/**
 * The new page has rendered: a fresh page starts at the top, a revisited
 * one goes back to where it was, the same page stays put. Call once per
 * route change, after the commit (a layout effect).
 */
export function settlePane(pane: HTMLElement): void {
  const e = ensureEntry();
  const arrival = e.arrival;
  e.arrival = 'same';
  if (arrival === 'same') return;
  const mark = arrival === 'revisit' ? marks.get(e.key) : undefined;
  if (mark) restoreScroll(pane, mark);
  else pane.scrollTop = 0;
}

/** How the current page was reached (tests). */
export function currentArrival(): Arrival {
  return ensureEntry().arrival;
}

/** Forget everything (tests). */
export function resetScrollMemory(): void {
  marks.clear();
  entry = null;
  lastHref = '';
  lastPath = '';
  stopRestore?.();
}
