# Deck recommender

An in-house deck-building engine: it scores a deck on rules of thumb computed from the cards' own
rules text, and a game-neutral builder turns that score into suggestions while a deck is built by
hand, swaps for an existing deck, and whole decks grown from a seed card. Nothing is learned from
published decks (no source we may ship exists for Pokémon; see `pokemon-deck-sources.md`), so the
engine can propose decks nobody has played, and "competitive" here means rule-legal, consistent and
synergistic rather than matching a tournament meta.

Phase 1 (this document) is the data and the engine for Pokémon, with tests. The deck page and a
"Build a deck" page come next; Yu-Gi-Oh! and Magic evaluators after that (their catalogs have no
rules text yet either).

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
| energy | 15 | Energy of the attackers' types, per attacker: Basic Energy covers a type outright, a Special Energy covers it for the Pokémon its text provides it to (half where a condition is unread), in an amount fitted to the attack costs less the deck's Energy acceleration |
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

## Validation (2026-11-09, not committed)

The 186 theme and starter decks of `PokemonTCG/pokemon-tcg-data` (unlicensed, so used only
locally, never shipped) were scored against a random pile of 60 distinct cards from the same years
and against a copy with a third of the Trainers replaced by random Trainers of the era:

- every real deck outscored its era's random pile (mean 75.5 vs 53.6);
- real decks beat their damaged copy 118 of 186 times (theme decks are weak decks, and a random
  Trainer of the era often draws or searches too);
- part means over the real decks: rules 0.94, basics 0.95, lines 0.90, energy 0.47 (theme decks run
  16–20 Energy, far over the fitted amount), draw 0.32, power 0.62, synergy 0.87, focus 0.72, era 0.95.

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
- "Competitive" is structural. A meta layer would need Limitless TCG's API (keys are given to
  public-facing projects on request) or another source whose terms allow it.
- Yu-Gi-Oh! and Magic: `DeckEvaluator` is game-neutral and `textFileFor` returns null for them; each
  needs its own text file (YGOPRODeck `desc`, Scryfall Oracle text) and evaluator.
