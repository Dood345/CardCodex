/**
 * Tesseract.js (v7) implementation of TextRecognizer. Works in the browser
 * and in Node (scripts/scan-check.mjs).
 *
 * Asset resolution (verified in node_modules/tesseract.js 7.0.0):
 * - Defaults are ALL jsDelivr CDN: worker.min.js, tesseract.js-core and the
 *   eng.traineddata language model (@tesseract.js-data/eng/4.0.0_best_int).
 * - In the browser we instead bundle the worker script and the SIMD+LSTM core
 *   through Vite `?url` imports, so `vite build` emits them into dist/assets
 *   (no manual copying, works offline inside the Capacitor APK). Both are
 *   made absolute because tesseract.js spawns the worker from a Blob URL
 *   (`importScripts("<workerPath>")`), where a root-relative path can't resolve.
 * - corePath points at one specific file, which skips tesseract.js's own
 *   SIMD detection; every WebView/browser with WebAssembly SIMD (Chrome 91+,
 *   Safari 16.4+) runs it. Without SIMD we fall back to the CDN core directory.
 * - The language model (~2–4 MB) is NOT in node_modules, so it still comes from
 *   the CDN on first use and is cached in IndexedDB afterwards. Override with
 *   `langPath` (e.g. host eng.traineddata.gz under public/) for offline first run.
 *   Only the model is downloaded; images never leave the device.
 *
 * Page segmentation: PSM 11 (SPARSE_TEXT). Measured on 5 TCGdex scans:
 * - PSM 3/6 merged the collector number with neighbouring flavour text
 *   ("057/18 around prey, then drags...") — in a multi-card frame that would
 *   fuse text from adjacent cards into one line.
 * - PSM 12 (sparse + OSD) needs osd.traineddata (absent) and the legacy engine.
 * - PSM 11 returned the number line on its own in 3/5 cards and the name line
 *   in 4/5, at 0.6–2.7 s per 600×825 image in Node.
 */
import type Tesseract from 'tesseract.js';
import workerUrl from 'tesseract.js/dist/worker.min.js?url';
import coreSimdLstmUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url';
import type { RecognizedLine } from './types';
import type { RecognizerSource, TextRecognizer } from './recognizer';

/** PSM 11 — sparse text (see file header for the measurement). */
export const TESSERACT_PSM = '11';

/**
 * Lines below this confidence are dropped. Junk from artwork comes back at
 * 0–20%; the hardest real readings we need ("(JBI 190/195 %") were ~47%,
 * "47102 x" ~53%, but some correct name lines came back as low as ~36%.
 */
export const TESSERACT_MIN_CONFIDENCE = 0.1;

export interface TesseractOptions {
  /** Directory URL/path containing eng.traineddata(.gz). Default: jsDelivr CDN. */
  langPath?: string;
  /** Node only: where the downloaded model is cached. */
  cachePath?: string;
  /** Progress logger forwarded to tesseract.js. */
  logger?: (m: Tesseract.LoggerMessage) => void;
  /** Page segmentation mode. Default '11'. */
  psm?: string;
}

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

/** Same probe wasm-feature-detect uses for SIMD (i8x16 ops in a tiny module). */
function hasWasmSimd(): boolean {
  try {
    return WebAssembly.validate(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
    );
  } catch {
    return false;
  }
}

/** Map a tesseract.js Page (requested with `{ blocks: true }`) to RecognizedLines. */
export function mapTesseractPage(page: Pick<Tesseract.Page, 'blocks'>, minConfidence = TESSERACT_MIN_CONFIDENCE): RecognizedLine[] {
  const out: RecognizedLine[] = [];
  for (const block of page.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const l of para.lines) {
        const text = l.text.replace(/\s+/g, ' ').trim();
        const confidence = Math.max(0, Math.min(1, l.confidence / 100));
        if (!text || confidence < minConfidence) continue;
        out.push({
          text,
          confidence,
          bbox: { x: l.bbox.x0, y: l.bbox.y0, w: l.bbox.x1 - l.bbox.x0, h: l.bbox.y1 - l.bbox.y0 },
        });
      }
    }
  }
  return out;
}

/** tesseract.js has no ImageBitmap input; draw it onto a canvas first. */
function toImageLike(source: RecognizerSource): Tesseract.ImageLike {
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    const c = document.createElement('canvas');
    c.width = source.width;
    c.height = source.height;
    c.getContext('2d')?.drawImage(source, 0, 0);
    return c;
  }
  return source as Tesseract.ImageLike;
}

/** Lazily creates ONE English worker on first use and reuses it. */
export class TesseractRecognizer implements TextRecognizer {
  readonly engine = 'tesseract' as const;
  private worker: Promise<Tesseract.Worker> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: TesseractOptions = {}) {}

  private getWorker(): Promise<Tesseract.Worker> {
    this.worker ??= (async () => {
      // Dynamic import keeps tesseract.js out of the app's initial bundle.
      const mod = await import('tesseract.js');
      const T = ((mod as unknown as { default?: typeof Tesseract }).default ?? mod) as typeof Tesseract;
      const options: Partial<Tesseract.WorkerOptions> = {};
      if (isBrowser) {
        const abs = (u: string) => new URL(u, document.baseURI).href;
        options.workerPath = abs(workerUrl);
        if (hasWasmSimd()) options.corePath = abs(coreSimdLstmUrl);
      }
      if (this.opts.langPath) options.langPath = this.opts.langPath;
      if (this.opts.cachePath) options.cachePath = this.opts.cachePath;
      if (this.opts.logger) options.logger = this.opts.logger;
      const worker = await T.createWorker('eng', T.OEM.LSTM_ONLY, options);
      await worker.setParameters({
        tessedit_pageseg_mode: (this.opts.psm ?? TESSERACT_PSM) as Tesseract.PSM,
      });
      return worker;
    })();
    // Let a failed init be retried on the next call.
    this.worker.catch(() => {
      this.worker = null;
    });
    return this.worker;
  }

  /** Warm up (download model, spawn worker) before the first frame. */
  async init(): Promise<void> {
    await this.getWorker();
  }

  recognize(source: RecognizerSource): Promise<RecognizedLine[]> {
    // Serialize: one tesseract worker processes one job at a time anyway, and
    // queuing here keeps results in call order.
    const run = this.queue.then(async () => {
      const worker = await this.getWorker();
      const { data } = await worker.recognize(toImageLike(source), {}, { blocks: true, text: false });
      return mapTesseractPage(data);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async dispose(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    if (w) await (await w.catch(() => null))?.terminate();
  }
}
