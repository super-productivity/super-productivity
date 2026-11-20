import { Action, MetaReducer } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { RootState } from '../../root-state';
import { TaskSharedActions } from '../task-shared.actions';
import {
  TASK_FEATURE_NAME,
  taskAdapter,
} from '../../../features/tasks/store/task.reducer';
import { Task } from '../../../features/tasks/task.model';
import { ActionHandlerMap, createActionHandlerMetaReducer } from './task-shared-helpers';

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

export const taskRepeatCfgSharedMetaReducer: MetaReducer =
  createActionHandlerMetaReducer(createActionHandlers);
