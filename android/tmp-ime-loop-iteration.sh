#!/usr/bin/env bash
# TEMPORARY (flake-proof loop; delete before merge). One fresh emulator boot:
# the real pre-test setup from run-android-checks.sh, then the full instrumented
# suite, as the API 35 CI job runs it. ARM=control skips the ANR-dialog lines.
set -uo pipefail
if [ "$ARM" = fix ]; then
  sed -n '/^adb shell settings put secure show_ime_with_hard_keyboard/,/CLOSE_SYSTEM_DIALOGS/p' run-android-checks.sh > "$RUNNER_TEMP/setup.sh"
else
  grep '^adb shell settings put secure show_ime_with_hard_keyboard' run-android-checks.sh > "$RUNNER_TEMP/setup.sh"
fi
cat "$RUNNER_TEMP/setup.sh"
bash "$RUNNER_TEMP/setup.sh"
rm -rf app/build/outputs/androidTest-results
timeout 480 ./gradlew -q :app:connectedPlayDebugAndroidTest
status=$?
if [ "$status" -ne 0 ]; then
  msg=$(grep -rhoE '<failure message="[^"]{0,600}' app/build/outputs/androidTest-results 2>/dev/null | head -3 | tr '\n' ' ')
  echo "::error title=${ARM}-iter-${ITER}::status=$status ${msg:-no failure xml}"
fi
exit $status
