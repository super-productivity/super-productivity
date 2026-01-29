# TODAY_TAG Architecture

## Overview

TODAY_TAG is a **virtual tag** that behaves differently from regular tags. Understanding this distinction is critical for correct implementation of features involving today's tasks.

## Key Invariant

**TODAY_TAG (ID: `'TODAY'`) must NEVER be added to `task.tagIds`.**

Membership in TODAY_TAG is determined by **`task.dueWithTime` OR `task.dueDay`** (via [mutual exclusivity pattern](dueDay-dueWithTime-mutual-exclusivity.md)), not by `task.tagIds`. The `TODAY_TAG.taskIds` field stores only the **ordering** of today's tasks, not membership.

## Virtual Tag vs. Board-Style Pattern

| Aspect                  | TODAY_TAG (Virtual)                                                                                      | Regular Tags (Board-Style)    |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **Membership source**   | `task.dueWithTime` OR `task.dueDay` (see [mutual exclusivity](dueDay-dueWithTime-mutual-exclusivity.md)) | `task.tagIds.includes(tagId)` |
| **Stored on task**      | `task.dueWithTime` or `task.dueDay`                                                                      | `task.tagIds`                 |
| **In task.tagIds?**     | NO (invariant)                                                                                           | YES (required)                |
| **tag.taskIds purpose** | Ordering only                                                                                            | Ordering only                 |
| **Use case**            | Time-based grouping                                                                                      | Category/label grouping       |

## Why This Pattern?

1. **Uniform move operations**: Drag/drop and keyboard shortcuts (Ctrl+↑/↓) work identically for TODAY_TAG and regular tags because all tags store ordering in `tag.taskIds`.

2. **Single source of truth**: `task.dueWithTime` OR `task.dueDay` (via [mutual exclusivity pattern](dueDay-dueWithTime-mutual-exclusivity.md)) is the canonical field for "is this task scheduled for today?" - no dual bookkeeping between date fields and a hypothetical `tagIds` entry.

3. **Planner integration**: The planner view uses `task.dueWithTime` and `task.dueDay` to organize tasks by day. TODAY_TAG naturally aligns with this.

4. **Self-healing**: Stale ordering entries are gracefully filtered out by the selector. No manual cleanup needed when a task's `dueDay` changes.

## Implementation Details

### Definition

**File:** `src/app/features/tag/tag.const.ts`

```typescript
export const TODAY_TAG: Tag = {
  id: 'TODAY',
  title: 'Today',
  icon: 'wb_sunny',
  // ... theme, colors
};
```

### Membership Computation

**File:** `src/app/features/work-context/store/work-context.selectors.ts`

The `computeOrderedTaskIdsForToday()` function:

1. Finds all tasks where `dueWithTime` is today OR `dueDay === today` (membership via [mutual exclusivity pattern](dueDay-dueWithTime-mutual-exclusivity.md))
2. Orders them according to `TODAY_TAG.taskIds` (ordering)
3. Appends any unordered tasks at the end (self-healing)
4. Filters out stale entries from `TODAY_TAG.taskIds` (self-healing)

```typescript
const computeOrderedTaskIdsForToday = (todayTag, taskEntities) => {
  const todayStr = getDbDateStr();

  // Membership: tasks where dueWithTime is today OR dueDay === today
  // See: dueDay-dueWithTime-mutual-exclusivity.md for priority pattern
  const tasksForToday: string[] = [];
  for (const taskId of Object.keys(taskEntities)) {
    const task = taskEntities[taskId];
    if (task) {
      // Check dueWithTime first (takes priority - mutual exclusivity)
      if (task.dueWithTime) {
        if (isToday(task.dueWithTime)) {
          tasksForToday.push(taskId);
        }
      }
      // Fallback: check dueDay only if dueWithTime is not set
      else if (task.dueDay === todayStr) {
        tasksForToday.push(taskId);
      }
    }
  }

  // Ordering: use TODAY_TAG.taskIds, filter stale, append missing
  const storedOrder = todayTag?.taskIds || [];
  const tasksForTodaySet = new Set(tasksForToday);

  const orderedTasks = storedOrder.filter((id) => tasksForTodaySet.has(id));
  const unorderedTasks = tasksForToday.filter((id) => !storedOrder.includes(id));

  return [...orderedTasks, ...unorderedTasks];
};
```

### Move Operations

**File:** `src/app/features/tag/store/tag.reducer.ts`

All move operations (`moveTaskInTodayList`, `moveTaskUpInTodayList`, etc.) update `tag.taskIds` uniformly for ALL tags, including TODAY_TAG:

```typescript
on(moveTaskInTodayList, (state, { taskId, afterTaskId, workContextId }) => {
  const tag = state.entities[workContextId];
  const taskIds = moveItemAfterAnchor(taskId, afterTaskId, tag.taskIds);
  return tagAdapter.updateOne({ id: workContextId, changes: { taskIds } }, state);
}),
```

### Ensuring the Invariant

**File:** `src/app/root-store/meta/task-shared-meta-reducers/task-shared-helpers.ts`

Helper functions enforce the invariant:

```typescript
export const filterOutTodayTag = (tagIds: string[]): string[] =>
  tagIds.filter((id) => id !== TODAY_TAG.id);

export const hasInvalidTodayTag = (tagIds: string[]): boolean =>
  tagIds.includes(TODAY_TAG.id);
```

**File:** `src/app/root-store/meta/task-shared-meta-reducers/planner-shared.reducer.ts`

The planner meta-reducer:

- Updates `TODAY_TAG.taskIds` when moving tasks to/from today
- Removes TODAY_TAG from `task.tagIds` if present (cleanup legacy data)
- Never adds TODAY_TAG to `task.tagIds`

### Consistency Repair

**File:** `src/app/features/tag/store/tag.effects.ts`

The `repairTodayTagConsistency$` effect detects and repairs inconsistencies after sync:

```typescript
repairTodayTagConsistency$ = createEffect(() =>
  this._store$.select(selectTodayTagRepair).pipe(
    skipDuringSyncWindow(), // Don't fire during sync replay
    filter((repair) => repair?.needsRepair),
    map((repair) =>
      updateTag({
        tag: { id: TODAY_TAG.id, changes: { taskIds: repair.repairedTaskIds } },
        isSkipSnack: true,
      }),
    ),
  ),
);
```

This handles state divergence from per-entity conflict resolution during sync.

## Common Mistakes to Avoid

### Wrong: Adding TODAY_TAG to task.tagIds

```typescript
// WRONG - Never do this
task.tagIds = [...task.tagIds, TODAY_TAG.id];
```

### Correct: Set task.dueDay or task.dueWithTime

```typescript
// CORRECT - Set dueDay to add to today (all-day, no specific time)
task.dueDay = getDbDateStr(); // Today's date string
task.dueWithTime = undefined; // See: dueDay-dueWithTime-mutual-exclusivity.md

// ALSO CORRECT - Set dueWithTime for specific time today
task.dueWithTime = Date.now(); // Specific time today
task.dueDay = undefined; // See: dueDay-dueWithTime-mutual-exclusivity.md
```

### Wrong: Checking tagIds for TODAY membership

```typescript
// WRONG - This will always be false (or indicates legacy bug)
const isToday = task.tagIds.includes(TODAY_TAG.id);
```

### Correct: Check dueWithTime and dueDay (with priority)

```typescript
// CORRECT - Check dueWithTime first, then dueDay (mutual exclusivity pattern)
// See: dueDay-dueWithTime-mutual-exclusivity.md
let isInToday = false;
if (task.dueWithTime) {
  isInToday = isToday(task.dueWithTime);
} else if (task.dueDay === getDbDateStr()) {
  isInToday = true;
}
```

## Related Documentation

- **[dueDay/dueWithTime Mutual Exclusivity Pattern](dueDay-dueWithTime-mutual-exclusivity.md)** - Understanding how `dueDay` and `dueWithTime` interact (critical for TODAY_TAG membership)

## Key Files Reference

| File                                                                          | Purpose                                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/app/features/tag/tag.const.ts`                                           | TODAY_TAG definition                                                      |
| `src/app/features/work-context/store/work-context.selectors.ts`               | Membership computation (uses mutual exclusivity pattern), repair selector |
| `src/app/features/tag/store/tag.reducer.ts`                                   | Move operations (uniform for all tags)                                    |
| `src/app/root-store/meta/task-shared-meta-reducers/planner-shared.reducer.ts` | Multi-entity updates for planner actions                                  |
| `src/app/root-store/meta/task-shared-meta-reducers/task-shared-helpers.ts`    | `filterOutTodayTag()`, `hasInvalidTodayTag()`                             |
| `src/app/features/tag/store/tag.effects.ts`                                   | `repairTodayTagConsistency$` effect                                       |

## Testing

Tests demonstrating the virtual tag pattern:

- `src/app/features/work-context/store/work-context.selectors.spec.ts` - Membership computation tests
- `src/app/root-store/meta/task-shared-meta-reducers/planner-shared.reducer.spec.ts` - Move action tests
