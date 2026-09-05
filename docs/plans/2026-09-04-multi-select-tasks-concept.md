# Multi-select & bulk actions for tasks — concept

**Status:** Revision 2 after an adversarial and a normal review (2026-09-04). Phase 1 implemented on this branch on 2026-09-05; deviations from the plan are listed at the end of §9.

**Closes / consolidates:** #4645 (27 👍, "Select and change multiple tasks"), #7058 (19 👍, "multi-select / batch operations + recurring tasks"), #6352 ("Deleting multiple tasks at once"). Duplicates already closed in favour of #4645: #5685 (11 👍), #9022. Related: #6486 (delete all instances of a recurring task), #8273 (move tasks to backlog from tag view), #6551 (focused vs. selected task, plugin API). Existing attempt: PR #7146 (far behind master, see §10).

---

## 1. Problem

Every task edit in Super Productivity is one task at a time. Users asking for this feature describe the same three moments:

1. **Replanning:** "I have 15 leftover tasks from yesterday and want to push them all to Friday / unschedule them / drop them into the backlog." (#4645, #7058 comments)
2. **Reorganising:** "I'm restructuring projects and tags and need to move 30 tasks to another project or retag them." (#7058, #4645 comments — two users explicitly say this stops them from adopting the app)
3. **Cleaning up:** "Delete or complete a whole batch of tasks, including all instances of a recurring task." (#6352, #6486, #7058)

One commenter measured it: four clicks to change one date, so 80 interactions for 20 tasks. The product principle _"a feature ships only if it makes users faster"_ applies squarely — this is the rare feature whose whole point is fewer interactions.

There is no selection model in the codebase today. `TaskState.selectedTaskId` is a single id meaning "the task whose detail panel is open", and keyboard shortcuts act on the one DOM‑focused task (`TaskShortcutService` → a method on the focused `TaskComponent`). Parts of a bulk **data layer** exist: `deleteTasks`, `planTasksForToday` and `removeTasksFromTodayTag` take id arrays, and `TaskService.removeMultipleTasks` wraps `deleteTasks` with the issue and time-block sidecars. Most other edits only have single-task actions with single-task effects — which is fine, see §6.

## 2. What other apps do (summary)

| App                       | Enter selection (desktop)       | Extend                        | Keyboard                                                              | Action surface                                                                          | Mobile entry                                                | After action                              |
| ------------------------- | ------------------------------- | ----------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| **Todoist**               | Ctrl/Cmd+click                  | Shift+click range             | —                                                                     | Bar at top of list: date, project, labels, priority, more (complete, duplicate, delete) | Context menu → "Select task", then "Select all"             | Desktop keeps selection, mobile clears it |
| **Things 3**              | Cmd+click                       | Shift+click                   | Existing shortcuts act on selection (⇧⌘M move, ⇧⌘T tags, ⌘K complete) | No bar — context menu + shortcuts + drag to sidebar                                     | Swipe left → select mode, drag over circles for range       | —                                         |
| **TickTick**              | Ctrl/Cmd+click, marquee         | Shift+click, Shift+↑/↓        | Shortcuts act on selection                                            | Side panel: date, priority, list, tags, complete, merge, delete                         | List ⋯ menu → "Select"                                      | —                                         |
| **Linear**                | `X` on focused issue, Cmd+click | Shift+↑/↓, Shift+click, Cmd+A | All single-key shortcuts act on selection; Cmd+K                      | Bottom bar + right-click menu; drag whole selection                                     | —                                                           | Esc clears                                |
| **Apple Reminders**       | Cmd+click                       | Shift+click, ⌘A               | —                                                                     | Context menu, drag to sidebar list                                                      | "Select Reminders" or two-finger drag; bottom toolbar; Done | —                                         |
| **Asana**                 | Ctrl/Cmd+click                  | Shift+click                   | Tab+key shortcuts act on selection                                    | Bottom toolbar with count, max 50                                                       | —                                                           | —                                         |
| **Gmail** (canonical web) | Checkbox column                 | Shift+click, "select all N"   | `X`, `* a`                                                            | Top toolbar swaps to bulk actions; Undo toast                                           | Long-press / tap avatar                                     | Clears                                    |
| **Notion DB**             | Hover checkbox                  | Shift-click, drag             | Shift+↑/↓                                                             | Top bulk-edit bar with property chips                                                   | —                                                           | —                                         |
| **MS To Do**              | Ctrl/Cmd+click                  | Shift+click                   | —                                                                     | Right-click menu only                                                                   | Long-press                                                  | —                                         |
| **Google Tasks**          | none                            | —                             | —                                                                     | —                                                                                       | —                                                           | —                                         |

The table was compiled from the vendors' help pages as surfaced by web search, not from hands-on testing; treat single cells as approximate. Only Things, Linear, Todoist and Reminders inform decisions below.

Guidelines that agree across sources (WAI-ARIA APG listbox pattern, Material "Selection", Apple HIG, NN/g "Bulk actions"):

- Click selects one. **Ctrl/Cmd+click toggles**, **Shift+click ranges** from an anchor, **Esc** clears. Arrow keys move focus without changing selection; **Shift+Arrow extends**.
- Provide **select all**, a **contextual action bar** that only appears while something is selected, a visible **count**, and **feedback + undo** (or confirmation for destructive actions).
- Mobile needs an explicit **selection mode** entered from a menu item ("Select…"): Todoist, TickTick and Reminders all do this rather than repurposing long-press. It comes with a bottom toolbar and a Done/close. Don't show checkboxes on every row all the time.
- Drag a multi-selection as a **stack with a count badge**.

The clearest lesson for us comes from Things and Linear: **the same shortcuts and the same menu act on the whole selection.** For the user there is one action vocabulary. Internally that needs one bulk action layer (§5.1), because today's shortcut handlers and menu are single-task UI code.

## 3. Design goals & non-goals

**Goals**

1. Standard selection mechanics that need no explanation (file-manager conventions).
2. One user-facing action vocabulary: the task shortcuts and the task context menu, applied to N tasks.
3. Zero new settings. Selection is transient, local, never synced.
4. Works in every view that renders `<task-list>` (Today, project, tag, backlog, done list). Planner, boards and schedule views come later, on the same service.
5. Touch-friendly on Android/iOS without breaking the current long-press-to-drag and swipe gestures.
6. Correct with sync: bulk actions go through the same per-task actions and effects as single edits (ARCHITECTURE-DECISIONS #5).

**Non-goals (v1)**

- Marquee / rubber-band selection (conflicts with drag & drop and text selection; TickTick is the only to-do app with it).
- Selection that survives navigation, reload or sync.
- Bulk editing of free-text fields (title, notes).
- Multi-select inside the schedule week grid (different component; tracked as a follow-up, §9 Phase 3).
- Multiple running timers (#9029/#5832 are a different feature).
- Plugin API exposure of the selection (hard-to-reverse surface; wait until the model has settled, see §9).

## 4. Selection model

### 4.1 Three concepts, kept apart

| Concept                   | What it means                                             | Where it lives today                         | Change                                                                                                                                                       |
| ------------------------- | --------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Focus** (cursor)        | The one task row that has DOM focus; arrow keys move it.  | `TaskFocusService`, `getDomFocusedTaskId()`  | Unchanged. Also becomes the **anchor** for range selection.                                                                                                  |
| **Detail task**           | The task whose detail panel is open.                      | `TaskState.selectedTaskId` (misleading name) | Unchanged in v1. Consider renaming to `detailPanelTaskId` when touched. The plugin bridge's `setSelectedTask`/`getSelectedTask` mean this.                   |
| **Multi-selection** (new) | A set of task ids the user has marked to act on together. | —                                            | New `TaskMultiSelectService` (signals, `providedIn: 'root'`), holding `Set<string>` + `anchorId` + `isTouchSelectionMode`. Not in NgRx state, not persisted. |

The name is deliberately _multi-select_, not _selection_, so it can never be confused with the detail-panel id in code, docs or a future plugin API.

**Validity rule (one rule, no special cases):** the selection only ever contains ids of tasks currently rendered as a top-level `<task>` row in the active view, outside the detail panel. The service prunes itself whenever the rendered set changes (sync removed a task, filter or group changed, a group collapsed, a task moved or was deleted or done). The bar count is always the pruned size. A bulk action resolves the ids against the store at execution time and drops anything missing. The selection is cleared entirely on work-context change, route change, entering focus mode, `Esc` (§4.2), and the bar's ✕.

### 4.2 Desktop / keyboard interaction (WAI-ARIA APG listbox mapping)

| Input                                                                                                                                     | Result                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Click on task                                                                                                                             | Focus it; clears any multi-selection (standard "select this one only"). Current single-click behaviours (title edit, detail panel toggle) unchanged.                                                                                                                          |
| **Cmd + click** (macOS) / **Ctrl + click** (others)                                                                                       | Toggle task in selection; focus it; it becomes the anchor. Never starts title edit, never opens a panel, never follows a link. On macOS Ctrl+click is the system context-menu gesture and keeps that meaning.                                                                 |
| **Shift + click**                                                                                                                         | Select the range between the anchor and the clicked task in visual order, replacing the selection. `preventDefault` on `mousedown` so the browser does not select page text.                                                                                                  |
| `↑` / `↓`, `J` / `K`                                                                                                                      | Move focus only; selection unchanged (APG).                                                                                                                                                                                                                                   |
| **Shift + ↑ / ↓**                                                                                                                         | Extend/shrink the selection from the anchor by one visible task. With no anchor yet, the focused task becomes the anchor and the selection starts as `{anchor}`. Unclaimed today: `task-shortcut.service.ts` ignores Shift+Arrow. (Ctrl+Shift+Arrow stays `moveTaskUp/Down`.) |
| **Esc**                                                                                                                                   | Clears the selection when no dialog, menu or overlay is open and focus is not inside an input. Overlays and title editing keep their own Esc, as today (`ShortcutService` already bails out while an overlay is open).                                                        |
| Task shortcut in the **bulk allowlist** (§5.1): `D`, `Backspace`, `S`, `Shift+S`, `Shift+T`, `Shift+B`, `E`, `G`, `U`, `T`, `Ctrl+D`, `Q` | **Applies to the whole selection when it is non-empty**, routed through the bulk action layer _before_ the focused-task gate, so it also works when focus sits on the bar or a dialog just closed. Otherwise acts on the focused task as today.                               |
| Any other task shortcut (`Enter`, `I`, `N`, `Y`, `A`, `L`, arrows, move up/down, …)                                                       | Acts on the focused task only; the selection is untouched.                                                                                                                                                                                                                    |
| `Q` / right-click on a **selected** task                                                                                                  | Opens the context menu in selection mode (§5.2).                                                                                                                                                                                                                              |
| `Q` / right-click on an **unselected** task while a selection exists                                                                      | Clears the selection and acts on that task (file-manager standard).                                                                                                                                                                                                           |
| Phase 2: **`X`** (`taskToggleSelect`), **Ctrl/Cmd + A**, Shift+J/K, Ctrl+Shift+click                                                      | Toggle focused task; select the anchor's list; keyboard-only variants; add-range. See §9.                                                                                                                                                                                     |

There is deliberately **no click-on-empty-space-clears** in v1. It needs a document-level listener with exclusions for the bar, menus, dialogs, side nav and the add-task backdrop, and #6551 already shows how confusing silent selection changes are. Esc and ✕ are enough; Todoist desktop behaves the same.

**What "list" and "visual order" mean.** A task's list is its nearest `.task-list-inner[data-list-id]` ancestor (`task-list.component.html`). A range is the anchor's list's _direct_ `<task>` children in DOM order between anchor and target; expanded subtask rows of other parents are not swept in. If the anchor is a subtask, the range is its sibling subtasks. `TaskFocusService.getTaskElements()` is a global `document.querySelectorAll('task')` that also returns the detail panel's nested subtask list and duplicate ids, so the range helper filters by the anchor's list and dedupes by id.

**Modifier click handling.** One bubbling host `click` guard on `TaskComponent` handles Ctrl/Cmd/Shift clicks when the target is not an `a`, `button`, `textarea`, `input` or `done-toggle`; it does not `stopPropagation`. The shared child handlers that currently own clicks (`task-title` enters edit mode and stops propagation; `done-toggle` stops propagation; the estimate `time-wrapper`) bail out when a selection modifier is held. Ctrl+click focuses the row, so the `focusin` handler that re-targets an open detail panel must be suppressed while the selection is non-empty; the detail panel closes on the first modifier click (resolves former open question 5).

### 4.3 Touch interaction (Android, iOS, narrow web) — Phase 1b

Long-press already starts drag, swipe-right completes, swipe-left opens the context menu. Nothing is free, so selection mode is entered explicitly from a menu, the way Reminders, Todoist and TickTick do (none of them repurposes long-press):

| Input                                                    | Result                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Task context menu → **"Select…"** (new entry, top group) | Enters selection mode with that task selected.                                                               |
| In selection mode: **tap** a task                        | Toggles it. Rows show a leading selection ring in this mode (§4.4). Deselecting the last task stays in mode. |
| Bar **✕** / Android back / Esc                           | Leave selection mode, clear selection.                                                                       |
| Later (Phase 2)                                          | "Select tasks…" in the view ⋮ menu; drag a finger down the selection rings to range-select (Things).         |

Selection mode gates the row gestures explicitly: `swipe-block [canSwipe]` off, `cdkDragDisabled` on, `titleBarClick`'s panel toggle off, `done-toggle` inert, host `contextmenu` suppressed. The add-task FAB in the mobile bottom nav protrudes into the bar's space, so the FAB hides while selection mode is active and the bar sits directly above the nav. An open right-panel bottom sheet closes when selection mode starts. Android back is a new step in `AndroidBackButtonService.handleBackButton` after the context-menu step and before the history overlays; selection mode has no history entry.

On desktop there is no explicit mode: any Ctrl/Cmd+click _is_ the mode. On touch the mode is explicit because there is no modifier key.

### 4.4 Visual feedback

- Selected rows get a persistent tinted background plus a left accent stripe using the existing selection/accent tokens. This must be visually distinct from the focus ring (focused) and from the detail-panel highlight (`.isSelected` today).
- **No checkmarks for selection.** A check already means _done_ in this app (the done button, completed rows). Selection gets its own vocabulary: on desktop the tint and stripe carry the state and there is no leading glyph at all (Material guidance: don't persistently show checkboxes). In touch selection mode the leading slot shows an empty ring that fills solid with the accent colour when selected, with no tick inside. The check icon stays reserved for the Done action, including on the selection bar.
- Count is shown in the selection bar ("7 selected") and announced through one `aria-live="polite"` region in the bar, debounced. `aria-multiselectable` / `aria-selected` are **not** claimed for v1: `<task-list>` and `<task>` carry no listbox/option roles today, and `role="option"` forbids the interactive descendants every row has. A proper `grid`/`row` treatment is a separate accessibility task (open question 4).
- Drag (Phase 2): the CDK drag preview of a selected task shows a stack with a count badge, per Apple HIG.

## 5. Acting on the selection

### 5.1 One bulk action layer

The current shortcut and menu code is single-task UI all the way down: `TaskShortcutService` only acts when a `<task>` is DOM-focused and delegates to methods on that `TaskComponent`; those methods open per-task dialogs (`DialogScheduleTaskComponent` takes one `task`), per-row `mat-menu`s and per-task confirms. The context menu is instantiated lazily _inside each `<task>`_ and derives everything (`isBacklog`, `isInSubTaskList`, `moveToProjectList$`, `isOnTodayList`) from that one task and its DOM ancestors. "Reuse" therefore means reuse of the **vocabulary and the templates**, on top of a new, small, testable layer:

- **`TaskBulkActionService`** owns every bulk semantic in the table below: normalisation of the selection (dedupe, parent/subtask rules, eligibility), sequencing, snackbar suppression and the single summary snack, focus restoration. It resolves ids against the store at execution time. It is unit-tested for mixed states, dedupe, partial eligibility and _resulting list order_ (order preservation is a test, not a claim).
- **`TaskShortcutService`** checks `multiSelect.size > 0` before its focused-task gate and, for keys in the bulk allowlist, calls the bulk service instead of the component method.
- **Dialogs** that take one task get a multi-task variant of their data contract: schedule, deadline, estimate. The dialog opens once, the result is applied to all eligible ids captured at open time (the selection survives the dialog).
- **The context menu** becomes a thin template over a shared items model that accepts `tasks: Task[]`; with one task it behaves exactly as today. The bar hosts its own menu instance (there is no per-row instance to borrow).

### 5.2 Selection bar

A compact, sticky bar at the bottom of `main.main-content`, above `<mobile-bottom-nav>`, shown while the selection is non-empty. Bottom placement is what Asana, Linear and every mobile to-do app use; it never covers the add-task bar at the top and stays in a stable place while the list scrolls. It is mounted **once in the app layout**, so a selection can never exist without a way to act on it (a defect in PR #7146).

Phase 1 bar:

```
┌──────────────────────────────────────────────────┐
│ ✕   7 selected                        Actions ▾  │
└──────────────────────────────────────────────────┘
```

- **✕** clears (also Esc). **Actions** opens the context menu in selection mode. That is the whole bar: a count, an exit and one entry point, which is what NN/g's guideline needs and what touch requires.
- Phase 2, if people ask for it: direct icon buttons for the most-used actions (Schedule `S`, Project `E`, Tags `G`, Done `D`, Delete) with the shortcut in the tooltip. They are a convenience over the menu, not a second action set.

### 5.3 Context menu in selection mode

Header reads "7 tasks". "Mark done" is shown in selection mode regardless of the advanced-controls setting (today it is hidden on desktop). Items and their bulk semantics:

| Action                           | Bulk semantics                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Notes                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Schedule (date/time)             | Same date for all; multi-task variant of the schedule dialog, opened once. Time reminders apply per task.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Phase 2 adds relative shifts ("+1 day", "+1 week") requested in #4645.                         |
| Set deadline / remove deadline   | Same for all.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |                                                                                                |
| Move to project                  | Same target. The picker excludes a project only if _all_ selected tasks are already in it (mixed-project selections must be able to consolidate). Subtasks are ineligible (they follow their parent). Recurring: dedupe by `repeatCfgId`, ask once per config with the existing dialog; the single-live-instance fast path also asks in bulk. Confirm moves the template and **every** instance of that config including archived ones (that is what the existing move does); Cancel skips the whole config. Non-recurring moves run first, then one awaited step per config. | Closes the recurring-task part of #7058. "Move only these instances / detach" is out of scope. |
| Tags                             | Submenu entry is checked only when all selected tasks have the tag. Click: if all have it, remove from all; otherwise add to all. (Tri-state rendering needs the shared `select-option-row` extended; Phase 2.)                                                                                                                                                                                                                                                                                                                                                               | Covers "move from tag THIS WEEK to NEXT WEEK" (#7058 comment).                                 |
| Mark done / undone               | If any selected task is undone → mark all done, else mark all undone. **Every selected task individually** — there is no parent→subtask done cascade in the app (only the opt-in subtask→parent `onAllSubTasksDone$`). Order: subtasks before their parent so the auto-parent effect cannot double-dispatch; the currently tracked task last (or paused first) so `autoSetNextTask$` cannot hop through the selection.                                                                                                                                                        | #6352 workaround                                                                               |
| Move to backlog / to Today       | Same rules as single; parent tasks only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | #8273                                                                                          |
| Add to Today / remove from Today | Uses `planTasksForToday` / `removeTasksFromTodayTag`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |                                                                                                |
| Unschedule                       | Per task with `isSkipToast`, one summary snack (the "Unplan all" pattern in `work-context-menu.component.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                | #7058 comment                                                                                  |
| Estimate                         | Same value for all; multi-task variant of the estimate dialog.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |                                                                                                |
| Duplicate                        | Each duplicated after itself.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Phase 2, #9022                                                                                 |
| Delete                           | Through `TaskService.removeMultipleTasks` (it writes the issue and time-block sidecars before `deleteTasks`). Always confirms for >1 task ("Delete 7 tasks? Subtasks are deleted too."), regardless of `isConfirmBeforeDelete`, because there is no undo yet. `Backspace` with a selection goes exclusively through this path, never through N single deletes (N confirms, N undo snacks with a one-slot undo).                                                                                                                                                               | See §6 for the reducer fix this needs.                                                         |

Hidden in selection mode (single-task only): start tracking, focus mode, edit title, notes, add subtask, attachments, convert to main task, move to top/bottom, issue actions.

**Partial eligibility:** an action applies to the eligible tasks and one snackbar reports it: "Moved 5 of 7 tasks (2 subtasks follow their parent)". Actions that apply to none are disabled with a tooltip.

**Parent and subtask both selected:** for actions that cascade in the reducer (delete removes `subTaskIds`; move to project moves them) the subtasks are deduped and the action runs on the parent only. Done does **not** cascade and is applied per task (above).

**After an action:** the validity rule of §4.1 decides. Tasks still rendered stay selected (tag, estimate, schedule edits chain, as in Todoist desktop; done tasks in Today stay rendered in the done list and stay selected). Tasks that left the view drop out. Keyboard focus goes to the first unselected `<task>` after the last selected one in DOM order, else the list container, keeping scroll position (mirrors `focusSelfOrNextIfNotPossible`).

### 5.4 Drag & drop (Phase 2)

Dragging a task that is part of the selection drags the whole selection: the CDK preview shows a stack with a count badge, and on drop the other selected tasks are inserted directly after the dropped one, in their previous relative order. Dropping onto a project or tag in the side nav moves/tags all of them. Angular CDK has no native multi-drag, so this is implemented in `TaskListComponent.drop()` by moving the remaining ids after the primary drop.

## 6. State, sync and correctness

- **No new synced state, no schema change.** Selection is UI-only. Remote or replayed ops never touch it; the service is not an effect and observes no actions.
- **Bulk = loop of the normal per-task actions** with the Rule #6 `setTimeout(0)` flush after the loop, exactly as ARCHITECTURE-DECISIONS #5 settled for project completion. N per-task LWW ops are N **independent conflict units**: a concurrent remote edit to one task cannot affect the others. That is the property we want; nobody should later "improve" it into one atomic op (ADR #5's lesson). Cost: N ops for N tasks, accepted for a rare, user-initiated action.
- **Never route mark-done through `updateTasks`.** Its reducer is a bare `updateMany` with no meta-reducer and no effects: no `doneOn`, no reminder unscheduling, no auto-start-next-task, no subtask→parent propagation, no done sound. Loop `TaskService.setDone` per task like `ProjectService.markTasksDone` does.
- **Snackbar and sound storms are the real cost of the loop.** `goToProjectSnack$` fires per `moveToOtherProject`, `snackDelete$` per `deleteTask`, `planForDaySnack$` per plan, `taskDoneSound$` per done. The bulk service passes `isSkipToast`/`isShowSnack: false` where the flag exists, adds a non-persisted `isSkipSnack` to `moveToOtherProject`, plays the done sound once, and shows one summary snack. Verify the op-log sanitiser strips the new flag from uploaded ops.
- **`deleteTasks` is not yet safe for subtask ids.** `handleDeleteTasks` removes the entities, project lists and tags, but does not remove a deleted subtask's id from its parent's `subTaskIds` (the singular `deleteTask` path does, via `removeTaskFromParentSideEffects`), and it clears `currentTaskId` only when the id is in `taskIds`, not in the expanded `allIds`. Every current caller passes top-level ids only, so the bug is latent — bulk delete of a selected subtask would ship a dangling reference to every device via the `isBulk` op. Fix the reducer first, starting from a failing reducer test with a subtask id and with a tracked subtask under a deleted parent; old ops with top-level ids replay identically. Undo (`undo-task-delete.meta-reducer.ts`) only knows singular `deleteTask` and keeps one slot; extending it to `deleteTasks` with per-parent positions is Phase 2.
- **Recurring tasks:** carry the `getTaskRepeatCfgByIdAllowUndefined$` null guard (from #8715/#8726, in `task-context-menu-inner.component.ts` on master) into the shared move helper.
- **Order preservation** is a unit test on the target list's resulting order, not an assertion.

## 7. Performance (task component is a hot path)

- `TaskMultiSelectService` exposes `selectedIds: Signal<ReadonlySet<string>>`. `TaskComponent` adds one `computed(() => selectedIds().has(this.task().id))` bound to a host class; unselected rows on desktop add no DOM, the touch ring sits in an `@if`. A selection change marks every rendered OnPush row for check (O(1) each). One click is nothing; holding Shift+↓ over a 600-row list is 600 checks per key repeat, so Shift+Arrow is throttled with the existing `@throttle` decorator as `toggleDoneKeyboard` is. If profiling on a large list still shows cost, switch the service to a per-id `WritableSignal<boolean>` map so only the two affected rows update.
- Range selection queries the DOM once per Shift+click, not per render.
- No functions in templates, no per-task subscriptions.

## 8. Ambiguities resolved

| Question                                    | Decision                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Esc precedence                              | Handled in `TaskShortcutService` before other task keys, only when `ShortcutService`'s overlay/input bail-out did not fire. Dialogs, menus, title edit keep Esc.                                                                                                                                                                                                                                           |
| Ctrl/Cmd+A (Phase 2)                        | `preventDefault`; only when `document.activeElement` is a `<task>` host and `isInputElement` is false (the `metaKey` shortcut path skips the input guard today, which would select all tasks while editing a title on macOS).                                                                                                                                                                              |
| Detail panel while selecting                | Closes on the first modifier click; `focusin` re-targeting suppressed while the selection is non-empty; nothing reopens automatically.                                                                                                                                                                                                                                                                     |
| Dialogs                                     | Selection survives them; results apply to the ids captured at open time.                                                                                                                                                                                                                                                                                                                                   |
| Focus after a bulk action                   | First unselected `<task>` after the last selected in DOM order, else the list container; scroll position kept.                                                                                                                                                                                                                                                                                             |
| Narrow desktop windows                      | Same bar as narrow screens: ✕, count, Actions always fit.                                                                                                                                                                                                                                                                                                                                                  |
| Touch mode when the last task is deselected | Stay in mode; exit only via ✕ / back / Esc.                                                                                                                                                                                                                                                                                                                                                                |
| Subtasks                                    | Selectable. Parent-only actions (move to project/backlog/Today) count them as ineligible and report it.                                                                                                                                                                                                                                                                                                    |
| i18n                                        | Plural strings use `getPluralKey` with `.ONE` / `.OTHER` keys (`src/app/util/get-plural-key.ts`), as `reminder-countdown.effects.ts` does.                                                                                                                                                                                                                                                                 |
| New shortcut keys                           | Register in `KeyboardConfig` (`electron/shared-with-frontend/keyboard-config.model.ts`), `default-global-config.const.ts`, `keyboard-form.const.ts`, `T.GCF.KEYBOARD.*` in `en.json`, the wiki. Keyboard config is synced global config; new fields are optional and merged with defaults on load. A default `X` would shadow a user's plugin shortcut on `X`; the settings UI already warns on conflicts. |

## 9. Phasing

**Phase 1 — desktop MVP (closes #6352, the core of #4645 and #7058)**

- `TaskMultiSelectService` (set, anchor, toggle, range, prune, clear).
- Ctrl/Cmd+click, Shift+click, Shift+↑/↓, Esc. Modifier guard on the task host; child handlers bail on modifiers.
- Selected-row styling, live-region count, bar with ✕ / count / Actions mounted in the layout.
- `TaskBulkActionService` and the context menu in selection mode with: schedule, deadline, move to project (recurring dedupe + guard), tags (all-or-nothing toggle), done/undone, backlog/Today, add to/remove from Today, unschedule, estimate, delete with confirmation.
- Bulk-allowlisted shortcuts routed to the bulk service; snack/sound suppression; `deleteTasks` reducer fix (test first).
- Multi-task variants of the schedule, deadline and estimate dialogs.
- Unit tests: range/anchor logic, prune rule, bulk semantics (mixed states, dedupe, partial eligibility, resulting order), the reducer fix. One E2E per entry method.
- Docs: `docs/wiki/3.03-Keyboard-Shortcuts.md`, an "Edit several tasks at once" how-to.

_Phase 1 as implemented (2026-09-05):_ everything above except the multi-task estimate dialog (the menu offers the quick estimate values instead), and "disabled with a tooltip" for inapplicable actions (they are hidden, or answer with a "nothing to change" snack). Shipped early from Phase 2: Ctrl+Shift+click add-range. Deviations from §6 forced by rule 10: a subtask whose parent survives is deleted through the singular `deleteTask` (older clients' `deleteTasks` reducer would leave a dangling `subTaskIds` entry and fail post-sync validation), and a single selected task takes the normal single-task delete path with its setting and undo. The feedback-suppression flag lives on `TaskMultiSelectService`, not on the bulk service, so effects only depend on the small service.

**Phase 1b — touch**

- "Select…" in the task context menu, selection rings, gesture gating (§4.3), FAB hiding, Android back step. #5685 asked for Android explicitly, so this follows Phase 1 directly rather than waiting for Phase 3.

**Phase 2 — polish, behind evidence of use**

- `X` (`taskToggleSelect`), Ctrl/Cmd+A, Shift+J/K, Ctrl+Shift+click add-range, "Select tasks…" in the view menu.
- Icon buttons on the bar; tri-state tag rows.
- Drag the whole selection with a count badge; drop on side-nav project/tag.
- Undo snackbar for bulk delete (`undo-task-delete` learns `deleteTasks`).
- Duplicate in bulk. Relative reschedule ("+1 day", "+1 week", "next Monday") for shifting a chain of tasks.
- Touch: drag over selection rings to range-select.
- Plugin API, only once the model has settled and named to avoid the existing `selectedTask` meaning: read-only `multiSelectedTaskIds`. There is no existing selection hook to extend; `PluginHooks` today cover task CRUD, current-task change and similar.

**Phase 3 — other views (separate issue)**

- Planner day columns and boards adopt `TaskMultiSelectService` (same bar, same menu).
- Schedule week grid: Ctrl+click events, drag the group to a new time keeping relative offsets (#4645 comments). Needs its own design because events are positioned by time, not list order.

## 10. Relationship to PR #7146

Keep, after rebasing onto master:

- The selection service with signals; Ctrl/Cmd+click, Shift+click range, Esc.
- The extracted recurring-task move helper (`TaskBatchOperationService`), with the `getTaskRepeatCfgByIdAllowUndefined$` guard from master.
- Enabling drag of recurring tasks onto side-nav projects.
- The i18n keys, switched to `getPluralKey` `.ONE`/`.OTHER` (the PR's `COUNT` vs `COUNT_ONE/OTHER` mismatch is still an open review thread).

Change:

- Mount the bar in the layout, not only in work view.
- Replace the capture-phase click interception with the bubbling host guard of §4.2.
- Mark done via per-task `updateTask` / `TaskService.setDone`, not `updateTasks`.
- Sequential loop with the Rule #6 flush instead of `Promise.all` on moves; snack/sound suppression.
- Project picker: exclude a project only if all selected tasks are in it (flagged on the PR).
- Drop the checkboxes entirely (a check means done); use tint + stripe on desktop and the filled ring in touch selection mode.
- Route actions through the bulk service and the context menu in selection mode instead of a second project-picker dialog and a growing toolbar.
- Add keyboard range selection and the bulk shortcut allowlist.

## 11. Open questions for the maintainer

1. **Bar placement:** bottom (proposed) vs. transforming the add-task bar area at the top (Gmail/Todoist web style). Bottom avoids fighting the add-task bar and matches mobile; top is closer to the eye when the list is short.
2. **Plain click clears the selection** (file-manager standard, proposed) vs. keeping it until Esc. Clearing on click is the more predictable default.
3. **Delete confirmation vs. undo snackbar** in v1. Proposed: confirm now, undo in Phase 2.
4. **Accessibility roles:** ship v1 with the live-region count only (proposed) or take on `role="grid"`/`row` for task lists as part of this work.
5. **Recurring partial selection:** is "confirm moves every instance of the config" acceptable for v1, or must "move only the selected instances" exist from the start?

## Sources

- Issues: #4645, #7058, #6352, #5685, #9022, #6486, #8273, #6551; PR #7146 and its reviews.
- Codebase: `task-shortcut.service.ts`, `task-focus.service.ts`, `get-dom-focused-task-id.ts`, `task.model.ts` (`TaskState`), `root-store/meta/task-shared.actions.ts`, `task-shared-meta-reducers/task-shared-crud.reducer.ts` (`handleDeleteTasks`), `undo-task-delete.meta-reducer.ts`, `task-ui.effects.ts`, `task-internal.effects.ts`, `task-list.component.*`, `task.component.*`, `task-context-menu-inner.component.*`, `work-context-menu.component.ts` ("Unplan all"), `android-back-button.service.ts`, `get-plural-key.ts`, ARCHITECTURE-DECISIONS #5.
- Todoist help "Add or manage multiple tasks"; Cultured Code "Moving items", "Using gestures", "Using tags"; TickTick "Desktop interaction tips", "Batch edit tasks"; Linear docs "Select issues", changelog "Issue selection", "Improved drag & drop"; Apple support "Organize reminders", HIG lists/tables and drag & drop; Asana "Bulk select and edit tasks"; Notion "Tables"; Gmail help "Select messages"; Material Design "Selection" (M1–M3); WAI-ARIA APG Listbox pattern; NN/g "Bulk actions: 3 design guidelines".
