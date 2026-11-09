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
| rules | 10 | 60 cards, four copies at most (basic Energy excepted) |
| basics | 10 | Hypergeometric chance of no Basic Pokémon in the opening seven; full marks at 25% or less |
| lines | 10 | Every evolution has its earlier stage in enough copies; a Stage 2 may stand on Rare Candy plus its Basic |
| energy | 15 | Basic Energy of the attackers' types (Special Energy counts half, its conditions being unread), in an amount fitted to the attack costs less the deck's Energy acceleration |
| draw | 15 | Cards that draw (up to 8) and cards that search the deck (up to 10, Energy search and acceleration at half) |
| power | 10 | The best attack of a line of two or more, against the 90th-percentile HP of Pokémon printed in the deck's own years |
| synergy | 10 | Trainers and Abilities that name a type, stage, suffix (ex, V, …) or species have it in the deck |
| focus | 10 | Pokémon are 15–35% of the deck, the two biggest lines hold most of them, few one-ofs |
| era | 10 | The Pokémon's printing years span a few years; the Trainers had a printing within a year of that span |

Features come from regular expressions over the text (draw, search, acceleration, switch, gust,
heal, recovery, disruption, Rare Candy) plus the structured fields (cost letters, damage, evolves
from, Energy type). Species mentions use the Pokédex species list, longest name first.

## Builder (`src/recommend/builder.ts`)

- `suggestAdds`: ranks the pool by relevance to the deck (evolution relations, shared types, met
  mentions, Energy the attackers need, era), scores the top candidates (half Pokémon, a third
  Trainers, the rest Energy) with their required pre-evolutions, and returns the best gains with the
  part that gained most as the reason.
- `suggestSwaps`: removes one copy of each of the six lines that carry least and asks for adds.
- `buildDeck`: seeds (by id, or by name when the printing is outside the chosen format), greedy
  adds to 60, then swaps while they help. About 0.3 s on a desktop for a full build; a score is
  arithmetic over cached features (about 0.06 ms).
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

- Special Energy conditions, ACE SPEC and Radiant one-per-deck limits, Prism Star, and Stadium
  copies (only one is ever in play) are not read; the rules part only knows the four-copy limit.
- Standard legality comes from TCGdex's flags, which are a snapshot at catalog build time.
- "Competitive" is structural. A meta layer would need Limitless TCG's API (keys are given to
  public-facing projects on request) or another source whose terms allow it.
- Yu-Gi-Oh! and Magic: `DeckEvaluator` is game-neutral and `textFileFor` returns null for them; each
  needs its own text file (YGOPRODeck `desc`, Scryfall Oracle text) and evaluator.
