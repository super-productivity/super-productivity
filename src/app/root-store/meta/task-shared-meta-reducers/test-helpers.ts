import { Action, ActionReducer } from '@ngrx/store';
import { taskSharedCrudMetaReducer } from './task-shared-crud.reducer';
import { taskSharedLifecycleMetaReducer } from './task-shared-lifecycle.reducer';
import { taskSharedSchedulingMetaReducer } from './task-shared-scheduling.reducer';
import { projectSharedMetaReducer } from './project-shared.reducer';
import { tagSharedMetaReducer } from './tag-shared.reducer';
import { plannerSharedMetaReducer } from './planner-shared.reducer';
import { RootState } from '../../root-state';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { Task } from '../../../features/tasks/task.model';

/**
 * Combines all task-shared meta-reducers for testing purposes.
 * This simulates the behavior of the original monolithic taskSharedMetaReducer.
 */
export const createCombinedTaskSharedMetaReducer = (
  reducer: ActionReducer<any, Action>,
): ActionReducer<any, Action> => {
  // Apply meta-reducers in the same order as in main.ts
  let combinedReducer = reducer;
  combinedReducer = taskSharedCrudMetaReducer(combinedReducer);
  combinedReducer = taskSharedLifecycleMetaReducer(combinedReducer);
  combinedReducer = taskSharedSchedulingMetaReducer(combinedReducer);
  combinedReducer = projectSharedMetaReducer(combinedReducer);
  combinedReducer = tagSharedMetaReducer(combinedReducer);
  combinedReducer = plannerSharedMetaReducer(combinedReducer);
  return combinedReducer;
};

/**
 * Updates a task entity in state with the given changes.
 * Useful for setting up test state where task entities need specific values.
 */
export const updateTaskEntity = (
  state: RootState,
  taskId: string,
  changes: Partial<Task>,
): RootState => ({
  ...state,
  [TASK_FEATURE_NAME]: {
    ...state[TASK_FEATURE_NAME],
    entities: {
      ...state[TASK_FEATURE_NAME].entities,
      [taskId]: {
        ...state[TASK_FEATURE_NAME].entities[taskId],
        ...changes,
      } as Task,
    },
  },
});
