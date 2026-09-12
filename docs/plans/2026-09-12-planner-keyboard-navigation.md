# Planner keyboard navigation and multiselect

## Objective

Make Planner's real task cards usable with the keyboard and the existing task
multiselect actions, keeping the compact Planner layout and existing shortcut
configuration. Implementation is authorized by the request to write and execute
this plan using Sol.

## Scope and behavior

- Include overdue, all-day, and timed task cards in Planner.
- Tab can enter task cards; Up/Down follows the day's real tasks in visual order.
  Left/Right moves between days, skipping days without real task cards and choosing
  the corresponding row where possible. Navigation scrolls the destination into view.
- Existing next/previous-task bindings work. Inputs and open menus/dialogs retain
  their normal keyboard behavior; custom shortcut bindings retain precedence.
- Reuse configured shortcuts for completion, time tracking, scheduling (including
  today/tomorrow/next week/next month, deadline, and unschedule), delete, estimates,
  and context menus. Enter opens task details so editing remains keyboard accessible.
- Reorder shortcuts use existing Planner ordering actions for all-day tasks, with
  Today's existing ordering semantics. Timed tasks retain chronological ordering.
- Ctrl+Shift+Left/Right moves the focused task one calendar day earlier/later,
  preserving timed tasks' clock time and reminder and restoring focus after moving.
- Ctrl/Cmd-click and X toggle a task. Shift-click and Shift+Up/Down select ranges
  within one day, including its all-day and timed task cards. Ctrl/Cmd+A selects
  that day's real tasks. Overdue is its own selection scope.
- Ctrl/Cmd-click can retain selections across days. Escape clears selection.
  Selection styling, bulk toolbar, and existing bulk actions work for Planner.
- Single-click focuses a task card; double-click opens its details. Enter also
  opens details. Embedded controls retain their own focus and behavior. Modifier
  selection must not open details, toggle completion, or activate links/drag.
- Completing, deleting, or rescheduling tasks preserves useful focus and removes
  selection only when the task no longer has a live selectable card. Closing the
  bulk menu restores focus without stealing it from dialogs or inputs.
- Deadline markers may duplicate a task shown elsewhere; they are not selectable
  task cards in this increment. Calendar events and repeat projections are also
  outside task multiselect. Existing interactions remain available.
- Boards and the scheduled-list page also use PlannerTaskComponent. Enable this
  behavior explicitly for Planner so those views retain their current behavior.
- No new settings, dependencies, persisted fields, sync operations, or bulk drag.
  Full inline task-row editing and touch selection parity are outside this scope.

## Implementation approach

Reuse TaskMultiSelectService, TaskBulkActionService, and the app-shell bulk bar.
Extend their row discovery/focus handling to explicitly participating Planner cards.
Keep Planner-specific navigation and reorder behavior close to Planner. Avoid
making Planner pretend to be the full TaskComponent or copying that component's
entire shortcut implementation. Extract only a small shared boundary if needed by
both real consumers. Reuse existing action services and dialogs for mutations.

## Ordered slices

### 1. Focusable Planner cards and navigation

Dependencies: none. Likely files: Planner task/day components and a focused
navigation collaborator/spec if necessary (split wiring from navigation logic).

- [x] Add Planner-only focus participation and visible focus styling.
- [x] Implement within-day and between-day navigation, including unequal/empty days.
- [x] Keep input, dialog, menu, and other-view behavior intact.

Verification: failing behavior tests followed by focused unit tests; browser
navigation through overdue, all-day, and timed cards, including scroll boundaries.

### 2. Selection and the existing bulk UI

Dependencies: slice 1. Likely files: TaskMultiSelectService/spec and Planner card
component/template/style. Keep shared changes minimal and preserve regular lists.

- [x] Implement modifier clicks, X, range extension, select-all, and Escape.
- [x] Use a day as the range boundary and task IDs as the bulk action identity.
- [x] Show existing selection feedback and bulk UI; prevent selection clicks from
      triggering ordinary card or embedded-control actions.

Verification: focused service/component tests for day boundaries, mixed sections,
cross-day selection, details-panel exclusion, and nonparticipating Planner cards.

Checkpoint: navigation and selection work together before adding more shortcuts.

### 3. Task shortcuts and Planner ordering

Dependencies: slices 1-2. Likely files: TaskShortcutService/spec plus Planner
shortcut collaborator and day component. Split routing and ordering work if needed.

- [x] Route the in-scope configured shortcuts to the actual focused Planner card.
- [x] Existing bulk-capable shortcuts apply to selected tasks, preserving the rule
      that a focused unselected task is acted on individually.
- [x] Reorder all-day cards through existing Planner/Today actions, preserving focus;
      never reorder timed cards through task-list ordering commands.

Verification: focused tests for custom bindings, single/bulk targeting, stale task
focus, overlays, and Planner ordering. Do not alter sync reducers or operation
semantics; if that becomes necessary, first reproduce a concrete state failure and
read the contributor sync model.

### 4. Focus restoration and lifecycle

Dependencies: slices 1-3. Likely files: bulk action service/spec, bulk bar/spec, and
Planner card lifecycle implementation/spec.

- [x] Restore focus after single and bulk removal, rescheduling, and menu closure.
- [x] Prune removed cards while preserving moved cards; avoid detail-panel copies
      and detached/destroyed hosts as focus targets.
- [x] Keep navigation-change clearing and standard task-list behavior working.

Verification: meaningful removal/move/menu regression tests and browser exercises.

### 5. Documentation and integrated verification

Dependencies: slices 1-4. Likely files: keyboard shortcuts wiki, focused Planner
E2E spec, and this plan's execution record.

- [x] Document supported keys, selection scope, and excluded Planner item types.
- [x] Run checkFile on every modified TypeScript/SCSS file and format other files.
- [x] Run affected unit suites, TypeScript/Angular checks as appropriate, and a
      focused browser/E2E flow covering navigation, selection, and a bulk mutation.
- [x] Review the diff for unnecessary abstractions, regressions in shared task
      lists/Boards/scheduled list, and focus or selection performance problems.

## Risks and verification priorities

Focus identity must follow the actual card, not a stale full-task component. Planner
timed tasks use wrappers, so direct-child task-list queries cannot simply be reused.
Selection restoration must tolerate cards moving between days. Shared task-row
changes must avoid adding per-row DOM scans or hot-path change-detection work.
No sync format changes are expected; exercise existing scheduling and ordering
actions through resulting UI/state behavior, not dispatch assertions alone.

## Execution record

Completed on 2026-09-12 by Sol implementation and E2E workers, with independent
parent review and live-browser verification. All five slices are complete.

The implementation spans ten production files because Planner cards and the shared
shortcut, selection, bulk-action, and focus paths all needed integration. The
remaining changes are tests and documentation. No task-list component hot-path
changes or sync-format changes were needed.

Verification passed:

- 175 unit tests across seven suites: PlannerTask (25), TaskBulkAction (28),
  TaskShortcut (53), TaskMultiSelect (33), TaskMultiSelectBar (7), PlannerDay (3),
  and BoardPanel (26).
- Six Planner E2E scenarios and two existing normal-list multiselect regressions,
  with retries disabled. The Planner scenarios cover all-day/timed navigation,
  within-day and cross-day selection, bulk completion, J/K and confirmed deletion,
  unscheduling with focus recovery, and visible all-day reordering.
- `npm run checkFile` on every changed TypeScript/SCSS file, including the E2E spec.
- `npm run buildFrontend:dev`, `npm run docs:check-links`, and `git diff --check`.
- Independent browser checks confirmed visible focus/selection, day-scoped select-all,
  bulk menu focus restoration, and deleting every Planner card returning focus to
  the existing Add button. The selection screenshot was inspected at 1280 × 800.

Review corrections included Today ordering's insert-before semantics, native input
selection under Shift-click, custom Meta bindings during input editing, preserving
clock time/reminders during date shortcuts, and focus recovery after the last card
is removed. Bulk focus fallbacks are passed with each action rather than retained
as mutable service state.

Follow-up: single-click now focuses Planner cards and double-click opens details;
Enter remains available. Embedded controls keep their own interactions, and other
views retain single-click detail opening. The expanded PlannerTask suite passes
all 30 tests; live browser checks confirm the click and double-click behavior.

Additional follow-up: Ctrl+Shift+Left/Right shifts the focused task by one day.
The PlannerTask suite now passes all 35 tests, and a new browser regression verifies
consecutive moves in both directions with retained focus. Focus uses the same thin
border and color as regular tasks. The changed TS/SCSS files pass `checkFile`.

The scope exclusions above remain intentional: deadline markers, calendar events,
repeat previews, bulk drag, full inline task editing, and touch selection parity.

## Post-review corrections

- Timed day moves use the actual scheduled date when the displayed logical day
  differs, and preserve modern `remindAt` values, including disabled reminders.
- Keyboard completion of overdue tasks recovers focus when the card is removed
  after its animation; moving focus elsewhere keeps that new focus.
- Bulk-menu focus recovery reuses `findLiveRowEl()` to exclude destroyed hosts.
- Removed the unused mutation focus option. Planner DOM traversal remains scoped
  to participating cards; this correction adds no registry or navigation layer.

Regression tests reproduce the date/reminder and delayed-completion failures, and
the bulk-menu tests cover replacement rows while old hosts remain rendered. A
browser regression exercises actual overdue completion and subsequent focus.
