# Deck recommender: Yu-Gi-Oh!

The Yu-Gi-Oh! half of the deck recommender (`docs/deck-recommender.md` describes the engine and the
Pokémon side). Like the Pokémon evaluator, it scores a deck on rules of thumb computed from the cards'
own text and fields; nothing is learned from published decks, so the builder can propose decks nobody
has played, and "competitive" means legal, consistent and synergistic, not matching a tournament meta.

## Data: `public/data/ygo/text.json`

`node scripts/build-ygo-text.mjs` reads the YGOPRODeck API v7 `cardinfo.php` download that the catalog
builder caches in `scripts/.cache/ygo_cardinfo.json` (one bulk download, as YGOPRODeck asks; this script
fetches nothing) and keeps, per passcode, only what the catalog (`public/data/ygo/catalog.json`) lacks:

| Field | What |
| --- | --- |
| `fx` | The effect text: a monster's effect without its materials line, or the Spell/Trap text |
| `mt` | An Extra Deck monster's materials line ("1 Tuner + 1+ non-Tuner monsters"), "" when none |
| `pe` | The Pendulum Effect (from the API's `pend_desc`), "" when none |
| `ban` | TCG status from `banlist_info.ban_tcg`: 0 Forbidden, 1 Limited, 2 Semi-Limited; absent = Unlimited |

Name, type, frame, Attribute, Monster Type, Level/Rank/Link rating (`lv`), ATK/DEF and archetype are
already in the catalog. Link Arrows are not used, so they are not shipped.

- 13,735 cards with text, keyed by passcode (every printing of a card shares it). Skills and Tokens
  are left out; so is the flavour text of the 724 Normal Monsters, which is not rules text (an
  effectless Ritual Monster keeps its text, which names its Ritual Spell).
- Materials read from 2,193 of 2,222 Extra Deck monsters. The 29 without a materials line put a
  summoning condition there instead ("Must be Special Summoned with "Mask Change"", the Ursarctic
  Synchros, "This card's name is also treated as ...") and count as not makeable from a Main Deck. A few
  older texts separate materials and effect with " / "; a leading parenthetical ("(This card's original
  Level is always treated as 12.)") is skipped.
- TCG list: 155 Forbidden, 91 Limited, 7 Semi-Limited, as of the cache download (2026-11-08,
  recorded in the file as `source.fetchedAt`). It is a snapshot: re-run `npm run catalog:ygo
  -- --no-cache` and this script after a list update.
- 4.78 MB raw, 0.95 MB gzipped (the Pokémon `text.json` is 4.6 MB / 0.8 MB). The app should load it
  only for the recommender, like the Pokémon file.

`src/recommend/ygo-text.ts` holds the file's types and `buildYgoTextIndex(file)` (a pure index by
passcode plus the TCG limits); it adds no loader, so `card-text.ts` is untouched.

## Game rules relied on

All from Konami's **Official Rulebook, Version 10** (the TCG rulebook linked from
yugioh-card.com/en/rulebook, `SD_RuleBook_EN_10.pdf`), read 2026-11-09:

| Rule | Rulebook | Also in |
| --- | --- | --- |
| Main Deck 40 to 60 cards | "The Deck must be 40 to 60 cards" | `YGO_DECK_RULES` |
| Extra Deck 0 to 15, holding Fusion, Synchro, Xyz (and Link) Monsters | "Extra Deck ... (0 to 15 cards)" | `isExtraDeckCard` (frames) |
| Side Deck 0 to 15 | "Side Deck ... (0 to 15 cards)" | `YGO_DECK_RULES` |
| Three copies of a card by name, over Main, Extra and Side | "up to 3 copies of a card that has the same name" | `YGO_DECK_RULES.copyLimit` |
| Forbidden 0, Limited 1, Semi-Limited 2 | "Limited cards are restricted to 1 copy ... Semi-Limited ... 2 ... Forbidden ... not allowed" | YGOPRODeck `ban_tcg` |
| Opening hand of five | "draw 5 cards from the top of your Deck; this is your starting hand" | — |

The data cannot confirm the opening hand; it is the rulebook's. Version 10 predates Link Monsters in
its Extra Deck sentence; the frames in the data (`link`) and the catalog's `isExtraDeckCard` put them
there. Going first or second (who draws on turn one) is not modelled: the consistency part looks at the
opening five only.

## Scoring (`src/recommend/ygo.ts`)

`createYgoEvaluator({ index, text, format? })` returns a `DeckEvaluator` (plus `features(card)` and
`canMake(extraCard, cards)` for tests and later tools). Each part is 0..1 with a one-line detail; the
total is the weighted sum, 0..100. Lines are split by section as the deck page does: `zone: 'side'` is
the Side Deck, an Extra-frame card is the Extra Deck, everything else the Main Deck.

| Part | Weight | What it measures |
| --- | --- | --- |
| rules | 10 | Main 40–60, Extra and Side at most 15, three copies by name over all sections, the TCG list (each problem is also an issue) |
| consistency | 20 | Hypergeometric chance the opening five hold no starter, full marks at 10% or less, none at 50%; 20% of the part rewards a Main Deck at 40, falling to nothing at 60 |
| bricks | 10 | Copies dead on their own; one is free, 15% of a 40-card deck is zero |
| cohesion | 20 | Half focus (70% of a 40-card deck in the top archetype, or cards naming it; a Monster Type counts at half), half met conditions (cards that name an archetype, card, Type or Attribute find another card with it) |
| interaction | 15 | Hand traps, negation and removal in the Main Deck; ten copies is full marks |
| extra | 15 | With an Extra Deck: the share of its copies the Main Deck can make. Without: what the Main Deck opens (Synchro, Xyz, Link, each a third of half) and how many deck-specific Extra Deck monsters it can make (four is full marks for the other half) |
| shape | 10 | Monsters 30–65% of the Main Deck, and 60% of a 40-card deck in twos and threes |

Features, read once per passcode with regular expressions over `fx` and `pe`:

- **Starter**: the text adds a card "from your Deck" to the hand, or Special Summons "from your
  Deck" (or "from your hand or Deck"). "Your" matters: Ash Blossom's "Add a card from the Deck to the
  hand" is what it negates, and a test checks every such text is not taken for a search. Draw and
  Deck-to-GY effects count half. A card that is a full brick is no starter.
- **Hand trap**: a monster whose Quick Effect (or effect on the opponent's turn) discards it, sends it
  from the hand, reveals it or Special Summons it from the hand. **Negation**: "negate the/that/its…".
  **Removal**: destroy, banish, return, shuffle, send, Tribute or take control of a card the opponent
  controls, on the field, or in their GY.
- **Brick**: a Main Deck monster of Level 7+ (half for 5–6) with no "Special Summon this card" or
  Tribute-less clause and no other card in the deck that Special Summons it by name, archetype, Type
  or Attribute; a Ritual Monster without a Ritual Spell, and the other way round; a card naming card
  names (in quotes) of which none is in the deck.
- **Mentions**: quoted strings are classified as an archetype when followed by "monster", "card",
  "Spell", "Trap" and the like, else as a card name when the catalog has that name, else as an
  archetype when the catalog's archetype list has it; Tokens and "treated as" names are skipped
  ("always treated as a "X" card" adds X to the card's own archetypes). A card belongs to an archetype
  when its name contains the string or the catalog's archetype field is it. "a Dragon monster",
  "LIGHT Fairy monsters", "Level 1 LIGHT Tuner" give Type and Attribute mentions.
- **Materials**: the materials line is split on " + " into parts ("2 Level 4 monsters",
  "1 Tuner", ""Dark Magician"") with a filter each (names, archetypes, Level range, Tuner or
  non-Tuner, Attribute, Monster Type, Effect/Normal/Pendulum), plus ", including …". A monster is
  makeable when: Synchro, a Tuner's Level plus one or two non-Tuners' Levels reach its Level; Xyz, the
  deck holds at least two more copies than the materials needed (four for "2 Level 4 monsters"); Link,
  at least as many matching copies as the materials (two at least); Fusion, every part matched and a
  card that Fusion Summons in the Main Deck, unless the monster is a contact Fusion ("You do not use
  "Polymerization"", "Must be Special Summoned by sending…"). Materials that only the Extra Deck holds
  ("1 Tuner Synchro Monster", "3 Xyz Monsters") are not makeable from the Main Deck.

## Formats

`formats` is `tcg` (the Forbidden & Limited list) and `any` (three of each). `pool(options)` follows
`options.format` (no Forbidden cards under `tcg`), but `score(cards)` and `rules.copyLimit(card)` have
no format argument in the contract, so they follow the format the evaluator was created with
(`createYgoEvaluator({ …, format })`, default `tcg`): under `tcg`, `copyLimit` is the list's limit, so
the builder never adds a second copy of a Limited card, and the rules part and issues report the list.
An evaluator created with the default and asked to build under `any` still steers away from Forbidden
cards through the score. Create one evaluator per format (the features are cheap to read again) or see
"What the builder would need" below. OCG and GOAT lists exist in the data (`ban_ocg`, `ban_goat`) but are
not shipped: the catalog holds TCG printings only, and a GOAT card pool needs a cut-off date the data
does not give.

## Builder use

- `pool` holds Main Deck cards only, one printing per passcode (an owned printing first, else the
  newest), no Skills or Tokens. `kindOf` maps monsters to "pokemon" and everything else to "trainer";
  there is no "energy" kind, so the builder's Energy share of the breadth goes unused.
- `requirements`: a Ritual Monster brings the Ritual Spell that names it (or that it names), a Ritual
  Spell the Ritual Monster it names, and a card that names exactly one Main Deck card the deck lacks
  brings that card.
- `relevance`: one deck context per call, then one pass over the pool: the deck's archetypes and what
  its cards name rank highest, cards whose named needs are absent lowest, high-Level monsters without
  a self-summon are discounted, starters and interaction are the fallback.
- `complete(cards, options)`: keeps the Main and Side lines, and adds up to 15 Extra Deck monsters
  (one copy each, at most five per Summon kind while others remain) that the Main Deck can make,
  ranked by naming the deck's cards or archetypes, sharing its archetype, negation or removal,
  searching, ATK, and a penalty when the monster's own text names something the deck lacks. It
  applies the options' format and source itself, since the builder's pool holds no Extra Deck cards.

Timings on the desktop (vitest, Node 24): loading the catalog index and the text index about 0.4 s;
reading the features of the whole pool 0.13 s; one score of a full deck (40 + 15) 0.09 ms; one
`relevance` pass over the 11,737-card pool 11 ms; one full build from a seed 0.6–0.9 s (Sage with Eyes
of Blue: 0.86 s, features already read), plus `complete` 12 ms.

## Benchmark (2026-11-09)

The harness (`docs/deck-bench.md`) with the Yu-Gi-Oh! damages passed from the test (the harness's
own labels say Trainers, Energy and Pokémon): swap-6/12/24 random cards, **spells-traps** (a third of
the Spells and Traps swapped for random Spells and Traps, the harness's "trainer" kind) and **monsters**
(a third of the monsters, "pokemon" kind). The Energy damage is dropped: there is no Energy kind.
Random replacements come from every catalog card of the deck's years, Extra Deck monsters included.
`YGO_BENCH=1 npx vitest run src/recommend/ygo.test.ts` reruns it and writes
`scripts/.cache/deck-bench/ygo-report.md`; `npm test` runs a small version with floors.

Seeds by rule: of the catalog archetypes with at least 14 Unlimited Main Deck cards, the twelve with
the most starter monsters, one starter of each: Gladiator Beast Retiari, Performapal Smile Sorcerer,
Shelrokket Dragon, Dark Magician the Magician of Black Magic, Sage with Eyes of Blue,
Familiar-Possessed - Hiita, Matador Archfiend, Armed Dragon LV3, Gouki Guts, Gusto Squirro, Kozmo
Forerunner, R-Genex Magma. Each deck is `buildDeck` then `complete` (TCG list, whole catalog).

Share of decks the judge rates above the damaged version; 5 versions of each deck, seed 1.

Decks built from 12 seeds, with an Extra Deck:

| Judge | Mean | Pile | swap-6 | swap-12 | swap-24 | spells-traps | monsters | Order |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Score | 99.92 | 100% | 100% | 100% | 100% | 100% | 100% | 0.99 |
| Deck rules | 1.00 | 73% | 63% | 59% | 66% | 53% | 66% | 0.35 |
| Consistency | 1.00 | 100% | 81% | 93% | 98% | 58% | 92% | 0.90 |
| Bricks | 1.00 | 100% | 68% | 84% | 98% | 69% | 93% | 0.85 |
| Cohesion | 1.00 | 100% | 100% | 100% | 100% | 100% | 100% | 1.00 |
| Interaction | 1.00 | 75% | 51% | 51% | 54% | 51% | 52% | 0.37 |
| Extra Deck | 1.00 | 100% | 78% | 92% | 98% | 50% | 99% | 0.91 |
| Shape | 1.00 | 100% | 73% | 89% | 100% | 57% | 93% | 0.94 |

The 80 Structure and Starter Decks of `public/data/ygo/decks.json`:

| Judge | Mean | Pile | swap-6 | swap-12 | swap-24 | spells-traps | monsters | Order |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Score | 65.91 | 100% | 88% | 95% | 100% | 83% | 94% | 0.86 |
| Deck rules | 0.73 | 59% | 60% | 60% | 61% | 46% | 67% | 0.18 |
| Consistency | 0.42 | 61% | 55% | 60% | 62% | 54% | 59% | 0.18 |
| Bricks | 0.95 | 98% | 74% | 87% | 95% | 68% | 77% | 0.80 |
| Cohesion | 0.68 | 100% | 97% | 99% | 100% | 98% | 99% | 0.92 |
| Interaction | 0.84 | 68% | 54% | 59% | 65% | 60% | 50% | 0.30 |
| Extra Deck | 0.62 | 85% | 67% | 78% | 82% | 49% | 75% | 0.49 |
| Shape | 0.51 | 63% | 48% | 46% | 46% | 45% | 47% | 0.15 |

What it shows:

- The total tells every deck from a pile, and from 24 swapped cards, every time on both corpora; on the
  product decks it catches 6 swapped cards 88% of the time and swapped Spells and Traps 83%.
- **Built decks saturate**: the builder climbs the score until every part is full (mean 99.92), so
  the score cannot rank built decks against each other, and on them the parts measure only how
  damage pulls a maxed part down. A playtest judge is what this corpus is for.
- **The product decks are thin by construction**: `decks.json` lists each printed card once (a box
  may hold more copies), so Shape (cards in multiples) and Consistency (copies of starters) are low on
  the originals already (0.51, 0.42) and barely move with damage. Their 50–60% rates say "the list has
  no multiples", not "the part is blind". Starter Deck: Kaiba and Yugi also list each card twice,
  once under its North American code and once under its European one (SDK-001 and SDK-E001), so they
  have 95–96 Main Deck cards and fail the rules part; three more decks list one card under two codes.
  Many older Structure Decks have 28–39 Main Deck cards, under the 40 minimum.
- Cohesion is the strongest single part (97–100% everywhere): random cards rarely share the deck's
  archetype or meet its cards' named needs.
- Interaction barely notices damage (50–65%): random cards from the catalog carry removal and
  negation at about the deck's own rate, and built decks sit at the ten-copy cap.
- Deck rules sits near 60%: a pile or swap breaks it only when it draws a Forbidden or Limited card or
  shifts the Main Deck past a size limit.

## Known gaps

- Text reading is regular expressions: costs, once-per-turn clauses, "cannot be Special Summoned"
  restrictions, locks ("you cannot Special Summon monsters, except …") and Pendulum Scales are not
  read; a starter that locks the deck out of its own Extra Deck still counts as a starter.
- Makeability is a count of copies, not a combo: the parts do not check that a Tuner and a non-Tuner
  can be on the field together, Normal Summon limits, or Link climbing (Link materials that are Link
  Monsters count as not makeable from the Main Deck; Xyz and Synchro materials that are Extra Deck
  monsters likewise).
- Archetype membership is "name contains the string, or the catalog's archetype field"; YGOPRODeck's
  archetype field holds one archetype per card, and cards "always treated as" another archetype are
  read from text.
- `complete` puts one copy of each Extra Deck monster; real decks often play two of a key one.
- The TCG list is a snapshot of the cache; no Traditional, OCG, GOAT or Speed Duel formats.
- Only the opening five are modelled; who goes first, and the draw on later turns, are not.

## Registering it (not done on this branch)

- npm script: `"text:ygo": "node scripts/build-ygo-text.mjs"`, run after `catalog:ygo`.
- Data file `ygo/text.json`: add it to `DATA_FILES` in `scripts/data-manifest.mjs`, to the exact key
  list in `src/data/manifest.test.ts`, regenerate `public/data/manifest.json`, and have the script
  call `writeDataManifest()` at its end like the other builders (it does not yet, so this branch does
  not touch the manifest).
- Loader: `loadCardText` in `card-text.ts` runs the Pokémon `buildTextIndex`, which would fail on
  this file (it has no `ids`). Load it with `fetchDataJson<YgoTextFile>('ygo/text.json')` and
  `buildYgoTextIndex`, in a Yu-Gi-Oh! loader or a per-game builder; do not just point `textFileFor`
  at it.
- Evaluator: `createYgoEvaluator({ index, text, format })`, `index` the Yu-Gi-Oh! `CatalogIndex`;
  formats `tcg` (default) and `any`, one evaluator per format.
- Benchmark: the full run lives in `ygo.test.ts` behind `YGO_BENCH=1`; it can move into
  `src/recommend/bench/local.bench.ts` with `YGO_DAMAGES`.

## What the builder would need

Nothing blocks the Yu-Gi-Oh! evaluator today, but five things would make it whole:

1. **Call `complete`.** `buildDeck` ends after its swap loop; the contract says it calls
   `ev.complete?.(cards, options, pool)` once at the end. Until it does, callers (and the tests here)
   call `complete` themselves.
2. **Format in `score` and `copyLimit`.** The contract passes `format` to `pool` only. Either the
   builder should take the evaluator for the chosen format (one per format: `createYgoEvaluator({ index,
   text, format })`), or `DeckEvaluator.score(cards, format?)` and `DeckRules.copyLimit(card, format?)`
   (or an evaluator-level `copyLimit(card, format)` used by `roomFor`) should carry it.
3. **Kind shares.** `candidateMoves` gives 15% of the breadth to "energy"; with no Energy kind it is
   unused (half monsters, a third Spells and Traps). A per-evaluator share table, or redistributing an
   empty kind's share, would let Yu-Gi-Oh! (and Magic) use the whole breadth.
4. **Swaps stay within a section.** `contributions` and `suggestSwaps` treat every line without a zone
   alike, Extra Deck lines included. On a completed deck with one Extra monster the Main Deck cannot
   make, every suggested swap was "−that Extra monster, +a Main Deck card" (checked 2026-11-09:
   −Flame Swordsman +Dragon Capture Jar, +1.4), which leaves 41 Main Deck cards and 14 Extra. Swaps
   should pair a removal with an add of the same section (`rules.sectionOf`), and `buildDeck`'s
   `count()` should count the first section only.
5. **Extra Deck seeds.** `buildDeck` finds a seed in the pool (or by name in it), and the pool holds
   Main Deck cards only, so seeding with an Extra Deck monster drops it (Stardust Dragon came back in
   `dropped`). The builder could keep such a seed aside and hand it to `complete`, which would then
   need to steer the Main Deck towards its materials (relevance from the seed's materials line).
