# Survey 2026: background sync on mobile

> **Status: Proposed**, direction decided 2026-10-28 (§ 10); nothing scheduled, the survey is still open
>
> **Owner / tracking:** Unassigned; open an issue before any implementation.
>
> **Last verified against the code:** 2026-10-28 (`79c678aab9`)
>
> **Removal condition:** delete once a decision is recorded in an issue, or
> move the enduring parts into
> [android-background-sync-improvements.md](../long-term-plans/android-background-sync-improvements.md).

Sibling notes: [narrow outbound background sync design](2026-10-30-narrow-mobile-background-sync.md),
[cross-device time tracking](2026-10-28-survey-cross-device-time-tracking.md),
[Planner and Schedule](2026-10-28-survey-planner-schedule.md).

**Survey references.** `#N` is the 0-based row of the response in the
2026-10 CSV export (94 responses, 2026-10-27/28). The export is never
committed ([survey plan § Privacy](2026-10-27-user-survey.md#privacy)), so
answers are paraphrased, never quoted. Counts are responses, not people, from
self-selected engaged users.

## 1. Problem

Users act on the phone outside the app (widget checkbox, notification "done")
and expect that to reach their other devices. They also expect phone surfaces
(widget, reminders) to reflect what happened elsewhere. Neither happens until
the app is opened.

| #   | Platform / provider          | Paraphrase                                                                                       |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| #25 | Android, WebDAV              | Completing a task from the notification does not reach the server until the app is opened.       |
| #26 | Android, SuperSync           | The widget is almost always behind the other devices and cannot refresh without opening the app. |
| #72 | iOS, WebDAV                  | The main obstacle is that sync does not run in the background.                                   |
| #83 | iOS, Dropbox                 | Missing background sync on iOS while the app is closed.                                          |
| #88 | Android + desktop, SuperSync | A reminder dismissed as done on the phone is still open on the desktop until the phone app runs. |
| #89 | Linux (+ phone), Nextcloud   | Must open the app for sync to happen; after adding a task on mobile, has to press sync manually. |
| #77 | Android + desktop, SuperSync | Still gets reminders on Android for tasks already done on the desktop.                           |

Context numbers: "Mobile apps" is the most-picked focus (36), "Sync
reliability" third (26). Android is the top platform (60). Of the 84 responses
that use a phone, 41 sync with SuperSync and 36 with a file-based provider
(Dropbox 21, Nextcloud 5, other WebDAV 5, local file 5). So "beyond SuperSync"
is not a niche: it is about as large as the SuperSync group.

Widget complaints are mostly about features, not staleness: list choice and
an add button (#42, #51, #86), "more useful" (#46, #57, #93). Only #26 and #67
(widget does not update) are about staleness.

The evidence splits into two symptoms with different costs:

- **Outbound:** an action taken outside the app stays on the phone (#25, #88).
- **Inbound:** phone surfaces show stale state (#26, #77; iOS #72, #83).

## 2. Current behavior

- **Reminder worker (Android, SuperSync only, since v18.0.0).**
  `SyncReminderWorker.kt:8-16` documents that it does not apply state; it only
  cancels and schedules reminders. It reads SuperSync credentials
  (`:27-31`) and always builds a `SuperSyncBackgroundProvider` (`:33-35`).
  Its `lastServerSeq` cursor is display-only and must never seed foreground
  sync ([safety fence](../long-term-plans/android-background-sync-improvements.md#rejected-using-the-reminder-cursor-for-foreground-sync)).
  The native side can already decrypt E2EE op payloads (`crypto/OpPayloadDecryptor.kt`).
- **Widget.** Renders a snapshot that only Angular writes
  (`widget/TaskListWidgetProvider.kt:19-24`, `widget-data.service.ts:50-51`).
  Taps go to `WidgetDoneQueue` (`WidgetDoneQueue.kt:7-16`, last tap per task
  wins), which Angular drains into `TaskService.setDone`
  (`android-widget.effects.ts:157`).
- **Notification actions.** Same pull pattern (`NotificationActionQueue.kt:8-17`,
  #10683): native applies what it can at tap time (dismiss), Angular drains on
  start/resume.
- **Precedent for "leave the phone without the app":** Android shares upload
  sealed to SuperSync capture (`share/ShareUploader.kt:16-25`,
  `POST /api/capture/items`); any SuperSync device imports them as a normal
  local op ([share capture plan § M2](2026-10-24-android-share-capture.md#m2-background-upload-over-supersync-capture)).
  On master since `ca07c826cc` (2026-10-25); not in any release tag yet.
- **Android foreground, file providers.** No interval sync while the app is
  open (#10685, `sync-trigger.service.ts:237`). #10685 waits for a user
  report; #89 may be one (ask for provider, version, repro).
- **iOS.** `Info.plist:54-57` declares the `fetch` background mode, but no
  Swift code registers `BGTaskScheduler` or `performFetch`
  (`ios/App/App/*.swift`). Nothing runs in the background on iOS today.

## 3. Options

### A. Leanest: an honest widget plus done intents (SuperSync)

1. **Widget overlay from the worker (inbound).** The worker already sees which
   task ids were completed, deleted, archived or rescheduled elsewhere. It
   stores them in a display-only overlay that the widget applies to the
   snapshot (hide or check the rows), the same way the pending-tap overlay
   works today. The next Angular snapshot clears it. The widget also shows
   "as of HH:MM". No sync surface, no state apply. New or renamed tasks still
   wait for the app.
2. **Upload done intents (outbound).** Widget and notification "done" taps are
   sealed and posted to a capture-style server queue as
   `{taskId, isDone, tappedAt}`. The next foreground device applies each one
   through the existing `TaskService.setDone` path, as an ordinary local op.
   The phone drains its local queue as today; done is idempotent.

Before building step 2, let share capture M2 ship and run in a release.

### B. Read-only background workers for file providers

Implement the [other providers](../long-term-plans/android-background-sync-improvements.md#possible-improvement-other-sync-providers)
section: Kotlin Dropbox/WebDAV readers that download the remote sync file,
decode it (compression, encryption) and diff it against a cached copy to
drive reminders and the widget overlay from option A. Read-only, so
file-provider users get no outbound path.

### C. Full headless state apply (any provider, both platforms)

Run the real sync stack without UI: hydrate state, download and apply
remote ops, upload local ops (including queued taps), and refresh the widget
from the result. On Android, this means a WorkManager job that boots a headless
WebView or JS engine with IndexedDB/SQLite access. On iOS, the same work
would have to fit in a `BGAppRefreshTask` window. A native rewrite of
sync-core (Kotlin/Swift) is the only other way, and it is worse.

## 4. Sync and persisted-model risks

| Risk                                  | A                                                                                                                                                                                        | B                                                                                              | C                                                                                                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Replay determinism                    | Overlay: none, display only. Intents become a normal local op on the applying device.                                                                                                    | None (read-only).                                                                              | High: a second runtime must not re-trigger effects for remote ops (`LOCAL_ACTIONS`), and must hold the op-log lock against a foreground instance that may start mid-run. |
| Concurrent edits                      | Stale intent: the user un-did the task on desktop after the tap. Guard: skip if `task.modified` (`task.model.ts:154`) is newer than `tappedAt`; skip if the task is gone.                | None.                                                                                          | Two writers on one device (background job + app) is the multi-tab problem; needs a cross-process lock.                                                                   |
| Vector clocks                         | None native: the applying device authors the op with its own clock.                                                                                                                      | None.                                                                                          | The headless client is the same client id; its clock increments must be durable before the app reads them, or ops collide.                                               |
| Released clients                      | Old apps must never claim an intent as a capture item, or it would be imported as a junk task. Needs a separate queue or server-side capability gate. New route is a public API forever. | A Kotlin copy of the file format: every future change to the format needs two implementations. | Unchanged wire, but every headless bug hits released data.                                                                                                               |
| `UnsupportedMultiEntityConflictError` | No new crossing: `setDone` is the action the widget drain already dispatches.                                                                                                            | n/a                                                                                            | No new action types, but more concurrent application raises the rate of existing crossings.                                                                              |
| Persisted model / growth              | No model change. Intents are bounded by taps and deleted once claimed, like capture items.                                                                                               | Cached remote copy on device (size of the sync file).                                          | None new.                                                                                                                                                                |

## 5. Platform limits

- **Android WorkManager:** periodic work runs at least 15 minutes apart, and is
  deferred further by Doze, app-standby buckets (a "rare" app may run less than
  once a day) and OEM battery killers. A worker has about 10 minutes of
  execution. Starting a foreground service from the background is restricted on
  Android 12+, so option C cannot fall back to one. FCM push is the only way
  below 15 minutes, and it is gated on a privacy decision
  ([push-based cancellation](../long-term-plans/android-background-sync-improvements.md#possible-improvement-push-based-cancellation)).
- **iOS:** `BGAppRefreshTask` is opportunistic (the system schedules it from usage
  patterns), gets about 30 s, and stops after the user force-quits the app.
  `BGProcessingTask` usually needs charging and idle. Silent push needs APNs
  plus server work and is throttled. WKWebView JS does not run in the
  background, so option C on iOS would need a native or JSC runtime with
  access to the app's storage. iOS has no widget today, so only reminders
  would benefit.

## 6. Rough cost

| Option                                 | Effort                                                  | Ongoing cost                                  |
| -------------------------------------- | ------------------------------------------------------- | --------------------------------------------- |
| A.1 widget overlay + "as of" stamp     | 2–4 days (Kotlin + instrumented test)                   | Low; no sync surface                          |
| A.2 done intents                       | 1–2 weeks (server route, Kotlin seal reuse, apply, E2E) | New public route; small                       |
| #10685 foreground interval (file sync) | ~1 day once reproduced                                  | None                                          |
| B per file provider                    | 1–2 weeks each                                          | Format coupling forever; credential bridging  |
| C                                      | Months, both platforms                                  | A second sync runtime; highest data-loss risk |

## 7. Does it earn its place?

- **Demand:** real but narrow per symptom: two widget-staleness responses and two
  outbound-done ones. The 36 "Mobile apps" votes are not specific to sync, so
  they do not justify C.
- **Prior "no":** FCM push is not approved; other providers are "only in
  response to demonstrated provider demand"
  ([priority table](../long-term-plans/android-background-sync-improvements.md#priority-and-sequencing)).
  This survey shows file-provider users on phones (36), but only #25 and #89
  report the symptom.
- **Principles:** A keeps sync optional and offline-first and adds no setting.
  C would make an optional sync path load-bearing for core behavior.
- **#77** should already be covered by the worker (SuperSync), so it is a
  possible bug, not a feature gap: the 15-minute window, a worker that never
  runs (battery restrictions, credentials not bridged), or #10618. Ask for a
  reproduction before designing anything around it.

## 8. Open questions

1. ~~Is #89 the user report #10685 needs?~~ Decided: yes (§ 10).
2. Does the share-capture queue (M2) work in the field? Measure retries and
   duplicates in one release before reusing the pattern for intents.
3. Should a done intent also stop a reminder on the other devices immediately
   (server relay), or is the next foreground sync enough?
4. Does the widget overlay need the reschedule case (task moved off Today),
   or are done/deleted enough to stop the "always behind" feeling?
5. Do iOS users want background sync for reminders, or because the app looks
   stale on open? If the latter, a faster first sync on resume is the fix.

## 9. Recommendation

Do not build C. Build A.1 (widget overlay plus "as of" stamp) when mobile work
is next: it addresses #26 with no sync risk. Fix #10685 once #89 (or another
user) gives a reproduction. Keep A.2 parked until share capture M2 has been in a
release. Then re-check the survey count for outbound "done" complaints. Keep B
parked under the existing long-term plan. For iOS, record "no background sync"
as a known limit in the wiki rather than building toward it.

## 10. Decisions (2026-10-28)

- **#10685:** #89 counts as the user report. Paraphrase it on the issue, write
  the WebDAV E2E reproduction first (fails without the fix), and fix only if it
  reproduces.
- **Widget:** build A.1 (worker overlay plus "as of" stamp) when mobile work is
  next. SuperSync only.
- **iOS:** no native background work. Document "no background sync on iOS" in
  the wiki, then measure the first sync after resume and fix it if slow; that
  helps every provider, including #72 (WebDAV) and #83 (Dropbox).
- **Defaults kept:** C declined; A.2 parked until share capture M2 has been in a
  release; B parked under the long-term plan.
- **Follow-up Discussion** (post after the survey closes): iOS users, is it
  about reminders or the app looking stale on open (open question 5)? And a
  reproduction for #77.
