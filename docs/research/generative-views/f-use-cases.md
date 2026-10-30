# F. Use cases: what people could build with generative views

Oct 30, 2026. A reference list of views users could ask the
[AI View Builder](../../../packages/plugin-dev/ai-view-builder/) for, grounded in
open SP issues and the recipes in [B §4.4](b-views-and-demand.md). Each row is
checked against the spec vocabulary in
`packages/plugin-dev/ai-view-builder/src/core/spec.ts`. Use it to pick recipes,
eval cases and the next vocabulary additions; update the status column when one
lands.

**Status:** ✅ works today · 🔤 needs a small, plugin-only vocabulary addition ·
🔌 needs a host API (plugin bridge or core change) · 🚫 out by product principle

## Planning

| Prompt                                                       | Demand        | Status                                             |
| ------------------------------------------------------------ | ------------- | -------------------------------------------------- |
| "Plan my week: next 7 days, plus unplanned tasks to pull in" | #9514, #9402  | ✅ recipe _Plan my week_; dropping onto a day 🔌   |
| "Today by project, remaining estimate on top"                |               | ✅ recipe _Today by project_                       |
| "Tomorrow, so I can prep tonight"                            |               | ✅ `due: tomorrow`                                 |
| "Everything due this week across all projects, by day"       | #6915, #8392  | ✅ `due: thisWeek`, agenda                         |
| "Today without the overdue section"                          | #4405 (10 👍) | ✅ `showOverdue: false`                            |
| "Next 30 days"                                               |               | 🔤 agenda is capped at 14 days (`MAX_AGENDA_DAYS`) |

## Focus

| Prompt                                                   | Demand           | Status                                     |
| -------------------------------------------------------- | ---------------- | ------------------------------------------ |
| "Focus: what is in progress plus the next 3 due"         |                  | ✅ recipe _Focus_                          |
| "Quick wins: open tasks under 15 min"                    | B §4.4 recipe 12 | 🔤 `estimateMax`                           |
| "Deep work: tasks of 2h or more, nothing tagged meeting" |                  | 🔤 `estimateMin` (`notTags` works)         |
| "The next task in each project"                          | B §4 Tier 2      | 🔤 `limitPerGroup` or a `nextUp` component |

## Review and time

| Prompt                                                 | Demand                    | Status                                                  |
| ------------------------------------------------------ | ------------------------- | ------------------------------------------------------- |
| "Weekly review: done, time per project, still overdue" | #10347                    | ✅ recipe _Weekly review_                               |
| "Shutdown: what I finished today"                      | #8132                     | ✅ `doneOn: today`                                      |
| "Estimate vs time spent for project X"                 |                           | ✅ metrics `estimate`, `timeSpent`                      |
| "Time per project this month / last month"             | #2034 (21 comments), #614 | 🔤 `thisMonth`, `lastMonth` ranges                      |
| "Hours per day on client X last week, for invoicing"   |                           | ✅ for `last7Days`; a calendar week needs 🔤 `lastWeek` |

## Triage and cleanup

| Prompt                                            | Demand               | Status                                                             |
| ------------------------------------------------- | -------------------- | ------------------------------------------------------------------ |
| "All tasks in one list, searchable"               | #7353 (12 👍), #6717 | ✅ `scope: all` + `text`; a live filter box 🔤 (Tier 2 `controls`) |
| "Inbox triage: no due date, no estimate, no tags" | #6717                | 🔤 `hasTags: false` (`due: none`, `hasEstimate: false` work)       |
| "Stale: open for more than 30 days"               | B §4.4 recipe 7      | 🔤 `ageDays` (from the existing `created` field)                   |
| "Waiting for others"                              | B §4.4 recipe 5      | ✅ recipe _Waiting_                                                |
| "Overdue cleanup"                                 |                      | ✅ recipe _Overdue_; bulk reschedule 🔌                            |

## Boards

| Prompt                                          | Demand | Status                                                                |
| ----------------------------------------------- | ------ | --------------------------------------------------------------------- |
| "Kanban that shares tags with the Boards page"  |        | ✅ recipe _Kanban board_; `@doing` is `KANBAN_IN_PROGRESS`            |
| "Eisenhower matrix"                             |        | ✅ recipe _Eisenhower matrix_; `@urgent`, `@important` are SP's tags  |
| "Work OR errands in one list"                   | #5810  | ✅ `tagsMatch: any`                                                   |
| "One lane per project; dropping moves the task" | #4688  | 🔤 `laneBy: project` (the move exists: `updateTask` with `projectId`) |
| "Swimlanes: priority by status"                 | #7638  | 🔤 a two-axis board layout                                            |

## Projects, clients and stats

| Prompt                                                       | Demand              | Status                                                                                                          |
| ------------------------------------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------- |
| "Acme dashboard: open, due this week, hours"                 | B §4.4 recipe 4     | ✅ by name (scope resolves project and tag titles, `src/core/query.ts`); 🔤 roles pin the id and offer a picker |
| "Grid of projects: open count and time this week for each"   | #6970, #10348       | 🔤 a metric grouped `per` project                                                                               |
| "Habit overview: repeating tasks done per day, last 30 days" | #8002, #7883, #7695 | 🔤 `isRepeating` filter, `last30Days` range, `heatmap` component; no streak counter                             |

## Needs the host

| Want                                          | Demand        | Why the plugin cannot do it today                                                    |
| --------------------------------------------- | ------------- | ------------------------------------------------------------------------------------ |
| Drop a task onto a day with Planner behaviour | #9402, #4533  | `updateTask({ dueDay })` is a plain field update that skips the Planner's move logic |
| Time-blocked schedule or timeline             | #9514         | No read or write access to scheduled time slots                                      |
| Order within a list that persists             |               | Ordering lives in project/tag task lists the plugin API does not reorder             |
| Gantt                                         | #4790 (14 👍) | Tasks have no start date; needs a new persisted field, so out of scope here          |

## Out by product principle

From [B §6](b-views-and-demand.md) and the product principles in `AGENTS.md`:

- Streaks, scores, red overdue counters, alerts.
- "What should I do next?" picked by the model: the model never sees task data.
- Auto-scheduling, model-picked importance.
- Team views, burndown, sharing.
- Pie or donut charts, formulas, wellbeing correlation.
- App-wide rules ("when I add tag X, do Y"): these belong in the automations
  plugin, not in a view.

## What this suggests next

About six plugin-only additions unlock roughly ten of the rows above:
`estimateMin`/`estimateMax`, `thisMonth`/`lastMonth`/`lastWeek`, `hasTags`,
`ageDays`, `isRepeating`, and roles. The ✅ rows that are not yet recipes are
candidates for eval cases in `packages/plugin-dev/ai-view-builder/eval/cases.json`.
