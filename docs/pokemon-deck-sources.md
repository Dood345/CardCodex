# Pokémon prebuilt decks: where the lists could come from

Checked 2026-11-02 for the "Starter decks" section of the Decks tab (Yu-Gi-Oh! has it, from
YGOPRODeck). The rule: a deck list goes into `public/data` only from a source whose terms allow it,
with the source recorded per deck, and the app is GPL-3.0 with the data shipped inside it.

**Result: no source met that rule, so no `public/data/decks.json` is shipped.** One source has
exactly the data we want and maps almost perfectly to our catalog, but carries no licence at all
(below). That one is the owner's call.

## Candidates

| Source | Lists | Terms | Verdict |
| --- | --- | --- | --- |
| `PokemonTCG/pokemon-tcg-data` `decks/en/` (GitHub) | 188 theme and starter decks, Base Set to Sword & Shield | **No licence** | Best data, not usable as is |
| Bulbapedia | Theme decks, League Battle Decks, Battle Academy, Worlds replicas | CC BY-NC-SA 2.5 | No: cannot sit in a GPL-3.0 app |
| pokemon.com | Product pages, no contents | Terms page unreadable | No data |
| Limitless TCG | Tournament lists only | Copyright notice only | No prebuilt decks |
| PkmnCards | None found | Forbids scraping | No |
| TCGdex | None | n/a | No deck data |

### PokemonTCG/pokemon-tcg-data (`decks/en/*.json`)

- 83 files, 188 decks, 60 cards each (two 61-card starter sets). Eras: Base, Gym, Neo, e-Card,
  EX, Diamond & Pearl, Platinum, HGSS, Black & White, XY, Sun & Moon, and Sword & Shield up to
  `swsh4`. Last touched 2024-03-04. Nothing newer, no Scarlet & Violet, no League Battle Decks,
  Battle Academy or Worlds decks.
- Shape: `[{id, name, types, cards: [{id: "swsh4-25", name, rarity, count}]}]`. The ids are
  `<set>-<number>` with real quantities.
- **Terms:** the repository has no LICENSE file, GitHub reports `license: null`, and the README says
  nothing about reuse. Issue [#334 "What LICENSE?"](https://github.com/PokemonTCG/pokemon-tcg-data/issues/334)
  ("What are the copyright and license constraints for using this data?", open since 2023-01-20, no
  replies) is the only mention. docs.pokemontcg.io says only "This website is not produced,
  endorsed, supported, or affiliated with Nintendo or The Pokémon Company." The README now states
  "This project is being deprecated" and the API goes offline on 2027-03-01 (replacement: Scrydex,
  a commercial API; its terms were not read). Without a licence the default is all rights reserved,
  so this does not meet the rule. A maintainer answering #334 with a permissive licence would change
  that.
- **Mapping, measured with a throwaway script (not committed):** set ids match ours for all but a
  few sets, so the set map was derived from `sets/en.json` against `catalog.json` by id, then by
  normalized name (174 of 176 sets; the two misses, a Futsal set and a 30th Celebration set, have
  no deck). Of 3,976 lines (11,282 copies) all but 5 lines (75 copies) resolve to a catalog id of
  the form `<set>-<number>`:
  - `ecard2-103` Porygon in "Abyss": 3 copies. The number is not in our catalog.
  - `swsh1-0` basic Energy in the four Sword & Shield decks `swsh3-1`, `swsh3-2`, `swsh4-1` and
    `swsh4-2`: 18 copies each. The source uses a placeholder id with number 0; these are the
    deck's basic Energy, which is also what a collector does not track.

### Bulbapedia

- Pages have one structured wikitext source (`action=query&prop=revisions`), with
  `{{decklist/entry|qty|…}}` lines and `{{TCG ID|Set|Name|Number}}` links, so a line maps to set
  name plus collector number. It covers what the others do not: League Battle Decks (e.g. the
  Pikachu & Zekrom-GX and Reshiram & Charizard-GX decks, 2020), Battle Academy, Worlds decks. A
  parser would take a day or two. `robots.txt` asks for `Crawl-delay: 5` and allows `/wiki/`.
- **Terms:** API `rightsinfo`: "Attribution-NonCommercial-ShareAlike 2.5". Bulbapedia:Copyrights:
  "You may copy and modify Bulbapedia content, provided the resulting work is also licensed under
  the same copyright as the Bulbapedia content."
- **Can it sit in a GPL-3.0 app? No.** The non-commercial term is an extra restriction that GPL-3.0
  §10 does not allow, and the FSF does not count CC BY-NC-SA as a free licence. Shipping the data as
  a separately licensed file in the APK would be non-free data inside a free app and would bind
  anyone who forks and sells it. Whether a bare list of card names and counts is copyrightable at
  all is a legal question this note does not settle; it is not a basis for ignoring the rule.

### pokemon.com

- The League Battle Deck product pages (Charizard ex, Pikachu & Zekrom-GX and Reshiram &
  Charizard-GX, …) say "1 ready-to-play 60-card deck" and name only a handful of cards; no list, no
  PDF. The product gallery and Play! Pokémon pages hold only the blank tournament registration
  sheet. Worlds pages (e.g. 2017 "standout decks") describe player decks, not products.
- The terms page (`/us/terms-of-use`) returned a bot check, so its terms are **unverified**.

### Limitless TCG

- Copyright notice only, no licence or terms page ("is copyright The Pokémon Company (Pokémon),
  Nintendo, Game Freak and/or Creatures", `/legal` says nothing about reuse).
- The public API (`play.limitlesstcg.com/api`) serves tournaments, standings with player decklists,
  pairings; `/decks` holds archetype rules and needs a key that is "only given out to public-facing
  projects that have a legitimate use-case". No theme or League Battle Decks. Tournament lists
  are players' own decks.

### PkmnCards

- Terms (`/terms/`): "You may not scrape PkmnCards or solicit information from PkmnCards users for
  the purposes of recruitment, head-hunting, or job boards" and "You may not place undue burden on
  PkmnCards through the use of automated means". The site footer: "All other content © 2011–2026
  PkmnCards." No deck lists found. Not a source.

### TCGdex

- `GET /v2/en/sets/base1` has `cardCount`, `cards`, `id`, `legal`, `logo`, `name`, `releaseDate`,
  `serie`, `tcgOnline`, `abbreviation`: no deck data.

## What to decide

1. Ask the `pokemon-tcg-data` maintainers (comment on #334) whether `decks/en` may be redistributed,
   and what licence. If the answer is a permissive licence, the build is small: pin a commit SHA in
   each deck's `source.url`, fetch the 83 files into `scripts/.cache/pokemon-decks/`, map with the
   derived set table, keep the 5 unmapped lines out (drop `swsh1-0` Energy, report the Porygon), and
   write `public/data/decks.json` (`game: 'pokemon'`). That gives 188 decks up to early 2020, at no
   cost to the catalog. The Decks tab also needs `starterFileFor('pokemon')` in
   `src/data/starter-decks.ts` to return `'decks.json'` (it returns `null` for every game but
   Yu-Gi-Oh!).
2. Newer decks (Scarlet & Violet League Battle Decks and so on) have no terms-compatible source.
   Options: hand-keying them from the physical product (the owner owns them), or accepting no
   Pokémon decks newer than Sword & Shield.
