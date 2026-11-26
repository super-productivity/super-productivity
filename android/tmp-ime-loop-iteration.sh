#!/usr/bin/env bash
# TEMPORARY (flake-proof loop; delete before merge). One fresh emulator boot:
# the real pre-test setup from run-android-checks.sh, then the full instrumented
# suite, as the API 35 CI job runs it. ARM=control skips the ANR-dialog lines.
set -uo pipefail
if [ "${ARM#fix}" != "$ARM" ]; then
  sed -n '/^adb shell settings put secure show_ime_with_hard_keyboard/,/CLOSE_SYSTEM_DIALOGS/p' run-android-checks.sh > "$RUNNER_TEMP/setup.sh"
else
  grep '^adb shell settings put secure show_ime_with_hard_keyboard' run-android-checks.sh > "$RUNNER_TEMP/setup.sh"
fi
cat "$RUNNER_TEMP/setup.sh"
bash "$RUNNER_TEMP/setup.sh"
rm -rf app/build/outputs/androidTest-results
adb logcat -c || true
# Host wall clock (the emulator's clock follows it) so lines line up with logcat.
( while :; do
    f=$(adb shell dumpsys window displays 2>/dev/null | grep -E 'mCurrentFocus=|mFocusedApp=' | tr -s ' ' | tr '\n' ' ')
    r=$(adb shell dumpsys activity activities 2>/dev/null | grep -E 'topResumedActivity=|mResumedActivity:|ResumedActivity:' | head -2 | tr -s ' ' | tr '\n' ' ')
    printf '%s %s %s\n' "$(date +%T)" "$f" "$r"
    sleep 1
  done ) > "$RUNNER_TEMP/focus.log" 2>&1 &
poller=$!
timeout 480 ./gradlew :app:connectedPlayDebugAndroidTest > "$RUNNER_TEMP/gradle.log" 2>&1
status=$?
kill "$poller" 2>/dev/null
if [ "$status" -ne 0 ]; then
  err=$(grep -E 'FAILED|AssertionError|Exception|INSTALL_|offline|What went wrong' "$RUNNER_TEMP/gradle.log" | grep -v '> Task' | head -6 | tr '\n' '|' | cut -c1-1500)
  echo "::error title=${ARM}-iter-${ITER}::status=$status log=[$err]"
  echo "----- focus/resumed timeline (changes only) -----"
  awk '{ t=$1; $1=""; if ($0 != prev) print t $0; prev=$0 }' "$RUNNER_TEMP/focus.log"
  echo "----- test logcat (SUPKeyboardTest, TestRunner, ActivityTaskManager) -----"
  adb logcat -d -v time -s SUPKeyboardTest:I TestRunner:I ActivityTaskManager:I WindowManager:W | tail -300
fi
exit $status
