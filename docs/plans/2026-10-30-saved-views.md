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
