#!/usr/bin/env bash
#
# Keeps a launcher "isn't responding" dialog from holding window focus during an
# emulator test run; shared by run-android-checks.sh and run-android-ime-check.sh.
# A freshly booted emulator can ANR the launcher, and while its dialog has focus
# the IME never serves the app, so ImeInsetShimInstrumentedTest times out.
#
# hide_error_dialogs only suppresses dialogs raised from now on, and
# CLOSE_SYSTEM_DIALOGS does not close an ANR dialog (one held focus through a
# whole run, 45905549386). Force-stopping the process the dialog names closes
# it; the system then relaunches the launcher as home. With this, 0 IME failures
# in 185 fresh API 35 boots (45911245865), against about 10 in 600 before.
set -uo pipefail

adb shell settings put global hide_error_dialogs 1 || true
# Closes other system dialogs (not an ANR dialog, see above).
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS > /dev/null || true
for _ in 1 2 3 4 5; do
  anr_pkg=$(adb shell dumpsys window windows 2> /dev/null |
    grep -oE 'Application Not Responding: [A-Za-z0-9._]+' | head -1 | sed 's/.*: //')
  [ -z "$anr_pkg" ] && exit 0
  echo "Dismissing the ANR dialog of $anr_pkg"
  adb shell am force-stop "$anr_pkg" || true
  sleep 2
done
echo "::warning::An ANR dialog is still up after 5 attempts; the IME test may fail on window focus"
