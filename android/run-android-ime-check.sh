#!/usr/bin/env bash
#
# The IME inset shim check on a second emulator, one API level below where
# Capacitor's SystemBars takes over. run-android-checks.sh boots API 35, where
# NativeInsetShimGate is a strict no-op by construction, so that run can only
# prove the shim stayed out of SystemBars' way. This one boots an API 34
# google_apis image, whose bundled WebView never auto-updates and sits below 140:
# the API 30-34 / WebView < 140 band #9316 was reported in, which no device on
# hand covers. ImeInsetShimInstrumentedTest asserts the mechanism there (explicit
# WebView height == keyboard top) as well as the symptom (web content ends above
# the keyboard). Only that test runs here; the full suite already ran on API 35.
# See docs/android-edge-to-edge-keyboard.md.
#
# A file, not an inline `script:` block — see run-android-checks.sh for why.
set -uo pipefail

DIAG=build/instrumentation-diagnostics/api34-ime
mkdir -p "$DIAG"

# android-emulator-runner exports ANDROID_SERIAL for the emulator it booted and
# kills that emulator when its script ends, so the API 35 session is gone by the
# time this runs and exactly one device is attached. Honour the export; only if
# it is missing (running this by hand) fall back to the single attached device.
if [ -z "${ANDROID_SERIAL:-}" ]; then
  ANDROID_SERIAL="$(adb devices | awk '/^emulator-.*[[:space:]]device$/ { print $1 }')"
  if [ "$(printf '%s\n' "$ANDROID_SERIAL" | grep -c .)" -ne 1 ]; then
    echo "::error::expected exactly one emulator attached, got: ${ANDROID_SERIAL:-none}"
    exit 1
  fi
  export ANDROID_SERIAL
fi
echo "Using $ANDROID_SERIAL"

# The emulator reports a hardware keyboard; without this the system keeps the
# soft keyboard hidden, the IME never opens and the test cannot tell a working
# shim from one that never ran.
adb shell settings put secure show_ime_with_hard_keyboard 1
# Which band this image is actually in — the test branches on it and logs the
# same, but the dumpsys line is the reading to compare a reporter's device to.
adb shell dumpsys webviewupdate | grep -i 'Current WebView package' || true
adb logcat -c || true

# expectShim=true pins the band: if this image is ever refreshed with a WebView
# >= 140 the gate flips to the SystemBars branch and the test would stay green
# while the #9316 band silently lost its only coverage. With the pin it fails.
timeout 480 ./gradlew :app:connectedPlayDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.superproductivity.superproductivity.ImeInsetShimInstrumentedTest \
  -Pandroid.testInstrumentationRunnerArguments.expectShim=true
status=$?
if [ "$status" -eq 124 ]; then
  echo "::error::ImeInsetShimInstrumentedTest exceeded 8 minutes on API 34 — see the android-instrumentation-diagnostics artifact"
fi
if [ "$status" -ne 0 ]; then
  adb logcat -d > "$DIAG/logcat.txt" 2>&1 || true
  adb shell dumpsys webviewupdate > "$DIAG/webviewupdate.txt" 2>&1 || true
  exit $status
fi

# On green, echo what the test measured so the job log documents which owner
# insetted the WebView and by how much — geometry and versions only.
echo "IME inset shim check passed on API 34:"
adb logcat -d -s SUPKeyboardTest | tail -n 8 || true
