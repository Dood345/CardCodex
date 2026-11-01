---
name: scanner-bench
description: Benchmark CardCodex's card scanner without changing it — `node scripts/scan-check.mjs` (Tesseract OCR + parser + matcher on real TCGdex card scans, top-1 accuracy per image) and `node scripts/grid-bench.mjs` (the binder-page grid fitter `fitGridOnSource` on the real 9-pocket photos in scripts/fixtures/binder-pages/, run through the Vite dev server in a headless Chrome) — and compare the numbers with the recorded baselines. Use for "run the scanner benchmark", "did OCR accuracy change", "check the grid fit on the binder photos", "scan-check", "regression check after touching src/scanner".
---

# Scanner benchmarks

Two measurements, both run from the repo root and both leaving the code untouched. Report the
numbers next to the baselines; tuning the scanner is a design task for the main session.

## 1. OCR + matching: `scripts/scan-check.mjs`

```bash
node scripts/scan-check.mjs              # 11 cards × 2 sizes, summary table at the end (~1-2 min)
node scripts/scan-check.mjs --high-only  # the 600×825 scans only (half the time)
node scripts/scan-check.mjs --verbose    # every OCR line with confidence and bbox
node scripts/scan-check.mjs --psm 6      # another Tesseract page-segmentation mode (default 11)
```

What it does: loads `src/scanner/{tesseract,parse,match}.ts` through Vite's SSR module loader (no
build step, exactly the shipped code), downloads each card's PNG from TCGdex once into
`scripts/.cache/scan/` and the English Tesseract model into `scripts/.cache/tess/` (first run only,
a few MB), runs OCR → `parseLines` → `matchObservations` against `public/data/catalog.json`.
Per image it prints the numbers / set codes / HP it read and the match with score, margin and
evidence; the final table has one row per image with `group` (`tuning` = the six images the
heuristics were tuned on, `held-out` = never tuned on) and `result`: `TOP-1`, `in alternatives`,
`wrong (<id>)` or `no match`, followed by one summary line per group and size, e.g.
`high tuning: top-1 6/6, in alternatives 0, mean OCR 1631 ms`. `--high-only` runs in about a
minute on this machine (dry run 2026-11-01: tuning 6/6, held-out 1/5 + 2 in alternatives = baseline).

Baselines (`src/scanner/README.md`, "Accuracy"): **high** (card fills the frame) tuning 6/6 TOP-1,
held-out 1/5 TOP-1 with 2 more `in alternatives`, 0.3–1.3 s OCR per image; **low** (~245 px wide)
0/11 TOP-1, 5/11 in alternatives (the collector number is never read at that size). Tesseract in
Node is not the phone's engine (ML Kit on Android does better): judge changes relative to these
numbers, not in absolute terms.

## 2. Binder-page grid fit: `scripts/grid-bench.mjs`

```bash
node scripts/grid-bench.mjs                 # the two fixtures, 3×3, 320 px sample, 5 fits each
node scripts/grid-bench.mjs --negatives     # + the local-only photos in scripts/.cache/scan-real/
node scripts/grid-bench.mjs --json          # raw records (box in px and as fractions, per-axis gap/size)
node scripts/grid-bench.mjs --layout 3x3 --sample 400 --repeats 10 path/to/photo.jpg
```

What it does: starts this repo's Vite dev server in-process on a free port, opens
`scripts/grid-bench.html` in a headless Chrome (`--disable-gpu`, own profile under
`scripts/.cache/chrome-profile/`; Edge is found too, or pass `--chrome <exe>`), where the page
imports `fitGridOnSource` from `src/scanner/grid.ts`, decodes each photo with `createImageBitmap`
(EXIF orientation applied, like the app's photo path) and fits `cols × rows` cards to the whole
image with the Pokémon card aspect (63/88). The page POSTs the results back and the script prints
one line per photo: pixels, fit yes/no, confidence, page box as fractions of the photo
(`x,y,w,h`), median fit time.

Baselines (`scripts/fixtures/binder-pages/README.md`): `fold8-9pocket.jpg` (3000×4000) confidence
**0.59**, `pixel11-9pocket.jpg` (6128×8160) **0.62**, both boxes within a pocket gap of the nine
cards, 10–15 ms per fit at 320 px in the app (17–21 ms median in headless Chrome under
SwiftShader on this machine; the fit itself is what is timed, not the decode). Dry run on
2026-11-01 reproduced both confidences exactly, with page boxes (fractions x,y,w,h) of
`0.034,0.066,0.853,0.874` (Fold) and `0.050,0.056,0.869,0.892` (Pixel): a 3×3 page fills most of
these photos. A box far narrower than ~0.6 of the photo width, or whose `w/h` is far from ~0.7
for a 3×3 page, has locked onto something other than the cards even if the confidence looks fine.
Fits below `MIN_GRID_CONFIDENCE` (0.4 in `grid.ts`) are reported as `no`; the whole run takes
~30 s (Vite + Chrome start-up and decoding the 50 MP photo included).

Negatives in `scripts/.cache/scan-real/` (gitignored, **local-only, never commit or copy them into
the repo**; absent on other machines): `furret.jpg` (single card: 0.27 → no fit) and
`frigibax.jpg` (single card: no fit) must stay `no`; `page3x3.jpg` is a synthetic 3×3 page of
TCGdex scans (fits at 1.00); `*-photo-ideal.jpg` are copies of the two fixtures;
`*-screenshot.*` are app screenshots (the Fold one gives no fit, the Pixel one fits the drawn
page guide at 1.00 — neither is a benchmark).

Manual route (a session with a browser): `npm run dev`, then open
`http://localhost:5173/scripts/grid-bench.html?imgs=scripts/fixtures/binder-pages/fold8-9pocket.jpg`
(comma-separate several; files outside the repo as `/@fs/D:/path/photo.jpg`); the JSON is on the
page and in `window.__gridBench`.

## Report

Two tables (per image: result vs baseline), then one verdict per benchmark: unchanged / better /
worse, naming the images that moved. Quote OCR lines (`--verbose`) only for the images that changed.
Do not propose heuristic changes; the main session owns `src/scanner`.

## Pitfalls

- Both scripts need `public/data/catalog.json` (scan-check matches against it) and node_modules.
- scan-check decodes PNG only (tesseract.js in Node cannot read WebP); the images are pre-converted.
- The 50 MP Pixel photo takes a few seconds to decode; the bench waits up to 3 min, then prints
  the page URL to open by hand.
- A result of `no` on both fixtures after a `grid.ts` change is a regression, not a flaky run: the
  fit is deterministic for a given sample width.
