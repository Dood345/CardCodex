/**
 * Full-resolution stills from a running camera stream through the
 * ImageCapture API (Chrome, the Android WebView), for binder-page captures.
 *
 * Why: the preview stream is at most ~1920 px on its long side, and on a
 * 9-pocket page a card is a third of that: ~600 px cards and a ~13 px
 * collector-number line, the low end of what ML Kit reads (it needs roughly
 * 12–15 px of text height; measured on a Pixel 11 Pro XL and a Z Fold 8 the
 * names were read and the number line was not). takePhoto() goes through the
 * camera's still pipeline and returns the sensor's full JPEG size (4032×3024
 * on a 12 MP phone): ~1300 px cards and a ~28 px number line, the size at
 * which the camera-app photos in scripts/fixtures/binder-pages/ read well.
 *
 * Everything here returns null instead of throwing when the API is missing
 * (Firefox, Safari), rejects (some Android cameras refuse takePhoto while a
 * stream runs) or takes too long: the caller falls back to the preview frame.
 */
import type { Size } from './camera';

export interface PhotoResult {
  /** The photo, EXIF orientation applied, at most `maxLongSide` px on its long side. */
  bitmap: ImageBitmap;
  /** The JPEG as the camera delivered it (shareable as is, EXIF intact). */
  blob: Blob;
  /** takePhoto() plus decoding, ms. */
  ms: number;
  /** Size the photo was asked for (sensor orientation), when the capabilities were known. */
  requested: Size | null;
}

export interface TakePhotoOptions {
  /** Give up (and let the caller use the preview) after this long. Default 4000. */
  timeoutMs?: number;
  /** Decoded photos longer than this are downscaled: pockets are read at ≤ 1400 px, so a 50 MP photo only costs memory. Default 4608. */
  maxLongSide?: number;
  /** Photo size to ask for (sensor orientation); default: the largest the camera offers. */
  size?: Size | null;
}

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MAX_LONG_SIDE = 4608;

type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCapture;

/** An ImageCapture for the stream's video track, or null where the API or the track is missing. */
export function imageCaptureFor(stream: MediaStream | null | undefined): ImageCapture | null {
  const ctor = (globalThis as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
  const track = stream?.getVideoTracks()[0];
  if (!ctor || !track || track.readyState !== 'live') return null;
  try {
    return new ctor(track);
  } catch {
    return null;
  }
}

/**
 * The largest photo the camera offers (sensor orientation: width is the long
 * side on a phone), or null when photos are not available. Cheap (no capture);
 * the capture view uses it to predict the card size a capture will have.
 */
export async function probePhotoSize(stream: MediaStream | null | undefined, timeoutMs = 2000): Promise<Size | null> {
  const ic = imageCaptureFor(stream);
  if (!ic) return null;
  try {
    const caps = await withTimeout(ic.getPhotoCapabilities(), timeoutMs);
    const w = caps.imageWidth?.max ?? 0;
    const h = caps.imageHeight?.max ?? 0;
    return w > 0 && h > 0 ? { w, h } : null;
  } catch {
    return null;
  }
}

/**
 * Take a still at the largest size the camera offers and decode it with the
 * EXIF orientation applied. Null when ImageCapture is missing, the capture
 * rejects or exceeds `timeoutMs`; the caller then copies the preview frame.
 */
export async function takePhoto(stream: MediaStream | null | undefined, opts: TakePhotoOptions = {}): Promise<PhotoResult | null> {
  const ic = imageCaptureFor(stream);
  if (!ic) return null;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxLongSide = opts.maxLongSide ?? DEFAULT_MAX_LONG_SIDE;
  const started = performance.now();
  try {
    const requested = opts.size === undefined ? await probePhotoSize(stream, timeoutMs) : opts.size;
    const settings: PhotoSettings | undefined = requested ? { imageWidth: requested.w, imageHeight: requested.h } : undefined;
    const blob = await withTimeout(ic.takePhoto(settings), timeoutMs - (performance.now() - started));
    let bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const long = Math.max(bitmap.width, bitmap.height);
    if (long > maxLongSide) {
      const k = maxLongSide / long;
      const small = await createImageBitmap(bitmap, {
        resizeWidth: Math.round(bitmap.width * k),
        resizeHeight: Math.round(bitmap.height * k),
        resizeQuality: 'high',
      });
      bitmap.close();
      bitmap = small;
    }
    return { bitmap, blob, ms: performance.now() - started, requested };
  } catch (e) {
    console.warn('[scanner] takePhoto failed, using the preview frame:', e);
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (!(ms > 0)) return Promise.reject(new Error('takePhoto: no time left'));
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`takePhoto: no photo after ${Math.round(ms)} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}
