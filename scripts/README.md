# scripts/

## build-catalog.mjs

Builds the offline catalog shipped with the app:

- `public/data/catalog.json` (`Catalog` in `src/data/types.ts`): all English TCGdex sets and cards.
- `public/data/species.json` (`SpeciesFile`): National Pokedex species 1..1025.

Sources: TCGdex GraphQL (bulk cards) and REST (set details), PokeAPI CSV dumps on GitHub (species, names, types).
The `tcgp` series (Pokemon TCG Pocket) and sets with zero cards are excluded.
Set `logo`/`symbol` flags are only true when the `.webp` URL under `https://assets.tcgdex.net/en/{series}/{set}/` was verified with HEAD.

Run (Node 18+, built-ins only):

    node scripts/build-catalog.mjs             # uses scripts/.cache for raw downloads
    node scripts/build-catalog.mjs --no-cache  # re-download everything

The script validates (unique ids, set references, dex range, species sanity) and fails loudly on violations.
The generated `public/data/*.json` are build artifacts but are committed to git.
Expected sizes: catalog.json ~3.3 MB (~365 KB gzip), species.json ~61 KB (~11 KB gzip).

## build-ygo-catalog.mjs

Builds `public/data/ygo/catalog.json` (`YgoCatalogFile` in `src/games/ygo/catalog.ts`): every Yu-Gi-Oh! TCG
card and printing from the YGOPRODeck API v7 (`cardinfo.php`, `cardsets.php`; two requests, cached in
`scripts/.cache/ygo_*.json` because the API asks that data be pulled once and kept).

- `sets`: one per API set name (set codes are not unique: an id gets a `-2` suffix on collision), with
  release date and card count; sets a printing names but `cardsets.php` lacks are synthesized.
- `cards`: one per passcode with type, frame, monster type / property, attribute, ATK/DEF, level (or link
  rating), archetype and alternate-art passcodes. Internal archetype markers (`| supports_archetype`) are dropped.
- `printings`: `[card, set, code, rarity]`; the same code printed in several rarities is one row with the
  rarities joined (`Ultra Rare / Ultimate Rare`); a code printed on two different cards stays two rows
  (the app appends the passcode to the second id). Placeholder codes (`MF03-EN0??`) are skipped.

Card images are **not** downloaded: YGOPRODeck forbids hotlinking and asks that each image be fetched once
and stored, which the app does per device (`src/data/imageCache.ts`).

    node scripts/build-ygo-catalog.mjs             # uses scripts/.cache
    node scripts/build-ygo-catalog.mjs --no-cache  # re-download

Expected size: ~3.6 MB (~0.8 MB gzip) for ~14.6k cards and ~38.7k printings.

Both builders reuse the raw downloads in `scripts/.cache/` (gitignored); pass `--no-cache` (as
`npm run catalog -- --no-cache`) to pick up new sets. `builtAt` changes on every run: when it is the
only diff, `git checkout -- public/data` instead of committing.

## build-hashes.mjs

Builds `public/data/hashes.json` (`HashFile` in `src/scanner/hash.ts`): one 128-bit perceptual hash per
Pokémon card image, the artwork-matching table the binder-page scanner uses beside OCR. Every card with
an image has its low-resolution TCGdex image (~245×337 WebP, ~16 KB) downloaded **once** into
`scripts/.cache/images/pokemon/<id>.webp` (`$CARDCODEX_CACHE_DIR/images/pokemon/` when set) and hashed
with the app's own `hashCard` (loaded through Vite, so Node and the browser run one implementation; a
reference image hashed in the browser matches its table entry bit for bit). Downloads are limited to
10 requests/s (`--rate`), 4 in flight (`--concurrency`), retried with backoff; 404s are remembered as
`<id>.404`. Reruns skip everything cached and re-hash in a minute or two, so a changed hash spec never
re-downloads, and an interrupted build resumes (the output is also rewritten every 2,000 cards).

    npm run hashes                                   # ≈ 35 min for a cold cache (19.7k images, 10/s)
    node scripts/build-hashes.mjs --first sv03.5,xy12  # these sets first (for early checks)
    node scripts/build-hashes.mjs --limit 50           # smoke test

The summary reports coverage (hashed / with image / catalog), download counts, image sizes and the file
size. Expected: ~19.7k hashes (92.5 % of the catalog; the rest have no image on TCGdex), ~630 KB raw
(32 bytes per card), ~355 KB gzip. `builtAt` changes on every run: when it is the only diff,
`git checkout -- public/data/hashes.json`. `scripts/fixtures/cards/` keeps two of the reference images for
`src/scanner/hash.test.ts`, which checks that hashing them reproduces their table entries. Yu-Gi-Oh! is not hashed yet: YGOPRODeck allows one download
per image, so the same script shape works (`cards_small/<passcode>.jpg`, 14.6k cards, ~25 min at 10/s)
with the card's own 59×86 aspect; see `src/scanner/README.md`, "Artwork matching".

## scan-check.mjs

Scanner reality check: the real Tesseract recognizer + parser + matcher from `src/scanner` (loaded
through Vite's SSR module loader, no build) on 11 real card scans from TCGdex at two sizes, with a
per-image result (`TOP-1`, `in alternatives`, `wrong`, `no match`) and a summary per group
(`tuning` images the heuristics were fitted on, `held-out` ones that were not). Images are cached in
`scripts/.cache/scan/`, the English model in `scripts/.cache/tess/`. Baselines: `src/scanner/README.md`,
"Accuracy".

    node scripts/scan-check.mjs [--high-only] [--verbose] [--psm N]

## grid-bench.mjs + grid-bench.html

Binder-page grid-fit benchmark: `fitGridOnSource` from `src/scanner/grid.ts` on the real 9-pocket
photos in `scripts/fixtures/binder-pages/` (see its README for the expected cards and numbers),
run the way the app runs it — in a browser. The script starts this repo's Vite dev server on a free
port, opens `scripts/grid-bench.html` in a headless Chrome (Edge works too; `--chrome <exe>` or
`CHROME_PATH`; `--disable-gpu`, own profile in `scripts/.cache/chrome-profile/`), the page decodes
each photo with `createImageBitmap` (EXIF orientation applied), fits the grid and POSTs the results
back. Output: one line per photo with pixels, fit yes/no, confidence, the page box as fractions of
the photo and the median fit time; `--json` for the raw records.

    node scripts/grid-bench.mjs                  # the two fixtures
    node scripts/grid-bench.mjs --negatives      # + the local-only photos in scripts/.cache/scan-real/ (single cards must not fit)
    node scripts/grid-bench.mjs --layout 3x3 --sample 320 --repeats 5 [photo …]

With a dev server already running (`npm run dev`) the page can be opened directly:
`http://localhost:5173/scripts/grid-bench.html?imgs=scripts/fixtures/binder-pages/fold8-9pocket.jpg`
(files outside the repo as `/@fs/D:/path/photo.jpg`).

## hash-bench.mjs + hash-bench.html

Artwork-hash benchmark: for every pocket of the binder-page fixtures, how close the pocket's hash
(`src/scanner/hash.ts`) comes to the expected card's entry in `public/data/hashes.json` and whether that
entry is the nearest, run the way the app runs it (headless Chrome through the Vite dev server, like
grid-bench). Per pocket the card is placed five ways — the grid cell as is, the card box the fitter
measured, the padded crop tightened to the card's edges (`refineCardBox`), the coarse alignment search
alone and the coarse-to-fine search the scanner uses (`matchPocket`) — and the summary counts, per
placement, exact hits, same-artwork hits (another printing of the same picture, which no artwork hash
can separate) and the median Hamming margin to the next different artwork / to the next card. The
reference images of the expected cards are also hashed in the browser (TCGdex allows CORS) to check
that the browser's hash equals the Node-built entry and to measure how fast the distance grows when the
reference is shifted or scaled. Baselines: `src/scanner/README.md`, "Artwork matching".

    node scripts/hash-bench.mjs                  # the three fixtures
    node scripts/hash-bench.mjs --no-refs        # offline: skip the reference-image checks
    node scripts/hash-bench.mjs --json           # raw records

## page-bench.mjs + page-bench.html

End-to-end binder-page benchmark: `scanPage` itself (Tesseract OCR + the magnified number strip +
artwork hashes + the Pokémon matcher) on the fixture photos, headless Chrome through the Vite dev
server like the other two. Per pocket it prints the candidate, whether it is the expected card (`✓`,
`≈` = expected among the alternatives, `✗`) and whether it was called confident (`YES` right,
`yes!` wrong); per photo and overall: exact, confident (right / wrong), expected among alternatives,
page time and the share spent hashing; also how long the hash table took to load and roughly how much
heap it holds. `--no-hash` is the OCR-only baseline. Tesseract runs in the page (WASM), so a run takes
a few minutes. Baselines: `src/scanner/README.md`, "Artwork matching".

    node scripts/page-bench.mjs                  # OCR + artwork (the shipped pipeline)
    node scripts/page-bench.mjs --no-hash        # OCR only
    node scripts/page-bench.mjs --no-strip       # without the number-strip re-read
    node scripts/page-bench.mjs --json

## emu.py

Headless Android emulator helper (Python 3, built-ins only; run with `python -I`). Finds adb and
the emulator in `ANDROID_HOME` / `%LOCALAPPDATA%\Android\Sdk`, targets `ANDROID_SERIAL` or the first
`emulator-*` device, and calls adb directly, so Git Bash's path mangling of `/sdcard/...` never bites.

    python -I scripts/emu.py start          # AVD "phidget" (CARDCODEX_AVD) headless: -no-window -no-audio -gpu swiftshader_indirect -camera-back emulated -camera-front emulated
    python -I scripts/emu.py wait-boot      # until sys.boot_completed, then wake + dismiss keyguard
    python -I scripts/emu.py devices
    python -I scripts/emu.py install release/CardCodex-<ver>-x86_64-release.apk   # adb install -r; uninstalls first on a signature mismatch
    python -I scripts/emu.py launch         # am start -W com.independent.cardcodex/.MainActivity
    python -I scripts/emu.py list           # visible texts / content-descs with bounds (uiautomator dump, sees the WebView's DOM text)
    python -I scripts/emu.py tap "Skip tour"
    python -I scripts/emu.py shot [out.png] # default scripts/.cache/emu/shot-<time>.png
    python -I scripts/emu.py logcat [--lines N] [--clear]   # the app's logcat by pid
    python -I scripts/emu.py dbsize         # WebView IndexedDB size via run-as — debug APKs only (the Play Store image has no adb root)
    python -I scripts/emu.py stop           # adb emu kill (falls back to taskkill after 40 s)

The emulator's own output goes to `scripts/.cache/emu/emulator.log`.

## Claude Code skills and agents

The workflows above are wrapped as project skills in `.claude/skills/` (`emulator-qa`,
`release-build`, `catalog-refresh`, `scanner-bench`) and two Sonnet-class subagents in
`.claude/agents/` (`emulator-qa`, `scanner-bench`); see the "Working with Claude Code" section of
the top-level README.
