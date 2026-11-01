/**
 * Scanner entry: single-card mode (live chips, tap to add, photo fallback)
 * and binder-page mode (PageScan). Shared pieces live in ./scan/shared.tsx.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCatalog } from '@/app/context';
import { useSettings } from '@/app/settings';
import { useCollection } from '@/data/collection';
import { formatCardNumber } from '@/data/catalog';
import { cardImageUrl, type CatalogCard, type CatalogSet } from '@/data/types';
import {
  buildScanIndex,
  coverTransform,
  getRecognizer,
  mapBox,
  scanLines,
  useCardScanner,
  type Box,
  type CoverTransform,
  type ScanAlternative,
  type ScanCandidate,
  type ScanIndex,
} from '@/scanner';
import type { PocketEntry } from '@/scanner/page';
import { Toast, useToast } from '@/ui/components';
import { CameraIcon, CheckIcon, CloseIcon, PlusIcon } from '@/ui/icons';
import { href } from '@/ui/router';
import { PageScan } from './scan/PageScan';
import {
  CandidateRow,
  CorrectionSheet,
  RecentStrip,
  containTransform,
  fileToCanvas,
  recognizerFor,
  recordScan,
  type Recent,
} from './scan/shared';

interface Still {
  url: string;
  w: number;
  h: number;
  results: ScanCandidate[];
  busy: boolean;
  error?: string;
  ms?: number;
  /** Text lines the OCR engine read (to tell "no text" from "no match"). */
  lineCount?: number;
}

const STILL_MAX_WIDTH = 1600;

export default function ScanPage() {
  const index = useCatalog();
  const collection = useCollection();
  const [settings, update] = useSettings();
  const mode = settings.scanMode;
  const [armed, setArmed] = useState(false);
  const [pagePhoto, setPagePhoto] = useState<File | null>(null);
  const [still, setStill] = useState<Still | null>(null);
  const [toast, showToast] = useToast();
  const [correcting, setCorrecting] = useState<ScanCandidate | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [justAdded, setJustAdded] = useState<Map<string, number>>(() => new Map());
  const viewRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 });

  // Built once per catalog; ~21k cards → a few tens of ms.
  const scanIndex: ScanIndex = useMemo(() => buildScanIndex(index.catalog), [index]);
  const recognizer = recognizerFor(settings);
  const pageMode = mode === 'page';

  const scanner = useCardScanner({ index: scanIndex, enabled: armed && !still && !pageMode, recognizer });
  const engineName = scanner.engine === 'mlkit' ? 'ML Kit' : scanner.engine === 'tesseract' ? 'Tesseract' : 'on-device OCR';

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setViewSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [armed, still, pageMode]);

  useEffect(() => () => {
    if (still) URL.revokeObjectURL(still.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still?.url]);

  const transform: CoverTransform = useMemo(
    () =>
      still
        ? containTransform(still.w, still.h, viewSize.w, viewSize.h)
        : coverTransform(scanner.frameSize.w, scanner.frameSize.h, viewSize.w, viewSize.h),
    [still, scanner.frameSize, viewSize],
  );

  const pushRecent = useCallback((card: CatalogCard, set: CatalogSet, qty: number) => {
    setRecent((r) => [{ card, set, qty, at: Date.now() }, ...r].slice(0, 12));
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
      showToast(`+1 ${card.name} · ${set.name} ${formatCardNumber(card, set)}`);
      if ('vibrate' in navigator) navigator.vibrate?.(30);
    },
    [scanner.engine, showToast, pushRecent],
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
      setStill({ url, w: 0, h: 0, results: [], busy: true });
      const started = performance.now();
      try {
        const canvas = await fileToCanvas(file, STILL_MAX_WIDTH);
        const lines = await (recognizer ?? getRecognizer()).recognize(canvas);
        const results = scanLines(lines, scanIndex);
        setStill({ url, w: canvas.width, h: canvas.height, results, busy: false, ms: performance.now() - started, lineCount: lines.length });
      } catch (e) {
        setStill((s) => (s && s.url === url ? { ...s, busy: false, error: e instanceof Error ? e.message : String(e) } : s));
      }
    },
    [recognizer, scanIndex],
  );

  const results: ScanCandidate[] = still ? still.results : scanner.results;

  const statusText = still
    ? still.busy
      ? 'Reading photo…'
      : still.error
        ? still.error
        : `${still.results.length} card${still.results.length === 1 ? '' : 's'} found${still.ms ? ` · ${(still.ms / 1000).toFixed(1)}s` : ''}`
    : scanner.status === 'error'
      ? scanner.error ?? 'Camera error'
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
            setPagePhoto(f);
            setArmed(true);
          } else void scanPhoto(f);
        }
        e.target.value = '';
      }}
    />
  );

  const correctingOptions: ScanAlternative[] = correcting
    ? [{ card: correcting.card, set: correcting.set, score: correcting.score, evidence: correcting.evidence }, ...correcting.alternatives]
    : [];

  if (pageMode && (armed || pagePhoto)) {
    return (
      <>
        <PageScan
          index={index}
          scanIndex={scanIndex}
          recognizer={recognizer ?? getRecognizer()}
          collection={collection}
          engineName={engineName}
          initialPhoto={pagePhoto}
          onAdded={(entries) => void addPage(entries)}
          onExit={() => {
            setArmed(false);
            setPagePhoto(null);
          }}
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
          <CameraIcon size={56} />
          {pageMode ? (
            <>
              <h2>Scan a binder page</h2>
              <p>
                Line a whole page up with the on-screen grid and capture it. CardCodex reads every pocket, then you confirm each card
                and how many copies are stacked in that sleeve before adding the page to your collection.
              </p>
            </>
          ) : (
            <>
              <h2>Scan your cards</h2>
              <p>
                Point the camera at one or more cards. CardCodex reads the name, HP and the printed number and shows a chip over each
                card it recognises. Tap a chip to add that card, or open the alternatives to correct it.
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
          <video ref={scanner.videoRef} className="scan-video" playsInline muted autoPlay />
        )}
        {!still && scanner.status === 'scanning' && scanner.results.length === 0 && <div className="scan-guide" />}
        <div className="scan-overlay">
          {results.map((r) => {
            const box = mapBox((r.cardBox ?? r.bbox) as Box, transform);
            const anchor = mapBox(r.bbox, transform);
            const added = justAdded.has(r.key);
            const owned = collection.get(r.card.id)?.qty ?? 0;
            const thumb = cardImageUrl(r.card, r.set.series, 'low');
            return (
              <div key={r.key}>
                <div className="scan-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
                <button
                  type="button"
                  className={`scan-chip${added ? ' added' : ''}`}
                  style={{ left: anchor.x + anchor.w / 2, top: Math.max(56, anchor.y - 6) }}
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
              </div>
            );
          })}
        </div>
        <div className="scan-hud">
          <span className="scan-status">
            <span className={`scan-dot${(!still && scanner.status === 'scanning' && !scanner.paused) || still?.busy ? ' live' : ''}`} />
            {statusText}
          </span>
          <span className="btn-row">
            {!still && scanner.status === 'scanning' && (
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
              onClick={() => (still ? setStill(null) : setArmed(false))}
            >
              <CloseIcon />
            </button>
          </span>
        </div>
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
            {results.map((r) => (
              <CandidateRow
                key={r.key}
                card={r.card}
                set={r.set}
                score={r.score}
                evidence={r.evidence}
                owned={collection.get(r.card.id)?.qty ?? 0}
                onAdd={() => void addCard(r.card, r.set, r.key)}
                onCorrect={() => setCorrecting(r)}
              />
            ))}
          </div>
        ) : still ? (
          !still.busy &&
          !still.error && (
            <div className="hint">
              {still.lineCount
                ? `Read ${still.lineCount} lines of text but none matched a card. `
                : 'No readable text found in this photo. '}
              Fill the frame with one card, keep it flat and well lit, and make sure the name and the number at the bottom-left are
              sharp.
            </div>
          )
        ) : (
          scanner.status === 'scanning' && (
            <div className="hint">
              Hold a card inside the frame. Good light and a flat angle help; the number at the bottom-left is the strongest clue.
            </div>
          )
        )}
        {recent.length > 0 && <RecentStrip recent={recent} />}
      </div>

      <CorrectionSheet
        open={correcting !== null}
        options={correctingOptions}
        index={index}
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
