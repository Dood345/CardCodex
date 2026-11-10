/**
 * Single-card "snap" mode: the camera with a card-shaped guide and a shutter.
 * One tap takes a full-resolution photo (the camera's still pipeline, as in
 * binder-page mode; a copy of the preview when the camera gives none), and
 * the page hands the card framed by the guide to the still reader, whose
 * match list is the way to add the card. Nothing is read live here: the
 * choice is made from one sharp photo, like a binder page.
 *
 * The photo arrives a moment after the press, and a hand moves in that time.
 * So the preview is frozen and copied at the press, a busy sign shows until
 * the photo is in, and the photo is checked against the copy
 * (src/scanner/photo-align.ts): the guide follows the card when the view
 * shifted, and the copy is used when the photo lost the card or never came.
 */
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import {
  coverTransform,
  grabFrame,
  mapBox,
  previewToPhoto,
  startCamera,
  stopCamera,
  visibleRegion,
  type Box,
  type Size,
} from '@/scanner';
import { sampleRgba } from '@/scanner/grid';
import { lumaImage, windowOf } from '@/scanner/hash';
import { probePhotoSize, takePhoto } from '@/scanner/photo';
import { findGuide, judgePhoto, searchRegion } from '@/scanner/photo-align';
import { CameraIcon, CloseIcon } from '@/ui/icons';
import { BLANK_POSTER, CameraPlaceholder } from './shared';

type IconComponent = ComponentType<{ size?: number; className?: string }>;

/** 4:3 like page mode: more pixels on the card than a 16:9 stream. */
const SNAP_CAMERA = { facingMode: 'environment' as const, width: 2560, height: 1920 };
const PHOTO_TIMEOUT_MS = 4000;
const PHOTO_MAX_LONG_SIDE = 4608;
const PREVIEW_MAX_WIDTH = 4096;
/** The guide fills this share of the visible height (less when the width binds). */
const GUIDE_SHARE = 0.8;
const GUIDE_MAX_WIDTH_SHARE = 0.9;

/** What a snap hands back: the frame, its size and where the guide was on it (frame px). */
export interface SnapCapture {
  source: ImageBitmap | HTMLCanvasElement;
  w: number;
  h: number;
  guide: Box;
  /** True when the frame is a camera photo rather than a copy of the preview. */
  photo: boolean;
  ms: number;
}

/** The card guide: a card-shaped box centred in `visible` (frame px). */
export function cardGuide(visible: Box, cardAspect: number): Box {
  let h = visible.h * GUIDE_SHARE;
  let w = h * cardAspect;
  if (w > visible.w * GUIDE_MAX_WIDTH_SHARE) {
    w = visible.w * GUIDE_MAX_WIDTH_SHARE;
    h = w / cardAspect;
  }
  return { x: visible.x + (visible.w - w) / 2, y: visible.y + (visible.h - h) / 2, w, h };
}

/**
 * Crop `guide` plus `pad` of its size on each side out of `source` (clamped to
 * it), scaled so the crop is at most `maxWidth` wide and, when the photo is
 * small, at least `minWidth` (OCR wants ~1,200 px on a card). Returns the
 * canvas and the guide in its pixels.
 */
export function cropToGuide(
  source: CanvasImageSource,
  guide: Box,
  pad: number,
  maxWidth: number,
  minWidth: number,
  size?: Size,
): { canvas: HTMLCanvasElement; guide: Box } {
  const sw = size?.w ?? (source as { width: number }).width;
  const sh = size?.h ?? (source as { height: number }).height;
  const x0 = Math.max(0, guide.x - guide.w * pad);
  const y0 = Math.max(0, guide.y - guide.h * pad);
  const x1 = Math.min(sw, guide.x + guide.w * (1 + pad));
  const y1 = Math.min(sh, guide.y + guide.h * (1 + pad));
  const rw = Math.max(1, x1 - x0);
  const rh = Math.max(1, y1 - y0);
  const scale = Math.max(minWidth / rw, Math.min(1, maxWidth / rw));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rw * scale));
  canvas.height = Math.max(1, Math.round(rh * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, x0, y0, rw, rh, 0, 0, canvas.width, canvas.height);
  return { canvas, guide: { x: (guide.x - x0) * scale, y: (guide.y - y0) * scale, w: guide.w * scale, h: guide.h * scale } };
}

const sameOrientation = (a: Size, b: Size): boolean => a.w === a.h || b.w === b.h || a.w > a.h === b.w > b.h;

/** Sample widths for comparing the photo with the frame copied at the press: the guide, and the photo region around it. */
const ALIGN_GUIDE_WIDTH = 160;
const ALIGN_SEARCH_WIDTH = 280;

/**
 * Where the card framed at the press is in the photo: the guide as it was
 * (`pressed`, with its guide) is looked for around `expected`, where the
 * guide should be in `photo`. Returns the guide to read the photo with, or
 * null when the photo does not show the framed card whole.
 */
function guideInPhoto(pressed: HTMLCanvasElement, pressedGuide: Box, photo: ImageBitmap, expected: Box): Box | null {
  try {
    const template = sampleRgba(pressed, pressedGuide, ALIGN_GUIDE_WIDTH, 2);
    const region = searchRegion(expected, { w: photo.width, h: photo.height });
    const search = sampleRgba(photo, region, ALIGN_SEARCH_WIDTH, 3);
    const shift = findGuide(lumaImage(template.data, template.width, template.height), lumaImage(search.data, search.width, search.height), windowOf(expected, region));
    const verdict = judgePhoto(shift, expected, { w: photo.width, h: photo.height });
    return verdict.use === 'preview' ? null : verdict.guide;
  } catch (e) {
    // A comparison that cannot run must not cost the user the photo.
    console.warn('[scanner] photo alignment failed, using the photo as taken:', e);
    return expected;
  }
}

export function SnapScan({
  cardAspect,
  Icon,
  onCaptured,
  onFile,
  onExit,
  overlay,
  children,
}: {
  cardAspect: number;
  Icon?: IconComponent;
  onCaptured: (capture: SnapCapture) => void;
  /** "Photo": pick one from the gallery instead. */
  onFile: () => void;
  onExit: () => void;
  /** Drawn over the camera view (the last-added bar). */
  overlay?: ReactNode;
  /** Extra rows under the camera (the mode toggle, the session bar). */
  children?: ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 });
  const [photoSize, setPhotoSize] = useState<Size | null>(null);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    setError(null);
    setLive(false);
    setPhotoSize(null);
    startCamera(video, SNAP_CAMERA)
      .then((stream) => {
        if (cancelled) {
          stopCamera(stream);
          return;
        }
        streamRef.current = stream;
        return probePhotoSize(stream).then((size) => {
          if (!cancelled) setPhotoSize(size);
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    const onMeta = () => setVideoSize({ w: video.videoWidth, h: video.videoHeight });
    const onPlaying = () => {
      onMeta();
      setLive(true);
    };
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('playing', onPlaying);
    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('playing', onPlaying);
      stopCamera(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setViewSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const transform = useMemo(() => coverTransform(videoSize.w, videoSize.h, viewSize.w, viewSize.h), [videoSize, viewSize]);
  const visible = useMemo(
    () => (videoSize.w && viewSize.w ? visibleRegion(videoSize.w, videoSize.h, transform, viewSize.w, viewSize.h) : null),
    [videoSize, viewSize, transform],
  );
  const guide = useMemo(() => (visible ? cardGuide(visible, cardAspect) : null), [visible, cardAspect]);
  const guideEl = guide ? mapBox(guide, transform) : null;

  async function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !guide || capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    const t0 = performance.now();
    const preview: Size = { w: video.videoWidth, h: video.videoHeight };
    // What the user framed, copied the instant the shutter is pressed: the photo comes later, and by
    // then the hand may have moved. The picture on screen stops too, so the press visibly took.
    const shared = grabFrame(video, PREVIEW_MAX_WIDTH);
    const pressed = document.createElement('canvas');
    pressed.width = shared.width;
    pressed.height = shared.height;
    pressed.getContext('2d')!.drawImage(shared, 0, 0);
    const k = pressed.width / preview.w;
    const pressedGuide: Box = { x: guide.x * k, y: guide.y * k, w: guide.w * k, h: guide.h * k };
    video.pause();
    let handedOff = false;
    try {
      const photoWorthIt = !photoSize || Math.max(photoSize.w, photoSize.h) > Math.max(preview.w, preview.h);
      const shot = photoWorthIt ? await takePhoto(streamRef.current, { timeoutMs: PHOTO_TIMEOUT_MS, maxLongSide: PHOTO_MAX_LONG_SIDE, size: photoSize }) : null;
      const photo = shot ? { w: shot.bitmap.width, h: shot.bitmap.height } : null;
      const usable = !!shot && !!photo && Math.max(photo.w, photo.h) > Math.max(preview.w, preview.h) && sameOrientation(photo, preview);
      if (shot && photo && usable) {
        const found = guideInPhoto(pressed, pressedGuide, shot.bitmap, mapBox(guide, previewToPhoto(preview, photo)));
        if (found) {
          handedOff = true;
          onCaptured({ source: shot.bitmap, w: photo.w, h: photo.h, guide: found, photo: true, ms: performance.now() - t0 });
          return;
        }
      }
      // No photo, a photo too small to be worth it, or one that lost the card: the frame from the press.
      shot?.bitmap.close();
      handedOff = true;
      onCaptured({ source: pressed, w: pressed.width, h: pressed.height, guide: pressedGuide, photo: false, ms: performance.now() - t0 });
    } finally {
      capturingRef.current = false;
      setCapturing(false);
      // Still here (the capture threw): let the preview run again.
      if (!handedOff) void video.play().catch(() => undefined);
    }
  }

  return (
    <div className="scan-page">
      <div className="scan-view" ref={viewRef}>
        <video ref={videoRef} className={`scan-video${live ? '' : ' hidden'}`} poster={BLANK_POSTER} playsInline muted autoPlay />
        {!live && <CameraPlaceholder Icon={Icon} text={error ?? 'Starting camera…'} live={!error} />}
        {guideEl && live && <div className="snap-guide" style={{ left: guideEl.x, top: guideEl.y, width: guideEl.w, height: guideEl.h }} />}
        {capturing && (
          <div className="scan-busy" role="status">
            <div className="spinner-ring" />
            <div>Taking the photo…</div>
          </div>
        )}
        <div className="scan-hud">
          <span className="scan-status">
            <span className={`scan-dot${live ? ' live' : ''}`} />
            {error ? error : capturing ? 'Taking the photo…' : 'Snap a card'}
          </span>
          <span className="btn-row">
            <button type="button" className="btn ghost" style={{ color: '#fff' }} onClick={onFile}>
              Photo
            </button>
            <button type="button" className="icon-btn" style={{ color: '#fff' }} aria-label="Stop scanning" onClick={onExit}>
              <CloseIcon />
            </button>
          </span>
        </div>
        {overlay}
      </div>
      <div className="scan-bottom">
        {children}
        <div className="hint">
          {error ? (
            <>
              {error}. You can still{' '}
              <button type="button" className="link-btn" onClick={onFile}>
                scan a photo
              </button>
              .
            </>
          ) : (
            'Fill the frame with one card and tap the shutter. You pick the match from the list, like a binder page.'
          )}
        </div>
        <div className="shutter-row">
          <button type="button" className="shutter" aria-label="Take the photo" disabled={!live || capturing || !!error} onClick={() => void capture()}>
            <CameraIcon size={26} />
          </button>
        </div>
      </div>
    </div>
  );
}
