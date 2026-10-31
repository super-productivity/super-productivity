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

## 14. Phase 6 — first impression and polish

From a walkthrough of the running app (2026-10-31, screenshots of every
surface at 1280px and 400px). Three rough spots, worst first; a fourth
(headings in the Add-rule menu) was cut in plan review, see "Phase 6 plan
review". No stored shape, action or op changes in this phase.

### A. Default views open on a wall

Today a view whose rules name a tag that doesn't exist (the default
Eisenhower Matrix and Kanban on any install that never created `urgent`
`EM_URGENT`, `important` `EM_IMPORTANT`, `in-progress` `KANBAN_IN_PROGRESS`)
shows only "2 new tags need to be created for this view to work" and a
button (`board.component.html`; `missingTagIds` counts required and excluded
tags): the columns, i.e. what the view _is_, are hidden. That is the first
screen after turning Views on.

- The board always renders its columns or sections; `--cols` no longer
  depends on missing tags. Above them, a `.callout` (info tone,
  `_callout.scss`; icon plus one `<div>` holding a `<p>` and the button, as
  in `plainspace-reconnect-notice`) names the missing tags and keeps the
  one-click action: "This view uses tags that don't exist yet: urgent,
  important" + **Create Tags** (`mat-stroked-button`, same `createTags()` as
  today: default tags keep their fixed ids, unknown ids get today's
  `some-tag-<id>` fallback). Names are the default tag consts' `title`
  (plain strings, not translation keys); an unknown id shows as is.
  - Layout: the `board` host is the grid, and cards use
    `grid-auto-rows: 1fr`, which would stretch the callout to a column's
    height. The callout spans all columns (`grid-column: 1 / -1`) and the
    host gets `grid-template-rows: auto` while it shows.
  - Strings: one new key `F.BOARDS.V.MISSING_TAGS_MSG` with `{{tags}}`
    (`en.json` only, it is a new key); `CREATE_NEW_TAG(S)_MSG` go. The
    button keeps `CREATE_NEW_TAG_BTN` / `CREATE_NEW_TAGS_BTN` ("Create
    Tag" / "Create Tags"), which five E2E specs click by name.
- **Guard: no move or add writes a tag id that has no tag.** Today the wall
  prevents it. With the columns shown, `getChangesToMatch` would add a
  missing required tag: a dangling `tagIds` entry, which fails
  `isRelatedModelDataValid` ("tagId from task not existing") and sends the
  state to data repair. `canEnter` alone doesn't cover it: it only answers
  the CDK enter predicates (`canEnterCard`, `task-list`'s cross-section
  drop). `moveTasks` (keyboard moves between columns and sections,
  multi-select moves, list drops via `placeRow`), `_applyDateChanges` and
  `afterTaskAdd` (an existing task picked in an add bar) call
  `getChangesToMatch` directly, and new tasks get `additionalTaskFields`.
  So, in `BoardPanelComponent`:
  - one private `_changesToMatch(task)`: `getChangesToMatch(…)`, but `null`
    when its `tagIds` hold an id without a tag. All five current calls go
    through it, so a refused move shows the existing `S_CANT_MOVE_HERE`
    snack and an existing task picked in an add bar is left unchanged;
  - `isAddTaskHidden` is also true when `tagsToAddForInlineCreate()` holds a
    missing id. That hides the card add row, the section "+" (B) and the
    empty view's **Add task**, and makes `newTaskTarget` null, so the
    add-task bar (`ViewTaskListRegistry`) adds into the next section.
  - The rule is per task, so it is exact: excluding a missing tag removes
    nothing (no guard), and with "any of" required tags a task that already
    has an existing one still enters.
- The set of existing tag ids lives in one place: a `tagIdSet` computed
  over `selectSignal(selectAllTagIds)` on `ViewCriteriaContextService`, read
  by the board's `missingTagIds` and by the panels. Not part of `ctx`: a tag
  change must not re-match every panel.
- Tags created elsewhere (another device, the tag menu) lift the callout
  and the guard reactively; deleting one brings them back.
- Not done, and why: creating the tags automatically on open or on first
  drop. Opening a view isn't a user intent to create data, and two devices
  opening it would both send `addTag` for the same fixed id (a create/create
  crossing; two devices clicking the button can do that today too, unchanged);
  a drop would become extra ops (tags + task) for one intent. One explicit
  click stays the creation path. Changing the default views to use Priority
  instead of tags isn't possible either: the engine can't express the
  complement quadrants ("not urgent" = no date or later than N days), and it
  would only reach new installs.
- Known gap, unchanged: a column that refuses new tasks has no add row, so
  an empty one gives arrow keys no focus target (as the Overdue column today).

### B. "+ Add" rows (sections and board columns)

Every section of a list view starts with a full-width "+ Add" row
(`add-task-inline` in the `collapsible` body of `board-panel.component.html`)
above its tasks. It pushes the content down, repeats on every section and
duplicates the add-task bar (which already adds into the first section that
takes new tasks). Project sections in the work view have no add row, only a
⋮ in the header's `[actions]` slot.

- The row goes in sections **and in board columns** (user feedback,
  2026-10-31: "the add button looks a bit odd"; the centered "+ Add" text
  button in a bordered full-width row reads like an empty task row). One
  pattern for both layouts: a "+" icon in the header. Board columns put it
  in their own `<header>` before the edit button, same label, tooltip and
  open behaviour (the bar opens at the top of the column, above the cards).
  The arrow keys' focus target in an empty column (`addButton()`,
  `onAddButtonKeydown`, `board-keyboard-navigation.spec.ts`) becomes that
  header "+": Enter/Space open the bar, arrows keep moving between columns
  and cards as they do from the add row today. Update the keyboard spec
  instead of keeping the row for it. The planner keeps
  `AddTaskInlineComponent` unchanged.
- The section header's `[actions]` slot (after the estimate) gets a
  `mat-icon-button` (`add`), `aria-label` and tooltip "Add task to
  {{title}}" (new key, with the translated section title), absent while
  `isAddTaskHidden()`. `(click)` stops propagation so the section doesn't
  toggle; the header's keydown handler already ignores keys on a projected
  action.
- Click: expand the section if collapsed (`isSectionExpanded`), then render
  `add-task-bar` at the top of the section body behind a local `isAddOpen`
  signal, with the inputs `add-task-inline` passes today
  (`additionalFields`, `tagsToRemove`, `taskIdsToExclude`, `isNoDefaults`,
  `isHideTagTitles`, `afterTaskAdd`). The bar focuses itself on open.
  `closed` (Escape) and `done` (click outside) close it; after Escape, focus
  returns to the header "+". The planner's shared `AddTaskInlineComponent`
  is not changed.
- Tab reaches the header "+" like the project sections' ⋮; shortcuts are
  unchanged.

### C. The editor's first section card

In a one-section list (`isShowTitle` false) the header row holds an empty
`.section-title` span, "5 tasks" and the ⋮, floating over empty space, with
"Show tasks that match" on its own line below.

- When the title is hidden, the "Show tasks that match" label takes the
  empty span's place (count and ⋮ stay right) and the `.rules-heading` line
  goes. The label may wrap (`min-width: 0`) for long translations on phones.
  With a shown title, unchanged. No new strings.

### Tests

- Unit, `board-panel.component.spec.ts`: with a missing required tag,
  `canEnter` is false, `moveTasks` returns false and dispatches nothing,
  `afterTaskAdd` of an existing task dispatches no `updateTask`,
  `isAddTaskHidden` is true and `newTaskTarget` null. A panel that only
  excludes a missing tag accepts tasks; "any of" [missing, existing] admits
  a task that has the existing tag. Sections: no `add-task-inline`; no
  header "+" while `isAddTaskHidden`; "+" on a collapsed section expands it
  and renders `add-task-bar`; Escape closes it.
- Unit, new `board.component.spec.ts`: columns render together with the
  callout naming the missing tags; `createTags()` dispatches one `addTag`
  per missing tag with its fixed id; no callout when nothing is missing.
- Unit, `view-editor-section`: hidden title → the label is in the header,
  no `.rules-heading`.
- E2E (`e2e/tests/boards/`): a fresh install opens the Eisenhower Matrix and
  sees four columns and the callout; a Ctrl+Shift+Arrow move into a quadrant
  that requires `important` is refused (the task keeps its tags); **Create
  Tags** removes the callout and the same move then works. A section's "+"
  adds a task into that section with its rules applied.
  `views-sidebar.spec.ts` checks the Overdue section's `add-task-inline`
  count, which passes vacuously after B: check for no header "+" instead.
  Specs that click **Create Tag(s)** keep working (same labels); fix their
  comments that describe the wall (`issue-7498-kanban-done`,
  `issue-7380-eisenhower-edit`, `issue-7498-task-disappears`).
- Screenshots at 1280px and 400px: Eisenhower before/after creating tags, a
  sectioned list with a section's add bar open, the editor with one section.
- Wiki `4.05-Board-View.md`: "Each section has its own **Add** row" becomes
  the header "+"; the default views show their columns with a prompt to
  create their tags, and tasks can't be moved into a column that requires a
  missing tag.

## 15. Phase 7 — icon, title, motion, the editor on phones

User feedback after phase 6 (2026-10-31): "We definitely need a transition
animation when a view is created and possibly more. We never should use the
filter icon since it has another meaning already. Tapping on title should
not route to today. The config UI is a bit hard to use and understand on
mobile." No stored shape, action or op changes; one new string. Revised
after plan review (see "Phase 7 plan review").

### A. No filter icon for views

`filter_list` means "filter/sort this list": the title bar's customizer
button (`page-title.component.ts`, work view and list-layout views). Views
also use it as their own icon in exactly two places: `getViewIcon`
(`boards.util.ts`; side-menu rows via `nav-view-group`, the title bar via
`page-title`'s `sectionIcon`) and the editor's **List** option
(`LAYOUT_OPTIONS`, `view-editor.component.ts`). Nothing else picks a view
icon: the Views section header, the `/boards` title, the bottom-nav slot
and the onboarding card use `NAV_SECTION_ICON.BOARDS` (`grid_view`); the
start-page select has one text-only **Views** entry.

- One-column views and the **List** option get `view_list` (a list; the
  `view_*` family of the board's `view_kanban`; unused elsewhere in the
  app, in the bundled Material Symbols font). The customizer buttons keep
  `filter_list`: they _are_ the filter. Update the three specs that pin
  the icon (`boards.util.spec.ts`, `nav-view-group.component.spec.ts`,
  `page-title.component.spec.ts`).

### B. The title on a view page

`page-title` puts `routerLink="/active/tasks"` on the title `<div>`, tooltip
"Go to task list", on every page. On a view page that jumps to the last work
context (often Today) and leaves the view. Angular's `RouterLink` on a
non-anchor also sets `tabindex="0"`, so the title is a tab stop today, but
with `outline: none`, no role and no Enter handling (it only listens to
`click`; the spec comment calling it "not focusable" is wrong).

- On a view page (`viewBoard()` set, i.e. `/boards/<id>` of an existing
  view) clicking or tapping the title opens the editor
  (`BoardsService.editBoard`); it doesn't navigate. One element, no second
  template branch: a static `tabindex="0"` (RouterLink leaves a static
  tabindex alone), `[routerLink]` bound to `null` on view pages (no
  navigation; `onClick` lets the click through) and `'/active/tasks'`
  elsewhere, `[attr.role]` `button` on view pages only, `(click)`,
  `(keydown.enter)` and `(keydown.space)` (prevent scroll) calling one
  `onTitleClick()` that does nothing off view pages. Tooltip "Edit view"
  (`T.F.BOARDS.V.EDIT_BOARD`) on view pages; the accessible name stays the
  view's title (the tooltip becomes its description), so no `aria-label`.
- `.page-title` gets a `:focus-visible` ring (`--focus-ring-*` tokens)
  instead of a bare `outline: none`; this also fixes the invisible focus on
  the other pages.
- `/boards` without views and all other pages are unchanged (they link to
  the task list like the Planner or Schedule title). Under 398px (`isXxxs`)
  the title bar hides the view's ⋮ menu, so the title is then the only way
  to edit from the header.

### C. Motion

Views switch without any transition. Both view routes have `page: 'boards'`,
so `warpRoute` (`app.component.html`, keyed on the route's `page`) only runs
when entering or leaving the views page, and the router reuses
`BoardsComponent` between `/boards/a` and `/boards/b`. Its
`@if (board(); as board)` keeps the same `<board>` element and only swaps
the input (`ɵɵconditional` updates the context in place). So creating a view
_from another page_ already animates; creating, duplicating or switching
_from a view page_ just replaces the content.

App-wide, Angular animations honour only the in-app **Disable animations**
setting (`@.disabled` on `AppComponent`'s host, plus `MATERIAL_ANIMATIONS`);
`prefers-reduced-motion` reaches only a few CSS rules and components, not
`warpRoute`, `projectChange` or `expand`. Triggers inside `app-root` get the
setting for free; dialogs live in the CDK overlay, outside it, so the editor
gets no Angular animation (D).

- **Switching views** (also after Create or Duplicate from a view page):
  `<board [@viewSwitch]="board.id">` in `boards.component.html`, a
  state-change trigger (precedent: `[@pluginSwitch]` in
  `plugin-index.component.html`, `[@taskDetailPanelTaskChange]`). Its only
  transition runs when both states are view ids (a matcher function that
  rejects `'void'` on either side): on entering the page `warpRoute` already
  animates (and its `animateChild()` would replay an `:enter` afterwards),
  and a leaving board must not animate at all. Motion = the work view's
  project change enter: `opacity 0, scale(1.2)` → `1, scale(1)`,
  `ANI_ENTER_TIMING`. No `animateChild()`, so child triggers (the callout
  below) don't replay after it. Transform and opacity only, on the `board`
  host: no layout change, and `.route-wrapper`'s `overflow: clip` keeps
  the scaled paint from nudging a scroll (#9873). The trigger goes in
  `src/app/features/boards/boards.ani.ts` next to its one user.
  - Not covered, accepted: the first view created from the `/boards` empty
    state (`/boards` → `/boards/<id>` is a new `BoardsComponent` on the
    same `page`, so neither trigger runs), and the view shown after
    deleting the open one (`board()` is briefly undefined, so the next
    board enters from `void`).
- **The new view's side-menu row:** `[@expandCollapse]` (already registered
  in `nav-view-group`, the section's own expand) on each `.view-row`, so a
  row added by Create, Duplicate or sync opens in place and a deleted one
  closes. The host's existing `[@.disabled]` gate (`isAnimationEnabled`,
  on after first render) keeps start-up still; rows inside a section that
  is expanding don't animate twice (parent animation, no `animateChild`).
  Rows are tracked by board id, so board updates (a drop into a column)
  don't re-enter them. Project and tag rows don't animate on add today;
  this stays view rows only.
- **The missing-tags callout** (`board.component.html`) collapses when
  **Create Tags** removes it: a leave-only height collapse
  (`expandOutOnlyAnimation`, mirroring `expandInOnly` in `expand.ani.ts`).
  No enter: the callout shows with its view, and an `@expand` enter would
  run again after `warpRoute` on page entry, pushing the columns down once
  the page is already in place. The host's `.hasMissingTags` class flips
  the moment the callout starts leaving, and without it the grid's
  `grid-auto-rows: 1fr` would stretch the leaving callout to a column's
  height for 195ms: replace the class with `:host:has(> .missing-tags)`
  (the leaving element is still in the DOM; check the selector survives
  emulated encapsulation in the built CSS) and update
  `board.component.spec.ts`'s class assertions.
- Cut: the section "+" add bar. `add-task-bar` already animates itself
  (`@blendInOut`, enter and leave), as in the planner's inline add; an
  `@expand` around it would animate it twice.
- `boards.component.spec.ts` and `board.component.spec.ts` need
  `provideNoopAnimations()` once their templates carry triggers.

### D. The editor on phones

At 400px the dialog floats over the bottom nav with 16px margins
(`dialog-board-edit.component.scss`: `min-width: calc(100vw - 32px)`,
content `max-height: 75vh`); each rule takes two rows (label line, then a
full-width select: `.rule-row` wraps below `xs`); every section is fully
expanded, so a three-column board is a long scroll; and Columns wraps to
its own line (toggle `flex: 0 1 280px` + gap + Columns `0 1 200px` >
the ~320px of content).

- **Full screen below `xs` (600px).** The app has no reusable pattern:
  `.project-complete-fullscreen-dialog` is transparent and specific, the
  markdown editor sets `minWidth/height` on every width. Add one shared
  panel class `fullscreen-xs-dialog` in `_overwrite-material.scss`, next to
  `.big`: below `xs`, the pane is `100vw` × `100dvh` with no margin and
  overrides the global `max-width: 96vw !important`; the surface fills it
  with no radius and pads by `--safe-area-*` (edge-to-edge Android/iOS).
  Keep its specificity below the iOS keyboard rule
  (`body.isIOS.isKeyboardVisible .cdk-overlay-pane.mat-mdc-dialog-panel`)
  so that rule still caps the height. `BoardsService.createBoard` and
  `editBoard` pass `panelClass: 'fullscreen-xs-dialog'`;
  `dialog-board-edit.component.scss` drops its sub-`xs`
  `min-width`/`max-height`. Title and actions already stay put while
  `.mat-mdc-dialog-content` scrolls (global flex layout).
- **One row per rule, on every width.** Select rules (and Project and
  **Sort by**) put the rule's name in the field's `<mat-label>`; the
  separate label column and its `xs` wrapping go, the × stays at the end.
  Keep `aria-label` on the selects: with it, `MatSelect` names the trigger
  by it exactly, which the E2E helpers' `getByRole('combobox', { name })`
  relies on. Rows keep `data-rule` and `role="group"`, named by
  `aria-label` (the rule's name) instead of the dropped label span.
  Exceptions: **Without tags**
  and **Only parent tasks** have no control (the label is the row); the
  tag rules keep their text label, since `tag-edit` is a bare
  `mat-chip-grid` with no form-field label slot (changing the shared
  component isn't worth it) and `addViewRule` finds tag rows by
  `.rule-label`.
- **Sections collapse, one open at a time**, when the editor has two or
  more panels (on every width). A card keeps its title field and ⋮ on top
  (title inputs stay rendered, so `buildBoard()`'s
  `isTitleInvalid()`/`focusTitle()` and the specs that read all title
  fields keep working; the only invalid field a card has is its title).
  Below it, a full-width `<button>` with `aria-expanded`/`aria-controls`
  and an `expand_more` chevron shows the count and a one-line rule summary,
  e.g. "4 tasks · Priority: High · Completion: Not Completed" ("Every
  task" without rules); it toggles the card's body (rules, Add rule, Sort
  by), rendered with `@if`, no animation. No nested interactive controls.
  - State: `openPanelId` in `ViewEditorComponent`, first panel open when
    the dialog opens; `addPanel`/`duplicatePanel` open the new panel;
    moving keeps it (by id); removing the open one leaves none open. A
    single panel (a list's only section, a new board) has no toggle, is
    always open and keeps today's header. `_touchedRules` lives on the
    section component, so an added-but-empty rule survives collapsing.
  - Summary: pure `getRuleSummary(panel, { projects, tags }, translate)`
    in `view-editor.util.ts`, over `getSetRules(panel)` (so empty touched
    rules don't show): select rules `Label: option label` from
    `VIEW_RULE_LABELS` / `VIEW_RULE_OPTIONS` (`OTHER_VALUE` → "Other
    (kept)"); Project and the tag rules `Label: title, title` (known ones;
    the label alone when none is known); **Without tags** and **Only parent
    tasks** the label. Joined with " · " like `getFilterTitle`'s
    `Label: preset`. New string: `F.BOARDS.EDITOR.EVERY_TASK` ("Every
    task", `en.json` only).
- **Columns next to the toggle:** `.layout-toggle` `flex: 1 1 auto`,
  `.cols` a fixed narrow basis that fits "Columns" (its error may wrap to
  two lines); keep `flex-wrap` for widths under 398px.
- Unchanged: rules, live count, Add rule, Add section, save and the
  untouched-save path (`buildBoard`, `buildUntouchedBoard`, fixtures).

### Tests

- Unit: `getViewIcon` (`view_list`) and the two icon specs; `page-title`:
  on `/boards/<id>` a click and Enter call `BoardsService.editBoard` with
  the view and don't navigate, `role="button"`, tooltip "Edit view"; on
  `/active/tasks` and `/boards` (no view) the title still links to
  `/active/tasks`; `getRuleSummary` per rule type, incl. `OTHER_VALUE`,
  unknown tag/project ids, no rules; `board-edit.component.spec.ts`: first
  panel open, the others show only title and summary, `addPanel` /
  `duplicatePanel` open the new panel, one open at a time, a single panel
  has no toggle; an empty section title in a collapsed card still blocks
  save; the untouched-save fixtures pass unchanged. `board.component.spec`
  drops its `hasMissingTags` class assertions (the callout's presence is
  already asserted).
- E2E (`e2e/tests/boards/view-editor.spec.ts`): clicking a view's title
  opens the editor and the URL stays on the view; a default three-panel
  view opens with the first section expanded and the others collapsed with
  their summary; expanding one collapses the other. Creating a view still
  lands on it (animation not asserted, no fixed waits: Playwright's
  stability check waits out the transform).
- E2E helpers: `addViewRule`, `setViewRule` and `setViewSort` first expand
  their section (`expandViewSection(section)`: click the toggle when
  `aria-expanded="false"`, no-op when there is none). Callers on later
  sections that would otherwise fail: `board-keyboard-navigation.spec.ts`
  (section 1, twice). Section 0 is open by default, so
  `issue-7380-eisenhower-edit.spec.ts` and `view-editor.spec.ts`'s direct
  combobox queries keep working; title queries see every card.
- Screenshots at 1280px and 400px: side menu with list and board views;
  the editor (400px full screen; one section, and a three-column board with
  one section open); the callout before and after Create Tags.
- Wiki `4.05-Board-View.md`: clicking a view's title opens Edit; cards
  with several sections collapse to their title and a rule summary, one
  open at a time.

### Added after the plan review (user feedback)

User feedback (2026-10-31), during implementation: "We still lack a proper
transition animation when we click save view. Especially on mobile it's
disorienting. It's not clear we are on a new list." And: the per-column edit
button is replaced by the column's title.

- **Arrival of a created view.** `BoardsService` remembers the id of a view
  it just created (Create from the side menu or the empty page, Save as
  view…, Duplicate; local signal, not stored) and opens it through one
  `_openCreated()`. `viewSwitch` takes params: its one transition also
  accepts `void => id` when `isArrival` is set, so the new view enters from
  the empty `/boards` page and, from another page, after `warpRoute` brought
  the page in (its `animateChild()` runs the board's enter). Motion: the
  project-change zoom (`scale(1.2)` + fade) on wider screens; below `xs` it
  comes in from the right (`translateX(25%)` + fade), both `ANI_ENTER_TIMING`.
  The board's `(@viewSwitch.done)` for that id clears the arrival, so later
  switches to it are ordinary. The in-app **Disable animations** setting
  covers it like every trigger inside `app-root`.
- **A snack names the new view** ("View "{{title}}" created",
  `F.BOARDS.V.VIEW_CREATED`, `SUCCESS`, no action): on phones the side menu,
  where its row appears, is hidden.
- **Column titles edit their column.** The board column header loses its
  pencil; its title is a `role="button"` with `tabindex="0"`, Enter/Space,
  the `.focus-ring` utility and the tooltip "Edit column"
  (`F.BOARDS.V.EDIT_COLUMN`), the title staying its accessible name. It
  opens the editor with that column's section open:
  `BoardsService.editBoard(board, panelId)` → dialog data `openPanelId` →
  `board-edit` → `view-editor`'s `initialOpenPanelId`, which seeds
  `openPanelId` (an unknown id falls back to the first). List-layout
  sections keep their header as the collapse toggle. The keyboard: an empty
  column without a "+" focuses its title, and ArrowLeft/Right leave the title
  sideways like the "+"; `addButton()` stays the "+" (focus recovery after
  the add bar and the bulk-action fallback depend on it). The header keeps
  its height without buttons.
- Tests: `boards.service.spec` (arrival, snack, `openPanelId`),
  `boards.component.spec` (arrival params, cleared once),
  `board-panel.component.spec` (title button, focus, arrows),
  `board-edit.component.spec` (the asked-for card opens); E2E: a column's
  title opens the editor with that column open and no Edit button in the
  header; a created view shows the snack. `board-keyboard-navigation` and
  `issue-7380` click the column title (`columnTitleButton`).

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

Phase 6 plan review (fresh-context subagent, 2026-10-31). Checked against
the code; §14 revised. Changed:

- Wrong, blocker: "`canEnter` returns false (drag, card drop, keyboard move,
  multi-select move)". `canEnter` only feeds the CDK enter predicates;
  `moveTasks` (keyboard, multi-select, list drops via `placeRow`),
  `_applyDateChanges` and `afterTaskAdd` call `getChangesToMatch` directly,
  so the guard would have let dangling tag ids through, which fails
  `isRelatedModelDataValid` and triggers data repair. Now one
  `_changesToMatch` wrapper that refuses changes adding a tag without an
  entity, plus `isAddTaskHidden` for new tasks. Per-task, so it is also
  exact for "any of" required tags (the plan's "required tags include a
  missing tag" over-blocked).
- Gap: the callout inside the `board` grid would be stretched by
  `grid-auto-rows: 1fr`; spans all columns with its own `auto` row.
- Wrong: default tag titles are plain strings, not translation keys
  ("translated" removed). Strings: one new `{{tags}}` key (`en.json` only);
  the button keys stay, since five E2E specs click "Create Tag(s)" by name.
- Gap: the shared tag-id set must not be part of `ctx` (a tag change would
  re-match every panel).
- B: card columns keep their add row (only add path for cards; keyboard
  focus target in empty columns, pinned by `board-keyboard-navigation`).
  Render `add-task-bar` directly behind a local signal instead of adding an
  input to the planner's shared `AddTaskInlineComponent`; focus returns to
  the "+" after Escape; aria-label uses the translated title.
- Tests: unit cases for each guarded path, a new `board.component.spec.ts`,
  an E2E for a refused keyboard move before **Create Tags**, the vacuous
  `views-sidebar.spec.ts` add-row check, stale E2E comments, the wiki line
  "Each section has its own Add row".
- Cut D (Add-rule menu headings). Phase 5 decided "one flat menu, groups
  separated by dividers, no group headings" (§13); the walkthrough adds no
  new evidence (the menu has 12 rules, not 13). Headings would cost five
  new strings, a grouped-with-ids `getAddableRuleGroups`, a new shared
  style and five extra rows in a 12-item menu, for groups of two or three
  items the dividers already separate. If it comes back: promote the local
  `.menu-title` of `task-multi-select-bar` to `src/styles/components/`, the
  only menu heading in the app.

Not changed:

- C as planned: small, no new strings.
- An unknown missing tag id still shows as is and is created as
  `some-tag-<id>` (today's fallback).
- `createTags()` dispatches one `addTag` per tag: independent creates, each
  valid on replay alone; unchanged.

After the phase 6 plan review (2026-10-31): the user found the "+ Add"
button odd, so B now also replaces the board columns' add row with the
header "+" (keyboard focus in an empty column moves to it). D stays cut as
the review recommends.

Phase 6 implementation review (fresh-context subagent, 2026-10-31). Checked
`7bfd1c5..d0a048b` against §14 and the plan review; unit, type, lint and
boards E2E runs green. Fixed:

- B, one add bar at a time: the section "+" stopped its click so the section
  wouldn't toggle, which also hid it from every other open add-task bar
  (another section's, the global one), so two bars stayed open. Now it marks
  the click handled (`preventDefault`) and `collapsible` skips handled header
  clicks, as its keydown already skips projected actions. Unit tests for both,
  and the sections E2E opens one section's bar, then another's.
- B, a collapsed section kept `isAddOpen`: the bar came back and took focus on
  the next expand. Collapsing now drops it.
- B, the column header "+" and edit button were dimmed (opacity 0.7, a local
  override of `mat-icon-button`), the section "+" was not. The override goes:
  both headers use Material's own icon button, like the work view's section
  actions. Screenshots `review-*` (1280 and 400px).

Checked, not changed:

- A's guard is complete: CDK enter predicates (`canEnter`), card drops,
  keyboard and multi-select moves (`moveTasks`, also from the board's
  `adjacentPanel`), list drops and the context menu's moves (`placeRow`,
  `moveRow`), date changes (`_applyDateChanges`), existing tasks picked in an
  add bar (`afterTaskAdd`), new tasks (`isAddTaskHidden`, `newTaskTarget` for
  `ViewTaskListRegistry`) all go through `_changesToMatch`. Only ids the
  change adds are checked, so a task already carrying a dangling id still
  moves. `tagIdSet` is not in `ctx`; `task.component` is untouched.
- The Done column keeps its "+": it had an add row before (done state never
  made new tasks unreachable), and adding there logs a done task. Removing it
  would be a behaviour change outside this phase.
- `TASK_CARD_LIST_ADD_BTN_SELECTOR` matches only the header "+" (no button of
  the add bar carries the marker); bulk focus recovery stays inside the board
  column and planner scopes keep `add-task-inline`.
- Translations: only `en.json` changed; `npm run int` regenerates the same
  `t.const.ts`; the removed `CREATE_NEW_TAG(S)_MSG` keys have no users left
  (other locales drop them through the i18n script).

Not fixed:

- "Any of" required tags: a new task gets the first one, so a panel whose
  first required tag is missing hides its "+" even when a later one exists,
  and an untagged task can't enter it. Safe (no dangling id), only over-blocks;
  the default views don't use "any of".
- A column without a "+" (missing tags, overdue) still gives the arrow keys
  no focus target when empty. Known gap from §14, now visible on a fresh
  Eisenhower Matrix (three empty quadrants); Tab still reaches the edit button.
- An open bar whose panel stops taking new tasks (its tag deleted on another
  device) hides but keeps `isAddOpen`; it would reopen if the tag came back.
  Rare, harmless.
- The section header is `role="button"` with the "+" inside it (nested
  interactive control), the same pattern as the work view's section ⋮.
- In a 280px column the add bar's action row scrolls sideways (the bar's own
  layout).

Phase 7 plan review (fresh-context subagent, 2026-10-31). Checked §15
against the code (`page-title`, `boards.component`, `board`, `nav-view-group`,
`tree.animations`, `src/app/ui/animations/`, `app.component`, the editor and
dialog, `_overwrite-material.scss`, the E2E helpers and their callers, the
Angular router/control-flow sources). Changed:

- A: the plan guessed at icon uses in the section header, start-page
  setting, bottom-nav slot and default views. None pick a view icon: those
  use `NAV_SECTION_ICON.BOARDS` (`grid_view`) or none. The only two places
  are `getViewIcon` and `LAYOUT_OPTIONS`; three specs pin the icon. Icon
  changed from `view_agenda` to `view_list`: both are in the bundled font
  and unused, but most one-column views are one list, and it matches the
  **List** label.
- B, wrong claim: "keyboard-activatable like today's title". `RouterLink`
  on a `<div>` sets `tabindex="0"` but handles only `click`, and the title
  has `outline: none`, so today it is an invisible tab stop that Enter
  does nothing on (the page-title spec comment "not focusable" is also
  wrong). Now specified: one element, static `tabindex`, `[routerLink]`
  `null` on views, `role="button"`, Enter/Space, a `:focus-visible` ring.
  `aria-label` "Edit view" dropped: it would hide the view's title from
  screen readers; the tooltip describes it instead. `/boards` without views
  keeps the link like the other section pages. If the feedback meant every
  page's title, that is a separate, app-wide decision.
- C, wrong claims: the side menu has no row-level list motion to reuse
  (projects and tags only animate a section's expand); the section "+" add
  bar doesn't pop, `add-task-bar` animates itself (`@blendInOut`), so that
  item is cut; reduced motion is not handled app-wide (only the in-app
  setting disables Angular animations, and dialogs sit outside it), so
  "match how warpRoute behaves" means adding nothing, and the editor gets
  no Angular animation. Specified instead: a `[@viewSwitch]` state-change
  trigger on the reused `<board>` element, between view ids only (an
  `:enter` would run a second time after `warpRoute`'s `animateChild()`),
  no `animateChild()`; `@expandCollapse` on view rows behind the existing
  first-render gate; a leave-only collapse for the callout, with
  `.hasMissingTags` replaced by `:has()` (otherwise the leaving callout
  stretches to a `1fr` row for 195ms); `provideNoopAnimations()` for the two
  specs that don't have it. Noted gaps: the first view created from the
  empty state, and the view shown after deleting the open one, enter from
  `void` and don't animate.
- D, full screen: no reusable full-screen-on-mobile pattern exists; a
  shared `fullscreen-xs-dialog` panel class, safe areas, the global
  `max-width: 96vw !important` it must beat and the iOS keyboard rule it
  must not.
- D, one row per rule: `tag-edit` has no form-field label slot, so tag rules
  keep a text label; `aria-label` stays on the selects (MatSelect then names
  the combobox by it exactly, which the E2E helpers query).
- D, accordion: the plan's collapsed card showed the title as text, which
  unrenders the title inputs `buildBoard()` validates through NgModel, so a
  collapsed empty title would have saved, and it breaks the board-edit and
  E2E checks that read every title field. The title field and ⋮ now stay;
  a separate full-width toggle button carries count and summary (no nested
  interactive controls), so "opens on Save" isn't needed. State location,
  the initial open panel, the one-panel case and the summary's sources
  (`getSetRules`, `VIEW_RULE_LABELS`/`OPTIONS`) specified; one new string.
- D, E2E helpers: `addViewRule`/`setViewRule`/`setViewSort` expand first;
  `board-keyboard-navigation.spec.ts` (section 1) is the caller that would
  break silently otherwise; section-0 and title queries keep working.
- Docs: the wiki update (`4.05-Board-View.md`) was missing.

Checked, not changed:

- No stored shape, action or op changes; the untouched-save fixtures and
  `getViewUpdates` path are untouched (titles stay rendered).
- Switching views keeps the `board` host's scroll offset (same element);
  pre-existing, not part of this feedback. A keyed rebuild would reset it
  but needs its own enter handling; left for a report.
- Focus is lost to `body` when Create Tags removes the callout (phase 6,
  with or without the animation). Left as is.
