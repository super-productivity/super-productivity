# Saved views — boards become views in the sidebar

Status: plan, 2026-10-30, revised after review. Mocks: [Smart Lists Mocks
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
  the routed id. The page title in the main header shows the view title and
  icon (`page-title.component.ts` gets a `/boards/<id>` case instead of an extra
  in-page header); a header more-menu offers Edit, Duplicate, Delete. Tab group
  and inline add-board tab are removed.
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
