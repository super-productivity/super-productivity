# iOS home screen widget (port of the Android widget)

> **Status: implemented** (code + project wiring + CI). Remaining manual steps —
> portal App ID / App Group / provisioning profiles, the
> `IOS_WIDGET_PROVISION_PROFILE` CI secret, and on-device verification — are listed in
> [`ios/App/SupWidget/README.md`](../../ios/App/SupWidget/README.md).
> Open decision 1 was settled as proposed (`group.com.super-productivity.app`);
> decision 2 landed the TS rename (`features/android/android-widget.*` →
> `features/widget/`) inside the feature change, after Android widget PR #8737
> merged.

Port of the Android task-list widget (PR #8737, plan
[2026-07-03-android-home-screen-widget.md](2026-07-03-android-home-screen-widget.md))
to iOS via a WidgetKit extension. The Android architecture — one-way versioned JSON
snapshot + last-wins done-tap queue + render-time pending overlay — is exactly the
shape WidgetKit wants, so this is a view-layer + plumbing port, not a redesign.

## Architecture mapping (reuse the `v: 1` contract unchanged)

| Android                                                                    | iOS                                                                                      |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `KeyValStore` blob `widget_data` (SQLite)                                  | App Group `UserDefaults(suiteName:)`, same key, same JSON                                |
| `TaskListWidgetProvider` + `RemoteViewsService` + XML layouts              | WidgetKit extension: `TimelineProvider` + SwiftUI list                                   |
| `JavaScriptInterface.saveToDbWrapped` / `updateWidget()`                   | Local Capacitor plugin: `setWidgetData(json)` + `WidgetCenter.shared.reloadTimelines`    |
| Checkbox tap → `WidgetDoneQueue` (SharedPreferences)                       | `Button(intent:)` → AppIntent writes `{taskId: targetIsDone}` to a locked App Group file |
| Render-time pending-done overlay (`WidgetData.parse(pendingDoneTargets:)`) | Identical overlay in the Swift parser — port line-for-line incl. the JSON-null guards    |
| Drain triggers: `onResume$` + live LocalBroadcast                          | Capacitor `resume` only (see limitations)                                                |
| Header/row tap → launch activity                                           | `widgetURL` deep link → open app (no per-task navigation, matching Android v1)           |

- **Single-writer invariant carries over:** Angular is the only writer of
  `widget_data`; the AppIntent writes only the queue; the widget overlays pending
  targets at render time. Cross-process queue access uses a POSIX-locked file;
  Angular leases without deleting and acknowledges a per-tap revision token after
  durable op-log writes and a successful native snapshot update.
- **Logical-day expiry** — each snapshot carries its next logical-day boundary.
  The timeline contains an explicit empty entry at that instant and requests a
  reload, so stale tasks disappear even if WidgetKit delays the provider call.
  Other refreshes are explicit `reloadTimelines` pushes. No polling or background sync.
- **Contract:** identical `v: 1` blob (`AndroidWidgetData` in
  `src/app/features/android/android-widget.model.ts`). The Swift parser becomes the
  third named end; unknown `v` renders an empty widget, same as Kotlin. Rename the
  TS types to platform-neutral (`WidgetData`) as part of the Angular step.

## Work items

### 1. Xcode project + signing (the friction half — no logic)

- New WidgetKit extension target `SupWidget`, bundle ID
  `com.super-productivity.app.widget`, **deployment target iOS 17.0** while the app
  stays at 16.0. Rationale: interactive widgets (`Button(intent:)`/AppIntents) are
  17+; shipping a look-but-don't-touch fallback for 16 means a second code path and
  a worse widget — below 17 the widget is simply unavailable, the app is unaffected.
  Revisit only if 16.x adoption data says otherwise.
- App Groups capability on **both** targets, group ID
  `group.com.super-productivity.app`.
- Apple developer portal: register the extension App ID, enable the App Group on
  both App IDs, regenerate both provisioning profiles.
- CI (`.github/workflows/build-ios.yml`): signing uses a single manually-managed
  profile secret (`IOS_PROVISION_PROFILE`). Needs a second secret for the extension
  profile, installed the same way, plus the extra entry in export options. The
  existing "Apple Distribution" cert covers both targets.
- PR CI (`.github/workflows/ios-pr.yml`) builds the app/extension without signing
  and runs the shared `SupWidgetTests` scheme on a simulator.
- Target-scoped required-reason privacy manifests cover App Group `UserDefaults`
  in both executables and Capacitor Filesystem timestamps in the app bundle.
- `npx cap sync ios` must not fight the new target — extension targets live outside
  Capacitor's managed group, verify once and note in the extension folder README.

### 2. Widget extension (Swift, ~250–400 lines, all new)

- `WidgetData.swift`: parse the `v: 1` JSON + pending-done overlay. Port the Kotlin
  parser's edge cases: version gate → empty list, absent `projectId` (Angular omits,
  never null), `projectColors` lookup. Unit-test in the extension target with the
  same golden JSON used by `WidgetDataTest.kt` — copy the fixture so both parsers
  are locked to one shape.
- `DoneQueue.swift`: last-wins entries containing the target boolean plus a unique
  revision in an atomically replaced App Group file. `flock` serializes the app and
  extension processes; `read` creates a non-destructive lease, `acknowledge` removes
  only identical per-tap revisions (preventing same-value ABA loss), and `peek`
  supplies the render overlay.
- `ToggleDoneIntent` (AppIntent): parameters `taskId` + `setDone` (target computed
  at render time from the _displayed_ state, so repeated taps toggle — same fix as
  Android punch-list item 1's spiritual sibling). Writes queue, returns; WidgetKit
  re-renders automatically after an intent, overlay shows the new state.
- `TaskListWidget.swift`: `TimelineProvider` (current entry plus an explicit empty
  entry at logical-day expiry), SwiftUI view
  — header (app name + count, tap = `widgetURL`), task rows (project color bar,
  title, checkbox `Button(intent:)`), empty state. `.systemMedium` + `.systemLarge`
  families for v1. Static dark-leaning styling to match the Android v1 look;
  follow the system `colorScheme` only if free.

### 3. Bridge plugin (Swift + ObjC stub, ~100 lines)

Local Capacitor plugin `WidgetBridgePlugin` in `ios/App/App/` following the existing
`StoreReviewPlugin.swift`/`.m` pattern:

- `setWidgetData({ json })` → write to App Group defaults, then
  `WidgetCenter.shared.reloadTimelines(ofKind:)`.
- `readDoneQueue()` → returns a non-destructive
  `{ json: string | null, token: string | null }` lease.
- `acknowledgeDoneQueue({ token })` → removes only entries whose unique revision
  still matches the opaque lease token.

No `getWidgetTaskQueue` equivalent — share-intent handling is out of scope.

### 4. Angular (~100–150 lines, mostly generalizing)

- Extract the platform-specific write out of `WidgetDataService`: keep the
  selector-read + last-pushed-JSON dedupe, branch the sink —
  `IS_ANDROID_WEB_VIEW` → `androidInterface`, `Capacitor.getPlatform() === 'ios'` →
  `registerPlugin<WidgetBridgePlugin>('WidgetBridge')` (pattern:
  `src/app/features/dialog-please-rate/store-review/index.ts`).
- Effects: reuse `android-widget.effects.ts` triggers by widening the gate to
  "android webview OR iOS native". Triggers on iOS: state change (debounced, with
  the existing hydration-guard), sync-window falling edge, and Capacitor `pause`
  (App Group write is fast; fits the ~5s background grace). Drain trigger: Capacitor
  `resume` after strict initial sync and outside the sync window, feeding the existing
  pure `getTaskDoneChangesToApply()`. The iOS lease is acknowledged only after
  `OperationWriteFlushService` confirms the generated operations are durable and
  the updated native snapshot has been saved.
- Move/rename `features/android/android-widget.*` →
  `features/widget/` with platform-neutral names; `android-interface.ts` keeps its
  role as the Android sink. Same aggregated `WIDGET_TASKS_UPDATED` snack (already in
  `en.json`).
- Sync-correctness check: unchanged risk profile — effects stay `dispatch: false`
  consumers of state; the drain path produces user-intent ops exactly like the
  Android drain (dedup + skip-already-in-target prevents replay noise); nothing new
  writes during the sync window.

## Known limitations (deliberate, matching or below Android v1)

- **No live drain while the app is alive.** Android pokes the running WebView via
  LocalBroadcast; iOS has no cheap equivalent from an extension process (Darwin
  notifications = over-engineering for v1). A tap while the app is foregrounded
  applies on next `resume`. Mitigated by the pending overlay: the widget itself is
  always immediately correct. If it ever matters: `CFNotificationCenter` Darwin
  notification is the upgrade path.
- **Empty-until-next-open after day rollover.** WidgetKit clears the expired
  snapshot at the configured logical-day boundary, but cannot compute the new
  day's tasks while the app is suspended. Cross-client freshness stays phase 2
  (BGAppRefreshTask + sync — same phase-2 slot as Android's WorkManager idea).
- **Timezone changes while suspended.** The snapshot carries an absolute expiry
  calculated in the timezone where the app last wrote it. Eastward travel can
  therefore leave the prior day's tasks visible until that original-zone boundary;
  opening the app refreshes it. Correctly rebuilding Today for a new timezone while
  suspended requires the same phase-2 background refresh, because the extension
  does not own the task store.
- **iOS 17+ only** (app itself stays iOS 16).
- Widget chrome strings are inline and English-only in v1 (parity with Android v1's
  English `strings.xml`).
- No task creation / undo / per-task deep link from the widget.

## Open decisions (settle before implementing)

1. App Group ID string — proposed `group.com.super-productivity.app`; hard to
   change after ship (stale data stranded in the old container), pick once.
2. Whether the TS rename (`features/android/android-widget.*` → `features/widget/`)
   lands as a preparatory refactor PR or inside the feature PR. Preparatory is
   cleaner for review; the Android widget PR #8737 must merge first either way to
   avoid rebasing it over the rename.

## Effort estimate

~2–4 focused days: ~0.5–1 on the Xcode target/App Group/portal/CI signing, ~1–1.5
on the extension + plugin, ~0.5 on the Angular generalization + specs, the rest
on-device testing (requires a Mac + real device; interactive widgets in the
simulator are flaky). App Store review is routine for widgets.

## Files

Native (all new unless noted): `ios/App/SupWidget/{TaskListWidget,WidgetData,DoneQueue,ToggleDoneIntent}.swift`,
extension `Info.plist` + entitlements, `App/App.entitlements` (App Group, edit),
`ios/App/App/WidgetBridgePlugin.swift` + `.m`, `project.pbxproj` (new target),
widget unit tests + shared golden JSON fixture.

Angular: `features/widget/widget-data.model.ts`, `features/widget/widget-data.service.ts`
(+spec), `features/widget/store/widget.selectors.ts` (+spec),
`features/widget/store/widget.effects.ts` (+spec), `features/widget/widget-bridge.ts`
(Capacitor `registerPlugin`), `root-store/feature-stores.module.ts`.

CI/release: `.github/workflows/build-ios.yml` (extension profile),
`.github/workflows/ios-pr.yml` (unsigned PR build + widget tests), new
`IOS_WIDGET_PROVISION_PROFILE` secret, export options.
