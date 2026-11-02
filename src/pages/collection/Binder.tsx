/**
 * The collection as a binder you flip through: every card of the current
 * tab in pages of 9 or 12 pockets, set by set in number order, one page on
 * screen at a time. A swipe, the arrows, the slider or the arrow keys turn
 * the page; empty pockets on the last page show where the next cards go.
 * The page you were on is remembered, so opening a card and coming back
 * lands on the same page.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { CollectionMap } from '@/data/collection';
import { CardTile } from '@/ui/components';
import { useSticky } from '@/ui/sticky';
import { PAGE_SIZES, pageLabel, pageOf, paginate, type PageSize, type Pocket } from './binder-pages';

export function Binder({
  pockets,
  collection,
  storageKey,
  perPage,
  onPerPage,
}: {
  /** Cards in binder order. */
  pockets: readonly Pocket[];
  collection: CollectionMap;
  /** Names the binder (game and tab) for the remembered page. */
  storageKey: string;
  perPage: PageSize;
  onPerPage: (n: PageSize) => void;
}) {
  const pages = useMemo(() => paginate(pockets, perPage), [pockets, perPage]);
  const [page, setPage] = useSticky(`binder:page:${storageKey}`, 0);
  const current = Math.min(Math.max(0, page), pages.length - 1);
  const scroller = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const cols = perPage === 12 ? 4 : 3;

  const scrollTo = (p: number, smooth: boolean) => {
    const el = scroller.current;
    if (el) el.scrollTo({ left: p * el.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
  };
  const goTo = (p: number, smooth = true) => {
    const target = Math.max(0, Math.min(pages.length - 1, p));
    setPage(target);
    scrollTo(target, smooth);
  };

  // Open on the remembered page (coming back from a card) and after a page-size change, without animation.
  useLayoutEffect(() => {
    scrollTo(current, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perPage, pages.length]);

  // Keep the page in place when the width changes (rotation).
  useEffect(() => {
    const onResize = () => scrollTo(current, false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  // Arrow keys turn the page (not while typing somewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowRight') goTo(current + 1);
      else if (e.key === 'ArrowLeft') goTo(current - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // A swipe settles on a page: follow it.
  const onScroll = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const el = scroller.current;
      if (!el || !el.clientWidth) return;
      const p = Math.round(el.scrollLeft / el.clientWidth);
      if (p !== current && p >= 0 && p < pages.length) setPage(p);
    });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // A different page size keeps the first card of the current page in view.
  const changePerPage = (n: PageSize) => {
    if (n === perPage) return;
    setPage(pageOf(current * perPage, n));
    onPerPage(n);
  };

  return (
    <div className="binder-wrap">
      <div className="binder-bar">
        <button type="button" className="btn ghost binder-arrow" onClick={() => goTo(current - 1)} disabled={current === 0} aria-label="Previous page">
          ‹
        </button>
        <div className="binder-status">
          <div className="binder-page-num">
            Page {current + 1} / {pages.length}
          </div>
          <div className="binder-page-label">{pageLabel(pages[current] ?? [])}</div>
        </div>
        <button
          type="button"
          className="btn ghost binder-arrow"
          onClick={() => goTo(current + 1)}
          disabled={current >= pages.length - 1}
          aria-label="Next page"
        >
          ›
        </button>
      </div>
      <div className="binder" ref={scroller} onScroll={onScroll}>
        {pages.map((pagePockets, i) => (
          <section key={i} className={`binder-page cols-${cols}`} aria-label={`Page ${i + 1}`}>
            {pagePockets.map(({ card, set }) => (
              <CardTile key={card.id} card={card} set={set} entry={collection.get(card.id)} />
            ))}
            {Array.from({ length: perPage - pagePockets.length }, (_, k) => (
              <div key={`empty-${k}`} className="binder-empty" aria-hidden="true" />
            ))}
          </section>
        ))}
      </div>
      <div className="binder-foot">
        <input
          type="range"
          className="binder-slider"
          min={0}
          max={Math.max(0, pages.length - 1)}
          value={current}
          onChange={(e) => goTo(Number(e.target.value), false)}
          aria-label="Page"
        />
        <div className="segmented small" role="group" aria-label="Pockets per page">
          {PAGE_SIZES.map((n) => (
            <button key={n} type="button" className={n === perPage ? 'active' : ''} onClick={() => changePerPage(n)} aria-pressed={n === perPage}>
              {n}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
