#!/usr/bin/env bash
#
# Manual check for "app buttons sit under the Android system nav bar" reports.
# Installs a build on the one attached emulator/device, switches to 3-button
# navigation, captures the main screen and the opened side nav, and compares
# the lowest app element against the top of the nav bar. Run once per AVD in
# the band you need (the WebView version decides SystemBars' branch, so the
# script prints it). Results and the band matrix:
# docs/android-edge-to-edge-keyboard.md ("Nav-bar overlap check").
#
# Usage (outside the sandbox, emulator already booted):
#   android/run-android-navbar-check.sh                  # latest release APK
#   android/run-android-navbar-check.sh v19.3.0          # a release tag
#   android/run-android-navbar-check.sh path/to/app.apk  # a local build
set -uo pipefail

PKG=com.superproductivity.superproductivity
ARG="${1:-}"
OUT=".tmp/navbar-check/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"

if [ -f "$ARG" ]; then
  APK="$ARG"
else
  # Releases attach a Play build; a fresh install of it is what users get.
  gh release download ${ARG:+"$ARG"} -p app-play-release.apk -D "$OUT" --clobber || exit 1
  APK="$OUT/app-play-release.apk"
fi

adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; do sleep 2; done

# Lowest bottom edge of the app's clickable elements in a uiautomator dump.
lowest_app_bottom() {
  grep -o "package=\"$PKG\"[^>]*clickable=\"true\"[^>]*bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"" "$1" |
    sed -E 's/.*\]\[[0-9]+,([0-9]+)\]"$/\1/' | sort -n | tail -1
}

# Rightmost clickable element in the bottom fifth: the bottom nav's menu slot.
menu_button_center() {
  local h="$1" dump="$2"
  grep -o "package=\"$PKG\"[^>]*clickable=\"true\"[^>]*bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"" "$dump" |
    sed -E 's/.*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]"$/\1 \2 \3 \4/' |
    awk -v h="$h" '$2 > h * 0.8 { print $3, int(($1 + $3) / 2), int(($2 + $4) / 2) }' |
    sort -n | tail -1 | cut -d' ' -f2-
}

dump_ui() {
  adb shell uiautomator dump /sdcard/sp-ui.xml >/dev/null && adb pull /sdcard/sp-ui.xml "$1" >/dev/null
}

SDK="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
WEBVIEW="$(adb shell dumpsys webviewupdate | grep -m1 'Current WebView package' | tr -d '\r')"
HEIGHT="$(adb shell wm size | grep -oE '[0-9]+x[0-9]+' | tail -1 | cut -dx -f2)"

adb shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.threebutton
sleep 2
# Top edge of the nav bar's inset source, e.g. "frame=[0,2298][1080,2424]".
NAVBAR_TOP="$(adb shell dumpsys window | grep -m1 -A2 'type=navigationBars' |
  grep -oE 'frame=\[[0-9]+,[0-9]+\]' | head -1 | sed -E 's/.*,([0-9]+)\]/\1/')"

adb uninstall "$PKG" >/dev/null 2>&1
adb install -r "$APK" || exit 1
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 15
adb exec-out screencap -p >"$OUT/main.png"
dump_ui "$OUT/main.xml"

MENU="$(menu_button_center "$HEIGHT" "$OUT/main.xml")"
if [ -n "$MENU" ]; then
  adb shell input tap $MENU
  sleep 2
  adb exec-out screencap -p >"$OUT/menu.png"
  dump_ui "$OUT/menu.xml"
fi

# CSS-to-device-px rounding can put a correct edge 1-2px past the bar top; a
# real overlap is the full bar height (~48dp).
TOLERANCE_PX=4

result=0
{
  echo "sdk=$SDK height=$HEIGHT navbarTop=${NAVBAR_TOP:-unknown}"
  echo "$WEBVIEW"
  for f in main menu; do
    [ -f "$OUT/$f.xml" ] || { echo "$f: FAIL no UI dump"; continue; }
    bottom="$(lowest_app_bottom "$OUT/$f.xml")"
    if [ -z "$NAVBAR_TOP" ] || [ -z "$bottom" ]; then
      echo "$f: lowest app element ${bottom:-?} — check $f.png by eye"
    elif [ "$bottom" -le $((NAVBAR_TOP + TOLERANCE_PX)) ]; then
      echo "$f: PASS lowest app element $bottom, nav bar top $NAVBAR_TOP (+${TOLERANCE_PX}px tolerance)"
    else
      echo "$f: FAIL lowest app element $bottom, nav bar top $NAVBAR_TOP (+${TOLERANCE_PX}px tolerance)"
    fi
  done
} | tee "$OUT/result.txt"
grep -q FAIL "$OUT/result.txt" && result=1

echo "artifacts -> $OUT"
exit "$result"
