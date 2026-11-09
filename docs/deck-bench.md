# Deck benchmark

The regression harness for the deck recommender (`docs/deck-recommender.md`): it measures whether a
judge tells good decks from bad ones, records the answer as a baseline, and fails when a later change
makes a judge worse. Code in `src/recommend/bench/`; nothing in it ships with the app.

## What it measures

A **judge** rates a deck with one number, higher is better. Today the judges are the evaluator's total
and each of its nine parts (`scoreJudges`). A playtest result (share of games attacking by turn three)
or a win rate plugs in the same way: `{ id, label, rate(cards) }`.

A **corpus** is a set of decks. For every deck the harness makes known-worse versions (`damage.ts`),
defined by structure only so that no judge is marked against its own opinion:

| Version | What it is |
| --- | --- |
| pile | as many different random cards as the deck has, printed within a year of the deck's own years |
| swap-6, swap-12, swap-24 | that many copies swapped for random cards of those years |
| trainers | a third of the Trainers swapped for random Trainers |
| energy | half of the Energy swapped for random Energy |
| pokemon | a third of the Pokémon swapped for random Pokémon |

Per judge the report gives the share of decks rated above each version (a tie counts half, so 50%
means the judge cannot see the damage), **order** (how well the rating follows original > swap-6 >
swap-12 > swap-24 > pile, 1 is perfect), and, when the corpus knows how strong its decks really are,
**strength** (rank correlation of the rating with that strength). `roundRobin` turns a duel function
into a strength per deck, which is how the playtest simulator's head-to-head results will become
ground truth for the cheaper judges.

## Running it

- `npm test` runs `bench.test.ts`: the arithmetic, and a small run over decks the engine builds from
  one Stage 2 seed per Energy type under Standard, with floors on what the score must still catch.
- `npm run deck-bench` runs the full benchmark (`local.bench.ts`, about 20 s today): decks built from
  four seeds per type, plus every corpus folder under `scripts/.cache/decks/`. It writes
  `scripts/.cache/deck-bench/report.md` and fails when a judge fell more than 0.03 behind
  `src/recommend/bench/baseline.json`.
- `npm run deck-bench:update` records the current numbers as the baseline. Do it on purpose, after
  reading the report, and say why in the commit. Run the benchmark after a catalog or card-text
  refresh, since built decks change with the pool.

## Local corpora

Deck lists we may not ship live under `scripts/.cache/decks/<corpus>/` (ignored by git); only
aggregate rates reach the baseline. A folder holds JSON files, each an array of
`{ id, name, strength?, cards: [{ id, name, count }] }`; a card is found by id, else by name. The
one corpus so far is `pokemon-tcg-data`: the 186 theme and starter decks of
`PokemonTCG/pokemon-tcg-data` (`decks/en`), which has no licence (see `pokemon-deck-sources.md`). To
get it back on another machine, download those files into that folder. A corpus the baseline knows
and the machine lacks is noted in the report, not failed.

## First baseline (2026-11-09)

Share of decks the judge rates above the damaged version; 5 versions of each deck, seed 1.

Decks built from 40 seeds (Standard):

| Judge | Pile | swap-6 | swap-12 | swap-24 | trainers | energy | pokemon | Order |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Score | 100% | 100% | 100% | 100% | 98% | 75% | 100% | 0.99 |
| Evolution lines | 100% | 97% | 100% | 100% | 52% | 50% | 100% | 0.97 |
| Energy | 100% | 100% | 100% | 100% | 75% | 55% | 100% | 0.94 |
| Draw and search | 100% | 71% | 82% | 90% | 78% | 53% | 50% | 0.85 |
| Power | 98% | 56% | 64% | 73% | 50% | 50% | 72% | 0.67 |
| Focus | 100% | 100% | 100% | 100% | 50% | 50% | 100% | 1.00 |

`pokemon-tcg-data`, 186 theme decks:

| Judge | Pile | swap-6 | swap-12 | swap-24 | trainers | energy | pokemon | Order |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Score | 100% | 97% | 99% | 99% | 77% | 90% | 98% | 0.93 |
| Evolution lines | 96% | 94% | 97% | 97% | 50% | 50% | 97% | 0.90 |
| Energy | 100% | 96% | 94% | 69% | 50% | 50% | 99% | 0.72 |
| Draw and search | 63% | 55% | 57% | 57% | 70% | 45% | 48% | 0.18 |
| Power | 46% | 49% | 51% | 51% | 50% | 50% | 60% | -0.04 |
| Focus | 100% | 100% | 100% | 100% | 50% | 50% | 100% | 0.99 |

What the first run shows:

- The total separates a deck from a pile and from any random swap almost always. Most of that comes
  from two parts, Focus and Evolution lines, which react to any foreign card.
- **Swapped Energy is nearly invisible to the Energy part** (55% and 50%): it counts Energy without
  caring enough which Energy. On theme decks the total only notices through Synergy.
- **Power does not tell a theme deck from a pile** (46%, order −0.04), and Draw and search barely
  does (63%). These are the parts a playtest should replace.
- Swapped Trainers are the hardest damage for the total on real decks (77%): a random Trainer of the
  era often draws or searches too. Only play can tell which Trainers a deck needs.
- Deck rules, Basic Pokémon, Synergy and Era sit near 50% everywhere: they are checks a pile passes
  as easily as a deck, not measures of quality.

## Limits

- Built decks maximise the score, so the score judges pass on them by construction; that corpus
  exists for judges independent of the score.
- Theme decks are weak decks. Without lists that carry real results, "good" here means "better than
  its own damaged copy", not "wins".
- Pokémon only, like the evaluator; the harness itself reads the game through `DeckEvaluator`
  (`kindOf`, `card`) and will run a Yu-Gi-Oh! or Magic evaluator unchanged, with its own damage labels.
