# src/scanner — camera card recognition

On-device OCR → catalog matching for the live camera view. Nothing leaves the
device except the one-time Tesseract language-model download (see Engines).

## Files

| file | what |
|---|---|
| `index.ts` | public entry; re-exports everything below |
| `types.ts` | `Box`, `RecognizedLine`, observations, `ScanCandidate`, `ScanAlternative` |
| `useCardScanner.ts` | React hook: camera + OCR loop + debounced results |
| `match.ts` | Pokémon: `buildScanIndex`, `matchObservations`, `scanLines`, `printingsOf`, `findNames`, `createPokemonMatcher` (pure) |
| `parse.ts` / `ocr-normalize.ts` | OCR-noise-tolerant parsing of number / set code / HP / name / Pokédex line (pure) |
| `ygo/parse.ts` / `ygo/match.ts` | Yu-Gi-Oh!: passcode / set code / ATK-DEF / type line parsing and `createYgoMatcher` (pure) |
| `page.ts` | binder-page geometry and per-pocket scanning (any game's matcher) |
| `grid.ts` | finds the card grid in a frame (colour edge profiles, pitch by autocorrelation, phase/width search) (pure) |
| `tracker.ts` | cross-frame merge, 2 s hold, candidate pool with decaying weights, hysteresis, `stability` (pure) |
| `camera.ts` | `startCamera`, `stopCamera`, `grabFrame`, `coverTransform`, `mapBox`, `unmapBox`, `visibleRegion` |
| `engine.ts` | `getRecognizer()` — ML Kit on native, Tesseract otherwise, with fallback |
| `tesseract.ts` / `mlkit.ts` / `recognizer.ts` | engines + `TextRecognizer` interface |

## Usage

```tsx
import { useCardScanner, coverTransform, mapBox } from '@/scanner';

// Once per catalog load (~100 ms for 21k cards / 38k printings). Memoize it.
// The game profile picks the matcher: createPokemonMatcher / createYgoMatcher.
const matcher = useMemo(() => game.createMatcher(index), [game, index]);

const scanner = useCardScanner({ matcher, enabled: isScanTabActive });
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

## Yu-Gi-Oh! (`ygo/`)

Same pipeline shape, different evidence. `ScanMatcher` (`types.ts`) is the seam: the camera hook and
`scanPage` only call `matcher.scanLines(lines)`; `createYgoMatcher(catalog)` builds a Pokémon-style
index for names (8-word windows) plus passcode and printed-code lookups.

- **Passcode** (8 digits bottom-left, ≈ H/60 tall): parsed with the usual digit confusions, optionally
  split 4+4, validated against every passcode (alternate arts included); one wrong digit is found
  through wildcard keys (`4698_414`) and scored lower (`passcode ≈…`). Names the card, not the printing:
  every printing ties, so the chip is `?` with the printings as alternatives.
- **Set code** (`LOB-EN005` under the artwork, right-aligned, ≈ H/55): prefix and body are normalized
  against the catalog's prefixes/codes (letter↔digit confusions, lost or spaced hyphen); an unknown body
  under a known prefix is matched to codes one character away (`code ≈…`). Names the exact printing.
- **ATK/DEF** (`ATK/2500 DEF/2100`, also `?` and `LINK-2`) and the bracketed **type line**
  (`[Spellcaster/Normal]`, `[Spell Card]`) are small bonuses; the **name** scores like Pokémon.
- Weights (raw, ÷ 0.85): passcode 0.6 (near 0.35), code 0.6 (near 0.3), name 0.4 × strength, stats
  0.1/0.05, type 0.05, recency 0.02. The confidence margin is computed on raw sums because passcode +
  name + stats put every printing of a card at the 1.0 ceiling and only the code separates them.
- Geometry (fractions of H, 59×86 mm card): name 0.08, set code 0.725, type line 0.77, ATK/DEF 0.925,
  passcode 0.962. Anchors in order passcode → code → stats → strong name; binder pages use
  `cardMm: {59, 86}`.

Measured in the browser (Tesseract) on a YGOPRODeck render of Dark Magician with a code and passcode
painted on (the renders are replicas without them): at 813 px wide the passcode was read and the card
identified (`?`, printings as alternatives), the stylised serif name and ATK/DEF were not; at 1600 px
ATK/DEF and the type line were also read (0.85). Stills narrower than 1200 px are therefore upscaled
to 1600 px before OCR (`fileToCanvas`). Real cards, and ML Kit on Android, remain to be measured.

## Tuning knobs

`useCardScanner({ intervalMs, maxWidth, holdMs })`; `SCORE_*`,
`CONFIDENT_*`, `MIN_SCORE` and card-geometry constants at the top of the
sections in `match.ts` (each documents its measurement);
`TESSERACT_PSM` / `TESSERACT_MIN_CONFIDENCE` in `tesseract.ts`;
vote decay / IoU in `tracker.ts`.

Run `node scripts/scan-check.mjs [--verbose] [--psm N] [--high-only]` after changing heuristics.

## Binder pages (`page.ts`, `grid.ts`)

`pageRect` / `pocketBoxes` give the default page guide (largest cols×63 : rows×88 rectangle centred
in `within`, the part of the frame that is on screen; `cardMm` changes the card size) and its pocket
cells; `pocketBoxesIn(page, layout)` subdivides an explicit rectangle. `scanPage(source, layout,
recognizer, matcher, { geometry: { page } })` crops every pocket from the full-resolution source (an
`ImageBitmap` of the photo or a full-size capture canvas), keeps crops between 1000 and 1400 px wide,
runs the recognizer on each crop in turn and returns one `PocketScan` per pocket (best candidate +
alternatives + crop thumbnail). Pockets are not trimmed (`inset` 0): the collector number sits ~3%
from the card edge and a 4% trim lost it. Measured on a synthetic 3×3 page of 600 px TCGdex scans in
the browser (Tesseract): 4/5 cards exact, 4/4 empty pockets detected, 5.2 s for the page.

**Reading a pocket**: each cell is padded by 6% (`pad`) so a grid that is a little off cannot cut
the collector number, cropped between 1000 and 1400 px wide and read. When that read does not
settle the printing, the bottom 15% of the card is read again at 2.5× (`numberStrip`): the number
line is the smallest text on the card and the one that pins it down; its lines are added unless
they repeat a line already read. Measured on the three fixture photos (27 pockets, Tesseract in
the browser): cells cut exactly to the fitted grid 5 right, padded 8 right with five of them
confident; the strip changed little for Tesseract (it is aimed at ML Kit, which reads names but
drops the small number line). `refine` (tighten the padded crop to the card's own edges with
`refineCardBox`) is off by default: it lost two pockets and gained none. With `extraFrames` (the phone captures a second frame 180 ms after the first) every pocket
is read from each frame and `mergePocketCandidates` adds the scores up per card, so a card that is
top-1 in two frames beats one that was top-1 in one, and a pocket counts as confident when every
frame agrees with a clear margin. The review's "Save capture" shares (Android) or downloads the
scanned frame and a JSON report of what was read, so a page that scanned badly on a phone can be
reproduced from `scripts/fixtures/binder-pages/`.

**Where the page is** (`grid.ts`): the capture view shows the camera with `object-fit: cover`, so
the guide must live in the visible part of the frame (`visibleRegion`), and a fixed rectangle still
asks the user to line the binder up with it. `fitGridOnSource(source, region, layout)` finds the
cards instead: the region is sampled 320 px wide in colour (a yellow border on a white page is weak
in luminance but strong in the blue channel), the gradient is summed per column and per row (signed
per channel and absolute), the card pitch comes from the autocorrelation of the absolute profile
(everything printed on a card repeats once per card), and only the phase and card width are then
searched. Items are scored by the directed edge evidence at their 2n edges with the weakest item
weighted most (a cell offset inside the cards finds n−1 good items and one bad one), less the edge
energy found in the gaps between cards, with a mild preference for cards that fill their pitch.
Columns and rows must agree with the card aspect within 20%. Confidence is the mean absolute edge
energy at the fitted edges (1 = average): below 0.4 the fit is dropped. Measured on the two real
9-pocket photos in `scripts/fixtures/binder-pages/` (Pixel 11 Pro XL, Z Fold 8): both boxes within a pocket gap of the cards,
confidence 0.59–0.62, 10–15 ms per fit; two single-card photos: 0.27 and no fit. The capture UI
runs it 3×/s, eases the guide towards each fit, and calls the page "found" after three fits within
1.5% of each other; a capture before that is shown as a still with the guide for a check.

**Live tracking** (`tracker.ts`): each track keeps a pool of cards with decaying weights (×0.7 per
frame); the frame's read adds its score (×1.5 when the matcher called it confident), each
alternative adds half of its score. The chip shows the pool leader and only switches when a
challenger leads by 1.5×, so two cards the OCR flips between do not flip the chip; a confident read
of a card sharing nothing with the pool retires the track at once (the user swapped cards).
`ScanCandidate.stability` is the leader's share of the pool ramped in over three frames, drawn as
the chip's confidence bar; the pool (as shares) is exposed through `alternatives` and listed as
runners-up under the row.

## Pokédex line as a species cue (`parseDex`)

Pokémon cards since the Black & White era print the National Pokédex number on the Pokédex line
("NO. 0204 Bagworm Pokémon"). On cards with stylised names OCR often reads nothing else cleanly
(measured on an SV Pineco scan: no name, no number, the Pokédex line at 87%), so a `dex` observation
anchors a card on its own, adds the species' printings to the candidate pool and scores 0.3 (name
0.4): dex alone gives a low-confidence chip with the other printings as alternatives; dex + number
line is confident.
