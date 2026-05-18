import { Action, ActionReducer, MetaReducer } from '@ngrx/store';
import { RootState } from '../../root-state';
import { TaskSharedActions } from '../task-shared.actions';
import {
  TASK_FEATURE_NAME,
  taskAdapter,
} from '../../../features/tasks/store/task.reducer';
import { Task } from '../../../features/tasks/task.model';
import { ActionHandlerMap } from './task-shared-helpers';
import { getDbDateStr, isDBDateStr } from '../../../util/get-db-date-str';
import { isTodayWithOffset } from '../../../util/is-today.util';
import { TODAY_TAG } from '../../../features/tag/tag.const';
import { getTag, updateTags, removeTaskFromPlannerDays } from './task-shared-helpers';
import { unique } from '../../../util/unique';

// =============================================================================
// ACTION HANDLERS
// =============================================================================

const hasDueWithTime = (task: Task): boolean =>
  typeof task.dueWithTime === 'number' &&
  Number.isFinite(task.dueWithTime) &&
  task.dueWithTime > 0;

const isTaskDueTodayBySchedule = (
  task: Task,
  todayStr: string,
  startOfNextDayDiffMs: number,
): boolean => {
  if (hasDueWithTime(task)) {
    return isTodayWithOffset(task.dueWithTime as number, todayStr, startOfNextDayDiffMs);
  }
  return task.dueDay === todayStr;
};

const autoPlanTaskDueToDeadline = (
  state: RootState,
  taskId: string,
  deadlineDay?: string,
  deadlineWithTime?: number,
  autoPlanToday?: string,
  autoPlanStartOfNextDayDiffMs?: number,
): RootState => {
  const task = state[TASK_FEATURE_NAME].entities[taskId] as Task;
  if (!task) return state;

  if (
    !autoPlanToday ||
    !isDBDateStr(autoPlanToday) ||
    typeof autoPlanStartOfNextDayDiffMs !== 'number' ||
    !Number.isFinite(autoPlanStartOfNextDayDiffMs)
  ) {
    return state;
  }

  const todayStr = autoPlanToday;
  const startOfNextDayDiffMs = autoPlanStartOfNextDayDiffMs;

  // Auto-plan context is persisted only for local actions whose deadline was
  // evaluated as "today" at action creation. Re-check it here so malformed
  // callers cannot auto-plan arbitrary future deadlines.
  let isDeadlineToday = false;
  if (deadlineDay === todayStr) {
    isDeadlineToday = true;
  } else if (
    typeof deadlineWithTime === 'number' &&
    Number.isFinite(deadlineWithTime) &&
    deadlineWithTime > 0
  ) {
    isDeadlineToday = isTodayWithOffset(deadlineWithTime, todayStr, startOfNextDayDiffMs);
  }

  if (!isDeadlineToday) {
    return state;
  }

  // 2. Check if task is done or subtask whose parent is already in Today
  if (task.isDone) {
    return state;
  }
  const todayTag = getTag(state, TODAY_TAG.id);
  const parentTask = task.parentId
    ? (state[TASK_FEATURE_NAME].entities[task.parentId] as Task)
    : undefined;
  if (
    task.parentId &&
    (todayTag.taskIds.includes(task.parentId) ||
      (parentTask &&
        isTaskDueTodayBySchedule(parentTask, todayStr, startOfNextDayDiffMs)))
  ) {
    return state;
  }

  // 3. Apply scheduling policy for today deadline
  const isDueToday = isTaskDueTodayBySchedule(task, todayStr, startOfNextDayDiffMs);

  let shouldAutoPlan = false;
  let shouldClearTime = false;
  let shouldUpdateDueDay = false;

  if (isDueToday) {
    shouldAutoPlan = !todayTag.taskIds.includes(taskId);
  } else if (!task.dueDay && !hasDueWithTime(task)) {
    shouldAutoPlan = true;
    shouldUpdateDueDay = true;
  } else {
    let isOverdue = false;
    if (hasDueWithTime(task)) {
      const dueWithTimeDay = getDbDateStr(
        (task.dueWithTime as number) - startOfNextDayDiffMs,
      );
      isOverdue = dueWithTimeDay < todayStr;
    } else if (task.dueDay && task.dueDay < todayStr) {
      isOverdue = true;
    }

    if (isOverdue) {
      shouldAutoPlan = true;
      shouldClearTime = true;
      shouldUpdateDueDay = true;
    }
  }

  if (!shouldAutoPlan) {
    return state;
  }

  let updatedState = state;

  if (shouldUpdateDueDay || shouldClearTime) {
    updatedState = {
      ...updatedState,
      [TASK_FEATURE_NAME]: taskAdapter.updateOne(
        {
          id: taskId,
          changes: {
            ...(shouldUpdateDueDay ? { dueDay: todayStr } : {}),
            ...(shouldClearTime ? { dueWithTime: undefined } : {}),
            // Note: intentionally preserving remindAt to keep user intent
          },
        },
        updatedState[TASK_FEATURE_NAME],
      ),
    };

    if (shouldUpdateDueDay) {
      updatedState = removeTaskFromPlannerDays(updatedState, taskId);
    }
  }

  // Add to TODAY_TAG
  if (!getTag(updatedState, TODAY_TAG.id).taskIds.includes(taskId)) {
    updatedState = updateTags(updatedState, [
      {
        id: TODAY_TAG.id,
        changes: {
          taskIds: unique([taskId, ...getTag(updatedState, TODAY_TAG.id).taskIds]),
        },
      },
    ]);
  }

  return updatedState;
};

const handleSetDeadline = (
  state: RootState,
  taskId: string,
  deadlineDay?: string,
  deadlineWithTime?: number,
  deadlineRemindAt?: number,
  autoPlanToday?: string,
  autoPlanStartOfNextDayDiffMs?: number,
): RootState => {
  const currentTask = state[TASK_FEATURE_NAME].entities[taskId] as Task;
  if (!currentTask) return state;

  // Input validation
  if (deadlineDay && !isDBDateStr(deadlineDay)) {
    console.error('Invalid deadlineDay format:', deadlineDay);
    return state;
  }
  if (deadlineWithTime !== undefined && !Number.isFinite(deadlineWithTime)) {
    console.error('Invalid deadlineWithTime:', deadlineWithTime);
    return state;
  }
  if (deadlineRemindAt !== undefined && !Number.isFinite(deadlineRemindAt)) {
    console.error('Invalid deadlineRemindAt:', deadlineRemindAt);
    return state;
  }

  const updatedState = {
    ...state,
    [TASK_FEATURE_NAME]: taskAdapter.updateOne(
      {
        id: taskId,
        changes: {
          // Mutual exclusivity: deadlineDay and deadlineWithTime cannot coexist
          deadlineDay: deadlineWithTime ? undefined : deadlineDay,
          deadlineWithTime: deadlineDay ? undefined : deadlineWithTime,
          deadlineRemindAt,
        },
      },
      state[TASK_FEATURE_NAME],
    ),
  };

  return autoPlanTaskDueToDeadline(
    updatedState,
    taskId,
    deadlineDay,
    deadlineWithTime,
    autoPlanToday,
    autoPlanStartOfNextDayDiffMs,
  );
};

const handleRemoveDeadline = (state: RootState, taskId: string): RootState => {
  const currentTask = state[TASK_FEATURE_NAME].entities[taskId] as Task;
  if (!currentTask) return state;

  return {
    ...state,
    [TASK_FEATURE_NAME]: taskAdapter.updateOne(
      {
        id: taskId,
        changes: {
          deadlineDay: undefined,
          deadlineWithTime: undefined,
          deadlineRemindAt: undefined,
        },
      },
      state[TASK_FEATURE_NAME],
    ),
  };
};

const handleClearDeadlineReminder = (state: RootState, taskId: string): RootState => {
  const currentTask = state[TASK_FEATURE_NAME].entities[taskId] as Task;
  if (!currentTask) return state;

  return {
    ...state,
    [TASK_FEATURE_NAME]: taskAdapter.updateOne(
      {
        id: taskId,
        changes: {
          deadlineRemindAt: undefined,
        },
      },
      state[TASK_FEATURE_NAME],
    ),
  };
};

const handlePlanDeadlineTasksForToday = (
  state: RootState,
  taskIds: string[],
  today: string,
  startOfNextDayDiffMs: number,
): RootState =>
  [...taskIds]
    .sort((a, b) => {
      const taskA = state[TASK_FEATURE_NAME].entities[a] as Task | undefined;
      const taskB = state[TASK_FEATURE_NAME].entities[b] as Task | undefined;
      return Number(!!taskA?.parentId) - Number(!!taskB?.parentId);
    })
    .reduce((updatedState, taskId) => {
      const task = updatedState[TASK_FEATURE_NAME].entities[taskId] as Task | undefined;
      if (!task) return updatedState;

      return autoPlanTaskDueToDeadline(
        updatedState,
        taskId,
        task.deadlineDay || undefined,
        task.deadlineWithTime === null ? undefined : task.deadlineWithTime,
        today,
        startOfNextDayDiffMs,
      );
    }, state);

// =============================================================================
// META REDUCER
// =============================================================================

const createActionHandlers = (state: RootState, action: Action): ActionHandlerMap => ({
  [TaskSharedActions.addTask.type]: () => {
    const { task, autoPlanToday, autoPlanStartOfNextDayDiffMs } = action as ReturnType<
      typeof TaskSharedActions.addTask
    >;
    if (task.deadlineDay || task.deadlineWithTime !== undefined) {
      return autoPlanTaskDueToDeadline(
        state,
        task.id,
        task.deadlineDay || undefined,
        task.deadlineWithTime === null ? undefined : task.deadlineWithTime,
        autoPlanToday,
        autoPlanStartOfNextDayDiffMs,
      );
    }
    return state;
  },
  [TaskSharedActions.setDeadline.type]: () => {
    const {
      taskId,
      deadlineDay,
      deadlineWithTime,
      deadlineRemindAt,
      autoPlanToday,
      autoPlanStartOfNextDayDiffMs,
    } = action as ReturnType<typeof TaskSharedActions.setDeadline>;
    return handleSetDeadline(
      state,
      taskId,
      deadlineDay,
      deadlineWithTime,
      deadlineRemindAt,
      autoPlanToday,
      autoPlanStartOfNextDayDiffMs,
    );
  },
  [TaskSharedActions.removeDeadline.type]: () => {
    const { taskId } = action as ReturnType<typeof TaskSharedActions.removeDeadline>;
    return handleRemoveDeadline(state, taskId);
  },
  [TaskSharedActions.clearDeadlineReminder.type]: () => {
    const { taskId } = action as ReturnType<
      typeof TaskSharedActions.clearDeadlineReminder
    >;
    return handleClearDeadlineReminder(state, taskId);
  },
  [TaskSharedActions.planDeadlineTasksForToday.type]: () => {
    const { taskIds, today, startOfNextDayDiffMs } = action as ReturnType<
      typeof TaskSharedActions.planDeadlineTasksForToday
    >;
    return handlePlanDeadlineTasksForToday(state, taskIds, today, startOfNextDayDiffMs);
  },
});

export const taskSharedDeadlineMetaReducer: MetaReducer = (
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
