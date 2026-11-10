# Deck benchmark

The regression harness for the deck recommender (`docs/deck-recommender.md`): it measures whether a
judge tells good decks from bad ones, records the answer as a baseline, and fails when a later change
makes a judge worse. Code in `src/recommend/bench/`; nothing in it ships with the app.

## What it measures

A **judge** rates a deck with one number, higher is better: `{ id, label, rate(cards) }`. There are
three families:

- **the score**: the evaluator's total and each of its nine parts (`scoreJudges`);
- **the playtest** (`playtestJudges`, 200 solo games a deck with the simulator of `deck-playtest.md`):
  attacking by turn three, by turn four, damage per turn, turns with a play;
- **duels** (`duelJudge`): the deck's simulated win rate against a field of six decks of its own
  corpus, 20 games a pairing.

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
(`simulatedDuel`) into a strength per deck, for corpora that have no real results.

## Running it

- `npm test` runs `bench.test.ts`: the arithmetic, and a small run over decks the engine builds from
  one Stage 2 seed per Energy type under Standard, with floors on what the score must still catch.
- `npm run deck-bench` runs the full benchmark (`local.bench.ts`, about two minutes): decks built from
  four seeds per type, plus every corpus folder under `scripts/.cache/decks/`. The score judges run
  on every deck with five damaged copies of each kind; the playtest judges on 80 decks of a corpus
  with three; the duel judge on 40 with one (reports `<corpus>`, `<corpus>:playtest`,
  `<corpus>:duel`). It writes
  `scripts/.cache/deck-bench/report.md` and fails when a judge fell more than 0.03 behind
  `src/recommend/bench/baseline.json`.
- `npm run deck-bench:update` records the current numbers as the baseline. Do it on purpose, after
  reading the report, and say why in the commit. Run the benchmark after a catalog or card-text
  refresh, since built decks change with the pool.

## Local corpora

Deck lists we may not ship live under `scripts/.cache/decks/<corpus>/` (ignored by git); only
aggregate rates reach the baseline. A folder holds JSON files, each an array of
`{ id, name, strength?, cards: [{ id, name, count }] }`; a card is found by id, else by name. A
corpus the baseline knows and the machine lacks is noted in the report, not failed.

| Corpus | What | How to get it |
| --- | --- | --- |
| `pokemon-tcg-data` | 186 theme and starter decks of `PokemonTCG/pokemon-tcg-data` (`decks/en`); no licence (`pokemon-deck-sources.md`) | download those files into the folder |
| `limitless-archetypes` | 46 Standard archetypes with at least 60 matches: the best-placed list of each, strength = the archetype's match win rate | `node scripts/fetch-limitless-decks.mjs` |
| `limitless-lists` | 346 single Standard lists with at least six matches, strength = the list's own match win rate | the same run |

The Limitless corpora come from the tournament platform's public, key-free API (36 events of 64
players or more, late October to early November 2026; about five minutes at one request every
seven seconds). The API states no licence, so this is local validation only, as judged in
`deck-results-sources.md`: raw responses, with player handles, stay in `scripts/.cache/limitless/`,
and the corpora carry none. Every list line mapped to a catalog card by set code and number.

## Baseline (2026-11-09, 1.9.0)

Share of decks the judge rates above the damaged version (a tie counts half); "Real" is the rank
correlation of the judge with the corpus's real win rates.

Tournament lists (`limitless-lists`):

| Judge | Mean | Pile | swap-6 | swap-12 | swap-24 | trainers | energy | pokemon | Order | Real |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Score | 89.9 | 100% | 95% | 99% | 100% | 88% | 92% | 98% | 0.98 | 0.14 |
| Attacking by turn 3 | 44% | 99% | 88% | 95% | 98% | 78% | 66% | 88% | 0.91 | 0.01 |
| Damage per turn | 72 | 100% | 93% | 99% | 100% | 72% | 74% | 93% | 0.96 | 0.11 |
| Turns with a play | 89% | 100% | 89% | 96% | 99% | 74% | 70% | 82% | 0.94 | 0.05 |
| Wins against the field | 42% | 100% | 81% | 81% | 87% | 50% | 65% | 85% | 0.83 | 0.08 |

How the kinds of deck compare when played (means):

| Corpus | Score | Attacking by turn 3 | Damage per turn | Turns with a play |
| --- | --- | --- | --- | --- |
| Theme decks (`pokemon-tcg-data`) | 74 | 10% | 22 | 74% |
| Built by the engine, score only, first version | 98.5 | 16% | 45 | 78% |
| Built by the engine, score only, after calibration | 99.3 | 26% | 69 | 82% |
| The same, with resting attacks played as printed (1.10.8) | 99.2 | 23% | 64 | 82% |
| Built and tuned by play (ten seeds, eight rounds) | 94 | 35% | about 100 | |
| Tournament archetypes (`limitless-archetypes`) | 88 | 45% | 68 | 87% |
| Tournament lists (`limitless-lists`) | 90 | 44% | 72 | 89% |

What the runs showed, in the order they changed the engine:

- **Swapped Energy was nearly invisible to the Energy part** (55% on built decks, 50% on theme
  decks). Reading what each Energy provides and to whom, and counting Energy no attacker can use as
  dead cards, brought the total to 98% on built decks and 90 to 92% on tournament lists.
- **The score saturates.** Decks built on it scored 98.5 and attacked by turn three in 16% of games,
  where tournament lists reach 44%. Playing found what counting could not: too little Energy, too
  few copies of the attacker, orphaned evolution lines. Calibrating the score against the simulator
  took built decks to 26% and 69 damage a turn; tuning by play takes them to 35% and about 100.
- **A big number that lands every other turn was counted every turn** (1.10.8, from a player's deck
  whose check "played toward" a 140 attack that bars its user from attacking next turn). The pilot
  now sits that turn out and the plan and the Power part count what an attack keeps up. Seven of the
  forty built decks had leaned on such an attack: measured honestly, built decks fall from 26% and
  69 to 23% and 64, and the decks the old engine built measure the same (64) under the new pilot,
  so the builder is no worse, only seen more clearly. Tournament lists did not move (44%, 72): they
  seldom rest. The same round found three holes the built decks fell into: 143 Stage 1 and Stage 2
  cards with no "evolves from" in the card data passed for Basics (now taken from another printing
  of the name), one Energy of a type passed for covering every attacker of that type (now counted in
  full from three copies), and "build another" put a seed's own earlier stages on its avoid list.
- **Swapped Trainers stay the hardest damage** for every judge (88% for the score, 72 to 78% played,
  50% in duels): a random Trainer of the era often draws or searches too, and the test pilot cannot
  use many Trainers at all.
- **No judge predicts real results yet.** Among tournament lists the score follows real win rates
  weakly (0.14, up from 0.06 before calibration; 0.18 over archetypes), solo play not at all, and
  simulated duels no better (0.08). Lists that reach a tournament are all well built; what
  separates them is matchups and piloting, which a goldfish pilot that reads no disruption cannot
  see. This column is the one to move.
- Deck rules, Basic Pokémon, Synergy and Era sit near 50% everywhere: checks a pile passes as easily
  as a deck, not measures of quality.

## Limits

- Built decks maximise the score, so the score judges pass on them by construction; that corpus
  exists for judges independent of the score.
- Theme decks are weak decks: they run far more Energy than fits, so removing some reads as better.
  Tournament lists are the corpus to trust.
- Real win rates are noisy (a list's six to ten matches) and come from mixed-skill online events.
- A random swap is not always worse: it can remove a surplus card. The ladder still orders decks
  well (0.9 and above) because most swaps hurt.
- Pokémon only, like the evaluator; the harness itself reads the game through `DeckEvaluator`
  (`kindOf`, `card`) and will run a Yu-Gi-Oh! or Magic evaluator unchanged, with its own damage labels.
