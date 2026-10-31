# Planning facts: evaluation

> **Status: Proposed** (evaluation only, nothing built)
>
> **Owner / tracking:** Unassigned. Related open issues: #10894, #9515, #9418, #4405, #8433, #6523.
>
> **Last verified against the code:** 2026-10-31 (`5a6d557`)
>
> **Removal condition:** delete once the recommended fix ships or is declined in an issue.

Sibling notes: [Planner/Schedule survey](2026-10-28-survey-planner-schedule.md),
[Finish week](2026-10-29-finish-week.md). Step 3 of the agreed order (an
optional, off-by-default AI "Help me plan today") gets its own plan and should
take the pure helpers below as its inputs.

## 1. Question

Should SP show a few deterministic, on-device "planning facts" where people
already plan (Planner, Schedule, Finish day → Plan tomorrow), and which ones?
No new surface, no persona, no alerts. Daily planning is a must-be-best
dimension ([market target](../market/README.md#target)), and SP is the only app
in the set with both estimates and real tracked time.

## 2. Verdict (short)

**Build almost nothing new. Fix the one fact SP already shows.**

- **Planned vs available** already exists in every Planner day header and in
  Plan tomorrow. Parents are counted on the wrong day (#10894, a reported
  bug): fix that. For **today** it also ignores the clock and counts timed
  items outside work hours; nobody has reported those, so they are a second,
  optional step once an issue shows someone hits them.
- **Estimate accuracy:** drop for the UI. No demand, and the data is biased:
  the default-on "estimate exceeded" banner offers "+30 min", which rewrites
  `timeEstimate` towards `timeSpent`.
- **Repeatedly postponed tasks:** drop. Nothing durable records it, and the
  real pain in the issues is overdue pile-up, which wants an action (#8433,
  #6523), not a counter.
- **Tasks without an estimate on a day:** the one cheap new fact worth keeping
  in reserve. Ship it only if someone asks why the total looks low.

## 3. What users already see

| Where                          | What                                                                                                                                                                                                                                                                                                                      | Source                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Planner day header (every day) | "Planned: 9h / Available: 8h" and a bar: green, amber over 80%, red over 95%. Just "Planned: 9h" if work hours are off.                                                                                                                                                                                                   | `planner-day.component.html:10-45`, `planner.selectors.ts:244-268`, `calculate-available-hours.ts`               |
| Finish day → Plan tomorrow     | The same `planner-day` for tomorrow, so the same bar. An `ESTIMATE_TOTAL` block is commented out.                                                                                                                                                                                                                         | `plan-tasks-tomorrow.component.html:12,44`                                                                       |
| Schedule                       | Fits untimed tasks around work hours, lunch, scheduled tasks, repeat projections and calendar events, from **now** for today. A "!" badge on each day header in the week view counts tasks that don't fit ("3 tasks do not fit into the available time"); the event tooltip says "This task does not fully fit this day." | `create-schedule-days.ts:122-152`, `get-tasks-within-and-beyond-budget.ts`, `schedule-week.component.html:15-35` |
| Work view header               | "Estimate remaining", "Working today", "Without break". No comparison with time left.                                                                                                                                                                                                                                     | `work-view.component.html:15-80`, `work-context.util.ts:40-61`                                                   |
| Finish day (daily summary)     | "Time Spent / Estimated" for today's worked-on tasks, tasks done, breaks, focus sessions.                                                                                                                                                                                                                                 | `daily-summary.component.ts:219-256`                                                                             |
| Metrics                        | Total time spent and total estimate (all tasks, no done filter), averages per day. No accuracy.                                                                                                                                                                                                                           | `metric.util.ts` (`mapSimpleMetrics`)                                                                            |
| Planner overdue                | Overdue tasks listed above today.                                                                                                                                                                                                                                                                                         | `planner-day-overdue`                                                                                            |
| Task row / detail              | Estimate progress per task; banner and notification when the estimate is exceeded (default on) with "+30 min".                                                                                                                                                                                                            | `task-ui.effects.ts:157-310`, `default-global-config.const.ts:217`                                               |

The market scorecard already lists "a day-by-day capacity view in the planner"
as an SP strength over Sunsama, Akiflow and Motion
([scorecard](../market/scorecard.md)). So candidate fact 1 is not new.

### Where the Planner capacity fact falls short

"Planned" = time left on undone tasks + repeat projections + scheduled tasks +
timed calendar events. "Available" = work end − work start − lunch. Adding
events to "planned" is the same as subtracting them from "available", so the
idea is right. The gaps:

1. **Today ignores the clock.** At 15:00 with work 9–17, today still shows
   8h available. Schedule uses `now`; Planner does not
   (`calculateAvailableHours(dayDate, cfg)` has no time input).
2. **Timed items outside the work window count.** A 19:00 calendar event, a
   timed task at 20:00, or (with gap 1 fixed) a 10:00 item already past add
   to "planned" against a 9–17 budget. Schedule only blocks inside the window.
3. **Parents are counted on the wrong day** (#10894, open bug). A parent's
   `timeEstimate` is already the sum of its subtasks' time left
   (`sumSubTaskTimeLeft`), and the Planner counts all of it on the parent's
   day, even for subtasks planned on another day or listed on the same day.
4. **Weekends get work hours too** (#9418, #9515: no work-days setting). Out of
   scope here; it needs a setting, which the issues should justify first.

Planner and Schedule therefore disagree about the same day. Fixing 1–3 makes
them agree without new UI. Only 3 has a report.

## 4. Demand

About 60 issue searches (titles and bodies, 2026-10-31). Reactions are low
everywhere; nobody asks for an estimate-accuracy view or a postpone counter.

| Topic               | Issues (reactions)                                                                                                                                            | Read                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Capacity            | #9515 per-weekday hours (0), #5247 per-day start/end/lunch (+2), #9418 7-day flow bug (0), #10894 parent double count (0), #8220 done repeats counted (fixed) | Weak but real. Bugs on the day totals show people read them as capacity.                 |
| Estimate accuracy   | #4853 overrun not always bad (+1), #5075 over-estimate reflection (closed: notification exists), #5501 auto-fill spent from estimate (+5)                     | Very weak. The asks are notifications (built) and non-tracker shortcuts, not statistics. |
| Postponed / overdue | #4405 make "Overdue" optional (+10), #8433 unschedule all overdue (+3), #6523 unschedule overdue (+2), #10534 add all overdue to today (0)                    | Moderate, but people want to clear the pile, not count it.                               |
| Other planning      | #8266 standup questions incl. "can I realistically finish today?" (0), #7316 finish-time forecast (0)                                                         | Scattered.                                                                               |

## 5. Prior art

Checked 2026-10-31 from vendor docs and help pages (third-party only where
marked).

| App            | Capacity at planning time                                                                                                                   | Estimate vs actual                                                              | Rolled-over tasks                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Sunsama        | Running workload total while planning; flags running past shutdown time ([guide][su1]; style unverified)                                    | Planned vs actual per task; a review view requested since 2020 ([roadmap][su2]) | Small numbered circle: consecutive days rolled over, passive ([help][su3]) |
| Akiflow        | Blocks on a calendar, no total. An opt-in over-scheduling warning is still a request; staff suggested a quiet progress bar ([request][ak1]) | None found                                                                      | None found                                                                 |
| Motion         | Auto-schedules; tasks past their deadline turn orange/red with a "Resolve issues" box ([help][mo1])                                         | None found                                                                      | Silently reschedules instead                                               |
| Amazing Marvin | Capacity meter and section totals; can learn your averages (opt-in strategy) ([docs][am1])                                                  | Estimated vs actual, end-of-day graph (opt-in) ([docs][am1])                    | Opt-in "procrastination count" "!" marks, count on hover ([help][am2])     |

**Take:** a passive total next to the day you are planning, against work
hours the user set. SP already has this; make it correct.
**Deliberately don't:** Motion-style red risk states and resolve dialogs
(alerts), Marvin-style procrastination marks and "most procrastinated" lists
(shame loop, and a new synced counter), learned averages (complexity, and our
estimate data is biased, § 6.2).

## 6. The facts, one by one

All facts below are derived at render time. None is stored, so none adds
persisted fields, op types, sync wire or plugin API.

### 6.1 Planned vs available — keep, fix

- **Exists?** Yes (§ 3), with gaps 1–3.
- **Data:** existing tasks, repeat configs, calendar events, `ScheduleConfig`.
  Day keys already use `startOfNextDayDiffMs` in the selector.
- **Where:** unchanged: Planner day header and Plan tomorrow. Same label, same
  bar.
- **Calm:** no new text or notifications. With step 2 (§ 7), today's bar
  will turn amber or red later in the day as time runs out. That is the fact
  being true, but it is a visible change; it stays a passive bar.
- **Cost:** small. The #10894 fix; optionally a time input for today and
  clipping. No persistence.
- **Verdict:** keep. This is the recommended work.

### 6.2 Estimate accuracy ("you usually take ~1.3× your estimates") — drop

- **Exists?** No. Only per-task progress and today's "Time Spent / Estimated".
- **Data:** done leaf tasks with `timeEstimate > 0` and `timeSpent > 0`. Most
  history is in the archive, which is not in NgRx: an async
  `TaskArchiveService.load()` per view.
- **Why drop:**
  - **Biased input.** The default-on "estimate exceeded" banner offers "+30
    min" (`task-ui.effects.ts:305`), which overwrites `timeEstimate` with
    `timeSpent + 30m`. Users who click it look accurate by construction. The
    original estimate is not kept anywhere, and keeping it would be a new
    persisted field.
  - **No demand** (§ 4). #4853 even argues overruns are not a problem to flag.
  - It tips towards a score, which the product principles avoid.
- **Kept for step 3:** if the AI plan wants it, it can compute the ratio
  itself from the same data, labelled as rough. No UI here.

### 6.3 Tasks repeatedly pushed to the next day — drop

- **Exists?** No.
- **Data:** none durable. Tasks have `dueDay` / `dueWithTime` but no original
  date or move count. The op log does record reschedules, but synced ops are
  pruned after 7 days (`src/app/op-log/core/operation-log.const.ts:146`), and a
  local-only log is not a dependable record either. `created` age is a weak
  proxy (old tasks are often just backlog).
- **What it would need:** a persisted counter or first-planned date on the
  task. A counter is an unbounded synced field that two devices increment
  concurrently (LWW loses an increment), and it needs optional-field handling
  on every released client. Not worth it for a fact nobody asked for.
- **Better lever:** the demand is overdue pile-up (#4405 +10, #8433 +3, #6523
  +2). A bulk "unschedule overdue" action addresses it directly. That is a
  separate decision, outside this plan.

### 6.4 Tasks without an estimate — reserve

- **Exists?** No. Unestimated tasks add 0 to "Planned", so a day of ten
  unestimated tasks reads as "Planned: 0m".
- **Data:** the tasks the selector already has for the day; a count of undone
  leaf tasks with no estimate and no time spent. Pure, no archive.
- **Where:** the same day-load line, only when the count is above zero, e.g.
  "Planned: 2h (+3 unestimated)". One new translation key.
- **Calm:** passive text; nothing when every task has an estimate.
- **Verdict:** keep in reserve. It is cheap, but adds text to many days for
  people who never estimate. Build it only if a user reports the total as
  misleading, or if step 3 needs the count (it can use the helper without UI).

### 6.5 Other ideas checked

- **Finish time for today** ("done around 18:30", #7316): Schedule already
  shows this visually. Drop.
- **"N overdue":** already listed in Planner. Drop.
- **Typical tracked time per weekday** from the worklog: reporting, not
  planning. Drop.

## 7. Recommended work

No persistence, no op or sync-wire change, no plugin API. Selectors produce no
ops, so a clock input does not affect replay.

**Step 1 (minimum, reported bug): #10894.** In the planner selector, a parent
counts the time left on its undone subtasks that are neither planned on
another day nor listed on the same day themselves. This covers both variants
in the issue (A: parent planned for tomorrow, subtask planned elsewhere; B:
parent and subtask both on the day). Specs for both variants go next to
`planner.bug-8220.spec.ts` and `planner.bug-8232.spec.ts`.

**Already done in open PR #10923** (community, 2026-10-18), which this plan
first missed. Checked 2026-10-31: it applies cleanly to master (`5a6d557`), its
`planner.bug-10894.spec.ts` fails without the fix (7 of 9) and passes with it,
`test:affected` and `checkFile` pass. Step 1 is reviewing and merging it, not a
new fix.

**Step 2 (optional, open an issue first): make today's numbers true.**

1. **Pure helper** `getDayCapacity({ dayDate, scheduleConfig, timedItems, nowMs? })`
   in `src/app/features/planner/util/`, returning `{ availableMs, timedInWindowMs }`:
   - available = the work window minus lunch, starting at `max(workStart, now)`
     when the day is the logical today, else the whole window;
   - every timed item (calendar events, `dueWithTime` tasks, timed repeat
     projections) clipped to that window, overlaps counted once;
   - an invalid `workStart`/`workEnd` (corrupt synced config, #5358) returns
     `undefined`, so the header falls back to "Planned: X" as today.
   - It replaces `calculateAvailableHours`. Its unreachable `!isWorkStartEndEnabled`
     branch goes; the `catch` stays as the invalid-config path.
2. **After work end** today: available is 0, so show the planned total with a
   full red bar instead of today's empty green one (the `availableHours > 0`
   guard gives 0%).
3. **Where the clock goes:** not into `selectPlannerDays`. It is a factory
   rebuilt inside `switchMap` (`planner.service.ts:89-120`) and called with
   positional args by about 20 specs. Instead, the service adjusts only
   today's `availableHours` and `progressPercentage` after the selector, on
   the existing `GlobalTrackingIntervalService` tick throttled to 5 minutes,
   and only when work hours are on. "Today" comes from `DateService`
   (`todayStr`, `getStartOfNextDayDiffMs()`), not raw midnight.
4. **Docs:** one line in the Planner wiki section: "For today, available time
   counts from now until work end."

The helper is also the capacity input for step 3 of the agreed order (AI
plan).

**Tests**

- `getDayCapacity`: before, during and after work hours; lunch before/after
  now; timed items inside, outside and straddling the window; overlaps; work
  hours off; invalid config; a custom `startOfNextDayDiffMs` (after midnight,
  before day start, "today" is still yesterday's date).
- Service spec: today at 15:00 with 9–17 shows 2h available; a 19:00 event
  does not add to planned; after 17:00 the bar is red, not empty.
- Update the existing `planner.selectors.spec.ts` and bug specs where the
  numbers change. No E2E: no sync, no new interaction. Check one Planner day
  header by hand on desktop and at phone width.

**Leaner alternative:** step 1 only. It is the only gap anyone reported.

## 8. Out of scope

Work days / per-weekday hours (#9418, #9515), bulk unschedule overdue (#8433,
#6523), estimate history, postpone counters, any AI.

## 9. Review

Fresh-context review against the [feature review guide](../feature-review-guide.md)
(2026-10-31). Code refs, issue states and reaction counts checked out;
"no persisted, sync or plugin-API cost" holds.

Fixed:

1. The #10894 fix was wrong (it gave 0 in the issue's variant A). Restated as
   the issue asks, with specs for both variants (§ 7 step 1).
2. "Returns a parent's full estimate" was misleading: the parent estimate is
   already the sum of subtask time left. Gap 3 now says the bug is the day it
   is counted on.
3. Only events were clipped; timed tasks and repeat projections now are too.
4. "Only the numbers change" was not true: today's bar now changes colour in
   the afternoon, and after work end it was an empty green bar. Both stated,
   after-hours result defined.
5. Removing the 8h fallback would also remove the invalid-config path
   (#5358). The `catch` stays, returning `undefined`.
6. Earn-its-place: gaps 1–2 have no report. Minimum scope is now #10894 only;
   gaps 1–2 are an optional step behind an issue.
7. A clock in `selectPlannerDays` would rebuild the selector factory and
   break ~20 positional-arg specs. The clock now applies in the service, to
   today only, on the existing tracking tick, via `DateService`.
8. Compaction wording: only synced ops are pruned.
9. "Week badge" → per-day header badge.
10. Prior art had 7 apps; the lumped Todoist/TickTick/Things row is gone.
11. Tests now name the existing specs to update and a phone-width check.
12. Rationale moved out of the § 7 spec bullets.

Not fixed: none.

[su1]: https://sunsama.com/blog/the-official-daily-planning-guide
[su2]: https://roadmap.sunsama.com/improvements/p/compare-actual-time-vs-planned-time
[su3]: https://help.sunsama.com/docs/task-basics
[ak1]: https://akiflow.featurebase.app/p/warning-during-morning-ritual-of-over-scheduling
[mo1]: https://help.usemotion.com/product-and-feature-guides/calendar/tasks/understanding-the-resolve-issues-box-in-motion
[am1]: https://amazingmarvin.com/features/time-estimates
[am2]: https://help.amazingmarvin.com/en/articles/1950154-procrastination-count
