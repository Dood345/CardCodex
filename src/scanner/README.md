# src/scanner — camera card recognition

On-device OCR → catalog matching for the live camera view. Nothing leaves the
device except the one-time Tesseract language-model download (see Engines).

## Files

| file | what |
|---|---|
| `index.ts` | public entry; re-exports everything below |
| `types.ts` | `Box`, `RecognizedLine`, observations, `ScanCandidate`, `ScanAlternative` |
| `useCardScanner.ts` | React hook: camera + OCR loop + debounced results |
| `match.ts` | `buildScanIndex`, `matchObservations`, `scanLines`, `printingsOf`, `findNames` (pure) |
| `parse.ts` / `ocr-normalize.ts` | OCR-noise-tolerant parsing of number / set code / HP / name (pure) |
| `tracker.ts` | cross-frame merge, 2 s hold, vote-based identity (pure) |
| `camera.ts` | `startCamera`, `stopCamera`, `grabFrame`, `coverTransform`, `mapBox` |
| `engine.ts` | `getRecognizer()` — ML Kit on native, Tesseract otherwise, with fallback |
| `tesseract.ts` / `mlkit.ts` / `recognizer.ts` | engines + `TextRecognizer` interface |

## Usage

```tsx
import { buildScanIndex, useCardScanner, coverTransform, mapBox, printingsOf } from '@/scanner';

// Once per catalog load (~100 ms for 21k cards). Memoize it.
const index = useMemo(() => (catalog ? buildScanIndex(catalog) : null), [catalog]);

const scanner = useCardScanner({ index, enabled: isScanTabActive });
// scanner: { videoRef, status, error, results, frameSize, engine, paused, start, stop, pause, resume }

<div ref={wrapRef} style={{ position: 'relative' }}>
  <video ref={scanner.videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  {scanner.results.map((c) => {
    const t = coverTransform(scanner.frameSize.w, scanner.frameSize.h, wrapW, wrapH);
    const b = mapBox(c.bbox, t);          // or c.cardBox for the whole card outline
    return <button key={c.key} style={{ position: 'absolute', left: b.x, top: b.y }}
                   onClick={() => openPicker(c)}>{c.card.name} · {c.set.abbr} {c.card.num}</button>;
  })}
</div>
```

- `<video>` must be rendered when the hook mounts (the effect calls `start()`);
  if you mount it later, call `scanner.start()` yourself.
- `results` are **tracks**, not raw detections: one per physical card, `key` is
  stable while the card stays in view, a chip lingers ~2 s (`holdMs`) after
  the card was last read, and its identity only flips after it's out-voted on
  ~2 frames.
- Boxes are in **frame pixels** (`frameSize`, the downscaled OCR canvas), so
  always pass `frameSize` (not `video.videoWidth`) to `coverTransform`.
- `status`: `idle → starting → scanning`, or `error` (camera denied/missing,
  `error` holds a user-facing message). Recognition errors set `error` but keep
  scanning. `pause()`/`resume()` stop OCR but keep the camera on (use it while
  a correction sheet is open); the page being hidden pauses automatically.
  `enabled: false` or unmount stops the camera.

### Showing and correcting a guess

`ScanCandidate`: `card`, `set`, `score` (0..1), `margin` (gap to the runner
up), `confident` (score ≥ 0.75 and margin ≥ 0.1), `evidence` (strings like
`number 57/198`, `name "Wugtrio"`, `HP 90`, `set SVI`), `bbox`, `cardBox`,
`alternatives` (≤ 12 `{card, set, score, evidence}`, best first).

Suggested UX: one tap on a confident chip adds the card; on a non-confident
chip open a picker with `[candidate, ...alternatives]`. When the guess came
from the name only (all printings tie; newest set wins), offer
`printingsOf(c.card.name, index)` for the full list of printings.

### Lower-level API

```ts
getRecognizer(opts?: TesseractOptions): TextRecognizer   // app-wide singleton
disposeRecognizer(): Promise<void>
recognizer.recognize(canvas | ImageBitmap | Blob | url): Promise<RecognizedLine[]>
scanLines(lines, index): ScanCandidate[]                 // parse + match, pure
startCamera(video, { facingMode?, width?, height? }): Promise<MediaStream>  // throws CameraError {code}
grabFrame(video, maxWidth = 1280): HTMLCanvasElement     // shared canvas
```

## Engines

`getRecognizer()` uses **ML Kit** when `Capacitor.isNativePlatform()` and the
`TextRecognition` plugin is available, else **Tesseract.js**. After 3
consecutive ML Kit failures it switches to Tesseract for the session.
`scanner.engine` reports which one answered.

**Tesseract.js 7** (web, and fallback): one lazily created English worker,
PSM 11 (sparse text — PSM 3/6 fused text across neighbouring cards in tests).
`tesseract.js` itself is loaded with a dynamic `import()` on the first scan.
Assets under `vite build` (verified with a test build + browser run):
`worker.min.js` and `tesseract-core-simd-lstm.wasm.js` are **bundled** into
`dist/assets` via `?url` imports (~4 MB, fetched only when scanning starts).
Browsers without WebAssembly SIMD fall back to the jsDelivr core. The
**language model `eng.traineddata` comes from the jsDelivr CDN** on first use
(~2–4 MB, then cached in IndexedDB) because it isn't in node_modules. For
offline first-run, put `eng.traineddata.gz` in `public/tesseract/` and call
`getRecognizer({ langPath: '/tesseract' })` before the first scan.

**ML Kit** (`@capacitor-mlkit/text-recognition` 8.2.2): verified from the
plugin source that `processImage` only accepts a **file path/URI** (Android:
`InputImage.fromFilePath(context, Uri.parse(path))`; base64/data URLs fail).
The frame is therefore written as a JPEG to the cache directory through the
**Capacitor Filesystem plugin**, called by name via
`registerPlugin('Filesystem')` so no JS import is needed. **Required:**
`npm i @capacitor/filesystem && npx cap sync android` (not installed yet;
without it ML Kit fails and the app silently uses Tesseract). ML Kit gives no
confidences; lines get 0.9.

## Android notes

- Add `<uses-permission android:name="android.permission.CAMERA" />` to
  `android/app/src/main/AndroidManifest.xml`. `getUserMedia` in the Capacitor
  WebView triggers `BridgeWebChromeClient.onPermissionRequest`, which asks for
  the runtime CAMERA permission and then grants the WebView request.
  **Assumed from Capacitor's documented behaviour; not tested on a device.**
- ML Kit's model is bundled by the plugin's Gradle dependency (no download).
- Not verified on a device: ML Kit timings, the Filesystem `uri` being
  accepted by `Uri.parse` (it is a `file://` URI, which ContentResolver reads).

## Accuracy (scripts/scan-check.mjs, Tesseract in Node, real TCGdex scans)

Card filling the frame (600×825), the 6 images the heuristics were tuned on:
**6/6 top-1**, 0.3–1.3 s per image. **Held-out** cards (BW, XY, SM GX, SWSH
VMAX, SV Trainer), never tuned on: **1/5 top-1**, 2 more in `alternatives`.
On BW/XY/SM the tiny bottom-right number line was never read, so these fell
back to name-only matching (all printings tie → newest wins); the VMAX was
not recognised at all.
Card at ~245 px wide (≈ a quarter of a 1280 px frame): **0/11 top-1**. The
collector number is never read at that size. Names still are, so the right
card is in `alternatives` for 5/11.
In the browser, frames with 2–4 cards gave one chip per card with the correct
names, at 1.6–2.7 s per frame. The hook was also run end to end with a fake
camera stream: track keys stayed stable across frames, and the camera
stopped on unmount. **Hold cards close: the number is what makes a match exact.**

Most promising next step: a second OCR pass on a 2× upscaled crop of the
bottom ~8% of each detected `cardBox`, so the number line can be read.

## Tuning knobs

`useCardScanner({ intervalMs, maxWidth, holdMs })`; `SCORE_*`,
`CONFIDENT_*`, `MIN_SCORE` and card-geometry constants at the top of the
sections in `match.ts` (each documents its measurement);
`TESSERACT_PSM` / `TESSERACT_MIN_CONFIDENCE` in `tesseract.ts`;
vote decay / IoU in `tracker.ts`.

Run `node scripts/scan-check.mjs [--verbose] [--psm N] [--high-only]` after changing heuristics.
