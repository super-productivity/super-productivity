# Specification: Task Completion & Schedule Dialog (Decision A1)

## Origin & Core Motivation

The core motivation for this feature is to **keep tasks visible on the schedule timeline even when they are marked as complete**.

In Super Productivity, checking off or marking a task as done immediately removes it from view. While removing completed tasks makes sense for backlog and active to-do lists, users in the **Schedule (Calendar)** view want completed tasks to remain visible on the schedule timeline (similar to Google Calendar, where completed tasks are crossed off/strikethrough and dimmed in opacity rather than deleted from view). This allows users to retain a high-level visual record of what they accomplished throughout the entire day, without losing context on when tasks took place or how long they took.

---

## Problem Statement

When users complete tasks in Super Productivity, they face three key friction points on their schedule:

1. **Unresolved Schedule Placement & Task Disappearance**: Currently, marking a task as done immediately hides it from the Schedule (Calendar) view across Day, Week, and Month views because `selectTimelineTasks` filters out all completed tasks (`!t.isDone`). Furthermore, tasks completed during the day either linger without a definite schedule slot, clutter the timeline, or end up awkwardly positioned in the daily calendar grid. Users who want completed work reflected accurately on their timeline have to manually open schedule menus before or after marking tasks done, and cannot see an overview of what they accomplished throughout the day as Google Calendar provides.
2. **Duration & Estimate Discrepancies**: The time spent on a task often differs from its original estimate (either under-running or going overtime). Without a streamlined completion step, users must manually reconcile time estimates with actual tracked durations so their day's timeline and calendar blocks reflect reality rather than stale initial estimates. In addition, Super Productivity's schedule engine calculates active task duration via `getTimeLeftForTask` as $\max(0, \text{timeEstimate} - \text{timeSpent})$; if a completed task were rendered under this forecast formula without adjustment, its duration would collapse to 0 minutes upon tracking full time.
3. **Modal Friction & Flow Interruption**: Existing dialogs can be heavyweight and disrupt rapid keyboard-first workflows. Users completing tasks need a predictable, zero-layout-shift, keyboard-accessible dialog that allows split-second confirmation while retaining full precision when adjustments are needed.

---

## Solution

A comprehensive solution allowing completed tasks to remain visible and editable on the Schedule view, complemented by a high-density, keyboard-first completion dialog based on **Variant B (Compact Segmented Pills)** with a clean UI orchestration architecture:

- **Schedule View Visibility & Retention (Opt-In Settings)**:
  - Settings configured under **Settings → Time & Tracking → Schedule**:
    - **Main Toggle**: `Keep completed tasks visible in the schedule view` (`isShowDoneTasksInSchedule`, default: `false` / unchecked).
    - **Sub-Toggle**: `Prompt to schedule or adjust duration when completing tasks` (`isPromptOnTaskDoneSchedule`, default: `false` / unchecked, conditionally visible only when the main toggle is enabled).
    - Single description row with circular toggle matching Super Productivity conventions.
  - **Completed Event Styling**: Rendered across Day, Week, and Month views with strikethrough title (`text-decoration: line-through`), dimmed opacity (`var(--task-is-done-dim-opacity)`), and original icon retained (no icon replacement).
  - **Schedule Interactivity**: Events remain fully interactive on the calendar grid—draggable to new times/days and resizable to change duration.
  - **Reminder Safety**: Dragging or moving completed tasks on the schedule grid **never** generates or restores reminder alarms (`remindAt` is strictly forced to `undefined` whenever `isDone: true`).
  - **Un-marking Done**: Reverting a completed task to active (`setUnDone` / `isDone: false`) is a simple, direct toggle. It retains any adjusted `timeEstimate` and `dueWithTime` without modal prompts, and reminders remain dismissed.
  - **Duration Architecture**: Active tasks retain forecast behavior ($\max(0, \text{timeEstimate} - \text{timeSpent})$). Completed tasks represent historical work records and use `task.timeEstimate` directly on the timeline, preventing completed blocks from collapsing to 0 height.

- **Completion Dialog (Variant B: Compact Segmented Pills)**:
  - Appears upon completion for eligible top-level tasks when the sub-toggle is enabled and schedule or duration decisions are required.
  - **Locked Dimensions & Elevation**: A fixed 460px Material dialog surface matching Super Productivity native theming with zero layout shift across states.
  - **Clear Information Hierarchy**:
    - Contextual header with task title and duration metadata formatted as `Tracked: [timeSpent] of [timeEstimate] estimate` (time spent consistently preceding estimate).
    - **Row 1 (Schedule Placement)**: Segmented control offering immediate choice between `12:00 AM (All Day)` and `Custom / Specific Time`.
      - **12:00 AM (All Day) Placement**: Follows Super Productivity's schedule grid architecture. Tasks are scheduled at **12:00 AM (midnight / 00:00:00)** on the calendar day. Because the schedule grid starts at 12:00 AM and typical work hours start at 9:00 AM, midnight placement anchors the completed task to that date without occupying daytime working hours, fully complying with **ADR #1** (`dueDay`/`dueWithTime` mutual exclusivity) without requiring complex grid layout overhauls.
    - **Inline Time Editing**: A 2-step click interaction on the custom time pill that enables in-place editing directly over the digits with 0.0000px layout shift and flexible time input parsing (e.g. typing `11` -> `11:00 PM`, `9am` -> `9:00 AM`).
    - **Row 2 (Duration Adjustment)**: Contextual pills presented when `timeEstimate` and `timeSpent` diverge, allowing instant choice between keeping the estimate or syncing/expanding/shrinking to actual tracked time. Confirmed duration is persisted into `task.timeEstimate`.
  - **Keyboard-First Execution**:
    - `Enter` confirms the default or selected options immediately.
    - `Escape` cancels completion, resets the UI checkbox animation, and leaves the task active (`isDone: false`).
    - `Tab` / `Shift+Tab` cycles between options smoothly.

---

## User Stories

1. As a user completing an unscheduled task without time tracking or estimates, I want the dialog to offer schedule placement choices without showing duration options, so that I can decide where it belongs on my day without unnecessary clutter.
2. As a user completing a task with an estimate but zero tracked time, I want to see an option to keep the estimate or adjust to a default minimum duration, so that my calendar block doesn't consume an inaccurate block of time.
3. As a user completing a task under estimate (e.g. 30m spent on a 1h estimate), I want to easily shrink the schedule block to the tracked 30m, so that my schedule accurately reflects how much time I actually used.
4. As a user completing a task under estimate, I want the option to keep the original 1h estimate block, so that scheduled calendar allocations remain preserved if needed.
5. As a user completing an already scheduled task (e.g. scheduled for 10:00 AM), I want the scheduled time pre-filled in the custom time pill, so that I do not need to re-enter it.
6. As a user completing an overtime task (e.g. 1h 30m spent on a 1h estimate), I want an option to expand the schedule block to 1h 30m, so that my day's timeline accurately reflects my overtime work.
7. As a user who wants completed tasks placed outside daytime working hours, I want to select the "12:00 AM (All Day)" pill, so that the task is scheduled at midnight (00:00) at the top of the day's grid without blocking daytime working slots.
8. As a user selecting the Custom Time pill on the first click, I want the pill to become active without opening any popups or entering edit mode, so that I can choose the suggested time quickly.
9. As a user clicking a second time on the already-selected Custom Time pill digits, I want the digits to become an inline text input without any layout shift, so that I can edit the time seamlessly.
10. As a user editing the custom time inline, I want to type shorthand numbers like "11" or "930" and have them automatically interpreted as standard times (e.g. "11:00 PM" or "9:30 AM"), so that I can update time with minimal keystrokes.
11. As a user editing custom time, I want pressing Enter or clicking away (blur) to commit the edited time and exit inline edit mode, so that the dialog reflects the new time immediately.
12. As a user editing custom time, I want pressing Escape while typing in the input to revert the time change and exit edit mode without closing the dialog, so that I can correct mistakes safely.
13. As a power user navigating with the keyboard, I want pressing Enter on the dialog to immediately confirm the highlighted choices, so that task completion takes under half a second.
14. As a user navigating the dialog, I want pressing Escape (or clicking Cancel) to dismiss the dialog and immediately revert the task checkbox back to unchecked, leaving the task incomplete without modifying store state.
15. As a user looking at the duration adjustment row, I want a 2-line contextual clue explaining the consequence of the active pill (e.g. "Shrinks schedule block from 1h to 30m"), so that I know exactly how my schedule will change.
16. As a user toggling between pills in the dialog, I want the dialog height to remain stable without vertical jitter, so that the UI feels calm and polished.
17. As a user in Dark Mode or Light Mode, I want the dialog to adhere to native Super Productivity theme tokens and elevation styles, so that the experience is visually cohesive with the rest of the application.
18. As a screen reader user, I want the dialog, segmented controls, and action buttons to have appropriate ARIA attributes, so that I can navigate and operate the dialog non-visually.
19. As a user reviewing my schedule across Day, Week, and Month views, I want completed tasks to remain visible on the calendar grid with strikethrough titles and dimmed opacity, so that I can review everything accomplished throughout the day.
20. As a user managing my schedule, I want completed tasks to retain their original icons (e.g. alarm, repeat, schedule), so that I can still distinguish between scheduled reminders, recurring routines, and normal tasks.
21. As a user rearranging my schedule, I want to drag and resize completed tasks directly on the calendar grid, so that I can retroactively correct when a task took place or how long it lasted.
22. As a user dragging a completed task to a new time on the schedule grid, I want the system to never create a reminder or alarm notification, so that past completed work does not trigger alarms.
23. As a user who accidentally completed a task, I want to uncheck it directly from the task list or schedule event without opening any modals, cleanly reverting it to incomplete while keeping its adjusted duration and placement.
24. As a user completing subtasks, I want subtask completion to bypass the schedule dialog completely, so that subtask checklists do not disrupt my flow.
25. As a user completing recurring/repeat task instances, I want completion to bypass the schedule dialog in MVP, so that automated recurring routines complete silently with template defaults.
26. As a user completing an already scheduled task with zero time tracked (`timeSpent === 0`), I want completion to happen silently without prompting to shrink to 0m, so that its planned block remains preserved without unnecessary popups.
27. As a user completing an already scheduled task where tracked time matches the estimate (`timeSpent === timeEstimate`), I want completion to happen silently, so that I am not interrupted when no duration decision is needed.
28. As a user who does not want completion prompts, I want to leave the sub-toggle disabled while keeping the main visibility toggle enabled, so that completed tasks stay visible on the schedule without any prompt on check-off.
29. As a user with the prompt disabled (`isShowDoneTasksInSchedule = true`, `isPromptOnTaskDoneSchedule = false`), I want completed tasks with a scheduled time (`dueWithTime`) to display at their time, and completed tasks planned for today (`dueDay`) to display at 12:00 AM, while unscheduled tasks without a date do not clutter the schedule grid.

---

## Architecture & Implementation Decisions

### 1. Settings Configuration UI

- **Location**: `Settings → Time & Tracking → Schedule`
- **Fields**:
  - `isShowDoneTasksInSchedule` (`boolean`, default: `false`): Description: "Keep completed tasks visible in the schedule view".
  - `isPromptOnTaskDoneSchedule` (`boolean`, default: `false`): Description: "Prompt to schedule or adjust duration when completing tasks". Conditionally visible in Formly only when `isShowDoneTasksInSchedule` is `true`.
- **Formly Config**: Follows existing pattern in `src/app/features/config/form-cfgs/schedule-form.const.ts`. Uses circular checkbox/toggle with single description line.
- **Store & Models**:
  - Added to `ScheduleConfig` in `src/app/features/config/global-config.model.ts`.
  - Added to `DEFAULT_GLOBAL_CONFIG.schedule` in `src/app/features/config/default-global-config.const.ts`.

---

### 2. Schedule Timeline Rendering & Duration Engine

- **Task Selector**:
  - `selectTimelineTasks` in `src/app/features/work-context/store/work-context.selectors.ts` is updated:
    - When `isShowDoneTasksInSchedule` is `true`, tasks with `isDone: true` and `dueWithTime` are included in `planned`.
    - Completed tasks with only `dueDay` (today) are mapped to 12:00 AM (00:00:00).
    - Unscheduled completed tasks without dates are **excluded** from `unPlanned` flow tasks so they do not consume remaining workday capacity.
- **Schedule Event Component**:
  - `src/app/features/schedule/schedule-event/schedule-event.component.ts`:
    - `cssClass` computed signal adds `.isDone` class when `task()?.isDone` is `true`.
    - Retains original icon in template (`icoType()`), preserving alarm, repeat, schedule, or flow badges.
    - Dragging (`isDraggableSE`) and resizing (`isResizable`) remain enabled for completed tasks.
    - Context menu and actions support `markAsUnDone()`.
  - `src/app/features/schedule/schedule-event/schedule-event.component.scss`:
    - `.isDone` applies `opacity: var(--task-is-done-dim-opacity, 0.44)`.
    - `.title` inside `.isDone` receives `text-decoration: line-through`.
- **Duration Calculation Architecture (Fix for Shrinking Duration)**:
  - In `src/app/features/schedule/map-schedule-data/create-sorted-blocker-blocks.ts` (`createBlockerBlocksForScheduledTasks`) and `create-schedule-view-entries-for-normal-tasks.ts`:
    - Active tasks (`!task.isDone`) continue using `getTimeLeftForTask(task)` ($\max(0, \text{timeEstimate} - \text{timeSpent})$) as a remaining forecast.
    - Completed tasks (`task.isDone`) represent finalized historical blocks and do **not** subtract `timeSpent`. Duration is computed directly as:
      ```typescript
      const duration = task.isDone
        ? task.timeEstimate > 0
          ? task.timeEstimate
          : SCHEDULE_TASK_MIN_DURATION_IN_MS
        : getTimeLeftForTask(task);
      ```
- **Reminder Safety on Drag/Drop**:
  - In `src/app/features/schedule/schedule-week/schedule-week-drag.service.ts`:
    - When moving or resizing an event where `task.isDone === true`, `remindAt` is strictly set to `undefined`. Alarms are never re-armed for completed work.

---

### 3. Interception Seam & Layer Inversion Architecture

To protect headless, background, and external sync workflows from UI blocking errors and avoid circular module dependencies (`tasks` ⇄ `schedule`), task completion is decoupled:

```
[UI Mouse Click in TaskComponent]
          │
          ▼
TaskCompletionPromptService (features/tasks)
          │
          ├── isPromptOnTaskDoneSchedule == false OR bypass condition met?
          │         └──► TaskService.setDone(taskId) [Immediate, Silent]
          │
          └── DialogMarkTaskDoneComponent.open()
                    ├── User Confirms
                    │         ├── Update task.timeEstimate (if adjusted)
                    │         ├── Update task.dueWithTime (if scheduled/12:00 AM)
                    │         └── TaskService.setDone(taskId)
                    │
                    └── User Cancels (Esc)
                              └── Revert TaskComponent checkbox animation to unchecked
```

- **Headless Callers Unchanged**:
  - Background tracking (`android-foreground-tracking.effects.ts`), home widget sync (`android-widget.effects.ts`), URI actions (`app-uri-task-actions.service.ts`), bulk actions (`task-bulk-action.service.ts`), and midnight auto-finish continue calling `TaskService.setDone(id)` directly, synchronously, and silently.
- **UI Seam**:
  - In `src/app/features/tasks/task/task.component.ts`, direct mouse clicks on the task checkbox route through `TaskCompletionPromptService.completeTask(task)`.
  - The checkmark animation plays immediately upon click. If the user cancels the dialog or presses `Esc`, `TaskCompletionPromptService` triggers animation rollback, keeping the task incomplete.
- **Scope Guard Rules (When Dialog Opens)**:
  1. **Top-Level Tasks Only**: If `task.parentId != null`, bypass dialog (subtasks complete silently).
  2. **Non-Recurring Only (MVP)**: If `task.repeatCfgId != null`, bypass dialog (recurring tasks complete silently).
  3. **Config Disabled**: If `isPromptOnTaskDoneSchedule` is `false`, bypass dialog (complete immediately).
  4. **Already Scheduled (`task.dueWithTime` exists)**:
     - `timeSpent === 0` and `timeEstimate === 0`: Bypass dialog.
     - `timeSpent === 0` and `timeEstimate > 0`: Bypass dialog (retains scheduled estimate block).
     - `timeSpent === timeEstimate`: Bypass dialog.
     - `timeSpent !== timeEstimate`: **Show dialog** with duration adjustment options, pre-filling current scheduled time.
  5. **Unscheduled (no `dueWithTime`)**:
     - **Show dialog** with placement options (`12:00 AM (All Day)` vs `Custom Time`).
     - If `timeSpent !== timeEstimate`, also show duration adjustment row.

---

### 4. Data Contract & Dialog Interface

```typescript
export interface MarkTaskDoneDialogData {
  taskId: string;
  taskTitle: string;
  timeSpent: number;
  timeEstimate: number;
  currentScheduledTime: number | null;
}

export type SchedulePlacementType = 'ALL_DAY' | 'CUSTOM_TIME';

export interface SchedulePlacementResult {
  type: SchedulePlacementType;
  /** Start of day 00:00:00 timestamp for ALL_DAY, or specific scheduled timestamp */
  dueWithTime: number;
}

export type DurationAdjustmentType = 'KEEP_ESTIMATE' | 'ADJUST_TO_TRACKED';

export interface DurationAdjustmentResult {
  type: DurationAdjustmentType;
  newEstimateDurationMs: number;
}

export interface MarkTaskDoneDialogResult {
  confirmed: boolean;
  placement: SchedulePlacementResult;
  durationAdjustment?: DurationAdjustmentResult;
}
```

---

### 5. Visual & Layout Specifications

- **Fixed Width**: Strict `460px` width lock (`box-sizing: border-box`). No state change may alter this width.
- **Color Scheme**: Native Blue primary token (`--primary: #38a9f5` in dark mode, `#0284c7` in light mode; subtle active pill background `--primary-subtle`).
- **Task Summary Duration Line**: `timeSpent` is placed strictly to the left of `timeEstimate` (e.g. `Tracked: 30m of 1h estimate`).
- **Clue Typography & Spacing**: Contextual clue text is rendered at `12px`, muted ink color, with a fixed two-line `min-height: 30px` to guarantee zero vertical content jump between pill selections.

---

### 6. Inline Custom Time Interaction

- **First Click**: Activates the custom time pill if it was not active. Does not trigger editing.
- **Second Click on Active Pill**: Triggers inline edit mode.
- **Zero Layout Shift (0.0000px $\Delta$)**:
  - The static digits remain in the DOM within a relative container with `visibility: hidden`.
  - An absolute `<input>` element overlays the digits with identical font family, size, weight, line-height, letter-spacing, and padding.
  - No inner boxes, extra borders, or checkmark icons are rendered.
- **Flexible Input Parsing**:
  - Direct hour entries (e.g. `11` or `11p` -> `11:00 PM`, `9a` -> `9:00 AM`).
  - Compact time formats (e.g. `1130` -> `11:30 PM`, `0815` -> `8:15 AM`).
  - Standard colon formats (e.g. `10:45`, `2:15 PM`).

---

## Testing Decisions

### What Makes a Good Test

- Tests must verify external behavior and component contracts rather than internal implementation details.
- Tests should simulate user inputs (clicks, keyboard strokes `Enter`, `Escape`, `Tab`, text typing) and verify the resulting dialog output payload and DOM accessibility states.
- Tests must assert that layout and styling constraints hold (e.g. correct conditional rendering of duration rows across Scenarios 1–5).

### Testing Seams & Modules

1. **Primary Seam: Dialog Component Integration Tests (`dialog-mark-task-done.component.spec.ts`)**:
   - **Scenario 1 (`- / -`)**: Verifies duration adjustment row is omitted; 12:00 AM and Custom Time pills function correctly.
   - **Scenario 2 (`- / 1h`)**: Verifies duration adjustment options (Keep 1h vs Adjust 15m default).
   - **Scenario 3 (`30m / 1h` unscheduled)**: Verifies duration adjustment options (Adjust 30m vs Keep 1h).
   - **Scenario 4 (`30m / 1h` scheduled 10:00 AM)**: Verifies pre-filled time and duration adjustments.
   - **Scenario 5 (`1h 30m / 1h` overtime)**: Verifies expand duration option (Expand 1h 30m vs Keep 1h).
   - **Inline Edit & Time Parsing**: Verifies 2-step click activation, 0px shift layout behavior, valid and invalid time string parsing, Enter commit, and Escape reversion.
   - **Keyboard Navigation**: Verifies Enter confirms dialog, Escape closes dialog, and Escape inside input cancels edit mode without closing the dialog.
2. **Integration Seam: Task Completion Prompt Service (`task-completion-prompt.service.spec.ts`)**:
   - Verifies that UI checkbox click calls `completeTask(task)`.
   - Verifies subtasks (`parentId != null`) bypass dialog and complete silently.
   - Verifies recurring tasks (`repeatCfgId != null`) bypass dialog in MVP.
   - Verifies already scheduled tasks with `timeSpent === 0` or `timeSpent === timeEstimate` bypass dialog.
   - Verifies dialog cancellation leaves task incomplete and triggers visual checkbox reset.
   - Verifies dialog confirmation dispatches `isDone: true`, updates `timeEstimate`, and sets `dueWithTime`.
3. **Schedule Engine & Selectors Seam (`work-context.selectors.spec.ts`, `create-sorted-blocker-blocks.spec.ts`, `schedule-week-drag.service.spec.ts`)**:
   - Verifies `selectTimelineTasks` includes completed scheduled tasks when `isShowDoneTasksInSchedule` is `true`, and excludes them when `false`.
   - Verifies schedule event duration for completed tasks does not subtract `timeSpent`, retaining full scheduled block footprint (`task.timeEstimate`).
   - Verifies dragging a completed task in `schedule-week-drag.service.ts` updates `dueWithTime` without re-arming `remindAt`.
   - Verifies un-completing (`setUnDone`) cleanly flips `isDone: false` while keeping adjusted `dueWithTime` and `timeEstimate`.

---

## Out of Scope (Deferred to Future PRs)

- Keyboard shortcut `'d'` interception (remains instant/silent for MVP).
- Context menu completion actions (remains instant/silent for MVP), deferred to a future PR.
- Planner view card completions (remains instant/silent for MVP).
- Recurring task repeat schedule alterations (completes silently with template defaults).
- Bulk task completion actions (`TaskBulkActionService`) opening multiple dialogs.
- Mobile touch swipe-to-complete dialog interception.
- Adding a separate "All-Day" header section in the schedule grid (12:00 AM midnight slotting used).

---

## Further Notes

- Feature branch: `feat/schedule-show-done-tasks`
- Approved under **Decision A1** and prototyped in `src/app/features/schedule/prototype-schedule-done-dialog.html`.
- Implements the approved **Variant B (Compact Segmented Pills)** design.
