---
name: catalog-refresh
description: Rebuild CardCodex's offline card catalogs — `npm run catalog` (public/data/catalog.json + species.json from TCGdex and PokéAPI) and `npm run catalog:ygo` (public/data/ygo/catalog.json from YGOPRODeck) — including when the scripts/.cache downloads must be bypassed to pick up new sets, what the summary output must show, and how to check the result before committing. Use for "refresh/rebuild/update the catalog", "pick up the new set", "new cards are missing", "catalog is out of date", "regenerate public/data".
---

# Catalog refresh

Two builders, Node 22+, built-ins only, run from the repo root (details: `scripts/README.md`):

| command | writes | sources |
|---|---|---|
| `npm run catalog` | `public/data/catalog.json` (~3.4 MB, all English Pokémon sets and cards), `public/data/species.json` (~61 KB, species 1–1025) | TCGdex GraphQL (bulk cards) + REST (per-set details), PokéAPI CSVs on GitHub; pictures TCGdex lacks from Scrydex's public expansion pages and image host (with their permission, `docs/scrydex-permission.md`) |
| `npm run hashes` (after a `npm run catalog` that changed pictures; then `npm run energy-refs`) | `public/data/hashes.json` (~690 KB; one artwork hash per Pokémon card with a picture, for the scanner) | the card pictures, each downloaded once into `scripts/.cache/images/pokemon/` |
| `npm run catalog:ygo` | `public/data/ygo/catalog.json` (~3.6 MB; cards by passcode + printings by set code) | YGOPRODeck API v7 `cardinfo.php` + `cardsets.php` |
| `npm run text` (after `npm run catalog`) | `public/data/text.json` (~4.6 MB; rules text, regulation mark and legality per Pokémon card, for the deck recommender; only cards in the catalog are kept, so rebuild it whenever the catalog changes) | TCGdex GraphQL (bulk cards), REST for the few cards GraphQL rejects |
| `npm run text:ygo` (after `npm run catalog:ygo`) | `public/data/ygo/text.json` (~4.8 MB; effect text, Extra Deck materials and the TCG Forbidden & Limited list per card, for the deck recommender) | the cached YGOPRODeck `cardinfo.php` download |
| `npm run text:mtg` (after `npm run catalog:mtg`) | `public/data/mtg/text.json` (~6.2 MB; Oracle text, keywords, colour identity, produced mana and format legality per card, for the deck recommender) | Scryfall bulk data (`oracle_cards`) |
| `npm run energy-refs` (after `npm run hashes`) | `public/data/energy-refs.json` (~196 KB; symbol thumbnail and art colour per basic Energy printing with a picture, for cards that print only "ENERGY") | the reference images `npm run hashes` cached under `scripts/.cache/images/pokemon/`; no network |
| `npm run deck-bench` (after `npm run text`) | nothing shipped: `scripts/.cache/deck-bench/report.md`, checked against `src/recommend/bench/baseline.json` (see `docs/deck-bench.md`; built decks change with the pool, so read the report and, if the change is expected, `npm run deck-bench:update`) | the catalog and card text just built, plus local deck corpora |

Both also rewrite `public/data/manifest.json` (content hash, size and `builtAt` per data file; see
`scripts/data-manifest.mjs`), which the deployed web app uses to notice a rebuilt catalog. The
generated JSON files are build artifacts that are **committed**; the app loads them at run time.

## The cache, and when to bypass it

All raw downloads land in `scripts/.cache/` (gitignored):

- Pokémon: `sets_list.json`, `set_<id>.json` per set, `cards_graphql.json` (the 5 MB bulk card
  dump), `card_*.json` samples, `csv_*.csv` (PokéAPI species / names / types).
- Pokémon pictures: `image-probe.json` (which blank cards have a file on TCGdex's CDN after all, kept a
  week), `scrydex/` (Scrydex's expansion pages, kept a week) and `images/pokemon/` (the small pictures,
  kept for good; the hash build reads them).
- Yu-Gi-Oh!: `ygo_cardinfo.json` (~21 MB) and `ygo_cardsets.json`.
- Not the catalog's: `scan/`, `scan-real/`, `scan-ygo/`, `tess/` (scanner bench), `emu/`,
  `chrome-profile/` (emulator / grid bench). Leave them alone.

With the cache present a run reuses every download, so it **cannot** pick up new sets or cards.
The only network traffic of a cached Pokémon run is the logo/symbol `HEAD` probe per set (not
cached), plus, once the week-old answers have expired, the picture probes: a `HEAD` per blank card on
TCGdex and about fifty expansion pages on Scrydex (four requests a second). To refresh for real:

```bash
npm run catalog -- --no-cache
```

```bash
npm run catalog:ygo -- --no-cache
```

(or delete `sets_list.json` + `cards_graphql.json`, or the `ygo_*.json`, and run without the flag).
YGOPRODeck asks that its data be pulled once and kept (20 req/s limit): run `--no-cache` once per
refresh, never in a loop. A cached run is the right dry run; a fresh Pokémon run takes minutes
(one REST request per set, 8 in flight).

## What the output must show

Both scripts validate and exit 1 with `VALIDATION FAILED: …` on a broken invariant; a non-zero
exit means nothing was written that can be trusted.

Pokémon `===== SUMMARY =====` block: `sets:` and `cards:` (compare with the committed file, they
only grow), `categories:` only Pokemon/Trainer/Energy, `out-of-range dex ids: 0`, `species: 1025`,
`asset probes [ok, fail]` (a handful of failures is normal: the logo flag is cleared for them),
`img buckets:` (`scrydex=` about 1,300 and `none=` a few dozen; `scrydex=0` with a large `none` means
the Scrydex step found nothing and the catalog must not be committed), the `pictures from Scrydex …` line
(any card listed under "same number under another name" was left without a picture on purpose),
`catalog.json: … bytes raw, … gzip` (~3.4 MB / ~377 KB), `species.json` (~61 KB / ~11 KB),
`duplicate set names: []`.

Yu-Gi-Oh!: `N cards, M sets, P printings (X codes shared by different cards, Y cards with no TCG
printing)` (~14.6k cards, ~38.7k printings, growing), any `skipped … placeholder code(s)` and
`synthesized … set(s)` lines (expected, a few), then `Wrote public/data/ygo/catalog.json (3.6x MB)`
and `Wrote public/data/manifest.json (ygo/catalog.json v=<hash>)`. The Pokémon summary ends with a
`manifest.json versions:` line listing the hash per file.

## Check the result before committing

```bash
git diff --stat public/data
```

```bash
node -e "for (const p of ['public/data/catalog.json','public/data/ygo/catalog.json']) { const a = JSON.parse(require('fs').readFileSync(p,'utf8')); console.log(p, a.builtAt, a.sets.length, 'sets', a.cards.length, 'cards', a.printings ? a.printings.length + ' printings' : '') }"
```

Compare with the committed version (`git show HEAD:public/data/catalog.json | node -e "…"` with the
same snippet reading stdin). `builtAt` changes on every run; when that is the only difference the
refresh found nothing new: restore with `git checkout -- public/data` instead of committing a
no-op (this restores `manifest.json` as well; never leave a new manifest next to an old catalog).

When something did change, the manifest must match the files that are committed:

```bash
node scripts/data-manifest.mjs --check
```

prints `public/data/manifest.json matches public/data` with the `v=<hash>` per file, or exits 1
(`node scripts/data-manifest.mjs` regenerates it; the `public/data/manifest.json` test in
`src/data/manifest.test.ts` fails on the same mismatch). When cards gained or lost a picture, also run
`npm run hashes` and `npm run energy-refs` before committing: `src/data/card-images.test.ts` fails when a
card with a Scrydex picture has no scanner hash. In `git diff public/data/manifest.json` the
hash must change for exactly the files whose content changed. Then run `npx vitest run` and commit
the JSON and the manifest together with any code that depends on them.

## Where the new data shows up

- `npm run dev`: on the next reload. Dev fetches the plain `/data/*.json` URLs with `cache: 'no-cache'`
  and never reads the manifest.
- Deployed web app: on the user's next start after the deploy (the host's CDN may hold the old
  manifest for its TTL, ~10 minutes on GitHub Pages). The app fetches `manifest.json` with
  `no-cache`, then `catalog.json?v=<hash>` with `force-cache`; a new hash is a new URL, so it is
  downloaded once and the service worker's data cache (`cardcodex-v*-data` under DevTools →
  Application → Cache Storage) drops the old version. To check a deploy: DevTools → Network, filter
  `data/`: `manifest.json` small (304 or a few hundred bytes), the catalog request carrying the new
  `?v=` with its full size on the first start and `(ServiceWorker)` / `(disk cache)` with 0 bytes
  transferred on later ones. A manifest that still lists an old hash means the deploy shipped the
  catalog without the regenerated manifest; users then keep the old data.
- Android: with the next APK (release-build skill); the files are bundled, the manifest is not used.
