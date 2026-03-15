import { Action, ActionReducer, MetaReducer } from '@ngrx/store';
import { RootState } from '../../root-state';
import { TaskSharedActions } from '../task-shared.actions';
import {
  TASK_FEATURE_NAME,
  taskAdapter,
} from '../../../features/tasks/store/task.reducer';
import { Task } from '../../../features/tasks/task.model';
import { ActionHandlerMap } from './task-shared-helpers';

// =============================================================================
// ACTION HANDLERS
// =============================================================================

const handleSetDeadline = (
  state: RootState,
  taskId: string,
  deadlineDay?: string,
  deadlineWithTime?: number,
  deadlineRemindAt?: number,
): RootState => {
  const currentTask = state[TASK_FEATURE_NAME].entities[taskId] as Task;
  if (!currentTask) return state;

  return {
    ...state,
    [TASK_FEATURE_NAME]: taskAdapter.updateOne(
      {
        id: taskId,
        changes: {
          // Mutual exclusivity: if deadlineWithTime is set, clear deadlineDay
          deadlineDay: deadlineWithTime ? undefined : deadlineDay,
          deadlineWithTime: deadlineDay ? undefined : deadlineWithTime,
          deadlineRemindAt,
        },
      },
      state[TASK_FEATURE_NAME],
    ),
  };
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

// =============================================================================
// META REDUCER
// =============================================================================

const createActionHandlers = (state: RootState, action: Action): ActionHandlerMap => ({
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
