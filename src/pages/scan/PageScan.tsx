/**
 * Binder-page mode: photograph one page of a binder, OCR every pocket, then
 * confirm each pocket's card and how many copies sit stacked in that sleeve
 * before adding the whole page to the collection.
 *
 * The page guide is fitted to the cards (src/scanner/grid.ts) while the
 * camera runs; the user can also drag or resize it. A capture whose grid was
 * not yet locked is shown as a still with the guide for a check before it is
 * read. All state lives in the scan session (./session.ts), so leaving the
 * tab and coming back resumes where you were.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogIndex } from '@/data/catalog';
import { formatCardNumber } from '@/data/catalog';
import type { CollectionMap } from '@/data/collection';
import { cardImageUrl, type CatalogCard, type CatalogSet } from '@/data/types';
import { useGame } from '@/app/context';
import { useSettings } from '@/app/settings';
import {
  coverTransform,
  grabFrame,
  mapBox,
  startCamera,
  stopCamera,
  unmapBox,
  visibleRegion,
  type Box,
  type ScanAlternative,
  type ScanMatcher,
  type TextRecognizer,
} from '@/scanner';
import { fitGridOnSource } from '@/scanner/grid';
import {
  PAGE_LAYOUTS,
  boxToFrac,
  fracToBox,
  pageLayout,
  pageRect,
  scanPage,
  type FracBox,
  type PageLayoutId,
  type PocketEntry,
} from '@/scanner/page';
import { Chip } from '@/ui/components';
import { CameraIcon, CloseIcon, MinusIcon, PlusIcon } from '@/ui/icons';
import { PageGuide, type GuideState } from './PageGuide';
import {
  EMPTY_PAGE,
  clearReview,
  disposeStill,
  getScanSession,
  loadReview,
  patchPageSession,
  patchScanSession,
  saveReview,
  useScanSession,
  type PageStill,
  type PocketState,
} from './session';
import { BLANK_POSTER, CameraPlaceholder, containTransform, CorrectionSheet, fileToBitmap } from './shared';

/** Camera captures are taken at the stream's full resolution (≤ this). */
const CAPTURE_MAX_WIDTH = 4096;
/** Page mode asks for a 4:3 stream: more of the page in the frame, and more pixels per pocket, than 16:9. */
const PAGE_CAMERA = { facingMode: 'environment' as const, width: 2560, height: 1920 };
/** Live grid fits per second (each ~10–15 ms on a 320 px sample). */
const FIT_INTERVAL_MS = 300;
/** Consecutive fits within LOCK_TOLERANCE (fractions of the view) before the guide reads "Page found". */
const LOCK_FITS = 3;
const LOCK_TOLERANCE = 0.015;
/** Missed fits before a locked guide goes back to searching. */
const UNLOCK_MISSES = 4;
/** Still photos get a finer sample than the live loop. */
const STILL_SAMPLE_WIDTH = 400;

/** Show a page photo (or any still) in page mode with the guide on it. */
export async function openPagePhoto(file: File): Promise<void> {
  const bitmap = await fileToBitmap(file);
  const prev = getScanSession().page;
  disposeStill(prev?.still);
  patchPageSession({
    phase: 'capture',
    still: { source: bitmap, url: URL.createObjectURL(file), w: bitmap.width, h: bitmap.height },
    frac: null,
    auto: true,
  });
}

function canvasUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/jpeg', 0.9)), 'image/jpeg', 0.92);
  });
}

const lerp = (a: FracBox, b: FracBox, t: number): FracBox => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  w: a.w + (b.w - a.w) * t,
  h: a.h + (b.h - a.h) * t,
});
const near = (a: FracBox, b: FracBox, tol: number): boolean =>
  Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol && Math.abs(a.w - b.w) < tol && Math.abs(a.h - b.h) < tol;

export function PageScan({
  index,
  matcher,
  recognizer,
  collection,
  engineName,
  onAdded,
  onExit,
}: {
  index: CatalogIndex;
  matcher: ScanMatcher;
  recognizer: TextRecognizer;
  collection: CollectionMap;
  engineName: string;
  onAdded: (entries: PocketEntry[]) => void;
  onExit: () => void;
}) {
  const [settings, update] = useSettings();
  const { cardMm, Icon } = useGame();
  const layout = pageLayout(settings.pageLayout);
  const session = useScanSession();
  const page = session.page ?? EMPTY_PAGE;
  const { phase, still, frac, auto, pockets, pageMs, frame, frameFrac } = page;
  const [scanning, setScanning] = useState(false);
  const [restoring, setRestoring] = useState(session.page === null);
  const [error, setError] = useState<string | null>(null);
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });
  const [live, setLive] = useState(false);
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 });
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [correcting, setCorrecting] = useState<number | null>(null);
  const [fit, setFit] = useState<{ confidence: number; locked: boolean } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fitRef = useRef<{ last: FracBox | null; stable: number; misses: number }>({ last: null, stable: 0, misses: 0 });
  const cameraWanted = phase === 'capture' && !still && !scanning && !restoring;

  // A review interrupted by the app being killed: restore it.
  useEffect(() => {
    if (!restoring) return;
    let cancelled = false;
    loadReview(index, index.game)
      .then((r) => {
        if (cancelled) return;
        if (r && r.pockets.length) {
          if (r.layout !== settings.pageLayout) update({ pageLayout: r.layout });
          patchPageSession({ phase: 'review', pockets: r.pockets, pageMs: r.pageMs, frame: null, frameFrac: null, still: null });
        }
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Camera for the capture phase (own stream: no continuous OCR in page mode).
  useEffect(() => {
    if (!cameraWanted) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    setError(null);
    setLive(false);
    startCamera(video, PAGE_CAMERA)
      .then((stream) => {
        if (cancelled) {
          stopCamera(stream);
          return;
        }
        streamRef.current = stream;
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    const onMeta = () => setVideoSize({ w: video.videoWidth, h: video.videoHeight });
    const onPlaying = () => {
      onMeta();
      setLive(true);
    };
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('playing', onPlaying);
    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('playing', onPlaying);
      stopCamera(streamRef.current);
      streamRef.current = null;
      setLive(false);
    };
  }, [cameraWanted]);

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setViewSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [phase, still, scanning]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // A different layout: start the guide over (the remembered frame is per layout).
  const layoutRef = useRef(layout.id);
  useEffect(() => {
    if (layoutRef.current === layout.id) return;
    layoutRef.current = layout.id;
    fitRef.current = { last: null, stable: 0, misses: 0 };
    setFit(null);
    patchPageSession({ frac: null, auto: true });
  }, [layout.id]);

  /* ---------- geometry ---------- */

  const frameSize = still ? { w: still.w, h: still.h } : videoSize;
  const transform = useMemo(
    () =>
      still
        ? containTransform(frameSize.w, frameSize.h, viewSize.w, viewSize.h)
        : coverTransform(frameSize.w, frameSize.h, viewSize.w, viewSize.h),
    [still, frameSize.w, frameSize.h, viewSize.w, viewSize.h],
  );
  /** Part of the source that is on screen (source px). */
  const visible = useMemo(
    () => (frameSize.w && viewSize.w ? visibleRegion(frameSize.w, frameSize.h, transform, viewSize.w, viewSize.h) : null),
    [frameSize.w, frameSize.h, transform, viewSize.w, viewSize.h],
  );
  const remembered = !still ? settings.pageFrames[layout.id] : undefined;
  const effectiveFrac = frac ?? remembered ?? null;
  /** Guide rectangle in source px. */
  const pageBox: Box | null = useMemo(() => {
    if (!visible) return null;
    return effectiveFrac
      ? fracToBox(effectiveFrac, visible)
      : pageRect(frameSize.w, frameSize.h, layout, { cardMm, within: visible });
  }, [visible, effectiveFrac, frameSize.w, frameSize.h, layout, cardMm]);
  const guideBox = pageBox ? mapBox(pageBox, transform) : null;

  const onGuideChange = useCallback(
    (box: Box) => {
      if (!visible) return;
      patchPageSession({ frac: boxToFrac(unmapBox(box, transform), visible), auto: false });
      setFit(null);
    },
    [visible, transform],
  );

  /* ---------- grid fitting ---------- */

  useEffect(() => {
    if (phase !== 'capture' || !auto || scanning || !visible) return;
    const source: CanvasImageSource | null = still ? still.source : live ? videoRef.current : null;
    if (!source) return;
    let stopped = false;
    const run = () => {
      if (stopped) return;
      const f = fitGridOnSource(source, visible, layout, {
        cardAspect: cardMm.w / cardMm.h,
        sampleWidth: still ? STILL_SAMPLE_WIDTH : undefined,
      });
      const st = fitRef.current;
      if (f) {
        const nf = boxToFrac(f.box, visible);
        if (still) {
          patchPageSession({ frac: nf });
          setFit({ confidence: f.confidence, locked: true });
          return;
        }
        st.stable = st.last && near(nf, st.last, LOCK_TOLERANCE) ? st.stable + 1 : 1;
        st.misses = 0;
        st.last = st.last ? lerp(st.last, nf, 0.5) : nf;
        patchPageSession({ frac: st.last });
        setFit({ confidence: f.confidence, locked: st.stable >= LOCK_FITS });
      } else if (still) {
        setFit(null);
      } else if (++st.misses >= UNLOCK_MISSES) {
        st.stable = 0;
        setFit((p) => (p && p.locked ? { ...p, locked: false } : p));
      }
    };
    if (still) {
      run();
      return () => {
        stopped = true;
      };
    }
    const id = window.setInterval(run, FIT_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [phase, auto, scanning, still, live, visible, layout, cardMm]);

  /* ---------- scanning ---------- */

  const runScan = useCallback(
    async (src: PageStill, box: Box) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setScanning(true);
      setError(null);
      setProgress({ done: 0, total: layout.cols * layout.rows });
      const started = performance.now();
      try {
        const results = await scanPage(src.source, layout, recognizer, matcher, {
          signal: ac.signal,
          geometry: { page: box },
          onProgress: (done, total) => setProgress({ done, total }),
        });
        if (ac.signal.aborted) return;
        const next: PocketState[] = results.map((scan) => ({
          scan,
          card: scan.candidate?.card,
          set: scan.candidate?.set,
          qty: scan.candidate ? 1 : 0,
        }));
        const ms = performance.now() - started;
        const current = getScanSession().page;
        if (current?.frame && current.frame !== src) disposeStill(current.frame);
        patchPageSession({
          phase: 'review',
          pockets: next,
          pageMs: ms,
          frame: src,
          frameFrac: boxToFrac(box, { x: 0, y: 0, w: src.w, h: src.h }),
          still: null,
        });
        void saveReview(index.game, layout.id, next, ms);
      } catch (e) {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!ac.signal.aborted) setScanning(false);
      }
    },
    [layout, recognizer, matcher, index.game],
  );

  async function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !visible || !pageBox) return;
    // grabFrame reuses one canvas; copy it so the scan owns its pixels.
    const shared = grabFrame(video, CAPTURE_MAX_WIDTH);
    const canvas = document.createElement('canvas');
    canvas.width = shared.width;
    canvas.height = shared.height;
    canvas.getContext('2d')!.drawImage(shared, 0, 0);
    const k = canvas.width / video.videoWidth;
    const box: Box = { x: pageBox.x * k, y: pageBox.y * k, w: pageBox.w * k, h: pageBox.h * k };
    // Remember where the page was, for the next scan from the same spot.
    update({ pageFrames: { ...settings.pageFrames, [layout.id]: boxToFrac(pageBox, visible) } });
    const captured: PageStill = { source: canvas, url: await canvasUrl(canvas), w: canvas.width, h: canvas.height };
    if (fit?.locked) {
      void runScan(captured, box);
    } else {
      // Not sure where the page is: show the frame with the guide for a check.
      fitRef.current = { last: null, stable: 0, misses: 0 };
      patchPageSession({ still: captured, frac: boxToFrac(box, { x: 0, y: 0, w: canvas.width, h: canvas.height }), auto: true });
      setFit(null);
    }
  }

  function scanStill() {
    if (!still || !pageBox) return;
    void runScan(still, pageBox);
  }

  function retake() {
    fitRef.current = { last: null, stable: 0, misses: 0 };
    setFit(null);
    if (still && still === frame) {
      // Adjusting the grid of a scanned frame: back to its review.
      patchPageSession({ phase: 'review', still: null, auto: true });
      return;
    }
    disposeStill(still);
    patchPageSession({ still: null, frac: null, auto: true });
  }

  function snapToPage() {
    fitRef.current = { last: null, stable: 0, misses: 0 };
    setFit(null);
    patchPageSession({ auto: true });
  }

  function exit() {
    abortRef.current?.abort();
    disposeStill(still);
    if (frame && frame !== still) disposeStill(frame);
    patchScanSession({ page: null, armed: false });
    onExit();
  }

  function backToCapture(discard: boolean) {
    if (frame) disposeStill(frame);
    if (discard) void clearReview();
    patchPageSession({ phase: 'capture', pockets: [], frame: null, frameFrac: null, still: null, frac: null, auto: true });
    fitRef.current = { last: null, stable: 0, misses: 0 };
    setFit(null);
  }

  function adjustGrid() {
    if (!frame) return;
    setFit(null);
    patchPageSession({ phase: 'capture', still: frame, frac: frameFrac, auto: false });
  }

  /* ---------- review ---------- */

  const setPockets = (fn: (ps: PocketState[]) => PocketState[]) => {
    const next = fn(getScanSession().page?.pockets ?? []);
    patchPageSession({ pockets: next });
  };
  const setQty = (i: number, qty: number) => setPockets((ps) => ps.map((p, j) => (j === i ? { ...p, qty: Math.max(0, qty) } : p)));
  const setCard = (i: number, card: CatalogCard, set: CatalogSet) =>
    setPockets((ps) => ps.map((p, j) => (j === i ? { ...p, card, set, qty: p.qty || 1 } : p)));
  const clearCard = (i: number) => setPockets((ps) => ps.map((p, j) => (j === i ? { ...p, card: undefined, set: undefined, qty: 0 } : p)));

  // Keep the IndexedDB snapshot in step with corrections (debounced).
  useEffect(() => {
    if (phase !== 'review' || pockets.length === 0) return;
    const t = window.setTimeout(() => void saveReview(index.game, layout.id, pockets, pageMs), 400);
    return () => window.clearTimeout(t);
  }, [phase, pockets, pageMs, index.game, layout.id]);

  const entries: PocketEntry[] = pockets
    .filter((p): p is PocketState & { card: CatalogCard; set: CatalogSet } => !!p.card && !!p.set && p.qty > 0)
    .map((p) => ({ card: p.card, set: p.set, qty: p.qty }));
  const totalCards = entries.reduce((n, e) => n + e.qty, 0);

  function addPage() {
    onAdded(entries);
    backToCapture(true);
  }

  const correctingPocket = correcting !== null ? pockets[correcting] : undefined;
  const correctingOptions: ScanAlternative[] = useMemo(() => {
    const p = correctingPocket;
    if (!p) return [];
    const best = p.scan.candidate;
    const list: ScanAlternative[] = best
      ? [{ card: best.card, set: best.set, score: best.score, evidence: best.evidence }, ...p.scan.alternatives]
      : [...p.scan.alternatives];
    // The pocket's current pick first, even when it came from a manual search.
    if (p.card && p.set && !list.some((o) => o.card.id === p.card!.id)) list.unshift({ card: p.card, set: p.set, score: 1, evidence: [] });
    return list;
  }, [correctingPocket]);

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      hidden
      data-testid="page-photo-input"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) openPagePhoto(f).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
        e.target.value = '';
      }}
    />
  );

  if (phase === 'review') {
    return (
      <div className="scan-page page-review">
        <div className="scan-hud static">
          <span className="scan-status">
            {layout.label} · {entries.length} of {pockets.length} pockets identified
            {pageMs ? ` · ${(pageMs / 1000).toFixed(1)}s` : ''}
          </span>
          <button type="button" className="icon-btn" aria-label="Discard this page" onClick={() => backToCapture(true)}>
            <CloseIcon />
          </button>
        </div>
        <div className="pocket-grid" style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)` }}>
          {pockets.map((p, i) => (
            <div key={i} className={`pocket${p.card ? '' : ' pocket-empty'}`}>
              <button type="button" className="pocket-thumb" onClick={() => setCorrecting(i)} aria-label={`Pocket ${i + 1}: change card`}>
                <img src={p.scan.thumb} alt="" />
                {p.card && p.set && <img className="pocket-match" src={cardImageUrl(p.card, p.set.series, 'low')} alt="" />}
                {p.card && p.scan.candidate && p.scan.candidate.card.id === p.card.id && !p.scan.candidate.confident && (
                  <span className="pocket-unsure" title="Low confidence: check this one">?</span>
                )}
              </button>
              <div className="pocket-body">
                {p.card && p.set ? (
                  <>
                    <div className="pocket-name" title={p.card.name}>
                      {p.card.name}
                    </div>
                    <div className="pocket-sub">
                      {p.set.abbr || p.set.name} {formatCardNumber(p.card, p.set)}
                      {collection.get(p.card.id)?.qty ? ` · own ${collection.get(p.card.id)!.qty}` : ''}
                    </div>
                  </>
                ) : (
                  <div className="pocket-sub">{p.scan.lineCount ? 'No match' : 'Empty'}</div>
                )}
                <div className="pocket-actions">
                  <div className="stepper stepper-sm" aria-label="Copies in this pocket">
                    <button type="button" className="stepper-btn" aria-label="Fewer copies" disabled={p.qty <= 0} onClick={() => setQty(i, p.qty - 1)}>
                      <MinusIcon size={14} />
                    </button>
                    <span className="stepper-value">{p.qty}</span>
                    <button type="button" className="stepper-btn" aria-label="More copies" disabled={!p.card} onClick={() => setQty(i, p.qty + 1)}>
                      <PlusIcon size={14} />
                    </button>
                  </div>
                  <button type="button" className="btn ghost small" onClick={() => setCorrecting(i)}>
                    {p.card ? 'Change' : 'Set card'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="scan-bottom review-actions">
          <p className="hint">Tap a pocket to correct its card; bump the count where several copies share one sleeve.</p>
          <div className="btn-row">
            <button type="button" className="btn primary" disabled={totalCards === 0} onClick={addPage}>
              Add {totalCards} {totalCards === 1 ? 'card' : 'cards'} to collection
            </button>
            {frame && (
              <button type="button" className="btn ghost" onClick={adjustGrid}>
                Adjust grid
              </button>
            )}
            <button type="button" className="btn ghost" onClick={() => backToCapture(false)}>
              Rescan
            </button>
          </div>
        </div>
        <CorrectionSheet
          open={correcting !== null}
          options={correctingOptions}
          index={index}
          title={correcting !== null ? `Pocket ${correcting + 1}` : undefined}
          thumb={correctingPocket?.scan.thumb}
          current={correctingPocket?.card?.id}
          clearLabel={correctingPocket?.card ? 'Mark empty' : undefined}
          onClear={() => {
            if (correcting !== null) clearCard(correcting);
            setCorrecting(null);
          }}
          onClose={() => setCorrecting(null)}
          onPick={(card, set) => {
            if (correcting !== null) setCard(correcting, card, set);
            setCorrecting(null);
          }}
        />
      </div>
    );
  }

  const guideState: GuideState = still ? (auto ? 'still' : 'manual') : !auto ? 'manual' : fit?.locked ? 'locked' : 'searching';
  const guideLabel = still
    ? auto
      ? fit
        ? 'Page found · check the grid'
        : 'Drag the frame onto the cards'
      : 'Adjusted'
    : !auto
      ? 'Adjusted'
      : fit?.locked
        ? 'Page found'
        : 'Finding page…';
  const hint = error
    ? null
    : still
      ? 'Check that every card sits in its cell. Drag the frame to move it or its corners to resize it, then scan.'
      : fit?.locked
        ? 'Page found. Hold still and capture.'
        : 'Point the camera at the whole page. The grid snaps to the cards; drag it if it does not.';

  return (
    <div className="scan-page">
      <div className="scan-view" ref={viewRef}>
        {still ? (
          <img src={still.url} className="scan-still" alt="Page being scanned" />
        ) : (
          <video ref={videoRef} className={`scan-video${live ? '' : ' hidden'}`} poster={BLANK_POSTER} playsInline muted autoPlay />
        )}
        {!still && !live && !restoring && <CameraPlaceholder Icon={Icon} text={error ?? 'Starting camera…'} live={!error} />}
        {guideBox && viewSize.w > 0 && !scanning && (
          <PageGuide
            box={guideBox}
            bounds={{ x: 0, y: 0, w: viewSize.w, h: viewSize.h }}
            layout={layout}
            state={guideState}
            label={guideLabel}
            onChange={onGuideChange}
          />
        )}
        {scanning && (
          <div className="page-progress">
            <div className="spinner-ring" />
            <div>
              Reading pocket {Math.min(progress.done + 1, progress.total)} of {progress.total}…
            </div>
            <div className="progress" style={{ width: '60%' }}>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
            </div>
            <button
              type="button"
              className="btn ghost"
              style={{ color: '#fff' }}
              onClick={() => {
                abortRef.current?.abort();
                setScanning(false);
              }}
            >
              Cancel
            </button>
          </div>
        )}
        <div className="scan-hud">
          <span className="scan-status">
            <span className={`scan-dot${live && !still ? ' live' : ''}`} />
            {error ? error : scanning ? `Reading page · ${engineName}` : still ? 'Check the grid' : `Binder page · ${layout.label}`}
          </span>
          <span className="btn-row">
            <button type="button" className="btn ghost" style={{ color: '#fff' }} onClick={() => fileRef.current?.click()}>
              Photo
            </button>
            <button type="button" className="icon-btn" style={{ color: '#fff' }} aria-label="Leave page mode" onClick={exit}>
              <CloseIcon />
            </button>
          </span>
        </div>
      </div>
      <div className="scan-bottom">
        <div className="chip-row inline">
          {PAGE_LAYOUTS.map((l) => (
            <Chip key={l.id} active={layout.id === l.id} onClick={() => update({ pageLayout: l.id as PageLayoutId })}>
              {l.label}
            </Chip>
          ))}
        </div>
        {error ? (
          <div className="hint">
            {error}. You can still{' '}
            <button type="button" className="link-btn" onClick={() => fileRef.current?.click()}>
              scan a photo of the page
            </button>
            .
          </div>
        ) : (
          <div className="hint">{hint}</div>
        )}
        <div className="btn-row">
          {still ? (
            <>
              <button type="button" className="btn primary" disabled={scanning || !pageBox} onClick={scanStill}>
                Scan {layout.cols * layout.rows} pockets
              </button>
              <button type="button" className="btn ghost" disabled={scanning} onClick={retake}>
                {frame === still ? 'Back' : 'Use camera'}
              </button>
            </>
          ) : (
            <button type="button" className="btn primary" disabled={scanning || !!error || !live || !pageBox} onClick={() => void capture()}>
              <CameraIcon size={18} /> Capture page
            </button>
          )}
          {!auto && (
            <button type="button" className="btn ghost" disabled={scanning} onClick={snapToPage}>
              Snap to page
            </button>
          )}
        </div>
      </div>
      {fileInput}
    </div>
  );
}
