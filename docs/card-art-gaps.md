# Card picture gaps: causes, sources and options

Measured and probed on 2026-11-08 against `public/data/*.json` as built that day (Pokémon catalog built 16:19 UTC).
Research only: no app code, catalog or version changed. The probe script is `scripts/probe-card-images.mjs`
(Node built-ins only, paced at about 4 requests per second, descriptive `User-Agent`, every response cached in
`scripts/.cache/probe/`, which git ignores). The numbers can be reproduced with its commands: `measure`, `tcgdex`,
`census`, `cards`, `scrydex`, `tiers`, `ygo`, `mtg`.

## Summary

- **Pokémon: 1,763 of 21,432 cards (8.2 %) have no picture**: 1,365 Pokémon, 189 Trainer, 209 Energy. The owner's focus
  (Trainer + Energy) is 398 of them: 189 of 2,890 Trainers and 209 of 579 Energy cards (36 % of all Energy cards).
- **Yu-Gi-Oh! and Magic have no real picture gap.** Yu-Gi-Oh! names every printing's picture by passcode and every probe
  answered; Magic's Scryfall "missing" images (162) are not in our catalog.
- **The cause for Pokémon is four different things, not one:**
  1. TCGdex *has the file* but the card's `image` field is empty: 371 cards (Shiny Vault, Galarian Gallery, the four Trainer
     Galleries, part of `mep` and `svp`). The build cannot see them because it trusts the field. **Fixable for free by
     probing the file path in `build-catalog.mjs`.**
  2. TCGdex has the card only in other languages (German, Spanish, Italian, sometimes French): 496 cards, 119 of them Energy
     (the Trainer Kit basic Energy) and 64 Trainers.
  3. TCGdex has nothing in any language I probed, but Scrydex (the Pokémon TCG API's picture host) does: 752 cards, 86 of them
     Energy and 80 Trainers (all of `me06`, `sm7.5`, `smp`, `sve`, `mee`, the old Trainer Kits, McDonald's).
  4. Nowhere I found: 144 cards (`mfb` 34, `30th-c` 30, `exu` 28, `cel25cc` 25, some Aquapolis and Skyridge cards), of them
     10 Trainers and 4 Energy.
- **Recommended:** (a) now: probe the file path in the catalog build (371 cards, 34 of them Trainers, no new terms), also
  HEAD-verify `img: true` cards (four are broken today) and rerun `npm run hashes`. Keep the card back (d) for the rest, and
  ask Scrydex in writing whether the app may show or bundle their pictures; **only if they agree**, bundle Trainer + Energy
  (383 of the 398 are covered, about 4.5 MB). Reasons under "Recommendation".

## 1. The measurement

Pokémon, `public/data/catalog.json` (21,432 cards, 19,669 with `img: true`, none with a custom URL string):

| | Cards | Without picture | Share |
|---|---|---|---|
| Pokémon | 17,963 | 1,365 | 7.6 % |
| Trainer | 2,890 | 189 | 6.5 % |
| Energy | 579 | 209 | 36.1 % |
| **Total** | 21,432 | **1,763** | 8.2 % |

67 sets have gaps. **52 are missing entirely (1,540 cards)**, which points at a source-side path or upload issue; 15 are
partial (223 cards), scattered cards. By series: Trainer Kits (`tk`) 475, Sword & Shield 360, Mega Evolution 299, Sun & Moon
231, McDonald's (`mc`) 166, Scarlet & Violet 92, e-Card 81, the rest 59.

Per set (T+E = Trainer + Energy cards among the gaps; the last four columns say where a picture exists, see section 2):

| Set | Gaps / cards | T+E | TCGdex EN file | TCGdex other language | Scrydex | Nowhere |
|---|---|---|---|---|---|---|
| `me06` Delta Reign | 141 / 141 | 27 | 0 | 0 | 141 | 0 |
| `swsh4.5sv` Shining Fates Shiny Vault | 122 / 122 | 0 | 122 | 0 | 122 | 0 |
| `mep` MEP Black Star Promos | 112 / 112 | 3 | 40 | 38 | 111 | 1 |
| `sm3.5` Shining Legends | 78 / 78 | 14 | 0 | 78 | 78 | 0 |
| `sm7.5` Dragon Majesty | 78 / 78 | 12 | 0 | 0 | 78 | 0 |
| `swsh12.5gg` Crown Zenith Galarian Gallery | 70 / 70 | 10 | 70 | 0 | 70 | 0 |
| `smp` SM Black Star Promos | 67 / 248 | 2 | 0 | 0 | 67 | 0 |
| `ecard2` Aquapolis | 40 / 186 | 0 | 0 | 26 | 23 | 9 |
| `svp` SVP Black Star Promos | 34 / 226 | 6 | 19 | 0 | 33 | 0 |
| `mfb` My First Battle | 34 / 34 | 6 | 0 | 0 | 0 | 34 |
| `ecard3` Skyridge | 32 / 182 | 0 | 0 | 0 | 23 | 9 |
| `tk-hs-g` HS trainer Kit (Gyarados) | 30 / 30 | 20 | 0 | 0 | 30 | 0 |
| `tk-hs-r` HS trainer Kit (Raichu) | 30 / 30 | 20 | 0 | 0 | 30 | 0 |
| `tk-bw-e` BW trainer Kit (Excadrill) | 30 / 30 | 18 | 0 | 30 | 30 | 0 |
| `tk-bw-z` BW trainer Kit (Zoroark) | 30 / 30 | 16 | 0 | 30 | 30 | 0 |
| `tk-xy-n` XY trainer Kit (Noivern) | 30 / 30 | 18 | 0 | 30 | 30 | 0 |
| `tk-xy-sy` XY trainer Kit (Sylveon) | 30 / 30 | 18 | 0 | 30 | 30 | 0 |
| `tk-xy-b` XY trainer Kit (Bisharp) | 30 / 30 | 15 | 0 | 30 | 30 | 0 |
| `tk-xy-w` XY trainer Kit (Wigglytuff) | 30 / 30 | 15 | 0 | 30 | 30 | 0 |
| `tk-xy-latia` XY trainer Kit (Latias) | 30 / 30 | 14 | 0 | 30 | 30 | 0 |
| `tk-xy-latio` XY trainer Kit (Latios) | 30 / 30 | 14 | 0 | 30 | 30 | 0 |
| `tk-xy-p` XY trainer Kit (Pikachu Libre) | 30 / 30 | 12 | 0 | 30 | 30 | 0 |
| `tk-xy-su` XY trainer Kit (Suicune) | 30 / 30 | 14 | 0 | 30 | 30 | 0 |
| `tk-sm-r` SM trainer Kit (Alolan Raichu) | 30 / 30 | 18 | 0 | 19 | 30 | 0 |
| `swsh9tg` Brilliant Stars Trainer Gallery | 30 / 30 | 5 | 30 | 0 | 30 | 0 |
| `swsh10tg` Astral Radiance Trainer Gallery | 30 / 30 | 5 | 30 | 0 | 30 | 0 |
| `swsh11tg` Lost Origin Trainer Gallery | 30 / 30 | 6 | 30 | 0 | 30 | 0 |
| `swsh12tg` Silver Tempest Trainer Gallery | 30 / 30 | 6 | 30 | 0 | 30 | 0 |
| `30th-c` 30th Classic Collection | 30 / 30 | 2 | 0 | 0 | 0 | 30 |
| `exu` Unseen Forces Unown Collection | 28 / 28 | 0 | 0 | 0 | 0 | 28 |
| `2021swsh` McDonald's Collection 2021 | 25 / 25 | 0 | 0 | 0 | 25 | 0 |
| `cel25cc` Celebrations Classic Collection | 25 / 25 | 3 | 0 | 0 | 0 | 25 |
| `sve` Scarlet & Violet Energy | 24 / 24 | 24 | 0 | 0 | 24 | 0 |
| `swshp` SWSH Black Star Promos | 22 / 307 | 2 | 0 | 0 | 22 | 0 |
| `tk-sm-l` SM trainer Kit (Lycanroc) | 18 / 18 | 6 | 0 | 18 | 18 | 0 |
| `mee` Mega Evolution Energy | 16 / 16 | 16 | 0 | 0 | 16 | 0 |
| `2022swsh` McDonald's Collection 2022 | 15 / 15 | 0 | 0 | 0 | 15 | 0 |
| `2023sv` McDonald's Collection 2023 | 15 / 15 | 0 | 0 | 0 | 15 | 0 |
| `2024sv` McDonald's Collection 2024 | 15 / 15 | 0 | 0 | 0 | 15 | 0 |
| `tk-ex-m` EX trainer Kit 2 (Minun) | 12 / 12 | 5 | 0 | 0 | 12 | 0 |
| `tk-ex-p` EX trainer Kit 2 (Plusle) | 12 / 12 | 5 | 0 | 0 | 12 | 0 |
| `tk-dp-m` DP trainer Kit (Manaphy) | 12 / 12 | 4 | 0 | 0 | 12 | 0 |
| `2011bw` McDonald's Collection 2011 | 12 / 12 | 0 | 0 | 0 | 12 | 0 |
| `2012bw` McDonald's Collection 2012 | 12 / 12 | 0 | 0 | 0 | 12 | 0 |
| `2014xy` McDonald's Collection 2014 | 12 / 12 | 0 | 0 | 0 | 12 | 0 |
| `2015xy` McDonald's Collection 2015 | 12 / 12 | 0 | 0 | 0 | 12 | 0 |
| `2016xy` McDonald's Collection 2016 | 12 / 12 | 0 | 0 | 0 | 12 | 0 |
| `2017sm` McDonald's Collection 2017 | 12 / 12 | 0 | 0 | 0 | 12 | 0 |
| `2018sm` McDonald's Collection 2018 | 12 / 12 | 0 | 0 | 0 | 12 | 0 |
| `2019sm` McDonald's Collection 2019 | 12 / 12 | 0 | 0 | 0 | 12 | 0 |
| `tk-dp-l` DP trainer Kit (Lucario) | 11 / 11 | 4 | 0 | 0 | 11 | 0 |
| `tk-ex-latia` EX trainer Kit (Latias) | 10 / 10 | 3 | 0 | 0 | 10 | 0 |
| `tk-ex-latio` EX trainer Kit (Latios) | 10 / 10 | 3 | 0 | 0 | 10 | 0 |
| `bog` Best of game | 9 / 9 | 1 | 0 | 0 | 9 | 0 |
| `hgssp` HGSS Black Star Promos | 9 / 25 | 1 | 0 | 0 | 8 | 1 |
| `xya` Yellow A Alternate | 6 / 6 | 2 | 0 | 0 | 0 | 6 |
| `sm6` Forbidden Light | 6 / 146 | 0 | 0 | 6 | 6 | 0 |
| `ex5.5` Poké Card Creator Pack | 5 / 5 | 0 | 0 | 0 | 5 | 0 |
| `bwp` BW Black Star Promos | 3 / 101 | 0 | 0 | 3 | 1 | 0 |
| `xyp` XY Black Star Promos | 3 / 216 | 0 | 0 | 3 | 3 | 0 |
| `pop6` POP Series 6 | 2 / 17 | 0 | 0 | 2 | 2 | 0 |
| `miscp` Miscellaneous Promos | 1 / 1 | 0 | 0 | 0 | 1 | 0 |
| `pl2` Rising Rivals | 1 / 120 | 0 | 0 | 1 | 1 | 0 |
| `xy8` BREAKthrough | 1 / 165 | 1 | 0 | 1 | 1 | 0 |
| `sm2` Guardians Rising | 1 / 169 | 1 | 0 | 1 | 1 | 0 |
| `det1` Detective Pikachu | 1 / 19 | 1 | 0 | 0 | 0 | 1 |
| `cel25` Celebrations | 1 / 25 | 0 | 0 | 0 | 1 | 0 |

"TCGdex EN file" = English file found; "TCGdex other language" = only in another language (not counted in "EN file");
"Scrydex" = any Scrydex hit, so it overlaps the other columns; "Nowhere" = none of them.

Yu-Gi-Oh!, `public/data/ygo/catalog.json`: 14,656 cards, 38,832 printings. The app works in printings and each names its
picture by passcode, so every printing has a picture URL by construction. 516 cards have no TCG printing and are not in the
app (section 3).

Magic, `public/data/mtg/catalog.json`: 34,180 Oracle cards, 98,430 printings, each with a Scryfall id that names its picture.

## 2. Cause for Pokémon

### What was probed

For each of the 67 gap sets, up to four cards (first, last, first Trainer, first Energy) against about 30 URL variants:
`en/<series>/<set>/<localId>/{high,low}.webp`, `.png` and `.jpg`, unpadded and 3-digit-padded numbers, the parent set id
(`swsh4.5sv` → `swsh4.5`), the same path in `fr de es it pt-br ja`, and the REST card endpoint
`https://api.tcgdex.net/v2/<lang>/cards/<id>` for an `image` field. The variants that answered were then run against every
gap card of that set (`census`). TCGdex answers a missing file with `404`, Content-Type `image/webp` and an HTML body, so only
the status counts. Sets where the sample found nothing were not probed card by card (2–4 cards each).

### Findings

1. **The `image` field is empty for cards whose files exist.** The GraphQL endpoint returns `image: null` for `mep-001`,
   `swsh9tg-TG01` and `svp-500`, and the REST card has no `image` key, yet
   `assets.tcgdex.net/en/me/mep/001/low.webp`, `.../en/swsh/swsh9/TG01/low.webp` and `.../en/sv/svp/500/low.webp` answer 200.
   TCGdex's FAQ says "If a card has no `image` field, the image has not yet been added to the database", which the data
   contradicts here. I looked at the pictures (Meganium MEP 001, Terapagos & Friends SVP 500, Hisuian Voltorb GG01,
   Eternatus VMAX SV122, Flareon TG01): all the right cards.
2. **Subsets are stored under the parent set's path**, with no local-id collisions (0 shared local ids with the parent in the
   catalog):

   | Catalog set | File lives at | Cards |
   |---|---|---|
   | `swsh4.5sv` Shiny Vault | `.../en/swsh/swsh4.5/SV001…SV122/` | 122 |
   | `swsh12.5gg` Galarian Gallery | `.../en/swsh/swsh12.5/GG01…GG70/` | 70 |
   | `swsh9tg`, `swsh10tg`, `swsh11tg`, `swsh12tg` | `.../en/swsh/swsh9…12/TG01…TG30/` | 4 × 30 |
   | `mep` MEP Promos | its own predicted path; **40 of 112** answer today | 40 |
   | `svp` | its own predicted path; **19 of 34** answer today | 19 |

   Together **371 cards** (337 Pokémon, 34 Trainer, 0 Energy). `mep` and `svp` are uploaded gradually, so the count grows; a
   build that probes every time picks them up without a code change.
3. **The new set is plain lag.** `me06` Delta Reign (released 6 Nov; 141 cards: 114 Pokémon, 24 Trainer, 3 Energy): the cards
   exist in the REST API in English, French, German, Spanish and Italian, but no picture in any language. Scrydex serves all
   141 already. Recheck in a week or two; note that `30th-c` (released 16 Sep) still has none after seven weeks, so "new" does
   not always mean "soon".
4. **Other-language pictures only:** the BW/XY/SM Trainer Kits (12 sets, 337 cards; `de` and `es` answer for nearly all,
   `it` for most), Shining Legends `sm3.5` (78; `de es it`), Aquapolis 26 (`fr`), `mep` 38 more cards (`de fr pt-br`), `sm6` 6,
   `bwp` and `xyp` 3 each, `pop6` 2, `pl2`, `xy8`, `sm2` 1 each: **496 cards** (313 Pokémon, 119 Energy, 64 Trainer). I
   viewed German pictures of `sm3.5-1` (Bisasam 1/73) and `tk-bw-e-1`: genuine scans with German text.
5. **Nothing at TCGdex in any language probed:** `sm7.5`, `smp`, McDonald's 2011–2024, `swshp`, `sve` and `mee` (the Energy
   sets), `ecard3`, the HS, EX and DP Trainer Kits, `mfb`, `exu`, `cel25cc`, `30th-c`.
6. **`img: true` cards whose picture 404s today (not in the 1,763).** The hash build keeps `.404` marker files for ten
   cards: `30th-B`, `30th-G`, `30th-R`, `dc1-1`, `ex7-88`, `g1-19`, `sm3-165`, `sv10-028`, `swsh6-181`, `xy10-79`. Probed now,
   six (`ex7-88`, `g1-19`, `sm3-165`, `sv10-028`, `swsh6-181`, `xy10-79`) answer, so those markers are stale and their
   hashes are missing from `hashes.json` (19,659 hashes for 19,669 flagged cards). **Four are still broken:** `30th-B/G/R`
   (REST gives an `image` URL, but the files do not exist) and `dc1-1` (only de/es/it/fr exist). They show a broken image
   rather than the card back.

### Result per tier

| Tier | Cards | Pokémon | Trainer | Energy |
|---|---|---|---|---|
| A. TCGdex English file exists (fix the build) | 371 | 337 | 34 | 0 |
| B. only another TCGdex language | 496 | 313 | 64 | 119 |
| C. only Scrydex | 752 | 586 | 80 | 86 |
| D. nowhere probed | 144 | 129 | 11 | 4 |
| **Total** | 1,763 | 1,365 | 189 | 209 |

Scrydex covers 1,608 of the 1,763 (Pokémon 1,225, Trainer 178 of 189, Energy 205 of 209) and 1,238 of the 1,392 that TCGdex
lacks in English.

## 3. Other sources, with the terms in front of me

The app's rule: only sources whose terms allow the use, source recorded, GPL-3.0.

### Scrydex (the Pokémon TCG API's picture host since 2026): `images.scrydex.com`

- `images.pokemontcg.io` still answers for old sets (`swsh1/1.png` 200), but `pokemon-tcg-data` now points every picture at
  `https://images.scrydex.com/pokemon/<id>/small` and `/large`. The old API "is scheduled to be taken offline on March 1,
  2027" (README of `PokemonTCG/pokemon-tcg-data`); docs.pokemontcg.io: "The Pokémon TCG API is deprecated" and "Please migrate
  your application to Scrydex."
- Coverage measured: 1,608 of the 1,763 gap cards (94 % of the gap Trainers, 98 % of the gap Energy), 245×342 PNG, 45–60 KB.
  Transcoded to 245×337 WebP at quality 75 about 15 KB (Energy about 8 KB), measured on ten. The ids are not TCGdex ids
  (`me06` → `me6`, `sm7.5` → `sm75`, McDonald's `2021swsh` → `mcd21`, Trainer Kits `tk4a…tk10b`); I derived them from Scrydex's
  public expansion list plus three hand aliases (`tk-hs-g`, `tk-hs-r`, `ex5.5`). Their docs say never to assume the URL pattern.
- **Are the hits the right cards?** The placeholder test only proves that *some* card sits at an id. So: 837 hits in sets that
  `pokemon-tcg-data` also lists were compared by name with the catalog (`scrydexnames`): 831 match. The six mismatches were all
  `30th-c` (`me55c`, a hand alias I had guessed: the numbering differs, `30th-c-004` Genesect EX vs `me55c-4` Charizard), so
  **that alias is dropped and `30th-c` counts as "nowhere"**. The other 777 hits are in sets or numbers the repo lacks
  (Trainer Kits `tk3`–`tk10`, `wb1`, `me6`, `mep`, `mee`, most of `svp`, `mcd23`, `mcd24`); I viewed 68 of them on two contact
  sheets (every such set, with an Energy, a Trainer and a Pokémon where the set has them, including `me6-132` Bubbly Water
  Energy and `mee-9`): all 68 are the expected card. The other hits in those sets are unchecked beyond the placeholder test.
- **Placeholder trap:** an unknown id returns **HTTP 200 with a card back** (45,551 bytes, identical for any unknown id).
  Status codes cannot tell a hit from a miss, so any use must compare the body.
- **Terms.** Best-practices page: "When using the Scrydex API, you are free to include the provided card images in your
  applications." and "Scrydex does not claim ownership of the images provided by the API. All images belong to their
  respective copyright holders." and "By using these images, you acknowledge that you are responsible for compliance with
  applicable copyright laws and permissions." As option 3: "If caching or hosting locally is not an option, you can directly
  reference the Scrydex-provided image URLs." And: "Never assume the urls -> they generally follow a specific pattern, but that
  is not guaranteed. Always reference the urls as returned by the API." Terms of Service §4, "You agree that you will not":
  "Resell, sublicense, redistribute, mirror, or commercially exploit the Services without prior written authorization from
  Scrydex." and "Use the Services primarily as a substitute backend, proxy, or wholesale data source for a competing
  commercial product or service without written authorization from Scrydex." Pricing page: no free tier (Starter $29/month).
- **Verdict:** the permission is conditional on "using the Scrydex API" (paid), the ToS bars mirroring without written
  authorization, while the CDN itself is public (`Access-Control-Allow-Origin: *`, `robots.txt` allows all). Read together I
  cannot tell whether hotlinking or bundling by a non-customer is allowed. **It needs written permission from Scrydex before
  the app uses it**; I sent them nothing.

### `PokemonTCG/pokemon-tcg-data` (GitHub)

Still applies and still has **no licence**: GitHub reports `license: null`, there is no LICENSE file (raw URL 404), and the
README says only "This project is being deprecated … Pokémon TCG Data and the Pokémon TCG API are legacy projects and are no
longer recommended for new integrations." Last push 2026-09-17 (30th Celebration); it has no `me06`. Its pictures are the
Scrydex ones above, so it adds data, not terms. Issue #334 "What LICENSE?" (open since 2023, no reply, per the earlier deck
research) is unchanged as far as I saw.

### TCGdex itself

`tcgdex/cards-database` is MIT ("The Database is licensed under the MIT License") and tcgdex.dev says "The TCGdex API is
free to use and requires no API key." There is **no statement on the pictures' licence**; the site says it "is not produced,
endorsed, supported, or affiliated with Nintendo or The Pokémon Company". Image contributions go through their Discord
("image contributions are handled through the Discord community"; "high-resolution scans in PNG or WebP format are
preferred"). Nothing allows or forbids bundling; the app already hotlinks them. That matters for option (c) and for the
other-language files: bundling them is redistribution under unstated terms.

### pokemon.com card database

`assets.pokemon.com/assets/cms2/img/cards/web/<SET>/<SET>_EN_<n>.png` answers for `SM35` and `SWSH45SV` (404 for the `ME` ids
I tried). The terms page returns a bot check to a script, so I read it through a summarizing fetch and the wording is
**unverified**: Section 5 grants use "for personal, noncommercial home use only", 5(ix) forbids "Use the Service or content for
commercial purposes", and 5(v) forbids "Download quantities of content to a database for any reason". **No:** bulk copying is
prohibited, and I did not try to get past the check.

### Limitless TCG

Only a copyright notice on the legal page: "The literal and graphical information presented on this website about the
Pokémon Trading Card Game, including card images and text, is copyright The Pokémon Company (Pokémon), Nintendo, Game Freak
and/or Creatures." No licence or reuse terms; the picture CDN returned 403 for my guessed path; the API needs a key given
only to "public-facing projects" (earlier research). **No.**

### Bulbapedia and Bulbagarden Archives

Bulbapedia `rightsinfo`: "Attribution-NonCommercial-ShareAlike 2.5", and its copyright page asks that a derived work carry the
same licence. A GPL-3.0 app cannot carry a non-commercial term (GPL-3.0 §10). The Archives report no site licence (per-file
tags). **No.**

### Not evaluated

TCGplayer, Cardmarket, Pokellector, PkmnCards (earlier note: forbids scraping), tcgcollector.com. TCGdex returns TCGplayer
and Cardmarket product ids per card (`variants_detailed.thirdParty`), but I found no public terms that allow the pictures, so
I stopped there.

### Yu-Gi-Oh!: the 516 cards without a TCG printing

From the raw YGOPRODeck data (fetched once with `misc=yes`; the build's cached file lacks `misc_info`): of the 516, **401 are
OCG-only** (an `ocg_date`, no `tcg_date`), 30 carry a TCG date but no set listing, 85 have no date at all (Duel Links,
tokens, video-game cards). **All 516 have `card_images`**, and 43 of 43 sampled passcodes answered
`cards_small/<passcode>.jpg`; 25 of 25 control cards with printings did too. They are not in the app (it expands printings),
so there is no visible gap and nothing to fix. The guide: "Do not continually hotlink images directly from this site. Please
download and re-host the images yourself. Failure to do so will result in an IP blacklist." (This probe made about 70 paced HEAD
requests and one 25 MB `cardinfo.php` request.)

### Magic

300 printings sampled evenly (every 328th) all answer `grid` pictures. The Scryfall search
`-is:highres lang:en game:paper` returns 3,256 printings: 3,094 `lowres` and 162 `missing` (their docs: "missing: The card has
no image, or the image is being processed"). **None of the 162 is in our catalog** (they are the `amh2` and `astx` "s" cards).
2,135 of our printings are `lowres`: they display, only soft. Scryfall's rule: "Do not cover, crop, or clip off the copyright
or artist name on card images." The existing hotlink-and-cache arrangement is unchanged and I did not re-read its caching terms.

## 4. Options

Sizes use measured averages: TCGdex `low.webp` 19.0 KB (median 18.4 KB, 19,659 cached files); a Scrydex picture as 245×337 WebP
about 15 KB (Energy about 8 KB). The current arm64 APK is 29.9 MB (1.8.2), the universal one 59.9 MB; assets repeat in each
split.

**(a) Fix the build to probe the file path.** In `scripts/build-catalog.mjs`, for every card whose GraphQL `image` is null,
HEAD `<predicted>/low.webp` (`low`, not `high`: tiles and `build-hashes.mjs` fetch `low` through `cardImageUrl`, and a card with
only one of the two would be marked `img: true` and still be broken), then the same under the parent set path (`swsh4.5`,
`swsh12.5`, `swsh9..12`); set `img: true` for the first and `img: "<parent base>"` for the second (the schema and `cardImageUrl`
already take a base URL string, and `build-hashes.mjs` goes through `cardImageUrl`, so hashes follow without a script change).
Recovers **371 cards** (34 Trainers, no Energy), no app change, no new terms; about 1,800 HEADs per build (about 8 minutes
paced, cacheable), and later builds pick up more `mep`, `svp` and `me06` uploads by themselves. Do **not** HEAD all 19,669
`img: true` cards in the catalog build (about 80 minutes at this pace on every build): `build-hashes.mjs` already downloads every
picture, so it should delete its `.404` markers before each run (six are stale today) and the catalog build should read that
list of 404s and drop `img` for the cards on it (four are broken today). The hash table grows by 371 × 32 B = 12 KB raw plus
six; the hash build downloads about 380 images (7 MB).

**(b) A second host per card.** Scrydex is the only source with real coverage: 1,608 cards, 1,238 of the cards TCGdex lacks
in English, Energy 205 of 209. It needs a per-card field (`sx: "me6-48"` or a per-set id), a small change in `cardImageUrl`
(`/small`, `/large`, no extension), and a body check against the card-back placeholder in the build (md5 prefix `f294d6fb8b51`
for the 245×342 small size). Cost: code plus the terms decision in section 3, **blocked on Scrydex's written permission**.
TCGdex's other-language pictures are another second host: 496 cards (119 Energy, 64 Trainers; the kits' basic Energy cards
are nearly language-neutral). They would show German, Spanish or Italian text on an English printing, which is borderline
"inventing data" and the owner's call. A narrower variant: use them **only for the scanner's hash** (the artwork window does
not depend on language; I did not measure how well that matches) and keep the card back on screen.

**(c) Bundle low-resolution pictures in the APK.**

| What | Cards | Size | APK effect |
|---|---|---|---|
| All Scrydex-covered gap cards | 1,608 | 24 MB | +24 MB per APK (arm64 29.9 → about 54 MB) |
| Still missing after (a), Scrydex-covered, `me06` left out | 1,097 | 16.5 MB | +16.5 MB |
| Trainer + Energy only, Scrydex-covered | 383 | 4.5 MB (205 Energy × 8 KB + 178 Trainer × 16 KB) | +4.5 MB |
| All 1,763 at TCGdex's 19 KB (upper bound) | 1,763 | 33 MB | +33 MB |

The owner accepts going past 30 MB. The hash tables are small either way (32 B per card, 1,763 cards = 56 KB); bundling
lets those cards enter the scanner's picture path because the build can hash the bundled file. Terms: Scrydex's ToS bars
"redistribute, mirror" without written authorization and TCGdex says nothing, so bundling is the most exposed use, not the
safest.

**(d) Leave the card back.** Free, honest, already shipped (`src/ui/CardBack.tsx`). The cost: 8.2 % of Pokémon cards and 36 % of
Energy cards, and those cards cannot be matched by the scanner's picture path.

## 5. Recommendation

**(a) now, (d) for the rest, and ask Scrydex.**

- (a) is the only option with no open terms question: it closes 371 cards, fixes the four broken pictures, restores six
  hashes, and keeps improving as TCGdex uploads more. It does **not** close the owner's focus: of 189 Trainer gaps it
  recovers 34, and of 209 Energy gaps none.
- The Trainer and Energy gaps are the old Trainer Kits, McDonald's, Dragon Majesty and the Energy sets, all of which TCGdex
  lacks in English; Scrydex is the only source with them. Ask Scrydex in writing whether a free, GPL-3.0 collection tracker
  may hotlink, or bundle for the 383 covered Trainer and Energy cards (about 4.5 MB), their pictures, and what credit they
  want. If yes, do **(c) for Trainer + Energy first** (small, offline, scanner-ready) and (b) hotlinking for the Pokémon cards
  later; if no, stay on the card back.
- Do not show other-language TCGdex pictures without the owner's explicit yes; the scanner-only hash use is the safer
  thing to propose.

## 6. What remains open

- Scrydex's answer (not asked) and whether TCGdex will state a licence for its pictures (their Discord is the channel).
- `me06` pictures at TCGdex: recheck in one to two weeks.
- Sets with no TCGdex hit were sampled (2–4 cards each), not counted card by card, so a few single cards in them may exist.
- pokemon.com's terms (bot-checked) were read second-hand; TCGplayer, Cardmarket and Pokellector were not evaluated.
- Scrydex hits: 837 checked by name against `pokemon-tcg-data` (831 right; the 6 wrong ones, `30th-c`, were dropped), 68 more
  checked by eye, about 710 only by the placeholder test (same sets as the 68, so the risk is a numbering shift inside a set).
- Reproduce with `node scripts/probe-card-images.mjs measure|tcgdex|census|scrydex|tiers|ygo|mtg`; the numbers above come from the
  cached runs of 2026-11-08 (`scripts/.cache/probe/tiers.json`).
