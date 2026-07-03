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
- Day rollover while the app process is dead shows yesterday's list until next open
  (native can't recompute "today"; selector handles rollover whenever JS is alive).
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
