/**
 * Camera scanner: live preview, one tappable chip per detected card, tap to
 * add, "alternatives" sheet to correct a wrong guess, manual search fallback.
 * A "scan a photo" mode runs the same pipeline on a still image (camera app
 * or gallery) for devices where live video is unavailable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCatalog } from '@/app/context';
import { useSettings } from '@/app/settings';
import { adjustQty, useCollection } from '@/data/collection';
import { db } from '@/data/db';
import { formatCardNumber } from '@/data/catalog';
import { searchCards } from '@/data/search';
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
  type TextRecognizer,
} from '@/scanner';
import { Sheet, Toast, useToast } from '@/ui/components';
import { CameraIcon, CheckIcon, CloseIcon, PlusIcon } from '@/ui/icons';
import { href } from '@/ui/router';

/**
 * The English OCR model ships with the app (public/tessdata/eng.traineddata.gz,
 * ~3 MB) so the first scan works offline instead of downloading it from a CDN.
 * getRecognizer() keeps the options from its first call, so pin them here,
 * before useCardScanner asks for the shared recognizer.
 */
const TESSERACT_OPTIONS = { langPath: `${import.meta.env.BASE_URL.replace(/\/$/, '')}/tessdata` };
getRecognizer(TESSERACT_OPTIONS);

/** Tesseract-only recognizer honouring the "Tesseract only" setting (lazy, shared). */
let tesseractOnly: TextRecognizer | null = null;
function getTesseractOnly(): TextRecognizer {
  if (!tesseractOnly) {
    let inner: TextRecognizer | null = null;
    tesseractOnly = {
      async recognize(source) {
        if (!inner) {
          const { TesseractRecognizer } = await import('@/scanner/tesseract');
          inner = new TesseractRecognizer(TESSERACT_OPTIONS);
        }
        return inner.recognize(source);
      },
      async dispose() {
        await inner?.dispose();
        inner = null;
      },
    };
  }
  return tesseractOnly;
}

/** `object-fit: contain` counterpart of coverTransform (for still photos). */
function containTransform(w: number, h: number, ew: number, eh: number): CoverTransform {
  if (w <= 0 || h <= 0) return { scale: 1, offsetX: 0, offsetY: 0 };
  const scale = Math.min(ew / w, eh / h);
  return { scale, offsetX: (ew - w * scale) / 2, offsetY: (eh - h * scale) / 2 };
}

interface Recent {
  card: CatalogCard;
  set: CatalogSet;
  at: number;
}

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
  const [settings] = useSettings();
  const [armed, setArmed] = useState(false);
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
  const recognizer = settings.scanEngine === 'tesseract' ? getTesseractOnly() : undefined;

  const scanner = useCardScanner({ index: scanIndex, enabled: armed && !still, recognizer });

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setViewSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [armed, still]);

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

  const addCard = useCallback(
    async (card: CatalogCard, set: CatalogSet, trackKey?: string) => {
      await adjustQty(card.id, 1);
      await db.scanLog.add({ cardId: card.id, at: Date.now(), engine: scanner.engine ?? 'manual' });
      setRecent((r) => [{ card, set, at: Date.now() }, ...r].slice(0, 12));
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
    [scanner.engine, showToast],
  );

  /** Run the recognizer + matcher on a still image (camera app or gallery). */
  const scanPhoto = useCallback(
    async (file: File) => {
      const url = URL.createObjectURL(file);
      setStill({ url, w: 0, h: 0, results: [], busy: true });
      const started = performance.now();
      try {
        // createImageBitmap applies EXIF orientation, so phone photos come out upright.
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, STILL_MAX_WIDTH / bitmap.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
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
            ? `Scanning · ${scanner.engine === 'mlkit' ? 'ML Kit' : 'Tesseract'}`
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
        if (f) void scanPhoto(f);
        e.target.value = '';
      }}
    />
  );

  if (!armed && !still) {
    return (
      <div className="scan-page">
        <div className="scan-intro">
          <CameraIcon size={56} />
          <h2>Scan your cards</h2>
          <p>
            Point the camera at one or more cards. CardCodex reads the name, HP and the printed number and shows a chip over
            each card it recognises. Tap a chip to add that card, or open the alternatives to correct it.
          </p>
          <p>Everything runs on this device; no images are uploaded.</p>
          <div className="btn-row" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn primary" onClick={() => setArmed(true)}>
              <CameraIcon size={18} /> Start camera
            </button>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
              Scan a photo
            </button>
          </div>
          {recent.length > 0 && <RecentStrip recent={recent} />}
        </div>
        {fileInput}
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
            {scanner.error}. Try <button type="button" className="link-btn" onClick={() => fileRef.current?.click()}>scanning a photo</button>{' '}
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
        candidate={correcting}
        index={index}
        onClose={() => setCorrecting(null)}
        onPick={(card, set) => {
          setCorrecting(null);
          void addCard(card, set, correcting?.key);
        }}
      />
      <Toast message={toast} />
      {fileInput}
    </div>
  );
}

function RecentStrip({ recent }: { recent: Recent[] }) {
  return (
    <div className="scan-recent" aria-label="Recently added">
      {recent.map((r) => (
        <a key={`${r.card.id}-${r.at}`} className="scan-recent-item" href={href(`/card/${r.card.id}`)}>
          <img src={cardImageUrl(r.card, r.set.series, 'low')} alt={r.card.name} loading="lazy" />
          <div>{r.card.name}</div>
        </a>
      ))}
    </div>
  );
}

function CandidateRow({
  card,
  set,
  score,
  evidence,
  owned,
  onAdd,
  onCorrect,
}: {
  card: CatalogCard;
  set: CatalogSet;
  score: number;
  evidence: string[];
  owned: number;
  onAdd: () => void;
  onCorrect: () => void;
}) {
  return (
    <div className="scan-candidate">
      <img src={cardImageUrl(card, set.series, 'low')} alt="" />
      <div className="cand-body" onClick={onCorrect} role="button" tabIndex={0}>
        <div className="cand-name">{card.name}</div>
        <div className="cand-sub">
          {set.name} · {formatCardNumber(card, set)}
          {owned ? ` · own ${owned}` : ''}
        </div>
        <div className="cand-sub">
          {Math.round(score * 100)}% · {evidence.join(', ') || 'tap to choose'}
        </div>
      </div>
      <button type="button" className="btn ghost" onClick={onCorrect} aria-label="Choose a different card">
        ▾
      </button>
      <button type="button" className="btn primary" onClick={onAdd} aria-label={`Add ${card.name}`}>
        <PlusIcon size={16} />
      </button>
    </div>
  );
}

function CorrectionSheet({
  candidate,
  index,
  onClose,
  onPick,
}: {
  candidate: ScanCandidate | null;
  index: ReturnType<typeof useCatalog>;
  onClose: () => void;
  onPick: (card: CatalogCard, set: CatalogSet) => void;
}) {
  const [query, setQuery] = useState('');
  useEffect(() => setQuery(''), [candidate]);
  const manual = useMemo(() => (query.trim() ? searchCards(index, query, {}, undefined, 20).cards : []), [index, query]);
  if (!candidate) return null;
  const options: ScanAlternative[] = [
    { card: candidate.card, set: candidate.set, score: candidate.score, evidence: candidate.evidence },
    ...candidate.alternatives,
  ];
  return (
    <Sheet open onClose={onClose} title="Which card is it?">
      <div className="scan-candidates">
        {options.map((o) => (
          <button key={o.card.id} type="button" className="scan-candidate" onClick={() => onPick(o.card, o.set)}>
            <img src={cardImageUrl(o.card, o.set.series, 'low')} alt="" />
            <div className="cand-body">
              <div className="cand-name">{o.card.name}</div>
              <div className="cand-sub">
                {o.set.name} · {formatCardNumber(o.card, o.set)}
              </div>
            </div>
            <span className="cand-score">{Math.round(o.score * 100)}%</span>
          </button>
        ))}
      </div>
      <input
        className="search-input"
        type="search"
        placeholder="Not listed? Search any card…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />
      {manual.length > 0 && (
        <div className="scan-candidates">
          {manual.map((c) => {
            const set = index.setsById.get(c.set);
            if (!set) return null;
            return (
              <button key={c.id} type="button" className="scan-candidate" onClick={() => onPick(c, set)}>
                <img src={cardImageUrl(c, set.series, 'low')} alt="" />
                <div className="cand-body">
                  <div className="cand-name">{c.name}</div>
                  <div className="cand-sub">
                    {set.name} · {formatCardNumber(c, set)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      <div className="sheet-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
