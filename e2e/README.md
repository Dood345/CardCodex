# Browser checks

`npm run e2e` opens the app in a headless Chrome at phone size (412 × 915) and goes through it the way a
person would: it starts each game, opens deck pages, builds a deck and keeps it, reads Settings. The unit
tests (`npm test`) cover the logic; these cover what only shows in the running app: that a screen
appears at all, that a button does what its label says, that nothing scrolls sideways on a phone, that
no screen throws.

```bash
npm run e2e
```

```bash
npm run e2e -- decks
```

The second form runs only the checks whose name contains the word (a file name or part of a check's
name). `E2E_BASE=http://localhost:5173 npm run e2e` uses a dev server that is already running instead of
starting one.

## What is covered

| File | Checks |
| --- | --- |
| `boot.e2e.mjs` | Pokémon, Yu-Gi-Oh! and Magic each open on their sets, and a set opens to its cards |
| `decks.e2e.mjs` | the copy-limit reminder in all three games; twelve old Special Darkness Energy flagged, explained and switched to basic Energy with the owned copies; a mixed deck not flagged; the large card view from a deck line |
| `recommender.e2e.mjs` | the three card sources and their one-line explanations; "Only my cards" building from owned cards alone; in each game a deck built from an idea, kept, its Deck check and a practice hand |
| `settings.e2e.mjs` | "How decks are recommended" for each game, the version, the Scrydex credit and link |
| `appearance.e2e.mjs` | an accent colour and the true black background apply at once and last a reload; true black stays out of the light theme; a list with a quick scroll hides the pane's own scrollbar |

Nineteen checks, about a minute on a desktop. CI runs them on every push and pull request.

## What is not covered

- **The scanner.** It needs a camera. The checks made by hand so far fed Chrome a recorded video as a
  fake camera (`--use-file-for-fake-video-capture`), which needs a video file built with ffmpeg; that is
  not in the repository yet.
- **Card pictures.** They come from other hosts (TCGdex, Scrydex, YGOPRODeck, Scryfall), and a check
  that depends on someone else's server fails for reasons that are not ours. The picture rules are
  covered by unit tests (`src/data/card-images.test.ts`).
- **The Android shell.** These run the web app; the APK is checked on the emulator (the `emulator-qa`
  skill). One thing only the shell can show: the system scrollbar Android draws on the WebView beside
  the quick scroll, which the app turns off through `ShellPlugin` (checked on the emulator, scrolled past
  a fifth of the Pokédex, where the bar's thumb comes out from under the top bar).

## How it works

- `lib/browser.mjs` starts the Chrome already on the machine (`CHROME_PATH` to choose another) and talks
  to it over the DevTools protocol with Node's own WebSocket: no test framework and no browser
  download. Every check gets a browser context of its own, so it starts with empty storage.
- `lib/app.mjs` starts a Vite dev server on a free port. The dev server, not a production build,
  because a check seeds its data through the app's own modules (`import('/src/data/db.ts')` in the
  page), which is the same code the app uses to write it.
- `run.mjs` runs the checks one after another. A check fails on a thrown assertion, on a wait that times
  out, or on any uncaught exception in the page. A failed check leaves a screenshot under `e2e/.out/`
  (ignored by git) and the run exits with code 1.

## Writing a check

A file `something.e2e.mjs` exports a list of `{ name, run({ page, base }) }`.

```js
import assert from 'node:assert/strict';
import { openApp } from './lib/app.mjs';

export default [
  {
    name: 'Pokémon: the collection tab opens',
    async run({ page, base }) {
      await openApp(page, base, 'pokemon', '#/collection');
      const title = await page.waitFor(() => document.querySelector('#main h1')?.innerText, { what: 'the page title' });
      assert.match(title, /Collection/);
    },
  },
];
```

`page.run(fn, ...args)` runs a function in the page and returns its result; the function is sent as
source, so it sees the page and its arguments and nothing of the file around it. `page.waitFor(fn)` polls
until the function returns something truthy. Wait for what should appear, never for a length of time.
A change that touches a screen all three games share gets a check in each game.
