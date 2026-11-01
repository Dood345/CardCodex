/**
 * The binder-page guide: the page rectangle with its pocket cells, drawn over
 * the camera view (or a still). The grid fitter moves it onto the cards; the
 * user can also drag it (body) or resize it (corner handles).
 */
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { Box } from '@/scanner';
import type { PageLayout } from '@/scanner/page';
import { pocketBoxesIn } from '@/scanner/page';

export type GuideState = 'searching' | 'locked' | 'manual' | 'still';

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

interface Drag {
  handle: Handle;
  pointerId: number;
  startX: number;
  startY: number;
  start: Box;
}

/** Smallest guide, as a fraction of the bounds. */
const MIN_FRAC = 0.2;

export function PageGuide({
  box,
  bounds,
  layout,
  state,
  label,
  warn,
  onChange,
}: {
  /** Guide rectangle, element px. */
  box: Box;
  /** Area the guide may occupy, element px (the whole view). */
  bounds: Box;
  layout: PageLayout;
  state: GuideState;
  /** Badge text ("Page found", "Finding page…"). */
  label?: string;
  /** The badge shows advice ("Move closer"): drawn amber instead of the state's colour. */
  warn?: boolean;
  /** Called while dragging with the new rectangle (element px). */
  onChange: (box: Box, final: boolean) => void;
}) {
  const dragRef = useRef<Drag | null>(null);

  const start = (handle: Handle) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { handle, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, start: box };
  };

  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    e.preventDefault();
    onChange(apply(d, e.clientX - d.startX, e.clientY - d.startY, bounds), false);
  };

  const end = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    onChange(apply(d, e.clientX - d.startX, e.clientY - d.startY, bounds), true);
  };

  const cells = pocketBoxesIn(box, layout);
  return (
    <div className={`page-guide-layer ${state}`}>
      <div
        className="page-guide"
        style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        onPointerDown={start('move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        role="presentation"
      >
        {label && <span className={`guide-badge${warn ? ' warn' : ''}`}>{label}</span>}
        {(['nw', 'ne', 'sw', 'se'] as const).map((h) => (
          <span
            key={h}
            className={`guide-handle ${h}`}
            onPointerDown={start(h)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            aria-hidden
          />
        ))}
      </div>
      {cells.map((c) => (
        <div key={c.index} className="page-cell" style={{ left: c.box.x, top: c.box.y, width: c.box.w, height: c.box.h }}>
          <span>{c.index + 1}</span>
        </div>
      ))}
    </div>
  );
}

/** New rectangle for a drag of (dx, dy) from `d.start`, kept inside `bounds`. */
function apply(d: Drag, dx: number, dy: number, bounds: Box): Box {
  const minW = bounds.w * MIN_FRAC;
  const minH = bounds.h * MIN_FRAC;
  const s = d.start;
  let { x, y, w, h } = s;
  if (d.handle === 'move') {
    x = clamp(s.x + dx, bounds.x, bounds.x + bounds.w - s.w);
    y = clamp(s.y + dy, bounds.y, bounds.y + bounds.h - s.h);
    return { x, y, w, h };
  }
  const right = s.x + s.w;
  const bottom = s.y + s.h;
  if (d.handle === 'nw' || d.handle === 'sw') {
    x = clamp(s.x + dx, bounds.x, right - minW);
    w = right - x;
  } else {
    w = clamp(s.w + dx, minW, bounds.x + bounds.w - s.x);
  }
  if (d.handle === 'nw' || d.handle === 'ne') {
    y = clamp(s.y + dy, bounds.y, bottom - minH);
    h = bottom - y;
  } else {
    h = clamp(s.h + dy, minH, bounds.y + bounds.h - s.y);
  }
  return { x, y, w, h };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
