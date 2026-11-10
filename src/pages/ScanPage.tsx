/**
 * Scanner entry: single-card mode (live chips, tap to add, photo fallback)
 * and binder-page mode (PageScan). Shared pieces live in ./scan/shared.tsx;
 * the working state lives in ./scan/session.ts so that leaving the tab and
 * coming back resumes where you were.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCatalog, useGame } from '@/app/context';
import { useSettings } from '@/app/settings';
import { adjustQty, useCollection } from '@/data/collection';
import { formatCardNumber } from '@/data/catalog';
import { db } from '@/data/db';
import { cardImageUrl, type CatalogCard, type CatalogSet } from '@/data/types';
import {
  coverTransform,
  getRecognizer,
  loadHashTable,
  chipAnchor,
  mapBox,
  useCardScanner,
  type Box,
  type HashTable,
  type CoverTransform,
  type ScanAlternative,
  type ScanCandidate,
  type ScanMatcher,
} from '@/scanner';
import { focusTracks } from '@/scanner/focus';
import { POCKET_SAMPLE_WIDTH, samplePocketLuma } from '@/scanner/hash';
import { loadEnergyReferences, withBareEnergy, type EnergyReferences } from '@/scanner/energy';
import { sampleRgba } from '@/scanner/grid';
import { addLiveArtwork, matchStillCard } from '@/scanner/live-artwork';
import type { PocketEntry } from '@/scanner/page';
import { Toast, useToast } from '@/ui/components';
import { CameraIcon, CheckIcon, CloseIcon, MinusIcon, PlusIcon } from '@/ui/icons';
import { useBackHandler } from '@/ui/back';
import { href } from '@/ui/router';
import { PageScan, openPagePhoto } from './scan/PageScan';
import { SessionBar, SessionList, SessionSheet } from './scan/SessionSheet';
import { SnapScan, cropToGuide, type SnapCapture } from './scan/SnapScan';
import {
  clearAdded,
  getScanSession,
  hasSavedReview,
  patchScanSession,
  recordAdded,
  resetScanSession,
  useScanSession,
} from './scan/session';
import { aggregateLog } from './scan/session-list';
import {
  BLANK_POSTER,
  CameraPlaceholder,
  CandidateRow,
  CorrectionSheet,
  ScanArt,
  containTransform,
  useViewSize,
  fileToCanvas,
  recognizerFor,
  recordScan,
} from './scan/shared';

const STILL_MAX_WIDTH = 1600;
/** Smaller stills (saved images, screenshots) are upscaled to STILL_MAX_WIDTH; see fileToCanvas. */
const STILL_MIN_WIDTH = 1200;
/** Runner-up candidates listed under a live chip's row need at least this share of its pool. */
const RUNNER_UP_MIN = 0.12;
const RUNNER_UPS = 2;
/** Alternatives listed under a still's candidate: the photo flow's match options. */
const STILL_RUNNER_UPS = 3;
/** Rows the start screen lists of what the scanner added (this session, or earlier from the log); the sheet has the rest. */
const START_LIST_MAX = 3;
/** Margin around the card guide kept in a snapped photo's crop (share of the guide). */
const SNAP_CROP_PAD = 0.25;
/** How long the "last added" stepper stays after the last interaction. */
const LAST_ADDED_MS = 6000;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function ScanPage() {
  const index = useCatalog();
  const game = useGame();
  const collection = useCollection();
  const [settings, update] = useSettings();
  const mode = settings.scanMode;
  const pageMode = mode === 'page';
  const snapMode = !pageMode && settings.cardMode === 'snap';
  const session = useScanSession();
  // A session from the other game holds that catalog's cards: start over.
  useEffect(() => {
    if (getScanSession().game !== game.id) resetScanSession(game.id);
  }, [game.id]);
  const current = session.game === game.id;
  const armed = current && session.armed;
  const still = current ? session.still : null;
  const logAdds = current ? session.logAdds : [];
  const added = current ? session.added : [];
  const setArmed = (v: boolean) => patchScanSession({ armed: v });
  const [toast, showToast] = useToast();
  const [correcting, setCorrecting] = useState<ScanCandidate | null>(null);
  const [justAdded, setJustAdded] = useState<Map<string, number>>(() => new Map());
  const [savedReview, setSavedReview] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  /** The card added last, with a stepper to fix its count (hidden after a few seconds). */
  const [lastAdded, setLastAdded] = useState<{ card: CatalogCard; set: CatalogSet } | null>(null);
  const lastTimer = useRef<number | undefined>(undefined);
  const showLast = useCallback((card: CatalogCard, set: CatalogSet) => {
    setLastAdded({ card, set });
    window.clearTimeout(lastTimer.current);
    lastTimer.current = window.setTimeout(() => setLastAdded(null), LAST_ADDED_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(lastTimer.current), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [viewRef, viewSize] = useViewSize();

  // Built once per catalog (~21k Pokémon cards / 38k Yu-Gi-Oh! printings → ~100 ms).
  const matcher: ScanMatcher = useMemo(() => game.createMatcher(index), [game, index]);
  const recognizer = recognizerFor(settings);
  // The artwork table for stills (the live hook loads the same cached promise for itself).
  const [table, setTable] = useState<HashTable | null>(null);
  // Colour references for basic Energy cards that print no name (src/scanner/energy.ts); Pokémon only.
  const [energyRefs, setEnergyRefs] = useState<EnergyReferences | null>(null);
  useEffect(() => {
    let cancelled = false;
    setEnergyRefs(null);
    if (!matcher.lookup) return;
    void loadEnergyReferences(matcher.game).then((r) => {
      if (!cancelled) setEnergyRefs(r);
    });
    return () => {
      cancelled = true;
    };
  }, [matcher]);
  useEffect(() => {
    let cancelled = false;
    setTable(null);
    if (!matcher.lookup) return;
    loadHashTable(matcher.game).then((t) => {
      if (!cancelled) setTable(t);
    });
    return () => {
      cancelled = true;
    };
  }, [matcher]);

  const scanner = useCardScanner({ matcher, enabled: armed && !still && !pageMode && !snapMode, recognizer });
  const engineName = scanner.engine === 'mlkit' ? 'ML Kit' : scanner.engine === 'tesseract' ? 'Tesseract' : 'on-device OCR';
  const cameraLive = scanner.status === 'scanning';

  // Android back in single-card mode: a photo closes; the live camera returns to the mode choice. Page mode handles its own.
  useBackHandler(!!still || (armed && !pageMode), () => {
    if (getScanSession().still) closeStill();
    else setArmed(false);
  });

  // First visit: what the scanner added before this session, from the scan log.
  useEffect(() => {
    if (!current || logAdds.length) return;
    let cancelled = false;
    db.scanLog
      .orderBy('at')
      .reverse()
      .limit(60)
      .toArray()
      .then((rows) => {
        if (cancelled || getScanSession().logAdds.length) return;
        const list = aggregateLog(
          rows,
          (id) => {
            const card = index.cardsById.get(id);
            const set = card && index.setsById.get(card.set);
            return card && set ? { card, set } : undefined;
          },
          START_LIST_MAX,
        );
        if (list.length) patchScanSession({ logAdds: list });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [current, logAdds.length, index]);

  // Intro screen: offer to resume a page review the app was killed in the middle of.
  useEffect(() => {
    if (armed || !pageMode) return;
    let cancelled = false;
    hasSavedReview(game.id).then((v) => {
      if (!cancelled) setSavedReview(v);
    });
    return () => {
      cancelled = true;
    };
  }, [armed, pageMode, game.id]);

  const transform: CoverTransform = useMemo(
    () =>
      still
        ? containTransform(still.w, still.h, viewSize.w, viewSize.h)
        : coverTransform(scanner.frameSize.w, scanner.frameSize.h, viewSize.w, viewSize.h),
    [still, scanner.frameSize, viewSize],
  );

  const addCard = useCallback(
    async (card: CatalogCard, set: CatalogSet, trackKey?: string) => {
      await recordScan(card, 1, scanner.engine ?? (recognizer ?? getRecognizer()).engine ?? 'photo');
      recordAdded(card, set, 1);
      // A snapped photo is one card: once it is added, back to the camera for the next.
      if (getScanSession().still?.source === 'photo') closeStill();
      if (trackKey) {
        setJustAdded((m) => new Map(m).set(trackKey, Date.now()));
        window.setTimeout(
          () =>
            setJustAdded((m) => {
              const n = new Map(m);
              n.delete(trackKey);
              return n;
            }),
          2500,
        );
      }
      showLast(card, set);
      if ('vibrate' in navigator) navigator.vibrate?.(30);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scanner.engine, recognizer, showLast],
  );

  /** The "last added" bar: name, new total, −/+ and undo. */
  const lastAddedBar = lastAdded && (
    <div className="scan-last" role="status">
      <img src={cardImageUrl(lastAdded.card, lastAdded.set.series, 'low')} alt="" />
      <div className="scan-last-text">
        <div className="cand-name">{lastAdded.card.name}</div>
        <div className="cand-sub">
          {lastAdded.set.name} · {formatCardNumber(lastAdded.card, lastAdded.set)}
        </div>
      </div>
      <div className="stepper stepper-sm" aria-label="Copies owned">
        <button
          type="button"
          className="stepper-btn"
          aria-label="One fewer"
          disabled={(collection.get(lastAdded.card.id)?.qty ?? 0) <= 0}
          onClick={() => {
            void adjustQty(lastAdded.card.id, -1);
            showLast(lastAdded.card, lastAdded.set);
          }}
        >
          <MinusIcon size={14} />
        </button>
        <span className="stepper-value">{collection.get(lastAdded.card.id)?.qty ?? 0}</span>
        <button
          type="button"
          className="stepper-btn"
          aria-label="One more"
          onClick={() => {
            void adjustQty(lastAdded.card.id, 1);
            showLast(lastAdded.card, lastAdded.set);
          }}
        >
          <PlusIcon size={14} />
        </button>
      </div>
      <button
        type="button"
        className="btn ghost small"
        onClick={() => {
          void adjustQty(lastAdded.card.id, -1);
          recordAdded(lastAdded.card, lastAdded.set, -1);
          setLastAdded(null);
        }}
      >
        Undo
      </button>
    </div>
  );

  const addPage = useCallback(
    async (entries: PocketEntry[]) => {
      let total = 0;
      for (const e of entries) {
        await recordScan(e.card, e.qty, 'page');
        recordAdded(e.card, e.set, e.qty);
        total += e.qty;
      }
      showToast(`Added ${total} ${total === 1 ? 'card' : 'cards'} from this page`);
      if ('vibrate' in navigator) navigator.vibrate?.([30, 40, 30]);
    },
    [showToast],
  );

  /**
   * Read a still: OCR, the matcher, and the picture. A snapped photo comes
   * with the card guide, so the guide region is hashed and merged into the
   * candidate framed by it, or stands in for one when the text gave nothing;
   * a gallery photo is hashed around whatever the text found.
   */
  const scanStill = useCallback(
    async (canvas: HTMLCanvasElement, url: string, source: 'photo' | 'file', guide?: Box) => {
      const started = performance.now();
      try {
        const lines = await (recognizer ?? getRecognizer()).recognize(canvas);
        let results = matcher.scanLines(lines);
        const lookup = matcher.lookup?.bind(matcher);
        if (table && lookup) {
          const frame = { w: canvas.width, h: canvas.height };
          const sample = (region: Box) => samplePocketLuma(canvas, region);
          results = guide ? matchStillCard(results, guide, frame, table, lookup, sample) : addLiveArtwork(results, frame, table, lookup, sample);
        }
        // A basic Energy that prints only "ENERGY": matched by picture and colour when nothing else was sure.
        if (energyRefs && lookup) {
          results = withBareEnergy(results, {
            lines,
            frame: { w: canvas.width, h: canvas.height },
            guide,
            refs: energyRefs,
            lookup,
            sample: (region) => sampleRgba(canvas, region, POCKET_SAMPLE_WIDTH),
          });
        }
        if (getScanSession().still?.url !== url) return;
        patchScanSession({
          still: { url, w: canvas.width, h: canvas.height, results, busy: false, ms: performance.now() - started, lineCount: lines.length, source },
        });
      } catch (e) {
        const s = getScanSession().still;
        if (s && s.url === url) patchScanSession({ still: { ...s, busy: false, error: e instanceof Error ? e.message : String(e) } });
      }
    },
    [recognizer, matcher, table, energyRefs],
  );

  /** A picture from the camera app or the gallery. */
  const scanPhoto = useCallback(
    async (file: File) => {
      const url = URL.createObjectURL(file);
      const prev = getScanSession().still;
      if (prev) URL.revokeObjectURL(prev.url);
      patchScanSession({ still: { url, w: 0, h: 0, results: [], busy: true, source: 'file' } });
      try {
        const canvas = await fileToCanvas(file, STILL_MAX_WIDTH, STILL_MIN_WIDTH);
        await scanStill(canvas, url, 'file');
      } catch (e) {
        const s = getScanSession().still;
        if (s && s.url === url) patchScanSession({ still: { ...s, busy: false, error: e instanceof Error ? e.message : String(e) } });
      }
    },
    [scanStill],
  );

  /** A photo snapped in the camera view: the card guide plus a margin, read like a gallery photo. */
  const scanSnap = useCallback(
    async (cap: SnapCapture) => {
      const { canvas, guide } = cropToGuide(cap.source, cap.guide, SNAP_CROP_PAD, STILL_MAX_WIDTH, STILL_MIN_WIDTH, { w: cap.w, h: cap.h });
      (cap.source as { close?: () => void }).close?.();
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
      const url = blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/jpeg', 0.9);
      const prev = getScanSession().still;
      if (prev) URL.revokeObjectURL(prev.url);
      patchScanSession({ still: { url, w: canvas.width, h: canvas.height, results: [], busy: true, source: 'photo' } });
      await scanStill(canvas, url, 'photo', guide);
    },
    [scanStill],
  );

  const closeStill = () => {
    if (still) URL.revokeObjectURL(still.url);
    patchScanSession({ still: null });
  };

  const results: ScanCandidate[] = still ? still.results : focusTracks(scanner.results, scanner.frameSize);

  const statusText = still
    ? still.busy
      ? 'Reading photo…'
      : still.error
        ? still.error
        : `${still.results.length} card${still.results.length === 1 ? '' : 's'} found${still.ms ? ` · ${(still.ms / 1000).toFixed(1)}s` : ''}`
    : scanner.status === 'error'
      ? (scanner.error ?? 'Camera error')
      : scanner.status === 'starting'
        ? 'Starting camera…'
        : scanner.paused
          ? 'Paused'
          : scanner.engine
            ? `Scanning · ${engineName}`
            : 'Loading recognizer…';

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      hidden
      data-testid="photo-input"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) {
          if (pageMode) {
            openPagePhoto(f)
              .then(() => setArmed(true))
              .catch((err: unknown) => showToast(err instanceof Error ? err.message : String(err)));
          } else void scanPhoto(f);
        }
        e.target.value = '';
      }}
    />
  );

  const correctingOptions: ScanAlternative[] = correcting
    ? [{ card: correcting.card, set: correcting.set, score: correcting.score, evidence: correcting.evidence }, ...correcting.alternatives]
    : [];

  const sessionSheet = (
    <SessionSheet
      open={sessionOpen}
      added={added}
      collection={collection}
      onClose={() => setSessionOpen(false)}
      onClear={() => {
        clearAdded();
        setSessionOpen(false);
      }}
    />
  );

  const modeToggle = !pageMode && (
    <div className="segmented small" role="tablist" aria-label="Single-card mode">
      <button type="button" role="tab" aria-selected={snapMode} className={snapMode ? 'active' : ''} onClick={() => update({ cardMode: 'snap' })}>
        Snap a photo
      </button>
      <button type="button" role="tab" aria-selected={!snapMode} className={!snapMode ? 'active' : ''} onClick={() => update({ cardMode: 'live' })}>
        Live
      </button>
    </div>
  );

  if (pageMode && armed) {
    return (
      <>
        <PageScan
          index={index}
          matcher={matcher}
          recognizer={recognizer ?? getRecognizer()}
          collection={collection}
          engineName={engineName}
          onAdded={(entries) => void addPage(entries)}
          onExit={() => setArmed(false)}
        />
        <Toast message={toast} />
        {sessionSheet}
      </>
    );
  }

  if (snapMode && armed && !still) {
    return (
      <>
        <SnapScan
          cardAspect={game.cardMm.w / game.cardMm.h}
          Icon={game.Icon}
          onCaptured={(cap) => void scanSnap(cap)}
          onFile={() => fileRef.current?.click()}
          onExit={() => setArmed(false)}
          overlay={lastAddedBar}
        >
          {modeToggle}
          {added.length > 0 && <SessionBar added={added} onOpen={() => setSessionOpen(true)} />}
        </SnapScan>
        {fileInput}
        <Toast message={toast} />
        {sessionSheet}
      </>
    );
  }

  if (!armed && !still) {
    return (
      <div className="scan-page">
        <div className="scan-intro">
          <div className="segmented" role="tablist" aria-label="Scan mode">
            <button type="button" role="tab" aria-selected={!pageMode} className={!pageMode ? 'active' : ''} onClick={() => update({ scanMode: 'cards' })}>
              Single cards
            </button>
            <button type="button" role="tab" aria-selected={pageMode} className={pageMode ? 'active' : ''} onClick={() => update({ scanMode: 'page' })}>
              Binder page
            </button>
          </div>
          {modeToggle && <div className="scan-submode">{modeToggle}</div>}
          <ScanArt Icon={game.Icon} />
          {pageMode ? (
            <>
              <h2>Scan a binder page</h2>
              <p>
                Point the camera at a whole page: the grid finds the cards (drag it if it doesn't), then CardCodex reads every pocket
                and you confirm each card and how many copies are stacked in that sleeve before adding the page to your collection.
              </p>
            </>
          ) : (
            <>
              <h2>Scan your cards</h2>
              <p>
                {snapMode
                  ? 'Frame one card, tap the shutter and pick the match from the list. Switch to Live to read cards as you hold them up.'
                  : game.text.scanIntro}
              </p>
            </>
          )}
          <p>Everything runs on this device; no images are uploaded.</p>
          <div className="btn-row" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn primary" onClick={() => setArmed(true)}>
              <CameraIcon size={18} /> Start camera
            </button>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
              {pageMode ? 'Scan a page photo' : 'Scan a photo'}
            </button>
          </div>
          {pageMode && savedReview && (
            <button type="button" className="link-btn" onClick={() => setArmed(true)}>
              Resume the page you were reviewing
            </button>
          )}
          {(added.length > 0 || logAdds.length > 0) && (
            <div className="scan-added">
              <div className="scan-section-label">{added.length ? 'Added this session' : 'Recently added with the scanner'}</div>
              <SessionList
                added={(added.length ? added : logAdds).slice(0, START_LIST_MAX)}
                collection={collection}
                mode={added.length ? 'session' : 'log'}
              />
              {added.length > START_LIST_MAX && (
                <button type="button" className="link-btn" onClick={() => setSessionOpen(true)}>
                  All {added.length} cards added this session
                </button>
              )}
            </div>
          )}
        </div>
        {fileInput}
        <Toast message={toast} />
        {sessionSheet}
      </div>
    );
  }

  return (
    <div className="scan-page">
      <div className="scan-view" ref={viewRef}>
        {still ? (
          <img src={still.url} alt="Photo being scanned" className="scan-still" />
        ) : (
          <video ref={scanner.videoRef} className={`scan-video${cameraLive ? '' : ' hidden'}`} poster={BLANK_POSTER} playsInline muted autoPlay />
        )}
        {!still && !cameraLive && <CameraPlaceholder Icon={game.Icon} text={statusText} live={scanner.status === 'starting'} />}
        {!still && cameraLive && scanner.results.length === 0 && <div className="scan-guide" />}
        {still?.busy && (
          <div className="scan-busy" role="status">
            <div className="spinner-ring" />
            <div>Reading the card…</div>
          </div>
        )}
        <div className="scan-overlay">
          {/* Nothing is drawn until the view has a size: boxes mapped onto a 0×0 view all land in the corner. */}
          {(viewSize.w > 0 ? results : []).map((r) => {
            const box = mapBox((r.cardBox ?? r.bbox) as Box, transform);
            const added = justAdded.has(r.key);
            const owned = collection.get(r.card.id)?.qty ?? 0;
            const thumb = cardImageUrl(r.card, r.set.series, 'low');
            // The chip sits in the middle of its card, kept on screen when the card is at the edge of the frame.
            const { x: cx, y: cy } = chipAnchor(box, viewSize);
            const steady = still ? r.score : (r.stability ?? 0);
            return (
              <div key={r.key}>
                <div className="scan-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
                <div className={`scan-chip${added ? ' added' : ''}${r.confident ? ' sure' : ''}`} style={{ left: cx, top: cy }}>
                  <button
                    type="button"
                    className="chip-main"
                    onClick={() => void addCard(r.card, r.set, r.key)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setCorrecting(r);
                    }}
                  >
                    {thumb && <img className="chip-thumb" src={thumb} alt="" />}
                    <span className="chip-text">
                      <span>{r.card.name}</span>
                      <span className="chip-sub">
                        {r.set.name} · {formatCardNumber(r.card, r.set)}
                        {owned ? ` · own ${owned}` : ''}
                        {!r.confident ? ' · ?' : ''}
                      </span>
                    </span>
                    <span className="chip-add">{added ? <CheckIcon size={16} /> : <PlusIcon size={16} />}</span>
                  </button>
                  <button type="button" className="chip-more" aria-label="Choose a different card" onClick={() => setCorrecting(r)}>
                    ▾
                  </button>
                  <span className="chip-conf" aria-hidden="true">
                    <span style={{ width: `${Math.round(clamp(steady, 0, 1) * 100)}%` }} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="scan-hud">
          <span className="scan-status">
            <span className={`scan-dot${(!still && cameraLive && !scanner.paused) || still?.busy ? ' live' : ''}`} />
            {statusText}
          </span>
          <span className="btn-row">
            {!still && cameraLive && (
              <button
                type="button"
                className="btn ghost"
                style={{ color: '#fff' }}
                onClick={() => (scanner.paused ? scanner.resume() : scanner.pause())}
              >
                {scanner.paused ? 'Resume' : 'Pause'}
              </button>
            )}
            <button type="button" className="btn ghost" style={{ color: '#fff' }} onClick={() => fileRef.current?.click()}>
              Photo
            </button>
            <button
              type="button"
              className="icon-btn"
              style={{ color: '#fff' }}
              aria-label={still ? (still.source === 'photo' ? 'Retake' : 'Close photo') : 'Stop scanning'}
              onClick={() => (still ? closeStill() : setArmed(false))}
            >
              <CloseIcon />
            </button>
          </span>
        </div>
        {lastAddedBar}
      </div>

      <div className="scan-bottom">
        {!still && modeToggle}
        {still?.source === 'photo' && !still.busy && (
          <div className="btn-row">
            <button type="button" className="btn ghost" onClick={closeStill}>
              Retake
            </button>
          </div>
        )}
        {!still && scanner.status === 'error' && (
          <div className="hint">
            {scanner.error}. Try{' '}
            <button type="button" className="link-btn" onClick={() => fileRef.current?.click()}>
              scanning a photo
            </button>{' '}
            instead, or add cards from <a href={href('/search')}>Search</a>.
          </div>
        )}
        {still?.error && <div className="hint">Could not read that photo: {still.error}</div>}
        {results.length > 0 ? (
          <div className="scan-candidates">
            {results.map((r) => {
              const runners = still ? r.alternatives.slice(0, STILL_RUNNER_UPS) : r.alternatives.filter((a) => a.score >= RUNNER_UP_MIN).slice(0, RUNNER_UPS);
              return (
                <div key={r.key} className="scan-track">
                  <CandidateRow
                    card={r.card}
                    set={r.set}
                    score={still ? r.score : (r.stability ?? 0)}
                    scoreLabel={still ? undefined : 'steady'}
                    evidence={r.evidence}
                    owned={collection.get(r.card.id)?.qty ?? 0}
                    onAdd={() => void addCard(r.card, r.set, r.key)}
                    onCorrect={() => setCorrecting(r)}
                  />
                  {runners.length > 0 && (
                    <div className="cand-runners" aria-label="Other likely cards">
                      {runners.map((a) => (
                        <button key={a.card.id} type="button" className="cand-runner" onClick={() => void addCard(a.card, a.set, r.key)}>
                          <img src={cardImageUrl(a.card, a.set.series, 'low')} alt="" />
                          <span className="cand-runner-text">
                            <span className="cand-name">{a.card.name}</span>
                            <span className="cand-sub">
                              {a.set.name} · {formatCardNumber(a.card, a.set)}
                            </span>
                          </span>
                          <span className="cand-score">{Math.round(a.score * 100)}%</span>
                          <span className="chip-add small">
                            <PlusIcon size={14} />
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : still ? (
          !still.busy &&
          !still.error && (
            <div className="hint">
              {still.lineCount
                ? `Read ${still.lineCount} lines of text but none matched a card. `
                : 'No readable text found in this photo. '}
              {game.text.scanPhotoHint}
            </div>
          )
        ) : (
          cameraLive && <div className="hint">{game.text.scanHint}</div>
        )}
        {added.length > 0 && <SessionBar added={added} onOpen={() => setSessionOpen(true)} />}
      </div>

      <CorrectionSheet
        open={correcting !== null}
        options={correctingOptions}
        index={index}
        current={correcting?.card.id}
        onClose={() => setCorrecting(null)}
        onPick={(card, set) => {
          const key = correcting?.key;
          setCorrecting(null);
          void addCard(card, set, key);
        }}
      />
      <Toast message={toast} />
      {sessionSheet}
      {fileInput}
    </div>
  );
}
