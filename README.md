# CardCodex

A Pokédex-style collection tracker for the **Pokémon Trading Card Game** and the **Yu-Gi-Oh! Trading
Card Game**. Browse every English card ever printed with its artwork, keep track of exactly which ones
you own, hunt for the ones you're missing, and add cards by pointing your phone's camera at them.

CardCodex is a single web app (installable PWA) that is also packaged as a native **Android** app
with Capacitor. Your collection lives only on your device.

[![Build][gh-actions-badge]][gh-actions]

[gh-actions]: https://github.com/Dood345/CardCodex/actions
[gh-actions-badge]: https://github.com/Dood345/CardCodex/actions/workflows/android.yml/badge.svg

## What it does

- **Two games, one collection** – pick Pokémon or Yu-Gi-Oh! in Settings or from the pill in the
  browse and collection tabs. Each game has its own offline catalog, browse tab, card facts and
  scanner; your collection and backups hold both games' cards. (See *Yu-Gi-Oh! mode* below for what
  differs.)
- **Pokédex** – all 1,025 species with sprites and type colours. Species you own no cards of show as
  silhouettes, Pokédex-style. Filter by generation or collected/missing; tap a species for its
  official artwork and every card that features it (newest first) with owned counts.
- **Sets (binder view)** – every series and set from Base Set to the current releases, with set
  symbols, logos and completion bars. Open a set to see its cards in number order; cards you don't
  own are dimmed. **Quick add** mode turns every tile into a one-tap "+1" for fast inventory entry.
- **Search** – instant search across ~21k cards by name, set name, set code (`SVI`, `PAL`) or
  printed number (`057/198`), with filters for owned/missing/wanted, kind, energy type, rarity and
  series. Species matches appear as shortcuts to the Pokédex.
- **Card page** – large art, set, number, rarity, energy type, HP, stage, linked Pokédex entries,
  per-card copy count with optional variant breakdown (normal / holo / reverse / other), wishlist
  flag, free-text note, and every other printing of the same card.
- **Collection** – totals (cards, unique, species, sets, wanted), owned cards grouped by set, and a
  wishlist tab. Export / import a JSON backup from Settings.
- **Scan** – point the camera at one or more cards. On-device text recognition reads the card name,
  HP and the printed number/set code, matches them against the catalog, and draws a tappable chip over
  each detected card: tap to add it, or open the alternatives to correct a wrong guess. In front of a
  binder or a pile only the card under the middle of the frame gets a chip, and its picture is
  matched against the artwork table as well as its text, so two printings of one name do not trade
  places, and the box drawn around it follows the matched picture. A bar under the camera counts the
  cards added this session; tap it or pull it up for the list, with the copies added and the owned
  count to fix on the spot. "Scan a photo"
  runs the same pipeline on a picture from the camera app or gallery. Nothing is uploaded. On Android
  the scanner uses Google ML Kit on-device text recognition; in the browser (and as a fallback) it uses
  Tesseract.js with the English model bundled in `public/tessdata/`, so it works offline. The card
  should fill most of the frame: the printed number (bottom-left) is what pins down the exact printing;
  a name alone lists every printing in the alternatives.
- **Binder page mode** – switch the scanner to *Binder page*, pick the page layout (9-, 4-, 12- or
  16-pocket) and point the camera at the page: the grid finds the cards by itself (it turns green
  once it has locked on) and can be dragged or resized if it hasn't. The page is captured by itself
  once the grid holds steady for a moment (*Auto capture*, which can be turned off) or on a tap, and
  the grid is fitted again on the captured frame, so a hand that moved after the last fit costs
  nothing; a photo of the page from the gallery is shown with the fitted grid for a check first.
  Every pocket is cropped at full
  resolution and read on its own; the review grid then shows each pocket's crop beside its card with
  a copy counter, so pockets holding several copies in one sleeve get the right count, wrong guesses
  can be swapped from the alternatives (or any card searched for), and empty pockets are skipped.
  One tap adds the whole page; the grid can be adjusted and the same frame rescanned, and "Save
  capture" shares the frame with a report of what was read, for pages that scan badly. Each pocket
  is read with a margin, tightened to the card, and its number line read again magnified; on
  Android two frames are captured and their reads merged. "Capture page" takes a full-resolution
  photo through the camera's still pipeline (4032×3024 on a 12 MP phone) rather than copying the
  preview, so the small collector-number line is ~28 px tall instead of ~13 and pins the printing;
  the review header shows the captured size. While you aim, the guide tells you when a shot would
  not read — *Move closer*, *Flatten the phone*, *More light*, *Hold still* — and the capture
  button turns amber with the reason (it still captures).
  Each pocket's picture is also matched
  against a table of perceptual hashes of every card's artwork (OCR-independent), so a card whose
  small number line did not read is still identified by its picture, with the printings of that
  picture offered as alternatives when the number did not settle it.
- **Picks up where you left off** – leaving the Scan tab (to look something up) and coming back
  keeps the camera, the photo or the page review you had open; an interrupted page review even
  survives the app being killed. Live scanning shows a confidence bar that fills while successive
  frames agree on a card, lists the runners-up it is torn between so the right one is one tap away,
  and does not flip the chip on a single contrary frame.
- **Android back button** – closes whatever is on top first: a sheet or menu, then a photo being
  scanned, then the live camera (back to the mode choice), then a binder-page review (it stays
  resumable); only with nothing open does it go back a page, and at the first page it sends the app
  to the background instead of quitting.
- **Guided tour** – a short, skippable walk through the five tabs runs on first launch and can be
  replayed from Settings. Its wording follows the active game.

### Yu-Gi-Oh! mode

- **Archetypes** replaces the Pokédex: all ~665 archetypes with a cover artwork and how many of
  their distinct cards you own; an archetype lists its cards (newest printing shown, copies summed
  over printings) or every printing. Cards outside any archetype are reachable from Search and Sets.
- **Printings are the unit**: every catalog entry is one printed set code (`LOB-EN001`), so the
  Sets tab (grouped by release year, ~1,037 sets), binders and quantities all work per printing, and
  a card page lists the other printings of the same card.
- **Card facts**: card type, attribute, monster type / spell & trap property, Level/Rank/Link,
  ATK/DEF, archetype link, rarity and passcode. Search understands names, archetypes, monster types,
  set names, set codes and 8-digit passcodes; filters narrow by attribute, rarity and year.
- **Scanner**: the printed set code under the artwork names the exact printing and the 8-digit
  passcode at the bottom-left names the card; name, ATK/DEF and the type line are supporting
  evidence. One wrong OCR character in either code is tolerated and marked with `≈`. Binder page
  mode uses the smaller 59×86 mm card aspect for its grid.
- **Images** come from [YGOPRODeck](https://ygoprodeck.com), whose API guide forbids hotlinking.
  On Android every image is therefore downloaded once (through Capacitor's native HTTP bridge) and
  stored in the app's IndexedDB, bounded to ~8,000 images with least-recently-used eviction; in a
  browser the images cannot be read by script (no CORS), so the browser's own HTTP cache and the
  service worker do the same job. Settings → *Card images* can point the app at a self-hosted mirror
  of the `cards_small/` and `cards/` folders and shows/clears the stored images.

## Data

The card catalogs are prebuilt, offline snapshots in `public/data/`:

- `catalog.json` – every English Pokémon set and card from [TCGdex](https://tcgdex.dev) (id, set,
  number, name, kind, National Dex ids, energy types, rarity, HP, stage, image flag).
- `species.json` – the National Pokédex (name, generation, types) from PokéAPI's CSV data.
- `ygo/catalog.json` – every Yu-Gi-Oh! TCG card and printing from the
  [YGOPRODeck API](https://ygoprodeck.com/api-guide/) (two-level: cards by passcode with type,
  attribute, monster type, level, ATK/DEF, archetype; printings by set code with rarity). Expanded
  into the shared catalog shape at load time (`src/games/ygo/catalog.ts`).
- `hashes.json` – a 128-bit perceptual hash of every Pokémon card's reference image (19.7k cards,
  32 bytes each), the artwork-matching table the binder-page scanner compares pocket crops against
  (`src/scanner/hash.ts`). Built from the TCGdex images by `npm run hashes` (each image is downloaded
  once into `scripts/.cache/`).
- `ygo/hashes.json` – the same for Yu-Gi-Oh!, one hash per passcode (14.8k pictures: every card and
  its alternate artworks; printings share the picture, so the OCR'd set code still picks the
  printing), with the 59×86 card aspect and the Yu-Gi-Oh! artwork window. Built from the YGOPRODeck
  renders by `npm run hashes:ygo` (each render downloaded once into `scripts/.cache/`, never hotlinked).

Pokémon card images are served by TCGdex (`assets.tcgdex.net`), species sprites and artwork by the
PokéAPI sprites repository; Yu-Gi-Oh! images by YGOPRODeck, stored on the device after the first
view (see above). Rebuild a catalog to pick up new sets:

```bash
npm run catalog
```

```bash
npm run catalog:ygo
```

```bash
npm run hashes
```

```bash
npm run hashes:ygo
```

See [`scripts/README.md`](scripts/README.md) for details.

### How a rebuilt catalog reaches users

Both builders also write `public/data/manifest.json` (regenerate it on its own with
`npm run data:manifest`): the content hash, size and `builtAt` of every data file. The deployed web
app fetches that small file on every start with `cache: 'no-cache'` (one conditional request, a 304
when nothing changed) and then loads each catalog as `catalog.json?v=<hash>` with
`cache: 'force-cache'`. An unchanged catalog is served from the browser or service-worker cache
without a download; a rebuilt one has a new URL and is downloaded exactly once, by browsers, the
service worker and the host's CDN alike. The service worker (`public/sw.js`) keeps the manifest and
one version of each catalog so the app opens offline, and drops older versions when a new one is
stored (`src/data/manifest.ts`, `src/data/catalog.ts`).

So a refresh is: rebuild, commit the JSON **together with the manifest** (a test checks that they
match), deploy. Existing web users get the new sets on their next start, once the host's CDN has
let go of the old manifest (about 10 minutes on GitHub Pages). `npm run dev` always revalidates the
plain URLs, and the Android app reads the files bundled in the APK, so there a new APK is the update.

## Develop

Requires Node 22+.

```bash
npm install
npm run dev          # http://localhost:5173 (also reachable on your LAN for phone testing)
npm test             # vitest unit tests (search, collection, scanner parsing/matching)
npm run typecheck
npx vite build       # production build in dist/
```

### Project layout

```text
src/
├── data/        catalog loading + indexes, IndexedDB collection store (Dexie), search
├── scanner/     camera + OCR engines (Tesseract.js / ML Kit), card-number & name parsing, matching
├── pages/       Pokédex, Species, Sets, Set, Card, Search, Collection, Scan, Settings
├── ui/          hash router, shared components, SVG icons (nav + energy types)
└── app/         catalog context, local settings
public/data/     generated catalog (see scripts/)
scripts/         catalog builders, scanner benchmarks, emulator helper (see scripts/README.md)
android/         Capacitor Android project (generated, committed)
.claude/         Claude Code skills and agents for the recurring workflows (see below)
```

## Android

The Android app is the same web build wrapped by [Capacitor](https://capacitorjs.com). You need a
JDK 21 and the Android SDK (Android Studio installs both; its bundled JBR works as `JAVA_HOME`).

```bash
npm run android:sync       # vite build + copy web assets + plugins into android/
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-<abi>-debug.apk (arm64-v8a for phones,
#   x86_64 for the emulator) plus app-universal-debug.apk
adb install -r android/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
```

The build produces one APK per CPU architecture because ML Kit's native text-recognition
libraries are large (the universal APK is ~55 MB, the arm64 one ~25 MB).

Or open `android/` in Android Studio (`npm run android:open`) and run it on a device or emulator.
GitHub Actions builds the web app and a debug APK on every push; the APK is attached as a workflow
artifact.

### Release builds

Releases are signed with a keystore that is **not** in the repository. One-time setup (the key must
be kept and backed up; every future update has to be signed with the same key):

```bash
mkdir -p android/keystore
keytool -genkeypair -v -keystore android/keystore/cardcodex-release.jks -alias cardcodex   -keyalg RSA -keysize 2048 -validity 10000
```

Then create `android/keystore.properties` (gitignored):

```properties
storeFile=keystore/cardcodex-release.jks
storePassword=…
keyAlias=cardcodex
keyPassword=…
```

(CI can use the `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and
`ANDROID_KEY_PASSWORD` environment variables instead.) Bump the version in `package.json`
(`versionName` and `versionCode` derive from it), then:

```bash
npm run android:release
# → release/CardCodex-<version>-arm64-v8a-release.apk (+ armeabi-v7a, x86_64, universal)
```

`npm run android:debug` builds the debug-signed equivalents with the same names.

## Working with Claude Code

The repository ships project-level [Claude Code](https://claude.com/claude-code) skills and
subagents for the routine work, so a short brief is enough and the heavy lifting can run on a
cheaper model:

| skill (`.claude/skills/`) | what it does |
|---|---|
| `emulator-qa` | boots the headless emulator (AVD `phidget`), installs an APK, launches the app, taps through it by visible text, screenshots, reads logcat, measures IndexedDB, shuts down — all via `scripts/emu.py` |
| `release-build` | tests + typecheck with `pipefail`, `npm run android:release`, verifies a marker string in the APK's bundled JS, reports the APKs in `release/`; never touches signing files |
| `catalog-refresh` | `npm run catalog` / `npm run catalog:ygo`, the `scripts/.cache` rules, what the summaries must show, how to tell a real change from a `builtAt`-only diff |
| `scanner-bench` | `node scripts/scan-check.mjs` and `node scripts/grid-bench.mjs` with the recorded baselines |

Agents (`.claude/agents/`): `emulator-qa` and `scanner-bench` run on a Sonnet-class model with
Bash + read-only tools, preload their skill and report numbers, screenshots and log lines without
changing code. Ask for them by name ("use the emulator-qa agent to smoke-test
`release/CardCodex-1.1.1-x86_64-release.apk`") or invoke a skill with `/emulator-qa`, `/release-build`,
`/catalog-refresh`, `/scanner-bench`. The skills assume this Windows machine's toolchain (Android
SDK under `%LOCALAPPDATA%`, Chrome for the grid bench) and say what to do when something is missing.

## Credits and legal

Pokémon card data and images: [TCGdex](https://tcgdex.dev). Pokédex data and sprites:
[PokéAPI](https://pokeapi.co). Yu-Gi-Oh! card data and images: [YGOPRODeck](https://ygoprodeck.com).
Pokémon and Pokémon character names are trademarks of Nintendo, Creatures Inc. and GAME FREAK; Pokémon
card images are © The Pokémon Company. Yu-Gi-Oh! is a trademark of Konami; Yu-Gi-Oh! card images and
text are © Konami Digital Entertainment / 4K Media. CardCodex is an independent fan project and is not
affiliated with or endorsed by any of them.

Licensed under GPL-3.0 – see [LICENSE](LICENSE).
