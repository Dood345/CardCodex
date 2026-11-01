import type { EngineName, RecognizedLine } from './types';

/** Image input accepted by every recognizer. A string is a URL, data URL, or (Node/native) file path. */
export type RecognizerSource = HTMLCanvasElement | ImageBitmap | Blob | string;

/** An on-device OCR engine. Implementations: tesseract.ts, mlkit.ts. */
export interface TextRecognizer {
  /**
   * Recognize text lines in `source`. Boxes are in the source's pixel space.
   * Callers must not run two recognitions concurrently on the same instance
   * (useCardScanner guarantees this; implementations also serialize).
   */
  recognize(source: RecognizerSource): Promise<RecognizedLine[]>;
  /** Release workers/native resources. The instance must not be used afterwards. */
  dispose(): Promise<void>;
  /** Which engine answered the most recent call (null before the first call). */
  readonly engine?: EngineName | null;
}
