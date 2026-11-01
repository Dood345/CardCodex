#!/usr/bin/env python
"""CardCodex emulator helper: drive the headless Android emulator from the command line.

Run from the repo root with ``python -I scripts/emu.py <command>`` (built-ins only).

    start [-- <extra emulator args>]   start AVD "phidget" headless, detached (log: scripts/.cache/emu/emulator.log)
    wait-boot [--timeout S]            wait until Android finished booting, wake the screen, dismiss the keyguard
    devices                            list adb devices and the running AVD's name
    install <apk>                      adb install -r (uninstalls first when the signature differs)
    launch                             start com.independent.cardcodex/.MainActivity and print the launch time
    list [--all]                       visible UI texts / content-descs with bounds (uiautomator dump)
    tap <text>                         tap the first node whose text or content-desc equals, else contains, <text>
    shot [out.png]                     screenshot (default scripts/.cache/emu/shot-<time>.png)
    logcat [--lines N] [--clear]       the app's logcat (filtered by its pid; --clear empties the buffer)
    dbsize                             size of the app's WebView IndexedDB via run-as (debug APK only)
    stop                               adb emu kill, wait for the device to go away

adb and the emulator are looked up in ANDROID_HOME / ANDROID_SDK_ROOT / %LOCALAPPDATA%\\Android\\Sdk;
the device is ANDROID_SERIAL or the first emulator-* serial; CARDCODEX_AVD overrides the AVD name.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import os
import pathlib
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001 - not a real console
        pass

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / ".cache" / "emu"
SDK = pathlib.Path(
    os.environ.get("ANDROID_HOME")
    or os.environ.get("ANDROID_SDK_ROOT")
    or os.path.join(os.environ.get("LOCALAPPDATA", ""), "Android", "Sdk")
)
EXE = ".exe" if os.name == "nt" else ""
ADB = SDK / "platform-tools" / f"adb{EXE}"
EMULATOR = SDK / "emulator" / f"emulator{EXE}"
APP = "com.independent.cardcodex"
ACTIVITY = f"{APP}/.MainActivity"
AVD = os.environ.get("CARDCODEX_AVD", "phidget")
HEADLESS = ["-no-window", "-no-audio", "-gpu", "swiftshader_indirect", "-camera-back", "emulated", "-camera-front", "emulated"]


def die(msg: str, code: int = 1) -> None:
    print(msg, file=sys.stderr)
    sys.exit(code)


# ---------------------------------------------------------------- adb plumbing

def adb_raw(*args: str, binary: bool = False, timeout: float | None = 120, serial: str | None = None) -> bytes | str:
    """Run adb; returns stdout (+ stderr when text) without raising on a non-zero exit."""
    if not ADB.exists():
        die(f"adb not found at {ADB} (set ANDROID_HOME)")
    cmd = [str(ADB)] + (["-s", serial] if serial else []) + list(args)
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        die(f"adb {' '.join(args)} timed out after {timeout}s")
    if binary:
        return r.stdout
    return (r.stdout + r.stderr).decode("utf-8", "replace")


def devices() -> list[tuple[str, str]]:
    rows = []
    for line in str(adb_raw("devices")).splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2 and not line.startswith("*"):
            rows.append((parts[0], parts[1]))
    return rows


def serial(required: bool = True) -> str | None:
    s = os.environ.get("ANDROID_SERIAL")
    if s:
        return s
    emus = [d for d, state in devices() if d.startswith("emulator-")]
    if not emus and required:
        die("no emulator attached: run `python -I scripts/emu.py start` then `wait-boot`", 3)
    return emus[0] if emus else None


def adb(*args: str, binary: bool = False, timeout: float | None = 120) -> bytes | str:
    return adb_raw(*args, binary=binary, timeout=timeout, serial=serial())


def shell(*args: str, timeout: float | None = 60) -> str:
    return str(adb("shell", *args, timeout=timeout)).strip()


# ---------------------------------------------------------------- commands

def cmd_start(extra: list[str]) -> int:
    running = [d for d, _ in devices() if d.startswith("emulator-")]
    if running:
        print(f"emulator already running: {', '.join(running)} (use `stop` first to restart it)")
        return 0
    if not EMULATOR.exists():
        die(f"emulator not found at {EMULATOR} (set ANDROID_HOME)")
    CACHE.mkdir(parents=True, exist_ok=True)
    log = CACHE / "emulator.log"
    args = [str(EMULATOR), "-avd", AVD, *HEADLESS, *extra]
    kwargs: dict = {"stdin": subprocess.DEVNULL, "stdout": open(log, "ab"), "stderr": subprocess.STDOUT, "close_fds": True}
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    p = subprocess.Popen(args, **kwargs)
    print(f"started emulator pid {p.pid}: avd {AVD}, headless ({' '.join(HEADLESS)}){' ' + ' '.join(extra) if extra else ''}")
    print(f"log: {log}")
    print("next: python -I scripts/emu.py wait-boot")
    return 0


def cmd_wait_boot(timeout: float) -> int:
    t0 = time.time()
    last = ""
    while time.time() - t0 < timeout:
        online = [d for d, state in devices() if d.startswith("emulator-") and state == "device"]
        if online:
            s = online[0]
            booted = str(adb_raw("shell", "getprop", "sys.boot_completed", serial=s, timeout=20)).strip()
            anim = str(adb_raw("shell", "getprop", "init.svc.bootanim", serial=s, timeout=20)).strip()
            state = f"{s}: boot_completed={booted or '-'} bootanim={anim or '-'}"
            if booted == "1" and anim in ("stopped", ""):
                adb_raw("shell", "input", "keyevent", "KEYCODE_WAKEUP", serial=s, timeout=20)
                adb_raw("shell", "wm", "dismiss-keyguard", serial=s, timeout=20)
                print(f"booted in {time.time() - t0:.0f} s ({state}); screen awake, keyguard dismissed")
                return 0
        else:
            state = "waiting for an emulator-* device" + (f" (adb devices: {devices()})" if devices() else "")
        if state != last:
            print(f"  {time.time() - t0:4.0f} s  {state}")
            last = state
        time.sleep(3)
    log = CACHE / "emulator.log"
    tail = log.read_text("utf-8", "replace").splitlines()[-15:] if log.exists() else []
    die("boot did not complete within %.0f s%s" % (timeout, ("\n--- emulator.log tail ---\n" + "\n".join(tail)) if tail else ""), 4)
    return 4


def cmd_devices() -> int:
    print(str(adb_raw("devices", "-l")).strip())
    for d, state in devices():
        if d.startswith("emulator-") and state == "device":
            name = str(adb_raw("emu", "avd", "name", serial=d, timeout=15)).strip().splitlines()
            print(f"{d}: avd {name[0] if name else '?'}")
    return 0


def cmd_install(apk: str) -> int:
    p = pathlib.Path(apk).expanduser().resolve()
    if not p.exists():
        die(f"APK not found: {p}")
    print(f"installing {p} ({p.stat().st_size / 1e6:.1f} MB)")
    out = str(adb("install", "-r", str(p), timeout=600))
    if "INSTALL_FAILED_UPDATE_INCOMPATIBLE" in out or "signatures do not match" in out:
        print("installed app has a different signature (debug vs release): uninstalling it first (its data is lost)")
        print(str(adb("uninstall", APP)).strip())
        out = str(adb("install", "-r", str(p), timeout=600))
    print(out.strip())
    return 0 if "Success" in out else 1


def cmd_launch() -> int:
    out = shell("am", "start", "-W", "-n", ACTIVITY)
    print(out)
    ok = "Complete" in out or "Status: ok" in out
    pid = shell("pidof", APP)
    print(f"pid: {pid or '(not running)'}")
    return 0 if ok and pid else 1


_BOUNDS = re.compile(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]")


def dump_nodes() -> list[dict]:
    """[{text, desc, cls, rid, x0, y0, x1, y1}] of the current screen (uiautomator dump)."""
    err = ""
    for _ in range(4):
        msg = shell("uiautomator", "dump", "/sdcard/ui.xml", timeout=60)
        if "dumped to" not in msg:
            err = msg
            time.sleep(1.5)
            continue
        xml = adb("exec-out", "cat", "/sdcard/ui.xml", binary=True)
        try:
            root = ET.fromstring(xml)
        except ET.ParseError as e:
            err = f"ui.xml parse error: {e}"
            time.sleep(1.5)
            continue
        nodes = []
        for n in root.iter("node"):
            m = _BOUNDS.match(n.get("bounds") or "")
            if not m:
                continue
            x0, y0, x1, y1 = map(int, m.groups())
            nodes.append({
                "text": n.get("text") or "", "desc": n.get("content-desc") or "",
                "cls": (n.get("class") or "").rsplit(".", 1)[-1], "rid": n.get("resource-id") or "",
                "x0": x0, "y0": y0, "x1": x1, "y1": y1,
            })
        return nodes
    die(f"uiautomator dump failed: {err.strip() or 'no output'} (is the app still animating / is the screen on?)", 5)
    return []


def cmd_list(show_all: bool) -> int:
    # Right after a launch the WebView's accessibility tree can still be empty: retry a few times.
    for attempt in range(4):
        nodes = dump_nodes()
        if any(n["text"] or n["desc"] for n in nodes) or attempt == 3:
            break
        time.sleep(2)
    for n in nodes:
        if not show_all and not (n["text"] or n["desc"]):
            continue
        extra = f"  [{n['cls']}{' ' + n['rid'] if n['rid'] else ''}]" if show_all else ""
        print(f"{n['x0']},{n['y0']}-{n['x1']},{n['y1']}  {n['text']!r}  {n['desc']!r}{extra}")
    return 0


def cmd_tap(needle: str) -> int:
    key = needle.lower()
    for attempt in range(3):
        nodes = [n for n in dump_nodes() if n["x1"] > n["x0"] and n["y1"] > n["y0"]]
        exact = [n for n in nodes if n["text"].lower() == key or n["desc"].lower() == key]
        loose = [n for n in nodes if key in n["text"].lower() or key in n["desc"].lower()]
        for n in exact + loose:
            x, y = (n["x0"] + n["x1"]) // 2, (n["y0"] + n["y1"]) // 2
            shell("input", "tap", str(x), str(y))
            print(f"tapped {needle!r} at {x},{y} ({(n['text'] or n['desc'])!r}, {n['cls']})")
            return 0
        if attempt < 2:
            time.sleep(1.5)
    print(f"not found on screen: {needle!r} (run `list` to see what is there)")
    return 1


def cmd_shot(out: str | None) -> int:
    if out:
        path = pathlib.Path(out).expanduser().resolve()
    else:
        CACHE.mkdir(parents=True, exist_ok=True)
        path = CACHE / f"shot-{_dt.datetime.now():%Y%m%d-%H%M%S}.png"
    png = adb("exec-out", "screencap", "-p", binary=True)
    if not png.startswith(b"\x89PNG"):
        die(f"screencap returned no PNG ({len(png)} bytes): {png[:120]!r}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    print(f"saved {path} ({len(png) / 1e3:.0f} KB)")
    return 0


def cmd_logcat(lines: int, clear: bool) -> int:
    if clear:
        adb("logcat", "-c")
        print("logcat buffer cleared")
        return 0
    pid = shell("pidof", APP)
    if pid:
        out = str(adb("logcat", "-d", "-v", "time", f"--pid={pid}", "-t", str(lines), timeout=60))
        print(f"--- logcat for {APP} pid {pid} (last {lines} lines) ---")
    else:
        out = str(adb("logcat", "-d", "-v", "time", "-t", str(lines), "-s", "AndroidRuntime:E", "ActivityManager:I", "Capacitor:*", "Capacitor/Console:*", "chromium:*", timeout=60))
        print(f"--- {APP} is not running; crash / activity / Capacitor lines (last {lines}) ---")
    print(out.strip())
    return 0


def cmd_dbsize() -> int:
    info = [l.strip() for l in shell("dumpsys", "package", APP).splitlines() if "versionName=" in l or "codePath=" in l]
    print("; ".join(info[:2]) if info else f"{APP} is not installed")
    out = shell("run-as", APP, "du", "-k", "app_webview")
    low = out.lower()
    if "not debuggable" in low or "unknown package" in low or "run-as:" in low:
        print(f"run-as refused: {out.splitlines()[0] if out else '(no output)'}")
        print("IndexedDB can only be measured on a debug build (npm run android:debug → release/CardCodex-<ver>-x86_64-debug.apk);")
        print("the google_apis_playstore system image has no adb root, so a release APK's data is unreadable.")
        return 2
    rows = [l for l in out.splitlines() if l.strip()]
    idb = [l for l in rows if "IndexedDB" in l]
    print("IndexedDB (KB  path):")
    for l in idb or ["  (no IndexedDB directory yet: open the app once)"]:
        print("  " + l)
    if rows:
        print("app_webview total: " + rows[-1])
    return 0


def cmd_stop() -> int:
    s = serial(required=False)
    if not s:
        print("no emulator running")
        return 0
    print(str(adb_raw("emu", "kill", serial=s, timeout=30)).strip() or "sent emu kill")
    for _ in range(20):
        time.sleep(2)
        if s not in [d for d, _ in devices()]:
            print(f"{s} is gone")
            return 0
    if os.name == "nt":
        print("still attached after 40 s; killing qemu-system-x86_64.exe")
        subprocess.run(["taskkill", "/F", "/IM", "qemu-system-x86_64.exe"], capture_output=True)
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="emu.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("start", help="start the AVD headless, detached")
    p.add_argument("extra", nargs=argparse.REMAINDER, help="extra emulator arguments (after --)")
    p = sub.add_parser("wait-boot", help="wait for boot to complete")
    p.add_argument("--timeout", type=float, default=300)
    sub.add_parser("devices", help="adb devices + AVD name")
    p = sub.add_parser("install", help="adb install -r <apk>")
    p.add_argument("apk")
    sub.add_parser("launch", help="start the app")
    p = sub.add_parser("list", help="visible texts with bounds")
    p.add_argument("--all", action="store_true", help="every node, with class and resource-id")
    p = sub.add_parser("tap", help="tap a node by text / content-desc")
    p.add_argument("text")
    p = sub.add_parser("shot", help="screenshot to PNG")
    p.add_argument("out", nargs="?")
    p = sub.add_parser("logcat", help="the app's logcat")
    p.add_argument("--lines", type=int, default=400)
    p.add_argument("--clear", action="store_true")
    sub.add_parser("dbsize", help="WebView IndexedDB size (debug APK)")
    sub.add_parser("stop", help="shut the emulator down")
    a = ap.parse_args(argv)
    if a.cmd == "start":
        return cmd_start([x for x in a.extra if x != "--"])
    if a.cmd == "wait-boot":
        return cmd_wait_boot(a.timeout)
    if a.cmd == "devices":
        return cmd_devices()
    if a.cmd == "install":
        return cmd_install(a.apk)
    if a.cmd == "launch":
        return cmd_launch()
    if a.cmd == "list":
        return cmd_list(a.all)
    if a.cmd == "tap":
        return cmd_tap(a.text)
    if a.cmd == "shot":
        return cmd_shot(a.out)
    if a.cmd == "logcat":
        return cmd_logcat(a.lines, a.clear)
    if a.cmd == "dbsize":
        return cmd_dbsize()
    if a.cmd == "stop":
        return cmd_stop()
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except BrokenPipeError:  # `| head` closed the pipe
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        sys.exit(0)
