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
- Open question: the data source. TCGdex and YGOPRODeck carry no deck lists; candidates are
  Limitless (Pokémon tournament lists), Konami's structure deck pages (Yu-Gi-Oh!) and hand-curated
  lists.

### Add cards from the binder in the deck editor

- The deck page adds cards through a search box only. A "From my binder" button opens the owned
  cards (the Binder component in a pick mode, or the owned-cards grid with its set filters) with a
  stepper on each tile, so a deck is built from what is in hand without typing names.
- The same picker over the wishlist tab lets a deck take cards you are still after.

### Magic: The Gathering as a third game

- The biggest item. Games plug in through `GameProfile` (`src/games/types.ts`); Yu-Gi-Oh!
  (`src/games/ygo/`) is the template: a `GameId` with an id prefix (`mtg:`), a catalog build
  script, the profile (categories, facts, quick groups, wording), the scanner matcher and an
  artwork hash table.
- Data: Scryfall's bulk data (free, CORS, card images allowed with caching). Scale is the
  challenge: about 30k distinct cards and over 90k printings, several times the Pokémon catalog, so
  the catalog needs splitting (per set, or the distinct cards plus a printings index loaded on
  demand) rather than one JSON file.
- Scanner: the name sits top-left and the collector number and set code bottom-left, so a new OCR
  geometry and matcher; the artwork hashes work as for the other games.
- Rules: a 60-card main deck, four copies of a card except basic lands, sideboards, 100-card
  singleton commander decks. The deck size hint grows into a per-game rule set, which Yu-Gi-Oh!
  needs anyway (below).

## Standing rule: Yu-Gi-Oh! gets every fix

Every fix or feature is checked against Yu-Gi-Oh! mode rather than assumed to carry over. The
game-neutral paths (collection, binder, decks, sharing, backup, scroll memory, quick scroll on the
archetypes) do carry over; a branch on `game.id` gets its own Yu-Gi-Oh! case. The project's only
tester owns no Yu-Gi-Oh! cards, so the check is headless Chrome or the emulator with the game
switched.

Known Yu-Gi-Oh! gaps today:

- Decks are one list. A Yu-Gi-Oh! deck needs Main, Extra (Fusion, Synchro, Xyz and Link monsters,
  which the catalog's `frameType` identifies) and Side sections, and a three-copies rule.
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
