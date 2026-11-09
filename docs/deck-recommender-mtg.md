# Deck recommender: Magic: The Gathering

The Magic half of the in-house deck recommender (`docs/deck-recommender.md` describes the engine and
the Pokémon evaluator). Like the Pokémon side it learns nothing from published decks: a deck is scored
on rules of thumb computed from the cards' own Oracle text and fields, and the game-neutral builder
(`src/recommend/builder.ts`) turns the score into suggestions, swaps and whole decks. Scope is
60-card constructed play: one main deck of at least 60 cards. Sideboards and Commander are not
modelled.

## Data: `public/data/mtg/text.json`

`node scripts/build-mtg-text.mjs` (run after `scripts/build-mtg-catalog.mjs`) reads Scryfall's
`oracle_cards` bulk file, one card object per Oracle id, and writes the text of every Oracle card the
Magic catalog holds: 34,180 of 34,180 on 2026-11-09 (bulk file updated 2026-11-09 22:02 UTC; catalog
built 2026-11-03).

- **Requests.** One to `api.scryfall.com/bulk-data` (cached as `scripts/.cache/mtg/bulk-data.json`,
  the same file the catalog script uses) and the 25 MB gzipped bulk file from `data.scryfall.io`,
  downloaded once per file name, with a descriptive generic User-Agent, as Scryfall's API guidance
  asks (bulk files rather than per-card requests). Scryfall is credited in the app already.
- **Per card:** Oracle text; for multi-faced cards (split, adventure, transform, modal double-faced,
  flip, meld; 875 cards) each face's name, type line, mana cost, text, power, toughness and loyalty,
  which the catalog has no room for; Scryfall's keyword list (910 distinct keywords, held once and
  referred to by index); colour identity; the mana the card can produce (Scryfall's `produced_mana`);
  legality bits for Standard, Pioneer, Modern, Legacy, Vintage and Pauper, plus a bit per format where
  the card is restricted (52 cards, Vintage).
- **Left out:** everything the catalog already has (name, front face's mana cost, type line, mana
  value, colours, power, toughness, loyalty), and **reminder text** (the parenthesised explanation of
  a keyword). Reminder text restates a rule the keyword names, is a fifth of the text, and misleads a
  reader of the text: Ward's reminder says "counter it unless that player pays", which is not a
  counterspell, and a basic land's "({T}: Add {G}.)" is what `produced_mana` says.
- **Keys:** the first 8 hex digits of the Oracle id (`idLength` in the file). The script lengthens the
  prefix until every key is distinct, so a key never names two cards in the same build; if the catalog
  and the text file were built from different Scryfall days, a card new to one of them simply has no
  entry in the other. Full ids would cost 0.5 MB gzipped.
- **Size:** 6.16 MB raw, **1.35 MB gzipped** (gzip level 9), under the 2 MB line. Of the gzipped size,
  the text is 0.89 MB and the keys 0.18 MB. If it must shrink: keywords (0.07 MB, mostly recoverable
  from the text), colour identity (0.05 MB, unused until Commander), the face type lines (0.02 MB);
  splitting Legacy/Vintage-only cards into a second file would cut the most, since over a quarter
  of the cards (9,400 of 34,180) are legal in Legacy and Vintage but not Modern.
- **Loading:** `src/recommend/mtg-text.ts` has the types, a pure `buildMtgTextIndex(file)` (12 ms on
  a desktop, 35 ms to parse the JSON before it) whose `get(oid)` takes a catalog card's Oracle id, and
  `loadMtgText()`, which fetches `mtg/text.json` once through `fetchDataJson`.

## Scoring (`src/recommend/mtg.ts`)

`createMtgEvaluator({ index, text, format })`. Each part is 0..1 with a one-line detail; the total is
the weighted sum, 0..100.

| Part | Weight | What it measures |
| --- | --- | --- |
| rules | 10 | At least 60 cards (more is legal but thins the deck: −1/40 per card over), copy limits, format legality; each problem is also an issue |
| lands | 15 | Mana cards against a target fitted to the curve (below) |
| colours | 15 | Copy-weighted chance that each spell's coloured pips are paid on curve (0.7), and the share of mana cards that make a colour the spells use (0.3) |
| curve | 10 | A play on turns 1–4 (0.6; a play on turn t costs t−1 or t, turn 1 counts half) and the share of spells castable on curve with this many mana cards (0.4) |
| cards | 10 | Card advantage: draw two or more and tutors 1 point, cantrips 0.5, looting 0.4, scry/surveil/look at the top 0.3, each times a cost factor (1 up to mana value 2, 0.85, 0.7, 0.55, 0.4 from 6); 6 points score 0.9 |
| interaction | 10 | Removal and counterspells 1 point, sweepers 1.5 (times the share of the deck's spells that are not creatures), bounce and discard 0.6, each times the cost factor; 8 points score 0.9 |
| threats | 10 | Creatures and planeswalkers: how many (threat points, 14 score 0.9) and how good the best eight are (0.6; a mean threat value of 1.5 is full marks) |
| synergy | 10 | Cards that ask for a creature type, card type, keyword or mechanic find at least 8 copies of it elsewhere in the deck (0.7; a deck with no such cards gets full marks here), and the spells share a theme (0.3; the biggest share holding one creature type, tokens, +1/+1 counters, life gain, sacrifice, artifacts, enchantments, Equipment, Auras or Vehicles, full marks at 40%) |
| focus | 10 | Few colours (0.4: one or two full, three 0.75, four 0.45, five 0.25, raised toward full by the colours part when the mana supports more), copies rather than one-ofs (0.6: copy-weighted share of a playset, three copies, or two for legends and planeswalkers, and a tenth off per one-of beyond two) |

"Points score 0.9" means the part is `1 − e^(−points·ln10/target)`: more always helps a little, so a
damaged deck that loses two removal spells scores lower even when it had plenty.

### Mana, computed

All odds are the hypergeometric distribution over the deck: N cards (60 or the deck's size if
larger), M mana cards, n cards seen by turn t. **n = 6 + t**: the opening hand of seven and one draw a
turn from turn two, for the player on the play, who skips the first draw. The player on the play is
assumed throughout, the harsher case.

- **Mana cards.** A land is 1. A modal double-faced card with a land back face is 0.5. A creature,
  artifact or enchantment of mana value 2 or less with a `{T}: Add` ability is 0.5, and such nonland
  sources stand in for at most two lands in all, because none of them is a land drop.
- **Lands target.** K is the mean mana value of the dearest quarter of the spells, clamped to 2..6
  (fractions interpolate). The target is the fewest mana cards for which P(at least K mana cards by turn
  K) ≥ 60% (`LAND_THRESHOLD`). The 60% is this project's choice; the table follows from it:

  | Dearest quarter costs (K) | 2 | 3 | 4 | 5 | 6 |
  | --- | --- | --- | --- | --- | --- |
  | Mana cards for 60% (of 60) | 14 | 20 | 24 | 27 | 30 |

  Below the target the part is the mean over turns 1..K of P(at least t mana cards by turn t), divided
  by the same mean at the target, so every land counts even far below it (the first version scored
  0 more than five lands short and two builds stopped at one land). Above it, a sixth comes off per
  land past one spare.

  | Mana cards (of 60) | 14 | 16 | 18 | 20 | 22 | 24 | 26 |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | Mean land drops made, turns 1–4 | 0.50 | 0.57 | 0.65 | 0.71 | 0.77 | 0.83 | 0.87 |

- **Colours.** For each spell, on turn t = its mana value, the chance that at least k of the mana
  cards seen are sources of each colour it needs, **given** that at least t mana cards were seen (the
  land count is judged by its own part): Σ over ℓ ≥ t of P(ℓ mana cards) · P(≥ k sources among ℓ),
  over P(≥ t mana cards). Pips are grouped by what pays them: `{R}` needs red, a hybrid `{W/U}`
  either white or blue (CR 107.4e), `{C}` colourless mana; Phyrexian pips (payable with life, CR
  107.4f), `{2/W}`, X and generic pips need no colour. A card with several colours multiplies its
  colours' chances. A land that fetches a basic land type counts as a source of that type's colour;
  one that fetches "a basic land card" counts for the colours of the basic lands in the deck. The
  part maps a mean of 50% to 0 and 90% to 1. Sources a colour needs for 90% on curve, from the same
  function:

  | Pips (24 mana cards) | turn 1 | turn 2 | turn 3 | turn 4 | turn 5 | turn 6 |
  | --- | --- | --- | --- | --- | --- | --- |
  | 1 | 15 | 13 | 11 | 9 | 8 | 7 |
  | 2 | – | 20 | 17 | 15 | 13 | 11 |
  | 3 | – | – | 22 | 19 | 17 | 15 |

  | Pips (17 mana cards) | turn 1 | turn 2 | turn 3 | turn 4 | turn 5 | turn 6 |
  | --- | --- | --- | --- | --- | --- | --- |
  | 1 | 13 | 10 | 8 | 7 | 6 | 5 |
  | 2 | – | 16 | 13 | 11 | 9 | 8 |
  | 3 | – | – | 16 | 14 | 12 | 11 |

### Reading the text

Features are read once per Oracle card (cached across formats) from the text with the card's own name
masked, so a self-reference is not a mention. Roles are regular expressions, checked over every card
legal somewhere (counts of cards matched during development, before the last refinements):
draw two or more 878, cantrip 1,425, loot 380, look ahead 1,212, tutor 356, removal (destroy or exile
a creature, permanent or planeswalker you do not control, damage to a creature or any target, fight,
−N/−N, edicts) about 2,900, bounce 196, counterspell 420, sweeper 566, discard 303, land ramp 283. The
regexes leave out "Whenever you draw a card", partial evasion ("can't be blocked by…"), flicker
("exile …, then return it") and own-permanent targets. Creature types come from the catalog's type
lines (every creature and kindred type, with plurals); a type is asked for when the text counts, buffs
or searches it ("Goblins you control", "other Elves", "Wizard spells", "another Zombie"), not when it
only names it ("can't be blocked by Humans"); types in a "create … token" clause are provided, not
asked for.

**Threat value.** Printed power against the 75th-percentile power of every creature in the catalog at
that mana value (the yardstick is computed from the catalog, not set by hand), capped at 2, times
1.6 for double strike, then up to +25% for evasion (flying, trample, menace, shadow, fear,
intimidate, "can't be blocked"), +15% haste, +10% for lifelink/deathtouch/first strike and +10% for
hexproof/ward/indestructible, capped at 2.5; Vehicles count 0.6 of that. A creature whose power is
`*` gets half the yardstick. A planeswalker is 1.

### Rules relied on

| Rule | Source |
| --- | --- |
| A constructed deck has at least 60 cards; at most four of a card by English name; any number of basic lands | Comprehensive Rules (effective 6 November 2026) 100.2a |
| A card may change that ("A deck can have any number of cards named …", "up to seven/nine …") | the cards' Oracle text; CR 113.6n (abilities that modify deck construction) |
| Opening hand of seven; mulligans | CR 103.5 (mulligans are not modelled) |
| The player who plays first skips their first draw | CR 103.8a |
| One land a turn | CR 305.2 |
| Basic land types and the colour each makes | CR 305.6 |
| A basic land is a land with the supertype basic | CR 205.4c (and `isBasicLand` in `src/games/mtg/catalog.ts`) |
| Mana value; X is 0 outside the stack; a hybrid symbol counts its largest component; split cards add their halves (the catalog's `mv`, Scryfall's `cmc`; the evaluator uses the front half's own value instead) | CR 202.3, 202.3e, 202.3f, 202.3d |
| Hybrid and Phyrexian mana | CR 107.4e, 107.4f |
| Format legality, banned and restricted cards | Scryfall's `legalities` in the bulk file of 2026-11-09 (a snapshot: rotation and bans after that date need a rebuild). "Restricted" is read as one copy; that limit comes from the tournament rules (CR 100.6 points to them), which were not re-read for this document |

Formats offered (`MTG_FORMATS`): Standard, Pioneer, Modern, Legacy, Vintage, Pauper, and "Any format".
"Any" is every card legal in at least one of those six, which keeps out un-cards, ante cards,
conspiracies and other cards no constructed format allows. Pauper legality is Scryfall's flag for the Oracle card,
not the rarity of the printing in the deck.

## Builder side

- **One evaluator per format.** `score()` and `rules.copyLimit` follow the factory's `format`
  (the contract gives `score` no format). `ev.withFormat(f)` makes another evaluator sharing every
  cache, so switching format is cheap. Always build with `options.format` equal to the evaluator's
  format; under Vintage, restricted cards are limited to one copy.
- `kindOf`: creatures and planeswalkers are "pokemon", lands "energy", everything else "trainer".
- `pool`: one printing per card the options allow, skipping the catalog's "Other" category (dungeons,
  conspiracies, stickers…): an owned printing first, else the newest (every Magic printing has a
  picture through its Scryfall id). 5,460 cards under Standard, 32,490 under "any".
- `relevance`: one pass over the pool per round. Everything about the deck is computed once; per
  candidate only lookups (colour bit masks, tag sets, cached features). Same name in the deck ranks
  first, then on-colour lands by the share of the deck's colours they make, then spells by colour fit,
  synergy tags they feed or are fed by, the parts the deck is short of, and a per-card quality (what it
  does for its cost) that breaks ties, so the builder does not see only the alphabetically first
  cards. Only the top ~300 of each kind keep a relevance above zero (`keepTop`, a histogram cut), so
  the builder does not sort a 33k-card pool every round.
- `requirements`: a card that searches for another card by name ("search your library and/or
  graveyard for a card named …", 69 cards) brings that card along when it is not in the deck yet.
- `mtgSeeds(ev, pool, perColour)`: benchmark seeds by rule, the creatures with the highest threat
  value per colour (white, blue, black, red, green, multicoloured), ties to the lower id.

## Timings and memory (desktop, Node, 2026-11-09)

| Step | Time |
| --- | --- |
| Parse `mtg/text.json` | 35 ms |
| `buildMtgTextIndex` | 12 ms |
| `createMtgEvaluator` (catalog-wide power yardstick and creature types) | ~100 ms |
| Features of every card under "any" (first `pool` call; cached after) | ~1.0 s |
| One score | 0.03–0.06 ms |
| `buildDeck` from one seed, Standard | 0.4–0.5 s |
| `buildDeck` from one seed, any format (features warm) | 1.2 s |

Heap after GC: 149 MB for the expanded Magic catalog and its index, +10 MB for the text index, +54 MB
for the features of all 32,490 cards. Phone timings are unmeasured.

## Benchmark (2026-11-09)

`MTG_BENCH=1 npx vitest run src/recommend/mtg.test.ts` builds a deck under Standard from each of 12
seeds (`mtgSeeds(ev, pool, 2)`: Guardian of the Great Door, The Sentry, Golden Guardian, The
Mindskinner, Sleep-Cursed Faerie, Moonshadow, Rot-Curse Rakshasa, Hazoret, Godseeker, Ball Lightning,
Bristlebane Battler, Cactuar, The Gitrog, Ravenous Ride, Chief Warg's Company; ten of them sit at the
threat-value cap of 2.5, so among those the order is power per mana value, then the lower id),
runs `runBench` with `scoreJudges` and Magic damage labels (`spells`: a third of the noncreature spells
swapped for random ones; `lands`: half the lands; `creatures`: a third of the creatures and
planeswalkers), and writes `scripts/.cache/deck-bench/mtg-report.md`. Every built deck is legal with
no issues. `npm test` runs a three-seed version with floors.

Share of decks the judge rates above the damaged version; 5 versions of each deck, seed 1:

| Judge | Mean | Pile | swap-6 | swap-12 | swap-24 | spells | lands | creatures | Order |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Score | 99.79 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 1.00 |
| Deck rules | 1.00 | 100% | 99% | 100% | 100% | 100% | 100% | 100% | 0.78 |
| Lands | 1.00 | 100% | 99% | 100% | 100% | 91% | 50% | 99% | 0.98 |
| Colours | 1.00 | 98% | 85% | 98% | 100% | 73% | 99% | 97% | 0.86 |
| Curve | 1.00 | 100% | 96% | 99% | 100% | 78% | 50% | 93% | 0.98 |
| Card advantage | 1.00 | 100% | 88% | 98% | 100% | 92% | 75% | 92% | 0.93 |
| Interaction | 0.99 | 100% | 81% | 95% | 97% | 98% | 47% | 82% | 0.91 |
| Threats | 1.00 | 87% | 50% | 63% | 53% | 50% | 50% | 100% | 0.41 |
| Synergy | 0.99 | 100% | 88% | 98% | 100% | 76% | 92% | 98% | 0.90 |
| Focus | 1.00 | 100% | 100% | 100% | 100% | 100% | 50% | 100% | 0.91 |

Judged by the "any" evaluator instead (legality off), the total is unchanged (100% everywhere, order
1.00) and only Deck rules moves: 99% pile, 66% / 70% / 89% swap-6/12/24, 64% spells, 69% lands,
67% creatures. Under Standard, then, part of the Deck rules column is legality alone: the random
replacements come from every card printed in the deck's years (`eraPool`), many not legal in
Standard. The total does not depend on it.

What it shows:

- The total tells every built deck from every damaged copy and orders the ladder (1.00).
- **Built decks hit the ceiling** (99.8 of 100): every part is an "enough of it" measure, and the
  builder climbs until each is met. Among decks at the ceiling the score cannot choose; relevance
  breaks the ties. The score cannot rank strong decks against each other, only tell sound from unsound.
- **Swapped lands are invisible to Lands, Curve and Focus** (50%): a random land is still a land.
  Colours catches them (100%) through the share of lands that make the deck's colours.
- **Threats barely sees damage** (order 0.41, 50–63% on swaps): random creatures of the era are often
  as strong on paper as the chosen ones, and printed power says little about what a creature does.
  This is the part a playtest should replace, as on the Pokémon side.
- Built decks lean on the cheapest answers the regexes find (X-cost burn counts at mana value 1), and
  on mana creatures up to the cap; aggressive builds stop at 16–18 lands when the curve tops out
  under 3.

## Known gaps

- **Sideboard and Commander** are not modelled (nor companions, Brawl, Oathbreaker). Colour identity
  is in the file for when Commander comes.
- **Multi-faced cards:** the catalog's cost of a split, adventure or flip card holds both halves
  ("{1}{W} // {1}{W}{W}", 353 cards); the evaluator casts the front half, with that half's own pips
  and mana value (`costMv`), so the other half does not ask for its colour and a split card's curve
  slot is its front half, not the two halves' sum. All faces' text counts for roles, so a
  transforming creature whose back face removes things is counted as removal. Modal double-faced
  spell // land cards count half a land. Meld pairs are not linked.
- **Text reading is regular expressions**: conditional removal ("destroy target creature with power 4
  or greater") counts fully, X spells count at their printed mana value, "enters tapped" lands cost
  only relevance, not score. Card quality beyond these counts (how good a removal spell is) is not read.
- **Threats** read printed power only; `*` power gets half the yardstick; abilities beyond the listed
  keywords are not valued.
- **No mulligans, no play/draw choice:** the odds assume a kept seven on the play.
- **Legality is a snapshot** of Scryfall's flags at build time; Standard rotation and new bans need a
  rebuild of the text file (and of the catalog for new sets).
- **No metagame.** "Competitive" is structural, as on the Pokémon side.

## Registration (for the main session)

- `package.json`: a script such as `"text:mtg": "node scripts/build-mtg-text.mjs"`, run after
  `catalog:mtg`.
- `scripts/data-manifest.mjs`: add `'mtg/text.json'` to `DATA_FILES` (the script already calls
  `writeDataManifest()`), and the expected list in `src/data/manifest.test.ts`.
- Loading: `loadMtgText()` from `src/recommend/mtg-text.ts` (or `fetchDataJson<MtgTextFile>('mtg/text.json')`
  then `buildMtgTextIndex`). Its shape differs from `CardTextFile`, so `textFileFor('mtg')` must not
  hand it to `buildTextIndex`.
- Evaluator: `createMtgEvaluator({ index, text, format })` from `src/recommend/mtg.ts`; formats
  `MTG_FORMATS` (`standard`, `pioneer`, `modern`, `legacy`, `vintage`, `pauper`, `any`), the same list
  as `ev.formats`. Create it (or `ev.withFormat`) with the format the user picked.
- Benchmark: `mtgSeeds` and the Magic damages in `src/recommend/mtg.test.ts` can move into
  `src/recommend/bench/` when the benchmark grows a Magic corpus.

## What the builder would need changed

1. **The format should reach `score` and `rules.copyLimit`** (`score(cards, format?)`, or a
   `rules(format)`), so one evaluator serves every format; today each format needs its own evaluator.
2. **`MTG_DECK_RULES.copyLimit` does not know the cards that allow more copies** (Relentless Rats,
   Persistent Petitioners, Seven Dwarves, Nazgûl and nine others) or Vintage's restricted list, so the
   deck page flags them wrongly; the evaluator's `rules` gets them right from the text.
3. **`candidateMoves` sorts every candidate with relevance above zero each round**; with 33k Magic
   cards that is most of a build's time, which the evaluator works around by zeroing all but the top
   ~300 of each kind. A partial top-k selection in the builder would remove the need.
4. **Copies come one at a time**, and the focus part frowns on one-ofs, so a new card's first copy
   often loses to a fourth copy of something already in. A move that adds a playset (or two copies)
   would let the builder try new cards fairly.
5. **The score ceiling**: once every part is met the swap phase stops (a swap must gain more than
   0.05). Breaking ties among ceiling decks by relevance, or a playtest judge, would need the builder
   to accept moves of equal score.
