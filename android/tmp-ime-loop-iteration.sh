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
timeout 480 ./gradlew :app:connectedPlayDebugAndroidTest > "$RUNNER_TEMP/gradle.log" 2>&1
status=$?
if [ "$status" -ne 0 ]; then
  xml=$(find app/build -name 'TEST-*.xml' 2>/dev/null | head -3 | tr '\n' ' ')
  msg=$(find app/build -name 'TEST-*.xml' -exec grep -hoE '<failure message="[^"]{0,700}' {} + 2>/dev/null | head -2 | tr '\n' ' ')
  err=$(grep -E 'FAILED|Exception|Error|error:|INSTALL_|offline|What went wrong' -A2 "$RUNNER_TEMP/gradle.log" | grep -v '^--$' | head -25 | tr '\n' '|' | cut -c1-1500)
  echo "::error title=${ARM}-iter-${ITER}::status=$status xml=[$xml] msg=[$msg] log=[$err]"
fi
exit $status
