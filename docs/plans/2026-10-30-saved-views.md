# Saved views — boards become views in the sidebar

Status: plan, 2026-10-30. Mocks: [Smart Lists Mocks canvas](https://claude.ai/artifact/9GtPQWm3oEVEzrC6Vh55jf) (private to the author).

## 1. Problem

Users want saved, rule-based task lists that they can open from the menu
(#10347, #10654, #6039; the [market scorecard](../market/scorecard.md) lists
"Saved filters" as an Organization gap, a must-not-lose-badly dimension).

Super Productivity already has the engine: a **board column** (`BoardPanelCfg`)
is a saved query over all tasks (tags all/any, exclude, projects, done,
scheduled, backlog, sort) with manual order and write-back on add and drop. What
it lacks compared to other apps:

1. **Access.** Boards sit behind one "Boards" menu entry and a tab bar. A single
   board cannot be opened from the sidebar.
2. **Date rules.** No "overdue / today / tomorrow / next 7 days" column. This is
   the gap the maintainer named on #10347 and the most common rule in other
   apps.

Demand is thin (#10347 and #10654: one author, 0 reactions; #6039: 1 reaction),
so this plan takes the leanest route: no new entity, no new action types, one
optional persisted field.

## 2. Prior art

Checked 2026-10 from vendor docs and search results, not hands-on.

| App             | Definition                                                | Combining rules                   | Where it lives                                         | Layouts           |
| --------------- | --------------------------------------------------------- | --------------------------------- | ------------------------------------------------------ | ----------------- |
| Todoist         | Text query (`today \| overdue & #Work`)                   | `&`, `\|`, `!`, brackets          | Filters page; ★ → sidebar Favorites                    | List, board       |
| TickTick (Pro)  | Form: list, tag, date, priority, assignee                 | AND, or advanced AND/OR           | Own sidebar entry                                      | List, kanban      |
| Apple Reminders | Form: tags, date, time, location, flag, priority, lists   | Match all / any                   | Sidebar under My Lists                                 | List              |
| OmniFocus 4     | Rule builder incl. date ranges, tags, estimate, search    | Nested All / Any / None           | Perspectives bar, favorites, Quick Open; synced        | Rich group/sort   |
| Vikunja         | Query string (`done = false && project in …`)             | Same as project filters           | Sidebar with filter icon, ★ to Favorites, Ctrl+K       | List, table, Gantt, kanban |

Sources: [Todoist filters](https://todoist.com/help/articles/introduction-to-filters-V98wIH),
[TickTick Premium 101](https://blog.ticktick.com/2020/10/30/ticktick-premium-101/),
[MacStories on Reminders smart lists](https://www.macstories.net/stories/reminders-smart-lists-put-unprecedented-control-in-the-hands-of-users/),
[OmniFocus custom perspectives](https://support.omnigroup.com/documentation/omnifocus/universal/4.8.11/en/custom-perspectives/),
[Vikunja saved filters](https://vikunja.io/help/saved-filters).

**Take:**

- A saved view is a **sidebar entry** (all five).
- **Date-relative rules** (overdue, today, tomorrow, next 7 days).
- One saved view can be shown with several columns (Todoist and Vikunja boards
  on filters). Ours keeps per-column rules, which is more flexible than
  group-by columns.

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
   unchanged. Internal names (`boards` store slice, `BoardCfg`, `/boards` route,
   `isBoardsEnabled`, action strings) stay; only user-facing strings change from
   "board" to "view".
2. **The "Boards" menu entry and the tab bar go away.** A **Views** section in
   the sidebar lists every board in stored order (`boardCfgs`), between the main
   routes/plugin entries and Projects. It has a "+" to create a view, drag to
   reorder (existing `sortBoards`), and a context menu per view (Edit, Duplicate,
   Delete). The section is gated by the existing `isBoardsEnabled` feature flag
   (off for new installs, `new-install-config.const.ts`).
3. **One route per view:** `/boards/:boardId`. `/boards` without an id resolves
   to the last opened view (`LS.SELECTED_BOARD`, now storing the board id instead
   of the tab index; an old numeric value is ignored), else the first view, else
   an empty state with "Create view". An unknown id (deleted, or not synced yet)
   redirects to `/boards`. The mobile bottom-nav slot `boards` and the "Boards"
   start page keep pointing at `/boards` and so open the last view, with no
   config change.
4. **Date rule per column:** new optional `BoardPanelCfg.dueState?`, one of
   `overdue`, `today`, `tomorrow`, `next7Days`; absent means "any". Details in §5.
5. **Not in this change** (each its own later step, only on demand):
   - list layout for one-column views (full task rows instead of cards);
   - "Save as view…" from the sort/group/filter menu;
   - one shared rule module for board columns and that menu (`TaskCriteria`);
   - deadline, estimate, priority or keyword rules on columns.

## 4. UI

Matches the mocks, minus the parts listed under §3.5.

- **Sidebar section** (`nav-view-group` component, new `NavItem` type
  `'viewGroup'`): header row like Projects/Tags (expand toggle stored in
  `LS.IS_VIEW_LIST_EXPANDED`, "+" button "Create view"). Rows are route links to
  `/boards/:id` with an icon: `filter_list` for a one-column view,
  `view_kanban` otherwise. Right-click or the row's more-button opens Edit,
  Duplicate, Delete. Rows are reorderable with CDK drag-and-drop, dispatching
  the existing `sortBoards`. In the compact rail, rows show icons only.
- **View page** (`BoardsComponent`, now single-board): a header with the view
  title and a more-menu (Edit, Duplicate, Delete), then the existing `<board>`.
  The tab group and the inline add-board tab are removed.
- **Create:** "+" opens `DialogBoardEditComponent` with `DEFAULT_BOARD_CFG`,
  titled "Create view"; after saving, navigate to `/boards/<newId>`.
- **Delete** of the open view navigates to `/boards` (next view or empty state).
- **Column editor:** the panel form gets a "Due date" select: Any, Overdue,
  Today, Tomorrow, Next 7 days.
- **Strings** (`en.json` only; keys unchanged): `MH.BOARDS` → "Views", the
  feature toggle label, "Add new board" → "Create view", "Edit board" → "Edit
  view", the delete confirmation. Other languages keep their current text until
  translators update it; no placeholders change.

## 5. Date rule semantics

Pure helpers in `boards.util.ts`, next to `doesTaskMatchPanel` /
`rewriteTagIdsForPanel`:

- A task's **logical due day** is `task.dueDay`, else
  `getDbDateStr(task.dueWithTime - startOfNextDayDiffMs)` (rule 4; same
  calculation as `DateService.isToday`), else none.
- `doesTaskMatchPanel` takes a context `{ todayStr, startOfNextDayDiffMs }`; the
  panel passes `GlobalTrackingIntervalService.todayDateStr()` (a signal that
  changes at day rollover, so columns refresh) and
  `DateService.getStartOfNextDayDiffMs()`.
  - `overdue`: due day < today. (Done-ness is the separate done rule.)
  - `today`: due day = today.
  - `tomorrow`: due day = today + 1.
  - `next7Days`: today ≤ due day ≤ today + 6.
  - A task without a due day never matches a set `dueState`.
- **Write-back** (`getDueDayForPanel(panelCfg, todayStr)` → a day string, or
  `null` when no date can satisfy the rule, or `undefined` when no date change
  is needed):
  - `today` / `tomorrow`: schedule for that day via
    `TaskBulkActionService.scheduleFor` (keeps a task's time of day, uses
    `planTasksForToday` / `planTaskForDay`, so Today ordering and reminders stay
    correct). This replaces the schedule dialog that `Scheduled` columns open.
  - `next7Days`: a task already in range stays; otherwise schedule for today.
  - `overdue`: cannot be satisfied. Drops of tasks that don't already match are
    refused (`cdkDropListEnterPredicate`, and `moveTasks` returns `false` for
    keyboard moves). The inline add row is hidden.
- **Unknown values** (written by a newer client) are treated as "any" when
  read, never rejected or rewritten (see §6).

## 6. Sync, persisted model and long-term cost

- **Persisted model:** one optional field, `BoardPanelCfg.dueState?`, on the
  existing `boards` slice. Runtime default: absent = any. No schema bump
  (rule 10). `frozen-state.spec.ts` is unaffected (optional field).
- **Validation:** typia `createValidate` ignores unknown properties, so
  released clients accept panels carrying `dueState`. typia compiles a
  string-literal union into a closed membership check, so a value added by a
  future client would read as corruption on this one (the repair-dialog wedge
  described in `validation-fn.ts`, which asks for open-ended enums to be
  "opaque strings in the synced model"). Decision: the persisted field is
  `dueState?: string`; `BoardPanelDueState` is a code-only union, and
  `getPanelDueState(panelCfg)` narrows it, returning `undefined` (any) for
  unknown values.
- **Released clients** ignore `dueState`, so such a column shows every task
  that matches its other rules there. They keep their Boards tab page; all views
  are visible there. Acceptable degradation, no data loss.
- **Ops:** no new action types. Column edits use `updateBoard`; ordering uses
  `sortBoards`; scheduling on drop uses the existing scheduling actions, one
  user intent per task as today. Remote ops don't trigger anything new (no new
  effects).
- **Growth:** none; boards are user-created and few.
- **Plugin API:** untouched.

## 7. Implementation steps

1. `boards.model.ts`: `BoardPanelDueState` type and `dueState?` field.
   `boards.util.ts`: `getLogicalDueDay`, `doesTaskMatchPanel` context argument
   and due checks, `getDueDayForPanel`. Unit tests (offset day start, rollover,
   unknown value).
2. `board-panel.component`: pass the context; write-back in `moveTasks` and
   `afterTaskAdd`; drop predicate; hide inline add for `overdue`.
   `boards-form.const.ts`: Due date select. Spec updates.
3. Routing: `boards/:boardId` route; `BoardsComponent` becomes a single-view
   page with header menu and empty state; `/boards` redirect logic; LS stores id.
4. Sidebar: `NavViewGroupItem` + `nav-view-group` component; remove the Boards
   route item; expansion state; create/edit/duplicate/delete/reorder.
   Duplicate/delete logic moves to a small `BoardsService` shared by the page
   and the sidebar (≤ 1200 lines rule irrelevant; keeps both callers thin).
5. Strings in `en.json`; wiki `4.05-Board-View.md` and
   `3.02-Settings-and-Preferences.md` (feature toggle label).
6. E2E: update `e2e/tests/boards/*`, `scheduled-date-colors.spec.ts` and any
   other spec that clicks board tabs to open `/#/boards/<id>` (default ids
   `KANBAN_DEFAULT`, `EISENHOWER_MATRIX`) or the sidebar row. New spec
   `e2e/tests/boards/views-sidebar.spec.ts`: create a view from the sidebar "+",
   it appears and opens; the Boards menu entry is gone; a Today column schedules
   a dropped task for today; an Overdue column refuses a drop.

## 8. Tests

- Unit: `boards.util.spec.ts` (due matching incl. `startOfNextDayDiffMs`,
  write-back day, unknown value), `board-panel.component.spec.ts` (write-back
  path, predicate), nav config spec (views section present when enabled, Boards
  route item absent), `BoardsComponent` route resolution.
- E2E: §7.6. Run `npm run quiet -- e2e:file <path> --retries=0` per spec.
- Checks: `npm run checkFile` on every changed `.ts`/`.scss`;
  `npm run quiet -- test:affected`.

## 9. Risks

- **Muscle memory:** users who opened Boards from the menu now find views in
  the sidebar. The bottom-nav slot and start page still work.
- **Long sidebars** for users with many boards: the section collapses and rows
  reorder; folders only if asked.
- **E2E churn** across several board specs; mechanical.

## Review

_Filled in after the review pass._
