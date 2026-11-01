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
