# Saved views — boards become views in the sidebar

Status: implemented 2026-10-31 (branch `ccr-03c6fb33-93d4kb`), plan revised
after review. Mocks: [Smart Lists Mocks
canvas](https://claude.ai/artifact/9GtPQWm3oEVEzrC6Vh55jf) (private to the
author).

## 1. Problem

Users want saved, rule-based task lists they can open from the menu (#10347,
#10654, #6039; the [market scorecard](../market/scorecard.md) lists "Saved
filters" as an Organization gap, a must-not-lose-badly dimension). Closed
related issues: #3500 (grouping and filters on Today, declined: keep Today
short) and #3667 (filter the schedule view, not planned); neither asked for
saved views in the menu.

Super Productivity already has the engine: a **board column** (`BoardPanelCfg`)
is a saved query over all tasks (tags all/any, exclude, projects, done,
scheduled, backlog, sort) with manual order and write-back on add and drop.
Compared to other apps it lacks:

1. **Access.** Boards sit behind one "Boards" menu entry and a tab bar. A single
   board cannot be opened from the sidebar.
2. **Date rules.** No "overdue / today / tomorrow / next 7 days" column. This is
   the gap the maintainer named on #10347 and the most common rule in other
   apps.

Demand is thin (#10347 and #10654: one author, 0 reactions; #6039: 1 reaction).
The maintainer decided to move boards into the sidebar as views anyway (product
direction, not issue-driven), so this plan keeps the change lean: no new entity,
no new action types, one optional persisted field.

## 2. Prior art

Checked 2026-10 from vendor docs and search results, not hands-on.

| App             | Definition                                              | Combining rules          | Where it lives                                   | Layouts                    |
| --------------- | ------------------------------------------------------- | ------------------------ | ------------------------------------------------ | -------------------------- |
| Todoist         | Text query (`today \| overdue & #Work`)                 | `&`, `\|`, `!`, brackets | Filters page; ★ → sidebar Favorites              | List, board                |
| TickTick (Pro)  | Form: list, tag, date, priority, assignee               | AND, or advanced AND/OR  | Own sidebar entry                                | List, kanban               |
| Apple Reminders | Form: tags, date, time, location, flag, priority, lists | Match all / any          | Sidebar under My Lists                           | List                       |
| OmniFocus 4     | Rule builder incl. date ranges, tags, estimate, search  | Nested All / Any / None  | Perspectives bar, favorites, Quick Open; synced  | Rich group/sort            |
| Vikunja         | Query string (`done = false && project in …`)           | Same as project filters  | Sidebar with filter icon, ★ to Favorites, Ctrl+K | List, table, Gantt, kanban |

Sources: [Todoist filters](https://todoist.com/help/articles/introduction-to-filters-V98wIH),
[TickTick Premium 101](https://blog.ticktick.com/2020/10/30/ticktick-premium-101/),
[MacStories on Reminders smart lists](https://www.macstories.net/stories/reminders-smart-lists-put-unprecedented-control-in-the-hands-of-users/),
[OmniFocus custom perspectives](https://support.omnigroup.com/documentation/omnifocus/universal/4.8.11/en/custom-perspectives/),
[Vikunja saved filters](https://vikunja.io/help/saved-filters).

**Take:**

- A saved view is a **sidebar entry** (all five).
- **Date-relative rules** (overdue, today, tomorrow, next 7 days).
- One saved view can show several columns (Todoist and Vikunja boards on
  filters). Ours keeps per-column rules, more flexible than group-by columns.

**Deliberately don't:**

- A query language (Todoist, Vikunja): parser, error UX and translated syntax
  for a form-sized problem; against "one calm default".
- Nested boolean groups (OmniFocus): all/any per tag rule is what Reminders and
  TickTick ship.
- A separate "smart list" entity next to boards: a second synced model for the
  same idea.
- Task counts on sidebar views: noise; the rest of the sidebar has none.
- Hiding views from the sidebar: every view is in the sidebar; delete removes it.

## 3. Decisions

1. **Boards are views.** No data migration: every `BoardCfg` is shown as a view
   unchanged. Internal names (`boards` slice, `BoardCfg`, `/boards` route,
   `isBoardsEnabled`, action strings, translation keys) stay; user-facing
   English strings change from "board" to "view".
2. **The "Boards" menu entry and the tab bar go away.** A **Views** section in
   the sidebar lists every board in stored order (`boardCfgs`), between the main
   routes/plugin entries and Projects. It has a "+" to create a view, drag to
   reorder (existing `sortBoards`), and a context menu per view (Edit,
   Duplicate, Delete). The section is gated by `isBoardsEnabled`; the "Disable
   feature" entry that the Boards item carried moves to the section header's
   context menu.
3. **One route per view:** `/boards/:boardId`.
   - `/boards` and the id route resolve in a guard (`BoardRouteGuard`) that waits
     for `isAllDataLoadedInitially$` and returns a `UrlTree`, like
     `ValidProjectIdGuard`. Waiting matters: before load the store holds
     `DEFAULT_BOARDS`, so a custom id would look unknown and deep links would
     break on reload.
   - `/boards` → last opened view (`LS.SELECTED_BOARD`, now an id; an old numeric
     value simply isn't found), else the first view, else the page renders an
     empty state with "Create view" (`/boards` stays activatable).
   - Unknown id → `UrlTree` to `/boards` (a guard redirect replaces the URL, so
     no back-button loop).
   - The page watches the board list: when the open view disappears (deleted
     here, in its dialog, or on another device) it navigates to `/boards` with
     `replaceUrl`.
   - `FeatureEnabledGuard` and `FocusOverlayOpenGuard` stay on both routes. The
     mobile bottom-nav slot `boards` and the "Boards" start page keep pointing
     at `/boards`.
4. **Date rule per column:** new optional `BoardPanelCfg.dueState?: string`
   (`overdue`, `today`, `tomorrow`, `next7Days`; absent = any). Details in §5.
5. **Not in this change** (each its own later step, only on demand):
   - list layout for one-column views (full task rows instead of cards);
   - "Save as view…" from the sort/group/filter menu;
   - one shared rule module for board columns and that menu (`TaskCriteria`);
   - deadline, estimate, priority or keyword (#10654) rules on columns;
   - keyboard reordering of sidebar views (drag only, like the board tab bar
     today).

## 4. UI

Matches the mocks, minus §3.5.

- **Sidebar section** (`nav-view-group` component; new `NavItem` type
  `'viewGroup'`):
  - Header like Projects/Tags: expand toggle (`LS.IS_VIEW_LIST_EXPANDED`, wired
    into `MagicSideNavComponent.isGroupExpanded`), "+" button "Create view",
    right-click/long-press menu with "Disable feature".
  - Rows use the nav-item `route` container (`/boards/:id`) so arrow-key
    navigation (`.nav-link`) and `routerLinkActive` work. Titles go through the
    translate pipe (default board titles are keys). Icon: `view_kanban` for
    multi-column views, `filter_list` for one-column views.
  - Per-row context menu (right-click and a more-button, like project rows):
    Edit, Duplicate, Delete.
  - Drag reorder with a CDK drop list scoped to the section, dispatching
    `sortBoards`; verify it doesn't intercept task drags onto project rows.
  - Compact rail: rows show icons with the title as tooltip; the "+" is reached
    via the header context menu (like other sections, extra buttons only show
    with labels).
- **View page** (`BoardsComponent`, now single-view): the existing `<board>` for
  the routed id. The page title in the main header shows the view title with
  the Views section icon (`page-title.component.ts` gets a `/boards/<id>` case
  instead of an extra in-page header). Edit, Duplicate and Delete live in the
  view's side-menu row menu; each panel keeps its edit button. Tab group and
  inline add-board tab are removed.
- **Create:** "+" opens `DialogBoardEditComponent` in create mode: title "Create
  view", no Delete button, closes with the saved board id, and the caller
  navigates to `/boards/<newId>`.
- **Delete** of the open view: handled by the page's "view disappeared" watcher.
- **Column editor:** panel form gets a "Due date" select (Any, Overdue, Today,
  Tomorrow, Next 7 days). While a due date is set, the "Scheduled state" field
  is hidden (`expressions.hide`, `resetOnHide`): a due date implies scheduled.
- **Android back button:** `/boards/<id>` counts as a top-level destination
  (`android-back-button.service.ts`, match by prefix).
- **Strings** (`en.json` only, keys unchanged): `MH.BOARDS` → "Views", the
  feature toggle label and `BOARDS_HINT`, `ONBOARDING.WANT_MORE.BOARDS`, "Add new
  board" → "Create view", "Edit board" → "Edit view", the delete confirmation,
  `NO_PANELS_*`, and other strings that call the whole thing a board. No
  placeholders change, so other languages stay as they are until translators
  update them.

## 5. Date rule semantics

Pure helpers in `boards.util.ts`, next to `doesTaskMatchPanel` and
`rewriteTagIdsForPanel`:

- `getPanelDueState(panelCfg): BoardPanelDueState | undefined` narrows the
  stored string; unknown values → `undefined` (any).
- A task's **logical due day**: `dueWithTime` wins (as in `task.selectors.ts`
  and `get-scheduled-date-color.ts`): `getDbDateStr(dueWithTime -
startOfNextDayDiffMs)`; else `dueDay`; else none.
- `doesTaskMatchPanel(task, panelCfg, isInBacklog, dueCtx)` with `dueCtx = {
todayStr, startOfNextDayDiffMs }`. The panel reads both from the store
  selectors `selectTodayStr` and `selectStartOfNextDayDiffMs`, which are
  reactive (day rollover and a changed day-start setting both refresh columns).
  - `overdue`: `isTaskOverdue(task, todayStr, startOfNextDayDiffMs)`, the same
    predicate as the overdue section and the red date colour.
  - `today`: due day = today; `tomorrow`: = today + 1; `next7Days`: today ≤ due
    day ≤ today + 6. Day arithmetic on local dates via `dateStrToUtcDate` (DST
    safe), never `new Date(str)`.
  - A task without a due date never matches a set `dueState`.
- **Write-back target** `getDueDayForPanel(task, panelCfg, dueCtx)` →
  - `undefined`: no date change needed (no rule, or the task already matches);
  - a day string: schedule for that day (`today`/`tomorrow`; `next7Days` when
    out of range → today);
  - `null`: unsatisfiable (`overdue` for a task that isn't overdue).
- **Applying it**:
  - Drops and keyboard moves (`moveTasks`): check **every** moving id first; if
    any is `null`, refuse the whole move (return `false`). The CDK enter
    predicate does the same check for the dragged item (it only sees that one).
    Tasks with a day go through `TaskBulkActionService.scheduleFor({ date:
dateStrToUtcDate(day) }, tasks)`, which keeps a task's time of day and uses
    `planTasksForToday` / `planTaskForDay`. The schedule dialog for `Scheduled`
    columns is skipped when `dueState` is set; the unschedule for
    `NotScheduled` cannot occur (field hidden and reset).
  - Inline add, new task: same write-back after creation; the `overdue` column
    hides the add row.
  - Inline add of an existing task (the `!isNewTask` branch): also writes back
    the due day (today only tags are rewritten).
- **Unknown values** are treated as "any" when read, never rejected or
  rewritten (see §6).

## 6. Sync, persisted model and long-term cost

- **Persisted model:** one optional field on the `boards` slice,
  `BoardPanelCfg.dueState?: string`; absent = any. No schema bump (rule 10).
  Not added to `DEFAULT_PANEL_CFG` (the board editor and
  `migrate-legacy-backup.ts` merge that into every panel).
- **Validation:** typia `createValidate` ignores unknown properties, so released
  clients accept panels carrying `dueState`. A string-literal union would be a
  closed membership check (the repair-dialog wedge `validation-fn.ts`
  describes), so the persisted type is `string` and the union lives in code
  only.
- **`sanitizePanelCfg`** deletes `dueState` when it is `null`, `''` or not a
  string (formly writes `null` for "Any", like `sortBy`), but keeps any other
  string, including values it doesn't know. Dropping unknown values would lose a
  newer client's setting on the next `updateBoard`, which replaces `panels`.
- **Released clients** ignore `dueState`: such a column shows every task matching
  its other rules there, and a drop there reorders `taskIds` without
  scheduling, so on new clients the task leaves that column. They keep their
  Boards tab page with all views. They also keep `dueState` when they edit a
  board, because `BoardEditComponent` spreads panels (pinned by a unit test).
  Acceptable degradation, no data loss.
- **Ops:** no new action types or effects. Column edits use `updateBoard`,
  ordering uses `sortBoards`, scheduling on drop uses the existing scheduling
  actions. A drop still emits one op per kind of change (tags, project, schedule,
  order), the existing pattern, with no new multi-entity action. Remote ops
  trigger nothing new.
- **Growth:** none; boards are user-created and few. **Plugin API:** untouched.

## 7. Implementation steps

1. Model and pure helpers: `BoardPanelDueState`, `dueState?: string`,
   `getPanelDueState`, `getLogicalDueDay`, due checks in `doesTaskMatchPanel`,
   `getDueDayForPanel`, `sanitizePanelCfg` handling. Unit tests.
2. Column behaviour: `board-panel.component` (context from selectors, write-back
   in `moveTasks` / `afterTaskAdd`, enter predicate, hide add row for
   `overdue`); `boards-form.const.ts` (Due date select, hide scheduled state).
3. Dialog create mode: `DialogBoardEditComponent` takes `isCreate`, hides
   Delete, uses the create title, closes with the board id.
4. Routing: `boards/:boardId` route, `BoardRouteGuard`, single-view
   `BoardsComponent` with the disappeared-view watcher and header menu; a small
   `BoardsService` for create/edit/duplicate/delete shared by page and sidebar.
   `page-title.component.ts` and `android-back-button.service.ts` updates.
5. Sidebar: `'viewGroup'` nav item, `nav-view-group` component, expansion state,
   remove the Boards route item, move "Disable feature".
6. Strings in `en.json`; wiki `4.05-Board-View.md`,
   `3.02-Settings-and-Preferences.md`.
7. E2E updates (§8).

## 8. Tests

- **Unit:**
  - `boards.util.spec.ts`: each `dueState` incl. a 4-hour day start at 02:00,
    `dueWithTime` precedence, +6 days across a DST change, no due date,
    unknown value = any; `getDueDayForPanel`; `sanitizePanelCfg` with `null`,
    `''`, unknown string.
  - `board-edit` / reducer: saving a board keeps an unknown panel key.
  - `board-panel.component.spec.ts`: write-back day, refusal of a multi-select
    move with one unsatisfiable task, no schedule dialog when `dueState` is set.
  - `BoardRouteGuard`: waits for data load, unknown id, legacy numeric LS value,
    no boards.
  - Nav config: views section when enabled, no Boards route item.
  - `page-title` and android back-button specs for `/boards/<id>`.
  - `DialogBoardEditComponent` create mode.
- **E2E** (feature is off for new installs, so specs enable it):
  - Update `e2e/tests/boards/*`, `scheduled-date-colors.spec.ts`,
    `supersync-reorder-conflict-wedge.spec.ts`, store-screenshot scenarios
    (`e2e/store-screenshots/scenarios/{mobile,tablet,desktop}/all.spec.ts`),
    `store-video/scenarios/updates.spec.ts`, and the doc example in
    `e2e/video-kit/scene.ts` to open `/#/boards/<id>` (default ids
    `KANBAN_DEFAULT`, `EISENHOWER_MATRIX`) instead of clicking tabs.
  - New `e2e/tests/boards/views-sidebar.spec.ts`: create a view from the
    sidebar "+", it appears and opens; the Boards menu entry is gone; reload on
    `/#/boards/<customId>` stays on that view; deleting the open view moves to
    another view; a Today column schedules a task moved in with the keyboard
    for today; an Overdue column refuses it.
- **Checks:** `npm run checkFile` on changed `.ts`/`.scss`;
  `npm run quiet -- test:affected`; the changed E2E specs with
  `npm run quiet -- e2e:file <path> --retries=0`.

## 9. Risks

- **Muscle memory:** users who opened Boards from the menu now find views in
  the sidebar. The bottom-nav slot and start page still work.
- **Long sidebars** for users with many boards: the section collapses; folders
  only if asked.
- **Mixed wording** in other languages ("Boards" in menus that now say "Views"
  in English) until translators catch up.
- **E2E churn** across board specs; mechanical.

## 10. Phase 2 — full rules, save as view, title menu, list layout

Decided 2026-10-31 by the maintainer: don't wait for usage, build the best
form now. Four parts, in this order; A is a prerequisite and lands as its own
commits so it can be reviewed (or split out) on its own.

### A. One rule module for columns and the filter menu (prerequisite)

Today two engines decide whether a task belongs: `doesTaskMatchPanel` (board
columns) and `TaskViewCustomizerService.applyFilter` (the sort/group/filter
menu). They support different rules, and the menu's date filter uses the
calendar day instead of the logical day.

New pure module `src/app/features/tasks/task-criteria/`:

- `TaskCriteria` (in memory only, never persisted): tags (include all/any,
  exclude all/any, untagged), project ids, done state, parent only, scheduled
  state, backlog, planned-date rule, deadline rule, minimum estimate (or none),
  minimum time spent (or none), priority (or none).
- Date rules: `overdue`, `todayOrOverdue`, `today`, `tomorrow`, `next7Days`,
  `thisWeek`, `nextWeek`, `thisMonth`, `nextMonth`, `none`. Logical day via
  `startOfNextDayDiffMs`; weeks start on the user's first day of the week.
- `TaskCriteriaCtx`: today, offset, first day of week, backlog lookup, plus
  bounds derived once (`createTaskCriteriaCtx`), as `createBoardDueCtx` does now.
- `matchesTaskCriteria(task, criteria, ctx): boolean`.
- `getChangesToMatch(task, criteria, ctx): TaskMatchChanges | null` — what has
  to change so the task matches: tags, done, project, schedule day or
  unschedule, deadline day or no deadline, priority, backlog move; `null` when
  no change can satisfy a rule (overdue, minimum estimate or time spent the
  task doesn't meet). Only a description: callers dispatch existing actions.
- Adapters: `panelToCriteria(BoardPanelCfg)` and `filterToCriteria(filter,
lookups)` (the menu's legacy title-substring tag/project presets resolve to
  ids at evaluation time, so their behaviour is unchanged).
- Board columns and the filter menu both match through it. Board write-back
  uses `getChangesToMatch` instead of its own per-field code. The filter menu's
  date filter moves to the logical day (behaviour fix, noted in the PR).
- The grouped-by-tag drop in task lists (`_retagAcrossGroups`) stays as is.

### B. Every filter-menu rule on columns

New optional persisted panel fields, all plain strings/booleans (closed unions
would fail typia on clients that don't know a new value, see §6):

| Field               | Values                                                                  | Write-back on move/add                                                                                          |
| ------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `dueState` (exists) | adds `todayOrOverdue`, `thisWeek`, `nextWeek`, `thisMonth`, `nextMonth` | schedule for today (or the first day of the range if today is outside it); `todayOrOverdue` keeps overdue tasks |
| `deadlineState`     | the date rules incl. `none`                                             | set deadline day like the planned date; `none` removes it; `overdue` refuses                                    |
| `estimateRule`      | `none` or a minimum in ms (`600000` …)                                  | refuse unless it already matches                                                                                |
| `timeSpentRule`     | `none` or a minimum in ms                                               | refuse unless it already matches                                                                                |
| `priorityRule`      | `none`, `1`, `2`, `3`                                                   | set the priority                                                                                                |
| `isUntagged`        | boolean                                                                 | remove all tags                                                                                                 |

- Sorting: `sortBy` is a closed union persisted today, so new sort keys can't
  go there. New `sortKey?: string` adds `deadline`, `timeSpent`, `priority`,
  `tag`; when it is one of the old four, `sortBy` is written too, so released
  clients keep sorting. Read `sortKey ?? sortBy`.
- The board form gets the new fields (estimate/time spent/priority as selects,
  untagged as a checkbox that hides the tag fields).
- Released clients ignore the new fields: such a column shows more tasks there,
  and drops there apply only the old rules. Same degradation as `dueState`.

### C. "Save as view…" from the filter menu

- New item in the sort/group/filter menu, on project, tag and Today task lists.
- Opens the create dialog prefilled: title = the list's title, one column,
  `cols: 1`; context rule = the project (`projectIds`, not backlog), the tag
  (`includedTagIds`), or for Today `dueState: todayOrOverdue`; plus the
  current filter mapped to its rule and the current sort mapped to `sortKey`.
  Undone tasks only, like the list.
- Grouping is not saved: columns don't group. The dialog says so in a hint
  when a grouping is active.

### D. View menu in the title bar

- The Edit/Duplicate/Delete menu becomes a small `view-menu` component shared by
  the side-menu row and the title bar.
- On `/boards/<id>` the title bar shows its more-button with that menu under the
  same condition as the project menu (not on the narrowest screens).
- The title icon is the view's own icon (list or board).

### E. List layout for one-column views

- A view with `cols: 1` (one or more stacked columns) is laid out at list
  width, centered, like a project list, instead of spanning the page. Still
  board cards; full task rows stay out (needs a work context, hot path).

### Revised after plan review (2026-10-31)

These override the parts above where they differ.

- **Deadline write-back.** `setDeadline` auto-plans a task whose deadline is
  today into Today (`getDeadlineAutoPlanDecision`, and `TaskDueEffects` again at
  day change). So: `today`/`todayOrOverdue` write today; range rules
  (`next7Days`, `thisWeek`, `nextWeek`, `thisMonth`, `nextMonth`) write the
  **last** day of the range ("due by"); `overdue` refuses; `none` removes it.
  The auto-plan fields are still sent (the effect would apply them anyway).
  Deadline `overdue` uses the day threshold (`todayStartMs`), not `Date.now()`.
- **Self-check.** `getChangesToMatch` applies its changes to a copy of the task,
  simulates the deadline auto-plan, and runs `matchesTaskCriteria`; if the
  result doesn't match it returns `null`. This also catches contradictory rules
  (deadline today + not scheduled), so the form needs no extra validation.
- **Apply order and op count.** One function applies the changes in this
  order: project (`moveToOtherProject`, parent with subtasks) → backlog (on
  `parentId || id`; `null` from `getChangesToMatch` when the target project has
  no backlog) → **one** `updateTask` merging tags, done and priority →
  schedule/unschedule → deadline. That is fewer ops per drop than today.
- **Semantics both engines need**, kept exactly:
  - project rule is `all` | ids | `none` (a menu project search that matches
    nothing shows nothing);
  - tag match default: board include = all, menu = any; a menu tag filter whose
    tags were all deleted applies no filter;
  - time spent: "not specified" is `timeSpent === 0`, a minimum sums
    `timeSpentOnDay`; estimate minimum is `>=`;
  - the menu reads `dueDay` before `dueWithTime`; boards keep `dueWithTime`
    first. The module takes the precedence as a ctx flag until the two are
    reconciled, so neither engine changes behaviour silently (beyond the
    logical-day fix);
  - weeks: `getWeekStartDate` plus date-string arithmetic (not `getWeekRange`,
    which shifts by the timezone offset); first day of week from
    `GlobalConfigService.localization()`, so columns react to a change;
  - the filter menu re-filters on `selectTodayStr` and
    `selectStartOfNextDayDiffMs` too, so the logical-day fix doesn't go stale.
- **Sorting moves into the module too** (collator, end-of-day for date-only
  values (#9828), priority high first, tag order from the side menu with DESC
  flipping the group order), so a saved view sorts like the list it came from.
  Boards switch to it as well; their existing sorts keep their direction.
- **`sortKey`.** Written only for keys `sortBy` can't hold (deadline, time spent,
  priority, tag) and deleted otherwise; read `sortBy ?? sortKey`, so a later
  choice on a released client wins. Gap: a released client clearing the sort
  can't clear a new key.
- **Sanitizing.** `sortKey`, `deadlineState`, `priorityRule`, `estimateRule`,
  `timeSpentRule` drop `null`/`''` (Formly) and keep unknown strings;
  `isUntagged` drops non-booleans. Persisted types are `string`/`boolean` only.
- **Inline add.** Columns whose rules can only refuse (estimate or time-spent
  minimum, deadline `overdue`, planned `overdue`) hide the add row. `priority`
  goes into the create op (`additionalTaskFields`). The existing-task branch
  applies the full `getChangesToMatch`.
- **Save as view.**
  - Project and tag lists: `isParentTasksOnly: true` (the lists filter parents);
    Today: `false`. `TODAY_TAG.id` never goes into `includedTagIds`.
  - Today maps to `todayOrOverdue`, which is wider than Today's main list
    (overdue sits in its own panel there, timed tasks later today are split
    off); the dialog hint says so.
  - With no sort active, the column's `taskIds` are prefilled with the list's
    visible order.
  - The item is hidden while Views are switched off.
  - Legacy title-substring filters become fixed ids at save time; deleted tag
    ids are dropped.
- **Title-bar menu.** A separate `isViewPage` branch (`/boards/<id>` only)
  renders only `view-menu`; the special-section branch stays as is. The title
  icon is the view's icon on view pages. This reverses "Not taken: header
  menu" from the implementation review.
- **Kept against the review's suggestion to cut:** estimate and time-spent
  column rules, and the tag sort — the maintainer asked for every filter-menu
  rule.

### Tests

- Unit: the criteria module (every rule, logical day, week start, ranges,
  changes-to-match incl. refusals); adapters; the filter menu spec keeps
  passing (plus the logical-day fix); board panel write-back per rule;
  `sortKey`; save-as-view mapping per context and filter; `view-menu`;
  page-title menu condition.
- E2E: save a filtered project list as a view and see the same tasks; a
  priority column sets priority on move; the title-bar menu duplicates and
  deletes; one-column view width.
- Added after review: a parity test of the old `applyFilter`/`applySort`
  against the module on shared fixtures (written before the old code goes); a
  property test "apply `getChangesToMatch`, then the task matches" including
  auto-plan cases; filter menu re-evaluates at day change and when the start
  of day changes; `sortKey` vs a released-client `sortBy` edit; sanitizing per
  new field; a deadline-column E2E with the Today interplay; a save-as-view E2E
  checking subtasks and order against the source list.

## 11. Phase 3 — one-column views as real task lists

Decided 2026-10-31: with one rule engine for columns and lists, a view with a
single column renders like a filtered task list (full task rows, subtasks,
time tracking, context menu) instead of board cards.

- **When:** `cols <= 1` and exactly one panel. Multi-column views keep cards.
- **Where:** a list mode of `BoardPanelComponent`, so matching, write-back and
  the add-task row stay in one place. `BoardComponent` sets it.
- **Rows:** the panel's matching tasks as `TaskWithSubTasks`: a parent carries
  all its subtasks (like a project list); a matching subtask whose parent also
  matches is shown under the parent only; one whose parent doesn't match is a
  row of its own (like Today). Order: the panel's sort, else its `taskIds`.
- **Done tasks:** when the panel shows done and undone tasks, done ones go to a
  collapsed "Done" section below; drops into it are refused.
- **Reordering:** a new reserved list id `VIEW`. `task-list` accepts drops into
  it only from the same list; a reorder writes the panel's `taskIds`
  (`updatePanelCfgTaskIds`, already synced) instead of the open project's or
  tag's order, and doesn't reset the filter menu's sort. Disabled while the
  panel is sorted. Multi-select group drags are refused (as for other
  non-project lists today). Subtask lists inside rows work as everywhere.
- **No work context:** task rows on a view page must not act on the project or
  tag that was open before (the active context stays in the store). A new
  injection token `VIEW_TASK_LIST` (tasks feature, like `TASK_CARD_LIST`),
  provided by the panel, tells rows and the task list they are in a view:
  - keyboard move up/down/top/bottom of a top-level row reorders the view;
  - "is Today open" is false (add/remove-to-Today buttons behave as in a
    project list);
  - the backlog key and the context menu's backlog items are off.
- **Hot path:** the task component gets one optional injection and three
  guarded branches, no template calls or new subscriptions.
- **Tests:** panel row building (subtask placement, order, done split), the
  task-list VIEW drop path and predicate, task row moves via the token, E2E:
  a one-column view shows task rows with subtasks, reorder by drag and by
  keyboard persists after reload, the Today buttons don't depend on the list
  opened before.

### Revised after plan review (2026-10-31)

- **Re-renders (blocker).** The panel's task list emits every second while a
  task tracks time. Rows are built through a panel-owned
  `TaskWithSubTasksCache` (the logic of `selectTasksWithSubTasksByIdsFactory`,
  extracted as a pure helper) and the row computeds are array-equal, so
  untouched rows keep their object. The done section's list renders only once
  it is expanded (local state, never a synced field).
- **Only a single-panel, one-column view is a list.** Tried first: every
  panel of any `cols <= 1` board as a list. Dropped, because custom boards
  default to `cols: 1`, so every existing stacked board would silently turn
  from cards into lists and lose its keyboard moves between panels. Adding a
  second panel shows cards again (the editor makes that visible). The host's
  `placeRow` still handles a task from another panel via the column rules.
- **What counts as a view row** is what is rendered top-level
  (`host.isRow(id)`), not `!parentId`: a subtask shown on its own reorders the
  view. Keyboard move up/down/top/bottom and the context menu's "Move to
  top/bottom" both go through the token, before the done-task early return.
- **Placement** goes by anchor (`afterTaskId`), converted to the panel's own
  index space; the token carries callbacks (`placeRow`, `moveRow`, `isRow`,
  `tagsToHide`, `isManualOrder`), so `tasks/` imports nothing from `boards/`.
- **Drop predicate:** the `VIEW` check comes first and keys on
  `drop.data.listModelId`; it accepts only drags from a `VIEW` list, and never
  a multi-selection (one behaviour whatever list was open before). `VIEW` and
  `VIEW_DONE` are reserved list ids; `VIEW_DONE` accepts nothing. A drop into
  a sorted panel's own list does nothing.
- **Multi-select:** in list mode the panel drops its
  `data-board-selection-scope` host attribute, so Shift-range and Ctrl+A use
  the task list as scope.
- **Chips:** rows in a view show the project chip and hide the tags the column
  requires (like the cards), not the previously open context's.
- **Empty state** ("No tasks match this view") and a header count of rows.
- **Known gap:** the multi-select bar's and bulk shortcut's "move to backlog"
  still follow the active context (as on card views today).

## 12. Phase 4 — sections, the filter menu on views, list polish

Decided 2026-10-31 (user: "do 1, 2 and 3"): a one-column view is a list in
every respect. Its stacked panels are sections of that list, the title bar's
filter/sort menu edits the view's rules, and the leftover board parts go.

### A. Stacked panels are sections of one list

- **When:** `cols <= 1`, any number of panels (phase 3: one panel only).
  Boards with two or more columns keep their cards. This changes how existing
  custom stacked boards look (cards → sectioned list); nothing stored
  changes and released clients still show cards. It is acceptable only with
  the keyboard parity below, so the rows lose nothing the cards had.
- **One panel:** no section header at all (title and edit button repeat the
  title bar), see C.
- **Several panels:** each panel is a section: a `collapsible` header with the
  panel title and its open-row count (like Today's "Overdue" section),
  expanded by default; the expanded state is local only (never synced). Each
  section keeps its own done subsection (phase 3 logic, per panel).
- **Every panel shows what matches it**, as columns do: a task matching two
  sections is in both. No first-match rule: it would make a move into a later
  section look like it failed when the task still matches an earlier one.
- **Drag between sections:** the target section's `task-list` (`VIEW`) accepts
  a row from another section when the column rules can make it match
  (`ViewTaskListHost.canEnter(task)`, the panel's existing `canEnter` check);
  the drop goes through `placeRow` → `moveTasks` (already built for this in
  phase 3). Refusals show the existing snack.
- **Keyboard parity with cards:** move up at a section's first row (or down
  at its last) moves the row into the previous (next) section through its
  rules, at the bottom (top), via the board's existing `adjacentPanel`
  (`direction: 'up' | 'down'`, `taskIds`). Works whatever the sort (cards do
  the same: the edge move is not a reorder). Focus follows the moved row:
  `focusRow` in list mode focuses the task row element by id.
- **Add row per section:** sections keep their inline add row ("Add task" in
  that section, the section's rules applied), since that's how you add to a
  specific section. A single-panel list has none (see C).

### B. The filter/sort menu edits the view

- **Where:** the title bar on a view page gets the same filter button
  (`task-filter-btn`, same shortcut) before the view's "More actions" menu.
  It opens the same `task-view-customizer-panel` in **view mode**
  (`[view]="board"` input). Shown for every view; the panel's sort and filter
  items apply to all of the view's panels.
- **What the items do in view mode:** each click is one `updateBoard` op
  (`panels` replaced) built by pure functions in `boards/view-menu-rules.ts`:
  - **Sort:** sets `sortKey`/`sortDir` on every panel (`withPanelSortKey`),
    "Default" = manual order. Shown as selected when all panels agree.
  - **Filter, per type:** sets that rule on every panel and leaves the other
    rules alone (planned date → `dueState`, or `scheduledState` NotScheduled
    for "Not specified"; deadline → `deadlineState`; estimate →
    `estimateRule`; time spent → `timeSpentRule`; priority → `priorityRule`;
    tags → `includedTagIds` + `includedTagsMatch`, "Not specified" →
    `isUntagged`). Several filter types can be active at once (unlike a list,
    whose menu holds one filter); each type shows its current preset checked
    when all panels agree. Clicking the checked preset clears that rule.
  - **Hidden in view mode:** "No filter" and "Reset all" (they would wipe the
    view's own scope), "Save as view…", the project text search (one op per
    keystroke, and the editor picks projects by id), and Group by (sections
    are edited in the editor; a list's dynamic groups don't map to static
    panels). "Save sort as default" stays list-only.
- **Template:** the panel reads selection state through one computed
  `activeFilters` (`Partial<Record<FILTER_OPTION_TYPE, FilterOption>>`)
  instead of `selectedFilter().type === X` comparisons; for lists it holds the
  one selected filter, so list behaviour is unchanged. Clicks go through the
  panel's `onX` methods, which branch on view mode.
- **Not in view mode** the menu and service behave exactly as today.
- **Sync:** `updateBoard` is already a synced, LWW entity update; rule values
  are the same plain strings/booleans as phase 2. No new persisted field.

### C. List polish

- **Single panel: no panel header.** The count and estimate move to a slim
  status line above the list (`[count] tasks · ~estimate`), right-aligned as
  the header did, without the title and edit button. Sections show count in
  their header and the estimate next to it.
- **Adding a task:** a single-panel list drops its inline add row. Instead
  the regular add-task bar (header "+", the add-task shortcut, the mobile
  button) adds into the open view: while a list-layout view is open, its
  first panel that accepts new tasks registers as the add target
  (`ViewAddTargetService`, root, a signal set/cleared by the panel), and
  `app.component` passes its `additionalFields`, `tagsToRemove`,
  `isNoDefaults` and forwards `afterTaskAdd` to it (the panel's existing
  `afterTaskAdd`: order, dates, backlog). Without a target the bar works as
  today. Today that bar adds to the stale previous context, so a new task
  often doesn't show in the view.
- **Gaps from phase 3:**
  - "Move to top/bottom" in the task detail panel: through
    `VIEW_TASK_LIST` when the detail panel's task is a row of the open view
    (the add-target service also exposes the open view's hosts by task id).
    Otherwise as today.
  - An undone matching subtask whose parent is done: shown as its own row in
    the open rows (the parent is not a row for it), not inside Completed.
  - E2E for drag reordering in a view.

### D. Save as view keeps grouping

- A list grouped by **tag** becomes one section per tag that the list's
  tasks carry (sidebar order) plus "No tag" (`isUntagged`); grouped by
  **project**, one section per project. Each section = the list's base rules
  plus the group's rule (tag: added to `includedTagIds`, match `all`). A tag
  list's own tag gets no section and no "No tag" (they can't match).
- Grouping by planned date or deadline keeps the "grouping isn't saved" hint:
  per-day groups don't make sense as fixed sections.

### Tests

- Unit: `view-menu-rules` (each filter type set/clear on all panels, sort,
  "all panels agree" display state); customizer panel in view mode (hidden
  items, a click dispatches one `updateBoard`); board-panel sections (list
  layout for `cols <= 1` with several panels, edge moves emit `adjacentPanel`,
  `canEnter` via the token, add target registration); task-list predicate for
  a row from another section; save-as-view grouping → sections; the subtask
  under a done parent.
- E2E: a stacked view shows sections; drag and keyboard move a row into the
  next section and its rule applies; the title-bar filter sets a rule on the
  view (survives reload) and clicking it again clears it; the add-task bar
  adds into the open view; drag reorder in a single-panel view persists.
  Existing stacked-board tests move from cards to rows.

### Revised after plan review (2026-10-31)

These override the parts above where they differ.

- **Filter menu only on list views, and only for rules the panels share
  (blocker).** Setting a type "on every panel" overwrites what defines the
  panels: the Kanban's In-progress tag, the Eisenhower tags, date sections,
  D's tag sections. So: the title-bar filter button shows on list-layout
  views (`cols <= 1`) only; multi-column boards keep the editor. In view mode
  a filter type is editable only when every panel has the same value for it
  or none has it. Otherwise its submenu is disabled with a "Differs per
  section, edit the view" hint. Sort stays view-wide (it changes order, not
  membership). Clicking the selected sort again flips `sortDir`, as in lists.
- **One mapping.** `view-menu-rules` builds fields through `filterToCriteria`
  → `criteriaToPanelFields` (the save-as-view path), then
  `normalizeBoardForSave`, so the "a due rule implies scheduled" coupling and
  sanitizing match the editor. Clearing planned date deletes `dueState` and
  sets `scheduledState: All`. That also clears a "Scheduled" the editor had
  set, which is accepted because the two can't be told apart once stored.
  The tag chip input is one op per chip.
- **View mode does not touch the list customizer state.** There is no
  `isCustomized` dot (a view always has rules). Neither the list's
  per-context localStorage entry nor the stale context's sort is read or
  written. The `C` shortcut opens the view menu, so the view trigger keeps
  the `customizerMenuTrigger` ref and the panel sits in the same `@if` block.
- **Focus after an edge move (blocker).** `moveRow` returns whether the row
  left the section. When it did, the task row skips its own `focusSelf`
  timeouts, because the old host may be a leaving row (§ Footguns, about
  225 ms). In list mode `rows()` returns the panel's own `task` hosts
  without destroyed ones (from the component layer). `focusRow(…, taskId)`
  looks inside this panel only, since a task in two sections has two
  `#t-<id>` hosts. It runs `afterNextRender`. `reanchorAfterMove` gets those
  rows too. An edge move into a collapsed section expands it first.
- **Collapsed sections build nothing.** `collapsible` projects its content,
  so a projected `task-list` is created even while collapsed. Each section
  body (add row, task list, done subsection) sits in
  `@if (isSectionExpanded())` in the panel template, like the done list.
  Section collapsibles use `[isGroup]="true"`, as Today's Overdue section
  does, so arrow keys and ArrowLeft/Shift+Arrow reach their headers.
- **Parity, corrected.** Cards also moved a multi-selection between panels.
  The edge move therefore takes the selection when the focused row is
  selected and every selected id is a row of this section (the cards'
  `_taskIdsToMove` over `mainRows`). Done rows don't cross sections. Known
  gaps (in the PR): dragging a multi-selection between sections, and dragging
  a nested subtask into another section, which cards allowed when the
  subtask was its own card. An empty section must stay a drop target, because
  the list's padding sits outside `.task-list-inner` (E2E).
- **Add target lives in `tasks/`.** One root `ViewTaskListRegistry` next to
  the token holds the open view's hosts in order. `BoardComponent` sets them,
  so "first section that accepts new tasks" doesn't depend on registration
  order. The detail panel's Move to top/bottom uses the first host where
  `isRow(id)`. `app.component` reads the add target when the bar submits and
  ignores it once the view is gone. It also passes `taskIdsToExclude` and an
  explicit `projectId`: the panel's project, else the configured default
  project or Inbox. Without that, `isNoDefaults` still takes the stale
  context's project (`defaultProject$`).
- **D: an "Other" section instead of "No tag"; project grouping isn't
  saved.** In a tag list, tasks carrying only the list's tag sit in the
  list's "No tag" group, so dropping that section loses them. Fixed sections
  also lose tasks whose tag is created after saving. So the last section is
  "Other": the base rules plus `excludedTagIds` = the section tags, with
  `excludedTagsMatch: 'any'`. That covers untagged tasks and new tags, and
  released clients understand it (`isUntagged` would show everything there).
  Grouping by project gets the "grouping isn't saved" hint, because a column
  can't exclude projects, so new projects would vanish.
- **Sync, accepted gaps (in the PR).** Each menu click is one `updateBoard`
  built from the store's current board, with only `panels` in `updates` and
  rule clears as deleted keys (no `null` or `undefined`). Two concurrent menu
  edits conflict on the board's id, and LWW keeps one whole board on every
  client. A menu edit carries every panel's `taskIds`, while
  `updatePanelCfgTaskIds` is keyed by the panel id. So a concurrent reorder
  isn't detected as a conflict, and the panel order can differ between
  clients until the next write. This affects order only and already happens
  with the editor. No new persisted field and no new action.
- **Tests added:** the menu on Kanban/Eisenhower (no button) and on a view
  whose sections differ by tag (tag submenu disabled); clearing planned date;
  the sort flip; focus lands on the moved row in the target section,
  including when the task already matches both sections and when the target
  is collapsed; edge move of a selection; collapsed sections render no
  `task`; the bar in a view without a project rule doesn't use the
  previously open project; after leaving the view, the bar adds as before;
  save-as-view from a tag list grouped by tag keeps tasks that carry only the
  list's tag; a tag created after saving shows in "Other".

## 13. Phase 5 — a friendlier view editor

Asked 2026-10-31: "make the boards config UI more user friendly". This is a UI
change only: the stored `BoardCfg`, the save path (`normalizeBoardForSave`,
one `addBoard`/`updateBoard` op) and the dialog's API stay as they are.

### What is wrong today (screenshots of the create dialog)

1. A new view opens with **no section**. You have to find "Add new Panel" at
   the bottom before anything shows.
2. The title shows **"This field is required" in red** before you type.
3. **"Columns"** is a bare number. Whether it gives a list (1) or a board
   (2+) isn't said anywhere.
4. A section is a **narrow card of 15 stacked fields**, all shown even when
   set to "Any": about 1300px of scrolling for one section. The fields you
   need most (project, tags) sit next to rare ones (backlog, time spent),
   with project near the bottom.
5. **"Planned date" and "Scheduled State"** are two controls for one
   question.
6. **"Panel"** is jargon. Sections can't be told apart without reading every
   field, and reordering hides in a ⋮ menu as "Move backward/forward".
7. **No feedback** on what the rules match until you save.

### Design

- **A dedicated editor component** (`view-editor`, in `boards/`) replaces
  the Formly form inside `board-edit`, so `dialog-board-edit` still reads a
  validity flag and calls `save()`. It edits a copy of the board; values it
  doesn't show (unknown rule values from newer clients, `taskIds`) are
  carried through untouched.
- **Top:**
  - The view's title. Its required error shows only after the field was
    touched.
  - **Layout:** a two-option toggle, **List** (`cols: 1`) or **Board**. Board
    shows a "Columns" number (2–6; it defaults to the number of sections,
    capped at 6). A one-line hint says what the layout does: "Sections stack
    in one task list" or "Columns side by side, tasks as cards".
- **Sections** (List) or **Columns** (Board). The heading and the button
  ("Add section" or "Add column") follow the layout; "panel" is no longer
  used.
  - A new view starts with one section, expanded.
  - In a List with one section, that section's title is hidden, because
    nothing shows it. On save it takes the view's title.
- **A section card:**
  - **Header:** the title (inline input), a one-line summary of its rules when
    collapsed ("Not completed · Due today · #work · High priority"), the
    live count ("12 tasks"), an expand toggle and a ⋮ menu (Move up, Move
    down, Duplicate, Delete).
  - **Body:** "Show tasks that match", listing only the rules that are set,
    one row each (label, control, remove ✕). Then **"Add rule"**, a menu of
    the rules not yet set, grouped:
    - Where: Project, Backlog
    - Tags: Required tags, Excluded tags, Without tags
    - When: Planned date, Deadline
    - Status: Completion, Only parent tasks
    - Effort: Priority, Estimate, Time spent

    Rule labels reuse the filter menu's wording.

  - **Order:** below the rules, always visible (it isn't a rule): Sort
    (Manual or a key), plus a direction toggle when sorted.

- **Rule controls (same model fields as today):**
  - **Project:** a multi-select. Empty means all projects (`['']`).
  - **Required / Excluded tags:** `tag-edit` (what the Formly tag type
    wraps), with the all/any toggle from two tags on.
  - **Without tags:** no control (`isUntagged`). It hides the two tag rules
    from the menu, and they hide it.
  - **Completion:** Completed or Not completed. Removing the rule means All.
  - **Planned date:** one select instead of two controls. "Has a date" maps
    to Scheduled, "No date" to Not scheduled, and the date rules (Today,
    Tomorrow, This week…) to `dueState`. That merges `dueState` with
    `scheduledState`.
  - **Deadline, Estimate, Time spent, Priority:** the existing option
    lists.
  - **Backlog:** Exclude backlog or Backlog only.
  - **Only parent tasks:** no control.
  - **Defaults when a rule is added:** the first useful option (Completion →
    Not completed, Planned date → Today, Priority → High).
  - An unknown stored value (from a newer client) shows as "Other (kept)"
    and is saved unchanged unless changed.
- **Live count:** per section, the number of tasks the rules match, through
  the same engine as the view (`panelToCriteria` + `matchesTaskCriteria`).
  The criteria context the panel builds (logical day, week start, backlog
  ids, backlog-enabled projects) moves into one root service
  (`ViewCriteriaContextService`) used by `BoardPanelComponent` and the
  editor, so both count the same.
- **Validation:** the view title is required. Section titles are required
  when the view shows them (Board, or a List with several sections). Save is
  disabled until valid; the first invalid field shows its error on Save.
- **Mobile:** the dialog uses the full width on small screens. Section cards
  are one column, and the rule rows wrap their control below the label.
- **Out of scope:** templates or presets, icons and colors, editing several
  views at once.

### Tests

- **Unit:**
  - the editor's model mapping (planned-date select ↔ `dueState` +
    `scheduledState`, rule add and remove ↔ fields, Without tags ↔ tags,
    List ↔ `cols`, the single-section title);
  - unknown values carried through;
  - the summary text;
  - the live count, against the panel's own filtering, for the same tasks;
  - validation.
- **E2E:**
  - One helper in `e2e/utils/view-helpers.ts`
    (`createView(page, { title, layout, sections: [{ title, rules, sort }] })`)
    replaces the per-spec Formly steps in all board specs.
  - New: create a List view with one section and a rule, check its live
    count and the result; switch to Board and back; reorder and duplicate
    a section; edit an existing view and keep a value the editor doesn't
    show.

### Revised after plan review (2026-10-31)

These override the parts above where they differ.

- **Untouched means unchanged (blocker).** `normalizeBoardForSave` expects
  the editor model's `sortKey` to hold the sort key (it calls
  `withPanelSortKey` with it): handing it a stored panel with
  `sortBy: 'dueDate'` and no `sortKey` deletes the sort. So today's load mapping in
  `BoardEditComponent.ngOnInit` (defaults spread, `sortKey` from
  `getPanelSortKey`, unknown `sortKey` kept) becomes a pure
  `toEditorModel(board)` in `boards.util.ts`, and save stays
  `normalizeBoardForSave(model)`. Each panel is the stored panel spread, with
  only the rules the user changed overwritten; unknown keys on panels and the
  board survive the spread. Removing a rule deletes its key (required fields
  go to their default: `taskDoneState: All`, `scheduledState: All`,
  `isParentTasksOnly: false`, `projectIds: ['']`), never `null`/`undefined`.
  Rule presence comes from stored values, not from what a control can show:
  - **Project:** `select-project` is a Formly `FieldType` and can't be used
    alone. The editor uses a plain `mat-select multiple` with
    `select-option-row`, without an "All projects" option (no rule = all).
    The rule is set when `projectIds` has any id but `''`, including ids of
    deleted projects, which are kept and shown as "1 deleted project". Picking
    every project stores those ids (today it collapses to `['']`, which also
    takes future projects); clearing the selection removes the rule.
  - **Tags:** `tag-edit` works without Formly (the task detail panel uses it
    bare) and keeps ids it can't show on `remove()`. But it hides ids with no
    tag, so the default Eisenhower view on a fresh install (missing Important
    and Urgent tags) would show empty rules. The row shows "N missing tags"
    then; the ids stay. Required and excluded lists exclude each other through
    `excludedTagIds`, as the Formly type does. Without tags and the tag rules
    only hide each other in the Add-rule menu; a stored panel with both shows
    both (normalize clears the tags on save, as today).
  - **Planned date:** one select over `dueState` + `scheduledState`. A known
    `dueState` shows as that rule, else `Scheduled` →
    "Has a date", `NotScheduled` → "No date", `All` → no rule; an unknown
    `dueState` shows "Other (kept)". Both fields are written only when the
    user changes this select: Has a date = delete `dueState` + `Scheduled`;
    No date = delete `dueState` + `NotScheduled`; a date rule = `dueState`
    (+ `Scheduled` from `withDueStateImpliesScheduled`); removed = delete
    `dueState` + `All`. A stored `dueState: 'none'` shows as "No date" and
    stays as stored until changed.
- **Titles of default views (bug today).** `DEFAULT_BOARDS` titles are
  translation keys; today's form shows `F.BOARDS.DEFAULT.KANBAN` raw. Inputs
  show the translated text; on save a title whose text still equals the
  translation of its stored key keeps the key, so it stays translated on every
  client and language. The single-section title, the count label and Duplicate
  use the translated text.
- **Single-section List title.** Hidden; on save it takes the view's title
  only when it is empty or equals the view's previous title (released clients
  show it as the card header, so a rename follows). A different stored title
  (save-as-view, released clients) is kept, and shows again, prefilled, when
  a second section is added.
- **Layout.** `segmented-button-group` (`src/app/ui/`), not a restyled
  Material toggle. List = `cols: 1`; Board shows Columns as an integer ≥ 2
  with no upper cap: `board.component` has none and stored boards may hold
  more than 6. Switching List → Board sets `cols` to the section count
  (2 if fewer); an untouched `cols` is saved as stored. `getViewIcon` reads
  `cols` instead of the panel count, so the sidebar icon matches the chosen
  layout (display only).
- **Save and validity.** Drop "Save is disabled until valid": with errors
  hidden until touched, a disabled Save gives no reason. Save stays enabled;
  on click with errors it marks all fields touched and focuses the first
  invalid one. `board-edit` exposes `save()` only; the dialog's
  `boarEditCmp()?.form.valid` binding goes. The Eisenhower view saves without
  `includedTagsMatch` (absent = `all`), which today's Formly default writes;
  both mean the same on every client.
- **Sections: no collapse, no summary line.** Showing only the set rules
  already removes the 1300px card; a section with 2–4 rules is a few rows.
  Collapse state and a summary builder (translated text for every rule value,
  tag and project titles) add code and tests for little speed. Section header:
  title, live count, ⋮ (Move up, Move down, Duplicate, Delete). Duplicate: new
  `nanoid` id, `taskIds: []`, title + " (copy)".
- **Add-rule menu:** one flat `mat-menu`, groups separated by dividers, no
  nested menus or group headings. A rule added with an empty control (Project,
  tags) opens or focuses that control; left empty, it saves as no rule.
- **Live count = what the section header will show.** The panel counts open
  rows in list layout (`mainRows`, subtasks under a matching parent not
  counted, done split off) and all matches on cards (`tasks()`). The matching
  (`tasks()` without sort) and the open-row filter (`_rowIds` + done split)
  become pure helpers in `boards.util.ts` used by both, so the editor shows
  the header's number for the chosen layout. `ViewCriteriaContextService`
  (root, store selectors for day and day start, `DateAdapter` week start,
  one backlog-id set and a project map) replaces each panel's own backlog set
  and `allProjects` scan. Boards keep `isDayBeforeTime` unset; the customizer
  keeps its own ctx. The count recomputes on the tracking tick (the task list
  re-emits every second); that is the same work one more panel does.
- **Strings:** "panel" also leaves `NO_PANELS_MSG`. New keys in `en.json`
  only; old `FORM` keys still used by `view-menu-rules` or the panel stay.
  Planned date and the date options reuse the customizer's wording ("Planned
  Date" instead of today's "Due date").
- **Mobile:** the dialog is already full width below `xs`; only the rule rows
  wrap. At `sm` the 800px min width (sized for side-by-side Formly cards)
  becomes a max width for one column.
- **Prior art:** §2 (TickTick's form, Todoist's query) covers how rules are
  defined. Taken (from memory, not re-checked): Notion's and Linear's
  "+ Add filter", listing only the rules that are set. Not taken: TickTick's always-visible field list, the 1300px card this
  phase replaces.
- **Was a known gap, fixed after the phase 5 review:** the editor saved each
  panel's `taskIds` from the copy taken when the dialog opened, so an
  `updatePanelCfgTaskIds` that synced in while it was open was overwritten.
  Save now sends only the fields the editor changed, with changed panels
  taking their current `taskIds` (see the follow-up below).
- **Tests added:**
  - Unit, the main guard: an untouched save equals
    `normalizeBoardForSave(toEditorModel(board))` (minus the Formly-only
    `includedTagsMatch` fill) for `DEFAULT_BOARDS`, a `sortBy: 'dueDate'`
    panel, a `sortBy` + shadowed `sortKey` panel, unknown `dueState`/`sortKey`
    and an unknown panel key, `cols: 8`, `projectIds` with a deleted id,
    `dueState: 'none'`, `dueState` + `NotScheduled`, `isUntagged` with tags,
    a single section titled differently from the view, missing tags.
  - Unit: the planned-date mapping in both directions; translated-title
    keep-key; single-section title follow; the pure match and row-count
    helpers against `BoardPanelComponent`'s `headerCount` for both layouts.
  - E2E: the helper also replaces the editor steps in
    `e2e/tests/sync/supersync-reorder-conflict-wedge.spec.ts`
    (`input[type="number"]` exists on Board only); run it through the
    scheduled workflow (`grep`), since provider specs skip locally.
    `issue-7380-eisenhower-edit.spec.ts` keeps its intent: editing the default
    Eisenhower view, changing a sort, and saving works. New: edit Kanban
    without changes and check the stored board is unchanged and titles show
    translated.

## Review

Plan review (fresh-context subagent, 2026-10-30). Fixed in this revision:

- Blocker: `null` from the form and unknown values in `dueState` → sanitize
  rules and tests (§6).
- Blocker: date helpers lacked the task, had the wrong `dueDay`/`dueWithTime`
  precedence, risked UTC date parsing and non-reactive day-start → §5 rewritten
  around `isTaskOverdue`, `dateStrToUtcDate` and store selectors.
- Undefined interaction with `scheduledState` dialogs and the existing-task
  inline add → §5 "Applying it", form hides the field.
- Routing in the component would lose deep links on reload → guard (§3.3).
- Missed call sites: page title, Android back button, group expansion, arrow-key
  focus, "Disable feature", dialog create mode, translated titles → §3–§4.
- Incomplete E2E and string lists → §4, §8.
- Released-client details (unknown-key preservation, drop behaviour,
  `DEFAULT_PANEL_CFG`) → §6.

Not taken:

- "Split: ship `dueState` alone, sidebar only on demand." The maintainer decided
  to replace the Boards entry with sidebar views; recorded in §1.
- Keyboard reordering of sidebar views: deferred (§3.5), same as the tab bar
  today.

Implementation review (fresh-context subagent, 2026-10-31). Fixed:

- Bug: side-menu view rows passed the `dragDelayForTouch` signal instead of its
  value, so touch scrolling over them started a reorder drag.
- The board editor now sanitizes panels before dispatching, so no op carries
  Formly's `dueState: null` to released clients.
- The section menu also offers "Create view" (the compact rail hides the +).
- The boards' own edit buttons go through `BoardsService` (one dialog path).
- A timed task moved into Today/Tomorrow with a late start of day kept a time
  before the day start and landed on the previous logical day →
  `getCalendarDateForDueDay`.
- A refused move into an Overdue column shows a snack.
- Performance: the due context (`createBoardDueCtx`) derives tomorrow, the
  7-day end and the overdue threshold once per panel update, not per task; the
  Views section reads boards itself, so a drop into a column no longer rebuilds
  the whole side menu.
- Dead code from the tab page (`isHideBtns`, the editor's own buttons) removed.
- Added specs: `BoardsService`, `BoardsComponent`, inline add with a due rule.

Not taken:

- An Edit/Duplicate/Delete menu in the view page header: the side-menu row menu
  and the panels' edit buttons cover it without new header UI.
- A per-view icon in the page header, keyboard access to the section's
  "Disable feature" (Settings → App Features has the switch) and a tooltip on
  keyboard focus in the compact rail (route rows have none elsewhere either).

Phase 2 implementation review (fresh-context subagent, 2026-10-31). Fixed:

- Bug: moving a task into a "no priority" column sent `priority: undefined`,
  which the synced op drops (#9776); it now sends `null`.
- An empty `projectIds` again means all projects (as on released clients);
  "Save as view" no longer writes `[]` for a project search without hits.
- "Save as view" from a tag list keeps the list's tag; filter parts one column
  can't combine with it (any of several tags, untagged, a project search
  without hits) are left out and named in a dialog hint.
- An unknown `sortKey` (from a newer client) survives an edit on this client.
- Test-only `_filterTasks` and the unused `getPanelDueState` removed; Today's
  title is translated in saved views; title sorting uses the UI language like
  the lists; the panel reads tags lazily.
- Added specs: clearing priority/deadline/tags on a move, save-as-view hints.

Behaviour changes to mention in the PR:

- Board columns sorted by due date now put date-only tasks at the end of their
  day (like the task lists, #9828), and title sorting is natural ("Task 2"
  before "Task 10").
- The filter menu's date filters use the logical day.
- Columns that require the virtual Today tag refuse moves.

Not taken / known gaps:

- On a released client, editing a board resets `sortDir` on a column that is
  sorted only by a new `sortKey` (its editor hides `sortDir` without `sortBy`).
- The deadline auto-plan simulation is conservative for subtasks whose parent
  is in Today (may refuse a move that would hold).
- `view-menu` items sit in a child component, so arrow keys don't move between
  them inside the mat-menu; the existing `work-context-menu` has the same gap.

Phase 3 implementation review (fresh-context subagent, 2026-10-31). Fixed:

- Bug: dragging a selected row in a view took the multi-select group-drag
  path when a project had been open before (that context is stale on a view
  page). The other selected rows were hidden during the drag, and an
  unmoved drop still wrote the view's order. View lists now never group-drag.
- The header estimate in list layout sums the open rows only, so it matches
  the count: no done tasks, and no parent counted twice with its subtask.
- "No tasks match this view" is no longer shown when every matching task is
  done and sits in the Completed section.
- Hot path: task rows use the host's `tagsToHide` signal directly instead of
  one extra `computed` per row.

Not fixed (known gaps):

- Reordering writes only the ids that currently match, so filtered-out tasks
  lose their saved position (as in card layout).
- An undone matching subtask under a done parent sits inside the collapsed
  Completed section.
- "Move to top/bottom" from the task detail panel is outside the view and
  still follows the last opened list.
- No E2E yet for drag reordering in a view (the keyboard reorder is covered).

Phase 4 plan review (fresh-context subagent, 2026-10-31): all recommendations
adopted, see §12 "Revised after plan review". The main changes:

- The filter menu shows on list views only, and edits only rules every
  section shares.
- Focus after a move into another section is handled in list mode.
- Collapsed sections render nothing.
- A saved tag grouping gets an "Other" section, and project grouping isn't
  saved.
- The add-task bar target lives in `tasks/` and gets an explicit project.

Phase 5 plan review (fresh-context subagent, 2026-10-31): all
recommendations adopted, see §13 "Revised after plan review". Main changes:

- Saving an untouched view writes `normalizeBoardForSave(toEditorModel(board))`.
  This fixes a sort-loss blocker, and fixtures cover it.
- The project rule gets its own `mat-select`. Deleted projects and missing
  tags are kept and labelled.
- The planned-date mapping is specified both ways.
- Default view titles show translated.
- A hidden single-section title is only filled in, never overwritten.
- Save stays enabled and points to the first error.
- The live count shares the panel's helpers.
- Columns has no upper cap.
- Section collapse and the summary line are cut.
- The Add-rule menu is flat with dividers.

Phase 4 implementation review (fresh-context subagent, 2026-10-31). No
blockers. Fixed:

- Focus after a move skips rows that are still animating out, and finds the
  moved row when it is nested under a matching parent in the target section.
- An open subtask that is its own row is no longer repeated inside its done
  parent in Completed. The row objects stay stable.
- The view menu doesn't dispatch for a view without panels.

Added tests for a selection's edge move and for focus into a collapsed
section that already shows the row, plus an E2E for both.

Not fixed (known gaps):

- Removing a typed `+project` in the add-task bar falls back to the stale
  context's project, as the inline add rows already do.
- A legacy `TODAY` id in a panel's required tags doesn't show as a chip in
  the menu.
- Accepted sync gaps from §12: concurrent menu edits are last-write-wins on
  the whole board, and a concurrent reorder isn't detected as a conflict.

Phase 5 implementation review (fresh-context subagent, 2026-10-31). The
editor ⇄ stored board mapping holds in both directions: planned date ⇄
`dueState`/`scheduledState`, the `'manual'` sort never written (a stored
`sortKey: 'manual'`, which no client writes, is kept as an unknown key),
deleted project and missing tag ids kept, unknown keys and values, legacy
fields and `taskIds` carried through, no `null`/`undefined` written, one
`addBoard`/`updateBoard` per save. The live count uses the panel's own
helpers on the same task selector, so it equals the header count. No
Angular Material restyling. Fixed:

- Bug: a Columns value like 2.5 passed the `min` validator, was ignored by
  the model, and Save closed the dialog with the old value. Columns now
  requires a whole number of at least 2 ("Whole number, 2 or more").
- Performance: the live count re-matched every section against all tasks on
  each keystroke in any title. Counts are cached per section object, keyed on
  the tasks, the criteria context and the projects (backlog membership).
- Adding or duplicating a section in a one-section list showed the hidden
  title as the view's old title; it now shows what save would store.
- A view titled like a group of translation keys ("F", "G") showed
  "[object Object]".
- Accessibility: rule rows are labelled groups, so the tag inputs are
  announced with their rule (Required or Excluded Tags).
- "1 deleted project" also counted archived projects (the select lists
  unarchived ones only); the note now says "archived or deleted".
- The 23 `F.BOARDS.FORM` keys nothing uses any more were removed from
  `en.json` (other locales keep extra keys as informational; `int:test`
  passes). Wiki: sort by "planned date", archived projects.

Not fixed:

- The missing-tag banner over the Backlog row in the builder's Kanban
  screenshot is not real: it is the view page behind the dialog, captured
  during the dialog's open animation. Settled screenshots show no overlap.
- Deadline defaults to Today when added, like Planned date; "No deadline"
  first would be the opposite of what adding a deadline rule usually means.
- Every section's ⋮ button is named "More actions" without the section's
  title (the title field sits right next to it).
- The count still recomputes once per section on the tracking tick (the
  task list re-emits every second while tracking), the same work one more
  column does.
- Pre-existing, outside this phase: `board.component` binds `--cols` to
  `false` while tags are missing (NG0318 warning in the console).

Follow-ups to the phase 5 review (2026-10-31), on the open items above:

- **Save sends only what changed.** `getViewUpdates(opened, saved, current)`
  compares the saved board with the one the dialog opened: `updateBoard`
  carries only the fields that differ, and changed `panels` take each existing
  panel's `taskIds` from the store, so a reorder or a field (e.g. the title-bar
  menu's sort) that synced in while the dialog was open stays. An untouched
  save dispatches nothing (no op), and a view deleted while the dialog was
  open isn't revived by an update. Still one `updateBoard` per save; the
  payload is a `Partial<BoardCfg>` as the title-bar menu already sends.
  Concurrent edits of the same field remain last-writer-wins on the board.
- **Tracking tick:** the live count caches each task's match per section
  (keyed on the task object, ctx and project list), so a tick that replaces
  one task re-matches that task only, not every task per section.
- **Section ⋮ button** is named "More actions for <title>" (plain "More
  actions" for an untitled section).
- **`--cols`** binds `null` instead of `false` while tags are missing, which
  removes the NG0318 warning.

Feedback after phase 5 (2026-10-31): "Save as view" from Today.

- **From Today, the filter alone.** Saving a filtered Today made a view of
  "today or overdue" plus the filter, titled "Today". Now a usable filter
  (not one that matches nothing) is saved alone, with the hint
  `HINT_FILTER_NOT_ONLY_TODAY`, and the view is named after the filter
  (`getFilterTitle`: the tags' or projects' titles, else "Planned Date:
  Today" and the like). Unfiltered, Today still saves "today or overdue",
  with an empty title for the user to fill (the editor requires one).
  Decided with the user: "only the filters".
- **Offered while Views are off.** "Save as view…" showed only with Views
  enabled (off on a new install). It now always shows, and saving a view
  while Views are off turns them on (`BoardsService.createBoard`, after the
  dialog returns an id). That is a second op, on the global config, for the
  same intent: independent of the board op, so replaying either alone is
  harmless (a view while Views are off, or Views on without the view).

Whole-branch review (fresh-context subagent, 2026-10-31), over
`git diff origin/master...HEAD`. Checked: one op per intent (editor save,
title-bar menu click, save as view plus the separate Views switch op), no
`undefined` in payloads (rule clears are deleted keys, priority clears are
`null`), new panel fields optional strings/booleans, no new actions or
multi-entity ops, effects untouched, released clients ignore the new keys;
the rule engine and the filter-menu ⇄ column mapping; drop, move and add
paths; the task row hot path (one optional injection, no template calls or
subscriptions); the Material styling rules; translations (only `en.json`,
every new `F.BOARDS` key used); the E2E specs (no fixed waits). Fixed:

- Sync: the editor measured what changed against the stored board. Where
  saving normalizes (a panel without `backlogState` from an old client, a
  date rule with "Not scheduled", a shadowed `sortKey`, "Without tags" with
  tags), an untouched save or a rename still sent the whole `panels`, so a
  panel field that synced in while the dialog was open was overwritten. It
  now compares with what saving the opened board untouched stores
  (`ViewEditorComponent.buildUntouchedBoard`): an untouched save sends no
  op, a rename only the title. The spec fails 4 of 30 without the fix.
- `supersync-reorder-conflict-wedge.spec.ts` still said the editor saves
  the full board. The UI edit is now `updateBoard({ title, cols })`; the
  comment and the fixture's (undispatched) edit payload say so. Coverage is
  kept: it is still a BOARD `UPD` on the board crossing the `Sort Boards`
  `MOV`, and `reorder-conflict.util` resolves partial `updates` per field
  (its spec covers each board field). Runs in the scheduled workflow only.
- Wiki: the side-menu bullets (right-click, drag to reorder, start page)
  sat under "One-Column Views Are Task Lists"; moved to "Where Boards
  Live". A stale comment about Today's title in `saveAsView` removed.

Not fixed:

- A view titled exactly like a top-level translation group (`APP`, `G`,
  `F`, `V`, `WW` …) shows "[object Object]" in the side menu, the title bar
  and a duplicate's title; only the editor guards against it. Unlikely
  titles, and the fix is a shared safe-translate for every place that
  translates board titles.
- The side-menu view row's ⋮ is named "More actions" without the view's
  title, like project and tag rows (shared `nav-item`).
- `S_CANT_MOVE_HERE` says "column's rules" in list sections too (wording).
- Accepted before and unchanged: once one panel changes, the editor still
  replaces all `panels` (LWW on the board), and the count recomputes on the
  tracking tick (now per changed task).
