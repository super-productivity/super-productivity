#!/usr/bin/env bash
#
# Everything that needs a running emulator, in one session: the instrumented
# suite on debug, then a launch smoke against the minified r8Test APK.
#
# A file, not an inline `script:` block, because android-emulator-runner
# executes that input one line per `sh -c`: variables, `set -u` and multi-line
# `if` do not survive between lines.
#
# Why the minified check is a launch smoke and not instrumentation: pointing
# `testBuildType` at r8Test makes AGP minify the androidTest APK too, with
# -applymapping from the app. kotlin-stdlib and androidx.* live in the app APK
# and are shrunk to what the *app* uses, so test-side code calls members that no
# longer exist. Every test died in handleBindApplication — first on
# Intrinsics.checkNotNullParameter, then on androidx.tracing.Trace — and UTP's
# am_instrument_timeout of 31536000s turned each crash into a 30-minute hang
# rather than a failure. Launching the APK needs none of those keep rules and
# exercises the real launcher, WebView and JS bridge instead.
set -uo pipefail

PACKAGE=com.superproductivity.superproductivity
DIAG=build/instrumentation-diagnostics
APK=app/build/outputs/apk/play/r8Test/app-play-r8Test.apk
mkdir -p "$DIAG"

capture_diagnostics() {
  # A hang or a native crash produces no test report at all, so this is the only
  # record of what the device and the app process were doing.
  adb logcat -d > "$DIAG/logcat.txt" 2>&1 || true
  adb shell dumpsys activity processes > "$DIAG/activity-processes.txt" 2>&1 || true
  adb root > /dev/null 2>&1 || true
  adb pull /data/anr "$DIAG/anr" > /dev/null 2>&1 || true
}

# The emulator reports a hardware keyboard, which keeps the soft keyboard
# hidden; ImeInsetShimInstrumentedTest needs it to open. See that test.
adb shell settings put secure show_ime_with_hard_keyboard 1 || true
adb logcat -c || true

# Bounded so a hung instrumentation fails with a report instead of consuming the
# job's whole timeout and reporting nothing. 480s is ~5x the observed 1m39s
# (run 33259362141); both bounds plus the smoke have to fit the workflow's
# timeout-minutes with room for emulator boot, or a bound firing still shows up
# as a cancelled job with no artifact — which is how #9804 merged blind.
timeout 480 ./gradlew :app:connectedPlayDebugAndroidTest
status=$?
if [ "$status" -eq 124 ]; then
  echo "::error::connectedPlayDebugAndroidTest exceeded 15 minutes — see the android-instrumentation-diagnostics artifact"
fi
if [ "$status" -ne 0 ]; then
  capture_diagnostics
  exit $status
fi

# --- Minified launch smoke ---------------------------------------------------
# The instrumented suite above runs on debug and says nothing about R8. This is
# the part that would have caught #9785.
timeout 480 ./gradlew :app:assemblePlayR8Test
status=$?
if [ "$status" -ne 0 ]; then
  capture_diagnostics
  exit $status
fi

# What a launch cannot reach. The smoke page below exercises the PluginHandle
# and JavaScriptInterface keep rules by using them, but nothing enqueues a
# WorkManager worker at startup, so the ListenableWorker rule has no runtime
# witness. Reading the mapping covers it, and it runs before install so a keep
# rule that R8 dropped is named outright instead of surfacing as a launch
# failure. Run from the repo root: the tool's source root defaults there.
if ! (cd .. && node tools/verify-r8-mapping.mjs \
    android/app/build/outputs/mapping/playR8Test/mapping.txt); then
  echo "::error::R8 dropped or renamed something proguard-rules.pro is meant to keep"
  exit 1
fi

adb logcat -c || true
adb uninstall "$PACKAGE" > /dev/null 2>&1 || true
if ! adb install -r "$APK"; then
  echo "::error::could not install the minified r8Test APK"
  capture_diagnostics
  exit 1
fi

# Markers arrive as Capacitor/Console lines from the smoke page; the CI-only
# capacitor.config.json copied alongside it is what keeps Capacitor logging in a
# non-debuggable build.
#
# FullscreenActivity is the real MAIN/LAUNCHER. On a fresh install LaunchDecider
# resolves to MODE_OFFLINE, so it forwards straight into CapacitorMainActivity —
# the path #9785 died on.
adb shell am start -n "$PACKAGE/.FullscreenActivity" > /dev/null 2>&1 || true

# The crash arm matches "Process: <our package>", not a bare FATAL EXCEPTION:
# AndroidRuntime prints that line directly under the exception and nothing else
# emits it, so an unrelated process dying on the emulator inside this window
# cannot red the job. 120s is ~17x the observed time to marker (run
# 33262336320), so reaching the deadline means the app never got to the bridge.
smoke_status=timeout
deadline=$((SECONDS + 120))
while [ "$SECONDS" -lt "$deadline" ]; do
  log=$(adb logcat -d 2>/dev/null)
  case "$log" in
    *"SP_SMOKE OK"*) smoke_status=ok; break ;;
    *"SP_SMOKE FAIL"*) smoke_status=fail; break ;;
    *"Process: $PACKAGE"*) smoke_status=crash; break ;;
  esac
  sleep 3
done

capture_diagnostics

case "$smoke_status" in
  ok)
    # Echo the marker itself: on green the job log otherwise shows no evidence
    # of what the app actually reported, and the marker carries the permission
    # state and the bridge version the minified build returned.
    echo "Minified launch smoke passed."
    adb logcat -d | grep -F 'SP_SMOKE OK' | tail -1
    ;;
  fail)
    echo "::error::minified build reached the bridge but the smoke page reported a failure"
    adb logcat -d | grep -F 'SP_SMOKE FAIL' | head -5
    exit 1
    ;;
  crash)
    echo "::error::minified build crashed on launch — this is the #9785 failure mode"
    adb logcat -d | grep -A 20 -F 'FATAL EXCEPTION' | head -40
    exit 1
    ;;
  *)
    echo "::error::minified build never reported SP_SMOKE within 120s — see the diagnostics artifact"
    exit 1
    ;;
esac
