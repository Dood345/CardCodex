/**
 * Pieces shared by the single-card scanner and the binder-page scanner.
 */
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import type { CatalogIndex } from '@/data/catalog';
import { formatCardNumber } from '@/data/catalog';
import { adjustQty } from '@/data/collection';
import { db } from '@/data/db';
import { searchCards } from '@/data/search';
import { cardImageUrl, type CatalogCard, type CatalogSet } from '@/data/types';
import { getRecognizer, type CoverTransform, type ScanAlternative, type TextRecognizer } from '@/scanner';
import type { Settings } from '@/app/settings';
import type { IconProps } from '@/games/types';
import { Sheet } from '@/ui/components';
import { PlusIcon } from '@/ui/icons';


/**
 * The English OCR model ships with the app (public/tessdata/eng.traineddata.gz,
 * ~3 MB) so the first scan works offline instead of downloading it from a CDN.
 * getRecognizer() keeps the options from its first call, so pin them here,
 * before useCardScanner asks for the shared recognizer.
 */
export const TESSERACT_OPTIONS = { langPath: `${import.meta.env.BASE_URL.replace(/\/$/, '')}/tessdata` };
getRecognizer(TESSERACT_OPTIONS);

/** Tesseract-only recognizer honouring the "Tesseract only" setting (lazy, shared). */
let tesseractOnly: TextRecognizer | null = null;
export function getTesseractOnly(): TextRecognizer {
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

/** The recognizer the Settings page asked for (undefined = the auto-selecting shared one). */
export function recognizerFor(settings: Settings): TextRecognizer | undefined {
  return settings.scanEngine === 'tesseract' ? getTesseractOnly() : undefined;
}

/** `object-fit: contain` counterpart of coverTransform (for still photos). */
export function containTransform(w: number, h: number, ew: number, eh: number): CoverTransform {
  if (w <= 0 || h <= 0) return { scale: 1, offsetX: 0, offsetY: 0 };
  const scale = Math.min(ew / w, eh / h);
  return { scale, offsetX: (ew - w * scale) / 2, offsetY: (eh - h * scale) / 2 };
}

/**
 * Decode an image file into a canvas no wider than `maxWidth` (EXIF
 * orientation applied). Images narrower than `minWidth` are upscaled to
 * `maxWidth`: on an 813 px card render Tesseract garbled "ATK/2500 DEF/2100"
 * and missed the type line; at 1600 px it read both (measured, Yu-Gi-Oh!).
 */
export async function fileToCanvas(file: File, maxWidth: number, minWidth = 0): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = bitmap.width < minWidth ? maxWidth / bitmap.width : Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

/** Decode an image file at full resolution (EXIF orientation applied). Close it when done. */
export function fileToBitmap(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

/** Add `qty` copies to the collection and log the scan. */
export async function recordScan(card: CatalogCard, qty: number, engine: string): Promise<void> {
  if (qty <= 0) return;
  await adjustQty(card.id, qty);
  await db.scanLog.add({ cardId: card.id, at: Date.now(), engine });
}

/**
 * Illustration for the scanner when no camera image is showing: a card
 * outline inside viewfinder corners, with the game's icon where the art would
 * be. `live` adds a sweeping scan line (camera starting).
 */
export function ScanArt({ Icon, live, size = 150 }: { Icon?: ComponentType<IconProps>; live?: boolean; size?: number }) {
  const w = size;
  const h = Math.round(size * 1.1);
  return (
    <svg className={`scan-art${live ? ' live' : ''}`} width={w} height={h} viewBox="0 0 150 165" aria-hidden="true">
      <g className="art-corners" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
        <path d="M6 30 V12 a6 6 0 0 1 6 -6 H30" />
        <path d="M144 30 V12 a6 6 0 0 0 -6 -6 H120" />
        <path d="M6 135 V153 a6 6 0 0 0 6 6 H30" />
        <path d="M144 135 V153 a6 6 0 0 1 -6 6 H120" />
      </g>
      <rect className="art-card" x="36" y="22" width="78" height="109" rx="6" />
      <rect className="art-art" x="43" y="37" width="64" height="44" rx="2" />
      <rect className="art-line" x="43" y="30" width="38" height="3" rx="1.5" />
      <rect className="art-line" x="43" y="90" width="52" height="3" rx="1.5" />
      <rect className="art-line" x="43" y="99" width="44" height="3" rx="1.5" />
      <rect className="art-line" x="43" y="108" width="56" height="3" rx="1.5" />
      <rect className="art-line num" x="43" y="121" width="20" height="3" rx="1.5" />
      {Icon && (
        <foreignObject x="59" y="43" width="32" height="32">
          <div className="art-icon">
            <Icon size={32} />
          </div>
        </foreignObject>
      )}
      {live && <rect className="art-beam" x="12" y="20" width="126" height="2" rx="1" />}
    </svg>
  );
}

/** Covers the camera view while there is no live image (starting, error, stopped). */
export function CameraPlaceholder({ Icon, text, live }: { Icon?: ComponentType<IconProps>; text: string; live?: boolean }) {
  return (
    <div className="scan-placeholder">
      <ScanArt Icon={Icon} live={live} size={120} />
      <div>{text}</div>
    </div>
  );
}

/** Transparent poster: Android's WebView otherwise paints a play button on a <video> that has no frame yet. */
export const BLANK_POSTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function CandidateRow({
  card,
  set,
  score,
  scoreLabel,
  evidence,
  owned,
  onAdd,
  onCorrect,
}: {
  card: CatalogCard;
  set: CatalogSet;
  score: number;
  /** Word after the percentage ("steady" for the live pool share). */
  scoreLabel?: string;
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
          {Math.round(score * 100)}%{scoreLabel ? ` ${scoreLabel}` : ''} · {evidence.join(', ') || 'tap to choose'}
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

/**
 * "Which card is it?" sheet: the ranked guesses (best first) plus a manual
 * search for anything else. With no options it is a plain card picker.
 */
export function CorrectionSheet({
  open,
  options,
  index,
  title,
  thumb,
  current,
  clearLabel,
  onClear,
  onClose,
  onPick,
}: {
  open: boolean;
  options: ScanAlternative[];
  index: CatalogIndex;
  title?: string;
  /** The scanned crop, shown beside the guesses so they can be compared. */
  thumb?: string;
  /** Id of the card currently chosen (highlighted). */
  current?: string;
  /** Adds a "clear" action (e.g. mark a pocket empty). */
  clearLabel?: string;
  onClear?: () => void;
  onClose: () => void;
  onPick: (card: CatalogCard, set: CatalogSet) => void;
}) {
  const [query, setQuery] = useState('');
  useEffect(() => setQuery(''), [open]);
  const manual = useMemo(() => (query.trim() ? searchCards(index, query, {}, undefined, 20).cards : []), [index, query]);
  if (!open) return null;
  const option = (o: ScanAlternative, i: number) => (
    <button
      key={o.card.id}
      type="button"
      className={`scan-candidate${o.card.id === current ? ' current' : ''}`}
      onClick={() => onPick(o.card, o.set)}
    >
      <img src={cardImageUrl(o.card, o.set.series, 'low')} alt="" />
      <div className="cand-body">
        <div className="cand-name">{o.card.name}</div>
        <div className="cand-sub">
          {o.set.name} · {formatCardNumber(o.card, o.set)}
        </div>
        {o.evidence.length > 0 && <div className="cand-sub">{o.evidence.join(', ')}</div>}
      </div>
      <span className="cand-score">{i === 0 && o.card.id === current ? 'current' : `${Math.round(o.score * 100)}%`}</span>
    </button>
  );
  return (
    <Sheet open onClose={onClose} title={title ?? (options.length ? 'Which card is it?' : 'Pick a card')}>
      {(thumb || options.length > 0) && (
        <div className={`correction-body${thumb ? ' with-thumb' : ''}`}>
          {thumb && <img className="correction-thumb" src={thumb} alt="Scanned pocket" />}
          {options.length > 0 && <div className="scan-candidates">{options.map(option)}</div>}
        </div>
      )}
      <input
        className="search-input"
        type="search"
        placeholder={options.length ? 'Not listed? Search any card…' : 'Search by name, set code or number…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
        autoFocus={options.length === 0}
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
        {onClear && clearLabel && (
          <button type="button" className="btn ghost" onClick={onClear}>
            {clearLabel}
          </button>
        )}
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
