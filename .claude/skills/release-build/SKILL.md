---
name: release-build
description: Build the signed CardCodex Android release APKs — run the vitest suite and the typecheck first (with pipefail so a failing test cannot hide behind a pipe), then `npm run android:release`, verify that the APK's bundled JS contains a marker string the caller named, and report the APK paths in release/. Use for "build a release", "cut a release APK", "build the signed APKs", "make an APK for my phone", "ship version x.y.z".
---

# Release build (signed Android APKs)

Inputs from the caller: the **marker**, a user-visible string that the new code ships (a label,
a heading, an error text; identifiers may be minified away), and whether the **version** in
`package.json` should be bumped (`versionName`/`versionCode` derive from it). Do not bump the
version on your own; if `release/` already holds APKs for the current version, say so.

## Steps (from the repo root, Git Bash)

1. `git status --short` — the build ships the working tree, so note anything uncommitted.
2. Tests, with pipefail so the pipeline fails when vitest fails (otherwise `| tail` makes it exit 0):

   ```bash
   set -o pipefail; npx vitest run 2>&1 | tail -n 15
   ```

   Expect `Test Files N passed` / `Tests N passed` (99 tests as of 2026-11-01). Any failure stops
   the release: report it, do not build.
3. Typecheck: `npx tsc --noEmit`. `scripts/android-release.mjs` runs `vite build` directly, which
   does **not** type-check, so this is the only gate for type errors.
4. Build:

   ```bash
   npm run android:release
   ```

   `vite build` → `cap sync android` → `gradlew assembleRelease --no-daemon` → copies the APKs to
   `release/`. About 20 s when Gradle is up to date, several minutes after native or plugin
   changes: run it in the background (or with a long timeout) and tail its log. It needs JDK 21
   (the script picks Android Studio's JBR when `JAVA_HOME` is unset) and `android/keystore.properties`;
   exit code 2 `No release signing configured` means the signing files are missing on this machine:
   stop and tell the user, never create or edit signing files yourself.
5. Verify the shipped JS (the web build is at `assets/public/assets/*.js` inside the APK):

   ```bash
   unzip -l release/CardCodex-<ver>-arm64-v8a-release.apk 'assets/public/assets/*.js'
   ```

   ```bash
   unzip -p release/CardCodex-<ver>-arm64-v8a-release.apk 'assets/public/assets/*.js' | grep -c -F '<marker>'
   ```

   A count of 0 means the marker is not in the shipped code (stale `dist/`, wrong branch, or the
   string changed): do not report success. The version is in the bundle too, but as a separate
   template piece (`` `CardCodex v`,`1.1.1` ``), so grep for the bare `1.1.1`, not `"1.1.1"`.
   Check the four APKs exist with the right version:
   `ls -la release/CardCodex-<ver>-*-release.apk` (arm64-v8a, armeabi-v7a, x86_64, universal).
6. Report: version, test count, marker count, the four APK paths with sizes, and the install
   line for a phone (`adb install -r release/CardCodex-<ver>-arm64-v8a-release.apk`). The
   emulator takes the x86_64 APK (emulator-qa skill).

## Never

- Print, `cat`, grep or quote `android/keystore.properties`, the `ANDROID_KEYSTORE_*` /
  `ANDROID_KEY_*` environment variables, or anything under `android/keystore/`.
- `git add -f` or copy the keystore, `keystore.properties`, `release/` or `*.apk`; all are gitignored
  on purpose. `git status` must not show them staged.
- Change the signing configuration in `android/app/build.gradle`.

## Pitfalls

- A phone or emulator that has the debug-signed app refuses the release APK (and vice versa):
  `adb uninstall com.independent.cardcodex` first (collection data on that device is lost, so
  export a backup from Settings before doing that on the user's phone).
- `npm run android:debug` builds debug-signed APKs with the same names (`-debug.apk`); the
  emulator's `dbsize` check needs those.
- `cap sync` rewrites `android/app/src/main/assets/public/` and `dist/` (both gitignored). A
  Gradle failure after plugin changes is usually fixed by `cd android && ./gradlew clean`.
- GitHub Actions builds a debug APK on every push; releases are only built locally.
