/**
 * Browser camera helpers: start/stop the rear camera, grab downscaled frames,
 * and map frame-pixel boxes onto a `<video style="object-fit: cover">`.
 */
import type { Box } from './types';

/** Thrown by `startCamera` with a user-presentable message. */
export class CameraError extends Error {
  constructor(
    message: string,
    /** 'denied' | 'unsupported' | 'notfound' | 'busy' | 'other' */
    readonly code: 'denied' | 'unsupported' | 'notfound' | 'busy' | 'other',
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CameraError';
  }
}

export interface StartCameraOptions {
  /** Default { ideal: 'environment' } (rear camera on phones). */
  facingMode?: ConstrainDOMString;
  /** Default 1920×1080 (ideal); the browser picks the closest. */
  width?: number;
  height?: number;
}

/**
 * Open the camera and attach it to `video` (muted, inline, playing).
 * Rejects with a CameraError: 'unsupported' (no getUserMedia / insecure
 * context), 'denied' (permission), 'notfound' (no camera), 'busy' (in use).
 */
export async function startCamera(video: HTMLVideoElement, opts: StartCameraOptions = {}): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new CameraError(
      'Camera not supported in this browser (getUserMedia unavailable; the page must be served over HTTPS or localhost).',
      'unsupported',
    );
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: opts.facingMode ?? { ideal: 'environment' },
        width: { ideal: opts.width ?? 1920 },
        height: { ideal: opts.height ?? 1080 },
      },
    });
  } catch (e) {
    const name = (e as { name?: string } | null)?.name ?? '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new CameraError('Camera permission was denied. Allow camera access and try again.', 'denied', e);
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new CameraError('No camera was found on this device.', 'notfound', e);
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
      throw new CameraError('The camera is in use by another app.', 'busy', e);
    }
    throw new CameraError(`Could not start the camera: ${String((e as Error)?.message ?? e)}`, 'other', e);
  }
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.srcObject = stream;
  try {
    await video.play();
  } catch (e) {
    // play() can reject if the element is detached mid-start; the stream is
    // still valid, so the caller decides (useCardScanner stops it on unmount).
    if ((e as { name?: string })?.name !== 'AbortError') throw e;
  }
  return stream;
}

/** Stop every track of `stream` (turns the camera light off). Null-safe. */
export function stopCamera(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

let frameCanvas: HTMLCanvasElement | null = null;

/**
 * Draw the current video frame onto a reusable canvas, scaled down so its
 * width is at most `maxWidth` (aspect preserved). The canvas is shared across
 * calls: consume it (OCR) before grabbing the next frame.
 *
 * Why 1280: Tesseract recognition time grows ~linearly with pixels, and at
 * 1280 px wide a card filling a third of the frame still has ~12 px tall
 * collector-number text, the low end of what Tesseract reads.
 */
export function grabFrame(video: HTMLVideoElement, maxWidth = 1280): HTMLCanvasElement {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) throw new Error('grabFrame: video has no frame yet');
  const scale = Math.min(1, maxWidth / vw);
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);
  frameCanvas ??= document.createElement('canvas');
  if (frameCanvas.width !== w) frameCanvas.width = w;
  if (frameCanvas.height !== h) frameCanvas.height = h;
  const ctx = frameCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('grabFrame: 2D canvas unavailable');
  ctx.drawImage(video, 0, 0, w, h);
  return frameCanvas;
}

/** Mapping from source-frame pixels to element (CSS) pixels. */
export interface CoverTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Transform for `object-fit: cover`: the frame is scaled uniformly to cover
 * the element and centred, so the overflowing dimension is cropped equally on
 * both sides. elemX = frameX * scale + offsetX (offsets are ≤ 0 when cropped).
 * Pass the FRAME size (useCardScanner's `frameSize`), not the video's
 * intrinsic size — the aspect ratio is the same, the scale is not.
 */
export function coverTransform(videoW: number, videoH: number, elemW: number, elemH: number): CoverTransform {
  if (videoW <= 0 || videoH <= 0) return { scale: 1, offsetX: 0, offsetY: 0 };
  const scale = Math.max(elemW / videoW, elemH / videoH);
  return {
    scale,
    offsetX: (elemW - videoW * scale) / 2,
    offsetY: (elemH - videoH * scale) / 2,
  };
}

/** Apply a CoverTransform to a frame-pixel box → element CSS pixels. */
export function mapBox(b: Box, t: CoverTransform): Box {
  return { x: b.x * t.scale + t.offsetX, y: b.y * t.scale + t.offsetY, w: b.w * t.scale, h: b.h * t.scale };
}
