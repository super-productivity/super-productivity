import { createFeatureSelector, createSelector } from '@ngrx/store';
import { WorkContext, WorkContextState, WorkContextType } from '../work-context.model';
import {
  computeOrderedTaskIdsForTag,
  selectTagById,
  selectTagFeatureState,
} from '../../tag/store/tag.reducer';
import {
  mapSubTasksToTask,
  selectTaskEntities,
  selectTaskFeatureState,
} from '../../tasks/store/task.selectors';
import { Task, TaskWithDueTime, TaskWithSubTasks } from '../../tasks/task.model';
import { devError } from '../../../util/dev-error';
import { selectProjectFeatureState } from '../../project/store/project.selectors';
import { selectNoteTodayOrder } from '../../note/store/note.reducer';
import { TODAY_TAG } from '../../tag/tag.const';
import { Log } from '../../../core/log';
import { isTodayWithOffset } from '../../../util/is-today.util';
import { Tag } from '../../tag/tag.model';
import {
  selectStartOfNextDayDiffMs,
  selectTodayStr,
} from '../../../root-store/app-state/app-state.selectors';

export const WORK_CONTEXT_FEATURE_NAME = 'workContext';

/**
 * Computes ordered task IDs for TODAY_TAG using dueDay for membership.
 *
 * TODAY_TAG is a "virtual tag" - membership is determined by task.dueDay === today,
 * NOT by task.tagIds. TODAY_TAG.taskIds only stores the ordering.
 *
 * Fallback: Tasks with dueWithTime for today (but no/stale dueDay) are also included.
 * This handles edge cases like imported tasks with scheduled times.
 *
 * See: docs/ai/today-tag-architecture.md
 */
const computeOrderedTaskIdsForToday = (
  todayTag: Tag | undefined,
  taskEntities: Record<
    string,
    | {
        id: string;
        dueDay?: string | null;
        dueWithTime?: number | null;
        parentId?: string | null;
      }
    | undefined
  >,
  todayStr: string,
  startOfNextDayDiffMs: number = 0,
): string[] => {
  const storedOrder = todayTag?.taskIds || [];

  // IMPORTANT: Implements dueDay/dueWithTime mutual exclusivity pattern
  // - Check dueWithTime FIRST (it takes priority over dueDay)
  // - Only check dueDay if dueWithTime is not set
  // - If dueWithTime is set, do NOT check dueDay (even for legacy data with both fields)
  // - This ensures correct behavior with both new data (only one field set) and legacy data (both fields set)
  // See: docs/ai/dueDay-dueWithTime-mutual-exclusivity.md
  const tasksForToday: string[] = [];
  for (const taskId of Object.keys(taskEntities)) {
    const task = taskEntities[taskId];
    if (task) {
      // Check dueWithTime first (takes priority - mutual exclusivity)
      if (task.dueWithTime) {
        if (isTodayWithOffset(task.dueWithTime, todayStr, startOfNextDayDiffMs)) {
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

  if (tasksForToday.length === 0) {
    return [];
  }

  // Filter out subtasks whose parent is also in TODAY
  // (subtasks should only appear nested under their parent, not as separate top-level items)
  const tasksForTodaySet = new Set(tasksForToday);
  const topLevelTasksForToday = tasksForToday.filter((taskId) => {
    const task = taskEntities[taskId];
    return !task?.parentId || !tasksForTodaySet.has(task.parentId);
  });

  if (topLevelTasksForToday.length === 0) {
    return [];
  }

  // Order tasks according to TODAY_TAG.taskIds, with unordered tasks appended
  // PERF: Use Map for O(1) lookup instead of indexOf which is O(n) per task
  const topLevelTasksSet = new Set(topLevelTasksForToday);
  const storedOrderMap = new Map(storedOrder.map((id, idx) => [id, idx]));
  const orderedTasks: (string | undefined)[] = [];
  const unorderedTasks: string[] = [];

  for (const taskId of topLevelTasksForToday) {
    const orderIndex = storedOrderMap.get(taskId);
    if (orderIndex !== undefined) {
      orderedTasks[orderIndex] = taskId;
    } else {
      unorderedTasks.push(taskId);
    }
  }

  return [
    ...orderedTasks.filter(
      (id): id is string => id !== undefined && topLevelTasksSet.has(id),
    ),
    ...unorderedTasks,
  ];
};

export const selectContextFeatureState = createFeatureSelector<WorkContextState>(
  WORK_CONTEXT_FEATURE_NAME,
);
export const selectActiveContextId = createSelector(
  selectContextFeatureState,
  (state) => state.activeId,
);

export const selectActiveContextTypeAndId = createSelector(
  selectContextFeatureState,
  (
    state: WorkContextState,
  ): {
    activeId: string;
    activeType: WorkContextType;
    // additional entities state properties
  } => ({
    activeType: state.activeType as WorkContextType,
    activeId: state.activeId as string,
  }),
);

export const selectActiveWorkContext = createSelector(
  selectActiveContextTypeAndId,
  selectProjectFeatureState,
  selectTagFeatureState,
  selectTaskFeatureState,
  selectNoteTodayOrder,
  selectTodayStr,
  selectStartOfNextDayDiffMs,
  (
    { activeId, activeType },
    projectState,
    tagState,
    taskState,
    todayOrder,
    todayStr,
    startOfNextDayDiffMs,
  ): WorkContext => {
    if (activeType === WorkContextType.TAG) {
      const tag = selectTagById.projector(tagState, { id: activeId });

      // TODAY_TAG uses dueDay for membership (virtual tag pattern)
      // Regular tags use task.tagIds for membership (board-style pattern)
      const orderedTaskIds =
        activeId === TODAY_TAG.id
          ? computeOrderedTaskIdsForToday(
              tag,
              taskState.entities,
              todayStr,
              startOfNextDayDiffMs,
            )
          : computeOrderedTaskIdsForTag(activeId, tag, taskState.entities);

      return {
        ...tag,
        taskIds: orderedTaskIds,
        type: WorkContextType.TAG,
        routerLink: `tag/${tag.id}`,
        noteIds: todayOrder,
      };
    }
    if (activeType === WorkContextType.PROJECT) {
      const project = projectState.entities[activeId];
      if (!project) {
        // This should not happen, but if it does, we don't want to crash the app
        // This might happen during import when the active context is set to a project that is not yet imported
        Log.err('Project not found: ' + activeId);
        const tag = tagState.entities[TODAY_TAG.id];
        if (!tag) {
          throw new Error('Today tag not found');
        }
        // Fallback to TODAY tag - use dueDay for membership (virtual tag pattern)
        const orderedTaskIds = computeOrderedTaskIdsForToday(
          tag,
          taskState.entities,
          todayStr,
          startOfNextDayDiffMs,
        );
        return {
          ...tag,
          taskIds: orderedTaskIds,
          type: WorkContextType.TAG,
          routerLink: `tag/${tag.id}`,
          noteIds: todayOrder,
        };
      }
      return {
        ...project,
        icon: null,
        taskIds: project.taskIds || [],
        isEnableBacklog: project.isEnableBacklog,
        backlogTaskIds: project.backlogTaskIds || [],
        type: WorkContextType.PROJECT,
        routerLink: `project/${project.id}`,
      };
    }
    throw new Error(
      'Unable to select active work context: ' + activeType + ' ' + activeId,
    );
  },
);

const sortDoneLast = (a: Task, b: Task): number => {
  if (a.isDone && !b.isDone) {
    return 1;
  }
  if (!a.isDone && b.isDone) {
    return -1;
  }
  return 0;
};

export const selectTrackableTasksForActiveContext = createSelector(
  selectActiveWorkContext,
  selectTaskEntities,
  (activeContext, entities): Task[] => {
    let trackableTasks: Task[] = [];
    activeContext.taskIds.forEach((id) => {
      const task: Task | undefined = entities[id];
      if (!task) {
        // NOTE: there is the rare chance that activeWorkContext$ and selectTaskEntities
        // are out of sync, due to activeWorkContext taking an extra step, this is why we
        // only use devError
        devError('Task not found');
      } else if (task.subTaskIds && task.subTaskIds.length) {
        trackableTasks = trackableTasks.concat(
          task.subTaskIds.map((sid) => entities[sid]).filter((t): t is Task => !!t),
        );
      } else {
        trackableTasks.push(task);
      }
    });
    return trackableTasks.sort(sortDoneLast);
  },
);

export const selectStartableTasksForActiveContext = createSelector(
  selectTrackableTasksForActiveContext,
  (trackableTasks): Task[] => {
    return trackableTasks.filter((task) => !task.isDone);
  },
);

export const selectTrackableTasksActiveContextFirst = createSelector(
  selectTaskFeatureState,
  selectStartableTasksForActiveContext,
  (s, forActiveContext): Task[] => {
    // Use Set for O(1) lookup instead of O(n) .includes() in filter
    const activeContextIdSet = new Set(forActiveContext.map((item) => item.id));
    const otherTasks = s.ids
      .map((id) => s.entities[id])
      .filter(
        (task): task is Task =>
          !!task &&
          (!!task.parentId || !task.subTaskIds?.length) &&
          !activeContextIdSet.has(task.id),
      );
    return [...forActiveContext, ...otherTasks].sort(sortDoneLast);
  },
);

export const selectStartableTasksActiveContextFirst = createSelector(
  selectTrackableTasksActiveContextFirst,
  (trackableTasks): Task[] => {
    return trackableTasks.filter((task) => !task.isDone);
  },
);

export const selectDoneTaskIdsForActiveContext = createSelector(
  selectActiveWorkContext,
  selectTaskEntities,
  (activeContext, entities): string[] => {
    return activeContext.taskIds.filter((id: string) => {
      const task: Task | undefined = entities[id];
      if (!task) {
        // NOTE: there is the rare chance that activeWorkContext$ and selectTaskEntities
        // are out of sync, due to activeWorkContext taking an extra step, this is why we
        // only use devError
        devError('Task not found');
      }
      return !task?.isDone;
    });
  },
);

export const selectDoneBacklogTaskIdsForActiveContext = createSelector(
  selectActiveWorkContext,
  selectTaskEntities,
  (activeContext, entities): string[] | undefined => {
    return activeContext.backlogTaskIds?.filter((id: string) => {
      const task: Task | undefined = entities[id];
      if (!task) {
        // NOTE: there is the rare chance that activeWorkContext$ and selectTaskEntities
        // are out of sync, due to activeWorkContext taking an extra step, this is why we
        // only use devError
        devError('Task not found');
      }
      return !task?.isDone;
    });
  },
);

/**
 * Selects ordered task IDs for the TODAY work context.
 *
 * TODAY_TAG is a "virtual tag" - membership is determined by task.dueDay,
 * NOT by task.tagIds (TODAY_TAG should NEVER be in task.tagIds).
 * TODAY_TAG.taskIds only stores the ordering.
 *
 * See: docs/ai/today-tag-architecture.md
 */
export const selectTodayTaskIds = createSelector(
  selectTagFeatureState,
  selectTaskFeatureState,
  selectTodayStr,
  selectStartOfNextDayDiffMs,
  (tagState, taskState, todayStr, startOfNextDayDiffMs): string[] => {
    const todayTag = tagState.entities[TODAY_TAG.id];
    return computeOrderedTaskIdsForToday(
      todayTag,
      taskState.entities,
      todayStr,
      startOfNextDayDiffMs,
    );
  },
);

export const selectUndoneTodayTaskIds = createSelector(
  selectTodayTaskIds,
  selectTaskFeatureState,
  (todayTaskIds, taskState): string[] => {
    // selectTodayTaskIds already uses board-style pattern
    return todayTaskIds.filter((taskId) => taskState.entities[taskId]?.isDone === false);
  },
);

export const selectTimelineTasks = createSelector(
  selectTodayTaskIds,
  selectTaskFeatureState,
  (
    todayIds,
    s,
  ): {
    planned: TaskWithDueTime[];
    unPlanned: TaskWithSubTasks[];
  } => {
    const allPlannedTasks: TaskWithDueTime[] = [];
    s.ids
      .map((id) => s.entities[id])
      .filter((t): t is Task => !!t)
      .forEach((t) => {
        if (!t.isDone) {
          if (t.dueWithTime) {
            allPlannedTasks.push(t as TaskWithDueTime);
          }
        }
      });
    // Use Set for O(1) lookup instead of O(n) .includes() in filter
    const allPlannedIdSet = new Set(allPlannedTasks.map((t) => t.id));

    return {
      planned: allPlannedTasks,
      unPlanned: todayIds
        .map((id) => s.entities[id])
        .filter((t): t is Task => !!t)
        .map((t) => mapSubTasksToTask(t, s) as TaskWithSubTasks)
        .filter((t) => !t.isDone && !allPlannedIdSet.has(t.id)),
    };
  },
);

/**
 * Detects if TODAY_TAG.taskIds is inconsistent with tasks' dueDay values.
 * Returns the repaired taskIds if repair is needed, or null if consistent.
 *
 * This is used by ValidateStateService to repair state after sync, preventing
 * divergence caused by per-entity conflict resolution of multi-entity operations.
 *
 * See: docs/ai/today-tag-architecture.md
 */
export const selectTodayTagRepair = createSelector(
  selectTagFeatureState,
  selectTaskFeatureState,
  selectTodayStr,
  selectStartOfNextDayDiffMs,
  (
    tagState,
    taskState,
    todayStr,
    startOfNextDayDiffMs,
  ): { needsRepair: boolean; repairedTaskIds: string[] } | null => {
    const todayTag = tagState.entities[TODAY_TAG.id];
    if (!todayTag) {
      return null;
    }
    const storedTaskIds = todayTag.taskIds;

    // First pass: find all tasks (including subtasks) that are "due today"
    // Priority: dueWithTime takes precedence over dueDay (mutual exclusivity pattern)
    const allTasksWithDueToday = new Set<string>();
    for (const id of taskState.ids) {
      const task = taskState.entities[id];
      if (task) {
        // Check dueWithTime first (takes priority)
        if (task.dueWithTime) {
          if (isTodayWithOffset(task.dueWithTime, todayStr, startOfNextDayDiffMs)) {
            allTasksWithDueToday.add(task.id);
          }
          // If dueWithTime is set but not for today, skip (don't check dueDay)
        }
        // Fallback: check dueDay only if dueWithTime is not set
        else if (task.dueDay === todayStr) {
          allTasksWithDueToday.add(task.id);
        }
      }
    }

    // Second pass: find tasks that should appear as top-level items in Today list
    // This includes:
    // 1. Parent tasks that are "due today" (via dueWithTime or dueDay)
    // 2. Subtasks that are "due today" whose parent is NOT also "due today"
    const tasksForTodaySet = new Set<string>();
    for (const id of allTasksWithDueToday) {
      const task = taskState.entities[id];
      if (!task) continue;

      if (!task.parentId) {
        // Parent task with dueDay === today
        tasksForTodaySet.add(task.id);
      } else {
        // Subtask: only include if parent is NOT in today list
        // (otherwise it will appear nested under parent)
        if (!allTasksWithDueToday.has(task.parentId)) {
          tasksForTodaySet.add(task.id);
        }
      }
    }

    // Check for inconsistencies:
    // 1. storedTaskIds contains IDs where task is not valid for today (invalid)
    // 2. tasksForTodaySet contains IDs not in storedTaskIds (missing)
    const invalidInStored = storedTaskIds.filter((id) => !tasksForTodaySet.has(id));
    // Use Set for O(1) lookup instead of O(n) .includes()
    const storedTaskIdSet = new Set(storedTaskIds);
    const missingFromStored = [...tasksForTodaySet].filter(
      (id) => !storedTaskIdSet.has(id),
    );

    if (invalidInStored.length === 0 && missingFromStored.length === 0) {
      return null; // No repair needed
    }

    // Repair: keep valid IDs in their original order, append missing IDs
    const repairedTaskIds = [
      ...storedTaskIds.filter((id) => tasksForTodaySet.has(id)),
      ...missingFromStored,
    ];

    return { needsRepair: true, repairedTaskIds };
  },
);
