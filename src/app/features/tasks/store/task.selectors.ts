import { createFeatureSelector, createSelector, MemoizedSelector } from '@ngrx/store';
import { TASK_FEATURE_NAME } from './task.reducer';
import {
  Task,
  TaskState,
  TaskWithDueDay,
  TaskWithDueTime,
  TaskWithReminder,
  TaskWithSubTasks,
} from '../task.model';
import { taskAdapter } from './task.adapter';
import { devError } from '../../../util/dev-error';
import { fastArrayCompare } from '../../../util/fast-array-compare';
import { isDBDateStr } from '../../../util/get-db-date-str';
import { IssueProvider, isPluginIssueProvider } from '../../issue/issue.model';
import { selectArchivedProjectIds } from '../../project/store/project.selectors';
import { selectTodayTagTaskIds } from '../../tag/store/tag.reducer';
import {
  selectStartOfNextDayDiffMs,
  selectTodayStr,
} from '../../../root-store/app-state/app-state.selectors';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { isTodayWithOffset } from '../../../util/is-today.util';
import { getTimeConflictTaskIds } from '../util/get-time-conflict-task-ids';

export const isCalendarIssueTask = (task: Task | undefined): task is Task =>
  !!task &&
  !!task.issueType &&
  (task.issueType === 'ICAL' || isPluginIssueProvider(task.issueType));

export const mapSubTasksToTask = (
  task: Task | null,
  s: TaskState,
): TaskWithSubTasks | null => {
  if (!task) {
    return null;
  }
  const subTasks: Task[] = [];
  for (const id of task.subTaskIds) {
    const subTask = s.entities[id];
    if (subTask) {
      subTasks.push(subTask);
    } else {
      devError('Task data not found for ' + id);
    }
  }
  return {
    ...task,
    subTasks,
  };
};

export const flattenTasks = (tasksIN: TaskWithSubTasks[]): TaskWithSubTasks[] => {
  let flatTasks: TaskWithSubTasks[] = [];
  tasksIN.forEach((task) => {
    if (!task) {
      return;
    }
    flatTasks.push(task);
    if (task.subTasks && task.subTasks.length > 0) {
      // NOTE: in order for the model to be identical we add an empty subTasks array
      const validSubTasks = task.subTasks.filter((t) => t !== null && t !== undefined);
      flatTasks = flatTasks.concat(validSubTasks.map((t) => ({ ...t, subTasks: [] })));
    }
  });
  return flatTasks;
};

// SELECTORS
// ---------
const { selectEntities, selectAll } = taskAdapter.getSelectors();
export const selectTaskFeatureState = createFeatureSelector<TaskState>(TASK_FEATURE_NAME);
export const selectTaskEntities = createSelector(selectTaskFeatureState, selectEntities);
export const selectTaskEntitiesInActiveProjects = createSelector(
  selectTaskEntities,
  selectArchivedProjectIds,
  (entities, archivedIds): Record<string, Task | undefined> =>
    archivedIds.size === 0
      ? entities
      : Object.fromEntries(
          Object.entries(entities).filter(
            ([, t]) => !t || !t.projectId || !archivedIds.has(t.projectId),
          ),
        ),
);
export const selectCurrentTaskId = createSelector(
  selectTaskFeatureState,
  (state) => state.currentTaskId,
);
export const selectIsTaskDataLoaded = createSelector(
  selectTaskFeatureState,
  (state) => state.isDataLoaded,
);
export const selectCurrentTask = createSelector(selectTaskFeatureState, (s) =>
  s.currentTaskId ? (s.entities[s.currentTaskId] ?? null) : null,
);
export const selectLastCurrentTask = createSelector(selectTaskFeatureState, (s) =>
  s.lastCurrentTaskId ? (s.entities[s.lastCurrentTaskId] ?? null) : null,
);

export const selectCurrentTaskOrParentWithData = createSelector(
  selectTaskFeatureState,
  (s): TaskWithSubTasks | null => {
    if (!s.currentTaskId) return null;
    const currentTask = s.entities[s.currentTaskId];
    if (!currentTask) return null;

    // If current task has a parent, return the parent with its subtasks
    if (currentTask.parentId) {
      const parentTask = s.entities[currentTask.parentId];
      if (parentTask) {
        return mapSubTasksToTask(parentTask, s);
      }
    }
    // Otherwise return the current task
    return mapSubTasksToTask(currentTask, s);
  },
);

export const selectStartableTasks = createSelector(
  selectTaskFeatureState,
  (s): Task[] => {
    return s.ids
      .map((id) => s.entities[id])
      .filter(
        (task): task is Task =>
          !!task && !task.isDone && (!!task.parentId || task.subTaskIds.length === 0),
      );
  },
);

export const selectAllTasks = createSelector(
  selectTaskFeatureState,
  (state: TaskState): Task[] => {
    const all = selectAll(state);
    // Only filter when undefined entities exist — otherwise return the original
    // memoized array from selectAll to avoid breaking NgRx selector memoization.
    if (all.some((task) => !task)) {
      devError('selectAllTasks: found undefined entities in task state');
      return all.filter((task): task is Task => !!task);
    }
    return all;
  },
);

// NOTE: selectAllTasksWithSubTasks is defined below, after the scheduling
// snapshot infrastructure it now depends on (SPAP-20).

export const selectAllTasksInActiveProjects = createSelector(
  selectAllTasks,
  selectArchivedProjectIds,
  // Fast path returns same `tasks` ref when no projects are archived, keeping memoization stable.
  (tasks: Task[], archivedIds: Set<string>): Task[] =>
    archivedIds.size === 0
      ? tasks
      : tasks.filter((t) => !t.projectId || !archivedIds.has(t.projectId)),
);

export const selectMapOfAllTasksInActiveProjects = createSelector(
  selectAllTasksInActiveProjects,
  (activeTasks): Map<string, Task> => new Map(activeTasks.map((t) => [t.id, t])),
);

// SPAP-20: Scheduling snapshot boundary.
// --------------------------------------
// selectAllTasks(InActiveProjects) returns a NEW array every second while a task
// tracks time (its `timeSpent` bump replaces the entity ref). Every collection
// selector derived from it re-ran its O(n) filter/sort + fresh allocations each
// tick even though NONE of them read `timeSpent`. We interpose a content-stable
// "scheduling snapshot": a projection holding ONLY the fields those selectors
// filter/sort on. A `timeSpent`-only tick yields the IDENTICAL snapshot array
// ref, so every snapshot-derived DECISION selector (which outputs an ordered id
// list) is skipped by NgRx memoization. The PUBLIC selectors keep their existing
// output types by re-mapping the stable id list back through the LIVE task
// entities — so a member task always reflects current data (no staleness) while
// unchanged members keep referentially-identical objects.

export interface SchedulingSnapshot {
  readonly id: string;
  readonly isDone: boolean;
  readonly dueDay: string | null;
  readonly dueWithTime: number | null;
  readonly deadlineDay: string | null;
  readonly deadlineWithTime: number | null;
  readonly parentId: string | null;
  readonly subTaskIds: string[];
}

export interface SnapshotStructureEntry {
  readonly id: string;
  readonly subTaskIds: string[];
}

interface SchedulingSnapshotCacheEntry {
  taskRef: Task;
  snap: SchedulingSnapshot;
}

const _schedulingSnapEqual = (a: SchedulingSnapshot, b: SchedulingSnapshot): boolean =>
  a.isDone === b.isDone &&
  a.dueDay === b.dueDay &&
  a.dueWithTime === b.dueWithTime &&
  a.deadlineDay === b.deadlineDay &&
  a.deadlineWithTime === b.deadlineWithTime &&
  a.parentId === b.parentId &&
  fastArrayCompare(a.subTaskIds, b.subTaskIds);

// Builds a scheduling snapshot from an ordered task array. A per-id cache keyed
// on the task entity ref lets an unchanged task reuse its exact previous `snap`
// object; when the ref DID change but the scheduling fields did not (e.g. a
// `timeSpent`-only tick), the field-for-field compare still returns the cached
// `snap`. When every element is unchanged the PREVIOUS array ref is returned, so
// downstream memoized selectors are skipped entirely.
const createSchedulingSnapshotProjector = (): ((
  tasks: Task[],
) => SchedulingSnapshot[]) => {
  const cache = new Map<string, SchedulingSnapshotCacheEntry>();
  let prevResult: SchedulingSnapshot[] = [];
  return (tasks: Task[]): SchedulingSnapshot[] => {
    const result: SchedulingSnapshot[] = [];
    const seen = new Set<string>();
    let changed = tasks.length !== prevResult.length;
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      if (!task) {
        continue;
      }
      seen.add(task.id);
      const cached = cache.get(task.id);
      let snap: SchedulingSnapshot;
      if (cached && cached.taskRef === task) {
        snap = cached.snap;
      } else {
        const built: SchedulingSnapshot = {
          id: task.id,
          isDone: task.isDone,
          dueDay: task.dueDay ?? null,
          dueWithTime: task.dueWithTime ?? null,
          deadlineDay: task.deadlineDay ?? null,
          deadlineWithTime: task.deadlineWithTime ?? null,
          parentId: task.parentId ?? null,
          subTaskIds: task.subTaskIds,
        };
        snap = cached && _schedulingSnapEqual(cached.snap, built) ? cached.snap : built;
        cache.set(task.id, { taskRef: task, snap });
      }
      result.push(snap);
      if (!changed && prevResult[i] !== snap) {
        changed = true;
      }
    }
    // Prune entries for ids no longer present so the cache can't grow unbounded.
    if (cache.size > seen.size) {
      for (const key of cache.keys()) {
        if (!seen.has(key)) {
          cache.delete(key);
        }
      }
    }
    if (!changed) {
      return prevResult;
    }
    prevResult = result;
    return result;
  };
};

// Snapshot over active-project tasks — matches selectAllTasksInActiveProjects'
// archived-project filtering AND ordering exactly (it IS its source). Drives the
// overdue / due-time / deadline / due-day / later-today / today decisions.
export const selectTaskSchedulingSnapshot = createSelector(
  selectAllTasksInActiveProjects,
  createSchedulingSnapshotProjector(),
);

// Snapshot over ALL tasks (incl. archived-project tasks) — mirrors the unfiltered
// selectAllTasks source that selectAllTasksWithSubTasks intentionally uses.
export const selectAllTasksSchedulingSnapshot = createSelector(
  selectAllTasks,
  createSchedulingSnapshotProjector(),
);

// The active snapshot re-expressed as a Record keyed by id. selectTodayTaskIds'
// computeOrderedTaskIdsForToday reads a Record of {id,dueDay,dueWithTime,parentId}
// — this keeps that projector's input shape (and its spec's `.projector(...)`
// calls) unchanged while gating its recompute on the stable snapshot.
export const selectTaskSchedulingSnapshotRecord = createSelector(
  selectTaskSchedulingSnapshot,
  (snapshot): Record<string, SchedulingSnapshot> => {
    const rec: Record<string, SchedulingSnapshot> = {};
    for (const snap of snapshot) {
      rec[snap.id] = snap;
    }
    return rec;
  },
);

// Re-maps an ordered id list back to LIVE task entities, returning the PREVIOUS
// array ref when every mapped entity is unchanged; only genuinely-changed members
// (e.g. the tracked task, if it is a member) get a new ref.
const createStableTaskIdMapper = <T extends Task = Task>(): ((
  ids: string[],
  entities: Record<string, Task | undefined>,
) => T[]) => {
  let prevResult: T[] = [];
  return (ids: string[], entities: Record<string, Task | undefined>): T[] => {
    const result: T[] = [];
    let changed = ids.length !== prevResult.length;
    for (let i = 0; i < ids.length; i++) {
      // Ids come from a snapshot derived from the SAME state as `entities`, so
      // the entity is always present.
      const task = entities[ids[i]] as T;
      result.push(task);
      if (!changed && prevResult[i] !== task) {
        changed = true;
      }
    }
    if (!changed) {
      return prevResult;
    }
    prevResult = result;
    return result;
  };
};

// Re-maps an ordered {id, subTaskIds} structure to TaskWithSubTasks built from
// LIVE entities, reusing the exact previous TaskWithSubTasks object for any parent
// whose entity ref AND resolved subtask refs are unchanged (SPAP-19 per-id cache).
// Missing subtask entities are skipped (parity with legacy mapSubTasksToTasks /
// subtasksByParentId shaping).
const createStableWithSubTasksMapper = (): ((
  structure: readonly SnapshotStructureEntry[],
  entities: Record<string, Task | undefined>,
) => TaskWithSubTasks[]) => {
  const cache = new Map<
    string,
    { task: Task; subTasks: Task[]; result: TaskWithSubTasks }
  >();
  let prevResult: TaskWithSubTasks[] = [];
  return (
    structure: readonly SnapshotStructureEntry[],
    entities: Record<string, Task | undefined>,
  ): TaskWithSubTasks[] => {
    const result: TaskWithSubTasks[] = [];
    const seen = new Set<string>();
    let changed = structure.length !== prevResult.length;
    for (let i = 0; i < structure.length; i++) {
      const entry = structure[i];
      const task = entities[entry.id];
      if (!task) {
        changed = true;
        continue;
      }
      seen.add(entry.id);
      const subTasks: Task[] = [];
      for (const sid of entry.subTaskIds) {
        const sub = entities[sid];
        if (sub) {
          subTasks.push(sub);
        }
      }
      const cached = cache.get(entry.id);
      let built: TaskWithSubTasks;
      if (cached && cached.task === task && fastArrayCompare(cached.subTasks, subTasks)) {
        built = cached.result;
      } else {
        built = { ...task, subTasks };
        cache.set(entry.id, { task, subTasks, result: built });
      }
      result.push(built);
      if (!changed && prevResult[i] !== built) {
        changed = true;
      }
    }
    if (cache.size > seen.size) {
      for (const key of cache.keys()) {
        if (!seen.has(key)) {
          cache.delete(key);
        }
      }
    }
    if (!changed) {
      return prevResult;
    }
    prevResult = result;
    return result;
  };
};

// selectAllTasksWithSubTasks (rebased): ordered top-level task ids + their raw
// subTaskIds from the ALL-tasks snapshot (decision skipped on a timeSpent tick),
// re-mapped to live TaskWithSubTasks. Mirrors legacy mapSubTasksToTasks: every
// non-subtask task in order; missing subtasks dropped at re-map.
export const selectAllTasksWithSubTasksStructure = createSelector(
  selectAllTasksSchedulingSnapshot,
  (snapshot): SnapshotStructureEntry[] => {
    const structure: SnapshotStructureEntry[] = [];
    for (const snap of snapshot) {
      if (snap.parentId) {
        continue;
      }
      structure.push({ id: snap.id, subTaskIds: snap.subTaskIds });
    }
    return structure;
  },
);

const _allTasksWithSubTasksMapper = createStableWithSubTasksMapper();
export const selectAllTasksWithSubTasks = createSelector(
  selectAllTasksWithSubTasksStructure,
  selectTaskEntities,
  _allTasksWithSubTasksMapper,
);

// selectOverdueTasks (rebased): decision reads only dueDay/dueWithTime from the
// snapshot; public re-maps ids to live Task refs.
export const selectOverdueTaskIds = createSelector(
  selectTaskSchedulingSnapshot,
  selectTodayStr,
  selectStartOfNextDayDiffMs,
  (snapshot, todayStr, startOfNextDayDiffMs): string[] => {
    const today = dateStrToUtcDate(todayStr);
    today.setHours(0, 0, 0, 0);
    // The logical start of "today" is shifted by the offset
    const todayStartMs = today.getTime() + startOfNextDayDiffMs;
    const ids: string[] = [];
    for (const snap of snapshot) {
      // Note: String comparison works correctly here because dueDay is in YYYY-MM-DD format
      // which is lexicographically sortable. This avoids timezone conversion issues.
      if (
        (snap.dueDay && isDBDateStr(snap.dueDay) && snap.dueDay < todayStr) ||
        (snap.dueWithTime && snap.dueWithTime < todayStartMs)
      ) {
        ids.push(snap.id);
      }
    }
    return ids;
  },
);

const _overdueTasksMapper = createStableTaskIdMapper();
export const selectOverdueTasks = createSelector(
  selectOverdueTaskIds,
  selectTaskEntities,
  _overdueTasksMapper,
);

export const selectUndoneOverdue = createSelector(
  selectOverdueTasks,
  (overdue): Task[] => {
    return overdue.filter((t) => !t.isDone);
  },
);

export const selectUndoneOverdueDeadlineTasks = createSelector(
  selectAllTasksInActiveProjects,
  selectTodayStr,
  selectStartOfNextDayDiffMs,
  (tasks, todayStr, startOfNextDayDiffMs): Task[] => {
    if (!todayStr) return [];

    const today = dateStrToUtcDate(todayStr);
    today.setHours(0, 0, 0, 0);
    const todayStartMs = today.getTime() + startOfNextDayDiffMs;
    return tasks.filter(
      (task) =>
        !task.isDone &&
        !!(
          (task.deadlineDay &&
            isDBDateStr(task.deadlineDay) &&
            task.deadlineDay < todayStr) ||
          (task.deadlineWithTime && task.deadlineWithTime < todayStartMs)
        ),
    );
  },
);

export const selectUnplannedDeadlineTasksForToday = createSelector(
  selectAllTasksInActiveProjects,
  selectTodayStr,
  selectStartOfNextDayDiffMs,
  (tasks, todayStr, startOfNextDayDiffMs): Task[] => {
    if (!todayStr) return [];

    const today = dateStrToUtcDate(todayStr);
    today.setHours(0, 0, 0, 0);
    const todayStartMs = today.getTime() + startOfNextDayDiffMs;
    const oneDayMs = 24 * 60 * 60 * 1000;
    const todayEndMs = todayStartMs + oneDayMs;

    return tasks.filter(
      (task): task is Task =>
        !task.isDone &&
        // Has a date-only deadline for today (time-specific deadlines are excluded
        // because they have their own reminder mechanism via deadlineRemindAt)
        task.deadlineDay === todayStr &&
        // Not already planned for today (dueDay or dueWithTime)
        task.dueDay !== todayStr &&
        !(
          task.dueWithTime &&
          task.dueWithTime >= todayStartMs &&
          task.dueWithTime < todayEndMs
        ),
    );
  },
);

// Note: Uses selectTodayTagTaskIds due to circular dependency with work-context.selectors.ts
// This selector may include stale tasks - for accurate membership use selectTodayTaskIds
export const selectOverdueTasksOnToday = createSelector(
  selectOverdueTasks,
  selectTodayTagTaskIds,
  (overdue, todayTaskIds): Task[] => {
    const todaySet = new Set(todayTaskIds);
    return overdue.filter((t) => todaySet.has(t.id));
  },
);

// Note: With the virtual TODAY_TAG architecture, overdue tasks (dueDay < today)
// can never be on today's list (dueDay === today), so we don't filter by TODAY_TAG.taskIds.
// We only filter out subtasks whose parent is also overdue (to avoid duplicates).
export const selectOverdueTasksWithSubTasks = createSelector(
  selectOverdueTasks,
  selectTaskFeatureState,
  (overdueTasks, taskState): TaskWithSubTasks[] => {
    const overdueIdSet = new Set(overdueTasks.map((task) => task.id));
    return overdueTasks
      .filter(
        (task) =>
          // Only show top-level tasks, or subtasks whose parent is not overdue
          (!task.parentId || !overdueIdSet.has(task.parentId)) && !task.isDone,
      )
      .map((task) => {
        // Pre-compute a chronological sort key so the comparator stays allocation-free
        // (parsing dueDay inside .sort() costs O(n log n) Date objects).
        // dueWithTime takes priority over dueDay; dueDay counts as start of that day.
        // Use dateStrToUtcDate to avoid timezone issues.
        let sortKey = 0;
        if (task.dueWithTime) {
          sortKey = task.dueWithTime;
        } else if (task.dueDay) {
          const startOfDueDay = dateStrToUtcDate(task.dueDay);
          startOfDueDay.setHours(0, 0, 0, 0);
          const startOfDueDayMs = startOfDueDay.getTime();
          // A calendar-invalid dueDay (e.g. 2024-02-30 passes the lexical isDBDateStr
          // guard in selectOverdueTasks) parses to NaN, which would poison the sort
          // comparator; pin such tasks to the front instead.
          sortKey = Number.isNaN(startOfDueDayMs) ? 0 : startOfDueDayMs;
        }
        return {
          task: mapSubTasksToTask(task as Task, taskState) as TaskWithSubTasks,
          sortKey,
        };
      })
      .sort((a, b) => a.sortKey - b.sortKey)
      .map((t) => t.task);
  },
);

export const selectSelectedTaskId = createSelector(
  selectTaskFeatureState,
  (state) => state.selectedTaskId,
);
export const selectTaskDetailTargetPanel = createSelector(
  selectTaskFeatureState,
  (state: TaskState) => state.taskDetailTargetPanel,
);
export const selectSelectedTask = createSelector(
  selectTaskFeatureState,
  (s): TaskWithSubTasks | null => {
    if (!s.selectedTaskId || !s.entities[s.selectedTaskId]) {
      return null;
    }
    return mapSubTasksToTask(s.entities[s.selectedTaskId] || null, s);
  },
);

export const selectCurrentTaskParentOrCurrent = createSelector(
  selectTaskFeatureState,
  (s): Task | undefined => {
    if (!s.currentTaskId) return undefined;
    const currentTask = s.entities[s.currentTaskId];
    if (!currentTask) return undefined;

    // If current task has a parent, return the parent
    if (currentTask.parentId) {
      const parentTask = s.entities[currentTask.parentId];
      if (parentTask) return parentTask;
    }
    return currentTask;
  },
);

// Uses virtual tag pattern to determine TODAY membership:
// A task is "in TODAY" if dueDay === today OR dueWithTime is for today
// PERF: Single-pass iteration instead of multiple passes over all tasks
// selectLaterTodayTasksWithSubTasks (rebased): the membership/grouping/sort
// DECISION runs on the snapshot only (skipped on a timeSpent tick) and emits an
// ordered {id, subTaskIds} structure; the public selector re-maps it to live
// TaskWithSubTasks. NOTE: like the original this reads Date.now() for the
// "later today" cutoff; the snapshot boundary means `now` only advances when a
// scheduling field (or todayStr/offset) changes rather than on every store tick.
export const selectLaterTodayStructure = createSelector(
  selectTaskSchedulingSnapshot,
  selectTodayStr,
  selectStartOfNextDayDiffMs,
  (snapshot, todayStr, startOfNextDayDiffMs): SnapshotStructureEntry[] => {
    if (!todayStr) {
      return [];
    }

    const now = Date.now();
    // End of "today" with offset: last ms of todayStr + offset
    const todayDate = dateStrToUtcDate(todayStr);
    todayDate.setHours(23, 59, 59, 999);
    const todayEndTime = todayDate.getTime() + startOfNextDayDiffMs;

    // Helper to check if task is "in TODAY" via virtual tag pattern
    // Priority: dueWithTime takes precedence over dueDay (mutual exclusivity)
    const isInToday = (snap: SchedulingSnapshot): boolean => {
      if (snap.dueWithTime) {
        return isTodayWithOffset(snap.dueWithTime, todayStr, startOfNextDayDiffMs);
      }
      return snap.dueDay === todayStr;
    };

    // Helper to check if task is scheduled for later today
    const isScheduledLaterToday = (snap: SchedulingSnapshot): boolean =>
      !!snap.dueWithTime && snap.dueWithTime >= now && snap.dueWithTime <= todayEndTime;

    // PERF: Single pass to categorize all tasks (was 2 passes before)
    const scheduledParentTasks: SchedulingSnapshot[] = [];
    const scheduledSubtasks: SchedulingSnapshot[] = [];
    const unscheduledParentsInToday: SchedulingSnapshot[] = [];
    const subtaskIdsByParentId: Record<string, string[]> = {};
    const dueWithTimeById = new Map<string, number | null>();

    for (const snap of snapshot) {
      dueWithTimeById.set(snap.id, snap.dueWithTime);
      if (snap.parentId) {
        if (!subtaskIdsByParentId.hasOwnProperty(snap.parentId)) {
          subtaskIdsByParentId[snap.parentId] = [];
        }
        subtaskIdsByParentId[snap.parentId].push(snap.id);
      }

      if (snap.isDone || !isInToday(snap)) continue;

      if (snap.parentId) {
        // Subtask - only care about scheduled ones
        if (isScheduledLaterToday(snap)) {
          scheduledSubtasks.push(snap);
        }
      } else {
        // Parent task - categorize by scheduled status
        if (isScheduledLaterToday(snap)) {
          scheduledParentTasks.push(snap);
        } else {
          unscheduledParentsInToday.push(snap);
        }
      }
    }

    // Create set for O(1) lookup
    const parentIdsWithScheduledSubtasks = new Set(
      scheduledSubtasks.map((subtask) => subtask.parentId),
    );

    // Parents to include: scheduled parents OR parents with scheduled subtasks
    const parentsToInclude = [
      ...scheduledParentTasks,
      ...unscheduledParentsInToday.filter((t) =>
        parentIdsWithScheduledSubtasks.has(t.id),
      ),
    ];

    // Get IDs of parents that will be included
    const parentIdsInLaterToday = new Set(parentsToInclude.map((snap) => snap.id));

    // Find orphaned subtasks (scheduled subtasks whose parents are NOT in Later Today)
    const orphanedScheduledSubtasks = scheduledSubtasks.filter(
      (subtask) => !parentIdsInLaterToday.has(subtask.parentId!),
    );

    // Combine parents and orphaned subtasks
    const allTopLevel = [...parentsToInclude, ...orphanedScheduledSubtasks];

    // Sort by earliest scheduled time (parent's own dueWithTime or its subtasks').
    // PERF: Pre-compute earliest times to avoid recalculating in sort comparator.
    const withTimes = allTopLevel.map((snap) => {
      const childIds = subtaskIdsByParentId[snap.id] ?? [];
      const earliestTime = Math.min(
        snap.dueWithTime || Infinity,
        ...childIds.map((cid) => dueWithTimeById.get(cid) || Infinity),
      );
      return { entry: { id: snap.id, subTaskIds: childIds }, earliestTime };
    });

    withTimes.sort((a, b) => a.earliestTime - b.earliestTime);
    return withTimes.map((w) => w.entry);
  },
);

const _laterTodayWithSubTasksMapper = createStableWithSubTasksMapper();
export const selectLaterTodayTasksWithSubTasks = createSelector(
  selectLaterTodayStructure,
  selectTaskEntities,
  _laterTodayWithSubTasksMapper,
);

export const selectAllDoneIds = createSelector(
  selectAllTasksInActiveProjects,
  (tasks: Task[]): string[] => tasks.filter((t) => t?.isDone).map((t) => t.id),
);

// DYNAMIC SELECTORS
// -----------------
export const selectTaskById = createSelector(
  selectTaskFeatureState,
  (state: TaskState, props: { id: string }): Task => state.entities[props.id] as Task,
);

// intentionally unfiltered: calendar banner shows "Add as Task" when undefined
// filtering archived projects would cause duplicate task creation for events already
// linked to an archived-project task
export const selectTaskByIssueId = createSelector(
  selectAllTasks,
  (tasks: Task[], props: { issueId: string }): Task | undefined =>
    tasks.find((t) => t.issueId === props.issueId),
);

export const selectTasksById = createSelector(
  selectTaskFeatureState,
  (state: TaskState, props: { ids: string[] }): Task[] =>
    props.ids
      ? props.ids.map((id) => state.entities[id]).filter((task): task is Task => !!task)
      : [],
);

export const selectTasksWithDueTimeById = createSelector(
  selectTaskFeatureState,
  (state: TaskState, props: { ids: string[] }): Task[] =>
    props.ids
      ? (props.ids.map((id) => state.entities[id]) as Task[])
          // there is a short moment when the reminder is already there but the task is not
          // and there is another when a tasks get deleted
          .filter((task) => !!task?.dueWithTime)
      : [],
);

export const selectTasksWithSubTasksByIds = createSelector(
  selectTaskFeatureState,
  (state: TaskState, props: { ids: string[] }): TaskWithSubTasks[] =>
    props.ids
      .map((id: string) => state.entities[id])
      .filter((task): task is Task => !!task)
      .map((task) => mapSubTasksToTask(task, state) as TaskWithSubTasks),
);

// SPAP-19: Per-subscription stable selector factories.
// -----------------------------------------------------
// The module-level `selectTasksById` / `selectTasksWithSubTasksByIds`
// props-selectors above keep a SINGLE depth-1 memo slot each, shared across
// every concurrent subscriber. Different `ids` props mutually evict that slot,
// so both recompute on every dispatched action. These factories instead mint a
// FRESH `createSelector` per distinct id-set (create it inside the
// `switchMap`/`map` at the call site) so each subscription owns its own memo —
// GC'd together with the subscription.
export const selectTasksByIdFactory = (ids: string[]): MemoizedSelector<object, Task[]> =>
  createSelector(selectTaskFeatureState, (state: TaskState): Task[] =>
    ids ? ids.map((id) => state.entities[id]).filter((task): task is Task => !!task) : [],
  );

export const selectTasksWithSubTasksByIdsFactory = (
  ids: string[],
): MemoizedSelector<object, TaskWithSubTasks[]> => {
  // Per-selector-instance (per-subscription) cache keyed by task id. Because it
  // lives in this closure it is naturally isolated from other subscribers and
  // GC'd with the selector. On a tick where only one task's entity ref changed,
  // every other task returns its identical previous `TaskWithSubTasks` object.
  const cache = new Map<
    string,
    { task: Task; subTasks: Task[]; result: TaskWithSubTasks }
  >();
  return createSelector(
    selectTaskFeatureState,
    (state: TaskState): TaskWithSubTasks[] => {
      const result: TaskWithSubTasks[] = [];
      const seen = new Set<string>();
      for (const id of ids) {
        const task = state.entities[id];
        // Same filtering as the legacy selector: drop missing/deleted entities.
        if (!task) {
          continue;
        }
        seen.add(id);

        // Resolve current subtask entities (same shaping as mapSubTasksToTask).
        const subTasks: Task[] = [];
        for (const subTaskId of task.subTaskIds) {
          const subTask = state.entities[subTaskId];
          if (subTask) {
            subTasks.push(subTask);
          } else {
            devError('Task data not found for ' + subTaskId);
          }
        }

        const cached = cache.get(id);
        if (
          cached &&
          cached.task === task &&
          cached.subTasks.length === subTasks.length &&
          cached.subTasks.every((st, i) => st === subTasks[i])
        ) {
          // Nothing referentially changed → reuse the exact previous object.
          result.push(cached.result);
        } else {
          const built: TaskWithSubTasks = { ...task, subTasks };
          cache.set(id, { task, subTasks, result: built });
          result.push(built);
        }
      }
      // Prune entries for ids no longer requested so the cache can't grow
      // unbounded if the id-set is ever mutated in place.
      if (cache.size > seen.size) {
        for (const key of cache.keys()) {
          if (!seen.has(key)) {
            cache.delete(key);
          }
        }
      }
      return result;
    },
  );
};

export const selectTaskByIdWithSubTaskData = createSelector(
  selectTaskFeatureState,
  (state: TaskState, props: { id: string }): TaskWithSubTasks => {
    const task = state.entities[props.id];
    if (!task) {
      devError('Task data not found for ' + props.id);
      return { subTasks: [] } as unknown as TaskWithSubTasks;
    }
    return mapSubTasksToTask(task, state) as TaskWithSubTasks;
  },
);

export const selectMainTasksWithoutTag = createSelector(
  selectAllTasksInActiveProjects,
  (tasks: Task[], props: { tagId: string }): Task[] =>
    tasks.filter(
      (task) => !!task && !task.parentId && !task.tagIds.includes(props.tagId),
    ),
);

// intentionally unfiltered: filters out calendar events already linked to a task — must include
// archived projects or those events would reappear in the schedule as "not yet added"
export const selectAllCalendarTaskEventIds = createSelector(
  selectAllTasks,
  (tasks: Task[]): string[] =>
    tasks.filter(isCalendarIssueTask).map((t) => t.issueId as string),
);

// intentionally unfiltered: explicit design choice to poll ALL calendar tasks across all projects
// (including archived) — see poll-issue-updates.effects.ts comment "poll ALL calendar tasks"
export const selectAllCalendarIssueTasks = createSelector(
  selectAllTasks,
  (tasks: Task[]): Task[] => tasks.filter(isCalendarIssueTask),
);

export const selectTasksDueForDay = createSelector(
  selectAllTasksInActiveProjects,
  (tasks: Task[], props: { day: string }): TaskWithDueDay[] => {
    return tasks.filter(
      (task) => !!task && task.dueDay === props.day,
    ) as TaskWithDueDay[];
  },
);

export const selectTasksDueAndOverdueForDay = createSelector(
  selectAllTasksInActiveProjects,
  (tasks: Task[], props: { day: string }): TaskWithDueDay[] => {
    return tasks.filter(
      // Note: String comparison works correctly here because dueDay is in YYYY-MM-DD format
      // which is lexicographically sortable. This avoids timezone conversion issues that occur
      // when creating Date objects from date strings.
      (task) => !!task && typeof task.dueDay === 'string' && task.dueDay <= props.day,
    ) as TaskWithDueDay[];
  },
);

export const selectTasksWithDueTimeForRange = createSelector(
  selectAllTasksInActiveProjects,
  (tasks: Task[], props: { start: number; end: number }): TaskWithDueTime[] => {
    return tasks.filter(
      (task) =>
        !!task &&
        typeof task.dueWithTime === 'number' &&
        task.dueWithTime >= props.start &&
        task.dueWithTime <= props.end,
    ) as TaskWithDueTime[];
  },
);

export const selectAllTasksWithDueTime = createSelector(
  selectAllTasksInActiveProjects,
  (tasks: Task[]): TaskWithDueTime[] => {
    return tasks.filter(
      (task): task is TaskWithDueTime => !!task && typeof task.dueWithTime === 'number',
    );
  },
);

// Decision: ids of tasks with a dueWithTime, sorted ascending, from the snapshot.
export const selectDueTimeSortedTaskIds = createSelector(
  selectTaskSchedulingSnapshot,
  (snapshot): string[] =>
    snapshot
      .filter(
        (snap): snap is SchedulingSnapshot & { dueWithTime: number } =>
          typeof snap.dueWithTime === 'number',
      )
      .sort((a, b) => a.dueWithTime - b.dueWithTime)
      .map((snap) => snap.id),
);

const _allTasksWithDueTimeSortedMapper = createStableTaskIdMapper<TaskWithDueTime>();
export const selectAllTasksWithDueTimeSorted = createSelector(
  selectDueTimeSortedTaskIds,
  selectTaskEntities,
  _allTasksWithDueTimeSortedMapper,
);

// NOTE: selectTimeConflictTaskIds intentionally keeps consuming the PUBLIC
// selectAllTasksWithDueTimeSorted (LIVE refs) rather than the snapshot decision:
// getTimeConflictTaskIds → getTimeLeftForTask READS `timeSpent`, so a tracked
// due-time task's shrinking time-left can genuinely change conflicts each tick.
// The live re-map yields a new array (with the tracked task's live ref) only when
// a due-time member actually changed, so conflicts recompute exactly when needed.
export const selectTimeConflictTaskIds = createSelector(
  selectAllTasksWithDueTimeSorted,
  getTimeConflictTaskIds,
);

export const selectAllTasksWithReminder = createSelector(
  selectAllTasksInActiveProjects,
  (tasks: Task[]): TaskWithReminder[] => {
    return tasks.filter(
      (task) => task && typeof task.remindAt === 'number' && !task.isDone,
    ) as TaskWithReminder[];
  },
);

export const selectAllTasksWithDeadlineReminder = createSelector(
  selectAllTasksInActiveProjects,
  (tasks: Task[]): Task[] => {
    return tasks.filter(
      (task) => task && typeof task.deadlineRemindAt === 'number' && !task.isDone,
    );
  },
);

export const selectUndoneDeadlineSortedTaskIds = createSelector(
  selectTaskSchedulingSnapshot,
  (snapshot): string[] =>
    snapshot
      .filter(
        (snap) =>
          !snap.isDone && (snap.deadlineDay || typeof snap.deadlineWithTime === 'number'),
      )
      .sort((a, b) => {
        const aTime =
          typeof a.deadlineWithTime === 'number'
            ? a.deadlineWithTime
            : dateStrToUtcDate(a.deadlineDay!).getTime();
        const bTime =
          typeof b.deadlineWithTime === 'number'
            ? b.deadlineWithTime
            : dateStrToUtcDate(b.deadlineDay!).getTime();
        return aTime - bTime;
      })
      .map((snap) => snap.id),
);

const _allUndoneTasksWithDeadlineSortedMapper = createStableTaskIdMapper();
export const selectAllUndoneTasksWithDeadlineSorted = createSelector(
  selectUndoneDeadlineSortedTaskIds,
  selectTaskEntities,
  _allUndoneTasksWithDeadlineSortedMapper,
);

export const selectUndoneTasksWithDueDayNoReminder = createSelector(
  selectAllTasksInActiveProjects,
  (tasks: Task[]): Task[] => {
    return tasks.filter(
      (task) =>
        task &&
        !task.isDone &&
        typeof task.dueDay === 'string' &&
        task.dueDay.length > 0 &&
        typeof task.remindAt !== 'number',
    );
  },
);

export const selectTasksWithDueTimeUntil = createSelector(
  selectAllTasks,
  (tasks: Task[], props: { end: number }): TaskWithDueTime[] => {
    return tasks.filter(
      (task) =>
        !!task && typeof task.dueWithTime === 'number' && task.dueWithTime <= props.end,
    ) as TaskWithDueTime[];
  },
);

// REPEATABLE TASKS
// ----------------
export const selectAllRepeatableTaskWithSubTasks = createSelector(
  selectAllTasksWithSubTasks,
  (tasks: TaskWithSubTasks[]) => {
    return tasks.filter((task) => !!task && !!task.repeatCfgId);
  },
);

export const selectTasksByRepeatConfigId = createSelector(
  selectTaskFeatureState,
  (state: TaskState, props: { repeatCfgId: string }): Task[] => {
    const ids = state.ids as string[];
    return ids
      .map((id) => state.entities[id])
      .filter((task): task is Task => !!task && task.repeatCfgId === props.repeatCfgId);
  },
);

export const selectTaskWithSubTasksByRepeatConfigId = createSelector(
  selectAllTasksWithSubTasks,
  (tasks: TaskWithSubTasks[], props: { repeatCfgId: string }) => {
    return tasks.filter((task) => !!task && task.repeatCfgId === props.repeatCfgId);
  },
);

export const selectTasksByTag = createSelector(
  selectAllTasksWithSubTasks,
  (tasks: TaskWithSubTasks[], props: { tagId: string }) => {
    return tasks.filter((task) => !!task && task.tagIds.indexOf(props.tagId) !== -1);
  },
);

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const selectAllTaskIssueIdsForIssueProvider = (issueProvider: IssueProvider) => {
  return createSelector(selectAllTasks, (tasks: Task[]): string[] => {
    return tasks
      .filter((task) => !!task && task.issueProviderId === issueProvider.id)
      .map((t) => t.issueId as string);
  });
};

export const selectUndoneDueDayTaskIds = createSelector(
  selectTaskSchedulingSnapshot,
  (snapshot): string[] =>
    snapshot
      .filter((snap) => !!snap.dueDay && !snap.isDone)
      // Sort by dueDay (YYYY-MM-DD format is lexicographically sortable)
      .sort((a, b) => a.dueDay!.localeCompare(b.dueDay!))
      .map((snap) => snap.id),
);

const _allUndoneTasksWithDueDayMapper = createStableTaskIdMapper<TaskWithDueDay>();
export const selectAllUndoneTasksWithDueDay = createSelector(
  selectUndoneDueDayTaskIds,
  selectTaskEntities,
  _allUndoneTasksWithDueDayMapper,
);
