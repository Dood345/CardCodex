# Deck recommender

An in-house deck-building engine: it scores a deck on rules of thumb computed from the cards' own
rules text, and a game-neutral builder turns that score into suggestions while a deck is built by
hand, swaps for an existing deck, and whole decks grown from a seed card. Nothing is learned from
published decks (no source we may ship exists for Pokémon; see `pokemon-deck-sources.md`), so the
engine can propose decks nobody has played, and "competitive" here means rule-legal, consistent and
synergistic rather than matching a tournament meta.

This document covers the data and the engine for Pokémon, tuning by play, and how the app uses the
engine for all three games. Yu-Gi-Oh! and Magic have their own documents (`deck-recommender-ygo.md`,
`deck-recommender-mtg.md`); the playtest simulator is in `deck-playtest.md` and the benchmark in
`deck-bench.md`.

## Data: `public/data/text.json`

`npm run text` (`scripts/build-text.mjs`) asks TCGdex's GraphQL endpoint, the catalog's own source,
for every card's attacks, Abilities, Trainer and Energy effects, weakness, resistance, retreat cost,
what it evolves from, regulation mark and Standard/Expanded legality. The file holds each distinct
text once (reprints share one) and per card the text index, mark and legality bits; 21,428 of
21,432 catalog cards have text (the four without are blank promos). 4.6 MB raw, 0.8 MB gzipped. The
app loads it only for the recommender (`src/recommend/card-text.ts`), never for the Pokédex, search
or scanner. A dozen cards have an attack without a name, which the GraphQL schema rejects; the
script fetches those over REST and splices them in.

## Scoring (`src/recommend/pokemon.ts`)

Each part is 0..1 with a one-line detail; the total is the weighted sum, 0..100.

| Part | Weight | What it measures |
| --- | --- | --- |
| rules | 10 | 60 cards, four copies at most (basic Energy excepted), and the limits below: each broken limit costs a quarter of the part |
| basics | 10 | Hypergeometric chance of no Basic Pokémon in the opening seven; full marks at 25% or less |
| lines | 10 | Every evolution has its earlier stage in enough copies; a Stage 2 may stand on Rare Candy plus its Basic |
| energy | 15 | Energy of the attackers' types, per attacker: Basic Energy covers a type outright, a Special Energy covers it for the Pokémon its text provides it to (half where a condition is unread), in an amount fitted to the attack costs less the deck's Energy acceleration; only Energy some attacker can use counts toward the amount (Basic Energy of an unused type, or a Special Energy that gives these attackers nothing, does not) |
| draw | 15 | Cards that draw (up to 8) and cards that search the deck (up to 10, Energy search and acceleration at half); at most 3 Stadium copies count |
| power | 10 | The best attack of a line of two or more, against the 90th-percentile HP of Pokémon printed in the deck's own years |
| synergy | 10 | Trainers and Abilities that name a type, stage, suffix (ex, V, …) or species have it in the deck (at most 3 Stadium copies count) |
| focus | 10 | Pokémon are 15–35% of the deck, the two biggest lines hold most of them, few one-ofs |
| era | 10 | The Pokémon's printing years span a few years; the Trainers had a printing within a year of that span |

Features come from regular expressions over the text (draw, search, acceleration, switch, gust,
heal, recovery, disruption, Rare Candy) plus the structured fields (cost letters, damage, evolves
from, Energy type). Species mentions use the Pokédex species list, longest name first.

### Deck limits

The limits are data in `src/recommend/pokemon.ts` (`GROUP_LIMITS`, `NAME_LIMITS`), read once per card into
its features (`groups`, `nameMax`). A deck that breaks one gets a line in `DeckScore.issues` ("ACE SPEC: 2 in
the deck (Prime Catcher, Master Ball), 1 at most", "Lunala ◇: 2 copies, 1 at most") and loses a quarter of the
rules part. Counts are of the catalog at 2026-11-09:

| Limit | Recognised by | Cards |
| --- | --- | --- |
| One ACE SPEC card in total | rarity "ACE SPEC Rare" (sv05 to sv08.5), or a reprint sharing such a card's text; the Black & White prints are rated plain "Rare", so they are the Item and Tool cards rated Rare in bw7 to bw10 (inferred, see below) | 33 + 13 |
| One Radiant Pokémon in total | the name starts with "Radiant " (15 rated "Radiant Rare", the promo Radiant Eevee "Ultra Rare") | 16 |
| One copy of each Prism Star card | ◇ after the name (16 Pokémon, 9 Trainers, 2 Energy) | 27 |
| One copy of a card whose text says so | "You can't have more than N <its own name> in your deck" (only Miracle Energy) | 1 |

The text data never states the ACE SPEC, Radiant or Prism Star rules, and the Black & White ACE SPEC prints
carry no mark at all; they are recognised by a pattern (every Rare-rated Item or Tool of Boundaries Crossed to
Plasma Blast, none of Dragon Vault's Rare Items, none of the Rare Supporter Ghetsis), which three of them
confirm by being reprinted as "ACE SPEC Rare" (Master Ball, Scramble Switch, Scoop Up Cyclone). The evaluator
folds the per-name limits into `ev.rules.copyLimit` (the deck page keeps `POKEMON_DECK_RULES`, which says
four), and answers `ev.fits(cards, adds)` for the group limits.

**Stadiums** are not a legality rule, but only one is in play at a time. `STADIUM_CREDIT` (3) copies,
shared across all Stadium names, earn credit in the draw, search and synergy parts and in the Energy
acceleration count; further copies earn none. Focus counts only Pokémon and needed no change.

**Special Energy** (214 non-basic Energy cards) are read by `parseEnergyText` into an `EnergyRule`: the types
it provides ("every type", Colorless only, a list), an attach restriction ("can only be attached to a Grass
Pokémon", an Evolved Pokémon), and conditional upgrades (every type on a Stage 2 or a Basic Pokémon).
`energyCredit` then says per attacker and type whether the card covers it: 1 when the text says it does, 0
when it does not or the Pokémon may not hold it, 0.5 where a condition cannot be read (Prize cards, a stacking
rule, a group the catalog does not record such as Ultra Beast, Rapid Strike or Fusion Strike unless the printed
name says it). Of the 214, 85 provide only Colorless, 85 provide types readably (11 behind a restriction on a
readable class), 41 keep half weight somewhere, and 3 (the me06 reprints) have no text at all and stay Colorless
only. Amounts ("2 Energy at a time") are read into `amount` but the Energy count still counts cards.

## Builder (`src/recommend/builder.ts`)

- `suggestAdds`: ranks the pool by relevance to the deck (evolution relations, shared types, met
  mentions, Energy the attackers need, era), scores the top candidates (half Pokémon, a third
  Trainers, the rest Energy) with their required pre-evolutions, and returns the best gains with the
  part that gained most as the reason.
- `suggestSwaps`: removes one copy of each of the six lines that carry least and asks for adds.
- `buildDeck`: seeds (by id, or by name when the printing is outside the chosen format; a seed the
  limits forbid is left out and reported in `dropped`), greedy adds to 60, then swaps while they help. About 0.3 s on a desktop for a full build; a score is
  arithmetic over cached features (about 0.06 ms).
- Limits: candidates are filtered by `rules.copyLimit` (four copies, Prism Star, stated limits) and by
  the evaluator's `fits` (ACE SPEC, Radiant) on the whole move, requirements included, so no
  suggestion, swap or built deck breaks one; the check lives in the evaluator, the builder calls it
  when it exists.
- Options: source (collection only, catalog, or catalog preferring owned), format (Standard,
  Expanded, any, from TCGdex's legality flags), names to avoid (for variety against the user's other
  decks).

## Tuning by play (`src/recommend/tune.ts`)

The score counts cards and saturates: the first decks the builder made scored 98 of 100 and attacked
by turn three in one game out of six (`deck-bench.md`). An evaluator that can play a deck
(`DeckEvaluator.playtest`; Pokémon wraps the simulator of `deck-playtest.md` in
`src/recommend/pokemon-play.ts`) lets the builder go on where the score stops:

- A round plays the deck without one copy of each line to find the copy it misses least, then with
  each candidate in its place (another copy of what the deck plays, and the pool's most relevant
  cards). Every candidate of a round is played with the same seed, 120 games each.
- The best swap is played again on 400 fresh games against the unchanged deck and kept only if it
  still wins by more than 1%, costs at most 3 points of score, adds no rule issue, and leaves the
  test pilot playing toward the card the deck was built around.
- The value climbed is the mean damage per turn over the first six turns, scaled by how often the
  deck had a play. It is a solo measure: no opponent, no Prize race.
- On the ten Standard seed decks eight rounds take about 3 s a deck on a desktop and raise attacking
  by turn three from 19% to 35% of games (tournament lists: 45%).

What tuning kept asking for went back into the score, so the two agree more often: the Energy amount
follows the main attacker's cost (`4 + 3 × cost`, less a little for acceleration, 6 to 16), falls in
proportion when short, and counts Energy that powers nothing as dead cards; an attacker has full
credit at three copies; Basic Energy is relevant to attackers that pay in Colorless only.

## In the app

- `src/recommend/index.ts` is the registry: `hasRecommender(game)` and `loadEvaluator(index)`, which
  loads a game's evaluator and text file on first use. `src/recommend/advice.ts` holds what the
  screens ask as plain functions (`advise`, `describeMove`, `namesInDecks`, `seedIdeas`).
- **Deck check** (`src/pages/deck/DeckAdvisor.tsx`), on every deck page that follows the game's
  default rules: score and parts, issues, cards to add or swaps with reasons, the playtest lines,
  "Find a swap by playing" (one tuning round) and practice hands.
- **Build a deck** (`src/pages/DeckBuildPage.tsx`, `#/decks/build`, `#/decks/build/<card id>`): one
  to three seeds or an idea (`DeckEvaluator.seedIdeas`), source and format, the built deck with its
  score, playtest, "Tune by playing" (eight rounds, one per timer tick), "Keep this deck" and
  "Build another" (avoids the last attempt's cards).
- Contract additions for the screens and the other games (`src/recommend/types.ts`): `formats` with
  a default, `forFormat` (an evaluator per format where the format changes the rules), `complete`
  (the builder fills the first section, the evaluator adds the rest: a Yu-Gi-Oh! Extra Deck),
  `playtest`, `practice` (an opening hand by the game's rules; `practice.ts` has the plain shuffle),
  `seedIdeas`.

## The other games

- **Yu-Gi-Oh!**: `docs/deck-recommender-ygo.md`. Seven parts (rules with the TCG list, consistency
  as the chance of opening no starter, bricks, cohesion, interaction, Extra Deck access, shape);
  builds a 40-card Main Deck and completes an Extra Deck the Main Deck can make.
- **Magic**: `docs/deck-recommender-mtg.md`. Nine parts (rules and legality, lands, colours on
  curve by the hypergeometric distribution, curve, card advantage, interaction, threats, synergy,
  focus) for 60-card decks under Standard to Vintage. Commander decks get no check.
- Neither has a playtest simulator, so their decks are scored, not played, and "Tune by playing" is
  not offered. Their Build-a-deck ideas are the evaluator's own seeds (Magic) or the monsters with
  the highest ATK (Yu-Gi-Oh!).

## Validation

`deck-bench.md` holds the benchmark: every judge (the score, each part, the playtest, simulated
duels) against decks and their known-worse copies, over engine-built decks, 186 theme decks and 392
tournament lists with their real win rates, with a recorded baseline.

## Known gaps

- Pokémon ☆ / ★ (24 cards, Mudkip ☆ to Umbreon ☆): their one-per-deck rule is in neither the text nor the
  catalog, so it is not enforced.
- The Black & White ACE SPEC prints are recognised by a pattern, not by anything the data states (see
  Deck limits). A new print of a pre-Scarlet ACE SPEC under another rarity label would be missed.
- Special Energy: conditions about Prize cards, other attached Energy, and groups the catalog does not
  record (Ultra Beast, Rapid Strike, Fusion Strike, Team Rocket's) keep half weight; the amount an Energy
  provides ("2 at a time") is not yet counted, so a Double Colorless Energy counts as one.
- Energy coverage is by type, not by amount: one Basic Fire Energy and one Legacy Energy both cover a Fire
  attacker fully; the amount part fits the card count to the attack costs.
- Standard legality comes from TCGdex's flags, which are a snapshot at catalog build time.
- "Competitive" is still structural plus solo play. Among tournament lists neither the score nor the
  playtest follows the real win rates (`deck-bench.md`); a meta layer that ships derived tournament
  data needs the permission asked for in `deck-results-sources.md`.
- Build-a-deck seeds: a Yu-Gi-Oh! Extra Deck monster cannot be a seed yet (the pool holds Main Deck
  cards), and Yu-Gi-Oh! ideas are picked by ATK rather than by archetype.
- Magic: no sideboard advice, no Commander check (commander, colour identity).
- The builder adds one copy at a time, which favours a fourth copy over a new card's first.
