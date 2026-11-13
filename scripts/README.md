# scripts/

## build-catalog.mjs

Builds the offline catalog shipped with the app:

- `public/data/catalog.json` (`Catalog` in `src/data/types.ts`): all English TCGdex sets and cards.
- `public/data/species.json` (`SpeciesFile`): National Pokedex species 1..1025.

Sources: TCGdex GraphQL (bulk cards) and REST (set details), PokeAPI CSV dumps on GitHub (species, names, types).
The `tcgp` series (Pokemon TCG Pocket) and sets with zero cards are excluded.
Set `logo`/`symbol` flags are only true when the `.webp` URL under `https://assets.tcgdex.net/en/{series}/{set}/` was verified with HEAD.

A card's picture (`img`) is settled in three steps: the TCGdex feed's `image` field; for the cards it leaves
blank, a HEAD of the file on TCGdex's CDN at the card's own path and under the parent set's (answers kept
for a week in `scripts/.cache/image-probe.json`); and for the cards still without one, Scrydex
(`scrydex-images.mjs`, below).

Run (Node 18+, built-ins only):

    node scripts/build-catalog.mjs             # uses scripts/.cache for raw downloads ($CARDCODEX_CACHE_DIR when set)
    node scripts/build-catalog.mjs --no-cache  # re-download everything

The script validates (unique ids, set references, dex range, species sanity) and fails loudly on violations.
The generated `public/data/*.json` are build artifacts but are committed to git.
Expected sizes: catalog.json ~3.4 MB (~377 KB gzip), species.json ~61 KB (~11 KB gzip).

## scrydex-images.mjs

Pictures for the Pokémon cards TCGdex has none of, from [Scrydex](https://scrydex.com), used with their
written permission (`docs/scrydex-permission.md`). `build-catalog.mjs` calls it; on its own it prints what a
build would do with the catalog on disk:

    node scripts/scrydex-images.mjs            # coverage per set, what Scrydex lacks, name mismatches

Scrydex asks never to assume image URLs and its ids differ from TCGdex's (`me06` is `me6`, the McDonald's
sets are `mcd21`, the Trainer Kits `tk4a`…), so the ids, card names and image URLs are read from Scrydex's
public expansion pages (`scrydex.com/pokemon/expansions/<slug>/<id>`). A set is paired with an expansion by
id, by name or by the alias table at the top of the file; a card with the expansion's card of the same
number **only when the names agree**, or by name alone where the two sources number a set differently and
the name occurs once on both sides (the two Classic Collections). An id without a picture answers with HTTP
200 and a card back, so the small picture is downloaded and compared with that placeholder; the file lands
in `scripts/.cache/images/pokemon/<card id>.webp`, where `build-hashes.mjs` finds it (one download for both
builds; the bytes are PNG whatever the name says). The card then gets `img: "<Scrydex's base URL>"`.

Requests are paced at four per second and cached under `scripts/.cache/scrydex/` (expansion pages for a week,
pictures for good): a first run makes about 1,400 requests (six minutes), a rerun inside the week none. The
build fails if Scrydex cannot be reached, rather than write a catalog that silently lost these pictures and
their scanner hashes. Today 1,335 of the 1,390 cards TCGdex lacks get a picture this way; the 55 others
(My First Battle, eight Aquapolis variants, the Yellow A alternates and a few promos) keep the card back.
After a catalog build that changes pictures, run `npm run hashes`, `npm run energy-refs` and `npm run labels`.

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

## build-mtg-catalog.mjs

Builds `public/data/mtg/catalog.json` (`MtgCatalogFile` in `src/games/mtg/catalog.ts`): every English paper
Magic: The Gathering printing from Scryfall. Two API requests (`/bulk-data`, `/sets`) with a descriptive
`User-Agent` and `Accept: application/json` and 150 ms between them, as Scryfall's API guidelines ask; the
`default_cards` bulk file (~80 MB of gzipped JSON Lines, named by `/bulk-data`) comes from
`data.scryfall.io`. All three are cached in `scripts/.cache/mtg/`; a newer bulk file replaces the older one.
The file is streamed line by line, so the ~500 MB of JSON never sits in memory as one string. The mapping
itself (`buildMtgCatalog` in `src/games/mtg/scryfall.ts`, tested in `src/games/mtg/catalog.test.ts`) is
TypeScript that Node runs directly through type stripping.

- Left out: non-English and digital-only cards, token / memorabilia / minigame / Alchemy sets, token,
  emblem and art-series layouts, and oversized cards (planes, schemes, Vanguard, oversized commanders).
  The summary line counts each reason.
- `sets`: lowercase Scryfall code as id, name and release date from `/sets` (a set only the cards name is
  synthesized from them), the number of kept printings as total; oldest first.
- `cards`: one per Oracle id, sorted by name: name, type line, mana cost, mana value, colors (WUBRG
  letters), power/toughness, loyalty, defense. Double-faced cards take cost, colors and stats from the
  front face; reversible cards (the same card on both sides) are named once.
- `artists`: the artist names, sorted; printings point at them.
- `printings`: `[card, set, collector number, rarity letter, Scryfall id, artist]`, by set then collector
  number. The app shows `https://cards.scryfall.io/{grid|display}/front/<a>/<b>/<id>.webp`.

Oracle text is not kept: it would take the file from 11.4 MB to 17.5 MB (4.3 → 5.8 MB gzipped).

    node scripts/build-mtg-catalog.mjs             # uses scripts/.cache/mtg
    node scripts/build-mtg-catalog.mjs --no-cache  # re-fetch /bulk-data and /sets (and a newer bulk file)

Expected size: ~11.4 MB (~4.3 MB gzip) for ~34.2k cards, ~98.4k printings and 626 sets.

The builders reuse the raw downloads in `scripts/.cache/` (gitignored); pass `--no-cache` (as
`npm run catalog -- --no-cache`) to pick up new sets. `builtAt` changes on every run: when it is the
only diff, `git checkout -- public/data` instead of committing (that restores the manifest below too).

## data-manifest.mjs

Writes `public/data/manifest.json`: for each of `catalog.json`, `species.json`, `ygo/catalog.json`,
`hashes.json` and `ygo/hashes.json` the first 12 hex digits of its SHA-256 (`hash`), its size (`bytes`)
and its `builtAt`. The catalog builders and `build-hashes.mjs` call it after writing their files; the deployed web app fetches it with `no-cache` on every start and
requests the catalogs as `catalog.json?v=<hash>` with `force-cache`, so a rebuilt catalog is a new URL
(downloaded once) and an unchanged one never is (see `src/data/manifest.ts`). It has no timestamp of
its own, so regenerating it without data changes produces no diff.

    node scripts/data-manifest.mjs           # = npm run data:manifest; regenerate from public/data
    node scripts/data-manifest.mjs --check   # exit 1 when the manifest does not match the files

`src/data/manifest.test.ts` runs the same check in the test suite.

## build-hashes.mjs

Builds a game's artwork hash table (`HashFile` in `src/scanner/hash.ts`): one 128-bit perceptual hash
per card image, the artwork-matching table the binder-page scanner uses beside OCR.

- **Pokémon** (`npm run hashes`) → `public/data/hashes.json`, keyed by card id. Every card with an image
  has its low-resolution TCGdex image (~245×337 WebP, ~16 KB) downloaded **once** into
  `scripts/.cache/images/pokemon/<id>.webp` (`$CARDCODEX_CACHE_DIR/images/pokemon/` when set). The cards
  whose picture comes from Scrydex use its small size (~245×342 PNG, ~45 KB), normally cached already by
  the catalog build; a card back sent in place of a picture is recognised and counted as missing.
- **Yu-Gi-Oh!** (`npm run hashes:ygo`, i.e. `--game ygo`) → `public/data/ygo/hashes.json`, keyed by
  **passcode**: every printing of a card shares the picture, and an alternate artwork is its own passcode
  (and entry). Every card's YGOPRODeck small render (`cards_small/<passcode>.jpg`, 268×391, ~28 KB) is
  downloaded once into `images/ygo/<passcode>.jpg`, as their guide asks (fetched once and stored, never
  hotlinked); the renders are replicas without set code or passcode printed, which the picture does not
  need.

Both are hashed with the app's own `hashCard` (loaded through Vite, so Node and the browser run one
implementation; a reference image hashed in the browser matches its table entry bit for bit) and the
game's `HashSpec` (card aspect and artwork window; a Yu-Gi-Oh! table never changes a Pokémon hash).
Downloads are limited to 10 requests/s (`--rate`), 4 in flight (`--concurrency`), retried with backoff;
404s are remembered as `<file>.404`. Reruns skip everything cached and re-hash in a minute or two, so a
changed hash spec never re-downloads, and an interrupted build resumes (the output is also rewritten
every 2,000 cards).

    npm run hashes                                   # Pokémon: ≈ 40 min for a cold cache (21.4k images, 10/s)
    npm run hashes:ygo                               # Yu-Gi-Oh!: ≈ 25 min for a cold cache (14.8k renders, 10/s)
    node scripts/build-hashes.mjs --first sv03.5,xy12  # these sets first (for early checks); --game ygo --first effect_pendulum: these frames first
    node scripts/build-hashes.mjs --limit 50           # smoke test

The summary reports coverage (hashed / with image / catalog), download counts, image sizes and the file
size. Expected: Pokémon ~21.4k hashes (99.7 % of the catalog; the rest have no image on TCGdex or Scrydex),
~690 KB raw (32 bytes per card), ~383 KB gzip; Yu-Gi-Oh! 14,825 hashes (14,653 cards + 172 alternate artworks,
100 %), ~530 KB raw, ~310 KB gzip. `builtAt` changes on every run: when it is the only diff,
`git checkout -- public/data`. `scripts/fixtures/cards/` keeps two of the Pokémon reference images for
`src/scanner/hash.test.ts`, which checks that hashing them reproduces their table entries; the Yu-Gi-Oh!
check uses the cached render of Dark Magician when it is present (no render is committed). Both tables
feed `scripts/hash-separation.mjs` and the benches below; see `src/scanner/README.md`, "Artwork matching".

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

## guidance-bench.html

Calibration page for the binder-page capture guidance (`src/scanner/guidance.ts`): with the dev
server running, `http://localhost:5173/scripts/guidance-bench.html` fits the grid on each fixture
photo (normalised to a 4032 px long side, like a 12 MP capture), runs `measureGuidance` on it and
prints the card width, the aspect and keystone ratios, the sharpness score, the brightness and the
advice. Query parameters make variants: `blur=0,1,1.5,2` (Gaussian radii in px of the normalised
photo), `scale=0.3`, `warp=0.1` (keystone, bottom edge nearer), `dark=0.2`; `ocr=1` also reads the
nine pockets with Tesseract at every level and counts number-line reads and exact ids (~20–30 s per
level). The threshold numbers quoted in `src/scanner/README.md` ("Capture guidance") come from
this page. Results are in `window.__guidanceBench`; `report=<path>` POSTs them.

## hash-bench.mjs + hash-bench.html

Artwork-hash benchmark: for every pocket of a binder page, how close the pocket's hash
(`src/scanner/hash.ts`) comes to the expected card's entry in the game's hash table and whether that
entry is the nearest, run the way the app runs it (headless Chrome through the Vite dev server, like
grid-bench). Pokémon runs on the three fixture photos; Yu-Gi-Oh! (`--game ygo`), which has no real
photos yet, on the synthetic page `synth-page.mjs` composes from the cached renders (made on first use;
pass your own photo with a `.json` sidecar of `ids` for a real one). Per pocket the card is placed
five ways — the grid cell as is, the card box the fitter measured, the padded crop tightened to the
card's edges (`refineCardBox`), the coarse alignment search alone and the coarse-to-fine search the
scanner uses (`matchPocket`) — with the table's own card aspect and artwork window, and the summary
counts, per placement, exact hits, same-name hits (Pokémon: another printing of the same picture,
which no artwork hash can separate; Yu-Gi-Oh!: an alternate artwork of the same card) and the median
Hamming margin to the next different name / to the next entry. The reference images of the expected
cards are also hashed in the browser (TCGdex allows CORS; the YGOPRODeck renders are served from the
cache by Vite, as `images.ygoprodeck.com` sends no CORS headers) to check that the browser's hash
equals the Node-built entry and to measure how fast the distance grows when the reference is shifted
or scaled. Baselines: `src/scanner/README.md`, "Artwork matching".

    node scripts/hash-bench.mjs                  # Pokémon, the three fixtures
    node scripts/hash-bench.mjs --game ygo       # Yu-Gi-Oh!, the synthetic 3×3 page
    node scripts/hash-bench.mjs --no-refs        # offline: skip the reference-image checks
    node scripts/hash-bench.mjs --json           # raw records

## page-bench.mjs + page-bench.html

End-to-end binder-page benchmark: `scanPage` itself (Tesseract OCR + the magnified number strip +
artwork hashes + the game's matcher) on binder pages, headless Chrome through the Vite dev server
like the other two; Pokémon on the fixture photos, Yu-Gi-Oh! (`--game ygo`) on the synthetic page,
where the expected ids are passcodes and any printing of one counts (a render carries no set code).
Per pocket it prints the candidate, whether it is the expected card (`✓`, `≈` = expected among the
alternatives, `✗`) and whether it was called confident (`YES` right, `yes!` wrong); per photo and
overall: exact, confident (right / wrong), expected among alternatives, page time and the share spent
hashing; also how long the hash table took to load and roughly how much heap it holds. `--no-hash` is
the OCR-only baseline. Tesseract runs in the page (WASM), so a run takes a few minutes. Baselines:
`src/scanner/README.md`, "Artwork matching".

    node scripts/page-bench.mjs                  # OCR + artwork (the shipped pipeline)
    node scripts/page-bench.mjs --game ygo       # Yu-Gi-Oh! on the synthetic page
    node scripts/page-bench.mjs --no-hash        # OCR only
    node scripts/page-bench.mjs --no-strip       # without the number-strip re-read
    node scripts/page-bench.mjs --json

## synth-page.mjs

Synthetic binder page for the benches above while real photos are scarce: `cols × rows` cached
reference images (Yu-Gi-Oh! renders from `images/ygo/`, Pokémon `low.webp` files from `images/pokemon/`)
pasted on an off-white page with faint pocket seams, each with a seeded random shift (±2 % of the cell),
scale (94–100 % of the card), Gaussian blur (0–1.2 px) and brightness (×0.9–1.05), a lighting gradient
across the page and JPEG 85; a `.json` sidecar lists the `ids` row-major and every card's parameters.
Written to `scripts/.cache/synth-pages/<game>-<layout>.jpg` (gitignored, like the renders it is made of).
The default Yu-Gi-Oh! set mixes frames: effect, normal, link, xyz, spell, trap, effect pendulum,
synchro and an alternate artwork. Exported as `synthPage(opts)` for the benches.

    node scripts/synth-page.mjs --game ygo                       # the default nine cards
    node scripts/synth-page.mjs --game ygo --ids 46986414,…       # your own nine passcodes (row-major)
    node scripts/synth-page.mjs --game ygo --seed 2 --shift 0.03 --scale 0.08 --blur 2 --out page.jpg

## hash-separation.mjs

How well a hash table separates its own entries, in Node without a browser: for every entry the
Hamming distance to its nearest and second-nearest other entry (all pairs, brute force; ~2 s for 20k
entries), their distribution (percentiles, a histogram, how many entries have a neighbour within 8 … 32
bits) and the pairs that collide within the scanner's match limit (24 bits), split into pairs that share
a name or card (reprints, alternate artworks: expected) and pairs between different cards (pictures the
scanner cannot tell apart). The numbers quoted in `src/scanner/README.md` come from here.

    node scripts/hash-separation.mjs                 # Pokémon
    node scripts/hash-separation.mjs --game ygo      # Yu-Gi-Oh!
    node scripts/hash-separation.mjs --game ygo --limit 16 --show 50 [--json]

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

## Printed labels (`npm run labels`)

Card text speaks of "Future Pokémon", "a Single Strike Pokémon", "Tera Pokémon in play". Those are
labels printed on the cards, and TCGdex has no field for any of them (its card object was checked; see
`docs/deck-playtest.md`). `scripts/build-labels.mjs` reads six of them off the card pictures: Single
Strike, Rapid Strike, Fusion Strike (Sword & Shield), Ancient, Future and Tera (Scarlet & Violet on).

- **How.** Each label is a badge drawn at a fixed place under the name bar. A template of the badge is
  cut from one exemplar card and matched, by normalised correlation over the three colour channels, around
  that place on every card of the series that can carry it. It uses the small pictures `npm run hashes`
  already keeps (`scripts/.cache/images/pokemon/`, 245 × 337), so it downloads nothing; about six minutes
  for 8,800 pictures.
- **Why not a text reader.** Tried first: Tesseract on the top band of the large picture read "Ancient",
  "Future" and the Tera rule sentence, and missed every Single Strike and Rapid Strike ribbon. The badges
  are drawings, so matching the drawing fits; a stronger reader (PP-OCRv5 through ONNX) would have added
  a model and a dependency for a job the pictures do themselves.
- **How sure.** A card with the badge matches at 0.63 to 0.99, the best card without one at 0.53; the
  line is 0.58, and matches between 0.50 and 0.58 are listed by the run for a look (three on 2026-11-12,
  none of them a labelled card). The counts for the two promo sets and the 2024 McDonald's set equal the
  totals Scrydex's public expansion pages show for these labels (all seven: Single Strike 12, Rapid
  Strike 14, Fusion Strike 6; Tera 10, Future 9, Ancient 9; Ancient 1), every card whose name starts with
  a Strike label was read with it, and the twelve weakest matches of each label were looked at.
- **What it found.** 653 labels: Single Strike 146, Rapid Strike 159, Fusion Strike 53, Ancient 74,
  Future 70, Tera 151. A card can carry several: Deoxys of Fusion Strike has all three Strike badges.
- **Printings of one card share the label** (same name and same text, in the label's series), which
  covers a print whose artwork hides the badge and the cards without a picture.
- **Only what is new.** The record keeps, per set, how many cards and pictures the set had when it was
  read (`read`) and what the reading was made with (`method`: templates, threshold, search window). A
  run reads the sets whose numbers changed and takes the others from the record: after a new set, that
  set alone; with nothing new, nothing (about a second). `--all` reads everything again.
- **Where it goes.** `scripts/card-labels.json` is the record of the reading (ids per label, committed);
  the labels are put into `public/data/text.json` (`lb`), by this script and again by `npm run text`,
  which rebuilds that file from TCGdex. `npm run labels -- --report` reads and reports without writing;
  `--sets swsh5,sv04` reads a few sets only.
- **Not read:** Ultra Beast, Team Plasma, Delta Species and other older groups, which are printed as
  text or frames, not as these badges.

