# Scrydex's permission to use their card images

CardCodex shows pictures from [Scrydex](https://scrydex.com) for the Pokémon cards that TCGdex has no
picture of. Scrydex's Terms of Service reserve redistribution and mirroring for written authorization,
so the project asked for it (`scrydex-request.md`, sent on 2026-11-08; the research behind the request
is `card-art-gaps.md`). This file is the record of the answer.

## The permission

Received by email from Scrydex Support on **2026-11-12**, in reply to that request (the greeting, the
signature and the addresses are left out; the text is otherwise as received):

> We're happy to support your project. Both of the approaches you've described are permitted, including
> downloading and bundling card images within your app or loading them directly from images.scrydex.com
> with local caching.
>
> You're also welcome to expand the image coverage beyond the initial 383 cards as needed.
>
> Normally, these permissions are included with our paid plans, but given that CardCodex is a free,
> open-source, and non-commercial project, we're happy to authorize the image usage you've described
> without requiring a subscription.
>
> Attribution isn't required, but we'd certainly appreciate a credit to Scrydex in your Settings screen
> and README. Something like "Card images provided by Scrydex" with a link to https://scrydex.com would
> be perfect.
>
> As you've mentioned, Scrydex doesn't own the underlying Pokémon artwork or trademarks, so our
> permission to use these image resources doesn't constitute a separate license from the original rights
> holders.
>
> This email serves as written authorization from Scrydex for the image usage you've described, subject
> to those third-party intellectual property rights.

The email itself is not in the repository.

## What it covers

- **Whose pictures:** the card images Scrydex serves from `images.scrydex.com`, for Pokémon cards.
- **Which uses:** both of the uses the request described: bundling low-resolution copies inside the app,
  and loading the pictures from `images.scrydex.com` on the user's device with caching on the device.
- **How many:** the 383 Trainer and Energy cards the request started with, and more as needed.
- **On what basis:** CardCodex being free, open source (GPL-3.0) and non-commercial; no subscription and
  no API key. The request said the project would come back to Scrydex first if it ever charged for the
  app or a service around it, and that still stands.
- **Credit:** not required, appreciated: "Card images provided by Scrydex" with a link to
  https://scrydex.com, in Settings and in the README. Both carry it.

## Its limit

It is **not a licence from the rights holders**. Scrydex does not own the Pokémon artwork or trademarks
and says so; the permission is for using their image files and service, "subject to those third-party
intellectual property rights". The pictures remain © The Pokémon Company, Nintendo, Creatures and GAME
FREAK, exactly as the ones served by TCGdex do, and CardCodex remains an unaffiliated fan project (see
"Credits and legal" in the README).

It also covers pictures only. CardCodex does not use the Scrydex API or its card data: the catalog is
built from TCGdex.

## What CardCodex does with it

The second of the two uses: **loading from `images.scrydex.com` with caching on the device**. The other
Pokémon pictures are loaded from TCGdex rather than bundled too, and bundling these would have added about
20 MB (1,335 pictures at about 15 KB each as WebP) to an APK of about 33 MB. As built on 2026-11-12, 1,335
cards get their picture this way: 983 Pokémon, 148 Trainer and 204 Energy cards.

- **Which cards:** only the cards TCGdex has no picture of, as the request said. The catalog build
  (`npm run catalog`) asks TCGdex first and hands Scrydex the rest (`scripts/scrydex-images.mjs`).
- **No guessed URLs:** Scrydex asks never to assume image URLs, and the request promised to use only the
  ids their public expansion list gives. The build reads the ids, card names and image URLs from Scrydex's
  public expansion pages, pairs a card only when the name agrees, and stores the picture's base URL in the
  catalog (`img`). Scrydex answers an id without a picture with a card back, so the build also compares the
  bytes with that placeholder before it marks a card.
- **Fetched once per device:** the app downloads a picture the first time its card is shown (as AVIF or
  WebP, whichever the device can decode; 10 to 25 KB for a tile), keeps it in the device's image store
  (`src/data/imageCache.ts`) and shows it from there afterwards, online or offline. Settings → Card images shows how much is stored and clears it. A picture that cannot be loaded
  (first view while offline) leaves the drawn card back the app showed before.
- **The scanner:** `npm run hashes` computes a 16-byte fingerprint of each small picture for the
  binder-page scanner, and `npm run energy-refs` a 20×20 grey thumbnail of the symbol on basic Energy
  cards. The downloaded pictures stay in the build machine's cache (`scripts/.cache/`, not in the
  repository and not in the app).
- **Requests during a build** are paced at four per second, carry a User-Agent that names the project,
  and are cached, so a rebuild inside a week asks for nothing.

The numbers (how many cards, which sets, what Scrydex does not have) are in the README's Data section and
change with every catalog build; `node scripts/scrydex-images.mjs` prints the current ones.
