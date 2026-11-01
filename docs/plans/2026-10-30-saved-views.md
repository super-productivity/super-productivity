# Saved views — boards become views in the sidebar

Status: implemented in #11349; condensed on 2026-11-01 (#11385). The per-phase
plans and review logs are in that PR's commits. Mocks: [Smart Lists Mocks
canvas](https://claude.ai/artifact/9GtPQWm3oEVEzrC6Vh55jf) (private to the
author).

## Problem

Users asked for saved, rule-based task lists they can open from the menu
(#10347, #10654, #6039; the [market scorecard](../market/scorecard.md) lists
"Saved filters" as an Organization gap). Demand is thin: #10347 and #10654 have
one author and 0 reactions, #6039 has 1 reaction. The app already had the
engine: a board column (`BoardPanelCfg`) is a saved query over all tasks with
manual order and write-back on drop. It lacked access (boards sat behind one
"Boards" entry and a tab bar) and date rules. The maintainer moved boards into
the sidebar as views anyway, as product direction rather than demand, so the
change stays lean: no new entity, no new action types, only optional fields.

## Prior art

Checked 2026-10 from vendor docs (Todoist, TickTick, Apple Reminders,
OmniFocus 4, Vikunja), not hands-on.

- **Take:** a saved view is a sidebar entry (all five); date-relative rules
  (overdue, today, next 7 days); one view can show several columns (Todoist,
  Vikunja). Notion's and Linear's "+ Add filter": list only the rules that
  are set.
- **Deliberately don't:** a query language (parser, error UX, translated
  syntax for a form-sized problem); nested boolean groups (all/any per tag
  rule is what Reminders and TickTick ship); a separate "smart list" entity
  (a second synced model); task counts on sidebar views (noise).

## The model

- **Boards are views.** Every `BoardCfg` is shown as a view unchanged; no
  migration, no new entity. Internal names (`BoardCfg`, `BoardPanelCfg`,
  `/boards`, action strings, keys) stay; user-facing English says "view".
- **One route per view:** `/boards/:boardId`. `BoardRouteGuard` waits for
  `isAllDataLoadedInitially$` (before load the store holds `DEFAULT_BOARDS`, so
  deep links would break on reload) and returns a `UrlTree`. `/boards` opens
  the last view, else the first, else an empty state; an unknown or deleted id
  leads back to `/boards`.
- **Sidebar Views section** (`nav-view-group`, gated by `isBoardsEnabled`)
  replaces the "Boards" entry and the tab bar. It lists boards in stored order,
  with "+" to create, drag to reorder (`sortBoards`) and a per-row menu (Edit,
  Duplicate, Delete). Icons: `view_list` for lists, `view_kanban` for boards;
  never `filter_list`, which means "filter this list".
- **List layout vs board layout.** `cols <= 1` is a list: full task rows
  (subtasks, time tracking, context menu) at list width. `cols >= 2` is a board:
  columns side by side with cards. In a list, stacked panels are **sections of
  one task list**, each a collapsible header with its count; a task matching
  two sections is in both. Drag and keyboard edge moves cross sections through
  the target's rules. A single-section list has no header; the add-task bar adds
  into the first section that takes new tasks (`ViewTaskListRegistry`).
- **`boardCols`** (optional number on `BoardCfg`) remembers a board's column
  count while it is shown as a list, so the Eisenhower Matrix's 2×2 comes back
  after a List ⇄ Board round trip. Read only while `cols <= 1` and only as an
  integer ≥ 2. `getLayoutChanges` is the one helper for the title-bar switch and
  the editor.
- **Shared rule engine:** `src/app/features/tasks/task-criteria/`.
  `matchesTaskCriteria` decides membership for board columns and the task-list
  filter menu; `getChangesToMatch` describes what must change for a task to
  match (tags, project, done, schedule, deadline, priority, backlog) or returns
  `null` when nothing can (it applies the changes to a copy and re-checks).
  Callers dispatch existing actions. Sorting lives there too. Adapters:
  `panelToCriteria`, `filterToCriteria`.
- **The view editor** (`view-editor` inside `board-edit`) shows only the rules
  that are set, with "Add rule" for the rest, a List/Board toggle, a live count
  per section (same helpers as the panel header) and Sort below the rules.
  Planned date is one select over `dueState` + `scheduledState`. Unknown stored
  values show as "Other (kept)" and are saved unchanged. Saving is
  `normalizeBoardForSave(toEditorModel(board))`; `getViewUpdates` compares the
  result with what saving the opened board untouched would store and sends
  only the changed fields (see Decisions). The untouched-save fixtures pin it.
- **Opening the editor:** the view title, a column's title, the side-menu row
  menu, and on list views the title bar's filter button (see Decisions).
  **Save as view…** on a task list prefills it from the list's filter and sort.
  Project and tag lists get "parent tasks only"; Today maps to the
  `todayOrOverdue` planned-date rule (wider than Today's main list; the dialog
  hint says so) and `TODAY_TAG.id` never goes into `includedTagIds`.

## Decisions

- **Cards side by side, task rows when stacked.** Columns need compact cards
  to fit next to each other; a stacked list has the width for full rows and
  gets the list's keyboard moves, subtasks and time tracking. Rows carry the
  `VIEW_TASK_LIST` token so they never act on the previously open project or
  tag. `VIEW` and `VIEW_DONE` are reserved list ids: a view list accepts drags
  only from a `VIEW` list and never a multi-selection; `VIEW_DONE` accepts
  nothing. Rows are built through a panel-owned `TaskWithSubTasksCache` so
  untouched rows keep their object while time tracks (the task row is the hot
  path).
- **Released-client compatibility, no schema bump.** All new fields are
  optional (`dueState`, `deadlineState`, `estimateRule`, `timeSpentRule`,
  `priorityRule`, `sortKey`, `isUntagged`, `boardCols`) and not in
  `DEFAULT_PANEL_CFG`/`DEFAULT_BOARD_CFG` (the board editor and
  `migrate-legacy-backup.ts` merge those into every panel). Persisted types are plain
  `string`/`boolean`/`number`, never closed unions: typia ignores unknown
  properties but rejects an unknown union member (the repair-dialog wedge in
  `validation-fn.ts`). `sanitizePanelCfg` drops `null`/`''` (Formly) and keeps
  any other string, including unknown ones, so a newer client's value
  survives. Released clients keep boards as cards on their Boards page, show
  more tasks in a column with a rule they don't know, and keep the new fields
  when they edit a board (their editor spreads the board). Degradation, no data
  loss. Duplicating spreads the board, so `boardCols` and a newer client's
  top-level fields survive.
- **Stored vocabulary (locked, added 2026-11-01):** this release validates and
  reads the view fields, so their persisted types and words may only be
  extended, never changed or given another meaning; an unknown new word reads
  as "any" here. Types: `dueState`, `deadlineState`, `estimateRule`,
  `timeSpentRule`, `priorityRule` and `sortKey` are strings, `isUntagged` a
  boolean, `boardCols` a number. Words: the `TaskDateRule` strings for the date
  rules; `'none'`; estimate and time-spent minimums as decimal ms strings
  (`'1800000'`); priority `'1'`..`'3'`; `sortBy` wins over `sortKey`;
  `cols <= 1` means a list; `boardCols` is an integer ≥ 2 and is never removed.
  Follow-ups (#11384, #11385, #11386) must respect this: a new rule is a new
  word or a new optional field, not a new meaning for an old one.
- **Released edits that contradict a new rule:** the released board form edits
  only the fields it knows, so it can add required tags to an untagged column
  or set "not scheduled" next to a `dueState`. This client never stores either
  pair, so the released edit is the later intent and wins (`isPanelUntagged`,
  `hasStaleDueState`): the tags apply, or the column has no date; the stale
  flag or date rule is dropped on the next save, which keeps the edit. "All"
  next to a `dueState` doesn't contradict it: the date rule keeps applying and
  a save stores "scheduled" again.
- **Missing-tag guard.** A move or add that would write a tag id with no tag
  entity is refused: a dangling `tagIds` entry fails `isRelatedModelDataValid`
  and sends the state to data repair. All write-back paths go through one
  wrapper, `getPanelChangesToMatch` (`board-panel/panel-rules.ts`); new tasks are
  covered by hiding the add row (`isAddTaskHidden`). The check is per task, so
  excluding a missing tag blocks nothing. The view still renders its columns;
  a callout names the missing tags with one-click **Create Tags**. Tags are
  never created automatically: opening a view is not an intent to create data.
  The existing-tag set is `ViewCriteriaContextService.tagIdSet`, not part of
  `ctx`: a tag change must not re-match every panel.
- **Date rules.** Logical day via `startOfNextDayDiffMs` (sync rule 4),
  reactive to day rollover and the day-start setting. `dueWithTime`
  wins over `dueDay` on boards. Date-string arithmetic only (DST safe); weeks
  start on the user's first day of week. A task without a date never matches a
  date rule. Write-back schedules for the target day (range rules: today, or
  the range's first day; deadlines: the range's last day). An unsatisfiable rule
  (overdue, a minimum estimate or time spent the task lacks) refuses the whole
  move and hides the add row.
- **Partial `updateBoard`.** Editor saves and title-bar actions send only
  changed fields; changed panels take their current `taskIds` from the store.
  A reorder or field that synced in while the dialog was open survives, an
  untouched save sends no op, a rename sends only the title.
- **One user intent = one op, no new action types.** Edits use `updateBoard`,
  order uses `sortBoards`/`updatePanelCfgTaskIds`, write-back uses the existing
  task actions (one `updateTask` merging tags, done and priority, then schedule
  and deadline). The List/Board switch is one `updateBoard` with `cols` and
  `boardCols`. No new effects; remote ops trigger nothing.
- **View rules are edited in the editor only (2026-11-01, #11385).** Editing a
  view's rules through the title-bar filter/sort menu was removed
  (`view-menu-rules.ts` and the customizer panel's "view" mode are gone). On a
  list-layout view the title bar's filter button now opens the view editor,
  like tapping the view title. The editor covers every rule; the menu covered
  only part of them.

## Known gaps and follow-ups

- **#11384 (done, 2026-11-01):** rows below 600 px (`BoardComponent.isListLayout`
  reads `LayoutService.isXs`; the stored `cols` stays, phones get no List/Board
  switch or filter button); one header count rule, open items, for cards, rows
  and the editor (`getPanelItems`); a collapsed Done group on cards (cards
  already had their subtask hint); each part
  renders its first 100 items (`PANEL_SHOWN_LIMIT`, local, never stored), drops
  placed by the rendered item before the marker (`getDropIndex`), a task moved,
  added or focused past the limit shows the whole part; arrow keys leave a
  stacked column at its edges. Accepted: select-all and Shift ranges cover the
  rendered items; moving into a long column can show all of it.
- **#11384, still open:** templates instead of the default boards for new
  installs; Save as view without the "Not completed" rule; small gaps
  (dragging a multi-selection between sections, empty columns without a "+"
  give arrow keys no focus target).
- **#11386:** editor redesign.
- **#11388:** sync order bug. Accepted: concurrent edits of one board are
  last-writer-wins on the board.

### Performance check (2026-11-01)

Optimized build, headless Chromium, 1280×800, 4-core VM; 5,000 generated
tasks, 8 views. Settled times, medians of 3 runs (runs vary 10–20 %).

| Interaction (settled, ms)       |  Before |   After |
| ------------------------------- | ------: | ------: |
| Open Matrix (3,165-card column) |   7,849 |   6,911 |
| Open Kanban (3,728-card column) |   8,219 |   7,790 |
| Open a list view (3 sections)   |   4,504 |   4,093 |
| Baseline: open Today            |   3,721 |   3,076 |
| Baseline: open a project        |   3,547 |   3,232 |
| Editor keystroke, live counts   | 20 / 59 | 21 / 52 |
| Drag a card To Do → In Progress |   2,593 |   1,162 |

- **The cost is rendering, not matching.** About 1.5 ms per card and 3 ms per
  task row, the same per row as Today. Matching rules is under 1 % of the
  profile. The default Matrix and Kanban are slow with this data only because
  one column holds most tasks; bounding long columns is a product decision
  (#11384).
- Drags spent 1.2–1.6 s in style recalc from the app-wide
  `.route-wrapper > router-outlet + *` rule; it is now
  `.route-wrapper > :not(router-outlet)` (one drop: 658 ms → 30 ms). This helps
  every long list.
- The tracking tick costs about what Today's does; a per-task match cache
  showed no gain and was not kept. Not measured: GPU, phones, Electron, memory.

## Tests

- Unit: `task-criteria.spec.ts` (rules, logical day, refusals),
  `boards.util.spec.ts`, `board-panel.component.spec.ts` (write-back, refusals,
  missing-tag guard), `boards.service.spec.ts`, the editor specs.
- Untouched saves: `src/app/features/boards/testing/view-editor-fixtures.ts`
  (default boards, legacy `sortBy`, unknown values and keys, deleted projects,
  missing tags, `boardCols`). An untouched save must send nothing.
- E2E: `e2e/tests/boards/` (sidebar, rules, sections, layout, editor).
- Released clients: `e2e/tests/sync/supersync-views-released-client.spec.ts`
  checks that a released client's whole-board edit keeps the new fields and
  needs no repair. It runs only in the scheduled workflow's released-client job
  ([e2e-scheduled.yml](../../.github/workflows/e2e-scheduled.yml)).
