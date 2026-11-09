# Time overview — "where did my time go?"

> **Status: Proposed.** Slice 1 is implemented on this branch; everything else
> is a design or a recommendation to decline.
>
> **Tracking:** #2034, #614, #7353 (and the open PR #10440 for #7353).
>
> **Last verified against the code:** 2026-11-09 (`3d2cdcf`).

The hypothesis tested: one saved-views building block plus a better worklog
export answers #2034 (time per project), #614 (worklog view alternatives) and
#7353 (All Tasks) without three new screens or a reporting dashboard.

**Result: half right.** The three issues are two different problems. #7353 is
about _open tasks_ and saved views already answer it. #2034 and #614 are about
_tracked time in the past_; views cannot answer that (they read the live task
store, not the archive) and should not be stretched to. A small addition to
the existing export dialog answers the core of both. No new persisted state is
needed for any of it.

## Demand

Read 2026-11-09 from the issues and their comments.

| Issue | Open since | Reactions (👍) | Distinct people asking | What they ask to do                                                                                                                    |
| ----- | ---------- | -------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| #2034 | 2022-04    | 9              | 4                      | "Of all tracked time this day/week/month: 40 % A, 30 % B, 30 % C." "I need to declare the number of hours spent by project by week."   |
| #614  | 2020-10    | 11 (+3 🎉)     | 5                      | "What did I work on last week?" "How much did I work this week compared with others?" "How much time on project X, and on which days?" |
| #7353 | 2026-04    | 13             | 8                      | "See all tasks of all projects in one list", optionally limited to some projects, reachable like Today and Inbox.                      |

The concrete questions, in the users' words where possible:

1. **How many hours did I spend on each project last week / month?** (#2034
   author, #2034 and #614 "declare hours by project by week … the only reason
   I cannot completely switch from Toggl", #614 author.) This is the strongest
   single ask: it appears in both time issues and one user names it as a
   blocker.
2. **What share of my time went to each project?** (#2034: percentages, pie
   chart.)
3. **What did I work on in a given week?** (#614.)
4. **How much did I work this week or month, and on average per day?** (#614.)
5. **A fixed calendar grid, or an hour-by-hour timeline per weekday** (#614
   author's second mock-up; one commenter points at Clockify's time tracker).
6. **How much time do I _plan_ for each project today or this week?** (#2034,
   one commenter.)
7. **One list of every open task across projects** (#7353).

**Survey:** the [survey plan](2026-10-27-user-survey.md) has no question about
reports or the worklog. Q5 lists Worklog and Time tracking among features to
miss, and Q10 offers "Planning and time tracking" as a focus, which got 21
votes according to the
[survey notes](2026-10-28-survey-cross-device-time-tracking.md). The raw
answers are not in the repository, so the survey supports "time tracking
matters" and nothing more specific. It is not evidence for a reporting view.

**Market:** time tracking is a must-be-best dimension and its scope includes
"personal reports, export" ([market target](../market/README.md#target)). The
[scorecard](../market/scorecard.md) records start and end times per entry as
the open gap against Toggl and Clockify (#7888, #7890), not reports.

## What exists today

| Question                                 | Answer today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Hours per project for a week or month | **Only by hand.** History on Today covers all projects ([get-complete-state-for-work-context.util.ts:17](../../src/app/features/worklog/util/get-complete-state-for-work-context.util.ts)) and exports a week, a month or everything ([history.component.ts:121-153](../../src/app/features/history/history.component.ts)). The export has a Projects column but groups only by date, task, parent task or worklog entry ([worklog.model.ts:76-81](../../src/app/features/worklog/worklog.model.ts)), so the user pivots in a spreadsheet, or opens each project's own History and reads its week total. |
| 1, for one day                           | **Yes.** Finish Day lists each project with its time today ([task-summary-tables.component.html:19-31](../../src/app/features/tasks/task-summary-tables/task-summary-tables.component.html)).                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2. Share per project                     | **No.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3. What did I work on that week          | **Yes.** History lists year, month, week and day with tasks and time ([history.component.html](../../src/app/features/history/history.component.html)); the current week is on Finish Day ([worklog-week.component.ts](../../src/app/features/worklog/worklog-week/worklog-week.component.ts)).                                                                                                                                                                                                                                                                                                          |
| 4. Totals per week and month             | **Yes** for totals and days worked ([worklog.model.ts:21-43](../../src/app/features/worklog/worklog.model.ts)); averages per day are on the Metrics page ([metric.component.html](../../src/app/features/metric/metric.component.html)), which also has an activity heatmap.                                                                                                                                                                                                                                                                                                                             |
| 5. Calendar grid, hour timeline          | **No.** Time is stored per task per day (`timeSpentOnDay`), not as entries with a start and end, so an hour timeline has no data to draw.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 6. Planned time per project              | **No.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 7. All open tasks across projects        | **Yes, with saved views (#11349).** A view section with no project rule matches every project: the project check only runs when `projectIds` is set ([task-criteria.ts:151](../../src/app/features/tasks/task-criteria/task-criteria.ts)). A commenter on #7353 built this by selecting every project, which shows the default is not obvious.                                                                                                                                                                                                                                                           |

Two limits of saved views matter for the hypothesis:

- Views read `selectAllTasksInActiveProjects`
  ([board-panel.component.ts:394](../../src/app/features/boards/board-panel/board-panel.component.ts)):
  no archived tasks, no archived projects. Tracked time lives mostly in the
  archive.
- The `timeSpentRule` is a minimum of total time on a task
  ([boards.model.ts:62](../../src/app/features/boards/boards.model.ts)). It
  has no date range and views have no totals.

## Prior art

Sources: the [scorecard](../market/scorecard.md) (vendor docs, read 2026-10)
for the plan and price facts; the report shapes below are from memory of the
vendors' documentation and were **not re-read this month**, and the TickTick and "paid" cells have no source
in the scorecard — check before relying on a detail.

| App         | Time per project for a range                            | Chart           | Saved reports |
| ----------- | ------------------------------------------------------- | --------------- | ------------- |
| Toggl Track | Summary report: pick range, group by project, totals    | Bar and donut   | Yes (paid)    |
| Clockify    | Summary report, same shape; free plan capped at 31 days | Bar and donut   | Yes           |
| TickTick    | Focus statistics per list; no worklog or export         | Yes             | No            |
| Todoist     | None (no time tracking)                                 | Karma (streaks) | —             |

- **Take:** range first, then a plain list of project, time and share. That
  list is what the "declare my hours" user copies from; in both trackers it is
  the table under the chart, not the chart.
- **Deliberately don't:** a reports screen with its own navigation entry
  (principle 2: not a reporting tool); charts for the breakdown (principle 3:
  no vanity dashboards — the table carries the same numbers); saved or
  scheduled reports (new synced state for a question asked once a week);
  streak or goal framing.

## Design

### The building block is the export dialog, not a view

Every time question above starts from a range the user has already picked in
History (a week, a month, everything) and ends in the export dialog. The
dialog already loads the tasks of that range with their time limited to the
range, across the archive, for the current context. Adding the per-project sum
there puts the answer one click after the range, with no new screen, route,
setting or stored value.

**Flow for question 1 and 2:** Today → History → the week's or month's export
button → expand **Time per project**. Three steps, all keyboard reachable
(the section header is a focusable button, Enter or Space toggles it).

### Saved views stay a tool for open tasks

Views answer #7353 as they are. They should not grow a "history" or "report"
mode: that needs archive loading in a live list, totals, a date range on time,
and it would make write-back on drop meaningless for archived tasks. That is a
second product inside the views engine for a need the export dialog covers.

### Long-term cost

Slice 1 adds no persisted field, no action, no effect and no op. It reads
existing data and derives the totals in a pure function.

Anything later that would touch stored data follows these constraints (see
[persisted-model-fields.md](../sync-and-op-log/persisted-model-fields.md) and
the [contributor sync model](../sync-and-op-log/contributor-sync-model.md)):

- `worklogExportSettings.groupBy` is persisted on every project and tag
  ([work-context.model.ts:41](../../src/app/features/work-context/work-context.model.ts))
  and typed as the closed `WorklogGrouping` enum. A new member (for example
  `PROJECT`) is a new stored word that a released client's validation rejects.
  There is a per-field heal that resets an invalid `groupBy` to the default
  ([auto-fix-typia-errors.ts:313-337](../../src/app/op-log/validation/auto-fix-typia-errors.ts),
  #8279), but which releases contain it was **not verified** here (shallow
  clone; check with `git tag --contains`). Until then, a "group by project"
  choice must stay dialog-local and never be saved.
- Any new view rule is a new optional field or a new word for an existing
  string field, never a new meaning for an old one (the locked vocabulary in
  the [saved-views plan](2026-10-30-saved-views.md)). No schema bump.
- No "saved report" entity. If one were ever justified it would be optional
  plain-typed fields on the existing export settings, changed by the existing
  single `updateWorklogExportSettingsForCurrentContext` call (one intent, one
  op), with no list of report ids anywhere. Growth bound: one settings object
  per context, which already exists. Recommendation: do not build it.

## Slices

1. **Time per project in the export dialog — done on this branch.**
   - [worklog-project-totals.util.ts](../../src/app/features/worklog/worklog-export/worklog-project-totals.util.ts):
     `getProjectTotals(tasks, projects)` sums `timeSpentOnDay` per project.
     Parents with subtasks are skipped (their time is the sum of their
     subtasks, the same rule as the export's date grouping); a subtask counts
     for its parent's project, as in History; tasks without a project share a
     "Without Project" row; sorted by time, then title; each row carries its
     share. A task pointing at a deleted project is not handled: the existing
     row building throws on it first
     ([worklog-export.util.ts:271-273](../../src/app/features/worklog/worklog-export/worklog-export.util.ts)),
     which is older than this change and left alone.
   - [worklog-export.component.html](../../src/app/features/worklog/worklog-export/worklog-export.component.html):
     a collapsed **Time per project** section (project, time, share) between
     the table and Options. It is rendered only when there are at least two
     rows (the "Without Project" row counts), so a single project's export
     does not show it.
   - One new string (`F.WORKLOG.EXPORT.TIME_PER_PROJECT`, `en.json` only), one
     line in the [Worklog wiki note](../wiki/4.21-Worklog.md).
   - Tests: `worklog-project-totals.util.spec.ts` (7),
     `worklog-export.component.spec.ts` (2 new, one expands the section and checks the rows). Not covered: an E2E, and the
     section was not looked at in a running app.
   - Known limits: totals use raw time and ignore the dialog's rounding
     option; the totals are read or copied from the dialog and are not part of
     the CSV.
2. **Document "all tasks" as a view — docs only.** Add a short how-to to the
   wiki: new view, no rules, layout List. No code.
3. **Only if asked after slice 1 ships: per-project rows in the CSV.** A
   dialog-local "group by project" that is never written to
   `worklogExportSettings` (see Long-term cost). Skip unless a user needs the
   file and not the numbers.

## Out of scope — recommended declines

- **A pie or bar chart for the project breakdown** (#2034). The share column
  gives the same information; a chart here is the dashboard the product
  principles rule out.
- **A separate All Tasks page** (#7353, PR #10440). A rule-less view is the
  same list with the same rows, and a second page means a second App Features
  toggle, route and set of list behaviours to maintain. What the commenters
  still miss with views is reachability (pin a view high in the menu, find it
  fast), which is a views question, not a new page.
- **A calendar grid of the worklog and an hour-by-hour week timeline** (#614).
  The timeline needs start and end times per entry, which is its own tracked
  gap (#7888, #7890). A grid of empty days answers no question the week list
  does not. Follow the triage note on #614: split it; the per-project part is
  answered by slice 1.
- **Planned time per project** (#2034, one commenter). One request, and it is
  planning, not history; the planner and schedule already show load per day.
- **Saved, scheduled or shareable reports; team or billing reports.** Not a
  reporting tool. Users who need more have the CSV with a Projects column, and
  plugins can read `getTasks()` and `getArchivedTasks()` with per-day time
  ([plugin-api types.ts](../../packages/plugin-api/src/types.ts)) to build any
  chart they like.
- **History inside saved views.** See Design.

## Open decisions

1. **Is the export dialog the right home, or should the totals sit on the week
   and month rows of History?** Recommendation: ship the dialog version. It
   costs nothing permanent. If users do not find it, render the same function's
   result as a collapsed section on the week and month headers; that also needs
   no stored state.
2. **Close #10440 in favour of views?** Recommendation: yes, and say why on the
   PR before the author spends more time (the maintainer's comment of
   2026-11-06 already flags the question). Pair it with slice 2.
3. **Does the view editor need to show "all projects" explicitly?** One #7353
   commenter selected every project by hand. I did not check how the editor
   presents an unset project rule; if it shows nothing, that is expected by
   design (the editor lists only the rules that are set) and the how-to in slice 2 is the
   leaner fix. Recommendation: docs first, no editor change.
4. **Totals per tag as well?** Not built. Tags overlap, so shares would not add
   up to 100 %, and nobody in the three issues asks for it. Recommendation:
   wait for a request.
5. **Should totals follow the rounding option?** Recommendation: no. Rounded
   per-task values summed per project drift from the real total; the user
   declaring hours can round the handful of project totals themselves.
6. **What to do with the issues?** Recommendation: #2034 is answered by slice 1
   minus the chart; #614 should be split as its triage note says, with the
   calendar and timeline parts pointed at #7888/#7890; #7353 is answered by
   views. No issue was edited or commented on as part of this work.
