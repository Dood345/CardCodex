---
name: catalog-refresh
description: Rebuild CardCodex's offline card catalogs — `npm run catalog` (public/data/catalog.json + species.json from TCGdex and PokéAPI) and `npm run catalog:ygo` (public/data/ygo/catalog.json from YGOPRODeck) — including when the scripts/.cache downloads must be bypassed to pick up new sets, what the summary output must show, and how to check the result before committing. Use for "refresh/rebuild/update the catalog", "pick up the new set", "new cards are missing", "catalog is out of date", "regenerate public/data".
---

# Catalog refresh

Two builders, Node 22+, built-ins only, run from the repo root (details: `scripts/README.md`):

| command | writes | sources |
|---|---|---|
| `npm run catalog` | `public/data/catalog.json` (~3.3 MB, all English Pokémon sets and cards), `public/data/species.json` (~61 KB, species 1–1025) | TCGdex GraphQL (bulk cards) + REST (per-set details), PokéAPI CSVs on GitHub |
| `npm run catalog:ygo` | `public/data/ygo/catalog.json` (~3.6 MB; cards by passcode + printings by set code) | YGOPRODeck API v7 `cardinfo.php` + `cardsets.php` |

The generated JSON files are build artifacts that are **committed**; the app loads them at run time.

## The cache, and when to bypass it

All raw downloads land in `scripts/.cache/` (gitignored):

- Pokémon: `sets_list.json`, `set_<id>.json` per set, `cards_graphql.json` (the 5 MB bulk card
  dump), `card_*.json` samples, `csv_*.csv` (PokéAPI species / names / types).
- Yu-Gi-Oh!: `ygo_cardinfo.json` (~21 MB) and `ygo_cardsets.json`.
- Not the catalog's: `scan/`, `scan-real/`, `scan-ygo/`, `tess/` (scanner bench), `emu/`,
  `chrome-profile/` (emulator / grid bench). Leave them alone.

With the cache present a run reuses every download, so it **cannot** pick up new sets or cards.
The only network traffic of a cached Pokémon run is the logo/symbol `HEAD` probe per set (not
cached). To refresh for real:

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
`catalog.json: … bytes raw, … gzip` (~3.3 MB / ~365 KB), `species.json` (~61 KB / ~11 KB),
`duplicate set names: []`.

Yu-Gi-Oh!: `N cards, M sets, P printings (X codes shared by different cards, Y cards with no TCG
printing)` (~14.6k cards, ~38.7k printings, growing), any `skipped … placeholder code(s)` and
`synthesized … set(s)` lines (expected, a few), then `Wrote public/data/ygo/catalog.json (3.6x MB)`.

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
no-op. Then run `npx vitest run` (the scanner tests load the real catalog) and commit the JSON
together with any code that depends on it.

## Where the new data shows up

`src/data/catalog.ts` fetches `/data/*.json` with `cache: 'no-cache'` **only in dev**
(`import.meta.env.DEV`); production builds use `force-cache`. So `npm run dev` shows a rebuilt
catalog on the next reload, while the deployed web app needs a new deploy (and a browser that
already holds `/data/catalog.json` may keep it until its HTTP cache lets go: the service worker is
network-first for same-origin files, but the page's own fetch asks for the cache first) and
Android needs a new APK (release-build skill).
