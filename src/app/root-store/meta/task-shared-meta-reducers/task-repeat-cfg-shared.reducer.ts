import { Action, ActionReducer, MetaReducer } from '@ngrx/store';
import { Update } from '@ngrx/entity';
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

const handleDeleteTaskRepeatCfg = (
  state: RootState,
  taskIdsToUnlink: string[],
): RootState => {
  const taskState = state[TASK_FEATURE_NAME];

  // Filter to only existing tasks in current state
  const existingTaskIds = taskIdsToUnlink.filter((id) => !!taskState.entities[id]);

  if (existingTaskIds.length === 0) {
    return state;
  }

  const taskUpdates: Update<Task>[] = existingTaskIds.map((id) => ({
    id,
    changes: { repeatCfgId: undefined },
  }));

  return {
    ...state,
    [TASK_FEATURE_NAME]: taskAdapter.updateMany(taskUpdates, taskState),
  };
};

// =============================================================================
// META REDUCER
// =============================================================================

const createActionHandlers = (state: RootState, action: Action): ActionHandlerMap => ({
  [TaskSharedActions.deleteTaskRepeatCfg.type]: () => {
    const { taskIdsToUnlink } = action as ReturnType<
      typeof TaskSharedActions.deleteTaskRepeatCfg
    >;
    return handleDeleteTaskRepeatCfg(state, taskIdsToUnlink);
  },
});

export const taskRepeatCfgSharedMetaReducer: MetaReducer = (
  reducer: ActionReducer<any, Action>,
) => {
  return (state: unknown, action: Action) => {
    if (!state) return reducer(state, action);

    const rootState = state as RootState;
    const actionHandlers = createActionHandlers(rootState, action);
    const handler = actionHandlers[action.type];
    const updatedState = handler ? handler(rootState) : rootState;

    return reducer(updatedState, action);
  };
};
