# CardCodex

A Pokédex-style collection tracker for the **Pokémon Trading Card Game**, the **Yu-Gi-Oh! Trading
Card Game** and **Magic: The Gathering**. Browse every English card ever printed with its artwork, keep track of exactly which ones
you own, hunt for the ones you're missing, and add cards by pointing your phone's camera at them.

CardCodex is a single web app (installable PWA) that is also packaged as a native **Android** app
with Capacitor. Your collection lives only on your device.

[![Build][gh-actions-badge]][gh-actions]

[gh-actions]: https://github.com/Dood345/CardCodex/actions
[gh-actions-badge]: https://github.com/Dood345/CardCodex/actions/workflows/android.yml/badge.svg

## What it does

- **Three games, one collection** – pick Pokémon, Yu-Gi-Oh! or Magic in Settings or from the pill in
  the browse and collection tabs. Each game has its own offline catalog, browse tab, card facts and
  scanner; your collection and backups hold every game's cards. (See *Yu-Gi-Oh! mode* and *Magic
  mode* below for what differs.)
- **Pokédex** – all 1,025 species with sprites and type colours. Species you own no cards of show as
  silhouettes, Pokédex-style. Filter by generation or collected/missing, and sort by number, by
  name or with the species you own most cards of first; tap a species for its
  official artwork and every card that features it (newest first) with owned counts. Trainer and
  Energy cards, which have no species, get their own toggles in the same row: one entry per card
  name with its owned count, letters on the quick scroll, and a tap opens every printing of that
  name with the same collected/missing filter.
- **Sets (binder view)** – every series and set from Base Set to the current releases, with set
  symbols, logos and completion bars. Open a set to see its cards in number order, A–Z or with the
  ones you own most copies of first; cards you don't own are dimmed. **Quick add** mode turns every tile into a one-tap "+1" for fast inventory entry.
- **Search** – instant search across ~21k cards by name, set name, set code (`SVI`, `PAL`) or
  printed number (`057/198`), with filters for owned/missing/wanted, kind, energy type, rarity and
  series. Species matches appear as shortcuts to the Pokédex.
- **Card page** – large art, set, number, rarity, energy type, HP, stage, linked Pokédex entries,
  per-card copy count with optional variant breakdown (normal / holo / reverse / other), wishlist
  flag, free-text note, and every other printing of the same card.
- **Collection** – totals (cards, unique, species, sets, wanted), owned cards grouped by set, and a
  wishlist tab. Export / import a JSON backup of your cards and decks from Settings (on Android the
  export lands in the Downloads folder).
- **Scan** – frame one card and tap the shutter: a full-resolution photo is read on the device (the
  card name, HP and the printed number/set code against the catalog, and the picture against the
  artwork table) and the best match is listed with its alternatives, each one tap to add; the next
  card is one shutter away. *Live* mode instead reads cards as you hold them up and draws a tappable
  chip over each one: tap to add it, or open the alternatives to correct a wrong guess. In front of a
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
  capture" saves the frame and a report of what was read (to Downloads on Android), for pages that scan badly. Each pocket
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
- **Back lands where you were** – coming back to a list (Android back or the browser's) puts the
  tile you left at the top of the screen again, with the filters you had on; only a page reached
  afresh starts at the top.
- **Quick scroll** – long lists (the Pokédex, the archetypes, the sets) have a strip down the right
  edge: drag it to move through the whole list, with Pokédex hundreds, letters, or the series and
  years of the sets along it, and a bubble naming what is under your finger.
- **Binder view** – the Collection tab can show your cards (or your wishlist) as a binder: pages of
  9 or 12 pockets, set by set in number order, turned with a swipe, the arrows, the slider or the
  arrow keys. Empty pockets on the last page show where the next cards go, and opening a card and
  coming back lands on the same page.
- **Decks** – Collection → Decks holds deck lists for either game, made of cards you own and cards
  you are still after. Add cards from a search box on the deck, from "From my binder" (a tall sheet
  over your owned cards, or your wishlist, set by set like the binder, with a name search, a set
  filter and a stepper on every card) or from any card's "Add to deck"; every line shows how many
  copies you own and how many are missing, and one tap puts every missing card on your wishlist.
  A copy you own counts for one deck: a deck counts what your older decks left over and says where
  the rest are ("own 3 · 2 in Fire deck · 1 missing"). Settings turns that off if you move cards
  between decks.
  Each game's deck rules show as reminders, never enforced: a Pokémon deck has 60 cards and four
  copies of a card at most (basic Energy is unlimited); a Yu-Gi-Oh! deck is split into Main, Extra
  and Side (see below); a Magic deck has 60 cards or more and a sideboard of up to 15, or follows
  Commander rules (100 cards, one of each) when you switch the deck to them. "Share" sends the deck through the Android share sheet (Messenger, Quick
  Share, mail…) as a small `.ccdeck` file that opens in a friend's CardCodex when they tap it, or as
  a plain message: the list in words plus a short `CCD1.` code and a `cardcodex://deck/` link to
  paste into Decks → Import (which opens a deck file too). Either way the friend gets the deck with
  their own owned/missing counts. No server is involved, and decks ride along in the Settings
  backup. Under your decks, Yu-Gi-Oh! mode lists every Structure Deck and Starter Deck, ranked by
  how much of each your collection already covers (the three closest are marked); tap one to see
  what you own and what is missing and "Keep this deck" to copy it into your own. Their card lists
  come from YGOPRODeck (`npm run decks:ygo`, one copy per printed card); Pokémon has no starter
  decks yet, because TCGdex carries no deck lists and the official product pages cannot be
  fetched by a build script.
- **Deck check** – every deck page has a "Deck check" that scores the deck out of 100, part by part
  with a one-line finding each (for Pokémon: deck rules including ACE SPEC and Radiant limits, Basics
  for the opening hand, evolution lines, Energy, draw and search, power, synergy, focus, era), and
  says what to do next: cards to add while the deck is short, swaps once it is full, each with its
  reason and one tap to apply. You choose where suggestions come from ("Prefer my cards", "Only my
  cards", "Any card") and the format. A full Pokémon deck is also played 400 practice games by a
  simple test pilot ("attacks by turn 3 in 45% of games"), "Find a swap by playing" looks for a swap
  that plays better, and "Practice hand" deals an opening hand you can draw from. Yu-Gi-Oh! (TCG
  Forbidden & Limited list or none) and Magic (Standard to Vintage, 60-card decks) have their own
  parts; see `docs/deck-recommender.md`. The score reads the cards' own rules text. It knows nothing
  about tournament results.
- **Build a deck** – Decks → "Build one for me": pick one to three cards to build around, or take
  an idea, and the app grows a full deck from them (60 cards for Pokémon and Magic; a 40-card Main
  Deck and an Extra Deck it can make for Yu-Gi-Oh!). The result shows its score, how much of it
  you own and how it came together. For Pokémon, "Tune by playing" improves it swap by swap by
  playing it. "Keep this deck" saves it; "Build another" tries again without the last attempt's
  cards.
- **Guided tour** – a short, skippable walk through the tabs runs on first launch and can be
  replayed from Settings. Its wording follows the active game.

What comes next (Pokémon starter decks, the Magic scanner) is in [ROADMAP.md](ROADMAP.md).

### Yu-Gi-Oh! mode

- **Archetypes** replaces the Pokédex: all ~665 archetypes with a cover artwork and how many of
  their distinct cards you own, sorted A–Z, largest first or most owned first; an archetype lists its cards (newest printing shown, copies summed
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
- **Decks** have Main (40–60 cards, by Monster / Spell / Trap), Extra (Fusion, Synchro, Xyz and
  Link monsters, up to 15, sorted there from the catalog's frame type) and Side (up to 15) sections,
  with their counts in the header. A "To Side" button on each line moves a copy into the Side deck
  and back. Three copies of a card at most, counted by name over every printing and section; a
  fourth shows a reminder. Side cards travel in shared decks and deck files; an older CardCodex
  opening such a deck puts them in the deck proper.
- **Images** come from [YGOPRODeck](https://ygoprodeck.com), whose API guide forbids hotlinking.
  On Android every image is therefore downloaded once (through Capacitor's native HTTP bridge) and
  stored in the app's IndexedDB, bounded to ~8,000 images with least-recently-used eviction; in a
  browser the images cannot be read by script (no CORS), so the browser's own HTTP cache and the
  service worker do the same job. Settings → *Card images* can point the app at a self-hosted mirror
  of the `cards_small/` and `cards/` folders and shows/clears the stored images.

### Magic mode

- **Sets is the browse tab** (four tabs instead of five): 626 English paper sets from Alpha to the
  newest previews, grouped by release year, each with its binder and completion bar.
- **Printings are the unit**, as for Yu-Gi-Oh!: every catalog entry is one set + collector number
  (id `mtg:lea-161`; numbers may carry letters or `★`), about 98k printings of 34k distinct cards.
  The Scryfall Oracle id ties the printings of a card together: a card page lists its other
  printings, and the collection counts distinct cards by it. Tokens, art cards, gold-bordered
  replicas, oversized cards (planes, schemes) and digital-only cards are left out.
- **Card facts**: type line, mana cost, mana value, color, power/toughness, loyalty or defense,
  rarity, artist and the number of printings. Search understands names (either face of a
  double-faced card), type lines (`goblin`, `equipment`), set names, set codes with collector numbers
  (`LEA 161`) and artists; filters narrow by card type, color, rarity and year. Oracle text is not
  in the catalog (it would add 6 MB); the card image carries it.
- **Images** come from [Scryfall](https://scryfall.com)'s image CDN (`cards.scryfall.io`, the
  `grid` and `display` WebP formats), cached by the browser and the service worker. As Scryfall's
  image guidelines ask, card images are shown whole: the quantity badge sits top-right, clear of the
  copyright line, and unowned cards in a set are faded rather than greyed.
- **Scanner**: basic for now. A placeholder matcher (`src/games/mtg/match.ts`) reads the card name
  and the set code and collector number at the bottom-left of one card; there is no artwork hash
  table yet, so binder-page scanning only has OCR to go on.

## Data

The card catalogs are prebuilt, offline snapshots in `public/data/`:

- `catalog.json` – every English Pokémon set and card from [TCGdex](https://tcgdex.dev) (id, set,
  number, name, kind, National Dex ids, energy types, rarity, HP, stage, image flag).
- `species.json` – the National Pokédex (name, generation, types) from PokéAPI's CSV data.
- `ygo/catalog.json` – every Yu-Gi-Oh! TCG card and printing from the
  [YGOPRODeck API](https://ygoprodeck.com/api-guide/) (two-level: cards by passcode with type,
  attribute, monster type, level, ATK/DEF, archetype; printings by set code with rarity). Expanded
  into the shared catalog shape at load time (`src/games/ygo/catalog.ts`).
- `mtg/catalog.json` – every English paper Magic: The Gathering printing from
  [Scryfall's bulk data](https://scryfall.com/docs/api/bulk-data) (`default_cards`; 11.4 MB, 4.3 MB
  gzipped). Two-level like the Yu-Gi-Oh! file: cards by Oracle id with type line, mana cost, mana
  value, colors, power/toughness, loyalty, defense; printings by set and collector number with
  rarity, Scryfall id (which names the image) and artist. Expanded at load time
  (`src/games/mtg/catalog.ts`).
- `text.json`, `ygo/text.json`, `mtg/text.json` – the cards' rules text and what goes with it
  (attacks and legality for Pokémon from TCGdex; effect text and the TCG Forbidden & Limited list
  from YGOPRODeck; Oracle text, keywords, produced mana and format legality from Scryfall), 0.8 to
  1.4 MB gzipped each. Only the deck check and the deck builder load them, on first use
  (`npm run text`, `text:ygo`, `text:mtg`).
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
view (see above); Magic images by Scryfall. Rebuild a catalog to pick up new sets:

```bash
npm run catalog
```

```bash
npm run catalog:ygo
```

```bash
npm run catalog:mtg
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
Magic: The Gathering card data and images: [Scryfall](https://scryfall.com); CardCodex is not
produced by or endorsed by Scryfall.
Pokémon and Pokémon character names are trademarks of Nintendo, Creatures Inc. and GAME FREAK; Pokémon
card images are © The Pokémon Company. Yu-Gi-Oh! is a trademark of Konami; Yu-Gi-Oh! card images and
text are © Konami Digital Entertainment / 4K Media. CardCodex is an independent fan project and is not
affiliated with or endorsed by any of them.

CardCodex is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by
Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast
LLC.

Licensed under GPL-3.0 – see [LICENSE](LICENSE).
