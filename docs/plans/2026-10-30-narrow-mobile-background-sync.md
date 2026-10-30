# Narrow mobile background sync: push on pause and on notification actions

> **Status: Proposed**, design only; nothing scheduled
>
> **Owner / tracking:** Unassigned; open an issue before any implementation.
> Each implementation step is a sync PR (AGENTS.md sync rules 15–16).
>
> **Last verified against the code:** 2026-10-30 (`ed27bd1e95`)
>
> **Removal condition:** delete once the steps in § 5 are shipped or declined
> in an issue; move anything that still matters into
> [android-background-sync-improvements.md](../long-term-plans/android-background-sync-improvements.md).

This note narrows [the survey background-sync note](2026-10-28-survey-mobile-background-sync.md)
(read that first: options A/B/C and the 2026-10-28 decisions still hold) to
the **outbound** half. A change made on the phone should leave the phone
while the OS still lets the app run. It does not try to sync while the app is
dead.

**Sections:** [1. Problem and scope](#1-problem-and-scope) ·
[2. What already exists](#2-what-already-exists) ·
[3. What runs where](#3-what-runs-where) ·
[4. Minimal alternative first](#4-minimal-alternative-first) ·
[5. Proposal](#5-proposal) ·
[6. Getting a tap into the op-log](#6-getting-a-tap-into-the-op-log) ·
[7. Vector clocks and conflicts](#7-vector-clocks-and-conflicts) ·
[8. Per provider](#8-per-provider) ·
[9. Failure modes](#9-failure-modes) ·
[10. Data-loss risks](#10-data-loss-risks) ·
[11. Test strategy](#11-test-strategy) ·
[12. Does it earn its place?](#12-does-it-earn-its-place) ·
[13. Android WorkManager periodic sync: later step?](#13-android-workmanager-periodic-sync-later-step) ·
[14. Open questions](#14-open-questions) ·
[15. Recommendation](#15-recommendation)

## 1. Problem and scope

**Survey (2026 export, 141 responses; `#N` = 0-based CSV row, as in the
sibling note. Answers are paraphrased, never quoted.)** "Mobile apps" is the
most-picked focus area (50), and "Sync reliability" got 32 votes. 123
responses use a phone: SuperSync 60, Dropbox 30, Nextcloud 10, other WebDAV
8, local file 7.

| #   | Platform / provider    | Paraphrase                                                                      |
| --- | ---------------------- | ------------------------------------------------------------------------------- |
| #25 | Android, WebDAV        | A notification "done" does not reach the server until the app is opened.        |
| #88 | Android + Windows, SS  | A reminder dismissed on the phone is still open on the desktop.                 |
| #89 | Nextcloud (mobile)     | After adding a task on mobile, has to press sync by hand.                       |
| #96 | Android + Windows, SS  | Having to open the app for it to sync is discouraging.                          |
| #36 | Android + desktop, DBX | Conflicts appear when one device did not get time to sync before using another. |
| #13 | Android, local file    | The rare conflict comes from not giving the devices time to sync.               |
| #26 | Android, SS            | The widget is behind and cannot refresh without opening the app.                |
| #72 | iOS, WebDAV            | No background sync on iOS.                                                      |
| #83 | iOS, Dropbox           | No background sync while the app is closed on iOS.                              |

The running timer following the user between devices is handled in
[the cross-device time-tracking note](2026-10-28-survey-cross-device-time-tracking.md).
This design only makes sure the tracking ops that already exist leave the
phone on pause.

**In scope**

1. A notification action (done, snooze) taken while the app is in the
   background becomes an op and is pushed. If the app is dead, it is pushed
   on the next launch. See § 3 for why "killed" cannot mean "pushed now".
2. Going to the background flushes pending ops and pushes them.
3. The widget is refreshed after any sync that runs while the app is in the
   background.

**Out of scope:** periodic sync while the app is dead (iOS largely forbids
it; Android is discussed in § 13), inbound freshness while the app is dead
(the widget overlay A.1 is already decided in the sibling note), and native
op-log writers (option C, declined).

## 2. What already exists

Most of items 2 and 3 already exist. The gaps are timing and delivery.

| Need                          | Current code                                                                                                                                                                                                                                                                                                                                  | Gap                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flush on background           | `appStateChange` → `BackgroundTask.beforeExit` → `OperationWriteFlushService.flushPendingWrites()` (`src/main.ts:614-643` Android, `:646-667` iOS; flush service `src/app/op-log/sync/operation-write-flush.service.ts:71`). iOS first dispatches accumulated tracked time (`main.ts:659`).                                                   | Flushes to IndexedDB only, with no push. On Android, `BackgroundTask` does not extend execution (the plugin README says there is no Android implementation).                                                                                                                                                                                                                        |
| Push on background (Android)  | `onPause$` → `I_PAUSE_APP`, throttled to 10 s (`src/app/imex/sync/sync-trigger.service.ts:255`). While the app is backgrounded and JS is alive, `I_MOBILE_ONLY_BACKGROUND_TIMER` fires every `syncInterval` (`:243-251`; default 1 min, `default-global-config.const.ts:251`).                                                                | Goes through the fire-and-forget `BackgroundSyncSchedulerService.request()` (`sync.effects.ts:194-235`, `background-sync-scheduler.service.ts:177`). The 5 s duty-cycle floor (`background-sync-scheduler.service.ts:213-218`, `SYNC_MIN_INTERVAL` `sync.const.ts:25`) defers a pause that comes within 5 s of the previous sync, and the 10 s pause throttle can drop it entirely. |
| Push on background (iOS)      | `visibilitychange: hidden` → `I_VISIBILITY_HIDDEN`, not throttled (`sync-trigger.service.ts:157-162`).                                                                                                                                                                                                                                        | Same scheduler path. It is not awaited inside the `beforeExit` budget, so iOS can suspend the WebView mid-request.                                                                                                                                                                                                                                                                  |
| Sync on resume                | Android: `I_RESUME_APP` (`sync-trigger.service.ts:254`), throttled to 10 s. SuperSync also downloads when the WebSocket triggers it (`op-log/sync/ws-triggered-download.service.ts`).                                                                                                                                                         | **iOS has no resume trigger.** It only opens the sync window (`:76-78`). The next sync is the first `touchstart`, throttled to 15 min (`:111-115`, `:42`), the file-provider interval timer, or a SuperSync WebSocket download (not verified on iOS resume).                                                                                                                        |
| Widget refresh after sync     | `pushOnSyncWindowEnd$` (`src/app/features/android/store/android-widget.effects.ts:104-113`) plus `pushOnPause$` (`:118-124`).                                                                                                                                                                                                                 | None while JS runs. **Item 3 needs no new code**; it follows from item 2.                                                                                                                                                                                                                                                                                                           |
| Android notification done     | The receiver cancels the notification, removes the alarm and queues the task id (`receiver/ReminderActionReceiver.kt:72-87`; `ReminderDoneQueue.addTaskId` `widget/ReminderDoneQueue.kt:20`). The queue is drained on cold start (`src/app/features/android/android-interface.ts:313-353`) and on resume (`store/android.effects.ts:81-123`). | **No drain signal.** A paused but live app does not apply the tap until the next `onResume`. Compare the tracking/focus actions, which send `ACTION_DRAIN` (`receiver/NotificationActionReceiver.kt:33,71`; `CapacitorMainActivity.kt:100`).                                                                                                                                        |
| Android notification snooze   | Native reschedules the alarm, then `ReminderSnoozeQueue.addSnoozeEvent` (`ReminderActionReceiver.kt:107`).                                                                                                                                                                                                                                    | Same: no drain signal.                                                                                                                                                                                                                                                                                                                                                              |
| Applying a queued done/snooze | `ReminderModule._handleAfterDataLoaded` waits for the initial sync and data load (`src/app/features/reminder/reminder.module.ts:300`, #8551). `_handleDoneAction` (`:426`) runs `sync()`, then skips a missing or done task, else `TaskService.setDone`. `_handleSnoozeAction` (`:496`) works the same way.                                   | The queue is read **and cleared** (`ReminderDoneQueue.getAndClear` `:29`) before the op is persisted (§ 10, risk R1).                                                                                                                                                                                                                                                               |
| iOS notification actions      | `LocalNotifications.registerActionTypes` without `foreground` (`src/app/core/platform/capacitor-notification.service.ts:97`). Listeners at `:122` and `:335`; handled in `reminder.module.ts:265-359`. The plugin holds the event until a listener registers (`retainUntilConsumed`).                                                         | No native queue. The retained event is held only in the plugin's memory (§ 10, risk R2). `ios/App/App/AppDelegate.swift` has no notification code.                                                                                                                                                                                                                                  |

Path prefix for Kotlin files:
`android/app/src/main/java/com/superproductivity/superproductivity/`.

## 3. What runs where

All op-log writes and all sync I/O run in the WebView (Angular, IndexedDB
`SUP_OPS`). Native code only queues intents and touches notifications and
alarms. There is no headless JS path on either platform.

| App state                             | Android                                                                                                                                                                                                | iOS                                                                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foreground                            | Everything runs.                                                                                                                                                                                       | Everything runs.                                                                                                                                                                              |
| Just backgrounded                     | JS keeps running. Capacitor's `KeepRunning` defaults to true (`@capacitor/android` `Bridge.java:463-464`), so the WebView does not pause its timers. A broadcast receiver can reach the live Activity. | About 30 s of `beginBackgroundTask` time, via `BackgroundTask.beforeExit`. After `finish()`, or when the budget runs out, the WKWebView is suspended.                                         |
| Backgrounded a while (process cached) | The process may be frozen by the cached-app freezer (Android 14+). A broadcast delivery thaws it briefly; **whether WebView JS then runs long enough to sync is unmeasured** (§ 14, Q1).               | Suspended: no JS. A non-foreground notification action may wake the app briefly, but the plugin forwards the event and finishes at once, so a WebView sync is not expected to fit (§ 14, Q2). |
| Killed                                | No WebView. The receiver writes the SharedPreferences queue; the next launch drains it. Nothing can record an op until then.                                                                           | The action may relaunch the app in the background, but no JS work can be counted on. Today the tap survives only as the plugin's in-memory retained event.                                    |

Consequence: "record the op and push it while killed" is impossible without
a second op-log writer (option C, declined) or a server-side intent queue
(option A.2, parked until share capture M2 has been in a release). This design
does the reachable part. A tap made while the process is alive is pushed at
once. A tap made while it is dead is durable and pushed first thing on the
next launch.

## 4. Minimal alternative first

**Step 0 alone may resolve most reports.** It needs no native code and no
change to any persisted format.

1. **Awaited push on background.** In the existing `beforeExit` callbacks
   (`main.ts:626-667`), after `flushPendingWrites()`, call
   `SyncWrapperService.sync()` directly (`sync-wrapper.service.ts:313`), the
   same awaited path the scheduler contract reserves for initial and
   before-close syncs (`background-sync-scheduler.service.ts:31-34`). Race it
   against a budget (about 20 s on iOS, below the 30 s expiry so `finish()`
   is always called; iOS terminates apps that overrun). Drop
   `I_PAUSE_APP`, and on iOS `I_VISIBILITY_HIDDEN`, so the same event does
   not cause two syncs. Skip the call if a sync is already running (the
   cycle guard already does this) or if offline.
2. **Immediate sync on iOS resume.** Add `iosInterface.onResume$`
   (`src/app/features/ios/ios-interface.ts:17-22`) to the iOS trigger set,
   matching Android's `I_RESUME_APP`. This is the sibling note's decision
   ("measure the first sync after resume and fix it if slow"); § 2 shows why
   it is slow.
3. **Widget:** nothing to add. `pushOnSyncWindowEnd$` refreshes the widget
   when the step-1 sync settles.

What step 0 does not fix: a notification "done" tapped while the app is
paused waits for the next resume (Android) or for JS to run at all (iOS).
#25 and #88 are exactly that case if the phone app was in the background,
not killed. So step 0 is necessary, but it does not cover item 1 of the scope.

Ship step 0, then re-check #25/#88/#89 style reports for one release before
doing step 1.

## 5. Proposal

### Step 0: KISS (§ 4)

The cost is two small app-side changes plus E2E tests. It touches the sync
trigger path, so it is a sync PR.

### Step 1: Android, push notification actions taken while the app is alive

1. **Drain signal.** After queuing, `ReminderActionReceiver` sends a
   contentless LocalBroadcast, the same pattern as `ACTION_DRAIN`. The live
   Activity forwards it to JS, which drains the done/snooze queues through
   the same `onReminderDone$` / `onReminderSnooze$` subjects the resume
   drain uses (`android.effects.ts:81-123`). No new action types: the drain
   still ends in `TaskService.setDone` or the existing snooze dispatch.
2. **Ack after persist (prerequisite for 1).** Replace read-and-clear with
   peek plus acknowledge, as `CaptureInbox.acknowledge` already does
   (`widget/CaptureInbox.kt:192`, `webview/JavaScriptInterface.kt:526`).
   Each queue entry gets a native-generated `id`. JS acknowledges the id
   only after the resulting op is durable (`flushPendingWrites()`), or after
   it decided to skip the entry (task gone or already done). Section 10 (R1)
   explains why this must come with the drain signal and not after it.
3. **Push.** The resulting op takes the normal path. SuperSync uploads
   immediately (`immediate-upload.service.ts:120`, 2 s debounce). File
   providers get a direct `sync()` after the drained ops are flushed,
   because their periodic path is not guaranteed to run before the freezer
   (`immediate-upload.service.ts:163` excludes file providers on purpose to
   save API calls; one sync per user tap does not undo that).
4. **Order inside the drain.** Keep the current `sync()` → check → dispatch
   order of `_handleDoneAction`. Downloading first lets "already done
   elsewhere" be detected instead of creating a conflict (§ 7).

### Step 2: iOS (only after measurement, § 14 Q2)

If a device test shows that the JS listener does not reliably receive
actions taken while the app is suspended or killed, add a native queue: an
`UNUserNotificationCenterDelegate` wrapper, or a Capacitor plugin hook that
writes `{id, type, taskId, at}` to `UserDefaults` before the plugin
completes. It mirrors the Android queue and uses the same ack contract.
Otherwise the iOS work is step 0 only. Do not add `foreground: true` to the
actions: opening the app on "done" is what the non-foreground action exists
to avoid.

### Not proposed

A native "done" that writes to the server while the app is dead. That is
option A.2. Its preconditions (share capture M2 in a release, a capability
gate for released clients) are unchanged.

## 6. Getting a tap into the op-log

- **Native stores intents, never ops.** A queue entry is `{id, taskId,
[newRemindAt, reminderType], at}`. The op is created in the WebView, by a
  normal persistent action dispatched from local code, and captured by the
  op-log meta-reducer and `persistOperation$`
  (`src/app/op-log/capture/operation-log.effects.ts:123`). One tap leads to
  one dispatch, which leads to one op. The client id, vector clock and
  schema are exactly those of a UI tap.
- **No re-trigger on replay.** The drain is fed from the native queue, not
  from an action stream, so a remote `setDone` arriving through
  `bulkApplyOperations` never reaches it. Effects that react to the local
  `setDone` keep using `LOCAL_ACTIONS` (rule 1).
- **Duplicates.** At-least-once delivery (peek plus ack) with idempotent
  apply:
  - Done skips a task that is missing or already done (`reminder.module.ts:426-445`).
  - Snooze should skip when the task's reminder already equals `newRemindAt`.
    Without that check, a redelivered snooze writes a second, value-equal op:
    harmless, but noise.
  - The id makes a double drain in one session (cold-start ReplaySubject
    plus resume drain plus drain signal) a no-op. JS keeps a set of
    in-flight ids until it acknowledges them.
- **Nothing else from native writes synced state.** The receiver's
  notification/alarm changes are device-local (`ReminderAlarmStore`). The
  synced reminder change comes only from the WebView op.

## 7. Vector clocks and conflicts

- **No new clock semantics.** The op carries the device's own clock,
  incremented at dispatch time in the WebView. No native code touches a
  clock, so `MAX_VECTOR_CLOCK_SIZE` and pruning are unaffected.
- **Concurrency is the same as a UI tap made at drain time.** If the drain
  syncs first (§ 5, step 1.4), the op happens-after every remote op already
  on the server, so there is usually no CONCURRENT conflict. Without the
  download first, a concurrent edit to the same task resolves through the
  existing field-level LWW. Both are existing paths; no new action reaches
  `UnsupportedMultiEntityConflictError` (rule 14).
- **Stale intent.** The downside of "sync first, then apply": a tap made
  while the app was dead is applied at drain time and happens-after a later
  edit made elsewhere. Example: done at 09:00 on the phone (app killed),
  un-done on the desktop at 10:00, phone opened at 11:00 → done wins. This
  is **today's behavior** and not made worse here. Step 1 makes the window
  shorter for the alive case. A guard (skip if `task.modified`,
  `task.model.ts:154`, is newer than the entry's `at`) would need evidence
  of harm first (rule 15). Record it as an issue, not part of this work.
- **`SYNC_IMPORT` / `BACKUP_IMPORT`** received during the pause sync drops
  concurrent pending ops by design (rule 7). Pushing earlier shrinks that
  window; it does not change the semantics.

## 8. Per provider

| Provider                | Pause push (step 0)                                                                                                                                                                      | Drained tap (step 1)                             | Fits iOS ~20 s budget?                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| SuperSync               | Upload of pending ops, plus download. Small requests; ops are deduplicated server-side by op id, so a cut-off upload is retried safely.                                                  | Immediate upload (2 s debounce) already applies. | Usually. E2EE: the key is persisted (below), but a cold Argon2id derivation costs time; measure (§ 14 Q3). |
| Dropbox / OneDrive      | Full file cycle: download, merge, upload with API compare-and-swap. Token refresh via refresh token works in the background if online (`dropbox-api.ts:293`, `onedrive.ts:445`).         | Direct `sync()` after flush.                     | Often. A cut-off upload loses nothing: ops are acknowledged only after upload.                             |
| WebDAV / Nextcloud      | Full file cycle. `getFileRev` is a full GET, and 90 s syncs are ordinary (`background-sync-scheduler.service.ts:203-204`). Strong ETags give CAS; weak or missing ETags are best-effort. | Direct `sync()` after flush.                     | **Often not.** A cut-off cycle is crash-equivalent (epoch fence / deferred acks), so the ops go next time. |
| LocalFile (Android SAF) | Local write; fast. Single-writer, backup-only; the transport (e.g. Syncthing) runs outside the app, so pushing on pause mainly gives that tool fresher data.                             | Direct `sync()` after flush.                     | n/a on iOS.                                                                                                |

**Encryption keys while backgrounded:** the key is in provider private
config in IndexedDB (`src/app/op-log/sync-providers/credential-store.service.ts:13-14`,
written at `:329`), not memory-only. A running WebView therefore has it. Only
a missing key is a failure, and the upload then fails closed and keeps the
ops pending
([encryption architecture § Upload](../sync-and-op-log/supersync-encryption-architecture.md#3-upload-integration)).

## 9. Failure modes

| Failure                                            | Behavior (must hold)                                                                                                                                                                                                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offline at pause or tap                            | No sync attempt (the existing offline filter, `sync.effects.ts:222-225`). The op stays durable and pending; resume or `I_IS_ONLINE` pushes it.                                                                                                                                     |
| Auth expired (`AuthFailSPError`, 401/403)          | Pending ops are kept. No dialog while backgrounded: the error surfaces on the next foreground sync, as it does today. Do not retry in the background.                                                                                                                              |
| Key missing or wrong password                      | Fail closed; no plaintext upload; ops stay pending. The recovery dialog appears in the foreground only.                                                                                                                                                                            |
| OS suspends or kills mid-sync                      | Crash-equivalent, as the [epoch fence](../sync-and-op-log/contributor-sync-model.md#the-sync-epoch-fence-9074) already requires: deferred acks re-upload, a behind cursor re-downloads with dedup. iOS must call `finish()` before expiry (budget race), or the app is terminated. |
| Suspended with the sync window open                | The `openSyncWindow()` failsafe closes it; check that day-change and `TODAY_TAG` repair effects run after resume (`skipDuringSyncWindow()`).                                                                                                                                       |
| Tap drained before the initial sync gate           | Stays queued (`_handleAfterDataLoaded`, #8551); not acknowledged until applied.                                                                                                                                                                                                    |
| Provider or account switched between tap and drain | The cycle's epoch fence aborts the stale sync. The intent applies to whatever state is local, like a UI tap.                                                                                                                                                                       |
| Battery                                            | One extra sync per pause, replacing `I_PAUSE_APP` and `I_VISIBILITY_HIDDEN`. One per notification tap. No timers added.                                                                                                                                                            |

## 10. Data-loss risks

- **R1 (Android, exists today): the queue is cleared before the op is
  durable.** `getAndClear` empties SharedPreferences when JS reads it. If
  the process dies before capture writes the op, the tap is lost: the
  notification is already gone and the task is still open. Today this
  window opens only at launch or resume. A drain while backgrounded (step 1)
  moves it to exactly the moment the OS likes to kill processes. That is why
  ack-after-persist is part of step 1, not separate hardening. Without step
  1, R1 has no observed instance; file it as a gap issue, not a fix.
- **R2 (iOS, unverified): the retained action event lives only in the
  plugin's memory.** If iOS evicts the process before JS registers its
  listener, the tap is lost. Reproduce it on a device before building
  step 2.
- **R3: a pause sync cut off mid-upload on a file provider without strong
  ETags.** This is the existing best-effort race, not a new one, but step 0
  makes it more frequent (WebDAV on iOS rarely fits the budget). Check the
  Nextcloud/WebDAV E2E for the interruption case before shipping step 0 for
  file providers. If it is not clean, run step 0 as flush-only for them.
- **R4: stale intent** (§ 7). This is a content override, not loss, and it
  already exists.
- **Persisted formats.** No persisted model, sync wire, schema version or
  plugin API changes. The only format change is the device-local Android
  queue (JSON array of ids → entries with `id` and `at`). APK and WebView
  update together, but entries queued before the update must still be read.
  The JS drain accepts both shapes for one release. This is a local
  persisted format, so it is the allowed compatibility exception.

## 11. Test strategy

Each sync step starts with a failing reproduction (sync-correctness rules,
"Reproduce first").

**E2E (Playwright, two clients, real providers).** Use the fake
`window.SUPAndroid` bridge (`e2e/tests/focus-mode/android-timer-bridge.ts`;
`IS_ANDROID_WEB_VIEW` is `!!window.SUPAndroid`,
`src/app/util/is-android-web-view.ts:3`). Simulate suspension with Chromium's
CDP `Page.setWebLifecycleState({ state: 'frozen' })`; a fixed delay would not
model it.

1. **Pause push within the floor (step 0)** — `@supersync` and `@webdav`.
   Client A syncs, adds a task within 5 s, then pauses. A is frozen about
   2 s after the pause event. Client B syncs and must see the task. Today it
   fails: the scheduler floor defers the request past the freeze.
2. **iOS resume sync (step 0)** — `mobile-webkit` project. Make a change on
   B, then hide and show A. A must show it without a touch. Today it fails:
   there is no resume trigger.
3. **Done while paused (step 1)** — A is paused (fake bridge `onPause$`).
   The fake queue receives a done entry and the drain signal fires. B sees
   the task as done without A resuming. Today it fails: no drain signal.
4. **Kill between drain and persist (step 1, R1)** — the fake bridge
   implements peek and ack. Close A's page right after the drain, before the
   flush, then reopen it with the same storage. The task is done exactly
   once, the queue is empty, and B sees one done op. Today it fails: the
   entry is cleared on read.
5. **Conflict, both directions** (rule 12 spirit) — B edits the same task
   concurrently before and after A's drained done. Both converge, and the
   task title and notes are preserved.

Run them through the scheduled E2E workflow (provider servers are not
reachable from a sandboxed session; `e2e/AGENTS.md`).

**Unit:** drain dedup by id, ack only after `flushPendingWrites()`, the
legacy queue shape, budget race calling `finish()`, no double sync on pause.

**Native:** a Kotlin instrumented test (beside
`TrackingNotificationActionInstrumentedTest`) checks that the receiver
writes an id'd entry and sends the drain broadcast. A `ReminderDoneQueue`
unit test checks that peek and ack preserve un-acknowledged entries.

**Device measurement (not automatable):** Android 14+ freezer timing after
pause, iOS background-action wake (Q1–Q3). Record the results in the issue
and extend the [Android verification harness](../../tools/android-verify/README.md)
checklist.

## 12. Does it earn its place?

- **Demand:** outbound complaints from distinct users across providers
  (#25, #88, #89, #96) plus timing conflicts (#13, #36). Step 0 also helps
  inbound on iOS (#72, #83) at the cost of one trigger.
- **Leanest fix first:** step 0 is a few lines on existing paths and
  replaces two triggers instead of adding a mechanism. Step 1 reuses an
  existing native pattern (`ACTION_DRAIN`, `CaptureInbox` ack). Step 2 is
  conditional.
- **Principles:** no setting, no new alerts; offline-first is unchanged.
  Sync stays optional, and failures are silent until the foreground.
- **Long-term cost:** no persisted model, wire or plugin-API change. The
  native↔JS queue contract grows by `id`/`at` and an ack call; that is
  device-local and versioned with the APK.

## 13. Android WorkManager periodic sync: later step?

**Not worth it now.** A WorkManager job cannot run the sync stack: there is
no headless WebView or JS engine, and the op-log lives in the WebView's
IndexedDB. The only ways to get one are option C (a second runtime writing
the op-log, with a cross-process lock and durable clock increments) or a
native sync-core. Both are declined in the sibling note. What WorkManager
can do without them already exists (`SyncReminderWorker`, read-only,
SuperSync, every 15 min) or is planned (widget overlay A.1, reusing that
worker). Periodic work is also floored at 15 min and deferred by Doze and
standby buckets, so it would not have fixed #25/#88 in the minutes after a
tap.

Revisit only if (a) step 0 + step 1 ship and reports of "done on the phone
but not on the desktop" continue with the app killed, **and** (b) option
A.2 is still blocked. Even then, the better use of WorkManager is a
one-time expedited job that uploads a sealed done intent (A.2's transport,
like `ShareUploadWorker`), not periodic full sync.

## 14. Open questions

1. **Q1 (Android):** after how long in the background does the freezer stop
   WebView JS on current devices, and does a LocalBroadcast-driven drain get
   enough CPU to finish `flush` + `sync`? If not, should step 1 hold a
   short `goAsync()` window (as `ReminderAlarmReceiver` does with its 8 s
   budget) while JS works?
2. **Q2 (iOS):** for a non-foreground action on a suspended or killed app,
   does the WebView boot and the listener fire before suspension? This
   decides whether step 2 is needed (R2).
3. **Q3:** how long does a cold E2EE key derivation take on a mid-range
   phone? Does it fit the iOS budget, or should the pause push skip it when
   no key is cached?
4. **Q4:** should a WebDAV pause sync that cannot finish in the budget be
   flush-only for file providers on iOS (R3)?
5. **Q5:** is the stale-intent guard (§ 7) wanted once any report shows a
   later desktop edit being overridden?
6. **Q6:** with step 0 in place, are `I_MOBILE_ONLY_BACKGROUND_TIMER`
   ticks while backgrounded still needed? They keep a warm process syncing
   every minute, which feeds the widget but costs battery.

## 15. Recommendation

Build step 0 first, as one sync PR with E2Es 1 and 2. Build step 1 only if
reports persist after a release, with ack-after-persist in the same PR (E2Es
3–5). Build step 2 only if a device test shows R2. Keep WorkManager periodic
sync and A.2 parked as in § 13. Document the remaining limit in the wiki:
an action taken while the app is closed reaches other devices on the next
launch.
