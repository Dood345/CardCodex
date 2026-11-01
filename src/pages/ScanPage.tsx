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
  mapBox,
  useCardScanner,
  type Box,
  type CoverTransform,
  type ScanAlternative,
  type ScanCandidate,
  type ScanMatcher,
} from '@/scanner';
import type { PocketEntry } from '@/scanner/page';
import { Toast, useToast } from '@/ui/components';
import { CameraIcon, CheckIcon, CloseIcon, MinusIcon, PlusIcon } from '@/ui/icons';
import { href } from '@/ui/router';
import { PageScan, openPagePhoto } from './scan/PageScan';
import {
  getScanSession,
  hasSavedReview,
  patchScanSession,
  resetScanSession,
  useScanSession,
  type Recent,
} from './scan/session';
import {
  BLANK_POSTER,
  CameraPlaceholder,
  CandidateRow,
  CorrectionSheet,
  RecentStrip,
  ScanArt,
  containTransform,
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
/** How long the "last added" stepper stays after the last interaction. */
const LAST_ADDED_MS = 6000;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Live single-card mode shows at most this many cards at once. */
const MAX_LIVE_CARDS = 2;
/** A second card must be at least this share of the first by (area × centrality) to be shown too. */
const SECOND_CARD_SHARE = 0.45;

/**
 * Single-card mode is for one card at a time: when the camera also sees a
 * binder page or the next card in the pile, keep the largest card nearest
 * the middle of the frame (and a second one only if it is nearly as big)
 * instead of covering the view with chips.
 */
export function focusTracks(results: ScanCandidate[], frame: { w: number; h: number }): ScanCandidate[] {
  if (results.length <= 1 || !frame.w || !frame.h) return results;
  const cx = frame.w / 2;
  const cy = frame.h / 2;
  const diag = Math.hypot(frame.w, frame.h) / 2;
  const ranked = results
    .map((r) => {
      const b = r.cardBox ?? r.bbox;
      const d = Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy) / diag;
      return { r, score: Math.max(1, b.w * b.h) * (1 - 0.6 * Math.min(1, d)) };
    })
    .sort((a, b) => b.score - a.score);
  const top = ranked[0].score;
  return ranked
    .filter((x, i) => i === 0 || (i < MAX_LIVE_CARDS && x.score >= top * SECOND_CARD_SHARE))
    .map((x) => x.r);
}

export default function ScanPage() {
  const index = useCatalog();
  const game = useGame();
  const collection = useCollection();
  const [settings, update] = useSettings();
  const mode = settings.scanMode;
  const pageMode = mode === 'page';
  const session = useScanSession();
  // A session from the other game holds that catalog's cards: start over.
  useEffect(() => {
    if (getScanSession().game !== game.id) resetScanSession(game.id);
  }, [game.id]);
  const current = session.game === game.id;
  const armed = current && session.armed;
  const still = current ? session.still : null;
  const recent = current ? session.recent : [];
  const setArmed = (v: boolean) => patchScanSession({ armed: v });
  const [toast, showToast] = useToast();
  const [correcting, setCorrecting] = useState<ScanCandidate | null>(null);
  const [justAdded, setJustAdded] = useState<Map<string, number>>(() => new Map());
  const [savedReview, setSavedReview] = useState(false);
  /** The card added last, with a stepper to fix its count (hidden after a few seconds). */
  const [lastAdded, setLastAdded] = useState<{ card: CatalogCard; set: CatalogSet } | null>(null);
  const lastTimer = useRef<number | undefined>(undefined);
  const showLast = useCallback((card: CatalogCard, set: CatalogSet) => {
    setLastAdded({ card, set });
    window.clearTimeout(lastTimer.current);
    lastTimer.current = window.setTimeout(() => setLastAdded(null), LAST_ADDED_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(lastTimer.current), []);
  const viewRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 });

  // Built once per catalog (~21k Pokémon cards / 38k Yu-Gi-Oh! printings → ~100 ms).
  const matcher: ScanMatcher = useMemo(() => game.createMatcher(index), [game, index]);
  const recognizer = recognizerFor(settings);

  const scanner = useCardScanner({ matcher, enabled: armed && !still && !pageMode, recognizer });
  const engineName = scanner.engine === 'mlkit' ? 'ML Kit' : scanner.engine === 'tesseract' ? 'Tesseract' : 'on-device OCR';
  const cameraLive = scanner.status === 'scanning';

  // First visit: the strip of recent scans comes from the scan log.
  useEffect(() => {
    if (!current || recent.length) return;
    let cancelled = false;
    db.scanLog
      .orderBy('at')
      .reverse()
      .limit(40)
      .toArray()
      .then((rows) => {
        if (cancelled || getScanSession().recent.length) return;
        const seen = new Set<string>();
        const list: Recent[] = [];
        for (const r of rows) {
          if (seen.has(r.cardId)) continue;
          const card = index.cardsById.get(r.cardId);
          const set = card && index.setsById.get(card.set);
          if (!card || !set) continue;
          seen.add(r.cardId);
          list.push({ card, set, qty: 1, at: r.at });
          if (list.length >= 12) break;
        }
        if (list.length) patchScanSession({ recent: list });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [current, recent.length, index]);

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

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setViewSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [armed, still, pageMode]);

  const transform: CoverTransform = useMemo(
    () =>
      still
        ? containTransform(still.w, still.h, viewSize.w, viewSize.h)
        : coverTransform(scanner.frameSize.w, scanner.frameSize.h, viewSize.w, viewSize.h),
    [still, scanner.frameSize, viewSize],
  );

  const pushRecent = useCallback((card: CatalogCard, set: CatalogSet, qty: number) => {
    patchScanSession({ recent: [{ card, set, qty, at: Date.now() }, ...getScanSession().recent].slice(0, 12) });
  }, []);

  const addCard = useCallback(
    async (card: CatalogCard, set: CatalogSet, trackKey?: string) => {
      await recordScan(card, 1, scanner.engine ?? 'manual');
      pushRecent(card, set, 1);
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
    [scanner.engine, pushRecent, showLast],
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
        pushRecent(e.card, e.set, e.qty);
        total += e.qty;
      }
      showToast(`Added ${total} ${total === 1 ? 'card' : 'cards'} from this page`);
      if ('vibrate' in navigator) navigator.vibrate?.([30, 40, 30]);
    },
    [pushRecent, showToast],
  );

  /** Run the recognizer + matcher on a still image (camera app or gallery). */
  const scanPhoto = useCallback(
    async (file: File) => {
      const url = URL.createObjectURL(file);
      const prev = getScanSession().still;
      if (prev) URL.revokeObjectURL(prev.url);
      patchScanSession({ still: { url, w: 0, h: 0, results: [], busy: true } });
      const started = performance.now();
      try {
        const canvas = await fileToCanvas(file, STILL_MAX_WIDTH, STILL_MIN_WIDTH);
        const lines = await (recognizer ?? getRecognizer()).recognize(canvas);
        const results = matcher.scanLines(lines);
        if (getScanSession().still?.url !== url) return;
        patchScanSession({
          still: { url, w: canvas.width, h: canvas.height, results, busy: false, ms: performance.now() - started, lineCount: lines.length },
        });
      } catch (e) {
        const s = getScanSession().still;
        if (s && s.url === url) patchScanSession({ still: { ...s, busy: false, error: e instanceof Error ? e.message : String(e) } });
      }
    },
    [recognizer, matcher],
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
              <p>{game.text.scanIntro}</p>
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
          {recent.length > 0 && <RecentStrip recent={recent} />}
        </div>
        {fileInput}
        <Toast message={toast} />
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
        <div className="scan-overlay">
          {results.map((r) => {
            const box = mapBox((r.cardBox ?? r.bbox) as Box, transform);
            const anchor = mapBox(r.bbox, transform);
            const added = justAdded.has(r.key);
            const owned = collection.get(r.card.id)?.qty ?? 0;
            const thumb = cardImageUrl(r.card, r.set.series, 'low');
            // Keep the chip on screen even when the card sits at the edge of the frame.
            const cx = viewSize.w ? clamp(anchor.x + anchor.w / 2, viewSize.w * 0.4, viewSize.w * 0.6) : anchor.x + anchor.w / 2;
            const cy = clamp(anchor.y - 6, 56, Math.max(56, viewSize.h - 12));
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
              aria-label={still ? 'Close photo' : 'Stop scanning'}
              onClick={() => (still ? closeStill() : setArmed(false))}
            >
              <CloseIcon />
            </button>
          </span>
        </div>
        {lastAddedBar}
      </div>

      <div className="scan-bottom">
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
              const runners = still ? [] : r.alternatives.filter((a) => a.score >= RUNNER_UP_MIN).slice(0, RUNNER_UPS);
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
        {recent.length > 0 && <RecentStrip recent={recent} />}
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
      {fileInput}
    </div>
  );
}
