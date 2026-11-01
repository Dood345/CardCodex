/**
 * Binder-page mode: photograph one page of a binder, OCR every pocket, then
 * confirm each pocket's card and how many copies sit stacked in that sleeve
 * before adding the whole page to the collection.
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
  type ScanAlternative,
  type ScanMatcher,
  type TextRecognizer,
} from '@/scanner';
import {
  PAGE_LAYOUTS,
  pageLayout,
  pageRect,
  pocketBoxes,
  scanPage,
  type PageLayoutId,
  type PageSource,
  type PocketEntry,
  type PocketScan,
} from '@/scanner/page';
import { Chip } from '@/ui/components';
import { CameraIcon, CloseIcon, MinusIcon, PlusIcon } from '@/ui/icons';
import { CorrectionSheet, fileToBitmap } from './shared';

/** Camera captures are taken at the stream's full resolution (≤ this). */
const CAPTURE_MAX_WIDTH = 4096;

type Phase = 'capture' | 'scanning' | 'review';

interface PocketState {
  scan: PocketScan;
  /** The confirmed card for the pocket (best guess until corrected). */
  card?: CatalogCard;
  set?: CatalogSet;
  qty: number;
}

export function PageScan({
  index,
  matcher,
  recognizer,
  collection,
  engineName,
  initialPhoto,
  onAdded,
  onExit,
}: {
  index: CatalogIndex;
  matcher: ScanMatcher;
  recognizer: TextRecognizer;
  collection: CollectionMap;
  engineName: string;
  /** Start straight in review of this photo instead of opening the camera. */
  initialPhoto?: File | null;
  onAdded: (entries: PocketEntry[]) => void;
  onExit: () => void;
}) {
  const [settings, update] = useSettings();
  const { cardMm } = useGame();
  const layout = pageLayout(settings.pageLayout);
  const [phase, setPhase] = useState<Phase>('capture');
  const [error, setError] = useState<string | null>(null);
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 });
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [pockets, setPockets] = useState<PocketState[]>([]);
  const [correcting, setCorrecting] = useState<number | null>(null);
  const [pageMs, setPageMs] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cameraWanted = phase === 'capture' && !initialPhoto;

  // Camera for the capture phase (own stream: no continuous OCR in page mode).
  useEffect(() => {
    if (!cameraWanted) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    setError(null);
    startCamera(video, { facingMode: 'environment' })
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
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('playing', onMeta);
    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('playing', onMeta);
      stopCamera(streamRef.current);
      streamRef.current = null;
    };
  }, [cameraWanted]);

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setViewSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [phase]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const runScan = useCallback(
    async (frame: PageSource) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setPhase('scanning');
      setProgress({ done: 0, total: layout.cols * layout.rows });
      const started = performance.now();
      try {
        const results = await scanPage(frame, layout, recognizer, matcher, {
          signal: ac.signal,
          geometry: { cardMm },
          onProgress: (done, total) => setProgress({ done, total }),
        });
        if (ac.signal.aborted) return;
        setPockets(
          results.map((scan) => ({
            scan,
            card: scan.candidate?.card,
            set: scan.candidate?.set,
            qty: scan.candidate ? 1 : 0,
          })),
        );
        setPageMs(performance.now() - started);
        setPhase('review');
      } catch (e) {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase('capture');
      } finally {
        if ('close' in frame && typeof frame.close === 'function') frame.close();
      }
    },
    [layout, recognizer, matcher, cardMm],
  );

  // A photo handed in from the intro screen.
  useEffect(() => {
    if (!initialPhoto) return;
    let cancelled = false;
    fileToBitmap(initialPhoto)
      .then((b) => {
        if (!cancelled) void runScan(b);
        else b.close();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPhoto]);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    // grabFrame reuses one canvas; copy it so the scan owns its pixels.
    const shared = grabFrame(video, CAPTURE_MAX_WIDTH);
    const frame = document.createElement('canvas');
    frame.width = shared.width;
    frame.height = shared.height;
    frame.getContext('2d')!.drawImage(shared, 0, 0);
    void runScan(frame);
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    try {
      void runScan(await fileToBitmap(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const setQty = (i: number, qty: number) =>
    setPockets((ps) => ps.map((p, j) => (j === i ? { ...p, qty: Math.max(0, qty) } : p)));
  const setCard = (i: number, card: CatalogCard, set: CatalogSet) =>
    setPockets((ps) => ps.map((p, j) => (j === i ? { ...p, card, set, qty: p.qty || 1 } : p)));

  const entries: PocketEntry[] = pockets
    .filter((p): p is PocketState & { card: CatalogCard; set: CatalogSet } => !!p.card && !!p.set && p.qty > 0)
    .map((p) => ({ card: p.card, set: p.set, qty: p.qty }));
  const totalCards = entries.reduce((n, e) => n + e.qty, 0);

  function addPage() {
    onAdded(entries);
    setPockets([]);
    setPhase('capture');
  }

  // Guide geometry: page rectangle and pocket cells in video space → view space.
  const guide = useMemo(() => {
    if (!videoSize.w || !viewSize.w) return null;
    const t = coverTransform(videoSize.w, videoSize.h, viewSize.w, viewSize.h);
    return {
      page: mapBox(pageRect(videoSize.w, videoSize.h, layout, { cardMm }), t),
      cells: pocketBoxes(videoSize.w, videoSize.h, layout, { cardMm }).map((p) => mapBox(p.box, t)),
    };
  }, [videoSize, viewSize, layout, cardMm]);

  const correctingOptions: ScanAlternative[] = useMemo(() => {
    if (correcting === null) return [];
    const p = pockets[correcting];
    if (!p) return [];
    const best = p.scan.candidate;
    return best
      ? [{ card: best.card, set: best.set, score: best.score, evidence: best.evidence }, ...p.scan.alternatives]
      : [];
  }, [correcting, pockets]);

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      hidden
      data-testid="page-photo-input"
      onChange={(e) => {
        void pickPhoto(e.target.files?.[0]);
        e.target.value = '';
      }}
    />
  );

  if (phase === 'review') {
    return (
      <div className="scan-page page-review">
        <div className="scan-hud static">
          <span className="scan-status">
            {layout.label} · {entries.length} of {pockets.length} pockets identified · {(pageMs / 1000).toFixed(1)}s
          </span>
          <button type="button" className="icon-btn" aria-label="Discard this page" onClick={() => setPhase('capture')}>
            <CloseIcon />
          </button>
        </div>
        <div className="pocket-grid" style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)` }}>
          {pockets.map((p, i) => (
            <div key={i} className={`pocket${p.card ? '' : ' pocket-empty'}`}>
              <button type="button" className="pocket-thumb" onClick={() => setCorrecting(i)} aria-label={`Pocket ${i + 1}: change card`}>
                <img src={p.scan.thumb} alt="" />
                {p.card && p.set && (
                  <img className="pocket-match" src={cardImageUrl(p.card, p.set.series, 'low')} alt="" />
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
                      {!p.scan.candidate || p.scan.candidate.card.id !== p.card.id
                        ? ''
                        : p.scan.candidate.confident
                          ? ''
                          : ' · ?'}
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
        <div className="scan-bottom">
          <p className="hint">
            Bump the count on any pocket that holds several copies in one sleeve. Tap a pocket to correct the card.
          </p>
          <div className="btn-row">
            <button type="button" className="btn primary" disabled={totalCards === 0} onClick={addPage}>
              Add {totalCards} {totalCards === 1 ? 'card' : 'cards'} to collection
            </button>
            <button type="button" className="btn ghost" onClick={() => setPhase('capture')}>
              Rescan page
            </button>
          </div>
        </div>
        <CorrectionSheet
          open={correcting !== null}
          options={correctingOptions}
          index={index}
          title={correcting !== null ? `Pocket ${correcting + 1}` : undefined}
          onClose={() => setCorrecting(null)}
          onPick={(card, set) => {
            if (correcting !== null) setCard(correcting, card, set);
            setCorrecting(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="scan-page">
      <div className="scan-view" ref={viewRef}>
        {cameraWanted ? (
          <video ref={videoRef} className="scan-video" playsInline muted autoPlay />
        ) : (
          <div className="scan-video" />
        )}
        {phase === 'capture' && guide && (
          <div className="scan-overlay">
            <div className="page-guide" style={{ left: guide.page.x, top: guide.page.y, width: guide.page.w, height: guide.page.h }} />
            {guide.cells.map((c, i) => (
              <div key={i} className="page-cell" style={{ left: c.x, top: c.y, width: c.w, height: c.h }}>
                <span>{i + 1}</span>
              </div>
            ))}
          </div>
        )}
        {phase === 'scanning' && (
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
                setPhase('capture');
              }}
            >
              Cancel
            </button>
          </div>
        )}
        <div className="scan-hud">
          <span className="scan-status">
            <span className={`scan-dot${phase === 'capture' && streamRef.current ? ' live' : ''}`} />
            {error ? error : phase === 'scanning' ? `Reading page · ${engineName}` : `Binder page · ${layout.label}`}
          </span>
          <span className="btn-row">
            <button type="button" className="btn ghost" style={{ color: '#fff' }} onClick={() => fileRef.current?.click()}>
              Photo
            </button>
            <button type="button" className="icon-btn" style={{ color: '#fff' }} aria-label="Leave page mode" onClick={onExit}>
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
          <div className="hint">Line the binder page up with the frame so every pocket sits in its cell, then capture.</div>
        )}
        <div className="btn-row">
          <button type="button" className="btn primary" disabled={phase !== 'capture' || !!error || !videoSize.w} onClick={capture}>
            <CameraIcon size={18} /> Capture page
          </button>
        </div>
      </div>
      {fileInput}
    </div>
  );
}
