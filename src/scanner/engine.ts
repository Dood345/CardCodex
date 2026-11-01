/**
 * Engine selection: the shared TextRecognizer used by useCardScanner.
 */
import type { EngineName, RecognizedLine } from './types';
import type { RecognizerSource, TextRecognizer } from './recognizer';
import type { TesseractOptions } from './tesseract';
import { MlkitRecognizer, isMlkitAvailable } from './mlkit';

/** Consecutive ML Kit failures before switching to Tesseract for the session. */
const MLKIT_MAX_ERRORS = 3;

/**
 * Engine selection with fallback: ML Kit on native (Android/iOS) when the
 * plugin is present; Tesseract.js otherwise, and permanently after the first
 * ML Kit failure (e.g. Filesystem plugin missing). Engines are loaded lazily
 * on the first recognize() call via dynamic import: tesseract.js only when
 * Tesseract is used, the ML Kit plugin JS only on native (see mlkit.ts).
 */
class AutoRecognizer implements TextRecognizer {
  engine: EngineName | null = null;
  private mlkit: TextRecognizer | null = null;
  private tesseract: TextRecognizer | null = null;
  private mlkitFailed = false;
  private mlkitErrors = 0;

  constructor(private readonly tesseractOptions: TesseractOptions = {}) {}

  private async getTesseract(): Promise<TextRecognizer> {
    if (!this.tesseract) {
      const { TesseractRecognizer } = await import('./tesseract');
      this.tesseract = new TesseractRecognizer(this.tesseractOptions);
    }
    return this.tesseract;
  }

  async recognize(source: RecognizerSource): Promise<RecognizedLine[]> {
    if (!this.mlkitFailed && isMlkitAvailable()) {
      try {
        this.mlkit ??= new MlkitRecognizer();
        const lines = await this.mlkit.recognize(source);
        this.mlkitErrors = 0;
        this.engine = 'mlkit';
        return lines;
      } catch (e) {
        // One bad frame (e.g. "canceled") shouldn't drop us onto the much
        // slower engine; a plugin that is missing fails every time.
        this.mlkitErrors++;
        if (this.mlkitErrors < MLKIT_MAX_ERRORS) throw e;
        console.warn('[scanner] ML Kit keeps failing, falling back to Tesseract:', e);
        this.mlkitFailed = true;
      }
    }
    const t = await this.getTesseract();
    const lines = await t.recognize(source);
    this.engine = 'tesseract';
    return lines;
  }

  async dispose(): Promise<void> {
    await Promise.all([this.mlkit?.dispose(), this.tesseract?.dispose()]);
    this.mlkit = null;
    this.tesseract = null;
    this.engine = null;
  }
}

let shared: AutoRecognizer | null = null;

/**
 * The app-wide recognizer (singleton: the Tesseract worker and its model are
 * expensive to create, so it survives component unmounts). `options` only
 * apply on the first call.
 */
export function getRecognizer(options?: TesseractOptions): TextRecognizer {
  shared ??= new AutoRecognizer(options);
  return shared;
}

/** Tear down the shared recognizer (e.g. when leaving the scanner for good). */
export async function disposeRecognizer(): Promise<void> {
  const r = shared;
  shared = null;
  await r?.dispose();
}
