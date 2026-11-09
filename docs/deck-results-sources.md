# Deck lists with real outcomes: where the ground truth could come from

Checked 2026-11-09 for the deck-quality harness (playtest simulator plus regression harness). The
recommender scores decks from card text and learns nothing from published decks
(`deck-recommender.md`); the earlier hunt for prebuilt lists is in `pokemon-deck-sources.md` and is
not repeated here. This note looks for **lists that come with outcomes**: placings, match records,
win rates.

Two uses are judged for every source:

- **(a) Local validation only.** Lists are fetched into a gitignored cache on the developer's
  machine; only aggregate numbers (for example "the harness ranks the winning archetype above the
  losing one in 83% of pairs") are committed.
- **(b) Shipping derived data** (archetype win rates, card co-occurrence) inside the free,
  ad-free GPL-3.0 app. Project rule: only when the source's terms clearly allow it, with the source
  recorded.

Verdicts are **yes**, **no** or **ask**. "Ask" means the terms are silent or ambiguous and a written
answer from the owner would settle it. Nothing was signed up for, no key was requested, nothing was
sent; the only requests made were reads of documentation, terms pages, `robots.txt` and a handful
of sample API responses (about 10 calls in total to the Limitless API, against its limit of 50 per
5 minutes).

## Summary

| # | Source | Game | Holds | Access | Terms found | (a) local | (b) ship |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Limitless platform API** (`play.limitlesstcg.com/api`) | Pokémon (and many other games) | Online tournaments: standings with full decklists, W/L/T records, archetype per deck, round-by-round pairings with game winners. Well over 5,000 events (page 5,000 at one per page is September 2025) | Open API, **no key**, 50 requests / 5 min | No licence, no API terms; ToS covers user content only | **Yes** | **Ask** |
| 2 | Limitless major-event pages (`limitlesstcg.com/tournaments`) | Pokémon | Regionals, Internationals, Worlds: Day 2 standings and decklists only | Pages only, no API | Copyright notice; no data terms | **Ask** | **No** |
| 3 | TopDeck.gg API | Magic first; also Pokémon and Yu-Gi-Oh! | Standings, win rates, pairings with game scores, decklists (after the event) | Free key from a logged-in account, 50 to 100 requests / min | Developer Terms: no commercialising, credit required, derived data not addressed | **Yes** (needs a free account) | **Ask** |
| 4 | 17Lands public datasets | Magic Arena Limited | Draft picks, per-game rows (deck, opening hand, win/loss), per-turn replay rows | Bulk gzip files, open | **CC BY 4.0** "unless otherwise noted" | **Yes** | **Yes** (Limited only, attribution) |
| 5 | RK9 (`rk9.gg`) | Pokémon | Official Play! Pokémon rosters, pairings, decklists | Pages | ToS bans scraping; robots disallow pairings and decklists | **No** | **No** |
| 6 | pokedata.ovh | Pokémon | Standings built from RK9 pairings | Pages | None found | **No** | **No** |
| 7 | pokemon.com Play! Pokémon results | Pokémon | Top-cut placings and lists per event | Pages behind a bot wall | Unreadable | **No** (unverified) | **No** (unverified) |
| 8 | Trainer Hill (`trainerhill.com`) | Pokémon | Matchup matrices, decklists, win rates | Pages (script-rendered) | None found | **Ask** | **No** |
| 9 | IEEE DataPort Pokémon metagame set | Pokémon | 14×14 matchup matrix, 14 archetypes, Jan to Feb 2026 | Download, subscription wall | CC BY claimed, data scraped from Trainer Hill | **No** | **No** |
| 10 | Kaggle / Hugging Face / GitHub | Pokémon | Only card catalogues found; no licensed results dataset | n/a | n/a | **No** | **No** |
| 11 | MTGJSON deck files | Magic | Product (precon) decks only; no results | Bulk download | **MIT** | n/a: no outcomes | Decks yes, outcomes none |
| 12 | MTGODecklistCache (GitHub) | Magic | Cache of MTGO, Melee, TopDeck tournament lists | Git repo | **No licence** on the repo | **Ask** | **No** |
| 13 | MTGTop8 | Magic | Event lists and placings, many formats | Pages | No terms page; `Crawl-delay: 5` | **Ask** | **No** |
| 14 | MTGGoldfish | Magic | Metagame, decks, prices | Pages | Personal, non-commercial use only; AI-training signal `no` | **No** | **No** |
| 15 | Melee.gg | Magic | Tournament results and decks | Pages; `robots.txt` returns 403 | Not read; no public API docs found | **No** (unverified) | **No** (unverified) |
| 16 | YGOPRODeck tournaments | Yu-Gi-Oh! | Placings and decklists of major events, archetype per deck; no match records | Pages only (API has no deck endpoints) | © notice only; no terms page | **Ask** | **No** |
| 17 | YGOPRODeck API | Yu-Gi-Oh! | Cards only | Open API | "free to use", no hotlinking, 20 req/s | n/a: no outcomes | n/a |

## Recommendation

**Use the Limitless platform API (row 1) for Pokémon.** It is the only source found that has all
of: decklists, per-player match records, round-by-round pairings with game winners, an archetype
label per deck, a documented machine interface, and no key to obtain.

- **For use (a) the user has to do nothing.** The harness session can start fetching today into
  `scripts/.cache/limitless/`. No account, no key, no email.
- **For use (b) the user has to ask once.** The documentation does not set terms and the site has no
  licence for the data, so the permission comes from a written yes. The request is drafted below.
- Caveats the harness authors should know:
  - These are **online community events** on the Pokémon TCG Live platform (weekly leagues,
    "Showdowns", Friday events), not Regionals. The largest of the 50 most recent Standard events had 494
    players and the fourth largest 121; most are far smaller. Filter on `players` (for example at least 64) before
    treating a record as skill evidence.
  - Records are Swiss results with dropouts; a 0-2 record with `drop: 2` is a player who left, not a
    losing deck. Use pairings, not standings, for deck-versus-deck results, and drop rounds with
    `winner: -1` (byes).
  - Lists use **PTCGL set codes** (`TWM`, `MEG`, `MEE`, `POR`) and collector numbers, not TCGdex ids.
    The harness needs a code-to-set mapping which is a small
    job but not zero.
  - Cost of a pull at the free rate (10 requests a minute): 1,000 tournaments is about 2,000 requests
    (standings and pairings) plus 20 listing pages, so roughly 3.5 hours. That is a background job,
    not a bulk download; fetch only the events the validation needs.
- **Fallback with a key: TopDeck.gg (row 3)** if the user would rather not ask Limitless, or for
  Magic. It also lists Pokémon and Yu-Gi-Oh! events. The step is a free account on topdeck.gg and a
  key from its developer portal; its terms forbid commercialising the data and require a visible
  credit, so use (b) would still need a question to them.
- **Only licensed outcome data found: 17Lands (row 4)**, CC BY 4.0, and it is Magic Arena
  *Limited* (40-card drafted decks), so it validates a Magic Limited evaluator, not constructed play.

## What the user must do

1. **Nothing, for the harness to begin (use a).** Tell the harness session the API address and the
   limit in the Limitless section below.
2. **To be able to ship derived data (use b):** send the request below to Limitless. Two places, in
   this order:
   - Create your own free account on `play.limitlesstcg.com`, open your user API settings, and use the
     form linked at the top of that page, pasting the text below into its use-case box. The form is
     behind a login and was not seen, so its fields are unknown; if it has a field the draft does not
     answer, answer it honestly in the same spirit.
   - Or email `contact@limitlesstcg.com` (the address on their Site Notice,
     <https://limitlesstcg.com/legal>), or write in the Limitless Discord (link in the footer of the
     docs, <https://docs.limitlesstcg.com/developer.html>). The same text works.
3. Keep the answer in the repo (a short `docs/limitless-reply.md`), because the project rule is that the
   source and its terms are recorded.

Limitless says keys are "not meant for private use" and go only to public-facing projects with a
legitimate use-case. The request is therefore written about the public app and the aggregates it
would ship, not about the private harness. It says the app will never contain a key.

## Draft request to Limitless (not sent)

Fill in the sender's name; send from the project owner's own address and account.

---

**Subject:** Permission to use Limitless tournament data for deck statistics in a free, open-source Pokémon TCG app

Hello Limitless team,

I maintain CardCodex, a free and open-source (GPL-3.0) Android app that helps collectors track their
Pokémon TCG, Yu-Gi-Oh! and Magic collections: https://github.com/Dood345/CardCodex. It is free to use
and free of ads. Today it has no income of any kind. If we ever charge for the app or for a service
around it, we will come back to you first.

The app has a deck builder with suggestions that explain themselves ("replace this card with that one,
because..."). We would like to check those suggestions against real results, and to show, next to a
suggestion, how the archetype it resembles has actually performed. For that we would like to use the
data of your public tournament API (`play.limitlesstcg.com/api`):

1. **Locally, for validation.** We fetch standings, decklists and pairings for a chosen set of
   Standard tournaments into a private cache on a developer's machine, within the published rate limit
   (50 requests per 5 minutes), one request at a time, and keep only aggregate numbers in the
   repository. We do not republish tournament lists, and we do not keep or publish player names.
2. **In the app, as derived data.** At most a small static file produced at build time: for each
   archetype, a match count and a win rate, and card co-occurrence counts ("this card appears in N% of
   the winning lists of this archetype"). It contains no player names, no tournament names and no
   individual lists, and the app never calls your API from users' phones, so no key is ever embedded
   in the app.

We would credit Limitless in the app's Settings screen and README, next to our existing credits for
TCGdex, YGOPRODeck and Scryfall, in whatever wording you prefer, and we would link to the tournaments
the numbers come from.

Could you tell us, in writing:

- whether the tournament data may be used this way, in particular whether derived aggregates may be
  shipped inside a GPL-3.0 app;
- what credit you would like;
- whether a key would be appropriate for this (we do not need one for the volume above, and we would
  not request one if you would rather not issue it for a use like this).

We understand that the card names and the game belong to The Pokémon Company and its partners, and
that the tournament results come from your organisers and players. If you would rather we did not use
the data at all, we will not.

Thank you for the service you run.

Kind regards,

<name>
CardCodex maintainer
https://github.com/Dood345/CardCodex

---

## Pokémon sources

### 1. Limitless platform API (recommended)

- **URL:** <https://play.limitlesstcg.com/api>; documentation <https://docs.limitlesstcg.com/developer.html>
  (tournaments page: `/developer/tournaments.html`, games page: `/developer/games.html`).
- **Holds:** online tournaments on the Limitless platform, many games including `PTCG` (Pokémon TCG), `VGC`, One Piece and Lorcana. Verified with
  sample responses on 2026-11-09:
  - `GET /tournaments?game=PTCG&format=STANDARD&limit=50&page=N`: id, name, date, format, player
    count, organiser. Page 5,000 at `limit=1` is dated September 2025, so the archive holds well over
    5,000 Pokémon events; page 20,000 is empty. The format list goes back to Worlds 2004 rule sets, but
    I did not measure how old the oldest real event is.
  - `GET /tournaments/{id}/standings`: per player placing, `record` (wins, losses, ties), `drop`
    round, the full `decklist` (pokemon / trainer / energy lines as `{count, set, number, name}`) and
    `deck` (archetype id, name, icons). In a 161-player event all 161 players had a list.
  - `GET /tournaments/{id}/pairings`: per match round, phase (Swiss or top cut), winner and per-game
    winners (best-of-three), both players. 436 rows for that event; byes have `winner: -1`.
  - `GET /games`, `GET /games/{id}/decks`: format list and the archetype classification rules. The
    rules endpoint is the only one that needs a key; the archetype name per player is already in
    standings, so it is not needed.
  - Webhooks (new finished tournament) need the key form; not needed.
- **Access:** open, no key. Keys can be sent as `?key=` or `X-Access-Key`. Response header
  `RateLimit: "50-in-5min"` was measured. Browsers may call it directly (`Access-Control-Allow-Origin: *`),
  which the harness does not need.
- **Terms:** the developer page says no key is needed except for deck rules, "rate limits apply",
  and keys "are not meant for private use". It states no licence, no attribution rule and no
  restriction on storing or deriving data. The platform's Terms of Service
  (<https://play.limitlesstcg.com/tos>, last updated 2021-02-28) cover users' own content only (users
  keep their rights and grant Limitless a licence to show it on the service); they do not mention the
  API, scraping or reuse. The Site Notice (<https://limitlesstcg.com/legal>) is a copyright notice
  for card text and images. `play.limitlesstcg.com/robots.txt` does not exist (404).
- **Personal data:** standings and pairings carry player handles and countries. Keep the cache
  gitignored and write no player identity into any committed file or shipped aggregate.
- **Quality:** community events, mixed skill, many small. Archetype labels are Limitless's own
  classification. Good enough to test whether the harness ranks established archetypes in the order
  the metagame did; weak as a measure of exact card choices.
- **Verdict (a): yes.** A documented, key-free public API used well inside its rate limit, kept
  local, with only aggregates committed.
- **Verdict (b): ask.** Silence is not a licence; the data is players' decklists plus results, and
  the request above asks for the specific use. A yes should be recorded in the repo.

### 2. Limitless major-event pages

- **URL:** <https://limitlesstcg.com/tournaments>. The page lists Regionals (for example Puebla,
  2,234 players, and Gdańsk, 1,739 players, both October 2026), Internationals and Worlds.
- **Holds:** results and decklists "from every major tournament"; per its About page
  (<https://limitlesstcg.com/about>) the data is taken from official sources like RK9 and pokemon.com
  where available, otherwise crowdsourced from players. Standings cover Day 2 players, not the whole
  field, and there are no match records.
- **Access:** pages only. The documented API covers the online platform, not these pages
  (<https://docs.limitlesstcg.com/developer.html>). `limitlesstcg.com/robots.txt` allows everything.
- **Terms:** only the copyright notice above. Because the underlying data comes from RK9 and
  pokemon.com, whose own terms are closed (rows 5 and 7), a scrape of these pages would not be clean
  even if Limitless allowed it.
- **Verdict (a): ask.** Scraping HTML is not what the owner offers; the request above could add a
  sentence about it. **(b): no** for the same reason as RK9.

### 5. RK9 (`rk9.gg`)

- **URL:** <https://rk9.gg/events/pokemon>; terms <https://rk9.gg/terms>; `robots.txt` at
  <https://rk9.gg/robots.txt>.
- **Holds:** the official registration and pairing system for Play! Pokémon events: Regionals,
  Internationals, Worlds, Professor Cups; rosters, pairings, decklists per event.
- **Access:** pages; no API, no key process.
- **Terms:** §5.3 bans "screen scraping" and other automation, commercial or not, and using Service
  data for one's own commercial gain; §3.2 reserves everything not granted. The `robots.txt` disallows
  `/roster/`, `/pairings/` and `/decklist/public/`.
- **Verdict (a): no, (b): no.** Both the terms and the robots file say no.

### 6. pokedata.ovh

- **URL:** <https://www.pokedata.ovh/>. Standings (VG and TCG), decklist comparison, a "Players'
  History" matchup page, a Cards API demo, local events. Search results describe its standings as
  built from RK9 pairings.
- No terms, licence, API documentation, download or contact statement on the page.
- **Verdict (a): no, (b): no.** Built on RK9 data that RK9's terms close, no statement of its own.

### 7. pokemon.com Play! Pokémon results

- **URL:** for example <https://www.pokemon.com/us/play-pokemon/regionals/2023/charlotte/event-results>
  (older events publish top-cut lists there).
- `curl` returns an Incapsula bot-check page, as the earlier note found for the terms page. Terms
  unverified. Only top-cut placings and lists exist, not whole-field records.
- **Verdict (a): no, (b): no**, both unverified. Do not work around the bot check.

### 8. Trainer Hill

- **URL:** <https://www.trainerhill.com>. Metagame, matchup and decklist analysis; Limitless's
  documentation lists it as an example built on its data
  (<https://docs.limitlesstcg.com/developer.html>).
- The page is script-rendered ("Loading..."); no terms, licence, API or contact statement could be
  read. A published dataset says its matchup data was "scraped from" it (row 9).
- **Verdict (a): ask** (we would not scrape a derived-data site when its own source is open;
  asking the owner for its matchup matrix would be a polite shortcut), **(b): no**.

### 9. IEEE DataPort: "Formally Verified Pokémon TCG Metagame Analysis"

- **URL:** <https://ieee-dataport.org/documents/formally-verified-pokemon-tcg-metagame-analysis-tournament-data-matchup-matrices-and-lean>
- 14 archetypes, 14×14 matchup matrix, Trainer Hill events of 50+ players, January to February 2026
  (Stellar Crown to Prismatic Evolutions format). Files: `pokemon_data_only.zip` (10 KB) and a
  319 KB formalisation. The listing is labelled Open Access but the page says a DataPort subscription is
  needed; licence CC BY, but the data was scraped from Trainer Hill with no stated permission, so the
  CC BY label cannot clear it.
- **Verdict (a): no, (b): no.** Too small to validate with, and the provenance is unclear.

### 10. Kaggle, Hugging Face, GitHub

- Searched for a licensed Pokémon TCG results dataset. Found only card catalogues (for example
  `WyldKnyght/pokemon_tcg_data_cards`, listed MIT; `TheFusion21/PokemonCards`, listed CC BY-NC 4.0) and
  paid Apify scrapers of Limitless, which are tools, not licences. No Kaggle dataset of decklists with
  results turned up (the search engine did not index Kaggle well; a direct search on kaggle.com is
  still worth five minutes). A code licence on a scraper repository does not license the scraped data.
- **Verdict (a): no, (b): no** until a dataset with its own clear licence is found.

## Magic sources

### 3. TopDeck.gg API

- **URL:** <https://topdeck.gg/docs/tournaments-v2>; developer terms <https://topdeck.gg/developer-terms>;
  base URL `https://topdeck.gg/api`.
- **Holds:** dozens of games, Magic with the most formats (EDH, Standard, Modern, Pauper...), also
  Pokémon and Yu-Gi-Oh!. Standings with win rates and tiebreakers, round-by-round pairings and match
  results with game scores, player records, and decklists once the event is over or the organiser has
  enabled "Show Decks".
- **Access:** API key in the `Authorization` header, free, created in the developer portal after
  making an account. Limits per minute per key: 5 (tournament search by POST), 50 (single tournament,
  standings, rounds), 100 (rest); 1,000,000 document reads per day. I could not test it: that needs an
  account, which I may not create.
- **Terms (Developer Terms):** a visible credit and link to TopDeck.gg wherever users see the data
  (§6.1); selling, licensing or "commercializing" API data is banned (§7); store data only as long as
  the app needs it, delete personal data when asked (§§5.5, 8.2, 12.3); access can be revoked at any
  time (§12.2); the API "is currently free" but fees may follow (§10). Derived data and machine
  learning are not addressed.
- **Verdict (a): yes**, with a free account made by the user and the key kept out of the repo.
  **(b): ask**: a free app is not commercialising, but redistributing derived aggregates is not
  covered either way, and the credit requirement is fine. A short question to TopDeck would settle it;
  the request above can be adapted by replacing the first paragraph's data sentence.

### 4. 17Lands public datasets

- **URL:** <https://www.17lands.com/public_datasets>; the site's data-use guidelines (its terms page) mention the
  Public Datasets page as the exception.
- **Holds:** Magic Arena **Limited** (draft and sealed formats): draft data (one row per pick with the
  player's later match results), game data (one row per game with the deck, opening hand and cards
  drawn, win/loss) and replay data (one row per turn). Per set, updated as sets release. Anonymised.
  Size not measured (gzip files per set, known to be large; do not download them all).
- **Access:** bulk CSV or JSON gzip files, open, no key.
- **Terms:** "Unless otherwise noted, these data sets are licensed under a Creative Commons
  Attribution 4.0 International License"; the site's terms exclude the Public Datasets page from their
  "do not republish" guidance and call it "typically released under a CC BY 4.0 license". Attribution
  required. The FSF licence list
  (<https://www.gnu.org/licenses/license-list.html>) says CC BY 4.0 is compatible with all versions of
  the GPL, with a note against using it for software; here it covers data, which is fine as a
  separately credited file. Check the licence note on the specific file used.
- **Fit:** only for a Magic Limited evaluator (40-card pool decks), not for constructed.
- **Verdict (a): yes, (b): yes**, for a Magic Limited feature, crediting 17Lands.

### 11. MTGJSON deck files

- **URL:** <https://mtgjson.com/downloads/all-files/> (`AllDeckFiles`, `DeckList.json`);
  licence <https://mtgjson.com/license/>.
- Product decks (precons and similar), which are what a collector buys; no tournament results. MIT
  licence (copyright Zach Halpern), shipping with attribution is allowed.
- **Verdict:** useful as prebuilt decks (the earlier "starter decks" question, not this one); for
  ground truth, **no outcomes, so not applicable**.

### 12. MTGODecklistCache (GitHub, `Badaro/MTGODecklistCache`)

- **URL:** <https://github.com/Badaro/MTGODecklistCache>. "Cache in JSON format of tournaments posted on
  MTGO, Manatraders, Melee and Topdeck Websites"; last push 2025-06-10; GitHub reports **no licence**.
- Placings and lists per event as JSON. Without a licence the default is all rights reserved; the
  underlying websites' own terms apply too.
- **Verdict (a): ask** (open an issue on the repository and ask), **(b): no.**

### 13. MTGTop8

- **URL:** <https://www.mtgtop8.com/>. Event lists, placings and decks for Standard, Modern, Pioneer,
  Legacy, Vintage, Pauper, cEDH, Duel Commander and others; about 3,370 decks from 470 events in the
  last week alone.
- **Terms:** no terms page and no API; footer has a privacy link and a Wizards of the Coast copyright
  notice. `robots.txt` allows crawling except `/compare` and asks `Crawl-delay: 5`.
- **Verdict (a): ask** (permission is silent, the crawl delay is explicit), **(b): no.**

### 14. MTGGoldfish

- **URL:** <https://www.mtggoldfish.com/>; terms <https://www.mtggoldfish.com/policies/terms-of-use>
  (version 1.1, 2016). Site content is "intended solely for personal, non-commercial use"; copying only
  for personal use, no republishing; `robots.txt` carries `Content-Signal: ai-train=no`.
- **Verdict (a): no, (b): no.**

### 15. Melee.gg

- **URL:** <https://melee.gg/>. A tournament platform with decklists; no public API documentation was
  found (a third-party service looks tournaments up by Melee id), and `robots.txt` returned 403. Terms not read.
- **Verdict (a): no, (b): no**, both unverified. TopDeck.gg (row 3) is the documented alternative.

## Yu-Gi-Oh! sources

### 16. YGOPRODeck tournaments

- **URL:** <https://ygoprodeck.com/tournaments/>; example event
  <https://ygoprodeck.com/tournament/challenger-cup-tokyo-dome-1109> (Tier 4, 1,024 players,
  December 2023).
- **Holds:** results and decklists of major events (formats TCG, OCG, Genesys, Master Duel), filters by
  tier, format and archetype. An event page shows winner through top 32 with archetype, no match
  records or whole-field results: weak ground truth.
- **Access:** pages only. The API (row 17) has no deck or tournament endpoint.
- **Terms:** no terms page is linked in the footer; the notices say card text and images belong to
  4K Media / Konami and "all other content" is © YGOPRODeck. The earlier hotlinking rule for images
  stands (do not hotlink images; see the API guide).
- **Verdict (a): ask. (b): no.**

### 17. YGOPRODeck API

- **URL:** <https://ygoprodeck.com/api-guide/>. Cards, sets, archetypes only; 20 requests per second
  (over it blocks the IP for an hour); store pulled data locally; no hotlinking. No outcomes, so it
  does not help here; already in use for the catalog.
- No other open Yu-Gi-Oh! source with outcomes was found. TopDeck.gg lists Yu-Gi-Oh! events (row 3),
  not checked for volume.

## Closed (do not use)

RK9, pokedata.ovh, pokemon.com results, MTGGoldfish, the IEEE DataPort set, and (until their owners
answer) the MTGODecklistCache repository, MTGTop8, Trainer Hill, YGOPRODeck tournaments and the
Limitless major-event pages. Melee.gg and pokemon.com are closed only for lack of readable terms.

## Hand-over for the harness

- Put the cache under `scripts/.cache/limitless/` (`.cache/` is gitignored).
- Never commit tournament ids with player names, or any `decklist` payload; commit aggregates only.
- Use a clear `User-Agent` such as `CardCodex-validation/0.1` with no contact details, one request at
  a time, and watch the `RateLimit` header (`r=` is requests left in the window, `t=` seconds to reset).
- Map `set` + `number` to TCGdex ids with a small table; PTCGL set codes differ from TCGdex ids, and
  basic Energy lines appeared under `MEE` in the one list inspected.
