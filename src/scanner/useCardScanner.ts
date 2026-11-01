/**
 * React hook that owns the camera → OCR → match loop. UI-free (no JSX).
 *
 *   const scanner = useCardScanner({ index, enabled: true });
 *   <video ref={scanner.videoRef} style={{ objectFit: 'cover' }} />
 *   scanner.results.map(c => <Chip key={c.key} ... />)
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { EngineName, ScanCandidate } from './types';
import type { TextRecognizer } from './recognizer';
import type { ScanIndex } from './match';
import { scanLines } from './match';
import { CameraError, grabFrame, startCamera, stopCamera } from './camera';
import { getRecognizer } from './engine';
import { updateTracks, type Track } from './tracker';

export type ScannerStatus = 'idle' | 'starting' | 'scanning' | 'error';

export interface UseCardScannerOptions {
  /** From buildScanIndex(catalog). While null, the camera runs but no OCR happens. */
  index: ScanIndex | null;
  /** Start the camera when true (and on mount); stop it when false. Default true. */
  enabled?: boolean;
  /**
   * Minimum time between frame grabs, ms. Default 900: ML Kit takes ~100–300 ms
   * per frame on mid-range phones, Tesseract 1–3 s, so with Tesseract the
   * effective rate is "as fast as recognition allows".
   */
  intervalMs?: number;
  /** Frames are downscaled to this width before OCR. Default 1280. */
  maxWidth?: number;
  /**
   * How long a chip stays after its card was last seen, ms. Default 2000;
   * automatically stretched to 2.5× the measured recognition time.
   */
  holdMs?: number;
  /** Override the recognizer (tests, custom engines). Default: getRecognizer(). */
  recognizer?: TextRecognizer;
}

export interface CardScanner {
  /** Attach to the <video> element. */
  videoRef: RefObject<HTMLVideoElement | null>;
  status: ScannerStatus;
  /** Camera or recognition error message (camera errors set status 'error'). */
  error?: string;
  /** Tracked candidates, one per physical card, debounced across frames. */
  results: ScanCandidate[];
  /** Pixel size of the OCR frame; boxes in `results` are in this space. */
  frameSize: { w: number; h: number };
  /** Engine that produced the latest results. */
  engine: EngineName | null;
  /** True while paused by pause() or because the page is hidden. */
  paused: boolean;
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
}

/** See CardScanner. Never runs two recognitions at once; frames are skipped while one is in flight. */
export function useCardScanner(opts: UseCardScannerOptions): CardScanner {
  const { index, enabled = true, intervalMs = 900, maxWidth = 1280, holdMs = 2000 } = opts;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<ScannerStatus>('idle');
  const [error, setError] = useState<string | undefined>();
  const [results, setResults] = useState<ScanCandidate[]>([]);
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });
  const [engine, setEngine] = useState<EngineName | null>(null);
  const [userPaused, setUserPaused] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);

  // Mutable loop state lives in refs so the timer callback always sees the latest values.
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  /** Moving average of recognition time, ms (0 = unknown). */
  const avgFrameMsRef = useRef(0);
  const tracksRef = useRef<Track[]>([]);
  /** Bumped by start/stop; async work from an older generation is discarded. */
  const genRef = useRef(0);
  const pausedRef = useRef(false);
  const cfgRef = useRef({ index, intervalMs, maxWidth, holdMs, recognizer: opts.recognizer });
  cfgRef.current = { index, intervalMs, maxWidth, holdMs, recognizer: opts.recognizer };
  pausedRef.current = userPaused || hidden;

  const clearTimer = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const tick = useCallback(async (gen: number) => {
    timerRef.current = null;
    if (gen !== genRef.current) return;
    const cfg = cfgRef.current;
    const schedule = (delay: number) => {
      if (gen === genRef.current) timerRef.current = setTimeout(() => void tick(gen), delay);
    };
    const video = videoRef.current;
    if (pausedRef.current || inFlightRef.current || !cfg.index || !video || video.readyState < 2) {
      schedule(cfg.intervalMs);
      return;
    }
    const t0 = performance.now();
    inFlightRef.current = true;
    try {
      const frame = grabFrame(video, cfg.maxWidth);
      const w = frame.width;
      const h = frame.height;
      const recognizer = cfg.recognizer ?? getRecognizer();
      const lines = await recognizer.recognize(frame);
      if (gen !== genRef.current) return;
      const took = performance.now() - t0;
      avgFrameMsRef.current = avgFrameMsRef.current ? avgFrameMsRef.current * 0.7 + took * 0.3 : took;
      const found = scanLines(lines, cfg.index);
      // With Tesseract a frame can take 1.5–3 s, longer than holdMs: a track
      // must survive at least ~2.5 recognition cycles or every chip would be
      // re-created (new key, votes lost) on every frame.
      const hold = Math.max(cfg.holdMs, 2.5 * avgFrameMsRef.current);
      tracksRef.current = updateTracks(tracksRef.current, found, Date.now(), hold);
      setResults(tracksRef.current.map((t) => t.shown));
      setFrameSize((p) => (p.w === w && p.h === h ? p : { w, h }));
      setEngine(recognizer.engine ?? null);
      setError(undefined);
    } catch (e) {
      if (gen !== genRef.current) return;
      // Recognition errors are reported but don't stop the loop (one bad
      // frame, model still downloading, ...).
      setError(`Recognition failed: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      inFlightRef.current = false;
    }
    schedule(Math.max(0, cfg.intervalMs - (performance.now() - t0)));
  }, []);

  const stop = useCallback(() => {
    genRef.current++;
    clearTimer();
    stopCamera(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    tracksRef.current = [];
    setResults([]);
    setStatus('idle');
  }, []);

  const start = useCallback(() => {
    if (streamRef.current || !videoRef.current) return;
    const gen = ++genRef.current;
    clearTimer();
    setStatus('starting');
    setError(undefined);
    startCamera(videoRef.current).then(
      (stream) => {
        if (gen !== genRef.current) {
          // stop()/unmount happened while the permission prompt was open
          // (also React StrictMode's mount→unmount→mount): release it, and
          // if it resolved after the live stream, give the element back.
          stopCamera(stream);
          const v = videoRef.current;
          if (v && v.srcObject === stream) {
            v.srcObject = streamRef.current;
            if (streamRef.current) void v.play().catch(() => undefined);
          }
          return;
        }
        streamRef.current = stream;
        setStatus('scanning');
        void tick(gen);
      },
      (e: unknown) => {
        if (gen !== genRef.current) return;
        setStatus('error');
        setError(e instanceof CameraError ? e.message : `Could not start the camera: ${String(e)}`);
      },
    );
  }, [tick]);

  const pause = useCallback(() => setUserPaused(true), []);
  const resume = useCallback(() => setUserPaused(false), []);

  // enabled → start/stop; unmount → stop.
  useEffect(() => {
    if (!enabled) return;
    start();
    return stop;
  }, [enabled, start, stop]);

  // Pause recognition while the page is hidden (tab switch, app backgrounded).
  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  return {
    videoRef,
    status,
    error,
    results,
    frameSize,
    engine,
    paused: userPaused || hidden,
    start,
    stop,
    pause,
    resume,
  };
}
