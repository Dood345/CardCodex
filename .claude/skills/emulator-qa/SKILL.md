---
name: emulator-qa
description: Smoke-test a CardCodex Android APK on the headless emulator (AVD "phidget") with scripts/emu.py — boot the emulator, adb install, launch the app, tap through the UI by visible text, take screenshots, read the app's logcat, measure its IndexedDB, and shut the emulator down. Use for "test the APK on the emulator", "does the build start", "screenshot the app", "check logcat", "how big is the database on the device", "emulator QA", "smoke-test the build".
---

# Emulator QA on the headless AVD "phidget"

Everything on the device goes through `scripts/emu.py` (Python 3, built-ins only). Run it from
the repo root as `python -I scripts/emu.py <command>`; `--help` lists the commands. It finds adb
and the emulator in `%LOCALAPPDATA%\Android\Sdk` (or `ANDROID_HOME`), targets `ANDROID_SERIAL`
or the first `emulator-*` serial, prints UTF-8, and calls adb directly (no Git Bash path mangling).

## Ground rules

- One emulator, headless, short. The AVD is also used by the user's Phidget project sessions and
  another agent may be using the GPU: `devices` first, never start a second instance, and `stop`
  when you are done unless the user asked to keep it running. If an emulator is already up when
  you arrive, use it and say so.
- The emulator is x86_64: install `release/CardCodex-<ver>-x86_64-*.apk` (or `-universal-`), never arm64.
- Debug and release APKs have different signatures. `install` uninstalls the old app when Android
  refuses the update; the app's data on the emulator is lost, which is fine on this device.
- Screenshots, the emulator log and build logs live under `scripts/.cache/emu/` (gitignored).
  Report screenshot paths as absolute paths. Never commit anything from `scripts/.cache/`.
- The camera is the emulator's emulated test pattern: enough to check that the scanner tab opens,
  asks for the permission and starts the camera, not to recognise cards.

## Procedure

```bash
python -I scripts/emu.py devices                 # anything running? (adb devices + AVD name)
python -I scripts/emu.py start                   # emulator -avd phidget -no-window -no-audio -gpu swiftshader_indirect -camera-back emulated -camera-front emulated, detached
python -I scripts/emu.py wait-boot               # polls sys.boot_completed; snapshot boot ~20-40 s, cold boot 1-3 min (--timeout 300); then wakes the screen and dismisses the keyguard
python -I scripts/emu.py install release/CardCodex-1.1.1-x86_64-release.apk   # adb install -r
python -I scripts/emu.py launch                  # am start -W com.independent.cardcodex/.MainActivity; prints TotalTime and the pid
python -I scripts/emu.py shot                    # PNG to scripts/.cache/emu/shot-<time>.png (or give a path)
python -I scripts/emu.py list                    # visible texts / content-descs with bounds
python -I scripts/emu.py tap "Skip tour"         # tap by text; exit 1 when not on screen
python -I scripts/emu.py logcat                  # the app's logcat (by pid); --lines N, --clear
python -I scripts/emu.py dbsize                  # WebView IndexedDB size via run-as (debug APK only, see below)
python -I scripts/emu.py stop                    # adb emu kill, waits until the device is gone
```

`start` returns at once and logs to `scripts/.cache/emu/emulator.log`; on a boot timeout
`wait-boot` prints the tail of that log. `wait-boot` works for an emulator somebody else started too.

## Driving the UI

- `list` is a `uiautomator dump`: it sees the WebView's DOM text (buttons, headings, chips), so
  the app can be driven entirely by text. Allow about a second after a tap before the next
  `list`/`shot`; the WebView is slow under SwiftShader. Right after `launch` the dump can be empty
  for a few seconds (`list` retries on its own). `list --all` adds class and resource-id.
- `tap <text>` matches text or content-desc, exact first, then substring, case-insensitive, and
  retries three times over ~5 s for a screen that is still animating. Use the shortest unique text.
- Texts measured on 1.1.1: first launch shows the tour (`Skip tour`, `Next` … `Done`). Bottom tabs
  `Pokédex` (`Archetypes` in Yu-Gi-Oh! mode), `Sets`, `Search`, `Scan`, `Collection`; top bar:
  the game pill (`Game: Pokémon TCG. Switch game`) and the gear (content-desc `Settings`). Scan tab
  intro: `Single cards` / `Binder page` switch, `Start camera`, `Scan a photo`. The first camera
  start raises Android's permission dialog: `tap "While using the app"`. A running camera shows
  `Scanning · ML Kit` (or `· Tesseract`), `Pause`, `Photo`, `Stop scanning`.
- A screenshot of each screen you judged is the evidence: take one before you say a screen is fine.

## Reading logcat and the database

- `logcat` filters by the app's pid (`-d`, last 400 lines). Look for `E/` lines, `AndroidRuntime`
  (crashes), `chromium` / `Capacitor/Console` (JS errors and `console.*` output), `Capacitor`
  plugin errors (camera, Filesystem, ML Kit). When the app is not running the command falls back
  to the crash / ActivityManager / Capacitor tags. `logcat --clear` before a scenario keeps it short.
  Normal noise on the emulator, not findings: `Not starting debugger since process cannot load the
  jdwp agent`, `ashmem … Pinning is deprecated`, `chromium … Seed missing signature`, `Disk cache
  backend fake index file has wrong size`, `MESA Failed to open rendernode` (SwiftShader).
  `cr_VideoCapture … CameraDevice.StateCallback onOpened` means the camera started.
- `dbsize` runs `run-as com.independent.cardcodex du -k app_webview` and prints the IndexedDB
  lines. **It only works for a debug APK** (`npm run android:debug` → `release/CardCodex-<ver>-x86_64-debug.apk`):
  the AVD runs a `google_apis_playstore` image without `adb root`, so a release APK's data cannot
  be read. Say so in the report instead of guessing a size.

## Pitfalls

- `adb install` of an arm64 APK fails with `INSTALL_FAILED_NO_MATCHING_ABIS`.
- If `tap` cannot find a text that is visibly there, the UI was mid-transition: `list` again.
  Web text that is clipped or scrolled off-screen is not in the dump.
- The emulator shares the `adb` server with any phone the user plugged in: the helper prefers
  the `emulator-*` serial; set `ANDROID_SERIAL` to pick another device.
- Do not run two emulator instances or a second `start`; `start` refuses while one is attached.
- `stop` falls back to `taskkill qemu-system-x86_64.exe` after 40 s; mention it if that happened.

## Report

APK installed (path, size) · boot time · each step with its result · absolute paths of the
screenshots · logcat findings (quote the lines) · IndexedDB size or why it was not measurable ·
whether the emulator was stopped · verdict.
