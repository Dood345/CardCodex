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

**Card text followed.** Alongside the judges, the harness measures how much of the cards' text the
test pilot follows (`src/recommend/sim/coverage.ts`, described in `deck-playtest.md`): per corpus, by
copies, the share of Trainer copies played with every sentence of their text accounted for, of
Ability copies used the same way, of Special Energy copies whose text is followed beyond the type
provided, and of damaging attack copies whose text is fully acted on; and the same four over the
Standard pool, one printing per name (`standard-pool`). A sentence counts only when the engine
applies it or it is on the explicit no-op list, never because a pattern matched. The shares sit in
the baseline next to the judges and any drop fails the run; the report lists the largest groups not
followed with example card names.

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

## Card text followed (2026-11-10, first measurement)

Share of copies whose text the pilot follows in full, as `coverage.ts` counts it (every sentence read
into an effect the engine applies, or on the no-op list). These are the numbers before any card
family was read more closely; the 1.10.8 audit's looser count (a pattern matched somewhere in the
text) gave 57% of Trainer copies and 41% of Ability copies for the tournament lists.

| Corpus | Trainers | Abilities | Special Energy | Damaging attacks |
| --- | --- | --- | --- | --- |
| Tournament lists (`limitless-lists`, 346) | 30.3% of 10,678 | 23.4% of 3,682 | 0% of 843 | 52.3% of 7,142 |
| Tournament archetypes (46) | 31.6% | 21.9% | 0% | 52.0% |
| Theme decks (`pokemon-tcg-data`, 186) | 30.5% | 9.9% | 0% | 43.6% |
| Built by the engine (40) | 35.0% | 26.2% | 0% | 54.1% |
| Standard pool, one printing per name | 14.4% of 229 | 11.8% of 229 | 0% of 18 | 44.6% of 1,448 |

The largest groups not followed on the tournament lists: for Trainers, an `instead` or `only if`
clause (Lillie's Determination, Special Red Card, Rosa's Encouragement; 12%), a search narrower than
the pilot's ("a Pokémon that doesn't have a Rule Box", Poké Pad; 9%), gust (8%), text about the
opponent's hand or deck (Judge, Area Zero Underdepths, Prism Tower; 7%), recovery from the discard
pile (Night Stretcher; 6%); for Abilities, passive ones (35%) and a condition on an activated one
(Munkidori, Fezandipiti ex, Teal Mask Ogerpon ex; 23%); for attacks, coin flips (7%), locks (5%),
putting the attacker back into the hand (Meowth ex; 5%), bonus damage on a condition (4%), damage per
Benched Pokémon (4%), Special Conditions (4%), Bench damage (4%) and damage per Energy (4%). No
Special Energy is followed beyond the type it provides.

## Attack text read (2026-11-10)

The pilot reads what an attack's text does to its damage (`deck-playtest.md`, Expected damage):
scaling by a count, a bonus on a condition, coin flips on the game's stream, "does nothing" unless,
Weakness and Resistance ignored. The plan, the Power part and the plan line share one figure on a
stated typical board. Damaging attack copies followed in full: tournament lists 52.3% → 73.3%,
archetypes 52.0% → 73.1%, theme decks 43.6% → 60.9%, the Standard pool 44.6% → 62.4%.

| Judge, tournament lists | Before | After |
| --- | --- | --- |
| Attacking by turn 3 (mean) | 44% | 50% |
| Attacking by turn 4 (mean) | 59% | 64% |
| Damage per turn (mean) | 72 | 87 |
| Damage per turn, rank correlation with real win rates | 0.16 | 0.29 |
| Attacking by turn 3, the same | 0.01 | 0.22 |
| Wins against the field, beats pile | 97% | 95% |

The ladders of the tournament lists are within a few points of before either way: coin flips add
variance to 200-game means, so near ties fall either side. Two wrong turns were found on the way and
are recorded in `deck-playtest.md`: crediting every condition half made Dhelmise's conditional 130
the plan over Banette's 80 (the deck's damage halved: a condition now counts only when the pilot can
bring it about and the deck holds the means), and crediting two Prize cards taken made Pecharunt ex's
60-per-Prize-card attack a plan that hit for nothing against random piles (the typical board now has
none taken). Built decks measure lower under the new pilot (attacking by turn 3 23% → 20%, damage 64
→ 61): the decks the old score built measure 21% and 62 under it, so most of the drop is the honest
recount of coin flips and conditions, and a little is the score now building toward scaling attacks.

## Attack costs read (2026-11-10)

The pilot pays what an attack's text costs its user and does to its own side (`deck-playtest.md`,
Attack costs): Energy discarded or put back, "any amount" discarded for a Knock Out, damage to
itself and to its own Bench, the attacker returned to the hand, optional costs paid for a Knock Out.
Damaging attack copies followed in full: tournament lists 73.3% → 81.0%, archetypes 73.1% → 80.1%,
theme decks 60.9% → 63.4%, the Standard pool 62.4% → 69.8%.

Tournament lists hold on every judge: attacking by turn 3 50%, damage per turn 87, wins against the
field 60%, the ladders within two points of before. Built decks measure 22% and 58 damage a turn
(from 20% and 61): the first run with costs paid fell to 53, because the score counted a
"discard all" attack as landing every turn and the corpus was seeded by printed damage, so it was
built around such attackers; the sustained figure now divides by the Energy a mandatory cost takes,
and the corpus seeds by sustained damage (`built.ts`), which changes the built decks. A typed count
of the opponent's Energy is credited one card on the typical board (Sunflora's Redirected Sunlight
was 180). Coverage on the tournament lists stands at Trainers 30.3%, Abilities 23.4%, Special Energy
0%, attacks 81.0%.

## Items and Supporters read (2026-11-10)

The pilot follows the Trainer wordings the tournament lists lean on (`deck-playtest.md`, Card
reading): searches narrowed by Rule Box, owner or name, "draw N instead" alternatives, both players
shuffling, "only if" conditions, recovery from the discard pile, Energy moves, looks that keep the
best cards, Crispin, Gwynn, healing. Ability conditions and costs ("if …, you may", "You must
discard … in order to use this Ability") are honoured too: before, Fezandipiti ex's Flip the Script
drew three cards every turn. Trainer copies followed in full: tournament lists 30.3% → 68.8%,
archetypes 31.6% → 68.2%, built decks 34.1% → 63.6%, the Standard pool 14.4% → 30.1%; Abilities
23.4% → 25.1% on the lists.

| Judge, tournament lists | Before | After |
| --- | --- | --- |
| Attacking by turn 3 (mean) | 50% | 52% |
| Attacking by turn 4 (mean) | 64% | 67% |
| Damage per turn (mean) | 87 | 93 |
| Turns with a play (mean) | 90% | 87% |
| Beats swapped Trainers (attacking by turn 3 / damage / wins) | 81% / 75% / 55% | 87% / 85% / 69% |
| Wins against the field, rank correlation with real win rates | 0.05 | 0.33 |
| Wins against the field, beats pile / order | 95% / 0.81 | 92% / 0.73 |

Reading Trainers is what the "swapped Trainers" ladder was waiting for: every played judge now sees a
third of the Trainers swapped far better. Simulated wins follow real win rates for the first time
(0.33). Turns with a play fell three points because an Ability with an unmet condition no longer
counts as a play. The duel ladder's pile and order columns gave a little: three of the thirty-nine
sampled lists rate at or below a random pile against the field (two before), decks whose strategy the
pilot cannot play yet (N's Zoroark, Dhelmise, Team Rocket's Honchkrow lean on Abilities and
discard-pile counts, the next families), and field decks that deck out in thirty-turn games against a
pile. Playing Trainers as written made the pilot draw itself out: a flat reserve of six cards became
one draw a turn for the Knock Outs still needed plus two, and under twenty cards it draws only into a
hand of fewer than five; before that rule five of the thirty-nine lists lost head-to-head to their
own random pile.

## Tools and Stadiums read (2026-11-10)

A Tool's or a Stadium's standing effect is applied while the card is in play (`deck-playtest.md`,
Card reading): HP, Retreat Cost, damage, Prize cards, cards drawn when hit, Abilities or Tools
turned off, counters on benched Basics, evolving the turn played, damage taken; Stadiums each player
may use read like Trainers. Trainer copies followed in full: tournament lists 68.8% → 76.7%, the
Standard pool 30.1% → 40.6%.

Tournament lists: attacking by turn 3 53%, damage per turn 94, duels' beats-pile 95% and order 0.82
(back where they were before the Trainer family). Two ladders gave within the noise of a 240-pair
sample: damage per turn against half the Energy swapped 82% → 77%, and wins against a third of the
Trainers swapped 69% → 54% (a random Trainer of the era is now often a Tool or Stadium the pilot can
use). The archetypes' duel judge moved the same way on a 40-deck, one-repeat sample. Still unread
among Trainers: gust and the opponent's hand or Energy (the duel family), Tools and Stadiums tied to
Special Conditions or to the opponent's attacks, Tera cards (no marker in the card data), and a few
wordings (Academy at Night, Kieran, Naveen, Salvatore).

## Abilities read (2026-11-10)

Activated Abilities' conditions, costs and "in this way" follow-ups are honoured, three more looks
at the top of the deck are read, and passive Abilities are standing effects like Tools
(`deck-playtest.md`, Abilities). Ability copies followed in full: tournament lists 25.1% → 62.6%,
the Standard pool 21.8% → 27.9%.

Tournament lists: attacking by turn 3 53% (unchanged), by turn 4 65% (68%), damage per turn 92 (94),
turns with a play 88% (87%); the attacking-by-turn-4 ladder gave three to five points. That is the
honest cost of two of the most played engines no longer cheating: Fezandipiti ex's Flip the Script
(205 copies) drew three cards every turn whatever its Knock-Out clause said, and Dudunsparce (133)
stayed on the Bench drawing three a turn instead of shuffling itself back into the deck as its text
says. The duel judge's order and swapped-Energy and Pokémon columns rose on the archetypes. Still
unread among Abilities: effects on the opponent's Pokémon (Cursed Blast, Adrena-Brain, gusts),
"prevent all effects" and Bench protection (Hide 'n' Sneak, Flower Curtain: nothing in the engine
does those yet), Festival Lead and Memory Helix, and kinds the card data does not mark (Future,
Tera).

## Special Energy read (2026-11-10)

A Special Energy's rule (what it provides, to whom, when more, how many at a time) is resolved
against the deck's Pokémon and applied by the engine; its other sentences are read like a Tool's or
as an effect on attaching (`deck-playtest.md`, Special Energy). Before, a Special Energy provided its
widest reading to every holder (Neo Upper Energy was any type on anything). Special Energy copies
followed in full: tournament lists 0% → 74.4%, the Standard pool 0% → 72.2%.

Tournament lists: the swapped-Energy ladder is what moved, because random Special Energy of the era
now shows for what it is: damage per turn beats half the Energy swapped 74% → 86%, attacking by turn
4 73% → 80%, wins against the field 80% → 87%; the other columns held or rose a point or two. Still
unread: Mist and Rocky Fighting Energy (prevent effects of attacks), Bubbly Water and Therapeutic
Energy (Special Conditions), Reversal Energy (a condition on Prize cards). Coverage on the
tournament lists stands at Trainers 76.8%, Abilities 62.6%, Special Energy 74.4%, attacks 81.1%.

## What needs an opponent (2026-11-10)

Gust, Special Conditions with Pokémon Checkup, damage and damage counters to the Bench, locks on
retreating, attacking and Items, protection during the opponent's next turn, and disruption of the
opponent's hand, deck and Energy are read whole and played in duels (`deck-playtest.md`,
Head-to-head race); in a solo game they sit idle and the report says so. A coin's result is rolled
once before an attack's damage and kept for the effects after it (Dunsparce's Dig). Coverage on the
tournament lists: Trainers 76.8% → 90.2%, Abilities 62.6% → 84.4%, Special Energy 74.4% → 97.2%,
attacks 81.1% → 97.5%; the Standard pool 46.7% / 34.9% / 83.3% / 83.2%.

What moved, and why it is re-recorded rather than fixed: solo damage per turn on the tournament
lists 92.8 → 90.0, because the old engine read Special Red Card's "they draw 3 cards" as the pilot's own
draw and lists with it got a free three cards; now the card sits idle in a solo game. The duel
ladders (swap-6 0.897 → 0.872 and swap-12 0.962 → 0.885 on the lists, 0.826 → 0.696 and 0.826 →
0.739 on the archetypes) moved by about as much as the old engine moves between seeds (lists seed 1
to seed 2: swap-6 0.897 → 0.692, Pokémon 0.897 → 0.744; archetypes: Trainers 0.717 → 0.652), turning
each new feature off one at a time did not bring the seed-1 numbers back, and the duel judge's
correlation with real win rates rose (lists 0.241 → 0.305, archetypes 0.180 → 0.228). Random piles
now beat a list more often (0.987 → 0.949, 0.913 → 0.870): a pile of the era holds gust and
disruption the pilot now plays.

## Review follow-ups and data gaps (2026-11-10)

Three figures the main session's review found overstated on the static board, and one printing
without text. Magcargo ex's Ground Burn counted both milled top cards as Energy (420): Energy among
cards an attack discards from the top of a deck is now a third of them (the deck's own share when
known), about 233, and a game counts the real cards. Gouging Fire ex's Blaze Blitz, which its user
"can't use again until it leaves the Active Spot", had sustained 260: it is now a rest of its own
(`rest` 3), one use per stay in the Active Spot, 127 with Heat Blast between, and the engine bars it
until the Pokémon goes to the Bench. Wailord ex's Falling Down (270, "This Pokémon is now Asleep")
had sustained 270: 216 now, a quarter of its next turns lost (two coins before its next attack). The
30th-anniversary Ultra Ball, the one Standard Trainer with no text of its own, reads the most recent
Ultra Ball's. Coverage of the Standard pool: Trainers 46.7% → 47.2%, attacks 83.2% → 83.4%; the
tournament lists hold still, and only the built corpus moved (the score builds other decks once
Ground Burn and Blaze Blitz weigh what they do: Abilities followed there 68.2% → 66.0%, attacks
90.5% → 91.3%, the solo Energy ladder 0.850 → 0.808, the duel Trainer ladder 0.675 → 0.750).

## Damage bonuses for the turn (2026-11-10)

"During this turn, attacks used by your Pokémon do N more damage" Trainers (Premium Power Pro,
Black Belt's Training, Gladion's Final Battle, Kieran's second option) are standing effects the
player holds until the turn ends, played in a duel when they turn the Active's best attack into a
Knock Out and in a solo game when the plan's attack is about to be used (`deck-playtest.md`).
Trainer copies followed: tournament lists 90.2% → 91.6%, the Standard pool 47.2% → 48.9%. The
judges held: solo damage per turn and the online shares within a point, the duel judge's random
piles a little further behind the lists (archetypes 0.870 → 0.913), the Trainer-swap ladder of the
lists 0.744 → 0.692 and a 24-swap 1.000 → 0.962, both inside the band the old engine moves between
seeds (a third of the Trainers swapped for random ones now brings in damage bonuses the pilot
plays).

## Searches in any combination (2026-11-10)

"Up to N in any combination of X and Y" (Ethan's Adventure from the deck, Bug Catching Set from
the top seven) is one search with one count shared across the kinds, the same `alts` a "X or Y"
search carries; recoveries from the discard pile already read the wording. Trainer copies followed: tournament lists 91.6% → 92.8%, the Standard pool 48.9% → 49.8%. Solo
damage per turn on the lists 90.1 → 91.5 and attacking by turn 3 and 4 up a point (the two cards
now fetch); the duel judge's swap ladders rose (lists swap-6 0.872 → 0.923, swap-12 0.885 → 0.936)
and its correlation with real win rates slipped 0.305 → 0.278, inside the seed band.

## Tera, Future and Ancient (2026-11-10)

Not read, and not readable from the data: the TCGdex card objects carry no marker for Tera, Future
or Ancient Pokémon (checked on fetched Tera and Future cards and on the cached downloads), and no
card text in the catalog carries the Tera rule-box sentence, so nothing exact can be derived
(`deck-playtest.md`, What is still not followed). Coverage after the three groups: tournament
lists Trainers 92.8%, Abilities 84.4%, Special Energy 97.2%, attacks 97.5%; the Standard pool 49.8% / 34.9% /
83.3% / 83.4%.

## Printed labels in the pilot (2026-11-12)

Single Strike, Rapid Strike, Fusion Strike, Ancient, Future and Tera (read off the card pictures,
PR #67) are kinds the pilot's filters, targets, heals, draws, counts, conditions and standing
effects accept wherever a type is accepted (`deck-playtest.md`, Printed labels): Tera Orb, Awakening
Drum, Reboot Pod, Glass Trumpet, Professor Sada's Vitality, Briar, Area Zero Underdepths (a Bench of
8 while a Tera Pokémon is in play, the extra discarded when it leaves), Nighttime Mine, Sparkling
Crystal, both Booster Energy Capsules, Cobalt Command, Sparkling Scales, Initialization's exception,
Koraidon's and Roaring Moon's counts, Scream Tail's heal; Single Strike, Rapid Strike, Fusion Strike
and Impact Energy go only onto the Pokémon they name. Bubbly Water Energy and Impact Energy keep
Special Conditions off their holder. Coverage on the tournament lists: Trainers 92.8% → 94.7%,
Abilities 84.4% → 85.5%, Special Energy 97.2% → 100.0%, attacks 97.5% → 97.5%; the Standard pool 49.8% → 53.3% /
34.9% → 36.7% / 83.3% → 88.9% / 83.3% → 83.5%. The judges held: solo damage per turn, the online shares and the solo ladders of the lists within a
point or two (the Trainer ladders up: live 0.664 → 0.721, attacking by turn four 0.840 → 0.881); the
duel judge's Energy-swap ladder on the lists 0.923 → 0.872 and the live judge's correlation with real
win rates 0.124 → 0.091, both inside the band the engine moves between seeds; the archetypes' duel
judge correlation rose 0.233 → 0.255.

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

## A built deck that scored 97 (2026-11-10)

From a player's report: "Build one for me" around Chesnaught V returned a deck that scored 97 where
their own deck scored 76, which looked like the same cards rearranged. It was another deck (11 cards
in common), and the 97 was not all earned:

- **Four Melony counted as draw.** "Attach a Water Energy card from your discard pile to 1 of your
  Pokémon V. If you do, draw 3 cards" does nothing in a deck with no Water Energy. A Trainer whose
  whole effect starts with attaching a named Energy from the discard pile or hand (eight names in
  the catalog: Melony, Welder, Dark Patch, Aqua Patch, Blacksmith, Metal Saucer, Wondrous Patch,
  Philippe) now counts for nothing where the deck neither runs that Energy nor has an attacker
  that needs it, shows in the Synergy part as "Nothing in the deck for Melony", and is not offered
  by the builder. The reported deck falls to 92.
- **Twelve of its cards were blanks to the pilot**: Pokémon Breeder (Rare Candy under its older
  wording), and Timer Ball and Lure Ball ("Flip N coins. For each heads, …"). All three are played
  now.
- **An Energy for a group the card data cannot confirm** (Impact Energy, Single Strike) is no
  longer a card the builder goes looking for; a deck that already holds one keeps its half credit.

What this did not fix, measured on the same seed: the builder still returns a deck that scores 96
and attacks by turn three in 16% of practice games (29 damage a turn), and eight rounds of tuning by
play find no swap that helps. The score saturates and the builder fills the rest with whatever keeps
it there. That remains the open item of this document.

Benchmark: the built corpus (Standard) and the tournament lists do not move, since none of these
cards is in them; one duel ladder on the theme decks moved by two decks (0.789 → 0.737) now that
their coin-flip Trainers are played. Baseline re-recorded.

## Built around the card, from the player's cards (2026-11-12, 1.14.0)

The same report went on: the deck had been built with "Prefer my cards" and held mostly cards the
player did not own, and on a second look it would play badly: an Energy nothing in it could use, ten
usable Energy, eight Rare Candy-like cards, an Ivysaur on a Bulbasaur with no Venusaur.

**Where the cards come from.**
- "Prefer my cards" only chose the owned printing of whatever card won. Now an addition whose copies
  are owned and not yet in the deck is worth 1.5 points of score (`OWNED_BONUS`): every near-tie
  goes to the owned card, a card that does clearly more still wins. A probe collection of 40 cards
  around Chesnaught V: 5 owned cards in the deck before, 24 or more after.
- "Only my cards" took one printing per name and stopped at what was owned of it: fourteen Grass
  Energy over four printings counted as six, and the deck stopped at 38 cards. The pool now holds
  every owned printing as a card of its own (all three games).
- The chips have a line under them saying what the chosen one does.

**What a deck is built around.**
- A seed went in as one copy, and the swap step could trade it away: "build another" around a weak
  Stage 2 returned a deck without it. Seeds go in at up to three copies and no swap takes them, or
  what they stand on, out.
- With one copy the builder had been building a stronger deck around another attacker: over the 40
  benchmark seeds the decks did 85 damage a turn that way and 65 once the seed was really played,
  because the Energy check passed decks with the wrong Energy (below). Honest and fixed, 82.

**What the builder no longer adds.**
- Energy cover was a yes or no: three cards of a type, or one Special Energy of every type, covered
  any attacker. A Hydreigon ex deck (three Darkness an attack) was built on twelve Psychic Energy
  and never attacked. Cover is now the number of cards that give the type to that attacker against
  what its attack asks (three for one symbol, five for two, eight for three), and the types a deck
  needs are those of its real attackers (at least half the best attack's damage), not of a support
  Pokémon's small attack.
- An Energy for a group the card data cannot confirm is never offered; Rare Candy and Pokémon
  Breeder together stop at the Stage 2 they can put down, four at most; a Pokémon is offered only if
  it attacks about as hard as the deck's best, has an Ability that draws, searches or attaches, or
  something in the deck evolves from it.
- Among additions that do the same for the score, another copy of a card already in the deck comes
  before a new name.

**The last cards are chosen by playing.** From 40 cards on, the six best additions within one point
of the top are each played 40 practice games on the same seeds and the one that plays best goes in
(`fillByPlay`, on wherever the evaluator can play; about one second more per build on a desktop).

Benchmark, with the built corpus now built as the app builds it: attacking by turn three 24% → 29%,
by turn four 37% → 45%, damage a turn 65 → 82 (tournament lists: 53%, 65%, 91, unchanged, as the
pilot did not change). Tournament lists score 90.2 → 89.7 on the stricter Energy count, and the
score tells them from their damaged copies a little better. Still true: the score saturates near 99
on built decks, a few seeds end with a plan that is not the seed, and Stage 2 attackers that cost
four Energy stay slow. Baseline re-recorded.
