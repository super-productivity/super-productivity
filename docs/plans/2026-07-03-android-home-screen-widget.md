# Android home screen widget (revival of PR #7124)

Implements #3818. Based on ilvez's POC (PR #7124, closed) plus the 2026-06-08 review
punch-list. Re-implemented on current master (the PR's April base has drifted heavily).

## Architecture (unchanged from POC — confirmed sound)

- **Snapshot bridge:** Angular pushes a compact JSON snapshot of today's tasks into the
  existing native `KeyValStore` (SQLite) under key `widget_data`. The native
  `RemoteViewsFactory` reads it. No new storage mechanism.
- **Done actions:** `SharedPreferences`-backed `WidgetDoneQueue` (mirrors
  `WidgetTaskQueue` / `ReminderDoneQueue` patterns), drained by Angular.

## Improvements over the POC (mapped to the punch-list)

1. **Title tap opens app (bug fix).** A collection has one `setPendingIntentTemplate`;
   the POC's second fill-in intent silently fell into the done-template. Fix: one
   broadcast template, fill-ins carry either `EXTRA_TASK_ID` (→ done) or
   `EXTRA_OPEN_APP` (→ `startActivity`), branch in `onReceive`.
2. **Manifest hardening.** Custom actions removed from the exported receiver's
   intent-filter (explicit-component PendingIntents don't need filter entries; listing
   them let any app mark tasks done / launch us). Only `APPWIDGET_UPDATE` remains.
3. **Queue-only done path.** Widget tap → enqueue + widget refresh + contentless
   "drain now" LocalBroadcast. Angular always reads via `getWidgetDoneQueue()`
   (get-and-clear). Single delivery path; no double `setDone()`; retires the
   `'$sanitizedId'` string-interpolated JS call.
4. **Single-writer blob (replaces the proposed ts-guard).** Native never writes
   `widget_data`. For instant checkbox feedback while the app is dead, the factory
   overlays `isDone=true` for IDs currently in `WidgetDoneQueue` at render time
   (`peek()`, non-clearing). The Angular-vs-native write race disappears structurally;
   `markDoneInWidgetData` is deleted.
5. **Memoized snapshot selector.** `selectAndroidWidgetData` projects
   todayIds + task entities + project colors into the exact blob shape. Project color
   changes now propagate (POC pulled colors in but excluded them from the distinct key).
   Dedupe happens in `WidgetDataService` via a last-pushed-JSON cache, so all trigger
   paths share it.
6. **Post-sync freshness push (new — gap found in review).** The hydration-guard filter
   drops all emissions during remote-op apply and nothing re-emits after, so the widget
   would miss synced changes until the next local edit. Added push on the
   `isSyncInProgress$` falling edge. (Push-on-pause kept as belt-and-braces.)
7. **Typed contract.** `AndroidWidgetData` interface (TS) + `WidgetData.kt` parser as
   the two named ends of the `v:1` contract, locked by a golden-shape unit test on the
   serializer and a JVM parse test on the Kotlin side. (typia writer-side assert was
   considered and skipped: the object is constructed from typed state, so an assert is
   tautological, and a throw would leave the widget stale — worse than pushing.)
8. **Drain hygiene.** Dedupe IDs, skip missing/already-done tasks (no duplicate ops, no
   op-log noise from stale queue entries), gate on initial data load. One aggregated
   translated snack (`T`/en.json) instead of one hardcoded snack per task.
9. **KeyValStore per-call `db.close()` removal** (correct SQLiteOpenHelper pattern,
   avoids churn from widget reads) — redone against the current chunked-read code.
   All access is `@Synchronized` on the `App`-level singleton, so widget-vs-bridge
   concurrency stays serialized. Backup-ring round trip must be manually verified on
   device (no Robolectric in the project).
10. Kotlin JSON parsing extracted to `WidgetData.kt` (single parse site, JVM-testable
    via `org.json:json` test dep). `optString("projectId", null)` JSON-NULL→"null"
    footgun avoided via `isNull()` checks; Angular omits `projectId` when absent.

## Known limitations (deliberate, documented)

- Widget reflects the app's last known state; cross-client freshness while the app is
  dead is phase 2 (WorkManager + SuperSync).
- Day rollover while the app process is dead still shows yesterday's list until next
  open (native can't recompute "today"; selector handles rollover whenever JS is
  alive). Since #9098 the blob carries `validUntil` (the instant the snapshot stops
  being today, offset included) plus `dayStr` for the label, so native can at least
  _detect_ staleness via `now >= validUntil` and name the day it is actually showing
  instead of claiming "Today". It cannot fix the list. Filtering natively would not
  help: today's repeat instances do not exist as entities until Angular's day-change
  effects materialize them, overdue carry-over runs there too, and `TODAY_TAG`
  membership is virtual — so there is no persisted field a native filter could read
  that would give the right answer even in principle. Only running the app can
  produce today's list. Angular ships the **verdict**, never its inputs, so no platform
  mirrors the app's calendar rules (iOS inherits `validUntil` unchanged).
  Residual gaps, all bounded and deliberate:
  - The label flips only on an Angular push, a widget tap, or the 30-min
    `updatePeriodMillis`. That alarm is `ELAPSED_REALTIME_WAKEUP` but **inexact**
    (`setInexactRepeating`), so Doze defers it to a maintenance window — and the launcher
    paints the system-cached RemoteViews the instant you unlock, so first glance on a new
    morning can still read "Today". The lie is bounded, not eliminated. 30 min is the
    platform floor (`MIN_UPDATE_PERIOD`); lowering `updatePeriodMillis` does nothing.
    `ACTION_DATE_CHANGED` cannot close it either: it is not on the API 26
    implicit-broadcast exemption list, so a manifest receiver never fires at
    `targetSdk 36` — and it fires at calendar midnight, not the user's logical boundary.
  - Force-stop is **not** a gap in the above, contrary to an earlier reading of it. A
    stopped package's widget is _masked_ by the system (`maskWidgetsViewsLocked` swaps in
    `work_widget_mask_view` — a dimmed icon, tap-to-unstop) as well as having its
    broadcasts cancelled, so it shows no task list at all and the header question is
    moot. It follows that #9098's reported symptom — a stale list under "Today" — can
    only occur in the Doze/app-standby band, which is exactly the band this fix works in.
  - **An exact alarm at `validUntil` would close the remaining gap**, and the parts exist
    (`SCHEDULE_EXACT_ALARM`; `BootReceiver` on boot + `MY_PACKAGE_REPLACED`; the
    `canScheduleExactAlarms()`/`setAndAllowWhileIdle` pattern in
    `ReminderNotificationHelper`, which is Doze-exempt where `setInexactRepeating` is
    not). Deferred on **cost/scope** — it needs rescheduling on boot, package replace,
    timezone change, start-of-next-day change and widget add/remove — not because it
    would not work. `SyncReminderWorker` (already running every 15 min while the app is
    dead) calling `refreshAll` is a cheaper variant, though it is gated on sync
    credentials being configured.
  - `validUntil` freezes the writer's timezone: the boundary resolves in whatever zone
    the device was in at push time. West-travel expires it early (a false "outdated" —
    the fail-safe direction); east-travel expires it late. The device timezone is not a
    selector input, so it is recomputed only when one of the selector's own inputs
    changes (today's task ids, a task, a project, todayStr, the offset) or on restart —
    not by travelling, and not by unrelated state churn.
  - A blob written before #9098 has no `validUntil`, so an install that auto-updates and
    is never opened keeps showing "Today" over an old list — indefinitely, not for a
    bounded window. Accepted: without a boundary the widget genuinely cannot know, and
    an unopened app's list is stale regardless; it self-heals on the first push. Note
    this is distinct from the `Outdated` (day-unknown) header, which fires only when the
    snapshot is _known_ stale but its day is unreadable.
- Hardcoded dark styling; Jetpack Glance / Material You is a follow-up view-layer swap.
- Widget chrome strings are native `strings.xml` (English) — accepted for v1.
- No task creation / undo from widget.

## Files

Native: `widget/{TaskListWidgetProvider,TaskListWidgetService,WidgetData,WidgetDoneQueue}.kt`,
`CapacitorMainActivity.kt` (drain receiver), `webview/JavaScriptInterface.kt`
(`getWidgetDoneQueue`, `updateWidget`), `app/KeyValStore.kt`, manifest, layouts,
`xml/appwidget_info.xml`, `values/strings.xml`, `build.gradle` (test dep),
`test/.../widget/WidgetDataTest.kt`.

Angular: `features/android/android-widget.model.ts`,
`features/android/store/android-widget.selectors.ts` (+spec),
`features/android/widget-data.service.ts` (+spec),
`features/android/store/android-widget.effects.ts` (+spec),
`android-interface.ts`, `root-store/feature-stores.module.ts`, `en.json` (+`npm run int`).
