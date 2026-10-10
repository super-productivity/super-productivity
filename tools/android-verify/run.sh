#!/usr/bin/env bash
# Runs one Android verification scenario against Chrome on a local emulator.
#
#   bash tools/android-verify/run.sh <scenario>
#
# Boots (or reuses) an AVD, serves the app, tunnels it with `adb reverse`,
# drives Chrome-on-device through Playwright's `_android` API and writes
# .tmp/android-verify/<scenario>.json plus screenshots. Exit code: 0 pass,
# 1 scenario failed, 2 precondition or harness error.
#
# Must be run by a human from a normal terminal: an agent sandbox has no
# /dev/kvm and cannot boot an emulator. See tools/android-verify/README.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT_DIR="$ROOT/.tmp/android-verify"
PORT="${ANDROID_VERIFY_PORT:-4300}"
SERVE_TIMEOUT="${ANDROID_VERIFY_SERVE_TIMEOUT:-900}"
BOOT_TIMEOUT="${ANDROID_VERIFY_BOOT_TIMEOUT:-300}"

die() {
  echo "android-verify: $*" >&2
  exit 2
}
log() { echo "android-verify: $*"; }

usage_scenarios() {
  local f names=()
  for f in "$HERE"/scenarios/*.mjs; do
    [[ -e "$f" ]] && names+=("$(basename "$f" .mjs)")
  done
  echo "${names[*]:-<none>}"
}

# --- arguments -------------------------------------------------------------
SCENARIO="${1:-}"
[[ -n "$SCENARIO" ]] || die "usage: run.sh <scenario>  (available: $(usage_scenarios))"
[[ "$SCENARIO" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "invalid scenario name '$SCENARIO'"
[[ -f "$HERE/scenarios/$SCENARIO.mjs" ]] ||
  die "no scenario '$SCENARIO' (available: $(usage_scenarios))"

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR/$SCENARIO.json" "$OUT_DIR/$SCENARIO"-*.png

# --- Android SDK tools -----------------------------------------------------
# PATH first, then the SDK env vars, then the Android Studio defaults.
find_sdk_tool() {
  local name="$1" sub="$2" dir
  if command -v "$name" >/dev/null 2>&1; then
    command -v "$name"
    return 0
  fi
  for dir in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Android/Sdk" \
    "$HOME/Library/Android/sdk"; do
    if [[ -n "$dir" && -x "$dir/$sub/$name" ]]; then
      echo "$dir/$sub/$name"
      return 0
    fi
  done
  return 1
}
ADB="$(find_sdk_tool adb platform-tools || true)"
EMULATOR="$(find_sdk_tool emulator emulator || true)"

# --- precondition: port ----------------------------------------------------
# Bash's /dev/tcp connects only if something listens — no lsof/ss needed.
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  die "port $PORT is already in use; stop that server or set ANDROID_VERIFY_PORT"
fi

# --- precondition: a device, or what is needed to boot one ------------------
# Finding 6: never `cmd | grep -q X` under pipefail (grep -q closes the pipe,
# the producer takes SIGPIPE and the pipeline reports failure). Capture first.
online_emulator() {
  [[ -n "$ADB" ]] || return 1
  local devices serial state
  devices="$("$ADB" devices 2>/dev/null || true)"
  while read -r serial state _; do
    if [[ "$serial" == emulator-* && "$state" == "device" ]]; then
      echo "$serial"
      return 0
    fi
  done <<<"$devices"
  return 1
}

SERIAL="${ANDROID_SERIAL:-}"
[[ -n "$SERIAL" ]] || SERIAL="$(online_emulator || true)"
BOOTED_BY_US=0

if [[ -n "$SERIAL" ]]; then
  [[ -n "$ADB" ]] || die "ANDROID_SERIAL is set but adb was not found (PATH, ANDROID_HOME)"
  log "reusing running device $SERIAL"
else
  # Finding 1: without KVM the emulator cannot boot (the agent sandbox case).
  if [[ "$(uname -s)" == "Linux" ]] && [[ ! -r /dev/kvm || ! -w /dev/kvm ]]; then
    die "/dev/kvm is missing or not accessible — cannot boot an emulator here; run this from a normal terminal on a KVM-capable host"
  fi
  [[ -n "$ADB" ]] || die "adb not found (install platform-tools; set ANDROID_HOME)"
  [[ -n "$EMULATOR" ]] || die "emulator not found (install the SDK emulator; set ANDROID_HOME)"

  # Finding 5: `-list-avds` gives the .ini name `-avd` wants, which can differ
  # from the .avd directory name.
  # Newer emulators also print "INFO | Storing crashdata ..." to stdout here;
  # keep only lines that can be AVD names.
  AVDS_RAW="$("$EMULATOR" -list-avds 2>/dev/null || true)"
  AVDS=""
  while read -r name; do
    [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] && AVDS+="$name"$'\n'
  done <<<"$AVDS_RAW"
  AVDS="${AVDS%$'\n'}"
  AVD="${ANDROID_VERIFY_AVD:-}"
  if [[ -z "$AVD" ]]; then
    AVD="$(head -n1 <<<"$AVDS")"
  fi
  [[ -n "$AVD" ]] || die "no AVD found (emulator -list-avds is empty); create one or set ANDROID_VERIFY_AVD"
  AVD_LIST_MATCH=0
  while read -r name; do
    [[ "$name" == "$AVD" ]] && AVD_LIST_MATCH=1
  done <<<"$AVDS"
  [[ "$AVD_LIST_MATCH" == 1 ]] ||
    die "AVD '$AVD' not in 'emulator -list-avds' ($(tr '\n' ' ' <<<"$AVDS")) — use the .ini name, not the .avd dir"

  AVD_HOME="${ANDROID_AVD_HOME:-$HOME/.android/avd}"
  AVD_INI="$AVD_HOME/$AVD.ini"
  AVD_DIR=""
  if [[ -f "$AVD_INI" ]]; then
    AVD_INI_CONTENT="$(cat "$AVD_INI")"
    while IFS='=' read -r key value; do
      [[ "$key" == "path" ]] && AVD_DIR="$value"
    done <<<"$AVD_INI_CONTENT"
  fi
  [[ -n "$AVD_DIR" ]] || AVD_DIR="$AVD_HOME/$AVD.avd"
  [[ -d "$AVD_DIR" ]] || die "AVD directory $AVD_DIR does not exist (from $AVD_INI)"
  # Finding 1: a read-only AVD dir makes the emulator die with
  # "A snapshot operation ... is pending" instead of a clear error.
  [[ -w "$AVD_DIR" ]] || die "AVD directory $AVD_DIR is not writable — the emulator cannot clear its snapshot/boot state"

  # Finding 4: with a hardware keyboard configured the soft IME stays hidden.
  if [[ -f "$AVD_DIR/config.ini" ]]; then
    AVD_CONFIG="$(cat "$AVD_DIR/config.ini")"
    if [[ "$AVD_CONFIG" == *"hw.keyboard=yes"* || "$AVD_CONFIG" == *"hw.keyboard = yes"* ]]; then
      log "warning: $AVD has hw.keyboard=yes; the IME may not show (set hw.keyboard=no in $AVD_DIR/config.ini)"
    fi
  fi
fi

[[ -f "$ROOT/node_modules/playwright/package.json" ]] ||
  die "node_modules/playwright is missing; run 'npm ci' first"

# --- cleanup ---------------------------------------------------------------
SERVE_PID=""
EMULATOR_PID=""
# shellcheck disable=SC2329 # invoked by the EXIT trap below
cleanup() {
  if [[ -n "$SERVE_PID" ]]; then
    kill -- "-$SERVE_PID" 2>/dev/null || kill "$SERVE_PID" 2>/dev/null || true
  fi
  if [[ -n "$SERIAL" && -n "$ADB" ]]; then
    "$ADB" -s "$SERIAL" reverse --remove "tcp:$PORT" >/dev/null 2>&1 || true
  fi
  if [[ "$BOOTED_BY_US" == 1 ]]; then
    log "emulator $SERIAL left running for the next run; stop it with: $ADB -s $SERIAL emu kill"
  fi
}
trap cleanup EXIT

# Background jobs get their own process group, so cleanup can stop ng serve's
# whole tree with one `kill -- -PID`.
set -m

# --- boot ------------------------------------------------------------------
if [[ -z "$SERIAL" ]]; then
  log "booting AVD $AVD (log: $OUT_DIR/emulator.log)"
  # An emulator that is still starting is not "online" yet; never adopt it.
  BEFORE="$("$ADB" devices 2>/dev/null || true)"
  "$EMULATOR" -avd "$AVD" -no-snapshot-save -no-audio -no-boot-anim \
    </dev/null >"$OUT_DIR/emulator.log" 2>&1 &
  EMULATOR_PID=$!
  BOOTED_BY_US=1
  deadline=$((SECONDS + BOOT_TIMEOUT))
  while [[ -z "$SERIAL" ]]; do
    kill -0 "$EMULATOR_PID" 2>/dev/null ||
      die "emulator exited during startup: $(tail -n 3 "$OUT_DIR/emulator.log" | tr '\n' ' ')"
    ((SECONDS < deadline)) || die "no emulator appeared in adb within ${BOOT_TIMEOUT}s"
    candidate="$(online_emulator || true)"
    if [[ -n "$candidate" && "$BEFORE" != *"$candidate"* ]]; then
      SERIAL="$candidate"
    fi
    sleep 2
  done
  while :; do
    kill -0 "$EMULATOR_PID" 2>/dev/null ||
      die "emulator exited during boot: $(tail -n 3 "$OUT_DIR/emulator.log" | tr '\n' ' ')"
    ((SECONDS < deadline)) || die "$SERIAL did not finish booting within ${BOOT_TIMEOUT}s"
    booted="$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null || true)"
    [[ "${booted//[[:space:]]/}" == "1" ]] && break
    sleep 2
  done
  log "booted $SERIAL"
fi

# Finding 4: let the IME show even if the AVD reports a hardware keyboard.
"$ADB" -s "$SERIAL" shell settings put secure show_ime_with_hard_keyboard 1 >/dev/null ||
  die "adb could not configure $SERIAL"

# --- serve -----------------------------------------------------------------
log "serving the app on port $PORT (log: $OUT_DIR/serve.log; a cold compile takes minutes)"
# stdin from /dev/null: a background job that reads the terminal is stopped
# (SIGTTIN) under `set -m`, which would look like a hang.
(cd "$ROOT" && exec npm run startFrontend -- --port "$PORT") \
  </dev/null >"$OUT_DIR/serve.log" 2>&1 &
SERVE_PID=$!
deadline=$((SECONDS + SERVE_TIMEOUT))
until curl -sf -o /dev/null "http://localhost:$PORT/"; do
  kill -0 "$SERVE_PID" 2>/dev/null ||
    die "dev server exited: $(tail -n 5 "$OUT_DIR/serve.log" | tr '\n' ' ')"
  ((SECONDS < deadline)) || die "dev server not ready within ${SERVE_TIMEOUT}s (see $OUT_DIR/serve.log)"
  sleep 3
done

# Finding 2: tunnel the host port and use localhost on the device; 10.0.2.2
# made page.goto hang indefinitely.
"$ADB" -s "$SERIAL" reverse "tcp:$PORT" "tcp:$PORT" >/dev/null ||
  die "adb reverse tcp:$PORT failed on $SERIAL"

# --- run -------------------------------------------------------------------
log "running scenario $SCENARIO on $SERIAL"
set +e
ADB="$ADB" node "$HERE/runner.mjs" \
  --scenario "$SCENARIO" \
  --serial "$SERIAL" \
  --url "http://localhost:$PORT" \
  --out "$OUT_DIR"
STATUS=$?
set -e
log "result: $OUT_DIR/$SCENARIO.json (exit $STATUS)"
exit "$STATUS"
