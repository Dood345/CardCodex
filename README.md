# Pocket Collection

An integrated Android utility tool for the **Pokémon Trading Card Game (TCG)**, designed primarily to bridge the gap between card collecting and competitive play.

The core concept is to solve the "fragmentation of function" found in the current TCG app market, which forces users to use separate apps for tracking value versus building decks.

The application is designed around three primary feature pillars:

1.  **Collection Management (The Collector)**: The app allows you to **keep track of your Pokémon card collection** like a Pokédex. While users prefer the visual satisfaction of a "Pokédex" view, the recommended implementation strategy is to use a **Binder/Set View as the core database** (because it handles Trainer cards and maps directly to API data), with the Pokédex acting as a **secondary achievement layer** for gamification.
2.  **Virtual Deck Building (The Player)**: Users can **make decks virtually** to plan out their real-life decks. This is intended to support a **"bottom-up" deck building workflow** that starts with a user's collection, rather than the "top-down" workflow supported by existing competitive apps.
3.  **The "Killer Feature" (Integration)**: The app's **unique value proposition** is the ability to **filter the virtual deck builder to use *only* cards registered in the user's personal collection**. This critical feature, which is currently missing from market-leading apps like pkmn.gg and Dragon Shield, allows users to **tune decks directly from the cards they own**.
4.  **Wishlist/Wanted Feature**: The app includes a feature to **make note of cards you want to add to your collection**. This feature is integrated seamlessly by automatically generating a "Cards Missing" list (the Wishlist) when a user saves a deck built in "theorycrafting" mode, instantly showing what they need to acquire.

In summary, the app aims to be a single ecosystem that seamlessly links a user’s physical card inventory (The Collection) with their competitive planning tool (The Deck Builder).