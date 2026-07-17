# SupWidget — iOS home screen widget

WidgetKit extension port of the Android task-list widget (plan:
[`docs/plans/2026-07-07-ios-home-screen-widget-port.md`](../../../docs/plans/2026-07-07-ios-home-screen-widget-port.md)).
Shows today's tasks with an interactive done-checkbox; taps are queued and
applied by the app on next resume.

## Architecture (mirrors Android, same `v: 1` contract)

- Angular (`src/app/features/widget/`) is the ONLY writer of the `widget_data`
  JSON blob, stored in the App Group `UserDefaults` (suite
  `group.com.super-productivity.app`) via `WidgetBridgePlugin` in the app
  target.
- Checkbox taps run `ToggleDoneIntent`, which writes a last-wins
  `{taskId: targetIsDone}` map (`DoneQueue`) to an App Group file — never the
  blob itself. A POSIX file lock protects app/extension read-modify-write races.
  The app leases the queue non-destructively and acknowledges only matching
  per-tap revision tokens after their op-log writes are durable and the updated
  native snapshot is saved, so a crash, newer tap, or same-value ABA sequence
  cannot silently lose work or revert the
  widget view. The timeline provider overlays pending targets at render
  time, so the widget is immediately correct while the app is suspended.
- Each snapshot includes the next logical-day boundary. The timeline includes an
  explicit empty entry at that boundary (and requests a reload), so stale Today
  tasks disappear even when WidgetKit delays the provider refresh. Expired or
  unknown data asks the user to open the app. All other refreshes are explicit
  `WidgetCenter.reloadTimelines` pushes; there is no polling.
- `WidgetShared.swift` and `DoneQueue.swift` are members of BOTH targets (app +
  extension); `WidgetData.swift`, `ToggleDoneIntent.swift`,
  `TaskListWidget.swift`, and `WidgetPresentation.swift` are extension-only.

Known v1 limitations are documented in the plan (the new day's tasks stay empty
until the app next opens, taps while the app is alive apply on next resume,
iOS 17+ only — the app itself stays at iOS 16).

Widget strings live under `WIDGET.IOS` in `src/assets/i18n/en.json`.
`npm run sync:ios` regenerates `en.lproj/Localizable.strings`; never edit the
generated native resource directly.

## Capacitor

`npx cap sync ios` does not manage this target — extension targets live
outside Capacitor's managed group and the Podfile only declares pods for the
`App` target, so `pod install`/`cap sync` leave SupWidget alone. Keep it that
way: the extension must not link Capacitor pods.

## One-time manual setup (requires Apple developer portal + Xcode)

The target, entitlements, and build settings are already wired in
`project.pbxproj`. Before the first signed build:

1. Portal: register the App ID `com.super-productivity.app.widget`.
2. Portal: create the App Group `group.com.super-productivity.app` and enable
   it on BOTH App IDs (`com.super-productivity.app` and the widget one).
3. Portal: regenerate the app's distribution provisioning profile (it must now
   include the App Group) and create a new distribution profile for the widget
   App ID.
4. CI: update the `IOS_PROVISION_PROFILE` secret with the regenerated app
   profile and add the new `IOS_WIDGET_PROVISION_PROFILE` secret (base64 of
   the widget profile) — see `.github/workflows/build-ios.yml`. Until both are
   in place the App Store export step fails.

## Tests

`../SupWidgetTests/WidgetDataTests.swift` locks the Swift parser to the same
golden JSON as the Kotlin `WidgetDataTest.kt` and the writer-side
`widget.selectors.spec.ts`, and exercises the cross-process queue lease/ack
semantics. Run the shared `SupWidgetTests` scheme with Cmd+U in Xcode. Pull
requests touching the iOS/widget code build the app and widget and run this
scheme via `.github/workflows/ios-pr.yml`.
