/**
 * The quick scroll zone: a narrow strip down the right edge of a long list
 * (the Pokédex, the archetypes, the sets) that moves through the whole list in one
 * drag. Section labels run along it (hundreds for the Pokédex, letters for
 * the archetypes), a thumb shows where the list is, and while dragging a
 * bubble names the item under the finger. The zone takes the touch itself
 * (`touch-action: none`), finds the item for the point along it
 * (src/ui/quick-scroll.ts) and puts that item's tile under the top bar.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { contentLine, firstBelow, mainPane, settleAlign } from './pane';
import { fractionOf, labelStride, positionAt, type Section } from './quick-scroll';

/** Lists shorter than this do without the zone. */
export const QUICK_SCROLL_MIN = 40;
/** Minimum spacing between drawn labels (px). */
const LABEL_GAP = 13;
/** Gap between the zone and the bars above and below it (px). */
const INSET = 10;
/** Thumb height (px); keep with .qs-thumb. */
const THUMB = 24;
/** The bubble stays this long after the finger lifts. */
const BUBBLE_MS = 500;

export function QuickScroll({
  gridRef,
  count,
  sections,
  labelAt,
  itemSelector,
}: {
  /** The list whose children are the items, in order. */
  gridRef: RefObject<HTMLElement | null>;
  count: number;
  /** Sections for the labels; empty for a proportional zone without labels. */
  sections: readonly Section[];
  /** Text for the bubble while dragging: the item at `index`. */
  labelAt: (index: number) => string;
  /**
   * Which elements under the list are its items, in order, when they are not its direct children (the Sets list
   * keeps its rows inside one section per series). Default: the list's children.
   */
  itemSelector?: string;
}) {
  const itemsOf = (grid: HTMLElement): ArrayLike<Element> => (itemSelector ? grid.querySelectorAll(itemSelector) : grid.children);
  const zoneRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  const [thumb, setThumb] = useState(0);
  const [drag, setDrag] = useState<{ y: number; label: string } | null>(null);
  const hideTimer = useRef(0);
  const frame = useRef(0);
  const dragging = useRef(false);
  const settling = useRef<() => void>(() => undefined);

  // Between the top bar and the bottom nav, following both when they change size.
  useLayoutEffect(() => {
    const pane = mainPane();
    if (!pane) return;
    const measure = () => {
      const top = contentLine(pane) + INSET;
      const nav = document.querySelector('.bottom-nav');
      const bottom = (nav ? nav.getBoundingClientRect().top : pane.getBoundingClientRect().bottom) - INSET;
      setBox({ top, height: Math.max(0, bottom - top) });
    };
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    const header = pane.firstElementChild;
    if (ro && header) ro.observe(header);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // The thumb follows the list: the item under the top bar, on every scroll.
  useEffect(() => {
    const pane = mainPane();
    if (!pane) return;
    const update = () => {
      frame.current = 0;
      const grid = gridRef.current;
      const items = grid ? itemsOf(grid) : null;
      if (!items || !items.length) return;
      const i = firstBelow(items, contentLine(pane));
      setThumb(fractionOf(i < 0 ? count - 1 : i, count, sections));
    };
    const onScroll = () => {
      if (!frame.current) frame.current = requestAnimationFrame(update);
    };
    update();
    pane.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      pane.removeEventListener('scroll', onScroll);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridRef, count, sections, itemSelector]);

  useEffect(
    () => () => {
      window.clearTimeout(hideTimer.current);
      settling.current();
    },
    [],
  );

  if (!box || count <= 0) return null;

  /** Scroll the list to the point `clientY` along the zone and show what is there. */
  const scrub = (clientY: number) => {
    const pane = mainPane();
    const grid = gridRef.current;
    const zone = zoneRef.current;
    if (!pane || !grid || !zone) return;
    const rect = zone.getBoundingClientRect();
    const f = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
    const index = Math.min(count - 1, Math.max(0, Math.floor(positionAt(f, count, sections))));
    const el = itemsOf(grid)[index];
    settling.current();
    if (el) settling.current = settleAlign(pane, el, () => contentLine(pane));
    setThumb(fractionOf(index, count, sections));
    setDrag({ y: Math.min(rect.height, Math.max(0, clientY - rect.top)), label: labelAt(index) });
  };

  const n = sections.length;
  const stride = labelStride(n, box.height, LABEL_GAP);
  return (
    <div
      ref={zoneRef}
      className={`quick-scroll${drag ? ' dragging' : ''}`}
      style={{ top: box.top, height: box.height }}
      aria-hidden="true"
      onPointerDown={(e) => {
        e.preventDefault();
        try {
          // Keeps the moves coming when the finger drifts off the strip.
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // A pointer that is already gone: the drag still works while it stays on the strip.
        }
        dragging.current = true;
        window.clearTimeout(hideTimer.current);
        scrub(e.clientY);
      }}
      onPointerMove={(e) => {
        if (dragging.current) scrub(e.clientY);
      }}
      onPointerUp={() => {
        dragging.current = false;
        hideTimer.current = window.setTimeout(() => setDrag(null), BUBBLE_MS);
      }}
      onPointerCancel={() => {
        dragging.current = false;
        setDrag(null);
      }}
    >
      {n > 1 &&
        sections.map((s, i) =>
          i % stride === 0 ? (
            <span key={`${s.label}-${s.start}`} className="qs-label" style={{ top: ((i + 0.5) / n) * box.height }}>
              {s.label}
            </span>
          ) : null,
        )}
      <span className="qs-thumb" style={{ top: THUMB / 2 + thumb * (box.height - THUMB) }} />
      {drag && (
        <span className="qs-bubble" style={{ top: drag.y }}>
          {drag.label}
        </span>
      )}
    </div>
  );
}
