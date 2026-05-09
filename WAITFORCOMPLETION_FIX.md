# waitForCompletion Behavior Fix

## Issues Fixed

### 1. Service: lastTaskCreationDay incorrectly advanced when blocked

**Problem**: When `waitForCompletion` blocked task creation, the service returned an empty array but the cursor (`lastTaskCreationDay`) was never updated. This meant the skipped occurrence was treated as "processed" even though no task was created.

**Fix**: The `waitForCompletion` check now returns `[]` WITHOUT updating `lastTaskCreationDay`. The cursor only advances when a task is actually created (via the `updateTaskRepeatCfg` action in `createNewActions`).

**Location**: `task-repeat-cfg.service.ts` lines ~237-248

### 2. Effects: Completion doesn't materialize next task

**Problem**: When completing a gating task, the effect only updated the repeat config. It didn't create/materialize the next occurrence. Users had to wait until the next day-change/app-start for the normal creation path to run.

**Fix**: The `updateStartDateOnComplete$` effect now:

1. For `repeatFromCompletionDate`: Updates only `startDate` (as before)
2. For `waitForCompletion`: Calls `_getActionsForTaskRepeatCfg` with the UNMODIFIED config
   - This lets the service handle cursor updates itself (only when task is actually created)
   - Avoids artificially advancing the cursor before generation
   - Dispatches all returned actions (task creation + cursor update)

**Key insight**: We don't manually update `lastTaskCreationDay` before calling `_getActionsForTaskRepeatCfg`. The service's `createNewActions` array already includes the cursor update, and it only gets dispatched if a task is actually created.

**Location**: `task-repeat-cfg.effects.ts` lines ~656-704

### 3. Both: Archived instances not checked

**Problem**: The gate check only looked at live instances. An archived but unfinished repeat instance could stop blocking new creation incorrectly.

**Fix**: The service now queries both live AND archived instances when checking for uncompleted tasks:

```typescript
const archivedInstances = await this._taskService.getArchiveTasksForRepeatCfgId(
  taskRepeatCfg.id,
);
const allInstances = [...existingTaskInstances, ...archivedInstances];
const hasUncompletedInstances = allInstances.some((task) => !task.isDone);
```

**Location**: `task-repeat-cfg.service.ts` lines ~237-248

## Behavior After Fix

### Before

1. User completes gating task → config updates, but no new task appears
2. User waits until next day or app restart
3. Normal creation path runs and creates next task

### After

1. User completes gating task → next task immediately appears (if eligible)
2. Cursor only advances if task is actually created
3. No waiting required

### Edge Cases Handled

- **Archived uncompleted tasks**: Now properly block creation
- **Skipped occurrences**: Cursor doesn't advance when blocked, so the same date is re-evaluated after completion
- **Latest instance check**: Only the most recent instance can trigger next task creation (prevents old archived completions from advancing the config)
- **Deleted instances**: If the next occurrence is in `deletedInstanceDates`, no task is created and cursor doesn't advance
- **SkipOverdue**: If next occurrence is overdue and skipOverdue is enabled, cursor advances but no task appears (existing behavior)

## Critical Design Decision

**Why we don't manually update lastTaskCreationDay in the effect:**

The effect calls `_getActionsForTaskRepeatCfg(cfg, Date.now())` with the UNMODIFIED config. This is intentional:

1. `_getActionsForTaskRepeatCfg` returns an array of actions that includes BOTH task creation AND cursor update
2. If task creation is blocked (deleted instance, waitForCompletion still blocking, etc.), it returns `[]`
3. By letting the service handle the cursor update, we ensure "blocked because waiting" is separate from "processed this occurrence"
4. The cursor only advances when a task is actually created

This maintains the semantic correctness that the reviewer required.

## Testing Recommendations

1. **Basic flow**: Create waitForCompletion task, complete it, verify next task appears immediately
2. **Archive scenario**: Archive an uncompleted instance, verify it still blocks creation
3. **Old completion**: Complete an old archived instance, verify it doesn't advance the config
4. **Multiple completions**: Complete tasks rapidly, verify cursor advances correctly each time
5. **Deleted next occurrence**: Complete task when next occurrence is deleted, verify cursor doesn't advance
6. **Still blocked**: Complete task when another uncompleted instance exists, verify no new task appears
