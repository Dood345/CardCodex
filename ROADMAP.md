# Roadmap

What comes next for CardCodex, in the order it was set on 2026-11-02, after 1.5.0. Nothing here is
scheduled: the list is the agreed direction, and the notes under each item are a starting point, not
a design.

## Next

### Prebuilt decks and deck suggestions

Done for Yu-Gi-Oh!: `public/data/ygo/decks.json` (`npm run decks:ygo`, from YGOPRODeck) holds 80
Structure and Starter Decks, one copy per printed card because the API has no quantities. Decks →
"Starter decks" ranks them by coverage (`src/data/starter-decks.ts`), `#/decks/starter/<id>` shows
one and copies it with "Keep this deck". Still open: Pokémon (pokemon.com sits behind bot
protection, so the lists cannot be fetched by a script; Limitless or Bulbapedia lists would need a
source whose terms allow it), real quantities, and the card suggestions below.


- A set of ready-made decks per game (starter and theme decks, well-known lists) shipped like the
  catalog, under `public/data/<game>/decks.json`, built by a script from a source whose terms allow
  it. Decks gets a "Starter decks" section; one tap copies a deck into your own, and the owned and
  missing counts and the wishlist button work as for any deck.
- Suggestions come almost for free once those exist: rank the prebuilt decks by how much of each
  the collection already covers (`summarizeDeck` in `src/data/decks.ts` gives the coverage) and
  show the ones closest to complete first. Suggesting cards for a deck you are building (the same
  evolution line, type or archetype) is a second step.
- Yu-Gi-Oh! decks come from YGOPRODeck. Pokémon has no source yet that fits the rule: the one
  with the data (`PokemonTCG/pokemon-tcg-data`, 188 theme decks up to Sword & Shield) has no
  licence, and Bulbapedia is CC BY-NC-SA, which a GPL-3.0 app cannot carry. See
  `docs/pokemon-deck-sources.md`.

### In-house deck recommender

Set 2026-11-09 and landed in 1.9.0 for all three games: a deck-building engine of our own that
scores a deck on rules of thumb read from the cards' own text and uses the score to suggest cards
while building, swaps for a full deck, and whole decks grown from a seed, from the collection only
or from the whole catalog (`docs/deck-recommender.md`, `deck-recommender-ygo.md`,
`deck-recommender-mtg.md`). In the app it is the "Deck check" on every deck page and Decks → "Build
one for me".

For Pokémon the engine also plays: a seeded simulator (`docs/deck-playtest.md`) gives practice
draws and head-to-head duels, the deck check shows how a full deck played, and "Tune by playing"
improves a built deck swap by swap. The benchmark (`npm run deck-bench`, `docs/deck-bench.md`) rates
decks and their known-worse copies with every judge and fails when a judge falls behind its
recorded baseline; its corpora include tournament lists with real win rates, fetched for local
validation only (`docs/deck-results-sources.md`).

Still open:

- **Predicting real results.** Among tournament lists neither the score nor solo play follows the
  real win rates; simulated duels are the first judge that can, and the test pilot does not yet read
  disruption, gust effects or most Abilities. Better piloting is the lever, and the benchmark's
  strength column is the measure.
- **A meta layer** (how the archetype a deck resembles has done, cards the winning lists share)
  needs Limitless's written yes to ship derived data; the request is drafted in
  `docs/deck-results-sources.md` for the project owner to send.
- **Playtest simulators for Yu-Gi-Oh! and Magic** (opening a starter without bricking; casting on
  curve), which would bring them tuning by play. Their decks are scored only.
- **Combinations nobody has played**: a synergy graph over the pool (cards that name, power or
  evolve into each other) whose clusters become Build-a-deck ideas, and a shopping list from the
  difference between the best deck from the collection and the best from the catalog.
- Smaller: Yu-Gi-Oh! ideas by archetype and Extra Deck monsters as seeds; adding cards a playset at
  a time; Magic sideboard advice and a Commander check; learning from the suggestions a user
  accepts or dismisses.

### Magic: The Gathering: the scanner and the rest

Browsing, search, card pages, the collection and the binder work for Magic (`src/games/mtg/`, catalog
from Scryfall by `npm run catalog:mtg`: ~98k printings of ~34k cards in one 11.4 MB file, 4.3 MB
gzipped, loaded like the other games). Still to do:

- Scanner: the name sits top-left and the collector number and set code bottom-left, so a new OCR
  geometry and a real matcher in `src/scanner/mtg/` (fuzzy names, per-card line grouping for binder
  pages). `src/games/mtg/match.ts` is a minimal placeholder (exact name, set code + number, one card
  per frame) and `createMatcher` in the profile is where the real one plugs in.
- Artwork hashes: `hashFileFor` (`src/scanner/artwork.ts`) has no Magic case yet; a table over ~98k
  printings is about 3 MB, or hash per illustration id to share pictures between reprints.
- Decks: done in 1.9.0. A Magic deck has 60 cards or more and a sideboard of up to 15, or follows
  Commander rules (100 cards, one of each; `GameProfile.deckRuleSets`, `Deck.rules`). Still open:
  naming the commander and checking colour identity.
- Oracle text ships as `mtg/text.json` (1.4 MB gzipped), loaded by the deck recommender only. Showing
  it on the card page and searching by it are still open.
- Set symbols: Scryfall serves one SVG per set (`icon_svg_uri` in `/sets`); the Sets list shows the
  set code instead for now.
- Size on phones: the Magic index takes ~100 MB of JS heap on desktop Chrome and about 0.7 s to
  fetch, parse and index; not yet measured on a phone or the emulator, and the APK grows by the
  catalog file.

## Standing rule: Yu-Gi-Oh! gets every fix

Every fix or feature is checked against Yu-Gi-Oh! mode (and now Magic) rather than assumed to carry over. The
game-neutral paths (collection, binder, decks, sharing, backup, scroll memory, quick scroll on the
archetypes) do carry over; a branch on `game.id` gets its own Yu-Gi-Oh! case. The project's only
tester owns no Yu-Gi-Oh! cards, so the check is headless Chrome or the emulator with the game
switched.

Known Yu-Gi-Oh! gaps today:

- The Archetypes tab cannot reach the 5,775 cards (of 14,656) that belong to no archetype: 3,393
  monsters, 1,207 spells, 1,016 traps. The Pokédex solved the same problem for Trainers and Energy
  with name-grouped toggles (`src/data/name-groups.ts`, 1.8.0); the Archetypes page wants the same
  Monster / Spell / Trap toggles over the archetype-less cards, grouped by card.
- Card tiles and binder pockets use the Pokémon 63×88 aspect; Yu-Gi-Oh! cards are 59×86 (`cardMm`
  in the profile), so their pictures are very slightly cropped.

## Smaller open items

- Share links are scheme-only (`cardcodex://`) because nothing is deployed on the web, so a friend
  without the app cannot open one. A GitHub Pages deployment would give https links that open the
  import page.
- Opening a deck of the other game asks to switch games first, because one catalog is loaded at a
  time.
- Scroll memory, sticky filters and the remembered binder page live in memory only and reset when
  the app is killed.
- The binder orders by set and number only.
- The scanner's hash-fixture test can time out when every test file runs in parallel.
