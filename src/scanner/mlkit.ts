/**
 * Google ML Kit text recognition via @capacitor-mlkit/text-recognition
 * (Android/iOS only). Much faster than Tesseract on a phone.
 *
 * Verified from the plugin source (8.2.2): `processImage({ path })` only
 * accepts a file path/URI — Android calls
 * `InputImage.fromFilePath(context, Uri.parse(path))`, which reads through a
 * ContentResolver, so data: URLs / base64 are NOT accepted. Each frame is
 * therefore written as a JPEG into the app cache directory first, through the
 * Capacitor Filesystem plugin addressed by name (`registerPlugin('Filesystem')`,
 * so no JS dependency is needed here). That requires the native plugin:
 * `npm i @capacitor/filesystem && npx cap sync android`. Without it the write
 * rejects and getRecognizer() falls back to Tesseract.
 *
 * The plugin result has no confidence values; lines get ML_KIT_CONFIDENCE.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { ProcessImageResult, Rect, Point } from '@capacitor-mlkit/text-recognition';
import type { Box, RecognizedLine } from './types';
import type { RecognizerSource, TextRecognizer } from './recognizer';

/** ML Kit returns no per-line confidence; lines it reports are usually right. */
export const ML_KIT_CONFIDENCE = 0.9;

/** JPEG quality for frames handed to ML Kit (text stays crisp at 0.85; ~150 KB at 1280 px). */
const JPEG_QUALITY = 0.85;

/** Writes base64 JPEG data to a temp file and returns a URI ML Kit can open. */
export type TempJpegWriter = (base64: string) => Promise<string>;

/** Minimal local typing of @capacitor/filesystem's writeFile (documented API; plugin not installed here). */
interface FilesystemLike {
  writeFile(options: { path: string; data: string; directory: string; recursive?: boolean }): Promise<{ uri: string }>;
}

let fs: FilesystemLike | null = null;

/** Default writer: Capacitor Filesystem plugin, Directory.Cache ('CACHE'), one reused file. */
export const filesystemTempWriter: TempJpegWriter = async (base64) => {
  fs ??= registerPlugin<FilesystemLike>('Filesystem');
  const { uri } = await fs.writeFile({ path: 'cardcodex-scan/frame.jpg', data: base64, directory: 'CACHE', recursive: true });
  return uri;
};

/** True on a native platform where the ML Kit plugin is installed. */
export function isMlkitAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('TextRecognition');
}

function rectToBox(r: Rect): Box {
  return { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top };
}

function pointsToBox(ps: Point[]): Box {
  const xs = ps.map((p) => p.x);
  const ys = ps.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Map the plugin's blocks → lines to RecognizedLines (pixel space of the written JPEG). */
export function mapMlkitResult(res: ProcessImageResult): RecognizedLine[] {
  const out: RecognizedLine[] = [];
  for (const block of res.blocks ?? []) {
    for (const l of block.lines ?? []) {
      const text = l.text.replace(/\s+/g, ' ').trim();
      const bbox = l.boundingBox
        ? rectToBox(l.boundingBox)
        : l.cornerPoints && l.cornerPoints.length
          ? pointsToBox(l.cornerPoints)
          : null;
      if (!text || !bbox) continue;
      out.push({ text, bbox, confidence: ML_KIT_CONFIDENCE });
    }
  }
  return out;
}

async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

function canvasToBase64(c: HTMLCanvasElement): string {
  return c.toDataURL('image/jpeg', JPEG_QUALITY).split(',', 2)[1];
}

/** Recognizer backed by ML Kit. Throws if used where the plugin is unavailable. */
export class MlkitRecognizer implements TextRecognizer {
  readonly engine = 'mlkit' as const;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly writeTemp: TempJpegWriter = filesystemTempWriter) {}

  private async toPath(source: RecognizerSource): Promise<string> {
    if (typeof source === 'string') {
      if (!source.startsWith('data:')) return source; // already a file path / URI
      return this.writeTemp(source.split(',', 2)[1]);
    }
    if (source instanceof Blob) return this.writeTemp(await blobToBase64(source));
    if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
      return this.writeTemp(canvasToBase64(source));
    }
    // ImageBitmap
    const c = document.createElement('canvas');
    c.width = source.width;
    c.height = source.height;
    c.getContext('2d')?.drawImage(source, 0, 0);
    return this.writeTemp(canvasToBase64(c));
  }

  recognize(source: RecognizerSource): Promise<RecognizedLine[]> {
    const run = this.queue.then(async () => {
      if (!isMlkitAvailable()) throw new Error('ML Kit text recognition is not available on this platform');
      // Imported only here, on native, so the web bundle never executes it.
      const { TextRecognition } = await import('@capacitor-mlkit/text-recognition');
      const path = await this.toPath(source);
      return mapMlkitResult(await TextRecognition.processImage({ path }));
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async dispose(): Promise<void> {
    // The plugin closes its native recognizer after every call; nothing to free.
  }
}
