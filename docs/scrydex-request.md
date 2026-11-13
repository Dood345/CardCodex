# Request to Scrydex for permission to use card pictures

**Status:** sent on 2026-11-08 and answered on 2026-11-12: Scrydex permits both uses. Their answer, what it
covers and what the app does with it are in [`scrydex-permission.md`](scrydex-permission.md). The draft
below is kept as the description of the use that the permission refers to.

Draft of the message to send to Scrydex (see `card-art-gaps.md`, section 3, for why their written
permission is needed). Fill in the sender's name; send from the project owner's address so the reply
reaches them. Where: `contact@scrydex.com` (the address behind the "Contact Us" link on
https://scrydex.com/support; their site has no form). Their Terms of Service: https://scrydex.com/terms.

---

**Subject:** Permission to use Scrydex card images in a free, open-source Pokémon TCG collection app

Hello Scrydex team,

I maintain CardCodex, a free and open-source (GPL-3.0) Android app that helps collectors track their
Pokémon TCG, Yu-Gi-Oh! and Magic collections: https://github.com/Dood345/CardCodex. It is free to
use and free of ads, it is not a card database service of its own, and it shows one picture per
card on the user's own phone so they can tell their cards apart. If we ever charge for the app or
for a service around it, we will come back to you first.

Our Pokémon pictures come from TCGdex, which has no English picture for about 1,400 cards, mostly the
older Trainer Kits, McDonald's promos, Dragon Majesty and the Energy cards. Scrydex serves pictures
for about 1,600 of the cards we lack, and your best-practices page allows including images in
applications that use the Scrydex API, while your Terms of Service reserve redistribution and
mirroring for written authorization. We would like to ask for that authorization in writing, for
either of two uses, whichever you prefer:

1. Bundling low-resolution copies (about 245 × 337 px, WebP, roughly 15 KB each) of the pictures
   for the 383 Trainer and Energy cards we lack, inside the app itself, so they work offline. That
   is about 4.5 MB in total. If you agree, we would also like to extend this later to the remaining
   Pokémon cards we lack (about 1,100 cards, 16 MB).
2. Or, if you would rather we did not store copies, loading the small pictures from
   `images.scrydex.com` directly on the user's device for those cards only, with caching on the
   device so each picture is fetched once.

In either case we would credit Scrydex in the app's Settings screen and README, next to our
existing credits for TCGdex, YGOPRODeck and Scryfall, in whatever wording you ask for, and we would
use only the card ids your public expansion list gives rather than guessing URL patterns. We
understand the images themselves remain the property of their copyright holders.

If an API subscription is the condition for this use, please tell us which plan covers it; if you
would rather we did not use the pictures at all, we will stay with our drawn placeholder.

Thank you for your time and for the service you run.

Kind regards,

<name>
CardCodex maintainer
https://github.com/Dood345/CardCodex
