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
| `grid.ts` | finds the card grid in a frame (colour edge profiles, pitch by autocorrelation, phase/width search), `perspectiveCheck` (pure) |
| `guidance.ts` | binder-page capture guidance: `sharpness`, `measureGuidance`, `adviseCapture` ("Move closer", "Flatten the phone", "More light", "Hold still") |
| `photo.ts` | full-resolution stills from the camera stream through ImageCapture (`takePhoto`, `probePhotoSize`), null when the API is missing |
| `hash.ts` | artwork matching: perceptual card hash (`hashCard`) with one `HashSpec` per game (card aspect, artwork window), the hash tables (`public/data/hashes.json`, `public/data/ygo/hashes.json`), Hamming search and the pocket alignment search (`matchPocket`) (pure; DOM sampling helpers at the end) |
| `artwork.ts` | loads a game's hash table (`loadHashTable`) and merges a pocket's nearest hashes into the OCR candidates (`mergeArtworkEvidence`, pure) |
| `live-artwork.ts` | the same artwork evidence for the live single-card loop: hashes the card(s) nearest the middle of the frame around the matcher's outline estimate (`addLiveArtwork`, pure given a sampler) |
| `focus.ts` | which of a frame's cards single-card mode shows: the one under the middle of the frame, else the largest nearest it (`focusTracks`, pure) |
| `autocapture.ts` | binder-page auto-capture: when a run of steady, confident fits may press the shutter, and where to look for the grid on the photo (pure) |
| `tracker.ts` | cross-frame merge, 2 s hold, candidate pool with decaying weights, hysteresis, `stability` (pure) |
| `camera.ts` | `startCamera`, `stopCamera`, `grabFrame`, `coverTransform`, `mapBox`, `unmapBox`, `visibleRegion`, `previewToPhoto` |
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
- With `artwork` (default true) and a matcher that has `lookup`, the card(s)
  nearest the middle of each frame are also matched by picture
  (`live-artwork.ts`) before tracking; `artworkMs` is the running cost.
- `focusTracks(results, frameSize)` (`focus.ts`) picks what single-card mode
  shows: only the card under the middle of the frame while there is one.
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
takePhoto(stream, { timeoutMs?, maxLongSide?, size? }): Promise<PhotoResult | null>  // ImageCapture still; null → use grabFrame
probePhotoSize(stream): Promise<Size | null>              // largest photo the camera offers (sensor orientation)
previewToPhoto(preview, photo): CoverTransform            // where the preview frame sits in the photo (photo px)
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
- **Artwork** (binder pages): the picture is hashed and matched against `public/data/ygo/hashes.json`,
  one entry per passcode (see "Artwork matching" below). A hit names the card like a passcode read
  does; the set code still picks the printing.

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
the collector number, cropped between 1000 and 1400 px wide and read. Before the OCR the pocket's
picture is hashed and matched against the catalog's artwork hashes (`matchPocket`, see "Artwork
matching" below); the nearest hashes are merged into every OCR result of the pocket
(`mergeArtworkEvidence`), so a picture match plus a read number is confident at once and skips the
magnified strip, and a picture match alone shows up as an unsure candidate with that picture's
printings as alternatives. `PocketScan.artwork` lists the nearest hashes, `hashMs` the time they
took; `artwork: false` in the options turns the step off. When that read does not
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
runs it 3×/s, eases the guide towards each fit, and calls the page "found" after two fits within
3% of each other.

**The shutter** (`autocapture.ts`): a hand-held phone rarely holds a lock, so the live fit is
not what a capture depends on. The captured frame is fitted itself (`fitGridOnSource` over the
guide's box grown by 12%, 400 px sample) and that fit places the pockets; the live guide is only
the fallback. Measured on the Pixel photo from a guide placed 8–12% off: the grid is found at
confidence 0.56–0.71 in 17–78 ms. A capture is read at once when the frame shows the grid, when
the guide was locked, or when the user placed it by hand; only a capture with none of those is
shown as a still with the guide for a check. With *Auto capture* on (default, `settings.autoCapture`)
the shutter also fires by itself: two consecutive fits at confidence ≥ 0.5 within 3% of each other
with no capture advice pending, and at least 0.7 s after the preview came up, so nobody has to
tap at the right instant; the guide turns solid green with "Hold still…" first. Why a capture
used to fail: the lock needed three fits within 1.5% (about a second of holding still) and dropped
on the first drift, so the tap usually landed after it, and the user was sent to the check screen.

**Capturing at full resolution** (`photo.ts`): the preview stream is at most ~1920 px on its long
side, which on a 9-pocket page leaves ~600 px cards and a ~13 px collector-number line, the low end
of what ML Kit reads (measured on a Pixel 11 Pro XL and a Z Fold 8: names read, number line
missed; the phones' own 6128 px camera-app photos, ~1,800 px cards, read well). "Capture page"
therefore takes a still through the camera's photo pipeline, `new ImageCapture(track).takePhoto()`
at the largest `getPhotoCapabilities()` size, decoded with `createImageBitmap` (EXIF orientation
applied, downscaled to ≤ 4608 px on the long side since pockets are read at ≤ 1400 px), and falls
back to a copy of the preview frame when the API is missing (Firefox, Safari), the capture rejects,
takes more than 4 s, or returns nothing larger than the preview or the other way up. The page box
the user saw is in preview px; `previewToPhoto` maps it onto the photo on the model that the photo
covers the whole sensor and every stream is a centred crop of it with its own aspect (a pure scale
when the aspects agree, otherwise the preview sits as a centred band: `containTransform` of the
preview inside the photo). On Android a second frame is read too: another `takePhoto` when the
first left room inside the 1.5 s capture budget, else the preview frame drawn into the photo's
pixel space (`previewInPhotoSpace`) so the same pocket boxes apply. The review header shows the
captured size ("9 of 9 pockets · 3024×4032 · 3.1 s") and the Save-capture report records `capture`
(source, preview size, photo timings, extra-frame origin, the live guidance at the shutter) so a
bad page from a phone can be reproduced. A photo is only attempted when the probed size beats the
preview: on the emulator the largest photo equals its 1392×1856 preview and the attempt cost 2.2 s
for nothing. Measured on the emulator (emulated camera, release 1.1.3 and a debug build asking for
a 640×480 preview): probe `camera 480×640, photo 1856×1392` (capabilities come in sensor
orientation), `capture photo 1392×1856 from preview 480×640 in 1448 ms (photos 1424 ms)`, decoded
upright (EXIF applied) and shown with the guide for the check; with the full-size preview the
capture falls back to the preview frame and the review reads "0 of 9 pockets · 1392×1856 · 81.8 s"
(ML Kit under SwiftShader, two frames). The emulated scene animates, so the still cannot be laid
over the preview pixel for pixel; `previewToPhoto` is unit-tested instead. Phone timings are
still to be measured.

**Capture guidance** (`guidance.ts`): while the grid is fitted, three cheap checks say whether the
shot will read, and the guide's badge and an amber "Capture page · reason" button (never disabled)
show the one that matters most, with a line under the layout chips explaining it:

- *Move closer*: the fitted card width scaled to the capture resolution (`cols.size` ×
  preview/sample × photo/preview) is under `MIN_CARD_PX` = 500 (a ~11 px number line); live, the
  wanted width is capped at 85% of what the view can hold, so a preview-only capture is not nagged
  for the impossible. The advice shows after two fits agree (`ADVICE_FITS`); "all good" at once.
- *Flatten the phone*: the fit's column pitch over row pitch disagrees with the card aspect by more
  than `ASPECT_TOLERANCE` = 8% (foreshortening; the straight-on fixtures measure 1.017–1.028), or
  `perspectiveCheck` (grid.ts) sees the card widths grow across the columns or the heights across
  the rows by more than `PITCH_TOLERANCE` = 5% (keystone: the nearer edge's cards are bigger). The
  keystone check refines each fitted edge to the nearest significant peak of the page's column/row
  profile within ±4.5% of the pitch and fits a line through the n sizes. On the three straight-on
  fixtures it reads 0.987–1.008; it is conservative: a synthetic 10% keystone reads 1.02–1.03
  (the whole-grid fit's prior absorbs part of it; the nearest peak is sometimes the border's inner
  edge), while the fit's own pitch ratio drifts to 1.11–1.14 on the same images and trips the aspect
  check. Refitting the first and last row on their own with `fit1D`, the first design, swung ±10%
  on the straight-on photos (one row of evidence cannot tell card edges from pocket seams), as did
  band autocorrelation and refitting half pages; real tilted captures from the phones (the
  Save-capture report carries the metrics) are what this needs next.
- *More light* / *Hold still*: `sharpness()` on a 340 px-per-card sample of the lower half of the
  middle row (attack text and the number line, the smallest print): mean luma under
  `MIN_LUMA` = 60 asks for light; otherwise the score Σ laplacian² / Σ |gradient|² over edge pixels
  (≈ 4 for a sharp edge, ≈ 1/σ² for a Gaussian blur of σ px, independent of size and contrast)
  under `MIN_SHARPNESS` = 1.5 asks for stillness. Calibrated with `scripts/guidance-bench.html`
  (Tesseract in the browser, photos normalised to a 4032 px long side): the fixtures score
  2.7–3.5; blurred 1 px on ~870 px cards (score 2.2) the number line and the same ids still read,
  at 1.5 px (score 1.46) nothing reads; on 577 px cards 1 px (score 1.32) loses everything. Cost
  per fit on this desk: perspective ~1 ms, sharpness ~2 ms plus the sample; the fit itself 10–15 ms.

The three states were checked through the photo path with fixture variants (a 907 px downscale →
"Move closer", a 2 px blur → "Hold still", brightness 0.2 → "More light", a 12% keystone →
"Flatten the phone", the plain photo → "Page found · check the grid").

**Live tracking** (`tracker.ts`): each track keeps a pool of cards with decaying weights (×0.7 per
frame); the frame's read adds its score (×1.5 when the matcher called it confident), each
alternative adds half of its score, scaled down the further it trails the read and nothing from
0.3 below it (a name-only read's dozen printings all count, the same printings under a card the
picture or the number lifted to ~1 do not). The chip shows the pool leader and only switches when a
challenger leads by 1.5×, so two cards the OCR flips between do not flip the chip; a confident read
of a card sharing nothing with the pool retires the track at once (the user swapped cards).
`ScanCandidate.stability` is the leader's share of the pool ramped in over three frames, drawn as
the chip's confidence bar; the pool (as shares) is exposed through `alternatives` and listed as
runners-up under the row.

**One card at a time** (`focus.ts`, `live-artwork.ts`): single-card mode in front of a binder
page sees the card above and below the one aimed at, and two Pikachu of different printings read
by name alone traded identities between their chips every frame (Pixel 11 Pro XL, 1.2.0). Two
fixes. `focusTracks` shows only the card whose outline covers the middle of the frame while there
is one (else the old rule: the largest nearest the middle, a second only when nearly as big). And
the live loop merges artwork evidence like page mode does: for the one or two candidates nearest
the middle, the matcher's outline estimate plus a 12% margin is sampled 272 px wide and searched
with wider alignment probes than a pocket (±8% / four scales coarse, ±10% / nine scales fine,
since the outline comes from text lines, not fitted edges), the hits go through
`mergeArtworkEvidence`, and the candidate keeps its key and text box. Its outline snaps onto the
picture: `matchPocket` now reports, per hit, the alignment window that gave its distance, and when
the merged card's hit is a real match (≤ 24 bits) that window becomes the card box (`snapToArtwork`),
so an outline inferred from text lines that ran long at the bottom and right (an overestimated text
scale) is pulled back onto the card within a probe step. Outlines narrower than 60 px or less than
90% inside the frame are skipped. Measured in software-rendered Chrome on a
1080×1920 frame cut from the Pixel binder photo: 72 ms for the centre card; its read went from
`number 3/108; name; HP` at 1.00 but unsure (Evolutions reprints the Base Set picture, so three
same-art printings tied) to confident with `artwork 10`, the same-picture printings staying as
alternatives; the half-visible card below was left alone.

**Snap mode** (`src/pages/scan/SnapScan.tsx`, `matchStillCard`): the default single-card flow since
1.2.4 works like a binder page: the camera shows a card-shaped guide (80% of the visible height,
the game's card aspect) and a shutter; a tap takes a full-resolution photo through the still
pipeline (`photo.ts`, preview copy as the fallback), the guide plus a 25% margin is cropped to
1,200–1,600 px and read like a gallery photo, and the still lists the best match with up to three
alternatives, each with its own Add. The still reader uses the picture too: `matchStillCard` hashes
the guide region (plus 15%) with the wide live probes and merges the hits into the OCR candidate
whose outline centre lies in the guide, or, with no such candidate, makes the matched card the
candidate on its own (unsure, that picture's printings as alternatives), which is how a foil or a
stylised name gets identified at all; gallery photos (no guide) hash around what the text found
(`addLiveArtwork`). Measured on a 1600 px crop of the Pixel binder photo with a guide 15% larger
than the card: picture alone → the right card at 15 bits with its box snapped to the card,
0.7 s cold / 0.17 s warm in software Chrome; Tesseract read 99 lines of that crop and no usable
name, so without the picture the still would have offered a wrong card.

## Artwork matching (`hash.ts`, `scripts/build-hashes.mjs`)

Commercial scanners identify a card by its picture, not its text. `hash.ts` adds that as a second,
OCR-independent signal: every Pokémon card's TCGdex reference image is reduced offline to a 128-bit
perceptual hash (`npm run hashes` → `public/data/hashes.json`, 32 bytes per card, ~355 KB gzip for
19.7k cards; 1.6k cards have no image on TCGdex), and a pocket crop is hashed the same way and
compared with every entry by Hamming distance (a linear scan of 20k × 128 bits is ~1 ms).

**The hash** (one `HashSpec` per game; `HASH_SPEC` is the Pokémon id): two difference hashes of the
luma, each on a 9×8 grid of cell means (8 rows × 8 "is the cell darker than its right neighbour"
bits = 64 bits): one of the whole card, one of the game's artwork window (Pokémon: x 10–90 %,
y 12–47 % of the card, inside the picture box of both modern and Base Set layouts; Yu-Gi-Oh!: see
below). The spec id is written into the table file and a table whose spec this code does not know is
not loaded; `matchPocket` probes a pocket with the table's own window, so a spec change is a new id
and a rebuilt table. A dHash ignores brightness, contrast and smooth lighting gradients, which is
what a photo through a binder sleeve adds. Transparent pixels (the reference scans' rounded corners)
are composited over white. The build script decodes with `sharp` and calls the very same `hashCard`
through Vite, and a reference image hashed in the browser (canvas → `getImageData`) matches its
table entry bit for bit (18/18 in the bench), so the table and the scanner never disagree on the spec.

**Alignment is everything.** Measured on reference images: a 1 % shift of the card costs ~13 bits,
3 % costs 28–41, while unrelated cards differ by ~64 and reprints of the same picture by 0–8; a card
drawn 6 % too small costs ~18. The fitted grid is within a pocket gap of the cards, never exact, so
`matchPocket` searches: the padded pocket crop is sampled once (272 px wide, the card ≈ 245 px like
a reference image) into a luma summed-area table, from which the hash of *any* window costs 144
lookups. A coarse pass hashes 75 alignments (±4 % in 2 % steps × card 92/96/100 % of the cell) against
the whole table, then the 96 nearest cards get a fine pass over 1,183 alignments (±6 % in 1 % steps ×
90–102 %).

**Measured on the three fixture photos** (`node scripts/hash-bench.mjs`, 27 pockets, expected ids in
`scripts/fixtures/binder-pages/README.md`; OCR alone got 8 of these 27 printings right in the earlier
manual bench and 6 in `scripts/page-bench.mjs`):

| placement of the card in the pocket | exact | same artwork | median distance to the expected card | median margin to the next artwork / next card |
|---|---|---|---|---|
| the grid cell as is | 4/27 | 4/27 | 44 | 1 / 1 |
| the card box the fitter measured | 6/27 | 6/27 | 43 | 1 / 1 |
| padded crop tightened to the card's edges (`refineCardBox`) | 12/27 | 12/27 | 37 | 3 / 3 |
| coarse search alone (75 alignments) | 22/27 | 23/27 | 15 | 9 / 7 |
| **coarse-to-fine search (`matchPocket`)** | **24/27** | **25/27** | **11** | **14 / 12** |

Per photo (exact): Fold 8/9, Pixel 8/9, Pixel page B 8/9 (9/9 by artwork). The matched pockets sit at
5–14 bits from their card with the runner-up 8–23 bits further away; the two exceptions are Butterfree
`sv09-003` (26–27 bits, margin 1–2, a textured holo) and the misses below. The miss on both pages is
Wartortle `swsh10.5-016`: a glare band across the top of the picture, so the nearest entry is Relicanth
`swsh3-40`, a Sword & Shield Water card with the same layout (Fold: 27 vs 41 bits for Wartortle; Pixel:
26 vs 26, a tie). Alignment tolerance, from the reference images shifted and scaled in the bench: a 1 %
shift (≈ 13 bits) keeps every card at rank 1, 2 % (≈ 25) keeps 14 of 18, 3 % (≈ 35) 8 of 18; a card 6 %
too small (≈ 18 bits) keeps all 18, 10 % (≈ 27) 16 of 18. Cost: ~110 ms per pocket in headless Chrome
with software rendering against the full table (the coarse pass, 19.7k cards × 75 probes, is most of
it; 20–34 ms with a 4k-card table), so ~1 s per 9-pocket page beside 2.7 s of OCR; not yet timed on a
phone. Browser hash versus the Node-built table entry: 0 bits apart for all 18 reference images (the
runtime's resampled path 0–4).

The third miss is `base1-55` (Nidoran♂, Base Set), whose nearest entry is `lc-83`, the Legendary
Collection reprint of the same picture (12 vs 18 bits): an artwork hash names the picture,
and the printing has to come from the OCR'd set code or number, exactly the evidence OCR does read.

**Merging with the OCR** (`artwork.ts`, `mergeArtworkEvidence`): every card named by either side is
scored `min(1, OCR score + artworkBonus)`, where the bonus is 0.9 for an identical picture, 0.55 at
the match limit of 24 bits and fades to 0 at 32, so a strong match outranks a name-only read (~0.45)
on its own but not a clean number + total + name read (0.95–1). Hits within 6 bits of the best one are
the same picture (reprints). The best card is confident when the picture matched (≤ 24) and the OCR
read a number or set code for it (Yu-Gi-Oh!: the printed code) — or its name or passcode, when the
picture exists in one printing only — or when the OCR was already confident and the picture does not
point at a different card. A match alone is an unsure candidate with the picture's printings as
alternatives, newest first; a weak hit (25–32 bits) only adds alternatives. The hash evidence appears
as `artwork N` (N = bits) in `evidence`. The table is loaded once per game by `loadHashTable` and the
matcher resolves ids through `ScanMatcher.lookup`; a Yu-Gi-Oh! hit names a passcode, which
`ScanMatcher.artworkCards` turns into one hit per printing before the merge (`expandArtworkHits`).

**End to end** (`node scripts/page-bench.mjs`, scanPage with Tesseract on the same 27 pockets, the
printing must be exact):

| pipeline (Tesseract, number strip on) | exact | confident (right / wrong) | expected among alternatives | 3 pages |
|---|---|---|---|---|
| OCR only (`--no-hash`) | 6/27 | 2 (2 / 0) | 11 | 53.4 s |
| **OCR + artwork** | **26/27** | **12 (12 / 0)** | 1 | 47.3 s, of which hashing 1.1 s |

Per page with artwork: Fold 9/9 (4 confident), Pixel 9/9 (5), Pixel page B 8/9 (3). The one miss is
the Nidoran♂ reprint again: the OCR read the name and HP but no number, so Base Set and Legendary
Collection tie and the newer printing is shown with the other as the first alternative. Every pocket
whose OCR read nothing usable (10 of 27) is now identified by its picture alone (`artwork 7`–`14`,
unsure, printings as alternatives), the Butterfree holo by a weak hit (`artwork 27`); the glare-struck
Wartortle on the Pixel page is right through name + a weak hit (26). Pages got faster because a
confident hash + number read skips the magnified strip. Hashing cost 0.33–0.39 s per page
(≈ 40 ms per pocket, full-resolution crops, headless Chrome with software rendering); the table
loads in 40 ms and holds 307 KB of hash words plus the 19.7k id strings and their index, roughly
1.7 MB of heap in all (the browser's `performance.memory` could not resolve the delta). Not yet
timed on a phone.

**Yu-Gi-Oh!** (`npm run hashes:ygo` → `public/data/ygo/hashes.json`, spec `dhash-9x8-luma-card+art-ygo-v1`).
The table is keyed by **passcode**, the picture's own id: every printing of a card shares it (2.74
printings per card on average, 71 for Blue-Eyes White Dragon), and an alternate artwork is its own
passcode and entry. 14,825 hashes = 14,653 cards + 172 alternate artworks, 100 % of the catalog (no
render was missing), 478 KB raw (32.2 bytes per entry), 295 KB gzip; the cold build downloaded 14,622
YGOPRODeck small renders (mostly 268×391; 272 come in other sizes, which the hash does not mind) in
1,476 s at 10 requests/s, and a rebuild from the cache takes 32 s. The renders are replicas without
set code or passcode printed, which the picture does not need. **Artwork window**, measured on the
renders: standard frames (monster, spell, trap, link, xyz) print a square picture at x 11.9–88.1 %,
y 18.2–70.6 % of the card; the `*_pendulum` frames (391 cards) a wider one at x 6.3–93.7 %,
y 17–76 %, with the pendulum scale box drawn over its bottom from ≈ 63 %. The spec's window,
x 13–87 %, y 20–69 % (`YGO_ART_WINDOW`), sits ≈ 1 % inside the standard box and inside the pendulum
picture too, so one window hashes every frame and a pocket needs no second set of probes (a per-frame
window would need a flag per entry and probes for both, and the pocket's frame is unknown before the
match); on the pendulum cards its bottom rows cover the scale box, the same on the render and on the
card. Window choice, on 3,000 renders (nearest different card, pairs within 24 bits): this window
median 33 bits / 177 pairs; the rough x 10–90 %, y 18–55 % guess 32 / 198; a taller x 8–92 %,
y 18–74 % 31 / 252; the Pokémon window 30 / 314 — and the same render shifted 1 % costs 6 bits
(median), 2 % 13, blurred 1.5 px 1.

**Separation of the Yu-Gi-Oh! table** (`node scripts/hash-separation.mjs --game ygo`, every entry
against every other): nearest other entry median 30 bits (p10 25, p90 34, mean 29.3), second nearest
median 31; 122 entries (0.8 %) have a neighbour within 8 bits, 248 (1.7 %) within 16, 1,356 (9.1 %)
within the 24-bit match limit, in 3,175 pairs. Of those pairs 184 involve YGOPRODeck placeholder ids
(≥ 100000000, cards without a real passcode that share a stock image; 103 of the 175 such ids), 12 are
a card and its own alternate artwork (renders that are the same picture: Toon World, Winged Kuriboh,
Crush Card Virus), 117 a token and the monster whose art it reuses (Ojama, Rockstone Warrior, Mithra),
1,451 two spells or traps (same frame, dark pictures), 5 two pendulum cards. Counting only different
cards with real passcodes, 60 entries have a neighbour within 8 bits, 153 within 16 and 1,208 (8.1 %)
within 24. For comparison the Pokémon table has a median nearest neighbour of 32 bits with 13.7 % of
its entries within 24 and 6.4 % within 8 (reprints of one picture and the energy cards).

**Measured on a synthetic page** (`node scripts/hash-bench.mjs --game ygo`; there are no real
Yu-Gi-Oh! binder photos yet, so `scripts/synth-page.mjs` pastes nine renders — effect, normal, link,
xyz, spell, trap, two pendulums, an alternate-art fusion — on a page with ±2 % shifts, 94–100 % scale,
0–1.2 px blur, ×0.9–1.05 brightness, a lighting gradient and JPEG 85): the coarse-to-fine search finds
**9/9** at 2–9 bits (median 3) with 15–26 bits (median 19) to the next entry; the grid cell as is
0/9, `refineCardBox` 7/9, the coarse pass alone 9/9 (median 13); 58 ms per pocket against the 14.8k
table in headless Chrome. Browser hash versus the Node-built entry: 0 bits for all nine renders
(the runtime's resampled path 0–4). Tolerance, from the renders shifted and scaled: 1 % costs 6–15
bits and 2 % 17–28 with every card still at rank 1, 3 % 22–38 (6 of 9 at rank 1), 4 % 30–47 (5 of 9);
a card 6 % too small 16–23 bits and 10 % 22–37, all at rank 1. End to end (`node scripts/page-bench.mjs
--game ygo`, scanPage with Tesseract): 9/9 pockets identified by the picture (`artwork 2`–`9`; three
also read the name and ATK/DEF), 0 confident — rightly, since a render carries no set code and a hit
alone shows the newest printing with the others as alternatives; 11.5–12.8 s for the page, of which
hashing 0.29–0.36 s (32–40 ms per pocket); the table holds 232 KB of hash words, ≈ 2.8 MB of heap
with its ids, and loads in 1.6 s cold from the dev server (11 ms from the browser cache). A synthetic page says nothing about glare, foil or a phone's focus: real photos (a Pendulum card
and a foil among them) are the next measurement.

## Pokédex line as a species cue (`parseDex`)

Pokémon cards since the Black & White era print the National Pokédex number on the Pokédex line
("NO. 0204 Bagworm Pokémon"). On cards with stylised names OCR often reads nothing else cleanly
(measured on an SV Pineco scan: no name, no number, the Pokédex line at 87%), so a `dex` observation
anchors a card on its own, adds the species' printings to the candidate pool and scores 0.3 (name
0.4): dex alone gives a low-confidence chip with the other printings as alternatives; dex + number
line is confident.
