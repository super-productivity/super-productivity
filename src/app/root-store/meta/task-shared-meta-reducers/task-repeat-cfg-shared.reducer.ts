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

const handleDeleteTaskRepeatCfg = (state: RootState, repeatCfgId: string): RootState => {
  const taskState = state[TASK_FEATURE_NAME];

  // Scan local state for ALL tasks with this repeatCfgId
  const taskIdsToUnlink = Object.values(taskState.entities)
    .filter((task): task is Task => !!task && task.repeatCfgId === repeatCfgId)
    .map((task) => task.id);

  if (taskIdsToUnlink.length === 0) {
    return state;
  }

  // Clear repeatCfgId from all found tasks
  const taskUpdates: Update<Task>[] = taskIdsToUnlink.map((id) => ({
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
    const { taskRepeatCfgId } = action as ReturnType<
      typeof TaskSharedActions.deleteTaskRepeatCfg
    >;
    return handleDeleteTaskRepeatCfg(state, taskRepeatCfgId);
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
