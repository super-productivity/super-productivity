# Survey 2026: a running time tracker across devices

> **Status: Proposed**, direction decided 2026-10-28 (§ 11); nothing scheduled, the survey is still open
>
> **Owner / tracking:** Unassigned; open an issue before any implementation.
>
> **Last verified against the code:** 2026-10-28 (`79c678aab9`)
>
> **Removal condition:** delete once a decision is recorded in an issue.

Sibling notes: [mobile background sync](2026-10-28-survey-mobile-background-sync.md),
[Planner and Schedule](2026-10-28-survey-planner-schedule.md). Survey
references (`#N` = 0-based CSV row, paraphrased, counts are responses) as
explained in the first sibling note.

## 1. Problem

Users start tracking on one device and switch to another. They want the
running timer to follow them, or at least to stop it from where they are.

| #   | Platform / provider          | Paraphrase                                                                                                 |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| #7  | Win/Linux/Android, Nextcloud | Starts tracking on Android, but the desktop does not show it.                                              |
| #15 | Linux/Android, SuperSync     | Wants to start a task on one platform and stop it on the other.                                            |
| #74 | Win/Android, SuperSync       | Wants the running timer ("chrono") to sync when switching devices.                                         |
| #88 | Win/Linux/Android, SuperSync | Switches between phone and desktop all day, forgets to switch tracking on and off, so tracking is useless. |

Counter-evidence for the same principle ("less noise"): #2, #21 and #66 find
the timers intrusive or want tracking optional, and #72 does not want tracking
to start when the app opens. "Planning and time tracking" got 21 focus votes.
Three of the four askers use SuperSync, and all three are on a version that
already has a partial answer (§ 2): the gap may be discoverability, not
capability.

## 2. Current behavior

**The running task is per-device on purpose.**

- `setCurrentTask` is a non-persistent action. The reducer comment calls
  `currentTaskId` "unsynced" and moves the one synced side effect (reopening a
  done task) into its own `updateTask` op after #9904
  (`task.reducer.ts:284-290`).
- `loadAllData` drops `currentTaskId` and keeps it only as `lastCurrentTaskId`
  (`task.reducer.ts:187-209`). The snapshot used for sync, backup and import
  clears it too (`state-snapshot.service.ts:204-222`).
- **Why (inferred; no decision record states it):** a synced pointer would
  start a ticker on every device that loads the snapshot or replays the op.
  Two tickers would double-count, and a restored backup would start tracking
  on a device nobody touched. It is also one account-wide singleton, so every
  start and stop on two devices would be a concurrent write to one field.
  #9904 shows the cost of letting synced data ride on this action.

**Tracked time syncs as additive deltas.**

- Ticks (`addTimeSpent`) update local state only. Every 5 minutes and on
  stop, a persistent `syncTimeSpent {taskId, date, duration}` carries the
  delta (`time-tracking.actions.ts:72-92`, `task-time-sync.service.ts:18`).
  Remote deltas are added (`task.reducer.ts:251-275`).
- Deltas commute in conflict resolution (`conflict-disjoint-merge.util.ts:215-240`),
  so time tracked offline on two devices merges without loss.
- Two devices tracking the same task both add, so the overlap counts twice.
  #10378 (one device's time lost when tracking an unscheduled task on two
  devices) is fixed by #10462, released in v19.2.0.

**Live tracking presence already exists (opt-in, SuperSync only).**

- Shipped in v18.21.1 (#9771): `tracking-presence.model.ts:1-8`,
  `tracking-presence.service.ts:75-91`. A device that tracks broadcasts
  ephemeral, optionally E2E-encrypted frames over the SuperSync WebSocket.
  They are never persisted and never in the op-log; time stays on
  `syncTimeSpent`.
- Other devices show a header pill (silent Android notification:
  `RemoteTrackingNotificationHelper.kt:15-30`) with a CAS-guarded remote
  **Stop**.
- **Takeover:** when two devices track, the later-started session wins. The
  loser stops itself and shows a banner with "track here again"
  (`tracking-presence.service.ts:505-530`).
- Off by default: `isTrackingPresenceEnabled` in the SuperSync private config
  (`super-sync.model.ts:37-42`), labelled experimental
  ([wiki 3.08](../wiki/3.08-Sync-Integration-Comparison.md)).

So #15's "stop it on the other device" works today for SuperSync users who
find the setting. What is missing:

1. **Continue here.** The pill offers Stop, not "start this task here". Starting
   the same task locally already ends the remote session through the takeover
   rule, but only if both sockets are live.
2. **The pocketed phone.** The WebView's socket dies soon after the app is
   backgrounded, so viewers mark presence stale after 90 s and drop the Stop
   button (`tracking-presence.model.ts:94`, `RemoteTrackingNotificationHelper.kt:24-27`).
   The phone keeps accruing time natively and hands it to JS on resume
   (`android-foreground-tracking.effects.ts:756`).
   This is #88's day, and the case where time is actually wrong.
3. **File providers (#7).** No real-time channel. Tracked time arrives with
   the next sync; the running state never does.

## 3. Options

### A. Leanest: finish presence (no new synced state)

- Add a "Continue here" action on the pill and the Android notification:
  start the same task locally. The existing takeover stops the remote session,
  which flushes its last delta.
- **Pocketed phone:** when the phone reconnects, it already receives the
  server's cached presence and runs takeover. If the other device's session
  started after this one, the phone stops and shows the "moved" banner
  (`tracking-presence.service.ts:537`). Extend that banner with the overlap
  and an optional "Remove overlap" action (design in § 11).
- Drop the "experimental" label; keep presence opt-in (§ 11).

### B. A persisted per-device "stop request"

A synced, LWW stop command (`{targetClientId, stopAt}`) that the producing
device applies on its next sync, even after its socket died: stop and
truncate tracked time to `stopAt`. This works for file providers too, with
sync latency.

### C. Synced running session

Persist the running session (`{taskId, startedAt, clientId}`) so every device
shows and continues it, as Toggl does. This is the full "chrono sync" #74
describes.

## 4. Sync and persisted-model risks

| Risk                                  | A                                                                                                                                    | B                                                                                                                                                                                                                              | C                                                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replay determinism                    | Unchanged: presence dispatches only non-persistent actions (`tracking-presence.service.ts:89-90`). "Remove overlap" is one local op. | Applying a remote stop is an effect reacting to a remote op, which breaks "remote ops must not re-trigger effects". It would have to run as a check on hydration/resume, not as an effect.                                     | Every replay or import would resurrect a ticker unless the session is a fact ("started at") and each device decides locally whether to tick. That re-creates the hazard `currentTaskId` avoids. |
| Concurrent edits                      | Takeover is already deterministic (later `sinceTs`, then `sessionId`).                                                               | Two stop requests, or stop vs. a new start, need an ordering. A wall-clock `stopAt` across devices is skew-prone.                                                                                                              | Account-wide singleton: every start on two devices is a concurrent write to one field; LWW picks one, and the loser's ticks keep adding deltas.                                                 |
| Time attribution                      | Each device's deltas stay on its own logical day (`DateService`). Discarding subtracts only this device's overlap.                   | Truncation needs this device's accrual after `stopAt`, which it knows only if it keeps tick history.                                                                                                                           | Who owns the delta while the session moves? Needs a hand-off op plus deltas, i.e. B plus more.                                                                                                  |
| Offline                               | Presence is live-only; offline devices fall back to today's behavior.                                                                | Works with sync latency; a request arriving hours later truncates hours.                                                                                                                                                       | A device offline at start keeps its own state; divergence until sync.                                                                                                                           |
| Vector clocks                         | None.                                                                                                                                | New entity type or a field on an existing one; adds clock entries per stop.                                                                                                                                                    | Same, on every start/stop/switch: high op volume for a field that changes all day.                                                                                                              |
| Released clients                      | Old clients ignore presence frames and are never stopped by it (today's behavior).                                                   | Old clients do not know the action type. It is kept as an unknown code (`action-type-codes.ts:234`), but must be checked against validation on every released version. They never honor the stop: silent over-count continues. | Same as B, plus old clients that still own `currentTaskId` locally disagree with the synced session.                                                                                            |
| `UnsupportedMultiEntityConflictError` | None.                                                                                                                                | One declared entity if the request lives on its own record. Do not combine it with a time patch on the task in one op.                                                                                                         | Risky if start also touches the task (reopen, Today membership); must stay one entity per op.                                                                                                   |
| Persisted model / growth              | None.                                                                                                                                | A record per stop; needs a bound (one slot per target client, overwritten).                                                                                                                                                    | One slot account-wide, but a permanent model field.                                                                                                                                             |

Removing time in any option must not patch `timeSpentOnDay`: a field patch
does not commute with the other device's additive deltas
(`conflict-disjoint-merge.util.ts:215-240`). A negative `syncTimeSpent` is not
an option either: the client rejects it at capture
(`validate-operation-payload.ts:226`, since v18.15.0) and SuperSync rejects it
for unencrypted ops (`super-sync-server/src/sync/services/validation.service.ts:198`).
Use `removeTimeSpent` (`task.actions.ts:139-150`): one `TASK` entity, already
used by the idle dialog (`idle.effects.ts:218`), applied by released clients,
and treated as an additive time op (`conflict-disjoint-merge.util.ts:222-224`).
Its reducer clamps at 0 (`task.reducer.ts:489-510`), so conflict resolution
refuses a field-patch merge around it (`conflict-field-patch.util.ts:146`);
acceptable for one deliberate tap.

## 5. Platform limits

- **Android:** the tracking foreground service keeps the local ticker alive, but
  the WebView socket does not survive backgrounding, so the phone cannot
  receive a stop while pocketed. Only a native listener could change that, via
  WorkManager (15-minute floor, Doze) or FCM (not approved, see
  [push-based cancellation](../long-term-plans/android-background-sync-improvements.md#possible-improvement-push-based-cancellation)).
  Neither is real time.
- **iOS:** no background execution for the WebView at all, and background
  fetch is opportunistic. A tracking session on iOS ends or is reconciled only
  when the app runs (#10599 caps Pomodoro resume credit at session end, a
  related precedent).
- **Desktop:** always live while the app runs, so the desktop is the natural
  device to "continue here".

## 6. Rough cost

| Option                        | Effort                                                      | Ongoing cost                                       |
| ----------------------------- | ----------------------------------------------------------- | -------------------------------------------------- |
| A: Continue here              | 1–2 days (pill + notification action, E2E in presence spec) | None                                               |
| A: remove overlap on takeover | 2–3 days (banner action, overlap calc, E2E)                 | Small; no wire change                              |
| A: drop the experimental flag | A decision, plus docs                                       | Presence becomes a supported surface               |
| B                             | 2–3 weeks, plus sync E2E in both directions                 | Permanent wire surface; released clients ignore it |
| C                             | 4+ weeks; high risk                                         | Permanent model field; reverses a safe default     |

## 7. Prior art

Checked 2026-10 (vendor listings via search snippets, not hands-on):

| App      | Running timer across devices                                                                                                             | Source                                                                                                                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toggl    | Server-held running entry: start on desktop, stop on the phone. Timers stuck on a device that lost connection are a known support topic. | [App Store listing](https://apps.apple.com/at/app/toggl-zeiterfassung-stechuhr/id1291898086), [community](https://community.toggl.com/t/why-did-i-get-an-email-saying-my-timer-is-still-running/3207) |
| Clockify | Same server-held model ([scorecard](../market/scorecard.md#time-trackers-toggl-track-clockify)).                                         | scorecard 2026-10                                                                                                                                                                                     |

- **Take:** the "stop it from here" verb and the explicit hand-off.
- **Deliberately don't take:** a server-held running entry. It needs an
  account server as the source of truth, which file sync and offline-first
  rule out, and even Toggl has stuck timers when a device drops off.

## 8. Does it earn its place?

- **Demand:** four responses, three of them SuperSync users on versions that
  already ship presence. Check first whether they know the setting.
- **Principles:** presence is calm (silent channel, no sound) and opt-in. A
  and B add no setting. C reverses a deliberate local-only default for a
  feature that a vocal minority finds intrusive.
- **Market:** time tracking is must-be-best. Toggl's edge there is entry
  editing, not the cross-device timer (scorecard), so C does not close a
  scored gap.

## 9. Open questions

1. Did #15, #74 and #88 have presence enabled? (Ask in the survey Discussion;
   if not, discoverability is the fix.)
2. ~~Are negative `syncTimeSpent` deltas safe end-to-end?~~ Answered: they are
   rejected at capture and by SuperSync; use `removeTimeSpent` (§ 4).
3. ~~Should presence become default-on?~~ Decided: no (§ 11).
4. Is the remaining double count acceptable when two devices track the same
   task at once with presence off? (#10378's loss is fixed in v19.2.0; the
   double count is by design of additive deltas.)
5. File providers (#7): is "time shows up after sync" enough, given that no
   option short of B reaches them?

## 10. Recommendation

Build A's "Continue here" and the "Remove overlap" banner action (§ 11), and
drop presence's experimental label. Do not build C. Park B unless file-provider
users report over-counting from a forgotten phone after A ships. For a fix
in A, the existing E2E (`e2e/tests/sync/supersync-tracking-presence.spec.ts`)
is the place for the hand-off and stale-phone scenarios.

## 11. Decisions (2026-10-28)

- **Presence stays opt-in, drops "experimental".** Default-on was rejected on
  privacy grounds: without E2EE (off by default,
  `default-global-config.const.ts:247`) the server would see the running task
  live instead of every 5 min. The setting text says what the server sees, and
  the tracking UI points to it.
- **"Remove overlap" on the phone's "moved" banner.** Copy: `MOVED_TO` plus
  "This device also counted {{time}} of that period." Actions: "Remove
  overlap" (new), "Track here again" (existing); dismiss keeps the time.
  - Overlap = takeover moment minus the winner's `sinceTs`, capped by today's
    `timeSpentOnDay` and the logical day start. Shown only at 5 min or more.
  - Writes one `removeTimeSpent({id, date: logical today, duration})`; no wire,
    model or validation change. Never auto-trimmed (Toggl, Clockify, Harvest
    all default to keep).
  - Out of scope: an overlap across midnight (clamped to today), and a winner
    that already stopped before the phone reconnects (no takeover, no banner;
    manual edit).
  - Verify first in `supersync-tracking-presence.spec.ts`: native
    foreground-service time is in task state at takeover, or the amount is
    wrong.
- **Follow-up Discussion** (post after the survey closes): did #15, #74 and #88
  know presence existed?
