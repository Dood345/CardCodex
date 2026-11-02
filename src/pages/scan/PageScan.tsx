/**
 * Binder-page mode: photograph one page of a binder, OCR every pocket, then
 * confirm each pocket's card and how many copies sit stacked in that sleeve
 * before adding the whole page to the collection.
 *
 * The page guide is fitted to the cards (src/scanner/grid.ts) while the
 * camera runs; the user can also drag or resize it. A capture whose grid was
 * not yet locked is shown as a still with the guide for a check before it is
 * read. All state lives in the scan session (./session.ts), so leaving the
 * tab and coming back resumes where you were.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogIndex } from '@/data/catalog';
import { formatCardNumber } from '@/data/catalog';
import type { CollectionMap } from '@/data/collection';
import { cardImageUrl, type CatalogCard, type CatalogSet } from '@/data/types';
import { useGame } from '@/app/context';
import { isNative } from '@/app/platform';
import { useSettings } from '@/app/settings';
import {
  coverTransform,
  grabFrame,
  mapBox,
  orientLike,
  previewToPhoto,
  startCamera,
  stopCamera,
  unmapBox,
  visibleRegion,
  type Box,
  type CoverTransform,
  type ScanAlternative,
  type ScanMatcher,
  type Size,
  type TextRecognizer,
} from '@/scanner';
import { AUTO_IDLE, autoReady, autoStep, searchRegion, type AutoState } from '@/scanner/autocapture';
import { GRID_SAMPLE_WIDTH, fitGrid, fitGridOnSource, sampleBoxToRegion, sampleRgba } from '@/scanner/grid';
import { adviseCapture, measureGuidance, type CaptureAdvice, type GuidanceMetrics } from '@/scanner/guidance';
import {
  PAGE_LAYOUTS,
  boxToFrac,
  fracToBox,
  pageLayout,
  pageRect,
  scanPage,
  type FracBox,
  type PageLayoutId,
  type PageSource,
  type PocketEntry,
} from '@/scanner/page';
import { probePhotoSize, takePhoto } from '@/scanner/photo';
import { saveFile, savedMessage } from '@/app/saveFile';
import { useBackHandler } from '@/ui/back';
import { Chip } from '@/ui/components';
import { CameraIcon, CloseIcon, MinusIcon, PlusIcon } from '@/ui/icons';
import { PageGuide, type GuideState } from './PageGuide';
import {
  EMPTY_PAGE,
  clearReview,
  disposeStill,
  getScanSession,
  loadReview,
  patchPageSession,
  patchScanSession,
  saveReview,
  useScanSession,
  type CaptureInfo,
  type PageStill,
  type PocketState,
} from './session';
import { BLANK_POSTER, CameraPlaceholder, containTransform, CorrectionSheet, fileToBitmap } from './shared';

/** Preview-frame captures (the fallback when the camera gives no photo) are taken at the stream's full resolution (≤ this). */
const CAPTURE_MAX_WIDTH = 4096;
/** Page mode asks for a 4:3 stream: more of the page in the frame, and more pixels per pocket, than 16:9. */
const PAGE_CAMERA = { facingMode: 'environment' as const, width: 2560, height: 1920 };
/** Live grid fits per second (each ~10–15 ms on a 320 px sample, plus ~15 ms of guidance when the grid is found). */
const FIT_INTERVAL_MS = 300;
/** Consecutive fits within LOCK_TOLERANCE (fractions of the view) before the guide reads "Page found". */
const LOCK_FITS = 2;
const LOCK_TOLERANCE = 0.03;
/** No auto-capture this soon after the camera comes up: the user is still aiming. */
const AUTO_ARM_DELAY_MS = 700;
/** Missed fits before a locked guide goes back to searching. */
const UNLOCK_MISSES = 4;
/** Consecutive fits that must agree on a piece of advice before it is shown (a single soft frame is not "hold still"). */
const ADVICE_FITS = 2;
/** Still photos get a finer sample than the live loop. */
const STILL_SAMPLE_WIDTH = 400;
/** Gap between the two preview frames of a fallback capture (long enough for a different focus/exposure sample, short enough to hold still). */
const EXTRA_FRAME_DELAY_MS = 180;
/** A photo that takes longer than this is abandoned for the preview frame. */
const PHOTO_TIMEOUT_MS = 4000;
/** The whole capture (both frames) should stay under this: a second photo is only taken when the first leaves room for it. */
const CAPTURE_BUDGET_MS = 1500;
/** Photos are decoded no longer than this on their long side (pockets are read at ≤ 1400 px; a 50 MP photo only costs memory and time). */
const PHOTO_MAX_LONG_SIDE = 4608;

/** Show a page photo (or any still) in page mode with the guide on it. */
export async function openPagePhoto(file: File): Promise<void> {
  const bitmap = await fileToBitmap(file);
  const prev = getScanSession().page;
  disposeStill(prev?.still);
  patchPageSession({
    phase: 'capture',
    still: {
      source: bitmap,
      url: URL.createObjectURL(file),
      w: bitmap.width,
      h: bitmap.height,
      blob: file,
      capture: { source: 'file', preview: null, ms: 0, photoMs: [], frames: 1, extraFrom: null, guidance: null, advice: null, trigger: 'file', gridFit: null },
    },
    frac: null,
    auto: true,
  });
}

/** The preview frame drawn where it sits in a `w × h` photo (see previewToPhoto), so pocket boxes in photo px apply to it too. */
function previewInPhotoSpace(video: HTMLVideoElement, w: number, h: number, t: CoverTransform): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, t.offsetX, t.offsetY, video.videoWidth * t.scale, video.videoHeight * t.scale);
  return canvas;
}

const sameOrientation = (a: Size, b: Size): boolean => a.w === a.h || b.w === b.h || a.w > a.h === b.w > b.h;

/** Grid fit plus the capture guidance measured on it. */
interface FitState {
  confidence: number;
  locked: boolean;
  metrics: GuidanceMetrics | null;
  /** Advice confirmed over ADVICE_FITS fits (null: the shot should read). */
  advice: CaptureAdvice | null;
  /** The fit has held steady with no advice pending: the shutter may fire by itself (autocapture.ts). */
  ready: boolean;
}

/** Tooltip for the review header's size readout: how the frame was captured. */
function captureTitle(frame: PageStill): string {
  const c = frame.capture;
  if (!c) return 'Size of the captured frame';
  const how =
    c.source === 'photo'
      ? `photo from the camera's still pipeline (${c.photoMs.map((m) => Math.round(m)).join(' + ')} ms)`
      : c.source === 'preview'
        ? 'copy of the preview frame'
        : 'photo from the gallery';
  const prev = c.preview ? `, preview ${c.preview.w}×${c.preview.h}` : '';
  const extra = c.frames > 1 ? `, second frame from the ${c.extraFrom}` : '';
  const by = c.trigger === 'auto' ? ', auto-captured' : c.trigger === 'tap' ? ', captured by tap' : '';
  const grid = c.gridFit !== null ? `, grid fitted on the frame (${Math.round(c.gridFit * 100)}%)` : c.source === 'file' ? '' : ', grid from the live guide';
  return `Size of the captured frame: ${how}${prev}${extra}${by}${grid}`;
}

function canvasUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/jpeg', 0.9)), 'image/jpeg', 0.92);
  });
}

const lerp = (a: FracBox, b: FracBox, t: number): FracBox => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  w: a.w + (b.w - a.w) * t,
  h: a.h + (b.h - a.h) * t,
});
const near = (a: FracBox, b: FracBox, tol: number): boolean =>
  Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol && Math.abs(a.w - b.w) < tol && Math.abs(a.h - b.h) < tol;

export function PageScan({
  index,
  matcher,
  recognizer,
  collection,
  engineName,
  onAdded,
  onExit,
}: {
  index: CatalogIndex;
  matcher: ScanMatcher;
  recognizer: TextRecognizer;
  collection: CollectionMap;
  engineName: string;
  onAdded: (entries: PocketEntry[]) => void;
  onExit: () => void;
}) {
  const [settings, update] = useSettings();
  const { cardMm, Icon } = useGame();
  const layout = pageLayout(settings.pageLayout);
  // ML Kit (Android) reads a pocket in ~0.3 s, so two frames are cheap; Tesseract is not.
  const frames = isNative() ? 2 : 1;
  const [notice, setNotice] = useState<string | null>(null);
  const session = useScanSession();
  const page = session.page ?? EMPTY_PAGE;
  const { phase, still, frac, auto, pockets, pageMs, frame, frameFrac } = page;
  const [scanning, setScanning] = useState(false);
  const [restoring, setRestoring] = useState(session.page === null);
  const [error, setError] = useState<string | null>(null);
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });
  const [live, setLive] = useState(false);
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 });
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [correcting, setCorrecting] = useState<number | null>(null);
  const [fit, setFit] = useState<FitState | null>(null);
  /** Largest photo the camera offers (sensor orientation), null until probed or when photos are unavailable. */
  const [photoSize, setPhotoSize] = useState<Size | null>(null);
  const [capturing, setCapturing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fitRef = useRef<{ last: FracBox | null; stable: number; misses: number; adviceKind: string | null; adviceFits: number; auto: AutoState }>({
    last: null,
    stable: 0,
    misses: 0,
    adviceKind: null,
    adviceFits: 0,
    auto: AUTO_IDLE,
  });
  const resetFit = () => {
    fitRef.current = { last: null, stable: 0, misses: 0, adviceKind: null, adviceFits: 0, auto: AUTO_IDLE };
  };
  /** Synchronous guard for capture(): a tap and the auto-capture must not both fire. */
  const capturingRef = useRef(false);
  /** Latest capture() for the auto-capture timer (the function closes over the current render). */
  const captureRef = useRef<(trigger: 'tap' | 'auto') => Promise<void>>(async () => undefined);
  /** When the preview last came up, for AUTO_ARM_DELAY_MS. */
  const liveSinceRef = useRef(0);
  const cameraWanted = phase === 'capture' && !still && !scanning && !restoring;

  // Android back: a still being checked goes back to the camera; the camera or a review leaves page mode (a review stays resumable).
  useBackHandler(true, () => {
    const p = getScanSession().page;
    if (p?.phase === 'capture' && p.still) retake();
    else exit();
  });

  // A review interrupted by the app being killed: restore it.
  useEffect(() => {
    if (!restoring) return;
    let cancelled = false;
    loadReview(index, index.game)
      .then((r) => {
        if (cancelled) return;
        if (r && r.pockets.length) {
          if (r.layout !== settings.pageLayout) update({ pageLayout: r.layout });
          patchPageSession({ phase: 'review', pockets: r.pockets, pageMs: r.pageMs, frame: null, frameFrac: null, still: null });
        }
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Camera for the capture phase (own stream: no continuous OCR in page mode).
  useEffect(() => {
    if (!cameraWanted) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    setError(null);
    setLive(false);
    setPhotoSize(null);
    startCamera(video, PAGE_CAMERA)
      .then((stream) => {
        if (cancelled) {
          stopCamera(stream);
          return;
        }
        streamRef.current = stream;
        // What a capture will be: the camera's largest photo, or the preview itself.
        return probePhotoSize(stream).then((size) => {
          if (cancelled) return;
          setPhotoSize(size);
          console.info(`[page] camera ${video.videoWidth}×${video.videoHeight}, photo ${size ? `${size.w}×${size.h}` : 'unavailable (preview frames)'}`);
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
      setLive(false);
    };
  }, [cameraWanted]);

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setViewSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [phase, still, scanning]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // A different layout: start the guide over (the remembered frame is per layout).
  const layoutRef = useRef(layout.id);
  useEffect(() => {
    if (layoutRef.current === layout.id) return;
    layoutRef.current = layout.id;
    resetFit();
    setFit(null);
    patchPageSession({ frac: null, auto: true });
  }, [layout.id]);

  /* ---------- geometry ---------- */

  const frameSize = still ? { w: still.w, h: still.h } : videoSize;
  const transform = useMemo(
    () =>
      still
        ? containTransform(frameSize.w, frameSize.h, viewSize.w, viewSize.h)
        : coverTransform(frameSize.w, frameSize.h, viewSize.w, viewSize.h),
    [still, frameSize.w, frameSize.h, viewSize.w, viewSize.h],
  );
  /** Part of the source that is on screen (source px). */
  const visible = useMemo(
    () => (frameSize.w && viewSize.w ? visibleRegion(frameSize.w, frameSize.h, transform, viewSize.w, viewSize.h) : null),
    [frameSize.w, frameSize.h, transform, viewSize.w, viewSize.h],
  );
  const remembered = !still ? settings.pageFrames[layout.id] : undefined;
  const effectiveFrac = frac ?? remembered ?? null;
  /** Guide rectangle in source px. */
  const pageBox: Box | null = useMemo(() => {
    if (!visible) return null;
    return effectiveFrac
      ? fracToBox(effectiveFrac, visible)
      : pageRect(frameSize.w, frameSize.h, layout, { cardMm, within: visible });
  }, [visible, effectiveFrac, frameSize.w, frameSize.h, layout, cardMm]);
  const guideBox = pageBox ? mapBox(pageBox, transform) : null;

  const onGuideChange = useCallback(
    (box: Box) => {
      if (!visible) return;
      patchPageSession({ frac: boxToFrac(unmapBox(box, transform), visible), auto: false });
      setFit(null);
    },
    [visible, transform],
  );

  /* ---------- grid fitting ---------- */

  /** Photo px per preview px of a capture: the photo's long side over the preview's (1 when captures are preview frames). */
  const captureScale = useMemo(
    () => (photoSize && frameSize.w && frameSize.h ? previewToPhoto(frameSize, orientLike(photoSize, frameSize)).scale : 1),
    [photoSize, frameSize],
  );

  useEffect(() => {
    if (phase !== 'capture' || !auto || scanning || !visible) return;
    const source: CanvasImageSource | null = still ? still.source : live ? videoRef.current : null;
    if (!source) return;
    const cardAspect = cardMm.w / cardMm.h;
    const scale = still ? 1 : captureScale;
    let stopped = false;
    const run = () => {
      if (stopped) return;
      const img = sampleRgba(source, visible, still ? STILL_SAMPLE_WIDTH : GRID_SAMPLE_WIDTH);
      const raw = fitGrid(img, layout, { cardAspect });
      const st = fitRef.current;
      if (raw) {
        const box = sampleBoxToRegion(raw.box, img, visible);
        const nf = boxToFrac(box, visible);
        const metrics = measureGuidance(source, img, raw, visible, layout, { cardAspect, captureScale: scale, live: !still });
        const advice = adviseCapture(metrics, !still);
        if (still) {
          patchPageSession({ frac: nf });
          setFit({ confidence: raw.confidence, locked: true, metrics, advice, ready: false });
          return;
        }
        st.auto = autoStep(st.auto, { confidence: raw.confidence, frac: nf });
        st.stable = st.last && near(nf, st.last, LOCK_TOLERANCE) ? st.stable + 1 : 1;
        st.misses = 0;
        st.last = st.last ? lerp(st.last, nf, 0.5) : nf;
        // Advice has to hold for ADVICE_FITS fits before it shows (what is showing stays meanwhile); "all good" shows at once.
        const kind = advice?.kind ?? null;
        st.adviceFits = kind === st.adviceKind ? st.adviceFits + 1 : 1;
        st.adviceKind = kind;
        const confirmed = kind === null ? null : st.adviceFits >= ADVICE_FITS ? advice : undefined;
        patchPageSession({ frac: st.last });
        setFit((p) => {
          const adv = confirmed === undefined ? (p?.advice ?? null) : confirmed;
          return { confidence: raw.confidence, locked: st.stable >= LOCK_FITS, metrics, advice: adv, ready: autoReady(st.auto, adv === null) };
        });
      } else if (still) {
        setFit(null);
      } else {
        // One missed fit ends an auto-capture run; the lock survives a few.
        st.auto = AUTO_IDLE;
        if (++st.misses >= UNLOCK_MISSES) {
          st.stable = 0;
          st.adviceKind = null;
          st.adviceFits = 0;
          setFit((p) => (p && (p.locked || p.advice || p.ready) ? { ...p, locked: false, advice: null, ready: false } : p));
        } else {
          setFit((p) => (p?.ready ? { ...p, ready: false } : p));
        }
      }
    };
    if (still) {
      run();
      return () => {
        stopped = true;
      };
    }
    const id = window.setInterval(run, FIT_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [phase, auto, scanning, still, live, visible, layout, cardMm, captureScale]);

  /* ---------- auto-capture ---------- */

  useEffect(() => {
    if (live) liveSinceRef.current = performance.now();
  }, [live]);
  // The fit has held steady with nothing to fix: press the shutter, unless the preview only just came up.
  const autoFire = settings.autoCapture && phase === 'capture' && !still && live && auto && !scanning && !capturing && !!fit?.ready;
  useEffect(() => {
    if (!autoFire) return;
    const wait = Math.max(0, AUTO_ARM_DELAY_MS - (performance.now() - liveSinceRef.current));
    const id = window.setTimeout(() => void captureRef.current('auto'), wait);
    return () => window.clearTimeout(id);
  }, [autoFire]);

  /* ---------- scanning ---------- */

  const runScan = useCallback(
    async (src: PageStill, box: Box, extraFrames: PageSource[] = [], stillFit: FitState | null = null) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setScanning(true);
      setError(null);
      setProgress({ done: 0, total: layout.cols * layout.rows });
      const started = performance.now();
      try {
        const results = await scanPage(src.source, layout, recognizer, matcher, {
          signal: ac.signal,
          geometry: { page: box, cardMm },
          extraFrames,
          onProgress: (done, total) => setProgress({ done, total }),
        });
        if (ac.signal.aborted) return;
        const next: PocketState[] = results.map((scan) => ({
          scan,
          card: scan.candidate?.card,
          set: scan.candidate?.set,
          qty: scan.candidate ? 1 : 0,
        }));
        const ms = performance.now() - started;
        const current = getScanSession().page;
        if (current?.frame && current.frame !== src) disposeStill(current.frame);
        // A still that was measured on screen (a photo, or a capture checked with the guide) records that measurement.
        const capture: CaptureInfo | undefined =
          src.capture && stillFit && !src.capture.guidance
            ? { ...src.capture, frames: 1 + extraFrames.length, guidance: stillFit.metrics, advice: stillFit.advice?.kind ?? null }
            : src.capture;
        patchPageSession({
          phase: 'review',
          pockets: next,
          pageMs: ms,
          frame: capture ? { ...src, capture } : src,
          frameFrac: boxToFrac(box, { x: 0, y: 0, w: src.w, h: src.h }),
          still: null,
        });
        void saveReview(index.game, layout.id, next, ms);
      } catch (e) {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!ac.signal.aborted) setScanning(false);
        for (const f of extraFrames) (f as { close?: () => void }).close?.();
      }
    },
    [layout, recognizer, matcher, index.game, cardMm],
  );

  /**
   * Hand the scanned frame (and what was read from it) to the share sheet, or
   * download it on the web: a page that scanned badly on a phone can then be
   * dropped into scripts/fixtures/binder-pages/ and reproduced on a desk.
   */
  async function saveCapture() {
    if (!frame) return;
    let blob: Blob | null = frame.blob ?? null;
    if (!blob) {
      const canvas = document.createElement('canvas');
      canvas.width = frame.w;
      canvas.height = frame.h;
      canvas.getContext('2d')!.drawImage(frame.source, 0, 0);
      blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    }
    if (!blob) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const image = new File([blob], `cardcodex-page-${stamp}.jpg`, { type: 'image/jpeg' });
    const report = new File(
      [
        JSON.stringify(
          {
            app: __APP_VERSION__,
            game: index.game,
            layout: layout.id,
            engine: engineName,
            frame: { w: frame.w, h: frame.h },
            capture: frame.capture ?? null,
            page: frameFrac,
            pageMs: Math.round(pageMs),
            pockets: pockets.map((p) => ({
              index: p.scan.pocket.index,
              read: p.scan.candidate?.card.id ?? null,
              score: p.scan.candidate?.score ?? 0,
              confident: p.scan.candidate?.confident ?? false,
              chosen: p.card?.id ?? null,
              lines: p.scan.lineCount,
              cardBox: p.scan.cardBox,
              frames: p.scan.frames,
            })),
          },
          null,
          2,
        ),
      ],
      `cardcodex-page-${stamp}.json`,
      { type: 'application/json' },
    );
    // Android: the public Downloads folder (src/app/saveFile.ts); browser: two downloads.
    try {
      const saved = await saveFile(image, image.name);
      await saveFile(report, report.name);
      setNotice(`${savedMessage(saved, image.name)} and its report.`);
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return;
      setNotice(`Could not save the capture: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Copy of the current video frame (grabFrame reuses one canvas; the scan must own its pixels). */
  function snapFrame(video: HTMLVideoElement): HTMLCanvasElement {
    const shared = grabFrame(video, CAPTURE_MAX_WIDTH);
    const canvas = document.createElement('canvas');
    canvas.width = shared.width;
    canvas.height = shared.height;
    canvas.getContext('2d')!.drawImage(shared, 0, 0);
    return canvas;
  }

  /**
   * Capture the page: a full-resolution photo through the camera's still
   * pipeline (src/scanner/photo.ts) when the camera gives one, else a copy of
   * the preview frame. With the grid locked the page is read at once, from
   * this frame and (on Android) a second one; otherwise the frame is shown
   * with the guide for a check first.
   */
  async function capture(trigger: 'tap' | 'auto' = 'tap') {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !visible || !pageBox || capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    const t0 = performance.now();
    const preview: Size = { w: video.videoWidth, h: video.videoHeight };
    const wasLocked = !!fit?.locked;
    const wantExtra = frames > 1;
    // Remember where the page was, for the next scan from the same spot.
    update({ pageFrames: { ...settings.pageFrames, [layout.id]: boxToFrac(pageBox, visible) } });
    const photoMs: number[] = [];
    const extra: PageSource[] = [];
    let extraFrom: CaptureInfo['extraFrom'] = null;
    let captured: PageStill;
    let box: Box;
    try {
      // A photo is only worth the shutter (~2 s on the emulator) when the camera offers more pixels than the preview.
      const photoWorthIt = !photoSize || Math.max(photoSize.w, photoSize.h) > Math.max(preview.w, preview.h);
      const shot = photoWorthIt ? await takePhoto(streamRef.current, { timeoutMs: PHOTO_TIMEOUT_MS, maxLongSide: PHOTO_MAX_LONG_SIDE, size: photoSize }) : null;
      const photo = shot ? { w: shot.bitmap.width, h: shot.bitmap.height } : null;
      // A photo is worth using when it is bigger than the preview and the same way up (the mapping assumes both show the same field of view).
      const usable = !!shot && !!photo && Math.max(photo.w, photo.h) > Math.max(preview.w, preview.h) && sameOrientation(photo, preview);
      if (shot && photo && usable) {
        photoMs.push(shot.ms);
        const t = previewToPhoto(preview, photo);
        box = mapBox(pageBox, t);
        if (wantExtra) {
          // Second frame: another photo when the first was quick enough to keep the capture within budget, else the preview frame placed in photo space.
          if (performance.now() - t0 + shot.ms < CAPTURE_BUDGET_MS) {
            const second = await takePhoto(streamRef.current, { timeoutMs: PHOTO_TIMEOUT_MS, maxLongSide: PHOTO_MAX_LONG_SIDE, size: shot.requested });
            if (second && second.bitmap.width === photo.w && second.bitmap.height === photo.h) {
              extra.push(second.bitmap);
              photoMs.push(second.ms);
              extraFrom = 'photo';
            } else second?.bitmap.close();
          }
          if (!extra.length && video.videoWidth) {
            extra.push(previewInPhotoSpace(video, photo.w, photo.h, t));
            extraFrom = 'preview';
          }
        }
        captured = { source: shot.bitmap, blob: shot.blob, url: URL.createObjectURL(shot.blob), w: photo.w, h: photo.h };
      } else {
        shot?.bitmap.close();
        const canvas = snapFrame(video);
        const k = canvas.width / video.videoWidth;
        box = { x: pageBox.x * k, y: pageBox.y * k, w: pageBox.w * k, h: pageBox.h * k };
        if (wantExtra) {
          // A second frame a moment later: pockets are read from both and the
          // candidates merged, so one blurred frame cannot decide a pocket.
          await new Promise((r) => window.setTimeout(r, EXTRA_FRAME_DELAY_MS));
          if (video.videoWidth) {
            extra.push(snapFrame(video));
            extraFrom = 'preview';
          }
        }
        captured = { source: canvas, url: await canvasUrl(canvas), w: canvas.width, h: canvas.height };
      }
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }
    // The grid is fitted on the captured frame itself: the live guide says
    // where the page was a moment ago, the frame says where it is now, so a
    // hand that drifted between the last fit and the shutter costs nothing.
    const t1 = performance.now();
    const photoFit = fitGridOnSource(captured.source, searchRegion(box, captured.w, captured.h), layout, {
      cardAspect: cardMm.w / cardMm.h,
      sampleWidth: STILL_SAMPLE_WIDTH,
    });
    const fitMs = performance.now() - t1;
    if (photoFit) box = photoFit.box;
    captured.capture = {
      source: captured.blob ? 'photo' : 'preview',
      preview,
      ms: performance.now() - t0,
      photoMs,
      frames: 1 + extra.length,
      extraFrom,
      guidance: fit?.metrics ?? null,
      advice: fit?.advice?.kind ?? null,
      trigger,
      gridFit: photoFit?.confidence ?? null,
    };
    const c = captured.capture;
    console.info(
      `[page] ${trigger} capture ${c.source} ${captured.w}×${captured.h} from preview ${preview.w}×${preview.h} in ${Math.round(c.ms)} ms` +
        ` (photos ${photoMs.map((m) => Math.round(m)).join('/') || '-'} ms, extra frame: ${extraFrom ?? 'none'},` +
        ` grid on the frame: ${photoFit ? `${Math.round(photoFit.confidence * 100)}% in ${Math.round(fitMs)} ms` : 'not found'})`,
    );
    // Read at once when the frame itself shows the grid, when the live guide
    // was locked on it, or when the user placed the guide by hand; otherwise
    // show the frame with the guide for a check.
    if (photoFit || wasLocked || !auto) {
      void runScan(captured, box, extra);
    } else {
      for (const f of extra) (f as { close?: () => void }).close?.();
      resetFit();
      patchPageSession({ still: captured, frac: boxToFrac(box, { x: 0, y: 0, w: captured.w, h: captured.h }), auto: true });
      setFit(null);
    }
  }
  captureRef.current = capture;

  function scanStill() {
    if (!still || !pageBox) return;
    void runScan(still, pageBox, [], fit);
  }

  function retake() {
    resetFit();
    setFit(null);
    if (still && still === frame) {
      // Adjusting the grid of a scanned frame: back to its review.
      patchPageSession({ phase: 'review', still: null, auto: true });
      return;
    }
    disposeStill(still);
    patchPageSession({ still: null, frac: null, auto: true });
  }

  function snapToPage() {
    resetFit();
    setFit(null);
    patchPageSession({ auto: true });
  }

  function exit() {
    abortRef.current?.abort();
    disposeStill(still);
    if (frame && frame !== still) disposeStill(frame);
    patchScanSession({ page: null, armed: false });
    onExit();
  }

  function backToCapture(discard: boolean) {
    if (frame) disposeStill(frame);
    if (discard) void clearReview();
    patchPageSession({ phase: 'capture', pockets: [], frame: null, frameFrac: null, still: null, frac: null, auto: true });
    resetFit();
    setFit(null);
  }

  function adjustGrid() {
    if (!frame) return;
    setFit(null);
    patchPageSession({ phase: 'capture', still: frame, frac: frameFrac, auto: false });
  }

  /* ---------- review ---------- */

  const setPockets = (fn: (ps: PocketState[]) => PocketState[]) => {
    const next = fn(getScanSession().page?.pockets ?? []);
    patchPageSession({ pockets: next });
  };
  const setQty = (i: number, qty: number) => setPockets((ps) => ps.map((p, j) => (j === i ? { ...p, qty: Math.max(0, qty) } : p)));
  const setCard = (i: number, card: CatalogCard, set: CatalogSet) =>
    setPockets((ps) => ps.map((p, j) => (j === i ? { ...p, card, set, qty: p.qty || 1 } : p)));
  const clearCard = (i: number) => setPockets((ps) => ps.map((p, j) => (j === i ? { ...p, card: undefined, set: undefined, qty: 0 } : p)));

  // Keep the IndexedDB snapshot in step with corrections (debounced).
  useEffect(() => {
    if (phase !== 'review' || pockets.length === 0) return;
    const t = window.setTimeout(() => void saveReview(index.game, layout.id, pockets, pageMs), 400);
    return () => window.clearTimeout(t);
  }, [phase, pockets, pageMs, index.game, layout.id]);

  const entries: PocketEntry[] = pockets
    .filter((p): p is PocketState & { card: CatalogCard; set: CatalogSet } => !!p.card && !!p.set && p.qty > 0)
    .map((p) => ({ card: p.card, set: p.set, qty: p.qty }));
  const totalCards = entries.reduce((n, e) => n + e.qty, 0);

  function addPage() {
    onAdded(entries);
    backToCapture(true);
  }

  const correctingPocket = correcting !== null ? pockets[correcting] : undefined;
  const correctingOptions: ScanAlternative[] = useMemo(() => {
    const p = correctingPocket;
    if (!p) return [];
    const best = p.scan.candidate;
    const list: ScanAlternative[] = best
      ? [{ card: best.card, set: best.set, score: best.score, evidence: best.evidence }, ...p.scan.alternatives]
      : [...p.scan.alternatives];
    // The pocket's current pick first, even when it came from a manual search.
    if (p.card && p.set && !list.some((o) => o.card.id === p.card!.id)) list.unshift({ card: p.card, set: p.set, score: 1, evidence: [] });
    return list;
  }, [correctingPocket]);

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      hidden
      data-testid="page-photo-input"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) openPagePhoto(f).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
        e.target.value = '';
      }}
    />
  );

  if (phase === 'review') {
    return (
      <div className="scan-page page-review">
        <div className="scan-hud static">
          <span className="scan-status">
            {entries.length} of {pockets.length} pockets
            {frame && (
              <>
                {' · '}
                <span className="capture-size" title={captureTitle(frame)}>
                  {frame.w}×{frame.h}
                </span>
              </>
            )}
            {pageMs ? ` · ${(pageMs / 1000).toFixed(1)} s` : ''}
          </span>
          <button type="button" className="icon-btn" aria-label="Discard this page" onClick={() => backToCapture(true)}>
            <CloseIcon />
          </button>
        </div>
        <div className="pocket-grid" style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)` }}>
          {pockets.map((p, i) => (
            <div key={i} className={`pocket${p.card ? '' : ' pocket-empty'}`}>
              <button type="button" className="pocket-thumb" onClick={() => setCorrecting(i)} aria-label={`Pocket ${i + 1}: change card`}>
                <img src={p.scan.thumb} alt="" />
                {p.card && p.set && <img className="pocket-match" src={cardImageUrl(p.card, p.set.series, 'low')} alt="" />}
                {p.card && p.scan.candidate && p.scan.candidate.card.id === p.card.id && !p.scan.candidate.confident && (
                  <span className="pocket-unsure" title="Low confidence: check this one">?</span>
                )}
              </button>
              <div className="pocket-body">
                {p.card && p.set ? (
                  <>
                    <div className="pocket-name" title={p.card.name}>
                      {p.card.name}
                    </div>
                    <div className="pocket-sub">
                      {p.set.abbr || p.set.name} {formatCardNumber(p.card, p.set)}
                      {collection.get(p.card.id)?.qty ? ` · own ${collection.get(p.card.id)!.qty}` : ''}
                    </div>
                  </>
                ) : (
                  <div className="pocket-sub">{p.scan.lineCount ? 'No match' : 'Empty'}</div>
                )}
                <div className="pocket-actions">
                  <div className="stepper stepper-sm" aria-label="Copies in this pocket">
                    <button type="button" className="stepper-btn" aria-label="Fewer copies" disabled={p.qty <= 0} onClick={() => setQty(i, p.qty - 1)}>
                      <MinusIcon size={14} />
                    </button>
                    <span className="stepper-value">{p.qty}</span>
                    <button type="button" className="stepper-btn" aria-label="More copies" disabled={!p.card} onClick={() => setQty(i, p.qty + 1)}>
                      <PlusIcon size={14} />
                    </button>
                  </div>
                  <button type="button" className="btn ghost small" onClick={() => setCorrecting(i)}>
                    {p.card ? 'Change' : 'Set card'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="scan-bottom review-actions">
          <p className="hint">{notice ?? 'Tap a pocket to correct its card; bump the count where several copies share one sleeve.'}</p>
          <div className="btn-row">
            <button type="button" className="btn primary" disabled={totalCards === 0} onClick={addPage}>
              Add {totalCards} {totalCards === 1 ? 'card' : 'cards'} to collection
            </button>
            {frame && (
              <button type="button" className="btn ghost" onClick={adjustGrid}>
                Adjust grid
              </button>
            )}
            <button type="button" className="btn ghost" onClick={() => backToCapture(false)}>
              Rescan
            </button>
            {frame && (
              <button type="button" className="btn ghost small" title="Share or download this frame and what was read from it" onClick={() => void saveCapture()}>
                Save capture
              </button>
            )}
          </div>
        </div>
        <CorrectionSheet
          open={correcting !== null}
          options={correctingOptions}
          index={index}
          title={correcting !== null ? `Pocket ${correcting + 1}` : undefined}
          thumb={correctingPocket?.scan.thumb}
          current={correctingPocket?.card?.id}
          clearLabel={correctingPocket?.card ? 'Mark empty' : undefined}
          onClear={() => {
            if (correcting !== null) clearCard(correcting);
            setCorrecting(null);
          }}
          onClose={() => setCorrecting(null)}
          onPick={(card, set) => {
            if (correcting !== null) setCard(correcting, card, set);
            setCorrecting(null);
          }}
        />
      </div>
    );
  }

  const autoCapture = settings.autoCapture;
  const guideState: GuideState = still
    ? auto
      ? 'still'
      : 'manual'
    : !auto
      ? 'manual'
      : fit?.ready && autoCapture
        ? 'ready'
        : fit?.locked
          ? 'locked'
          : 'searching';
  const advice = auto ? (fit?.advice ?? null) : null;
  const guideLabel = advice
    ? advice.label
    : still
      ? auto
        ? fit
          ? 'Page found · check the grid'
          : 'Drag the frame onto the cards'
        : 'Adjusted'
      : !auto
        ? 'Adjusted'
        : capturing
          ? 'Capturing…'
          : fit?.ready && autoCapture
            ? 'Hold still…'
            : fit?.locked
              ? 'Page found'
              : 'Finding page…';
  const hint = error
    ? null
    : advice
      ? advice.detail
      : still
        ? 'Check that every card sits in its cell. Drag the frame to move it or its corners to resize it, then scan.'
        : !auto
          ? 'The frame stays where you put it. Capture when the cards sit in their cells.'
          : fit?.locked
            ? autoCapture
              ? 'Page found. Hold still: it captures by itself.'
              : 'Page found. Hold still and capture.'
            : autoCapture
              ? 'Point the camera at the whole page. It captures by itself once the grid holds steady, or tap Capture page any time.'
              : 'Point the camera at the whole page. The grid snaps to the cards; drag it if it does not.';

  return (
    <div className="scan-page">
      <div className="scan-view" ref={viewRef}>
        {still ? (
          <img src={still.url} className="scan-still" alt="Page being scanned" />
        ) : (
          <video ref={videoRef} className={`scan-video${live ? '' : ' hidden'}`} poster={BLANK_POSTER} playsInline muted autoPlay />
        )}
        {!still && !live && !restoring && <CameraPlaceholder Icon={Icon} text={error ?? 'Starting camera…'} live={!error} />}
        {guideBox && viewSize.w > 0 && !scanning && (
          <PageGuide
            box={guideBox}
            bounds={{ x: 0, y: 0, w: viewSize.w, h: viewSize.h }}
            layout={layout}
            state={guideState}
            label={guideLabel}
            warn={!!advice}
            onChange={onGuideChange}
          />
        )}
        {scanning && (
          <div className="page-progress">
            <div className="spinner-ring" />
            <div>
              Reading pocket {Math.min(progress.done + 1, progress.total)} of {progress.total}…
            </div>
            <div className="progress" style={{ width: '60%' }}>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
            </div>
            <button
              type="button"
              className="btn ghost"
              style={{ color: '#fff' }}
              onClick={() => {
                abortRef.current?.abort();
                setScanning(false);
              }}
            >
              Cancel
            </button>
          </div>
        )}
        <div className="scan-hud">
          <span className="scan-status">
            <span className={`scan-dot${live && !still ? ' live' : ''}`} />
            {error ? error : scanning ? `Reading page · ${engineName}` : still ? 'Check the grid' : `Binder page · ${layout.label}`}
          </span>
          <span className="btn-row">
            <button type="button" className="btn ghost" style={{ color: '#fff' }} onClick={() => fileRef.current?.click()}>
              Photo
            </button>
            <button type="button" className="icon-btn" style={{ color: '#fff' }} aria-label="Leave page mode" onClick={exit}>
              <CloseIcon />
            </button>
          </span>
        </div>
      </div>
      <div className="scan-bottom">
        <div className="chip-row inline">
          {PAGE_LAYOUTS.map((l) => (
            <Chip key={l.id} active={layout.id === l.id} onClick={() => update({ pageLayout: l.id as PageLayoutId })}>
              {l.label}
            </Chip>
          ))}
          <Chip active={autoCapture} onClick={() => update({ autoCapture: !autoCapture })}>
            Auto capture
          </Chip>
        </div>
        {error ? (
          <div className="hint">
            {error}. You can still{' '}
            <button type="button" className="link-btn" onClick={() => fileRef.current?.click()}>
              scan a photo of the page
            </button>
            .
          </div>
        ) : (
          <div className="hint">{hint}</div>
        )}
        <div className="btn-row">
          {still ? (
            <>
              <button type="button" className="btn primary" disabled={scanning || !pageBox} onClick={scanStill}>
                Scan {layout.cols * layout.rows} pockets
              </button>
              <button type="button" className="btn ghost" disabled={scanning} onClick={retake}>
                {frame === still ? 'Back' : 'Use camera'}
              </button>
            </>
          ) : (
            // Amber with the reason while the live guidance says the shot will not read well; never disabled for that.
            <button
              type="button"
              className={`btn ${advice ? 'warn' : 'primary'}`}
              disabled={scanning || capturing || !!error || !live || !pageBox}
              onClick={() => void capture()}
            >
              <CameraIcon size={18} /> {capturing ? 'Capturing…' : 'Capture page'}
              {advice && !capturing && <span className="btn-reason">· {advice.label}</span>}
            </button>
          )}
          {!auto && (
            <button type="button" className="btn ghost" disabled={scanning} onClick={snapToPage}>
              Snap to page
            </button>
          )}
        </div>
      </div>
      {fileInput}
    </div>
  );
}
