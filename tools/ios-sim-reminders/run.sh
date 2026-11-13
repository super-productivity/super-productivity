#!/usr/bin/env bash
# iOS Simulator check for task reminders: do they fire while the app is
# terminated, and which ones survive iOS's cap of 64 pending notifications?
# Needs macOS with Xcode; built for .github/workflows/ios-simulator-reminders.yml
# because nobody maintaining this has a Mac at hand.
#
#   run.sh prepare   boot a Simulator and build the Allow-tap UI test (fails fast)
#   run.sh test      build the app with harness.js injected, run the phases, assert
#
# `test` expects a non-production web build (the harness seeds data through
# window.__e2eTestHelpers), `npx cap sync ios` and `pod install` to be done.
#
# A Simulator proves scheduling and delivery of local notifications. It cannot
# prove background refresh: Apple's debug triggers for it work on devices only.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# RUNNER_TEMP is set by GitHub Actions; the workflow uploads $WORK/out from there.
WORK="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ios-sim-reminders"
OUT="$WORK/out"
BUNDLE_ID=com.super-productivity.app
UDID=""
HDIR=""
mkdir -p "$OUT"

# Full output goes to a log file; only a failure prints its tail.
quiet() {
  local log="$OUT/$1.log"
  shift
  if ! "$@" >"$log" 2>&1; then
    tail -n 80 "$log"
    return 1
  fi
}

pick_simulator() {
  xcrun simctl list devices available -j | node -e '
    const { devices } = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const isIphone = (d) => d.name.startsWith("iPhone");
    const version = (key) => key.match(/iOS-(\d+)-(\d+)/).slice(1).map(Number);
    const runtime = Object.keys(devices)
      .filter((key) => /SimRuntime\.iOS-\d+-\d+/.test(key) && devices[key].some(isIphone))
      .sort((a, b) => version(b)[0] - version(a)[0] || version(b)[1] - version(a)[1])[0];
    if (!runtime) {
      console.error("no iPhone Simulator available");
      process.exit(1);
    }
    const device = devices[runtime].find(isIphone);
    console.error(`using ${device.name} on ${runtime}`);
    console.log(device.udid);
  '
}

prepare() {
  UDID=$(pick_simulator)
  echo "$UDID" >"$WORK/udid"
  quiet sim-boot xcrun simctl bootstatus "$UDID" -b
  ruby "$HERE/make-allow-tap-project.rb" "$WORK/tap" "$HERE/AllowTap.swift"
  quiet tap-build xcodebuild build-for-testing \
    -project "$WORK/tap/AllowTap.xcodeproj" -scheme AllowTap \
    -destination "id=$UDID" -derivedDataPath "$WORK/tap-dd"
}

set_phase() {
  printf '{"phase":"%s"}\n' "$1" >"$HDIR/cmd.json"
}

# field <phase> <dotted.path>: a value from that phase's report, empty if absent.
field() {
  node -e '
    try {
      const report = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      console.log(process.argv[2].split(".").reduce((o, k) => o?.[k], report) ?? "");
    } catch {
      // Not written yet, or caught mid-write: the caller polls again.
      console.log("");
    }
  ' "$HDIR/report-$1.json" "$2"
}

# wait_phase <phase> <timeout-seconds>
wait_phase() {
  local deadline=$(($(date +%s) + $2))
  until [ "$(field "$1" isDone)" = true ]; do
    if [ -n "$(field "$1" error)" ]; then
      echo "phase $1 failed: $(field "$1" error)"
      return 1
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "phase $1 timed out after $2s"
      return 1
    fi
    sleep 5
  done
  echo "phase $1 done"
}

# Terminates the app before the reminder armed in <phase> is due and waits
# past that time, so it can only have fired while the app was not running.
# Too late to tell: leaves a marker for assert.js and lets the run finish.
terminate_until_fired() {
  local want_at now_ms
  want_at=$(field "$1" near.wantAt)
  xcrun simctl terminate "$UDID" "$BUNDLE_ID"
  now_ms=$(($(date +%s) * 1000))
  if [ -z "$want_at" ] || [ "$now_ms" -ge "$want_at" ]; then
    echo "phase $1: the app was still running when its reminder came due"
    touch "$OUT/$1-late"
    return 0
  fi
  sleep $(((want_at - now_ms) / 1000 + 4))
  xcrun simctl io "$UDID" screenshot "$OUT/$1-fired.png" >/dev/null 2>&1 || true
  sleep 15
}

collect() {
  cp "$HDIR"/report-*.json "$OUT"/ 2>/dev/null || true
  xcrun simctl spawn "$UDID" log show --last 40m --style compact \
    --predicate 'process == "App"' >"$OUT/app.log" 2>/dev/null || true
}

run_test() {
  UDID=$(cat "$WORK/udid")

  local public="$ROOT/ios/App/App/public"
  cp "$HERE/harness.js" "$public/sim-harness.js"
  # In <head>, so it runs before the app's own (deferred module) scripts.
  perl -0pi -e 's#</head>#<script src="sim-harness.js"></script></head>#' "$public/index.html"
  grep -q 'sim-harness.js' "$public/index.html"

  quiet app-build xcodebuild build \
    -workspace "$ROOT/ios/App/App.xcworkspace" -scheme App -configuration Debug \
    -destination "id=$UDID" -derivedDataPath "$WORK/app-dd"
  xcrun simctl install "$UDID" "$WORK/app-dd/Build/Products/Debug-iphonesimulator/App.app"

  HDIR="$(xcrun simctl get_app_container "$UDID" "$BUNDLE_ID" data)/Documents/sim-harness"
  mkdir -p "$HDIR"
  trap collect EXIT

  # The UI test launches the app itself and taps "Allow".
  set_phase permission
  quiet tap-test xcodebuild test-without-building \
    -project "$WORK/tap/AllowTap.xcodeproj" -scheme AllowTap \
    -destination "id=$UDID" -derivedDataPath "$WORK/tap-dd"
  wait_phase permission 60
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true

  set_phase baseline
  xcrun simctl launch "$UDID" "$BUNDLE_ID"
  wait_phase baseline 900
  terminate_until_fired baseline

  set_phase cap
  xcrun simctl launch "$UDID" "$BUNDLE_ID"
  # Generous: a build that re-arms every reminder on each change (as before the
  # iOS budget) takes minutes to arm 70.
  wait_phase cap 1800
  terminate_until_fired cap

  set_phase final
  xcrun simctl launch "$UDID" "$BUNDLE_ID"
  wait_phase final 300
  xcrun simctl terminate "$UDID" "$BUNDLE_ID"

  collect
  node "$HERE/assert.js" "$OUT"
}

case "${1:-}" in
  prepare) prepare ;;
  test) run_test ;;
  *)
    echo "usage: run.sh prepare|test"
    exit 1
    ;;
esac
