# Native-component spike: generative view rendered with SP's own components

Throwaway spike. Question: does a generative view drawn with SP's own Angular components feel clearly better than the plugin's look-alike rendering, and what hidden dependencies and side effects appear when hosting those components outside their usual pages? Decides "plugin draws look-alikes" vs "plugin + generic host `showNativeView(spec)` API".

Everything is uncommitted on branch `claude/generative-ui-todo-app-h4o6e8`; every new file starts with `// SPIKE: throwaway, do not merge`, and each edit to an existing file has a SPIKE comment.

## 1. Result in one paragraph

It works, and it was cheap. One hard-coded spec (a stack with a metric, a chart, a kanban and a next-3-days agenda) renders with `board`, `board-panel`, `planner-day`, `planner-task`, `lazy-chart` and `msToString`, hosted on a plain route with no work-context or route coupling inside the components. The result is visibly better than the plugin's look-alike: real estimates, project labels, due labels, tag chips, done styling, the app's own theme, and working drag and drop that goes through the app's normal task actions. Viewing wrote zero ops (measured). The costs are not in rendering, they are in the hazards around it: persistent-by-default board-order writes, a "create missing tags" gate in `board`, the layout contract (`cdkDropListGroup`, bounded height), and the fact that a host API would need a new service file because `plugin-bridge.service.ts` has zero line headroom.

## 2. What rendered natively (effort, line counts)

| Spec part                                 | SP component                                                                     | Notes                                                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) kanban To do / Doing / Done           | `board` > `board-panel` x3 (`<board cdkDropListGroup [boardCfg] [isEphemeral]>`) | In-memory `BoardCfg` built from spec; "Doing" = SP's built-in in-progress tag (`IN_PROGRESS_TAG.id = 'KANBAN_IN_PROGRESS'`) via alias `@doing` |
| (b) next 3 days agenda                    | `planner-day` x3 inside `cdkDropListGroup`, days from `PlannerService.getDays$`  | Same hosting pattern as `pages/daily-summary/plan-tasks-next-week` (`.component.ts:34`, `.html:15`)                                            |
| (c) time per project, bar chart           | `lazy-chart` (`type="bar"`)                                                      | Data from all tasks in the store + `selectUnarchivedProjects`; rolling 7 days (not calendar week)                                              |
| (d) metric tile, remaining estimate today | plain `<p>` + `msToString` pipe over `selectAllTasksDueToday`                    | Verified value `2h 25m` in the e2e                                                                                                             |

Files (all new, under `src/app/features/native-view-spike/`):

- `native-view-spike.component.ts` 192 lines: standalone OnPush, recursive `ng-template` + `@switch` over `component.type`, plain HTML layout.
- `spike-view.model.ts` 51 lines: the hard-coded spec (`SPIKE_VIEW`) and its types.
- `spike-view.util.ts` 106 lines: tag aliases, `scopeOfContext`, `columnsToBoardCfg`, `remainingMs`, `timePerProject`.
- `e2e/tests/spike/native-view-spike.spec.ts` 336 lines.
- Edits to existing files (4 files, +30/-14): `app.routes.ts` (+10, lazy route `native-view-spike`), `board-panel.component.ts` (`isEphemeral` input plus `_saveOrder()` wrapper, 3 dispatch sites), `board.component.ts` (+2, `isEphemeral` input), `board.component.html` (+2, pass-through).

Effort: about 350 lines of spike code written in one pass. Compile and template errors: none. Rework was lint-only (an object key naming rule, a mixed-operator rule in the e2e) and one e2e fix (see "could not verify / test notes"). Lint (`npm run checkFile`) passes on all 7 touched files. `board-panel.component.spec.ts` (46 tests) still passes after the edits. The route is `#/native-view-spike`.

Whether it feels better: yes, clearly, for the board and agenda. The plugin card shows title and a play button; the native card shows title, estimate, project, due label, tags and done styling, and the agenda shows `Planned: 2h 25m / Available: 8h`. See screenshots in section 7.

## 3. Hidden dependencies (file:line)

Verified by running unless marked "read".

1. **No route or work-context coupling in the components themselves.** `board-panel` pulls tasks from `selectAllTasksInActiveProjects` (`board-panel.component.ts:245`) and matches with `doesTaskMatchPanel` (`:332`); `planner-day` takes a `PlannerDay` input. The "active work context" only enters through store state (`selectActiveContextTypeAndId`, `work-context.selectors.ts:131`); the route has none of its own. The top bar showed "Today" because that was the last visited context. A host must pick the scope itself.
2. **`cdkDropListGroup` host.** Cross-column and cross-day drops only work if an ancestor carries it: stock page puts it on `<board cdkDropListGroup>` (`boards.component.html:30`), `plan-tasks-next-week.component.html:15` does the same for days. The spike adds it on `board` and on the agenda wrapper; without it columns are isolated lists. The drop list is `.task-items` inside the panel (`board-panel.component.html:36`), below the header and the add button, so a drop is only accepted over that region.
3. **Bounded height for `board`.** Host CSS is `display:grid; grid-template-columns: repeat(var(--cols),1fr); max-height:100%; min-height:100%; overflow:auto` (`board.component.scss:3-12`) and `--cols` is set by a host binding (`board.component.ts:42`). Inside a stack the spike wraps it in a 420px frame. `board-panel` also has `min-height: 200px` (`board-panel.component.scss:7`).
4. **`board` gates on tag existence.** `missingTagIds` (`board.component.ts:92`) hides every panel and shows a "create missing tags" prompt until each tag id in `includedTagIds`/`excludedTagIds` exists. The built-in `KANBAN_IN_PROGRESS`, `EM_URGENT`, `EM_IMPORTANT` do not exist on a fresh install; the e2e creates them by clicking the stock Boards page prompt first. `createTags()` (`:100`, dispatches `addTag` at `:119`) only runs on an explicit click, so viewing does not add tags, but a native-view host must either bypass `board` and use `board-panel` directly, or pre-create tags in an explicit user action. The TODAY tag is virtual (never in `task.tagIds`), so a board cannot be scoped to "Today" by tag; the spike scopes TODAY context to all active projects.
5. **Multi-select scoping.** `TaskMultiSelectService` is root-provided (`task-multi-select.service.ts`), scope is found by `closest('[data-board-selection-scope], [data-planner-selection-scope], .task-list-inner')` (`:6`). `board-panel` sets `data-board-selection-scope` itself (`board-panel.component.ts:115`) and `planner-day` sets `data-planner-selection-scope` (`planner-day.component.ts:85`), so hosting inherits it for free. Clearing on route/context change is wired in `app.component.ts` (injection at `:189`), not in the components. Panel ids must be namespaced (spike uses `spike:<component>:<column>`) to not collide with stored panel ids in the scope selector and in reducers.
6. **Injection tokens.** `board-panel` injects Store, TaskService, MatDialog, TaskMultiSelectService, GlobalTrackingIntervalService, DateService, GlobalConfigService (`board-panel.component.ts:129-138`); `planner-day` injects TaskMultiSelectService, Store, MatDialog, TaskService, DateService, LayoutService, DateTimeFormatService, ScheduleExternalDragService (`planner-day.component.ts:67-74`); `planner-task` optionally injects `TASK_CARD_LIST` (`planner-task.component.ts:74`). All are root-provided, so a lazy route needs no extra providers. `lazy-chart` injects ChartLazyLoaderService (lazy `import('chart.js')`), ShareService, SnackService.
7. **`DropListService` is not involved.** It is used only by `task-list`; board-panel and planner-day do their own cdk drop handling. `task-list` was out of scope for this spike (read).
8. **Writes triggered by user intent are real and un-ephemeral.** A cross-column drop calls `rewriteTagIdsForPanel` + `taskService.updateTags` (`board-panel.component.ts:463-469, :531-534`), i.e. a real `UPD:TASK` op. That is correct behaviour (user intent = one op), but a host spec author must know "dragging between columns edits tags".
9. **`updatePanelCfgTaskIds` is persistent even for an in-memory panel** (`boards.actions.ts:58-66`, `meta.isPersistent: true`, `entityType: 'BOARD'`, `entityId: panelId`). The reducer no-ops for an unknown panel id (`boards.reducer.ts:207-214`), but the op is still captured. Measured below.
10. **Plugin bridge cap (read, from `c-native-vs-plugin.md`):** `plugin-bridge.service.ts` is at its pinned `max-lines` cap, so a host method needs a new service.

## 4. Ops written (measured)

Method: the e2e flushes pending writes (`window.__e2eTestHelpers.flushPendingWrites()`), reads all entries from IndexedDB `SUP_OPS` store `ops` (compact keys `a`/`o`/`e`/`d`) and diffs the entry count before/after each phase. Two full runs gave identical results.

| Phase                                                                                         | Ops written                                                                                                     |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Mount `#/native-view-spike` + 4s idle, hover, scroll (all four parts rendered, chart painted) | **0**                                                                                                           |
| Drag To do -> Doing on the spike board, `isEphemeral` on (my no-persist change)               | 1: `UPD:TASK` (tag change, real user intent), 0 BOARD ops                                                       |
| Drag back Doing -> To do with stock behaviour (`?persistOrder=1`, `isEphemeral` off)          | 2: `UPD:TASK` + `UPD:BOARD:spike:board:todo` (an orphan BOARD op for a panel id that exists in no stored board) |
| Baseline: same drag on the stock Boards page                                                  | 2: `UPD:TASK` + `UPD:BOARD:IN_PROGRESS`                                                                         |

Conclusions: viewing is write-free as long as the user does nothing (the tracking interval, `lazy-chart`, `board` and `planner-day` all idle silently). A drag writes the necessary task op, plus, unless suppressed, an orphan BOARD op that would also sync to other clients and accumulate. The minimal fix is the `isEphemeral` input (flagged below).

Not measured: add-task-inline (user-initiated by design), task done toggles inside cards (same path as everywhere), multi-device sync of the orphan op.

## 5. Minimal no-persist change (flag for review)

`board-panel.component.ts`: `isEphemeral = input(false)` and a private `_saveOrder(taskIds)` that returns early when ephemeral, else dispatches `BoardsActions.updatePanelCfgTaskIds`. The 3 existing dispatch sites go through it. `board.component.ts` and `.html` pass the input through. Default false means unchanged behaviour (46/46 `board-panel` unit tests pass). This touches shared board components, so it is not for merge as is; for a real host the cleaner shape is a panel-cfg flag (e.g. a `BoardPanelCfg` field) or a dedicated read/ephemeral variant, to be decided in the ADR and subject to the persisted-model-fields rules if it ever lands on a stored model.

## 6. What a real `showNativeView(spec)` host would need

- A new service file (not the bridge): `plugin-bridge.service.ts` has zero headroom under its pinned cap (`c-native-vs-plugin.md`, eslint cap). The bridge only forwards.
- A lazy `<plugin-native-view>` mounted in the existing work-context embed slot, hosting the component tree. No iframe, so plugin code never touches Angular; the plugin only sends data (spec), not templates.
- A catalog with a stable schema (stack/columns, board, agenda, chart, metric, taskList, card). The spike's `SpikeComponent` is a rough prototype of it. Every catalog item is a new public plugin-API surface, i.e. the "permanence" rule applies.
- A scope resolver: the host, not the spec, maps "current context" to project/tag filters (TODAY is virtual; section 3.4).
- Tag handling: either prerequisites for built-in tags before mounting `board`, or use `board-panel` directly with a spec-supplied tag mapping; never trigger `addTag` silently.
- Persistence policy: a first-class ephemeral mode (section 5), an explicit decision on whether drag edits tags (UPD:TASK) is allowed, and namespaced panel ids.
- Layout contract: host provides `cdkDropListGroup` and a bounded height per item; the spec must not control CSS. Responsive behaviour (`board` collapses to 1 column at `xs`) is inherited.
- Security: the spec is data, so rendering is as safe as the catalog; task titles in cards go through Angular templating. Validation of spec shape/size and problem reporting (the `NativeViewProblem[]` return in the plan) still needed.
- Tests: spec-validation unit tests, an e2e like this spike's (ops-unchanged assertion on mount), and `board-panel` specs for the ephemeral mode.

## 7. Screenshots

- Native: `.tmp/research/generative-views/spike-native.png` (taken after mount + idle, before any drag; 1400x1700 viewport, full page).
- Plugin look-alike, same tasks, after one drag into "Doing": `.tmp/research/generative-views/spike-plugin.png`.

Differences visible in the pair: the plugin cards show title and a play button only; the native cards show estimates, project, due label, tags and done styling, and the page also has the metric, the chart and the agenda (the plugin test only covered the kanban part). Scope semantics also differ: the plugin board used `scope: '@current'` (today's tasks only, 2 in To do), while the native board shows all undone tasks in active projects (3 in To do, including the task planned for tomorrow); that is a spec/scope difference, not a rendering one.

To open locally: `npm run startFrontend`, then open `<dev server URL>/#/native-view-spike` (the URL the dev server prints). `?persistOrder=1` switches the stock persistent order-writing behaviour on, but needs a reload since it is read once at construction. Create the built-in tags first by opening Boards > Kanban and clicking the "create missing tags" button, otherwise the spike's kanban section shows the create-tags prompt. Run the spec: `E2E_WORKERS=2 npm run quiet -- e2e:file e2e/tests/spike/native-view-spike.spec.ts --retries=0`.

## 8. Could not verify / caveats

- Visual comparison is from two screenshots in one theme (light) and one viewport; no dark theme, mobile viewport, touch drag (long-press delay `dragDelayForTouch`), or keyboard navigation checks.
- The spike resolves "current context" from the last visited context and was exercised only on TODAY/Inbox, not on a tag or project context with its own scope.
- Multi-select across hosted components was read, not exercised (no shift-click/range test).
- Sync behaviour of the orphan `BOARD` op on another client was not tested (only that it is recorded locally).
- Time-per-project chart is a rolling 7 days of tracked leaf-task time, using `timeSpentOnDay` for the days listed; only one project existed in the test, so multi-project colours and ordering are untested.
- Performance with large task lists is untested; `board-panel` recomputes from `selectAllTasksInActiveProjects`, and each panel filters the whole list.
- Test notes: the first e2e run failed on the drag only because my helper dropped on the panel's "Add" row; the cdk drop list is the `.task-items` block below it. That is a test-driver detail, not an app defect, but it shows the hit area is smaller than the visible column.
- The spike's reliance on `board` inheriting a 420px frame is a stand-in, not a layout design.
