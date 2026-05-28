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
import { TODAY_TAG } from '../../../features/tag/tag.const';
import { getTag, updateTags, removeTaskFromPlannerDays } from './task-shared-helpers';
import { unique } from '../../../util/unique';
import { getDeadlineAutoPlanDecision } from '../../../features/tasks/util/get-deadline-auto-plan-fields';
import type { DeadlineAutoPlanContext } from '../../../features/tasks/util/get-deadline-auto-plan-fields';

// =============================================================================
// ACTION HANDLERS
// =============================================================================

const getAutoPlanContext = (
  today?: string,
  startOfNextDayDiffMs?: number,
): DeadlineAutoPlanContext | undefined =>
  today && isDBDateStr(today) && Number.isFinite(startOfNextDayDiffMs)
    ? { today, startOfNextDayDiffMs: startOfNextDayDiffMs as number }
    : undefined;

const autoPlanTaskDueToDeadline = (
  state: RootState,
  taskId: string,
  context?: DeadlineAutoPlanContext,
): RootState => {
  if (!context) return state;

  const task = state[TASK_FEATURE_NAME].entities[taskId] as Task;
  if (!task) return state;

  const todayTag = getTag(state, TODAY_TAG.id);
  const parentTask = task.parentId
    ? (state[TASK_FEATURE_NAME].entities[task.parentId] as Task | undefined)
    : undefined;
  const decision = getDeadlineAutoPlanDecision(
    task,
    context,
    new Set(todayTag.taskIds),
    parentTask,
  );

  if (!decision.shouldAutoPlan) {
    return state;
  }

  let updatedState = state;

  if (
    decision.shouldUpdateDueDay ||
    decision.shouldClearDueWithTime ||
    decision.shouldClearRemindAt
  ) {
    updatedState = {
      ...updatedState,
      [TASK_FEATURE_NAME]: taskAdapter.updateOne(
        {
          id: taskId,
          changes: {
            ...(decision.shouldUpdateDueDay ? { dueDay: context.today } : {}),
            ...(decision.shouldClearDueWithTime ? { dueWithTime: undefined } : {}),
            ...(decision.shouldClearRemindAt ? { remindAt: undefined } : {}),
          },
        },
        updatedState[TASK_FEATURE_NAME],
      ),
    };

    if (decision.shouldUpdateDueDay) {
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
    getAutoPlanContext(autoPlanToday, autoPlanStartOfNextDayDiffMs),
  );
};

const sortTaskIdsForDeadlinePlanning = (
  state: RootState,
  taskIds: readonly string[],
): string[] =>
  [...taskIds].sort((a, b) => {
    const taskA = state[TASK_FEATURE_NAME].entities[a] as Task | undefined;
    const taskB = state[TASK_FEATURE_NAME].entities[b] as Task | undefined;
    return Number(!!taskA?.parentId) - Number(!!taskB?.parentId);
  });

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
    const { task, autoPlanToday, autoPlanStartOfNextDayDiffMs } = action as ReturnType<
      typeof TaskSharedActions.addTask
    >;
    if (task.deadlineDay || task.deadlineWithTime !== undefined) {
      return autoPlanTaskDueToDeadline(
        state,
        task.id,
        getAutoPlanContext(autoPlanToday, autoPlanStartOfNextDayDiffMs),
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
  [TaskSharedActions.planDeadlineTasksForToday.type]: () => {
    const { taskIds, today, startOfNextDayDiffMs } = action as ReturnType<
      typeof TaskSharedActions.planDeadlineTasksForToday
    >;
    const context = getAutoPlanContext(today, startOfNextDayDiffMs);
    return sortTaskIdsForDeadlinePlanning(state, taskIds).reduce(
      (updatedState, taskId) => autoPlanTaskDueToDeadline(updatedState, taskId, context),
      state,
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
