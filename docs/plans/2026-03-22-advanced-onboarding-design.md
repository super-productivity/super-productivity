# Advanced Onboarding: Preset-Specific Nudges & Welcome Tasks

## Status: Deferred (too complex for initial implementation)

## Problem

After the user selects a preset and creates their first task, there's no further guidance tailored to their chosen workflow. The "explore" hint is generic and doesn't teach preset-specific features (time tracking, planner, etc.).

## Proposed Design

### Welcome Tasks

Create a preset-specific welcome task on preset selection. The task title IS the instruction:

- **Simple Todo**: "Your first task — try checking me off!"
- **Time Tracker**: "Try clicking the play button to track time on this task"
- **Productivity Suite**: "Plan your week — try scheduling me for tomorrow in the Planner"

### Preset-Specific Nudge (after inactivity)

Instead of a generic explore hint, wait ~8s for the user to interact. If they don't:

- **Simple Todo**: Pulse the task's checkbox → "Try checking off your first task!"
- **Time Tracker**: Pulse the play button (`.tour-playBtn`) → "Click play to start tracking time"
- **Productivity Suite**: Pulse the Planner nav item (`.tour-plannerMenuBtn`) → "Open the Planner to schedule your tasks"

If the user interacts within 8s (adds/updates task, starts tracking, navigates), skip the nudge entirely — they figured it out.

### Translation Keys

```json
"HINTS": {
  "NUDGE_TODO": "Try checking off your first task!",
  "NUDGE_TIME_TRACKER": "Click play to start tracking time",
  "NUDGE_TIME_TRACKER_TOUCH": "Tap play to start tracking time",
  "NUDGE_PRODUCTIVITY": "Open the Planner to schedule your tasks",
  "SKIP_ARIA": "Dismiss hint"
}
```

## Implementation Challenges Encountered

### 1. Welcome task triggers "task created" snackbar
The snackbar effect fires for every `addTask` action. Requires suppression via `OnboardingHintService.isOnboardingInProgress()` check. Additionally, example tasks created by `ExampleTasksService` also trigger snackbars.

### 2. Example tasks conflict with welcome task
`ExampleTasksService` creates 4 tutorial tasks in the Inbox when `tasks.length === 0`. With a welcome task, either:
- The welcome task prevents example tasks (tasks.length > 0), or
- Example tasks need to be suppressed when onboarding preset hasn't been selected yet

### 3. Interaction detection is fragile
Listening for "meaningful interaction" to cancel the inactivity timer is tricky:
- `NavigationEnd` fires on initial page load → must `skip(1)` to ignore
- `addTask` from the welcome task itself could trigger if timing overlaps
- `updateTask` fires during state hydration/replay
- Need to track multiple subscriptions for proper cleanup

### 4. Timing chain is complex
Preset selection → 1s animation → 1s more → `startAfterPresetSelection()` → 8s inactivity → show nudge → 12s auto-dismiss. Many timeouts to manage and clean up.

### 5. The "create-task" hint becomes dead code
With a welcome task, the user always has tasks, so the original "Click + to add your first task" hint never triggers. This means the pulsing + button (a strong visual anchor) is lost.

## Prerequisites for Implementation

1. Add `tourClass: 'tour-plannerMenuBtn'` to planner nav item in `magic-nav-config.service.ts`
2. Verify `.tour-playBtn` is visible when time tracking is enabled (it's on the play-button component)
3. Ensure `task:first-of-type .check-done` reliably targets the first task's checkbox
4. Consider whether `ExampleTasksService` should be removed entirely in favor of welcome tasks

## Key Files

- `src/app/features/onboarding/onboarding-hint.service.ts` — core hint orchestration
- `src/app/features/onboarding/onboarding-hint.component.ts` — hint UI (positioning, pulse, arrows)
- `src/app/features/onboarding/onboarding-presets.const.ts` — preset definitions with hint metadata
- `src/app/features/onboarding/onboarding-preset-selection.component.ts` — welcome task creation
- `src/app/features/tasks/store/task-ui.effects.ts` — snackbar suppression
- `src/app/core/example-tasks/example-tasks.service.ts` — example task creation guard
- `src/app/core-ui/magic-side-nav/magic-nav-config.service.ts` — planner tourClass

## Recommendation

Implement this after the basic onboarding flow is stable and validated with real users. The simple "add your first task" → "explore" flow covers 80% of the value with 20% of the complexity.
