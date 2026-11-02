/**
 * Geometry of the app's scrolling pane (`#main`): where its content begins
 * under the sticky top bar, which child sits at that line, and how to put
 * a child back there. Shared by the scroll memory (src/ui/scroll-memory.ts)
 * and the quick scroll zone (src/ui/QuickScroll.tsx).
 */

/** The app's scrolling pane, when on screen. */
export function mainPane(): HTMLElement | null {
  return document.getElementById('main');
}

/**
 * The viewport y where the pane's content shows: the bottom of its sticky
 * first child (the top bar) when it has one, else the pane's top.
 */
export function contentLine(pane: HTMLElement): number {
  const first = pane.firstElementChild;
  if (first && getComputedStyle(first).position === 'sticky') return first.getBoundingClientRect().bottom;
  return pane.getBoundingClientRect().top;
}

/**
 * Index of the first of `children` whose bottom edge is below `line`: the
 * one at the top of the visible part of a list; -1 when all are above it.
 * A binary search: a grid lays its children out in reading order, so their
 * bottom edges never decrease along the collection.
 */
export function firstBelow(children: ArrayLike<Element>, line: number): number {
  let lo = 0;
  let hi = children.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (children[mid].getBoundingClientRect().bottom > line) hi = mid;
    else lo = mid + 1;
  }
  return lo < children.length ? lo : -1;
}

/**
 * Scrolls `pane` so that `el`'s top edge sits `offset` px above `line`,
 * and returns how far it had to move (0 when it was there already).
 */
export function alignTo(pane: HTMLElement, el: Element, line: number, offset = 0): number {
  const delta = el.getBoundingClientRect().top + offset - line;
  if (Math.abs(delta) > 0.5) pane.scrollTop += delta;
  return delta;
}

/** Events that mean the user has taken the scroll over, ending a settle. */
export const TAKEOVER_EVENTS = ['pointerdown', 'wheel', 'touchstart', 'keydown'] as const;

/** How long a settle keeps watching after the jump (ms). */
const SETTLE_MS = 1500;

/**
 * `alignTo` now, and again whenever the page's layout changes during the
 * next `ms` milliseconds. After a jump, tiles around the new position are
 * drawn at their real heights in place of the estimates they had off
 * screen (`content-visibility: auto`), which can move the target by rows,
 * and that happens whenever the browser gets to it, up to half a second
 * later; the browser's own scroll anchoring does not compensate for it.
 * A ResizeObserver on the element's ancestors and the pane's children
 * catches every such change before it is painted. The settle ends early
 * when the user takes the scroll over or the element leaves the page.
 * Returns a function that ends it.
 */
export function settleAlign(pane: HTMLElement, el: Element, line: () => number, offset = 0, ms = SETTLE_MS): () => void {
  alignTo(pane, el, line(), offset);
  let ro: ResizeObserver | null = null;
  let timer = 0;
  const stop = () => {
    ro?.disconnect();
    ro = null;
    window.clearTimeout(timer);
    for (const type of TAKEOVER_EVENTS) pane.removeEventListener(type, stop);
  };
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => {
      if (!el.isConnected) stop();
      else alignTo(pane, el, line(), offset);
    });
    for (let a = el.parentElement; a && a !== pane; a = a.parentElement) ro.observe(a);
    for (const kid of Array.from(pane.children)) ro.observe(kid);
  }
  timer = window.setTimeout(stop, ms);
  for (const type of TAKEOVER_EVENTS) pane.addEventListener(type, stop, { passive: true });
  return stop;
}
