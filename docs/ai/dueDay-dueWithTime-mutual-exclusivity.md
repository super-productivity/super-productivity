# dueDay/dueWithTime Mutual Exclusivity Pattern

## Overview

As of commit `400ca8c1` (2026-01-29), the `dueDay` and `dueWithTime` fields on [`Task`](../../src/app/features/tasks/task.model.ts) follow a **mutual exclusivity pattern**. These fields must NOT both be set simultaneously in new data. This document explains the pattern, its rationale, and implementation details.

## The Pattern

### Rule

**When `dueWithTime` is set, `dueDay` MUST be `undefined` (or `null`).**

```typescript
// CORRECT - Task scheduled with specific time
task.dueWithTime = 1706537400000; // Tomorrow at 9:00 AM
task.dueDay = undefined; // Cleared

// CORRECT - Task scheduled without specific time (all-day)
task.dueDay = '2026-01-30';
task.dueWithTime = undefined;

// WRONG - Both fields set (legacy data only)
task.dueDay = '2026-01-30';
task.dueWithTime = 1706537400000; // DO NOT create new data like this
```

### Priority/Precedence

When reading task data, **`dueWithTime` takes priority over `dueDay`**:

```typescript
// Determining if a task is "due today"
let isDueToday = false;
if (task.dueWithTime) {
  // Check dueWithTime first (takes priority)
  isDueToday = isToday(task.dueWithTime);
  // DO NOT check dueDay if dueWithTime is set
} else if (task.dueDay === todayStr) {
  // Only check dueDay if dueWithTime is not set
  isDueToday = true;
}
```

## Rationale

### The Problem This Solves

**Prior to this change**, both fields could coexist with conflicting values, causing bugs:

1. **Bug Scenario**: User moves task from "today" to "tomorrow 9am"
   - Action: `scheduleTask` sets `dueWithTime = tomorrow 9am`
   - **Old behavior**: Also set `dueDay = 'tomorrow'`
   - **Problem**: If selector checked `dueDay` first, stale values could cause incorrect categorization

2. **State Inconsistency**: Task could have:
   ```typescript
   dueDay = 'today'
   dueWithTime = tomorrow 9am
   ```
   Different selectors checking different fields would disagree on the task's due date.

### Why Mutual Exclusivity?

1. **Single Source of Truth**: No ambiguity about when a task is due
2. **Simpler State Management**: No need to keep two fields in sync
3. **Bug Prevention**: Eliminates entire class of state inconsistency bugs
4. **Clear Semantics**:
   - `dueWithTime` = scheduled for specific time
   - `dueDay` = scheduled for all-day (no specific time)

## Implementation Details

### Writing: Setting the Fields

**File**: [`task-shared-scheduling.reducer.ts`](../../src/app/root-store/meta/task-shared-meta-reducers/task-shared-scheduling.reducer.ts)

When scheduling a task with a specific time, `dueDay` is explicitly cleared:

```typescript
const handleScheduleTaskWithTime = (
  state: AppDataComplete,
  taskId: string,
  dueWithTime: number,
  // ...
): Update<Task> => {
  return {
    id: taskId,
    changes: {
      dueWithTime,
      dueDay: undefined, // ← Mutual exclusivity: dueWithTime clears dueDay
      remindAt,
    },
  };
};
```

### Reading: Checking the Fields

All selectors follow this pattern - **check `dueWithTime` first, only fall back to `dueDay` if `dueWithTime` is not set**:

#### Example 1: Planner Selector

**File**: [`planner.selectors.ts`](../../src/app/features/planner/store/planner.selectors.ts)

```typescript
export const selectAllTasksDueToday = createSelector(
  /*...*/ (taskState, todayStr) => {
    // ...
    for (const id of taskState.ids) {
      const task = taskState.entities[id];
      if (!task) continue;

      // Check if task is due today
      // Priority: dueWithTime takes precedence over dueDay (mutual exclusivity pattern)
      let isDueToday = false;
      if (task.dueWithTime) {
        isDueToday = isToday(task.dueWithTime);
      } else if (task.dueDay === todayStr) {
        isDueToday = true;
      }

      if (isDueToday) {
        allDue.push(task);
      }
    }
  },
);
```

#### Example 2: Work Context Selector

**File**: [`work-context.selectors.ts`](../../src/app/features/work-context/store/work-context.selectors.ts)

```typescript
const computeOrderedTaskIdsForToday = (todayTag, taskEntities, todayStr) => {
  const tasksForToday: string[] = [];
  for (const taskId of Object.keys(taskEntities)) {
    const task = taskEntities[taskId];
    if (task) {
      // Check dueWithTime first (takes priority - mutual exclusivity)
      if (task.dueWithTime) {
        if (isToday(task.dueWithTime)) {
          tasksForToday.push(taskId);
        }
        // If dueWithTime is set but not for today, skip (don't check dueDay)
      }
      // Fallback: check dueDay only if dueWithTime is not set
      else if (task.dueDay === todayStr) {
        tasksForToday.push(taskId);
      }
    }
  }
  // ...
};
```

#### Example 3: Task Selector Helper

**File**: [`task.selectors.ts`](../../src/app/features/tasks/store/task.selectors.ts)

```typescript
// Helper to check if task is "in TODAY" via virtual tag pattern
// Priority: dueWithTime takes precedence over dueDay (mutual exclusivity)
const isInToday = (task: Task): boolean => {
  if (task.dueWithTime) {
    return isToday(task.dueWithTime);
  }
  return task.dueDay === todayStr;
};
```

## Legacy Data Handling

### The Challenge

**Existing data may have both fields set** from before this pattern was introduced. This is unavoidable due to:

1. Persisted local data
2. Synced data from other clients
3. Data from backups/archives

### The Solution

**All selectors implement the priority pattern** (`dueWithTime` first), ensuring correct behavior even with legacy data:

- If **both fields are set**: `dueWithTime` determines the task's due date
- If **only `dueDay` is set**: Use `dueDay` (legacy all-day tasks)
- If **only `dueWithTime` is set**: Use `dueWithTime` (new data)

### Migration Strategy

**No data migration is performed**. Instead:

1. **Graceful degradation**: Old data continues to work via priority pattern
2. **Natural migration**: As users interact with tasks, new operations will clear `dueDay` when setting `dueWithTime`
3. **No breaking changes**: Both fields remain in the model as optional

## Testing

The mutual exclusivity pattern is extensively tested:

### Test File: [`task-shared-scheduling.reducer.spec.ts`](../../src/app/root-store/meta/task-shared-meta-reducers/task-shared-scheduling.reducer.spec.ts)

```typescript
it('should set dueDay to undefined when scheduling for today (mutual exclusivity)', () => {
  const now = Date.now();
  const testState = createStateWithExistingTasks(['task1'], [], [], []);
  const action = createScheduleAction({}, now);

  metaReducer(testState, action);
  expectStateUpdate(
    expectTaskUpdate('task1', { dueWithTime: now, dueDay: undefined }),
    action,
    mockReducer,
    testState,
  );
});

it('should set dueDay to undefined when scheduling for a different day (mutual exclusivity)', () => {
  const testState = createStateWithExistingTasks(['task1'], [], [], ['task1']);
  const tomorrowTimestamp = Date.now() + 24 * 60 * 60 * 1000;
  const action = createScheduleAction({}, tomorrowTimestamp);

  metaReducer(testState, action);
  expectStateUpdate(
    expectTaskUpdate('task1', {
      dueWithTime: tomorrowTimestamp,
      dueDay: undefined, // ← Cleared
    }),
    action,
    mockReducer,
    testState,
  );
});
```

### Test File: [`work-context.selectors.spec.ts`](../../src/app/features/work-context/store/work-context.selectors.spec.ts)

```typescript
it('should INCLUDE task with dueWithTime for today even when dueDay is set to different date (dueWithTime takes priority)', () => {
  const today = new Date();
  today.setHours(8, 0, 0, 0);
  const todayTimestamp = today.getTime();

  // This is a legacy data scenario - with mutual exclusivity, this shouldn't happen in new data
  const taskWithBothFields = {
    id: 'task1',
    tagIds: [],
    dueDay: '2000-01-01', // Legacy dueDay set to different date
    dueWithTime: todayTimestamp, // dueWithTime for today takes priority
    subTaskIds: [],
  } as TaskCopy;

  const result = selectTodayTaskIds.projector(tagState, taskState);
  expect(result).toEqual(['task1']); // dueWithTime takes priority - task IS in today
});

it('task scheduled for tomorrow via dialog should NOT appear in today (mutual exclusivity)', () => {
  // This tests the mutual exclusivity pattern:
  // 1. Task starts in "today" list (dueDay = today)
  // 2. User schedules it for tomorrow via schedule dialog
  // 3. After scheduling: dueWithTime is set, dueDay is cleared (undefined)
  // 4. Task should NOT appear in today's list (dueWithTime is for tomorrow)

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const tomorrowTimestamp = tomorrow.getTime();

  const taskScheduledForTomorrow = {
    id: 'task1',
    tagIds: [],
    dueDay: undefined, // Mutual exclusivity: dueDay cleared when dueWithTime is set
    dueWithTime: tomorrowTimestamp, // Scheduled for 9am tomorrow
    subTaskIds: [],
  } as TaskCopy;

  const result = selectTodayTaskIds.projector(tagState, taskState);
  expect(result).toEqual([]); // Task should NOT appear in today
});
```

## Code Patterns to Follow

### ✅ DO: Check dueWithTime first

```typescript
if (task.dueWithTime) {
  // Handle time-specific scheduling
  isDueToday = isToday(task.dueWithTime);
} else if (task.dueDay === todayStr) {
  // Only check dueDay if dueWithTime is not set
  isDueToday = true;
}
```

### ✅ DO: Clear dueDay when setting dueWithTime

```typescript
updateTask({
  id: taskId,
  changes: {
    dueWithTime: timestamp,
    dueDay: undefined, // Always clear when setting dueWithTime
  },
});
```

### ❌ DON'T: Check dueDay first

```typescript
// WRONG - Don't do this
if (task.dueDay === todayStr) {
  isDueToday = true;
} else if (task.dueWithTime && isToday(task.dueWithTime)) {
  isDueToday = true;
}
```

### ❌ DON'T: Set both fields

```typescript
// WRONG - Never set both fields in new code
updateTask({
  id: taskId,
  changes: {
    dueWithTime: timestamp,
    dueDay: getDbDateStr(timestamp), // DON'T DO THIS
  },
});
```

### ❌ DON'T: Check both fields with OR

```typescript
// WRONG - This violates priority pattern
const isDueByDay = task.dueDay === todayStr;
const isDueByTime = task.dueWithTime && isToday(task.dueWithTime);
if (isDueByDay || isDueByTime) {
  // This can give wrong results with legacy data
}
```

## Related Patterns

### TODAY_TAG Virtual Tag

The mutual exclusivity pattern complements the **TODAY_TAG virtual tag pattern** where:

- `TODAY_TAG.id` must NEVER be in `task.tagIds`
- Membership in "today" is determined by `dueDay` OR `dueWithTime` (via priority pattern)

See: [`today-tag-architecture.md`](today-tag-architecture.md)

### When to Use Each Field

| Scenario                             | Use `dueWithTime`   | Use `dueDay`                 |
| ------------------------------------ | ------------------- | ---------------------------- |
| Task scheduled for specific time     | ✅                  | ❌ (undefined)               |
| Task scheduled for all-day (no time) | ❌ (undefined)      | ✅                           |
| Task not scheduled at all            | ❌ (undefined)      | ❌ (undefined)               |
| Reading legacy data with both fields | ✅ (takes priority) | ignore if dueWithTime exists |

## Key Files Modified

The following files were changed as part of implementing this pattern in commit `400ca8c1`:

| File                                                                                                                                       | Change                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| [`task-shared-scheduling.reducer.ts`](../../src/app/root-store/meta/task-shared-meta-reducers/task-shared-scheduling.reducer.ts)           | Clear `dueDay` when setting `dueWithTime` |
| [`planner.selectors.ts`](../../src/app/features/planner/store/planner.selectors.ts)                                                        | Check `dueWithTime` first, then `dueDay`  |
| [`task.selectors.ts`](../../src/app/features/tasks/store/task.selectors.ts)                                                                | Check `dueWithTime` first, then `dueDay`  |
| [`work-context.selectors.ts`](../../src/app/features/work-context/store/work-context.selectors.ts)                                         | Check `dueWithTime` first, then `dueDay`  |
| [`task-shared-scheduling.reducer.spec.ts`](../../src/app/root-store/meta/task-shared-meta-reducers/task-shared-scheduling.reducer.spec.ts) | Test mutual exclusivity on write          |
| [`work-context.selectors.spec.ts`](../../src/app/features/work-context/store/work-context.selectors.spec.ts)                               | Test priority pattern on read             |

## Future Considerations

### Potential Migration

If needed in the future, a **data migration** could be implemented to clean up legacy data:

```typescript
// Potential migration (not currently implemented)
function migrateDueDateFields(task: Task): Task {
  if (task.dueWithTime && task.dueDay) {
    // Clear dueDay if dueWithTime is set
    return { ...task, dueDay: undefined };
  }
  return task;
}
```

However, this is **not currently necessary** because the priority pattern handles legacy data correctly.

### Adding New Date/Time Fields

If new scheduling fields are added in the future:

1. **Consider mutual exclusivity** with existing fields
2. **Document priority order** if multiple fields can express similar concepts
3. **Update all selectors** consistently with the priority pattern
4. **Add comprehensive tests** for legacy data scenarios

## Summary

- **Pattern**: `dueWithTime` and `dueDay` are mutually exclusive in new data
- **Priority**: `dueWithTime` takes precedence when reading data
- **Writing**: Clear `dueDay` when setting `dueWithTime`
- **Reading**: Check `dueWithTime` first, only check `dueDay` if `dueWithTime` is not set
- **Legacy**: Old data with both fields works via priority pattern
- **Testing**: Extensively tested in reducers and selectors
