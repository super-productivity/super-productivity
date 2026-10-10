# Android verification harness

Verifies mobile-only behavior on a real Android screen with a real IME: anything that depends on the soft keyboard, safe-area insets, or the split between the layout viewport (`innerHeight`) and the visual viewport (`visualViewport`). A desktop Playwright run cannot reach these. `page.setViewportSize()` keeps both viewports equal. Background and design: #9761.

**A human must run this.** An agent sandbox has no `/dev/kvm` and cannot boot an emulator (finding 1). An agent writes or updates a scenario, gives the human the command, then reads the JSON result back.

This is not part of CI and does not replace the Playwright suite. Anything Playwright can reach stays in `e2e/`.

## Run

```bash
bash tools/android-verify/run.sh mention-dropdown-5146
```

The script:

1. checks preconditions (port free; a running emulator, or `/dev/kvm`, `emulator`, the AVD and a writable AVD directory). Each failure is a one-line diagnostic within seconds, not a hang.
2. reuses a running emulator, or boots one with `-no-snapshot-save`. It leaves the emulator running so the next run is fast; stop it with `adb -s <serial> emu kill`.
3. serves the app with `npm run startFrontend -- --port <port>`. A cold compile takes minutes.
4. runs `adb reverse tcp:<port> tcp:<port>`, drives Chrome on the device through Playwright's `_android` API, and runs the scenario.

| Variable                       | Default                                  | Purpose                                                          |
| ------------------------------ | ---------------------------------------- | ---------------------------------------------------------------- |
| `ANDROID_VERIFY_AVD`           | first `emulator -list-avds`              | AVD to boot (the `.ini` name, see finding 5)                     |
| `ANDROID_SERIAL`               | first online `emulator-*`                | device to reuse                                                  |
| `ANDROID_VERIFY_PORT`          | `4300`                                   | dev-server port                                                  |
| `ANDROID_VERIFY_BOOT_TIMEOUT`  | `300`                                    | seconds                                                          |
| `ANDROID_VERIFY_SERVE_TIMEOUT` | `900`                                    | seconds                                                          |
| `ANDROID_HOME`                 | `~/Android/Sdk`, `~/Library/Android/sdk` | where `adb` and `emulator` are found when they are not on `PATH` |

Requirements: an emulator image that includes Chrome (a Google APIs or Google Play image) and an AVD with `hw.keyboard=no` (finding 4).

## Output

`.tmp/android-verify/` is gitignored:

- `<scenario>.json` contains `pass`, `measurements` (scenario-defined), `stage` and `error` (on failure), `details`, `screenshots`, `device`, and `durationMs`.
- `<scenario>-final.png` is saved for every completed run. `<scenario>-fail-<stage>.png` is saved on every failure path: `navigation`, `app-not-rendered`, `calibration`, `tap-missed`, `ime-not-shown`, and any scenario stage. Screenshots are native device captures, so they include the IME.
- `emulator.log` and `serve.log` are written there too.

Exit code: `0` pass, `1` scenario failed (including a failed stage such as a missed tap), `2` precondition or harness error.

## Writing a scenario

Add `scenarios/<name>.mjs`. `run.sh` does not change. The runner first opens the app with onboarding skipped and waits for a route to render. Then it calls the default export:

```js
export default async ({ page, adb, ime, probe, shot, StageError }) => {
  const tap = await ime.tapAndOpen('add-task-bar.global .main-input');
  const viewport = await probe(tap.baseline);
  return { pass: viewport.path !== 'NO_IME', measurements: { ...viewport } };
};
```

- `ime.tapAndOpen(selector)` taps the element with a real `adb shell input tap`, then asserts that `document.activeElement` is that element. It waits for the IME (`dumpsys input_method`) and then for the viewport to settle. It throws `tap-missed` or `ime-not-shown` instead of returning geometry.
- `probe(baseline?)` returns `{ innerHeight, visualViewportHeight, visualViewportOffsetTop, visualViewportScale, devicePixelRatio, path }`. `path` is one of the following:
  - `RESIZING`: the layout viewport shrank.
  - `NON_RESIZING`: only the visual viewport shrank.
  - `NO_IME`: neither shrank, so the measurement tells you nothing about the IME. Make the scenario fail on it.
- `adb` exposes `shell`, `tap`, `text` (sends spaces as `%s`) and `isImeShown`.
- `shot(name)` saves an extra screenshot. To fail a named step, throw `new StageError(stage, message, details)`.
- Log element structure and ids, never user content.

## Findings

These came from the throwaway prototype for #5146. Each one cost a debugging round.

1. **An agent sandbox cannot boot an emulator.** `emulator -accel-check` reports `/dev/kvm is not found`. The sandbox also cannot write `~/.android/avd/<name>.avd`, so the emulator cannot clear `snapshot.trace` / `bootcompleted.ini` and dies with `A snapshot operation ... is pending`. The `!` prefix runs in the same sandbox and fails the same way. So an agent authors and maintains scenarios and a human runs them, which is why results go to a JSON file. `run.sh` checks both conditions up front.
2. **Use `adb reverse tcp:P tcp:P` and `http://localhost:P`, not `http://10.0.2.2:P`.** The prototype hung indefinitely in `page.goto` on `10.0.2.2`.
3. **Raising the IME needs a real tap.** `element.focus()` and CDP input are not user gestures, so the soft keyboard stays down. Tap with `adb shell input tap X Y`, then **assert `document.activeElement`** is the expected element. A missed tap silently produces meaningless but plausible geometry, so this assertion is load-bearing. The prototype computed X/Y as `getBoundingClientRect()` + `window.screenY`, times `devicePixelRatio`. `ime.mjs` instead calibrates once by measuring a real tap. It taps the screen centre, reads the `touchstart` client point and swallows that event. The resulting offset includes the status bar and Chrome's toolbar. Before tapping, `tapAndOpen` also blurs the active element, so autofocus cannot satisfy the assertion.
4. **IME visibility:** the AVD needs `hw.keyboard=no` (already set on the local `API_34_Pixel_8a`). Most other AVDs have `hw.keyboard=yes` and do not show the IME. `run.sh` warns about `hw.keyboard=yes` and sets `adb shell settings put secure show_ime_with_hard_keyboard 1`.
5. **AVD naming trap:** the `.ini` name (`API_34_Pixel_8a`) can differ from the `.avd` directory name (`Pixel_8a.avd`). `emulator -avd` wants the `.ini` name, and `emulator -list-avds` is the source of truth. `run.sh` validates against it and reads the directory from the `.ini`'s `path=`.
6. **Shell trap:** under `set -o pipefail`, `cmd | grep -q PATTERN && die` silently never fires. `grep -q` closes the pipe, the producer takes SIGPIPE, and the pipeline status goes non-zero. Capture the output into a variable first, then match.
7. **No new dependency.** Playwright's `_android` API drives real Chrome on the device and gives normal `page.evaluate` access. `playwright` is already a root devDependency.
8. **Chrome on the device is not the Capacitor WebView.** `adjustResize` itself stays unverified at this tier. `src/index.html` sets `interactive-widget=resizes-content`, so Chrome is expected to report `RESIZING`. The app's WebView may report `NON_RESIZING`, which is why the app code measures `visualViewport` (`src/app/core/theme/global-theme.service.ts`). A tier 2 that installs and drives the real app is a possible follow-up.

## Scenarios

- `mention-dropdown-5146`: with the IME up, types `test task @` into the global add-task bar. It checks that the short-syntax dropdown lies inside the visual viewport and shows at least one entry (`MentionListComponent.checkBounds`). `@` always has suggestions, so no data setup is needed. The prototype's checks were ported, not copied byte for byte; the prototype was never committed.
