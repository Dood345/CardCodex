/**
 * Pieces shared by the single-card scanner and the binder-page scanner.
 */
import { useEffect, useMemo, useState } from 'react';
import type { CatalogIndex } from '@/data/catalog';
import { formatCardNumber } from '@/data/catalog';
import { adjustQty } from '@/data/collection';
import { db } from '@/data/db';
import { searchCards } from '@/data/search';
import { cardImageUrl, type CatalogCard, type CatalogSet } from '@/data/types';
import { getRecognizer, type CoverTransform, type ScanAlternative, type TextRecognizer } from '@/scanner';
import type { Settings } from '@/app/settings';
import { Sheet } from '@/ui/components';
import { PlusIcon } from '@/ui/icons';
import { href } from '@/ui/router';

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

/** Decode an image file into a canvas no wider than `maxWidth` (EXIF orientation applied). */
export async function fileToCanvas(file: File, maxWidth: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
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

export interface Recent {
  card: CatalogCard;
  set: CatalogSet;
  qty: number;
  at: number;
}

export function RecentStrip({ recent }: { recent: Recent[] }) {
  return (
    <div className="scan-recent" aria-label="Recently added">
      {recent.map((r) => (
        <a key={`${r.card.id}-${r.at}`} className="scan-recent-item" href={href(`/card/${r.card.id}`)}>
          <img src={cardImageUrl(r.card, r.set.series, 'low')} alt={r.card.name} loading="lazy" />
          <div>
            {r.qty > 1 ? `×${r.qty} ` : ''}
            {r.card.name}
          </div>
        </a>
      ))}
    </div>
  );
}

export function CandidateRow({
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

/**
 * "Which card is it?" sheet: the ranked guesses (best first) plus a manual
 * search for anything else. With no options it is a plain card picker.
 */
export function CorrectionSheet({
  open,
  options,
  index,
  title,
  onClose,
  onPick,
}: {
  open: boolean;
  options: ScanAlternative[];
  index: CatalogIndex;
  title?: string;
  onClose: () => void;
  onPick: (card: CatalogCard, set: CatalogSet) => void;
}) {
  const [query, setQuery] = useState('');
  useEffect(() => setQuery(''), [open]);
  const manual = useMemo(() => (query.trim() ? searchCards(index, query, {}, undefined, 20).cards : []), [index, query]);
  if (!open) return null;
  return (
    <Sheet open onClose={onClose} title={title ?? (options.length ? 'Which card is it?' : 'Pick a card')}>
      {options.length > 0 && (
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
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
