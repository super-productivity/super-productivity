# Survey 2026: bringing Planner and Schedule closer

> **Status: Proposed**, direction decided 2026-10-28 (§ 11); nothing scheduled, the survey is still open
>
> **Owner / tracking:** Unassigned; related open issues #10853, #5614, #8132.
>
> **Last verified against the code:** 2026-10-28 (`79c678aab9`)
>
> **Removal condition:** delete once a decision is recorded in an issue.

Sibling notes: [mobile background sync](2026-10-28-survey-mobile-background-sync.md),
[cross-device time tracking](2026-10-28-survey-cross-device-time-tracking.md).
Survey references (`#N` = 0-based CSV row, paraphrased, counts are responses)
as explained in the first sibling note.

## 1. Problem

Users plan days in Planner and time-block in Schedule, and the two do not
meet. Schedule pre-places untimed tasks; Planner cannot place a task at a time
without a dialog. Newcomers do not know which view is for what.

| #   | Platform / provider      | Paraphrase                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #36 | Win/mac/Android, Dropbox | Schedule auto-places tasks without a time, sometimes over calendar events, which makes drag and drop hard. Wants them in a box above the day to drag into place, and Planner/Schedule combined. Uses Planner instead, but dropping between agenda items asks for a time in a dialog. Wants inline edit in Planner. |
| #75 | mac/iOS, SuperSync       | Planner and Schedule are too separate: wants to schedule while on Planner, drag from Planner to the Schedule side panel, and see deadlines and overdue tasks in Schedule. No single place to see the week's tasks and place them precisely.                                                                        |
| #40 | mac/Linux/Android        | Planner vs. Schedule was hard to understand.                                                                                                                                                                                                                                                                       |
| #47 | macOS, no sync           | Planner vs. Schedule vs. Today, and deadline vs. scheduled date, were confusing.                                                                                                                                                                                                                                   |
| #31 | Win/Linux/Android        | Uses SP as a time-blocking calendar; it works, through repeatable tasks, but is cumbersome.                                                                                                                                                                                                                        |

Related: #30 found scheduling from a task list hard in the first week; #93
wants a daily timeline widget on Android; #89 finds the mobile Planner
wasteful (an add row per day). "Planning and time tracking" got 21 focus
votes. Open issues: #10853 (drag from a deadline card to schedule work),
#5614 (+2, inbox in the Planner), #8132 (+7, completed tasks in both).

## 2. Current behavior

- **Schedule flows untimed tasks.** Starting at work start, tasks are laid out
  back to back by remaining estimate
  (`create-schedule-view-entries-for-normal-tasks.ts:9-46`). Beyond the current
  week, unscheduled tasks are dropped (`create-schedule-days.ts:61-70`).
  There is no setting to stop this: `ScheduleConfig` holds only work hours and
  lunch (`global-config.model.ts:282-289`).
- **Calendar events already block the flow.** Non-all-day events become blocker
  blocks that flowing tasks are pushed around
  (`create-sorted-blocker-blocks.ts:301-345`, plugin events included via
  `calendarEvents$`). So #36's overlap is **not reproduced from the code**.
  Candidates: the calendar plugin not set up on that device (#36 mentions
  installing it per device), all-day events, or "overlap" meaning that the morning fills up.
- **Deadlines are in Schedule since v19.3.0** (2026-10-23, #10310): week header
  badges and the day panel use `selectUndoneDeadlineTasksByDay`
  (`schedule.component.ts:361`, `schedule-day-panel.component.ts:188`). Overdue
  tasks are not shown in Schedule; Planner has `planner-day-overdue`.
- **Planner drops.** A drop on a day's list plans the task for that day
  (`Plan Task for Day`, one `PLANNER` entity, `planner.actions.ts:71-84`). A
  drop on the scheduled section reschedules only tasks that already have a
  time; everything else opens `DialogScheduleTaskComponent`
  (`planner-day.component.ts:133-137`, `:170-185`).
- **The Schedule day panel accepts external drags.** In the right or bottom
  panel, it takes a dragged task at a pointer time
  (`schedule-day-panel.component.ts:115-127`, `:214-222`), through
  `ScheduleExternalDragService`. Only regular task lists feed that service
  (`task-list.component.ts:128`); Planner cards do not, so #75's
  Planner → panel drag does not work.
- **Placing at a time** is `scheduleTaskWithTime`: one `TASK` entity
  (`task-shared.actions.ts:272-286`), and the planner reducer reacts to it.

## 3. Prior art

Checked 2026-10 from vendor docs and the market scorecard (search snippets,
not hands-on):

| App      | Untimed tasks next to the timeline           | Drag into a time slot                        | Auto-placement                                   | Source                                                                                                                                                                                       |
| -------- | -------------------------------------------- | -------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TickTick | "Arrange tasks" panel beside the calendar    | Yes, from the panel; week view sets duration | No                                               | [blog](https://blog.ticktick.com/2018/08/10/arrangetasks4ios/), [calendar quickstart](https://blog.ticktick.com/2020/11/30/ticktick-calendar-quickstart/)                                    |
| Todoist  | "Plan" sidebar in Upcoming (calendar layout) | Yes (paid); adds a 15 min default duration   | No                                               | [calendar layout](https://www.todoist.com/help/articles/use-the-calendar-layout-in-todoist-lPHRQTu0o), [time blocking](https://todoist.com/help/articles/time-blocking-in-todoist-d6Pf1uTpc) |
| Sunsama  | Day's task list beside the calendar          | Yes (timeboxing)                             | Rule-based, asks "Overcommitted?"                | [scorecard](../market/scorecard.md#daily-planners-sunsama-akiflow-motion)                                                                                                                    |
| Motion   | n/a                                          | n/a                                          | Continuous AI; users complain that it reshuffles | scorecard                                                                                                                                                                                    |

- **Take:** a tray of the day's untimed tasks next to the timeline, and drag
  into a slot with the estimate as the duration (TickTick, Todoist).
- **Take:** an "over capacity" signal instead of silent placement (Sunsama);
  SP already counts beyond-budget tasks per day.
- **Deliberately don't take:** continuous auto-scheduling (Motion); it is the
  opposite of "calm default" and users dislike the reshuffling.
- **Deliberately don't take:** a third planning page; every app above uses
  one view with two panes.

## 4. Options

### A. Leanest: let Planner cards drag onto the Schedule panel

Feed `ScheduleExternalDragService` from planner task cards, so a card from
the Planner can be dropped on the day panel at a time, with no dialog. Show
overdue tasks in the day panel's existing deadline area. No new view, no
setting. Answers #75's drag and #36's dialog complaint.

### B. Reshape Schedule: a tray instead of auto-flow

Render each day's untimed tasks in a strip above the day column (week view)
and the day panel, with a capacity line ("3 h planned, 2 h free"), instead of
flowing them into the grid. Drag from the strip into a slot (=
`scheduleTaskWithTime`). The current week keeps today's tasks in the strip
too; the "does my day fit" signal moves from geometry to the capacity line.
Decided as a setting, not a replacement (§ 11). Planner stays for multi-day
list planning; Schedule becomes the place for times.

### C. Merge into one "Plan" page

A single page with a day/week list (Planner) and a time grid (Schedule) as
two panes or a view switch. This removes one navigation entry and the
Planner/Schedule question for newcomers (#40, #47).

## 5. Sync and persisted-model risks

All three are view changes that dispatch actions that already ship:
`scheduleTaskWithTime` (one `TASK` entity) and `Plan Task for Day` (one
`PLANNER` entity).

- **Replay determinism:** unchanged. The tray, capacity line and overdue list
  are selectors; "today/overdue" must go through `isTodayWithOffset` with
  `startOfNextDayDiffMs`, as the planner selectors do.
- **Concurrent edits:** a drop is the same op as today's dialog path, so it
  has the same conflict behavior (task-field LWW). No new crossing, so no path
  to `UnsupportedMultiEntityConflictError`. Do not introduce a combined
  "plan + time + reorder" action; dispatch the existing single-entity ones.
- **Vector clocks:** no new entity types.
- **Released clients:** unaffected; they render the same task fields their own
  way. A task timed in the new UI shows up as a timed task in old Planner and
  Schedule versions.
- **Persisted model:** none for A. B as a setting adds one optional
  `ScheduleConfig` field with a runtime default of today's flow (rule 11). C may move a navigation or
  default-view setting into `globalConfig`. That would be a new optional field
  with a runtime default, and it should be avoided if the old routes can
  redirect.
- **Duration on drop:** use the remaining estimate, as the flow does. Writing a
  default estimate on drop (Todoist's 15 min) would be a new synced field
  write per drop; avoid it.

## 6. Platform limits

- **Mobile:** drag across panes needs room. On phones, the day panel is the
  bottom panel (`bottom-panel-container.component.html:40`), and #89 already
  finds the mobile Planner cramped. A long-press "Set time" in the tray may be
  the phone equivalent of drag; this needs a wireframe before choosing.
- **Touch drag** into the day panel already has special handling
  (`schedule-day-panel.component.ts:127-131`); reuse it, don't fork it.
- **No background constraints** (WorkManager, iOS fetch) apply. #93's timeline
  widget would, and is out of scope here.

## 7. Rough cost

| Option | Effort                                                                | Ongoing cost                                                                                               |
| ------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| A      | 3–5 days (drag source, overdue section, E2E in `e2e/tests/schedule/`) | Low                                                                                                        |
| B      | 2–3 weeks (week, day panel and mobile; flow/blocker specs rewrite)    | Medium; replaces a mature layout algorithm's role                                                          |
| C      | 4–8 weeks (routes, nav, mobile bottom nav, keyboard plan, docs, E2E)  | High; must be reconciled with the [planner keyboard navigation](2026-09-12-planner-keyboard-navigation.md) |

## 8. Does it earn its place?

- **Demand:** two detailed responses (#36, #75), two confusion reports (#40,
  #47), one time-blocking user (#31), plus open issues with modest reactions
  (#8132 +7, #5614 +2). Moderate, consistent, and all pointing the same way.
- **Principles:** A and B reshape existing views and make users faster; B as
  decided adds one setting, justified by diverging workflows (§ 11). C adds churn for everyone to fix confusion that better naming and
  docs might fix more cheaply.
- **Market:** daily planning is must-be-best; the scorecard gap is rituals and
  two-way Outlook, not drag-to-slot. Drag-to-slot is table stakes that SP
  half-has (task lists to the panel).
- **Already shipped:** deadlines in Schedule (v19.3.0) answer part of #75. The
  survey ran 4–5 days after that release, so #75 may not have had it yet (iOS
  rollout lag).

## 9. Open questions

1. ~~Does flowing untimed tasks have defenders?~~ Settled by a setting (§ 11).
   Was: does flowing untimed tasks have defenders? The capacity view it gives is
   real. Ask in the survey Discussion before B removes it; if users split,
   prefer flowing only today and a tray for other days over adding a toggle.
2. Can #36's overlap be reproduced with calendar events loaded? If yes, it is
   a bug in the blocker path, separate from this design.
3. Is the Schedule day panel reachable on the Planner page on desktop and
   mobile? A only helps if both are visible at once.
4. ~~Would renaming help~~ Decided: explainers, no rename (§ 11). Was: would renaming help (e.g. "Plan" / "Timeline") and a one-line explainer on
   each page fix #40 and #47 without C? Cheap to try first.
5. Should overdue tasks in Schedule be a list (like Planner) or placed on
   today? Placing them would be auto-flow again.

## 10. Recommendation

Build A now; it is small, risk-free for sync, and closes #75's drag and #36's
dialog complaints. Add the one-line explainers for #40 and #47 alongside it. Wireframe B's tray
mode (desktop week, day panel, phone), then build it as a setting (§ 11). Do
not build C unless A and B ship and confusion reports continue.

## 11. Decisions (2026-10-28)

- **Untimed tasks in Schedule: a setting.** "Tasks without a time": placed
  automatically (default, today's flow) or kept in a tray with a capacity
  line. Workflows really diverge here (time-blockers #31, #36 vs. "does my day
  fit"), which is when the principles allow a setting. Flow code stays
  untouched; tray mode is the new layout. One optional `ScheduleConfig` field.
  Wireframe the tray (week, day panel, phone) before building.
- **A ships alongside:** Planner cards draggable onto the Schedule day panel,
  overdue tasks in the panel.
- **Naming: explainers, no rename.** One subtitle line per page (Planner =
  which day, Schedule = what time; also deadline vs. scheduled date). A rename
  churns docs and screenshots, and other languages would lag.
- **C declined.**
