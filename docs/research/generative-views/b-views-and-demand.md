# Generative views: what the catalog should contain and how data binds to it

Research date: 2026-10-30. Read-only research; nothing posted to GitHub, no repo files edited.
Evidence labels used below: **[V]** read on the vendor's own page, **[S]** only a web-search summary of the vendor page, **[R]** third-party review or mirror (weak), **[C]** read in this repo's code, **[I]** GitHub issue read via `gh`.

## 0. Bottom line

1. **The six bare primitives were not the real gap; the missing binding vocabulary was.** Every mature view system (Notion, Linear, Airtable, Obsidian Bases, Tana, Todoist, Fibery) converges on the same small set of layouts over one data model. What differentiates them is the vocabulary that binds data to a layout: scope, nested filter, group plus sub-group, multi-key sort, display fields, aggregates over a range, plus view-level controls. Section 3 specifies that vocabulary. The layouts are cheap by comparison.
2. **Every AI that builds views maps natural language to a validated configuration of existing components, not to code.** Airtable states this outright ("Omni gets full access to a parts bin" of production-ready components [V]); Todoist's Filter Assist sees only the prompt plus a rules file and few-shot examples, validates the output with its own library and shows a preview before saving [V]; Notion Agent drafts dashboards that humans refine in edit mode [V]; Fibery AI sets view type, filters and sorting [V]. Only Airtable's AI "custom elements" generate code, and that is the escape hatch with real limits (no mobile, plan and model restrictions) [V]. This is consistent with the privacy invariant already in the plan: the model never sees task data.
3. **Recommended catalog size:** Tier 1 is 6 component types plus layout (stack, columns), Tier 2 is about 8 more, Tier 3 is deferred or rejected. Breadth comes from variants and recipes of a few strong types, not from many bespoke widgets. Notion caps dashboards at 12 widgets and 4 per row [V]; use a similar cap.
4. **Demand in SP is real but diffuse and low-reaction.** The repo has 5,700 issues; only 87 have 10 or more reactions. The view-related ones that reach that bar are Kanban (#374, 43 thumbs-up, shipped), Home screen widget (#3818, 63, shipped as Android widget), Calendar view (#2521, 20, shipped). Open demand clusters around: cross-project "all tasks" lists, sort/group/filter inside boards, Todoist-style saved filters, time-per-project reporting, a unified stats/habit dashboard, and Gantt. There is no issue asking for AI-built or voice-built views (nearest: #7056, 14 thumbs-up, "public API/CLI so AI agents can control SP"); the plan already says demand is a maintainer bet.
5. **Hypothesis (not verified, flagged for the eval harness):** "Not magical" was likely caused by (a) no real task semantics in the vocabulary (overdue, deadline, planned vs scheduled, estimate remaining, age), (b) nothing to look at beyond lists and counts (no day agenda, no time breakdown), (c) no way to say "my client X project" without the model knowing the user's data (needs role slots), (d) no interactions that write the user's intent back (drop to retag, add-here inherits the predicate).

## 1. Prior art

### 1.1 Layout and widget inventory

| Product                            | Layouts / widgets                                                                                                                                                                                                                                                                                                                                                                | AI that builds views?                                                                                                                                                                                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Notion [V]                         | Database views: table, board, timeline, calendar, list, gallery, chart, forms, map, feed, dashboards. Dashboard view (released 2026-03-10, Business/Enterprise): each widget is a database view (table, board, calendar, chart, timeline); up to 4 widgets per row and 12 total; global filters apply to every widget that shares the property; no free text between widgets [S] | Notion Agent drafts a dashboard from a natural-language request and iterates (add widgets, reorganize); user refines in edit mode. Custom Agents (Feb 2026, background automation) are a separate thing [S]                                                                                      |
| Linear [V]                         | Issue views: list, board; project/initiative views: list, timeline (project views also board). Saved filtered view = Custom View, shareable, subscribable                                                                                                                                                                                                                        | "Filter with AI" turns a plain-language description into a filter (Feb 2026 changelog, via search summary [S]). Saving the result as a view is a manual step. Linear Agent (Mar 2026) creates issues, projects, documents [S]; no confirmation it creates views                                  |
| Airtable Interfaces [V]            | Page layouts: list, gallery, kanban, calendar, timeline, grid; plus overview, form, dashboard (charts and number elements on one canvas), record review. Elements: list, gallery, kanban, calendar, timeline, grid, number, chart, button, filter controls                                                                                                                       | Omni (announced 2025-06-24) builds tables, interfaces and automations from conversation using existing production-ready components "as a parts bin"; actions respect user permissions [V]. AI-generated custom elements (code generated from a prompt) out of beta 2026-04-14, not on mobile [V] |
| Coda / Superhuman Docs [S]         | Table views as table, cards, calendar, timeline, board; charts via `/chart`; tabbed views grouping several views (Jan 2026)                                                                                                                                                                                                                                                      | "AI Views": custom views generated from a description on top of live data, closed beta July 2026 [S]                                                                                                                                                                                             |
| Fibery [V]                         | 12 view types incl. table, board, calendar, timeline, gantt, feed, map, form, list, report, gallery; Dashboard view (experimental, July 2025) embeds views and reports as widgets                                                                                                                                                                                                | Build mode creates views by description: view type, filters, sorting, view-specific settings; not colour coding. Reports creatable and iterable with AI (Feb 2026). An open community request (Mar 2026) is "Allow AI to make Dashboards" [S], so AI-built dashboards were not standard yet      |
| Tana [V]                           | Live search nodes shown as outline, table, cards, lanes, list, calendar, side menu, tabs. Table columns are fields with aggregations (sum, average, median, min, max, count, count unique)                                                                                                                                                                                       | AI commands reference parts of the graph as context; no AI view builder found                                                                                                                                                                                                                    |
| Obsidian Bases [V]                 | `.base` file: table, list, cards, kanban, map (plugins add more). Global and per-view filters (and/or/not, nestable), formulas, per-view `groupBy`, `order`, `summaries`, `limit`. `this` context binds a base to its host note                                                                                                                                                  | None official; community "agent skills" teach LLMs to write `.base` YAML [R]                                                                                                                                                                                                                     |
| Obsidian Dataview [V]              | Query types LIST, TABLE, TASK, CALENDAR with FROM, WHERE, SORT, GROUP BY                                                                                                                                                                                                                                                                                                         | None                                                                                                                                                                                                                                                                                             |
| Capacities [S]                     | Object types, collections (manual) and queries (saved rules over types with filters)                                                                                                                                                                                                                                                                                             | Pro-gated AI assistant and semantic search; no view builder                                                                                                                                                                                                                                      |
| Todoist [V]                        | Layouts: list, board, day/week/month calendar; group by, sort (alphabetical, assignee, date, created, priority, project), filter (assignee, date, deadline, priority, label); filter query language                                                                                                                                                                              | Filter Assist: plain language to filter syntax. Model sees only the prompt, rules and few-shot examples; output validated by an in-house library; preview before save; temperature 0; 27-prompt eval showed GPT-3.5 about 70% vs GPT-4 about 96% (write-up undated, circa 2023) [V]              |
| TickTick [S/R]                     | List, kanban, Eisenhower matrix (opt-in tab), calendar, timeline (Premium, sources conflict); smart lists from filter criteria list/tag/date/priority/assignee with AND/OR (older posts say up to 3 conditions)                                                                                                                                                                  | None found                                                                                                                                                                                                                                                                                       |
| Sunsama [S/R]                      | Daily planning ritual, drag-to-timebox calendar, channels; weekly review prompts at week end: time spent per channel, carry over unfinished, objectives progress, short journal                                                                                                                                                                                                  | None for views                                                                                                                                                                                                                                                                                   |
| Akiflow [R]                        | Universal inbox, drag to calendar, daily/weekly planning rituals; mid-2026 Daily Dashboard and Schedule Optimizer per a changelog mention (unverified); assistant "Aki" for natural-language commands                                                                                                                                                                            | Command assistant, not a view builder                                                                                                                                                                                                                                                            |
| Motion [R]                         | List, board, timeline, Gantt; auto-schedules tasks onto the calendar                                                                                                                                                                                                                                                                                                             | AI scheduling (writes data), not view building                                                                                                                                                                                                                                                   |
| Amie [R]                           | Calendar plus todo, AI day planning; 2026 sources conflict on whether it repositioned toward meeting notes                                                                                                                                                                                                                                                                       | Not relevant to views                                                                                                                                                                                                                                                                            |
| Microsoft Loop [R]                 | Portable components: task list, table, voting table, status tracker, notes                                                                                                                                                                                                                                                                                                       | None; sources are 2021-2023 era, weak                                                                                                                                                                                                                                                            |
| Vercel json-render, Jan 2026 [S/R] | Catalog of allowed components with prop schemas; model emits a flat JSON component tree; server validates against the catalog and auto-fixes common mistakes                                                                                                                                                                                                                     | Generic generative-UI pattern; matches the repo plan's spec approach                                                                                                                                                                                                                             |

### 1.2 Data-binding models worth copying

- **Scope plus filter is separate from display (Linear [V]).** "Display options don't remove anything. Filters narrow the list." A generative edit protocol benefits: "hide done" is a filter edit, "show estimates" is a display edit.
- **A page binds to a source, not to another view (Airtable [V]).** "An interface page reads from a table, not from a view"; grid-view filters, sorts and hidden fields do not carry over. For SP: a generated view must carry its own query and not inherit the user's saved customizer state of the work context.
- **Group and one sub-group, no more.** Airtable List allows 2 group fields, Grid and Timeline 3 [V]; Notion has group plus sub-group [V]; Linear has group plus row sub-group (swim lanes) [V]; Bases has one `groupBy` plus `groupOrder` [V]. Two levels is the convergent choice.
- **Filters are and/or/not trees, shallow.** Notion nests up to 3 layers [V]; Bases arbitrary and/or/not [V]; Todoist uses & | ! and parentheses [V]. Depth 2 is enough for personal use.
- **Layouts require fields and show the gap.** Linear timeline shows only items with dates [V]; Coda calendar needs a date column, timeline needs two [S]; Airtable kanban needs a single-select, calendar a date field [V]. SP issue #8111 (open) asks for exactly the inverse problem (dateless parents cluttering calendar and unscheduled lists). Rule: components that need a field render an explicit "N not placed" bucket instead of silently dropping items.
- **View-level controls the user can touch without the model.** Airtable filter controls (tabs or dropdowns, one set per page) [V]; Notion global filters that apply across widgets [V]; Linear quick filters [V]. These keep small adjustments out of the model loop.
- **Aggregates are a small closed set.** Tana: sum, average, median, min, max, count, count values, count unique, numeric fields only [V]. Bases: named summaries such as Average [V].
- **Composition by embedding views.** Notion, Fibery, Airtable and Coda dashboards are views embedded as widgets with a layout and shared filters. SP's `stack`/`columns`/`board`/`metric` already follow this.
- **Roles via host context.** Bases `this` (host note, embedding note or active note) [V] is the closest to SP's `@current`.

## 2. Demand in SP

Source: `gh api search/issues` against `super-productivity/super-productivity` (the repo moved from `johannesjo/`; the old name returns a validation error from the search API), 2026-10-30. Counts are matches of `"term" in:title,body` and are an upper bound because bodies mention these words incidentally. Reaction numbers are thumbs-up (`+1`) at the time of the query. No label separates feature requests from bugs, so I classified by title (bug titles typically start with a siren emoji; feature requests with a bulb emoji or none).

### 2.1 Counts per term

| Term                           |    Matches |      Open |     Closed |
| ------------------------------ | ---------: | --------: | ---------: |
| kanban                         |         70 |        23 |         47 |
| board                          |        125 |        45 |         80 |
| eisenhower                     |         27 |         8 |         19 |
| matrix                         |         42 |        20 |         22 |
| dashboard                      |         19 |        10 |          9 |
| widget                         |         63 |        26 |         37 |
| overview                       |         45 |        16 |         29 |
| statistics                     |         19 |         9 |         10 |
| heatmap                        |         15 |        10 |          5 |
| habit                          |         94 |        48 |         46 |
| custom view                    |         18 |        11 |          7 |
| custom filter                  |         12 |         6 |          6 |
| saved filter / saved search    |      4 / 2 |     4 / 1 |      0 / 1 |
| group by                       |         47 |        21 |         26 |
| sort by                        |         48 |        22 |         26 |
| calendar view                  |         57 |        24 |         33 |
| timeline                       |         75 |        14 |         61 |
| gantt                          |          4 |         2 |          2 |
| weekly review                  |          8 |         6 |          2 |
| time per project               |          2 |         1 |          1 |
| burndown                       |          0 |         0 |          0 |
| natural language / LLM / voice | 4 / 9 / 21 | 0 / 3 / 6 | 4 / 6 / 15 |

Repo scale: 5,700 issues, 1,254 open, 87 with 10 or more reactions, 239 with 5 or more, 491 with 10 or more comments.

Title-keyword themes over the issues my search terms surfaced (bug-prefixed and Android/iOS titles excluded; a lower bound for the whole repo): boards/kanban/eisenhower 70 titles (29 open, 97 thumbs-up total); filter/sort/group 44 (22 open, 38); dashboard/stats/heatmap/gantt 16 (10 open, 55); calendar/timeline/gantt 37 (7 open, 57).

### 2.2 Top issues by reactions (view-related), with what they ask

Shipped already (evidence that SP users want these views, and what they asked for next):

- #374 Kanban View, 43 thumbs-up, 46 comments, closed (became Boards with Eisenhower and Kanban defaults [C]).
- #3818 Home screen widget, 63, closed. Follow-ups still open: #7102 (12), #5139 (11), #6373 iOS (7), #7636 launcher shortcuts and project-specific widgets (8), #10348 widgets with custom task views (2). These are native glance widgets, not in scope for generative views, but #10348 shows "custom views feeding a widget" as a demand signal.
- #2521 Calendar View, 20, closed (became Schedule).

Open, view-shaped:

- **Query vocabulary inside boards and lists.** #4688 sort/group options in board panels (7); #6695 universal sorting and filtering that supports Planner and Boards (the author proposes "an abstract system of filtering and sorting for any type of Object", i.e. what a view spec is); #8392 and #6915 date and timeframe filters for custom boards (1 and 5); #6420 filter by time of scheduled tasks in board edit; #5810 OR logic for required tags in board columns; #8615 folder filter for the board project filter (open; #6266 is the closed predecessor); #5487 sort by two or more criteria (2); #11008 group by priority; #4748 and #5311 grouping gaps in Today.
- **Cross-project lists.** #7353 "All Tasks" (12 thumbs-up, 13 comments) after "Group by project" and "filter by project" problems in Today (bug reports #7279, #7050, both closed); #6717 treat Inbox as "see all tasks" (15, 12 comments); #3500 Today group by project plus custom filtered views (closed).
- **Saved/custom filters Todoist-style.** #10347 advanced filter builder with saved presets, naming "daily planning, weekly reviews, work tracking" as target views (0 thumbs-up, 5 comments, opened 2026-09-29 together with #10348); #3667 filter schedule by project or tags (closed); #6252 task list plus filters next to Schedule with drag to plan (3).
- **Time reporting.** #2034 overview of time spent per project, asks for a breakdown plus pie chart (7, 21 comments, open since 2022); #614 worklog view alternatives asking "what did I work on last days/weeks, how much compared to other weeks, how much on project x, y, z and when" (11 thumbs-up, 16 comments, open since 2020).
- **Dashboards and statistics.** #6970 unified customizable dashboard with modular widgets: heatmap toggling time vs tasks completed, donut for done vs todo per project or tag, correlation with wellbeing (2, 3 comments; the author offers "plugin" as the alternative if core should stay lean); #8002 habit statistics dashboard (3), #7883 habit statistics (4), #8775, #7008, #7695 habit heatmap (6), #4065 contributions-style heatmap (closed), #4289 visual progress and streaks (6, closed), #7606 project sheet with notes, dates, archive for reporting (1).
- **Planner and schedule views.** #4405 make "Overdue" optional (10 thumbs-up, 12 comments, the most-reacted open one here: users find the overdue block noisy); #8132 show completed tasks in Planner and Schedule (7); #9514 calendar-style week view (6); #9402 and #4533 drag unplanned tasks from a panel into the schedule; #2841 Eisenhower mode (closed, 3).
- **Gantt and dependencies.** #4790 Gantt as plugin (14 thumbs-up, open); #965 (3) and #10083 (2) are closed. The only high-reaction open view request, and it points to a plugin.
- **Board polish.** #7638 horizontal kanban layout for project sections (4, open). Closed already: #4163 ordering boards (5), #4218 board as default view (4), #4694 delete default boards (2).

### 2.3 Recurring asks, ranked

1. One query vocabulary used by every view (filter, sort, group on boards, planner, lists). #6695, #4688, #8392, #6915, #6420, #5810, #5487.
2. Cross-project "everything" lists with grouping by project. #7353, #6717, #3500, #5311.
3. Time spent by project and period, as a glanceable breakdown. #2034, #614.
4. Saved named filters / Todoist-like presets. #10347, #10348, #3667.
5. Calm planning surfaces: week agenda with optional overdue, completed items visible, drag unplanned to day. #4405, #8132, #9514, #6252, #9402.
6. A stats/habit overview in one place. #6970, #8002, #7883, #7695.
7. Gantt. #4790.

## 3. SP's existing building blocks (reuse list)

All **[C]**, paths under `src/app/features/` unless noted.

| Block                                                                                | What exists                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Use in the catalog                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boards (`boards/boards.model.ts`, `boards.const.ts`, `boards.util.ts`)               | `BoardPanelCfg`: `includedTagIds`/`excludedTagIds` with `includedTagsMatch`/`excludedTagsMatch` (all/any), `projectIds`, done state (all/done/undone), scheduled state, backlog state, `isParentTasksOnly`, sort by dueDate/created/title/timeEstimate. Default boards: Eisenhower (2 columns, tags `EM_IMPORTANT`, `EM_URGENT`) and Kanban (`KANBAN_IN_PROGRESS`). `doesTaskMatchPanel` and `rewriteTagIdsForPanel` implement the predicate and the drop semantics | The `board` column predicate and the drop rule are already specified; aliases `@urgent`, `@important`, `@doing` should resolve to these three tags so a generated Eisenhower or Kanban view shares the user's existing tags |
| Task view customizer (`task-view-customizer/types.ts`, service)                      | Sort: name, scheduledDate, deadline, creationDate, estimatedTime, timeSpent, tag, priority. Group: tag, project, scheduledDate, deadline. Filter: tag, project, scheduledDate presets (today, tomorrow, thisWeek, nextWeek, thisMonth, nextMonth), deadline, estimatedTime (10/30/60/120 min), timeSpent, priority (high/medium/low). Per-context state with `collapsedGroupIds`                                                                                    | The vocabulary users already know; the generative `taskList` should be a strict superset (add multi-key sort, sub-group, doneDay, derived fields)                                                                           |
| Work view / contexts (`work-view/`, `work-context/`, `section/`, `tag/tag.const.ts`) | Today (virtual `TODAY` tag, membership from `dueDay`/`dueWithTime`), "Later today", overdue, project backlog, project/tag contexts, `Section` (title plus ordered `taskIds` per context)                                                                                                                                                                                                                                                                            | `@current`, `@today` scopes; sections as an optional group-by for project contexts                                                                                                                                          |
| Planner (`planner/`)                                                                 | `planner-day`, `planner-task`, `planner-deadline-task`, `planner-calendar-event`, `planner-repeat-projection`, `planner-day-overdue`; day header shows planned duration from `day.timeEstimate`                                                                                                                                                                                                                                                                     | `agenda` component: days, overdue bucket, calendar events, repeat projection, per-day load                                                                                                                                  |
| Schedule (`schedule/`)                                                               | `schedule-week`, `schedule-month`, day panel, `schedule-event`, time-grid scheduling                                                                                                                                                                                                                                                                                                                                                                                | Tier 2 `schedule` / month calendar                                                                                                                                                                                          |
| Worklog and metrics (`worklog/`, `metric/`, `pages/metric-page`)                     | Year/month/day worklog tree and week view with export; `SimpleMetrics` (timeSpent, timeEstimate, breakTime, tasks done/created, daysWorked, avg per day/task); `activity-heatmap` (time-based); line charts for evaluation, focus sessions, simple counters; `ProjectMetricsService`                                                                                                                                                                                | Source of the aggregate vocabulary (section 4.4) and the `heatmap`, `timeBreakdown`, `metric` components                                                                                                                    |
| Daily summary (`pages/daily-summary/`)                                               | Finish day and finish week: tasks completed, time spent vs estimate, breaks, focus summary, plan tomorrow / next week                                                                                                                                                                                                                                                                                                                                               | The shape of a "review" recipe                                                                                                                                                                                              |
| Habits / simple counters (`simple-counter/`)                                         | Types `StopWatch`, `ClickCounter`, `RepeatedCountdownReminder`; habit page; a streak duration util exists                                                                                                                                                                                                                                                                                                                                                           | Tier 2 `counters` (totals only, see anti-features)                                                                                                                                                                          |
| Task fields (`tasks/task.model.ts`)                                                  | `projectId`, `tagIds`, `parentId`/`subTaskIds`, `isDone`, `doneOn`, `wontDoOn`, `dueDay`, `dueWithTime`, `deadlineDay`, `deadlineWithTime`, `priority`, `timeEstimate`, `timeSpent`, `timeSpentOnDay`, `created`, `modified`, `repeatCfgId`, `issueType`, `attachments`, reminders                                                                                                                                                                                  | The full field list the vocabulary can expose; `modified` and `created` give a cheap "age/stale" field                                                                                                                      |
| Row components                                                                       | `task` (hot path, see AGENTS.md), `task-list`, `planner-task`, `worklog-task-row`, `task-summary-table`, `board-panel`                                                                                                                                                                                                                                                                                                                                              | The catalog describes behaviour; the plugin currently renders in an iframe with its own DOM, so rows are re-implemented there. Whether native Angular components are hosted is a rendering decision outside this document   |
| Plugin data access (`packages/plugin-api/src/types.ts`)                              | `getTasks`, `getArchivedTasks`, `getCurrentContextTasks`, `getAllProjects`, `getAllTags`, `getActiveWorkContext`, `updateTask`, `addTask`; plan adds `getDayContext`, `dataChanged`, `dayChange`                                                                                                                                                                                                                                                                    | Archived tasks make `doneOn` ranges over past weeks possible; confirm archive access cost before promising year-long ranges                                                                                                 |

## 4. Recommended catalog

Principle filter applied to every item: does it help a single person decide or review faster, can it run offline from local data, does it avoid attention hooks? Each tier lists evidence. Components are described by behaviour; names follow the plan's spec where they exist.

### 4.1 Tier 1: the minimum that makes views feel real

1. **`taskList` (extended)**
   - Shows: tasks as rows or cards.
   - Binds: `query`, `groupBy`, `subGroupBy`, `sort[]`, `fields[]`, `density` (row/card), `limit` with "show more", `collapsedByDefault`, `showEmptyGroups`, `addTask` (new task inherits the query's tags/project/due), `doneStyle` (hide, strike, or own section).
   - Evidence: customizer already offers sort/group/filter [C]; Linear, Notion, Todoist, Airtable List, Bases all have group plus sort plus display fields [V]; demand #7353, #6717, #3500, #5311, #5487, #11008, #4748.
   - Covers recipes: all-tasks by project, Today by priority, deadline radar, stale cleanup, inbox triage, waiting-for, quick wins, "done this week by day" (group by `doneDay`).
2. **`board`** (kanban, matrix, any lane layout)
   - Shows: lanes of cards; a lane is a predicate (`tags`, `notTags` with `any/all`, `isDone`, optional `due` bucket, `project`) or auto-generated via `laneBy` (project, priority, dueBucket).
   - Binds: base `query`, `columns[]` or `laneBy`, `columnsPerRow` (2 for Eisenhower), `sort` inside lanes, `addTask` per lane.
   - Interaction: a drop is one `updateTask` that adds the lane's tags and removes its excluded tags (existing SP board semantics [C]).
   - Evidence: #374 (43), #2841, #4688, #6915, #8392, #5810, #7638; every product has kanban [V]; SP ships Eisenhower and Kanban boards [C].
3. **`agenda`** (days as sections)
   - Shows: N consecutive days (default 7) from a start day, each with scheduled and planned tasks, optional calendar events, repeat projection, and the per-day estimate total; `overdue` as a collapsed, optional bucket.
   - Binds: `from`, `days`, `query`, `showOverdue` (default off or collapsed), `showCalendarEvents`, `showDone`.
   - Interaction: drag a task to another day (reschedule, one op).
   - Evidence: planner is the daily-planning core [C]; #4405 (10, overdue noise), #8132 (7, show completed), #9514 (6), #6252, #9402, #4533; Sunsama and Akiflow daily/weekly planning, Todoist day/week calendar [V/R].
4. **`metric`** (single number, extended)
   - Shows: one number with a label, optional plain delta vs the previous period (no colour judgement).
   - Binds: `agg` (section 4.4), `field`, `range`, `query`.
   - Evidence: Notion dashboards combine "views, KPIs, key properties" [V]; Airtable number elements [V]; SP `SimpleMetrics` [C]; #6970.
5. **`timeBreakdown`**
   - Shows: time spent per project, tag, day or week for a range; bar or stacked bar with an hh:mm table fallback; bars only, no pie.
   - Binds: `per` (project, tag, day, week), `range`, `query`, `stackBy`.
   - Evidence: #2034 (7, 21 comments), #614 (11, 16 comments), Sunsama weekly review "where you spent your time by channel" [S], Notion chart views [V], SP worklog data `timeSpentOnDay` [C].
6. **`text` and layout (`stack`, `columns`)**
   - Heading, short note, spacing. Notion dashboards cannot hold text between widgets [S]; allowing a one-line heading or caption is cheap and lets the model label what it built.
7. **Cross-cutting, not separate types:** `roles` (typed slots, section 4.5), `controls` (the three standard pickers, Tier 2 UI), unplaced-bucket rule (section 1.2).

### 4.2 Tier 2: add once Tier 1 is solid

8. **`schedule`** (week or day time grid, and a month grid): scheduled tasks plus calendar events. Evidence: #2521 (20), #9514, #3667 (filter schedule by project/tag), #6252; Todoist week/day/month calendar, Airtable and Notion calendar, Dataview CALENDAR [V]. Cost: heavy interaction code; reuse only if hosted natively.
9. **`nextUp`** (one task card with start/stop tracking and remaining estimate, chosen by a local rule such as top of Today by priority, or next scheduled): fits the deep-work principle; Akiflow and Motion put "what next" first [R]. No direct SP issue found; justified by principle, not demand.
10. **`tabs`**: several components behind tabs so one view stays calm. Evidence: Coda tabbed views (Jan 2026) [S], Tana tabs [V]; mitigates the 12-widget density problem.
11. **`controls`**: scope picker (project/tag), range picker, text search; applies to every component that opts in. Evidence: Airtable filter controls [V], Notion global filters [V]; keeps small tweaks out of the model loop.
12. **`heatmap`**: activity per day, measure is `timeSpent` or `tasksDone` (the toggle asked for in #6970); single hue, no goal or streak overlay. Evidence: #6970, #7695 (6), #4065, #4289, SP `activity-heatmap` [C]. Sensitive to the anti-feature list; keep passive and retrospective.
13. **`progress`**: done vs open count and remaining estimate for a scope as a bar (replaces the donut asked for in #6970; no percent-to-goal framing). Evidence: #6970, #7606 project sheet; Notion KPI idea [S].
14. **`counters`**: SP simple counters/habits as totals and a week or month grid. Evidence: #8002, #7883, #7695, #6592, #8216 (habits in Today), 94 matches for "habit". Totals only; see anti-features.
15. **`table`** (or `taskList` with `density: table`): columns of fields with a sums row (Tana aggregations [V], Notion table, Airtable grid, Bases table [V]). SP demand is weak (#7606 project sheet); try as a density option of `taskList` first before adding a type.

### 4.3 Tier 3: defer or reject for now

- **Timeline / Gantt / dependency chains.** Asked repeatedly (#4790 14 thumbs-up, #965, #10083), yet it is project-management territory ("not team management"), needs a dependency model SP lacks (#5214 links between tasks closed with 18 thumbs-up, but not a Gantt model), and the issue itself suggests a plugin. If ever added, read-only bars from `dueDay` and `deadlineDay`.
- **Focus-session and evaluation trend charts, reflection notes viewer.** Exist in Metrics [C]; low demand in issues; revisit if weekly-review recipes want them.
- **Cross-component selection (master-detail).** Tana list view [V]; nice, not needed.
- **Issue-provider boards** (GitHub, Jira): a `source` filter covers it without a component; #6363 (2).
- **Free-form generated HTML/code block.** Airtable custom elements prove the pattern [V] but with limits (no mobile, credentials visible to users of the element, model-provider restrictions). Keep as Phase 2 per the plan.
- **Map, pie/donut, 3D, dual-axis charts.** No location data; pies are poor for comparing parts. Use bars, a single line, or numbers.

### 4.4 Coverage check: twelve recipes the Tier 1 catalog must express

1. Weekly review: `metric` done this week, `timeBreakdown` by project, `taskList` done grouped by `doneDay`, `taskList` open and slipping (deadline passed or age over N days), `text` heading.
2. Eisenhower: `board` with `columnsPerRow: 2`, lanes from `@important`/`@urgent`.
3. Kanban for the current project: `board` with To do, Doing (`@doing`), Done.
4. Client dashboard: `roles.client` as a project; `metric` open count, remaining estimate, time this month; `board` by tag; `taskList` due within 7 days.
5. Waiting-for: `taskList` tag `waiting` grouped by project sorted by age.
6. Plan my week: `agenda` 7 days, `taskList` unscheduled with drag to day, `metric` planned hours.
7. Stale cleanup: `taskList` open, created over 60 days ago, no due, sorted by age.
8. Today focus: `nextUp`, `taskList` today by priority, `metric` remaining estimate.
9. Deadline radar: `taskList` grouped by deadline bucket.
10. Time by project this month: `timeBreakdown` per project, range thisMonth.
11. Inbox triage: `taskList` with no project, no due, `addTask` on.
12. Quick wins: `taskList` estimate at most 15 min, grouped by project.

These double as few-shot examples in the prompt (Todoist's approach [V]) and as eval prompts: pass criterion is the generated spec validating and producing the same task set as a hand-built reference.

## 5. Data-binding vocabulary

Keep it a closed grammar so the model composes, the validator rejects, and the user can read it. All names resolve on the device; the model never receives task data, project names or tag names (see roles).

### 5.1 Fields (what components can show, filter, group, sort)

Stored: `title`, `isDone`, `doneOn`, `project`, `tags`, `parent`, `dueDay`, `dueWithTime`, `deadlineDay`, `deadlineWithTime`, `priority`, `timeEstimate`, `timeSpent`, `timeSpentOnDay`, `created`, `modified`, `isRepeating`, `issueProvider`, `hasNotes`, `hasReminder`.

Derived (computed locally, cheap, deterministic): `dueBucket` (overdue, today, tomorrow, thisWeek, nextWeek, later, none), `deadlineBucket` (same), `isScheduledWithTime`, `remaining` = max(estimate - timeSpent, 0), `isOverEstimate`, `ageDays` (since created), `idleDays` (since modified), `doneDay`, `doneWeek`.

### 5.2 Scope and roles (special-role projects and tags)

- Built-in scopes: `@current` (project or tag the view is opened in), `@today` (virtual Today, per ARCHITECTURE Decision #2), `@all`, `@inbox`, `@archive` (history for `doneOn` ranges).
- Built-in tag aliases that resolve to SP's existing special tags: `@urgent`, `@important` (Eisenhower), `@doing` (Kanban in-progress). A generated Eisenhower or Kanban therefore shares tags with the user's native boards instead of inventing a "Doing" tag by name.
- **User roles as typed slots.** A view declares `roles: { client: { kind: "project", ref: "Acme" }, waiting: { kind: "tag", ref: "Waiting" } }` and components reference `@client`, `@waiting`. The model fills `ref` from the utterance ("my Acme project"); the device resolves it case-insensitively, then stores the resolved id. Unresolved or ambiguous refs render as an inline picker chip, so (a) the model never needs the user's project or tag list, (b) a hallucinated name degrades to a one-tap fix, (c) renames after pinning do not break the view (closes the plan's "pinning ids is a known gap"). Role kinds: `project`, `tag`, `dateRange`.
- Role defaults are the only place names appear in the spec. A "template view" with unfilled roles can be shared or reused across projects (the plan's `@current` idea generalised).

### 5.3 Filters

- Tree of `and` / `or` / `not`, depth at most 2, leaf = `field op value`.
- Ops: `is`, `isNot`, `in` (with `match: any|all`, for tags), `before`, `after`, `within`, `contains` (text), `exists`, `missing`, comparisons for numbers and durations.
- Relative dates only, never absolute dates: `today`, `tomorrow`, `thisWeek`, `nextWeek`, `lastWeek`, `thisMonth`, `last7d`, `last30d`, `next7d`; resolved with `getDayContext()` (logical day, start-of-next-day offset, first day of week).
- Defaults that match SP: parents only (`parentsOnly: true`), archived excluded, `@backlog` excluded unless asked.
- Exactly two levels of filter authority: view-level query (set by the model) and `controls` overrides (set by the user). The model edits the former only.

### 5.4 Group, sort, display, aggregate

- **Group:** `groupBy` plus optional `subGroupBy` over project, tag, dueBucket, due day/week/month, deadlineBucket, doneDay/doneWeek, priority, estimate bucket (under 15 min, 15-60, over 60), parent, issueProvider, none. `groupOrder` (explicit or natural), `showEmptyGroups`.
- **Sort:** list of `{ field, dir, nulls: last }`; `context` means the project's or Today's manual order. Sort is applied inside groups.
- **Display:** `fields[]` per item from the stored and derived lists; `density` row, card or table. Display never changes which items match.
- **Aggregates:** `count`, `sum`, `avg`, `min`, `max`, `countDays` (distinct days with time) over `timeEstimate`, `timeSpent`, `remaining`; ratio of two counts (`done / all`). Always with a `range` and an optional `per` (project, tag, day, week, month). No user formulas.
- **Range:** the relative-date vocabulary above, evaluated on the logical day; week start from `getDayContext()`.
- **Outputs:** number, bar, table. No pie.

### 5.5 Actions (what a component may write back)

Only user intents on single tasks: check done, drop-to-lane (add lane tags, remove excluded tags, toggle done), move to day, add task with inherited predicate, open detail, start or stop tracking. Each is one existing op (AGENTS.md sync rule: one user intent, one op). The model has no write path to tasks.

## 6. Anti-features under the product principles

| Do not build                                                                          | Why (principle)                                                      | Evidence                                                                                                                                                             |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Streaks, flames, scores, levels, badges, "productivity score", leaderboards, confetti | "No vanity dashboards, streaks or dopamine loops"                    | Streak asks exist (#4289) and `get-simple-counter-streak-duration` exists [C]; do not extend into generated views. Habit components show totals and a calm grid only |
| Red overdue counters, shame badges, "47 overdue" tiles                                | Less noise; calm default                                             | #4405 (10 thumbs-up): users want "Overdue" optional. Default `showOverdue` to off or collapsed in `agenda`                                                           |
| Alerts, notifications, live-updating counters demanding attention                     | Reminders stay opt-in                                                | `dataChanged` refreshes silently; no toasts for data changes                                                                                                         |
| Unbounded dashboards                                                                  | Depth over breadth                                                   | Notion caps dashboards at 4 per row and 12 widgets [V]. Cap generated views at about 8 components and 3 columns; validator rejects more                              |
| Team and portfolio views: workload by assignee, sprints, burndown, velocity, OKRs     | Personal deep-work tool                                              | Zero "burndown" hits in the repo; Gantt/dependencies are the main pull and belong in a plugin per #4790                                                              |
| Custom properties, formula engine, cross-field arithmetic                             | Feature creep; plan already rejects it                               | Notion and Bases formulas [V]; SP has fixed task fields. Derived fields in 5.1 are the closed substitute                                                             |
| Model-generated "insights" about the user's work ("you were 20% less productive")     | The model does not see data; also vanity                             | Insight text would require sending data out; local numeric components already answer the question                                                                    |
| Letting the model pick "important" tasks                                              | Data stays local, model blind                                        | Use local rules (priority, deadline, estimate) in `nextUp`                                                                                                           |
| Auto-scheduling or rewriting the plan                                                 | Views are read plus user-intent writes; scheduling is a data feature | Motion and Akiflow optimizers write calendars [R]; out of scope                                                                                                      |
| Pie, donut, 3D, dual-axis charts                                                      | Poor accuracy for comparison                                         | #2034 and #6970 asked for pie/donut; deliver bars or numbers                                                                                                         |
| Free-form HTML/code in Phase 1                                                        | Security, mobile, support cost                                       | Airtable custom elements: no mobile, credentials visible, model restrictions [V]; #8467 notes nested-iframe paint issues on Windows per the plan                     |
| Correlating productivity with wellbeing or ratings                                    | Private data in a generic widget; speculative                        | Only a passing idea in #6970                                                                                                                                         |
| Sharing views with others                                                             | Privacy and offline first, sync surface                              | Linear, Notion share views [V]; SP views stay personal, synced only via normal sync                                                                                  |

## 7. Confidence and gaps

- **What I verified:** Linear display-options and custom-views docs (fetched); Notion dashboards help page and release notes (fetched); Airtable interface-designer docs, newsroom page and custom-elements post (fetched); Tana views docs (fetched); Obsidian Bases docs and syntax (fetched); Dataview query types (fetched); Todoist customise-views help and Filter Assist write-up (fetched); Fibery AI view and report posts (fetched). GitHub counts and reactions from several batches of REST search-API queries (issue states and reaction counts for every cited number re-checked directly on 2026-10-30); bodies read for the most-cited ones (for example #6970, #614, #2034, #7353, #4688, #6695, #10347). SP code: `boards.model.ts`, `boards.const.ts`, `task-view-customizer/types.ts`, `tag.const.ts`, `section.model.ts`, `metric.model.ts`, `simple-counter.model.ts`, `task.model.ts` field list, `planner-day.component.html:12`, plan `docs/plans/2026-10-30-generative-views.md` §4, §6.2, §6.3, §6.4, §6.8.
- **What I am unsure about:**
  - Coda/Superhuman, Linear AI filter, Notion Agent specifics, TickTick, Sunsama, Akiflow, Motion, Amie, Loop and Capacities rest on search summaries or third-party pages. Treat as directional.
  - Reaction counts are thumbs-up only; SP's reaction volume is low, so "demand" is mostly about repeated mentions across many small issues. Title-keyword theme counts are lower bounds over the issues my terms surfaced, not a full census.
  - The `agenda`, `timeBreakdown` and `nextUp` priorities are inference from prior art and principles. No SP issue asks for `nextUp`.
  - The "why it felt not magical" explanation in section 0 is a hypothesis. The eval harness in the plan should test it by comparing spec validity and recipe coverage per catalog size.
  - Archive access cost for year-long `doneOn` ranges and the exact data the plugin iframe can read were not verified.
- **Risks:** a larger catalog may reduce model accuracy per request (Todoist's own eval showed model choice swinging 70% to 96% on a much narrower task [V]); measure rather than assume. Persisted view specs are synced data, so any new component or vocabulary field must be additive with a runtime default (AGENTS.md sync rules 10 and 11). Anything that depends on `dueBucket`, `thisWeek` or `doneDay` must use the logical-day helper to stay replay-safe.

## 8. Sources (accessed 2026-10-30 unless noted)

Vendor and primary docs

- Notion, Dashboards view help: https://www.notion.com/help/dashboards ; release 2026-03-10: https://www.notion.com/releases/2026-03-10 ; database views index: https://www.notion.com/help/category/database-views/all ; views, filters and sorts: https://www.notion.com/help/views-filters-and-sorts ; views API guide: https://developers.notion.com/guides/data-apis/working-with-views
- Linear, Display options: https://linear.app/docs/display-options.md ; Custom views: https://linear.app/docs/custom-views.md ; changelog mirror (Feb 2026 advanced filters and AI filter; 2026-03-24 Linear Agent), unverified mirror: https://linear-web.pages.dev/changelog/2026-02-13-advanced-filters-and-share-issues-in-private-teams
- Airtable, Interface Designer: https://support.airtable.com/docs/getting-started-with-airtable-interface-designer ; "Introducing the AI-native Airtable" (2025-06-24): https://www.airtable.com/newsroom/introducing-the-ai-native-airtable ; AI-generated custom elements out of beta (2026-04-14): https://community.airtable.com/announcements-6/new-ai-generated-custom-elements-are-out-of-beta-and-available-to-everyone-47849
- Fibery, Create views with AI (2025-07-24): https://community.fibery.io/t/july-24-2025-create-views-with-ai-and-embed-on-home-page/9262 ; AI reports (2026-02-12): https://community.fibery.io/t/february-12-2026-fibery-ai-context-create-and-update-reports-with-ai-tons-of-other-improvements/10385
- Coda / Superhuman Docs updates (AI Views, closed beta, July 2026): https://coda.io/product/updates and https://releasebot.io/updates/coda/coda [S]
- Tana views: https://outliner.tana.inc/learn/features/views
- Obsidian Bases: https://obsidian.md/help/bases and https://obsidian.md/help/bases/syntax ; Dataview query types: https://blacksmithgu.github.io/obsidian-dataview/queries/query-types/
- Capacities organizational structures: https://docs.capacities.io/reference/organizational-structures [S]
- Todoist, Customize views: https://todoist.com/help/articles/customize-views-in-todoist-AoHhBxFdZ ; Filter Assist write-up (undated, circa 2023): https://doist-dev.pages.dev/filter-assist ; Todoist Assist intro: https://www.todoist.com/help/articles/introduction-to-todoist-assist
- TickTick: https://blog.ticktick.com/2016/07/20/introducing-ticktick-30-an-awesome-update/ ; help center: https://help.ticktick.com/ (smart lists); 2026 review: https://makerstack.co/reviews/ticktick-review/ [R]
- Sunsama, Guided planning and reviews: https://sunsama.com/features/guided-planning-and-reviews [S]
- Akiflow reviews (secondary, 2026): https://www.morgen.so/blog-posts/akiflow-review [R]
- Motion reviews (secondary): https://geekflare.com/software/motion-review/ [R]
- Amie, 2026 comparison pages: https://routine.co/blog/posts/alternatives-amie [R]
- Microsoft Loop (2021-2023 era coverage): https://www.neowin.net/news/microsoft-loop-is-a-new-app-offering-portable-components-to-enhance-workflows/ [R]
- Generative-UI catalog pattern: Vercel Labs json-render (created Jan 2026) via https://docs.langchain.com/oss/python/langchain/frontend/generative-ui and https://docs.skybridge.tech/examples/generative-ui [S/R]

SP issues (https://github.com/super-productivity/super-productivity/issues/N)

- Shipped: 374, 2521, 3818, 7102, 5139, 6373
- Query vocabulary: 4688, 6695, 8392, 6915, 6420, 5810, 8615, 6266, 5487, 11008, 4748, 5311, 5389, 3500
- Cross-project lists: 7353, 6717, 7279, 7050
- Saved filters: 10347, 10348, 3667, 6252
- Time reporting: 2034, 614
- Dashboards, habits, stats: 6970, 8002, 7883, 8775, 7008, 7695, 4065, 4289, 7606, 8216, 6592
- Planner and schedule: 4405, 8132, 9514, 9402, 4533, 2841, 8111
- Gantt: 4790, 965, 10083
- AI adjacent: 7056

Repo files cited: `src/app/features/boards/boards.model.ts`, `boards.const.ts`, `boards.util.ts`; `src/app/features/task-view-customizer/types.ts`; `src/app/features/tag/tag.const.ts`; `src/app/features/section/section.model.ts`; `src/app/features/metric/metric.model.ts`; `src/app/features/simple-counter/simple-counter.model.ts`; `src/app/features/tasks/task.model.ts`; `src/app/features/planner/planner-day/planner-day.component.html`; `packages/plugin-api/src/types.ts`; `docs/plans/2026-10-30-generative-views.md`; `docs/market/README.md` (views row is "Tracked").
