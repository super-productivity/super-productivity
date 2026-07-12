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
  `{taskId: targetIsDone}` map (`DoneQueue`) — never the blob itself. The
  timeline provider overlays pending targets at render time, so the widget is
  immediately correct even while the app is suspended.
- Timeline policy is `.never`: every refresh is an explicit
  `WidgetCenter.reloadTimelines` push (from the app after a snapshot write) or
  WidgetKit's automatic re-render after an interactive intent. No polling.
- `WidgetShared.swift` and `DoneQueue.swift` are members of BOTH targets (app +
  extension); `WidgetData.swift`, `ToggleDoneIntent.swift`,
  `TaskListWidget.swift` are extension-only.

Known v1 limitations are documented in the plan (stale-until-next-open on day
rollover, taps while the app is alive apply on next resume, iOS 17+ only —
the app itself stays at iOS 16, English-only chrome).

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
`widget.selectors.spec.ts`. The project has no iOS test target yet — to run
them, add a Unit Testing Bundle target (`SupWidgetTests`, no host app) in
Xcode, add that file plus `SupWidget/WidgetData.swift` to it, and Cmd+U.
