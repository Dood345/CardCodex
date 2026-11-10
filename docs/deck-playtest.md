# Deck playtest simulator

The static score in `deck-recommender.md` counts cards. It tells a real deck from a random pile, but
it cannot rank two good decks, because a deck's quality shows in play: how often it opens, how soon
its attacker attacks, how often it stalls. `src/recommend/sim/` plays seeded games with a greedy
pilot and measures exactly that. The bench harness (`src/recommend/bench/`) uses it as one of its
judges. A future practice-draw screen can call the same pure functions.

Everything is read from the evaluator's card features (`PokemonEvaluator.features(card)`) and their
rules text. Nothing is learned from published decks.

## API

```ts
import { playtest, duel, dealOpening, drawNext, createPokemonSimulator } from '@/recommend/sim';

playtest(evaluator, cards, { games: 1000, seed: 1, turns: 6, first: 'alternate' }); // PokemonPlaytestReport
duel(evaluator, deckA, deckB, { games: 1000, seed: 1, maxTurns: 60 });             // DuelReport
dealOpening(evaluator, cards, seed);  // { hand, prizes, library, mulligans, rng, ok }
drawNext(deal, 1);                    // a new deal with the next card in hand
createPokemonSimulator(evaluator);    // the same behind the game-neutral DeckSimulator interface
```

- **Determinism.** Each game draws from its own random stream, `mixSeed(seed, gameNumber)`, using
  mulberry32 with one 32-bit word of state. The same seed gives the same report, and any single game
  can be replayed.
- **Deck order.** Lists are normalized before compiling: side-zone lines are dropped, lines are
  merged per card id, and the result is sorted by id. The same 60 cards in any order, or split over
  several lines, play the same games.
- **Practice draws.** The practice-draw functions keep the random state in the returned deal and
  never mutate their input.
- **Who goes first.** `first` decides it. By default it alternates by game number. Turns are the
  player's own turns: turn 1 is that player's first turn.

### Report (`src/recommend/sim/types.ts`)

The base `PlaytestReport` is game-neutral. "Online" means the deck does what it is built to do. For
Pokémon that is the main attacker attacking. A Yu-Gi-Oh! simulator would read it as a starter
opening its combo, and a Magic one as casting on curve.

| Field | Meaning |
| --- | --- |
| `plan` | The main attacker and its attack, one line |
| `cannotOpen` | The deck has no Basic Pokémon (all rates then 0) |
| `mulliganRate`, `meanMulligans` | Share of games whose first seven had no Basic; redraws per game |
| `onlineBy[t-1]` | Share of games where the main attacker had attacked by own turn t |
| `meanOnlineTurn` | Mean own turn of its first attack; games where it never attacks count as `turns + 1` |
| `deadTurnRate` | Share of turns with nothing played: no card from hand, no Ability, no retreat |
| `keyPieceStuckRate` | Share of games where every copy of something the plan needs is prized (see below) |
| `unread`, `unreadCopies`, `unreadDrawsPerGame` | Cards the pilot cannot read, with the kind of effect; how often one is in hand |
| `partlyRead` | Cards it plays without using them in full: Pokémon whose Ability it does not use (passive ones, or activated ones whose text was not read), such as Radiant Charizard's cost reduction |
| `meanDamagePerTurn`, `damageByTurn` | Pokémon only: printed damage per own turn, mean over the first six turns |

**What counts as a stuck key piece.** Any one of these, in the Prize cards from the start of the game:

- every copy of the attacker;
- every copy of its Basic;
- for a Stage 2 attacker, every copy of the Stage 1, together with every Rare Candy.

## The model

### Card reading (`effects.ts`, `cards.ts`)

Each deck is compiled once into a card table. The evaluator's features supply:

- stage and what each card evolves from;
- attacks (cost letters, damage);
- what each Energy provides;
- the Trainer subtype;
- the roles.

The pilot also needs amounts and destinations, which the features do not carry. `effects.ts` reads
those from `features(card).text`.

| Effect | Example card | Read as |
| --- | --- | --- |
| Draw a number | — | draw N |
| Draw until a hand size | — | draw up to N |
| Discard hand, draw | Professor's Research | discard hand, draw N |
| Shuffle hand in, draw | Judge style | shuffle hand into deck, draw N |
| Hand to the bottom, draw per Prize | Iono | hand to bottom, draw one per remaining Prize card |
| Look at the top cards | Great Ball, Pokégear 3.0, Bill's Transfer | a search of the top N cards only ("a", "up to 2" or "any number of" a kind of card), the rest shuffled back; the pilot plays it when the deck holds a card it wants, without knowing whether the top N do |
| Search to the top of the deck | Ciphermaniac's Codebreaking | the N most wanted cards, of different names, on top of the deck, the most wanted drawn first |
| Deck search | Ultra Ball, Nest Ball, Poffin, Arven | what kind (Pokémon by Basic, stage, type, HP limit or suffix; Item, Supporter, Tool or Stadium; Energy by type and basic-ness; any card); how many; where to (hand, Bench, or attached); Arven reads as two searches |
| Energy attachment | Magma Basin | attach from hand or discard pile, to Active, Bench, self, or Pokémon of a type |
| Energy recovery | Energy Retrieval | discard pile to hand |
| Switch | Switch | swap the Active with a Benched Pokémon |
| Rare Candy | Rare Candy | skip the Stage 1 |
| Discard cost | Ultra Ball ("only if you discard 2 other cards") | pay the discard, then resolve |
| One coin flip | "Flip a coin. If heads, …" | the effect happens half the time |

`{R}` symbols are read as type names.

**Abilities.** Each Ability gets a trigger:

| Trigger | Example | Note |
| --- | --- | --- |
| When it evolves from hand | Charizard ex's Infernal Reign | — |
| When it is benched from hand | Lumineon V's Luminous Sign | — |
| Once during your turn | Pidgeot ex's Quick Search | Honours "can't use more than 1 Quick Search Ability each turn" |
| As often as you like | — | — |
| Passive | — | Not used |

- **Turn-ending Abilities.** An Ability that ends the turn (Rotom V's Instant Charge) is used only
  when there is no attack to lose.
- **VSTAR Powers.** These are limited to one per game, as the rulebook says (appendix 6). That
  includes a Tool that lends one (Forest Seal Stone), which the pilot plays like an Item onto a
  Pokémon V.

**Main attacker.** For each damaging attack the compiler scores:

> sustained damage × min(1, copies of the whole line / 4) × (1 if the deck's Energy can pay the typed cost, else ¼) ÷ cost^¼

The highest score wins. Counting copies across the whole line keeps a one-copy Radiant Charizard
(250) behind a 3-1-3 Charizard ex line (180).

**Sustained damage** is the printed damage, except for an attack that rests its user ("During your
next turn, this Pokémon can't attack", or "can't use" the attack itself): that one lands every other
turn, so it counts half, plus half of the card's next attack when only the attack itself is barred
(`AttackFeature.sustained`, shared with the score's Power part). A rest that hangs on a coin flip is
not counted. Before this, a 2-2 Umbreon line (140, every other turn) was the plan of a deck that
also held a 2-2 Exeggutor line (130 every turn).

Two other ways to count a line were measured on the tournament lists (2026-11-09, how often the plan
names a Pokémon in the deck's archetype name, of 346 lists): all copies of the line 234, the scarcer
of its two ends 228, the odds of drawing both ends in 14 cards 191. The last two also took the
Basics of the old theme decks' 3-2-1 lines for their attackers. All copies stayed.

**Stages a deck skips.** When a deck skips a stage (Pidgey → Pidgeot ex with no Pidgeotto, played
off Rare Candy), the compiler looks up what the missing stage evolves from in the catalog through
`evaluator.pool`. It does this once per evaluator.

**Support lines.** Pokémon whose Abilities the pilot can use, plus what they evolve from, form the
support lines.

### What the pilot follows: the coverage measure (`coverage.ts`)

A pattern that matched is not a text obeyed. Since 2026-11-10 every text the parser reads is also
accounted for sentence by sentence (`ParsedText.sentences`), and a card counts as **followed** only
when no sentence is left unread:

- **read**: an effect the engine applies was taken from the sentence, and nothing in it was skipped.
  A sentence is not read when it carries a condition (`if`, `unless`, `only`, `as long as`, `while`,
  `except`, `otherwise`), an `instead`, a `for each`, a clause about the opponent (`your opponent`,
  `each player`, `their hand`), a `Choose 1:` or a search clause with words the filter does not model
  (`that doesn't have a Rule Box`, `of different types`, `Team Rocket's`, `or`). Clauses the engine
  does honour are taken out before the check: a discard cost, `Flip a coin. If heads,`, `your turn
  ends`, Rare Candy's own rules, an Ability's trigger, its Active-only clause and its per-turn limit,
  and an attack's "can't attack next turn".
- **noop**: on the explicit list `NOOP` in `effects.ts`, each entry with its reason: "Then, shuffle
  your deck" (a search already shuffles), "Shuffle the other cards back into your deck" (a look at
  the top cards already does), the rule-box reminder, "Damage is not an effect", "Don't apply
  Weakness and Resistance for Benched Pokémon" (the engine applies them to the Active only), "Apply
  Weakness as ×2", "You still need the necessary Energy", the one-VSTAR-Power note, "The effect of X
  doesn't stack", "This includes new Pokémon that come into play", "Your opponent chooses the new
  Active Pokémon" (the engine lets the switched-out player promote), the first-turn evolution
  reminder, "Damage from attacks is still taken", "Shuffle your deck afterward" and "You can play only
  one Supporter card each turn" (older printings).
- **unread**: everything else.

Four shares come out of it, by copies over a corpus and by name over the Standard pool: Trainer
copies played with every sentence followed, Ability copies used the same way, Special Energy copies
whose text is followed beyond the type it provides (the "provides" sentence is read through the
evaluator's `provides`), and damaging attack copies whose text is fully acted on (an attack with no
text counts). What is not followed is grouped by the kind of its first unread sentence
(`kindOf`), with example card names, so the report says what to read next. The benchmark records the
shares in its baseline and fails on any drop (`docs/deck-bench.md`).

### The pilot (`engine.ts`)

**Setup.**

1. Mulligan until the hand has a Basic.
2. Choose the Active: the main line's Basic when in hand (it evolves in place), else the Basic that
   is cheapest to retreat.
3. Bench the other Basics.
4. Set the six Prize cards.

**Each turn.**

1. Draw.
2. Take the first of these actions that applies, and repeat until none does:
   1. Bench a Basic. A Basic the plan does not call for is benched only when a Bench spot stays
      free.
   2. Evolve.
   3. Play Rare Candy.
   4. Move a ready attacker up, with Switch or a retreat.
   5. Use an Ability.
   6. Play an Item.
   7. Play or use a Stadium.
   8. Attach the turn's Energy.
   9. Play the turn's Supporter.
3. Attack.

**How it chooses.**

- **Searches** take the card the plan wants most. `want` scores each card, highest first:
  1. The main line's Basic while none is in play.
  2. The next stage when what it goes on is in play.
  3. Rare Candy when the Stage 2 is in hand.
  4. Energy the attack still lacks.
  5. Support-line pieces.
  6. A Supporter when none is in hand.
  7. Everything else.
- **Items** are worth what they would fetch.
- **Spare copies** are worth little, which is what discards drop.
- **Ultra Ball's discard cost** is paid only for a piece wanted badly, and only with cards wanted
  less.
- **Supporters** are valued in cards. Draw counts what is drawn less what the hand would lose. A
  search counts what it would fetch. A hand with no way to start the plan gets a bonus for replacing
  it. The Supporter is played when it is worth more than ¾ of a card.
- **Energy** goes to the main line's most advanced Pokémon that still needs it, and to other
  Pokémon only while they are Active. When a ready attacker waits on the Bench, the Energy pays the
  retreat first.
- **A stuck Active.** When the Active is off the main line and short of its Retreat Cost while the
  line waits on the Bench, Energy (manual or accelerated, such as Infernal Reign's third Energy)
  goes to it right after the line's lead. Searches then rank Energy and Switch at the top.
- **Deck reserve.** Draw effects are passed up when they would leave fewer than 6 cards in the
  deck, because decking out loses.
- **The attack** is the hardest-hitting payable attack. A setup attack (Pidgey's Call for Family) is
  used instead when the damage would be under 50 and would not knock out.

Cards whose text is not read are never played. The report counts them (`unread`).

### Rules (`rules.ts`, config `POKEMON_RULES_PAR_2023`)

The source is the official rulebook: *Pokémon Trading Card Game Rules*, Scarlet & Violet—Paradox
Rift edition (2023),
<https://assets.pokemon.com/assets/cms2/pdf/trading-card-game/rulebook/par_rulebook_en.pdf>. Page
numbers are those printed in the PDF. Any rule can be corrected in that one object.

| Field | Value | Source |
| --- | --- | --- |
| `deckSize`, `openingHand` | 60, 7 | p. 8, Setting Up: "Shuffle your 60-card deck and draw the top 7 cards." |
| `prizes` | 6 | p. 8, step 7: "Put the top 6 cards of your deck off to the side face down as your Prize cards." |
| `benchSize` | 5 | p. 10: "Your Bench can hold up to 5 Pokémon." |
| mulligan | redraw until a Basic | p. 8 and p. 18, Full details of taking a mulligan: reveal, shuffle back, draw 7 again |
| `opponentDrawsPerMulligan` | 1 | p. 18: "the player who did not have to start over may draw a card for each extra mulligan" |
| `firstPlayerDrawsTurn1` | true | p. 9–10: every turn begins "Draw a card", with no exception for the starting player |
| `firstPlayerAttacksTurn1` | false | p. 13: "On the first turn of the game, the starting player skips this step." |
| `firstPlayerSupporterTurn1` | false | p. 12: "The player who goes first cannot play a Supporter card on their first turn." |
| `evolveOnOwnFirstTurn` | false | p. 11: "neither player can evolve a Pokémon on that player's first turn unless a card says so" |
| `evolveOnTurnPlayed` | false | p. 11: "Neither player can evolve a Pokémon on its first turn in play." Evolving makes it new again |
| `energyPerTurn`, `supportersPerTurn`, `retreatsPerTurn` | 1, 1, 1 | p. 9, Parts of a Turn |
| retreat | discard Energy equal to the Retreat Cost | p. 12 |
| `deckOutLoses` | true | p. 10: no card to draw at the start of the turn loses |
| `noPokemonLoses` | true | p. 8 (How to Win) and p. 14: no Benched Pokémon to replace a Knocked Out Active loses |
| Weakness, Resistance | as printed (`×2`, `+20`, `-30`), to the Active only | p. 14 and p. 20, Full details of attacking, steps 3–4 |

**Rules from the cards' own text.** Rare Candy can't be played on your first turn or on a Basic
put into play this turn. Infernal Reign triggers through Rare Candy, because the Stage 2 is still
played from the hand.

**Prize cards per Knock Out (`prizeValue`).** TCGdex's text has no rule boxes, so the kind of
Pokémon is read from its name. TCGdex writes most GX and EX names with a space ("Charizard EX"); a
few use the printed hyphen.

| Prizes | Kinds | Source |
| --- | --- | --- |
| 3 | Pokémon VMAX | appendix 10, p. 27 |
| 3 | Pokémon V-UNION | appendix 7, p. 26 |
| 3 | TAG TEAM (`&` … GX) | appendix 13, p. 29 |
| 3 | Mega Evolution Pokémon ex (2025 onward) | the card's printed rule box (see below) |
| 2 | Pokémon ex, Tera ex | appendices 2–3, p. 23–24 |
| 2 | Pokémon V | appendix 9, p. 27 |
| 2 | VSTAR | appendix 6, p. 25 |
| 2 | Pokémon-GX | appendix 16, p. 31 |
| 2 | Pokémon-EX, including Mega Evolution EX | appendices 22–23, p. 35–36 |
| 1 | everything else, Radiant included | p. 14 |

The Mega Evolution ex rule comes after this rulebook. It is taken from the printed rule box (for
example Mega Mawile ex, me01) as Bulbapedia's Rule Box page lists it, which makes it a secondary
source. Replace it with the newer rulebook when pokemon.com publishes one at a predictable address.
LEGEND cards (2010) count 1, which is not checked.

### Head-to-head race (`duel.ts`)

`duel` seats two pilots at one table. Each game gives each seat its own random stream,
`mixSeed(seed, game, seat)`. Deck A goes first in even-numbered games.

**Setup.** Both players set up. The player who took fewer mulligans then draws one card per extra
mulligan the other took (p. 18).

**Turns.** The players alternate turns. On each turn the pilot runs its main phase against the
opponent, then attacks.

- **Damage.** Attack damage, after Weakness and Resistance, lands on the opposing Active.
- **Knock Out.** A Knock Out discards the Pokémon with everything attached. The attacker takes as
  many Prize cards as `prizeValue` gives, into hand.
- **Promotion.** The knocked-out player promotes, in this order of preference:
  1. a ready main attacker;
  2. the hardest hitter it can pay for;
  3. the main line;
  4. the most HP left, counting a multi-Prize Pokémon as 100 HP less per extra Prize.
- **Choosing an attack.** The pilot picks the attack with the most damage against the defender. A
  setup attack yields to any attack that knocks out.
- **Resting.** A Pokémon whose attack bars it from attacking next turn sits that turn out (or uses
  another attack when only the one is barred). The bar lifts when it goes to the Bench, so with a
  second ready attacker there the pilot switches or retreats to it.

**How a game ends.**

| Ending | Rule |
| --- | --- |
| Prizes | The player takes their last Prize card |
| No Pokémon | The opponent has no Pokémon to promote |
| Deck out | A player cannot draw at the start of their turn and loses |
| Turn limit | After `maxTurns` turns (both players together, default 60) the game is a draw |
| No Basic | A deck with no Basic loses before play |

**The report** gives:

- deck A's wins, losses and draws;
- the win rate, with draws counting half;
- its 95% Wilson interval;
- the win rate of whoever went first;
- the mean game length;
- the mean Prize difference (A − B);
- the endings by kind.

**What this cut leaves out:**

- **Gust.** Boss's Orders, Counter Catcher and Pokémon Catcher stay unread.
- **Disruption.** Iono resolves only for the player who plays it.
- **Damage to the Bench.**
- **Special Conditions.**

Shared Stadiums ("once during each player's turn") can be used by both players. Playing a Stadium
discards the one in play.

## What is not simulated

**Gaps that matter for this deck:**

- **Cards whose text is not read.** The pilot never plays them. That covers gust, disruption,
  healing, recovery other than Energy, every Tool except a lent VSTAR Power, Stadiums other than
  "once during each player's turn", conditional cards ("only if …") and multi-coin effects. The report names them in two groups:
  cards that need an opponent to matter (gust, disruption, healing) and cards the pilot does not
  know how to play.
- **Damage modifiers.** "+" and "×" damage counts its printed base. Tools, Abilities and Stadiums
  that change damage are ignored. Of the attack drawbacks, "can't attack next turn" is played; discarding
  Energy and self-damage are ignored, as are Special Conditions.
- **Special Energy conditions.** A Special Energy provides what `features.provides` says.
- **Duels.** There is no disruption and no gust: Iono resolves only for the player who plays it,
  and Boss's Orders is unread. Without gust, the opponent's Benched attackers grow in peace. This
  favours slow Stage 2 decks.

**Rules not modelled:**

- Stadium replacement only exists in the duel.
- The Bench is filled greedily.
- Mega Evolution EX ending the turn (appendix 23) is not modelled.
- A player never chooses to go second.
- The pilot looks one step ahead: it does not plan across turns or count outs.

## Measured (2026-11-09)

Run on an AMD Ryzen 7 3700X with Node 24 under vitest.

### Speed

| Run | Time |
| --- | --- |
| 1,000 solo games of the 60-card Charizard ex deck, six own turns each | 155–180 ms after warm-up |
| 1,000 duels of the same deck against itself (about 15 turns each) | 370–420 ms |
| Compiling a deck | about 1 ms |
| The first deck that needs a catalog lookup for a skipped stage | about 90 ms, once per evaluator |
| Loading catalog and card text (tests) | about 200 ms |

The one-second target is met: 1,000 games of a 60-card deck take well under a second, solo or
head-to-head.

### Charizard ex fixture

4,000 games, seed 1, alternating who goes first:

| Number | Value |
| --- | --- |
| Mulligan rate | 27.2% (hypergeometric: 25.9%; 1.9 standard errors off) |
| Main attacker attacked by own turn 1 / 2 / 3 / 4 / 5 / 6 | 0 / 50.5 / 81.2 / 89.7 / 93.3 / 95.2% |
| Going first / second, by turn 2 | 44.9% / 55.0% |
| Mean first attack (never attacking counts as turn 7) | turn 2.90 |
| Mean damage per turn, turns 1–6 | 124 |
| Dead turns | 16.1% |
| Key piece stuck in Prize cards | 0.13% |
| Unread copies | 9 (Boss's Orders ×3, Counter Catcher, Pokémon Catcher, Defiance Band, Technical Machine: Evolution, Lost Vacuum, Super Rod) |
| Unread cards drawn per game | 4.5 |

A Stage 2 cannot attack on turn 1, so turn 1 is 0 whoever goes first.

**Damaged copies.** Each change pads the deck back to 60 with off-type Water Energy:

| Copy | Attacked by turn 3 | Mean first attack | Dead turns | Damage per turn | Key piece stuck |
| --- | --- | --- | --- | --- | --- |
| Without its draw and search Trainers¹ | 16.7% | turn 5.88 | 45% | 49 | — |
| Without Rare Candy | 49.2% | turn 4.37 | 23% | 86 | 10% (the lone Charmeleon prized) |

¹ Ultra Ball, Nest Ball, Poffin, Arven, Iono, Professor's Research, Forest Seal Stone.

Without Rare Candy the deck never attacks on turn 2, because a Stage 2 cannot get there without it.

**Random piles.** Random piles of 60 distinct cards printed in 2023–2024 (three seeds) never attack
in six turns, and have dead turns about 68% of the time.

### Duels

1,000 games each, seed 1:

| A vs B | A's win rate (95% CI) | First player wins | Mean turns | Prize difference | Endings |
| --- | --- | --- | --- | --- | --- |
| Charizard vs itself | 51.3% (48.2–54.4) | 54.1% | 14.6 | +0.03 | 903 prizes, 96 no Pokémon, 1 deck out |
| Charizard vs itself, seed 2 | 50.5% (47.4–53.6) | 53.5% | 14.6 | +0.06 | — |
| Charizard vs random pile (3 piles) | 99.5% each | — | 13.4–14.6 | +5.5 | the 5 losses per pile are deck-outs |
| Charizard vs no-Rare-Candy copy | 88.6% (86.5–90.4) | — | — | +4.12 | — |
| No-Rare-Candy copy vs Charizard | 11.3% | — | — | — | — |
| Charizard vs no-draw/search copy | 88.8% | — | — | — | — |
| No-draw/search copy vs Charizard | 11.0% | — | — | — | — |

A over B plus B over A: 0.999 for the no-Rare-Candy pair and 0.998 for the no-draw/search pair.

The pilot's mistakes in duels were found by tracing lost games (`duelGame(…, trace)`), not by
tuning to the tests. Before the stuck-Active and deck-reserve rules, the Charizard deck decked out
in 9% of mirror games and lost 3–5% to random piles, stalled behind a Manaphy with no Energy.

### Blind spots across the catalog

The parser reads these shares of Trainers and Abilities, by catalog slice (one printing per name):

| Slice | Trainers read | Unread Trainers by kind | Abilities |
| --- | --- | --- | --- |
| Standard-legal | 71 of 229 | other 59, tool 35, stadium 19, heal 14, condition 12, recover 8, disrupt 4, gust 3, coin flips 3 | 50 activated read of 108 activated (128 passive) |
| 2023–2024 printings | 55 of 175 | other 39, tool 36, stadium 11, heal 10, condition 9, recover 8 | 22 of 43 activated |
| Whole catalog | 366 of 1,384 | other 391, tool 238, stadium 145, heal 66, coin flips 47, recover 46, condition 45, disrupt 25 | 122 of 329 activated |

"Other" is mostly these, which are the next things to read:

- "look at the top N cards and take one" (Pokégear 3.0, Dusk Ball, Explorer's Guidance);
- Energy moves (Energy Switch);
- hammers;
- hand-size disruption;
- searches tied to a Pokémon in play (Salvatore, Grand Tree).

A card's kind is the first of the evaluator's roles gust, heal, recover and disrupt that it has.
Only a card with none of those is classed by its text (tool, stadium, condition, coin flips,
other).

### Computed here, not in the evaluator

These belong in `PokemonFeatures` later:

- **Effect amounts and targets.** How many cards a draw draws; what a search fetches and where it
  puts it; discard costs; coin flips; Ability triggers and per-turn limits; VSTAR Powers.
- **The catalog evolution map,** name → what it evolves from. It is needed for Stage 2 lines that
  skip their Stage 1.
- **Prize value per Pokémon.**
- **Weakness and Resistance values** (`×2`, `+20`, `-30`).

### Evaluator bugs found on the way

These are in `src/recommend/pokemon.ts` today; the simulator works around them.

- **Space-written suffixes.** The suffix pattern (`-(GX|EX)$`) reads only the hyphen form. That
  misses about 860 TCGdex names written with a space: 551 "… GX" and 307 "… EX". Synergy mentions
  of EX and GX, and anything else keyed on `suffix`, skip those cards.
- **Iono.** The `draw` role misses it. Its text says "draws a card for each of their remaining
  Prize cards", and the pattern wants "draw N cards".
- **Arven.** It gets no role: "search your deck for an Item card and a Pokémon Tool card" matches
  none of the search patterns. The Charizard fixture's static draw part therefore undercounts
  eight of its cards.
