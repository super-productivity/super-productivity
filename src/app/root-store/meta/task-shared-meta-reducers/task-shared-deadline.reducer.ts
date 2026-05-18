import { Action, ActionReducer, MetaReducer } from '@ngrx/store';
import { RootState } from '../../root-state';
import { TaskSharedActions } from '../task-shared.actions';
import {
  TASK_FEATURE_NAME,
  taskAdapter,
} from '../../../features/tasks/store/task.reducer';
import { Task } from '../../../features/tasks/task.model';
import { ActionHandlerMap } from './task-shared-helpers';
import { isDBDateStr } from '../../../util/get-db-date-str';
import { appStateFeatureKey } from '../../app-state/app-state.reducer';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { isTodayWithOffset } from '../../../util/is-today.util';
import { TODAY_TAG } from '../../../features/tag/tag.const';
import { getTag, updateTags, removeTaskFromPlannerDays } from './task-shared-helpers';
import { unique } from '../../../util/unique';

// =============================================================================
// ACTION HANDLERS
// =============================================================================

const autoPlanTaskDueToDeadline = (
  state: RootState,
  taskId: string,
  deadlineDay?: string,
  deadlineWithTime?: number,
): RootState => {
  const task = state[TASK_FEATURE_NAME].entities[taskId] as Task;
  if (!task) return state;

  // 1. Check if deadline is today
  const todayStr = state[appStateFeatureKey]?.todayStr ?? getDbDateStr();
  const startOfNextDayDiffMs = state[appStateFeatureKey]?.startOfNextDayDiffMs ?? 0;

  let isDeadlineToday = false;
  if (deadlineDay === todayStr) {
    isDeadlineToday = true;
  } else if (typeof deadlineWithTime === 'number') {
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
  if (task.parentId && todayTag.taskIds.includes(task.parentId)) {
    return state;
  }

  // 3. Apply scheduling policy for today deadline
  const isDueTodayStr = task.dueDay === todayStr;
  const isDueWithTimeToday =
    typeof task.dueWithTime === 'number' &&
    isTodayWithOffset(task.dueWithTime, todayStr, startOfNextDayDiffMs);

  let shouldAutoPlan = false;
  let shouldClearTime = false;
  let shouldUpdateDueDay = false;

  if (isDueTodayStr || isDueWithTimeToday) {
    shouldAutoPlan = !todayTag.taskIds.includes(taskId);
  } else if (!task.dueDay && typeof task.dueWithTime !== 'number') {
    shouldAutoPlan = true;
    shouldUpdateDueDay = true;
  } else {
    let isOverdue = false;
    if (task.dueDay && task.dueDay < todayStr) isOverdue = true;
    else if (typeof task.dueWithTime === 'number' && task.dueWithTime < Date.now()) {
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

  return autoPlanTaskDueToDeadline(updatedState, taskId, deadlineDay, deadlineWithTime);
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

// =============================================================================
// META REDUCER
// =============================================================================

const createActionHandlers = (state: RootState, action: Action): ActionHandlerMap => ({
  [TaskSharedActions.addTask.type]: () => {
    const { task } = action as ReturnType<typeof TaskSharedActions.addTask>;
    if (task.deadlineDay || task.deadlineWithTime !== undefined) {
      return autoPlanTaskDueToDeadline(
        state,
        task.id,
        task.deadlineDay || undefined,
        task.deadlineWithTime === null ? undefined : task.deadlineWithTime,
      );
    }
    return state;
  },
  [TaskSharedActions.setDeadline.type]: () => {
    const { taskId, deadlineDay, deadlineWithTime, deadlineRemindAt } =
      action as ReturnType<typeof TaskSharedActions.setDeadline>;
    return handleSetDeadline(
      state,
      taskId,
      deadlineDay,
      deadlineWithTime,
      deadlineRemindAt,
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
