# CardCodex

A Pokédex-style collection tracker for the **Pokémon Trading Card Game**. Browse every English card
ever printed with its artwork, keep track of exactly which ones you own, hunt for the ones you're
missing, and add cards by pointing your phone's camera at them.

CardCodex is a single web app (installable PWA) that is also packaged as a native **Android** app
with Capacitor. Your collection lives only on your device.

[![Build][gh-actions-badge]][gh-actions]

[gh-actions]: https://github.com/Dood345/CardCodex/actions
[gh-actions-badge]: https://github.com/Dood345/CardCodex/actions/workflows/android.yml/badge.svg

## What it does

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
  each detected card: tap to add it, or open the alternatives to correct a wrong guess. "Scan a photo"
  runs the same pipeline on a picture from the camera app or gallery. Nothing is uploaded. On Android
  the scanner uses Google ML Kit on-device text recognition; in the browser (and as a fallback) it uses
  Tesseract.js with the English model bundled in `public/tessdata/`, so it works offline. The card
  should fill most of the frame: the printed number (bottom-left) is what pins down the exact printing;
  a name alone lists every printing in the alternatives.
- **Binder page mode** – switch the scanner to *Binder page*, pick the page layout (9-, 4-, 12- or
  16-pocket), line the page up with the on-screen grid and capture it (or scan a photo of the page).
  Every pocket is cropped at full resolution and read on its own; the review grid then shows each
  pocket's card with a copy counter, so pockets holding several copies in one sleeve get the right
  count, wrong guesses can be swapped from the alternatives, and empty pockets are skipped. One tap
  adds the whole page.
- **Guided tour** – a short, skippable walk through the five tabs runs on first launch and can be
  replayed from Settings.

## Data

The card catalog is a prebuilt, offline snapshot in `public/data/`:

- `catalog.json` – every English set and card from [TCGdex](https://tcgdex.dev) (id, set, number,
  name, kind, National Dex ids, energy types, rarity, HP, stage, image flag).
- `species.json` – the National Pokédex (name, generation, types) from PokéAPI's CSV data.

Card images are served by TCGdex (`assets.tcgdex.net`), species sprites and artwork by the PokéAPI
sprites repository. Rebuild the catalog to pick up new sets:

```bash
npm run catalog
```

See [`scripts/README.md`](scripts/README.md) for details.

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
scripts/         catalog builder, scanner check script
android/         Capacitor Android project (generated, committed)
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

## Credits and legal

Card data and images: [TCGdex](https://tcgdex.dev). Pokédex data and sprites:
[PokéAPI](https://pokeapi.co). Pokémon and Pokémon character names are trademarks of Nintendo,
Creatures Inc. and GAME FREAK; card images are © The Pokémon Company. CardCodex is an independent
fan project and is not affiliated with or endorsed by any of them.

Licensed under GPL-3.0 – see [LICENSE](LICENSE).
