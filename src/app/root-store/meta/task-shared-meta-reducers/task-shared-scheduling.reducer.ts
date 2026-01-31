import { Action, ActionReducer, MetaReducer } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { RootState } from '../../root-state';
import { TaskSharedActions } from '../task-shared.actions';
import {
  TASK_FEATURE_NAME,
  taskAdapter,
} from '../../../features/tasks/store/task.reducer';
import { Task } from '../../../features/tasks/task.model';
import { TODAY_TAG } from '../../../features/tag/tag.const';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { unique } from '../../../util/unique';
import { isToday } from '../../../util/is-today.util';
import { moveItemBeforeItem } from '../../../util/move-item-before-item';
import {
  ActionHandlerMap,
  getTag,
  removeTasksFromList,
  removeTasksFromPlannerDays,
  updateProject,
  getProjectOrUndefined,
  updateTags,
} from './task-shared-helpers';
import { filterOutId } from '../../../util/filter-out-id';

// =============================================================================
// ACTION HANDLERS
// =============================================================================
//
// IMPORTANT: These handlers implement the dueDay/dueWithTime mutual exclusivity pattern.
// When setting dueWithTime, dueDay is cleared (set to undefined).
// See: docs/ai/dueDay-dueWithTime-mutual-exclusivity.md
//
// =============================================================================

const handleScheduleTaskWithTime = (
  state: RootState,
  task: { id: string; projectId?: string | null },
  dueWithTime: number,
  remindAt?: number,
  isMoveToBacklog?: boolean,
): RootState => {
  // Check if task already has the same dueWithTime
  const currentTask = state[TASK_FEATURE_NAME].entities[task.id] as Task;
  if (!currentTask) {
    return state;
  }

  const todayTag = getTag(state, TODAY_TAG.id);
  const isScheduledForToday = isToday(dueWithTime);
  const isCurrentlyInToday = todayTag.taskIds.includes(task.id);

  // If task is already correctly scheduled, don't change state (unless backlog move requested)
  if (
    currentTask.dueWithTime === dueWithTime &&
    currentTask.remindAt === remindAt &&
    isScheduledForToday === isCurrentlyInToday &&
    !isMoveToBacklog
  ) {
    return state;
  }

  // First, update the task entity with the scheduling data
  let updatedState: RootState = {
    ...state,
    [TASK_FEATURE_NAME]: taskAdapter.updateOne(
      {
        id: task.id,
        changes: {
          dueWithTime,
          // CRITICAL: Mutual exclusivity pattern - setting dueWithTime clears dueDay
          // This prevents state inconsistency where both fields are set with conflicting dates
          // See: docs/ai/dueDay-dueWithTime-mutual-exclusivity.md
          dueDay: undefined,
          remindAt,
        },
      },
      state[TASK_FEATURE_NAME],
    ),
  };

  // Handle backlog move atomically if requested
  if (isMoveToBacklog && currentTask.projectId) {
    const project = getProjectOrUndefined(updatedState, currentTask.projectId);
    if (project && project.isEnableBacklog) {
      const todaysTaskIdsBefore = project.taskIds;
      const backlogIdsBefore = project.backlogTaskIds;

      // Only move if not already in backlog
      if (!backlogIdsBefore.includes(task.id)) {
        updatedState = updateProject(updatedState, currentTask.projectId, {
          taskIds: todaysTaskIdsBefore.filter(filterOutId(task.id)),
          backlogTaskIds: [task.id, ...backlogIdsBefore],
        });
      }
    }
  }

  // No tag change needed
  if (isScheduledForToday === isCurrentlyInToday) {
    return updatedState;
  }

  const newTaskIds = isScheduledForToday
    ? unique([task.id, ...todayTag.taskIds]) // Add to top, prevent duplicates
    : todayTag.taskIds.filter((id) => id !== task.id); // Remove

  return updateTags(updatedState, [
    {
      id: TODAY_TAG.id,
      changes: { taskIds: newTaskIds },
    },
  ]);
};

const handleUnScheduleTask = (
  state: RootState,
  taskId: string,
  isLeaveInToday = false,
): RootState => {
  // First, update the task entity to clear scheduling data
  const updatedState = {
    ...state,
    [TASK_FEATURE_NAME]: taskAdapter.updateOne(
      {
        id: taskId,
        changes: {
          dueDay: isLeaveInToday ? getDbDateStr() : undefined,
          dueWithTime: undefined,
          remindAt: undefined,
        },
      },
      state[TASK_FEATURE_NAME],
    ),
  };

  // Then, handle today tag updates
  const todayTag = getTag(updatedState, TODAY_TAG.id);
  if (!todayTag.taskIds.includes(taskId) || isLeaveInToday) {
    return updatedState;
  }

  return updateTags(updatedState, [
    {
      id: TODAY_TAG.id,
      changes: {
        taskIds: todayTag.taskIds.filter((id) => id !== taskId),
      },
    },
  ]);
};

const handleDismissReminderOnly = (state: RootState, taskId: string): RootState => {
  // Only clear remindAt (the reminder notification) but keep dueWithTime, dueDay, and Today tag
  return {
    ...state,
    [TASK_FEATURE_NAME]: taskAdapter.updateOne(
      {
        id: taskId,
        changes: {
          remindAt: undefined,
        },
      },
      state[TASK_FEATURE_NAME],
    ),
  };
};

const handlePlanTasksForToday = (
  state: RootState,
  taskIds: string[],
  parentTaskMap: Record<string, string | undefined>,
  isClearScheduledTime?: boolean,
): RootState => {
  const todayTag = getTag(state, TODAY_TAG.id);
  const today = getDbDateStr();

  // Filter out tasks that are already in today or whose parent is in today
  const newTasksForToday = taskIds.filter((taskId) => {
    if (todayTag.taskIds.includes(taskId)) return false;
    const parentId = parentTaskMap[taskId];
    return !parentId || !todayTag.taskIds.includes(parentId);
  });

  // Filter for tasks that need updates:
  // 1. Tasks that need dueDay updated (not yet scheduled for today)
  // 2. Tasks already scheduled for today that need remindAt/dueWithTime cleared
  const tasksNeedingUpdate = taskIds.filter((taskId) => {
    const task = state[TASK_FEATURE_NAME].entities[taskId] as Task;
    if (!task) return false;

    // Include tasks that need dueDay updated
    if (task.dueDay !== today) {
      return newTasksForToday.includes(taskId) || todayTag.taskIds.includes(taskId);
    }

    // Include tasks already scheduled for today when we need to clear scheduling
    if (task.dueDay === today && isClearScheduledTime) {
      // Need to clear remindAt and/or dueWithTime
      return task.remindAt !== undefined || task.dueWithTime !== undefined;
    }

    return false;
  });

  // Early return if no actual changes needed
  if (newTasksForToday.length === 0 && tasksNeedingUpdate.length === 0) {
    return state;
  }

  // Only create updates for tasks that need dueDay change
  const taskUpdates: Update<Task>[] = tasksNeedingUpdate.map((taskId) => {
    const task = state[TASK_FEATURE_NAME].entities[taskId] as Task;

    // Preserve dueWithTime if it matches today's date
    // Only clear it if the task has a time scheduled for a different day
    // However, if isClearScheduledTime is true (from reminder dialog), always clear the time
    const shouldClearTime = isClearScheduledTime
      ? !!task?.dueWithTime
      : task?.dueWithTime && !isToday(task.dueWithTime);

    return {
      id: taskId,
      changes: {
        dueDay: today,
        remindAt: undefined, // Always clear reminder when explicitly adding to today
        ...(shouldClearTime ? { dueWithTime: undefined } : {}),
      },
    };
  });

  const updatedState = {
    ...state,
    [TASK_FEATURE_NAME]: taskAdapter.updateMany(taskUpdates, state[TASK_FEATURE_NAME]),
  };

  // Update the today tag
  const stateWithTodayTag = updateTags(updatedState, [
    {
      id: TODAY_TAG.id,
      changes: {
        taskIds: unique([...newTasksForToday, ...todayTag.taskIds]),
      },
    },
  ]);

  // Remove taskIds from planner days
  return removeTasksFromPlannerDays(stateWithTodayTag, taskIds);
};

const handleRemoveTasksFromTodayTag = (
  state: RootState,
  taskIds: string[],
): RootState => {
  const todayTag = getTag(state, TODAY_TAG.id);

  return updateTags(state, [
    {
      id: TODAY_TAG.id,
      changes: {
        taskIds: removeTasksFromList(todayTag.taskIds, taskIds),
      },
    },
  ]);
};

const handleMoveTaskInTodayTagList = (
  state: RootState,
  toTaskId: string,
  fromTaskId: string,
): RootState => {
  const todayTag = getTag(state, TODAY_TAG.id);

  // If either task is not in the Today list, don't perform the move
  if (!todayTag.taskIds.includes(fromTaskId) || !todayTag.taskIds.includes(toTaskId)) {
    return state;
  }

  return updateTags(state, [
    {
      id: todayTag.id,
      changes: {
        taskIds: moveItemBeforeItem(todayTag.taskIds, fromTaskId, toTaskId),
      },
    },
  ]);
};

// =============================================================================
// META REDUCER
// =============================================================================

const createActionHandlers = (state: RootState, action: Action): ActionHandlerMap => ({
  [TaskSharedActions.scheduleTaskWithTime.type]: () => {
    const { task, dueWithTime, remindAt, isMoveToBacklog } = action as ReturnType<
      typeof TaskSharedActions.scheduleTaskWithTime
    >;
    return handleScheduleTaskWithTime(
      state,
      task,
      dueWithTime,
      remindAt,
      isMoveToBacklog,
    );
  },
  [TaskSharedActions.reScheduleTaskWithTime.type]: () => {
    const { task, dueWithTime, remindAt, isMoveToBacklog } = action as ReturnType<
      typeof TaskSharedActions.reScheduleTaskWithTime
    >;
    return handleScheduleTaskWithTime(
      state,
      task,
      dueWithTime,
      remindAt,
      isMoveToBacklog,
    );
  },
  [TaskSharedActions.unscheduleTask.type]: () => {
    const { id, isLeaveInToday } = action as ReturnType<
      typeof TaskSharedActions.unscheduleTask
    >;
    return handleUnScheduleTask(state, id, isLeaveInToday);
  },
  [TaskSharedActions.dismissReminderOnly.type]: () => {
    const { id } = action as ReturnType<typeof TaskSharedActions.dismissReminderOnly>;
    return handleDismissReminderOnly(state, id);
  },
  [TaskSharedActions.planTasksForToday.type]: () => {
    const {
      taskIds,
      parentTaskMap = {},
      isClearScheduledTime,
    } = action as ReturnType<typeof TaskSharedActions.planTasksForToday>;
    return handlePlanTasksForToday(state, taskIds, parentTaskMap, isClearScheduledTime);
  },
  [TaskSharedActions.removeTasksFromTodayTag.type]: () => {
    const { taskIds } = action as ReturnType<
      typeof TaskSharedActions.removeTasksFromTodayTag
    >;
    return handleRemoveTasksFromTodayTag(state, taskIds);
  },
  [TaskSharedActions.moveTaskInTodayTagList.type]: () => {
    const { toTaskId, fromTaskId } = action as ReturnType<
      typeof TaskSharedActions.moveTaskInTodayTagList
    >;
    return handleMoveTaskInTodayTagList(state, toTaskId, fromTaskId);
  },
});

export const taskSharedSchedulingMetaReducer: MetaReducer = (
  reducer: ActionReducer<RootState, Action>,
) => {
  return (state: unknown, action: Action) => {
    if (!state) return reducer(state as RootState | undefined, action);

    const rootState = state as RootState;
    const actionHandlers = createActionHandlers(rootState, action);
    const handler = actionHandlers[action.type];
    const updatedState = handler ? handler(rootState) : rootState;

    return reducer(updatedState, action);
  };
};
