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
