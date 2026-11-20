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
import { UNLINKED_ISSUE_FIELDS } from '../../../features/tasks/task-issue-fields';

// =============================================================================
// ACTION HANDLERS
// =============================================================================

const handleDeleteIssueProvider = (
  state: RootState,
  issueProviderIds: string[],
  taskIdsToUnlink: string[],
): RootState => {
  const taskState = state[TASK_FEATURE_NAME];
  const providerIds = new Set(issueProviderIds);
  const idsToUnlink = new Set(taskIdsToUnlink);

  // Replay can see linked tasks that the originating client did not know about.
  for (const id of taskState.ids) {
    const task = taskState.entities[id];
    if (task?.issueProviderId && providerIds.has(task.issueProviderId)) {
      idsToUnlink.add(id);
    }
  }

  // A task listed by the origin may have been relinked before replay.
  const existingTaskIds = [...idsToUnlink].filter((id) => {
    const providerId = taskState.entities[id]?.issueProviderId;
    return !!providerId && providerIds.has(providerId);
  });

  if (existingTaskIds.length === 0) {
    return state;
  }

  const taskUpdates: Update<Task>[] = existingTaskIds.map((id) => ({
    id,
    changes: UNLINKED_ISSUE_FIELDS,
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
  [TaskSharedActions.deleteIssueProvider.type]: () => {
    const { issueProviderId, taskIdsToUnlink } = action as ReturnType<
      typeof TaskSharedActions.deleteIssueProvider
    >;
    return handleDeleteIssueProvider(state, [issueProviderId], taskIdsToUnlink);
  },
  [TaskSharedActions.deleteIssueProviders.type]: () => {
    const { ids, taskIdsToUnlink } = action as ReturnType<
      typeof TaskSharedActions.deleteIssueProviders
    >;
    return handleDeleteIssueProvider(state, ids, taskIdsToUnlink);
  },
});

export const issueProviderSharedMetaReducer: MetaReducer =
  createActionHandlerMetaReducer(createActionHandlers);
