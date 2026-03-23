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
import {
  deleteTag,
  deleteTags,
  updateTag,
} from '../../../features/tag/store/tag.actions';
import { OpLog } from '../../../core/log';
import { TASK_REPEAT_CFG_FEATURE_NAME } from '../../../features/task-repeat-cfg/store/task-repeat-cfg.selectors';
import {
  TaskRepeatCfg,
  TaskRepeatCfgState,
} from '../../../features/task-repeat-cfg/task-repeat-cfg.model';
import { adapter as taskRepeatCfgAdapter } from '../../../features/task-repeat-cfg/store/task-repeat-cfg.selectors';
import { TIME_TRACKING_FEATURE_KEY } from '../../../features/time-tracking/store/time-tracking.reducer';
import { TimeTrackingState } from '../../../features/time-tracking/time-tracking.model';
import {
  ISSUE_PROVIDER_FEATURE_KEY,
  adapter as issueProviderAdapter,
} from '../../../features/issue/store/issue-provider.reducer';
import { IssueProvider, IssueProviderState } from '../../../features/issue/issue.model';

/**
 * Extended state type that includes feature stores not in RootState.
 * Meta-reducers have access to ALL store state.
 */
interface ExtendedState extends RootState {
  [TASK_REPEAT_CFG_FEATURE_NAME]?: TaskRepeatCfgState;
  [ISSUE_PROVIDER_FEATURE_KEY]?: IssueProviderState;
}

// =============================================================================
// ACTION TRANSFORMERS
// =============================================================================

/**
 * Filters out taskIds that don't exist in the store from an updateTag action.
 *
 * During sync, a remote updateTag operation can carry taskIds referencing tasks
 * that were deleted locally. This happens when meta-reducer side effects (e.g.
 * deleteTask removing a task from a tag) don't generate their own TAG operations,
 * so no LWW conflict is detected and the stale updateTag is applied directly.
 *
 * Returns a cloned action with filtered taskIds, or null if no filtering needed.
 */
const filterMissingTaskIds = (
  state: RootState,
  action: ReturnType<typeof updateTag>,
): ReturnType<typeof updateTag> | null => {
  const changes = action.tag.changes;

  // Only check if taskIds are being updated
  if (!changes || !('taskIds' in changes) || !Array.isArray(changes.taskIds)) {
    return null;
  }

  const taskState = state[TASK_FEATURE_NAME];
  const existingTaskIds = new Set(taskState.ids as string[]);

  const filteredTaskIds = changes.taskIds.filter((taskId) => existingTaskIds.has(taskId));

  if (filteredTaskIds.length === changes.taskIds.length) {
    return null; // No filtering needed
  }

  const missingTaskIds = changes.taskIds.filter((taskId) => !existingTaskIds.has(taskId));
  OpLog.warn(
    'tagSharedMetaReducer: Filtered non-existent taskIds from updateTag action',
    {
      tagId: action.tag.id,
      missingTaskIds,
      totalTaskIds: changes.taskIds.length,
    },
  );

  // Clone the original action instead of recreating via the action creator.
  // This preserves meta.isRemote (needed for LOCAL_ACTIONS filtering) and
  // isSkipSnack, which would be lost if we called updateTag() again.
  return {
    ...action,
    tag: {
      ...action.tag,
      changes: {
        ...changes,
        taskIds: filteredTaskIds,
      },
    },
  } as ReturnType<typeof updateTag>;
};

// =============================================================================
// ACTION HANDLERS
// =============================================================================

/**
 * Removes tag references from all tasks.
 * Returns updated state and list of task IDs that became orphaned.
 */
const removeTagsFromTasks = (
  taskState: RootState[typeof TASK_FEATURE_NAME],
  tagIdsToRemove: string[],
): {
  updatedTaskState: RootState[typeof TASK_FEATURE_NAME];
  orphanedTaskIds: string[];
} => {
  const taskUpdates: Update<Task>[] = [];
  const orphanedTaskIds: string[] = [];
  // Use Set for O(1) lookups instead of O(n) array.includes()
  const tagIdsToRemoveSet = new Set(tagIdsToRemove);

  Object.values(taskState.entities).forEach((task) => {
    if (!task) return;

    if (task.tagIds && task.tagIds.some((id) => tagIdsToRemoveSet.has(id))) {
      const newTagIds = task.tagIds.filter((id) => !tagIdsToRemoveSet.has(id));
      taskUpdates.push({
        id: task.id,
        changes: { tagIds: newTagIds },
      });

      // Check if task becomes orphaned (no project, no tags, no parent)
      if (newTagIds.length === 0 && !task.projectId && !task.parentId) {
        orphanedTaskIds.push(task.id);
      }
    }
  });

  return {
    updatedTaskState: taskAdapter.updateMany(taskUpdates, taskState),
    orphanedTaskIds,
  };
};

/**
 * Removes orphaned tasks (tasks with no project, no tags, no parent).
 * Also removes subtasks of orphaned parent tasks.
 */
const removeOrphanedTasks = (
  taskState: RootState[typeof TASK_FEATURE_NAME],
  orphanedParentTaskIds: string[],
): RootState[typeof TASK_FEATURE_NAME] => {
  if (orphanedParentTaskIds.length === 0) return taskState;

  // Collect all task IDs to remove (parent tasks + their subtasks)
  const allTaskIdsToRemove: string[] = [];
  for (const parentId of orphanedParentTaskIds) {
    const parent = taskState.entities[parentId];
    if (parent) {
      allTaskIdsToRemove.push(parentId);
      if (parent.subTaskIds?.length) {
        allTaskIdsToRemove.push(...parent.subTaskIds);
      }
    }
  }

  return taskAdapter.removeMany(allTaskIdsToRemove, taskState);
};

/**
 * Cleans up task repeat configs when tags are deleted.
 * - Removes deleted tag references from configs
 * - Deletes configs that become orphaned (no tags and no project)
 */
const cleanupTaskRepeatCfgs = (
  taskRepeatCfgState: TaskRepeatCfgState | undefined,
  tagIdsToRemove: string[],
): TaskRepeatCfgState | undefined => {
  if (!taskRepeatCfgState) return taskRepeatCfgState;

  const cfgIdsToDelete: string[] = [];
  const cfgUpdates: Update<TaskRepeatCfg>[] = [];
  // Use Set for O(1) lookups instead of O(n) array.includes()
  const tagIdsToRemoveSet = new Set(tagIdsToRemove);

  Object.values(taskRepeatCfgState.entities).forEach((cfg) => {
    if (!cfg || !cfg.tagIds) return;

    const hasDeletedTag = cfg.tagIds.some((tagId) => tagIdsToRemoveSet.has(tagId));
    if (!hasDeletedTag) return;

    const remainingTagIds = cfg.tagIds.filter((tagId) => !tagIdsToRemoveSet.has(tagId));

    if (remainingTagIds.length === 0 && !cfg.projectId) {
      // Config becomes orphaned - delete it
      cfgIdsToDelete.push(cfg.id as string);
    } else {
      // Config still has tags or project - update to remove deleted tags
      cfgUpdates.push({
        id: cfg.id as string,
        changes: { tagIds: remainingTagIds },
      });
    }
  });

  let updatedState = taskRepeatCfgState;
  if (cfgUpdates.length > 0) {
    updatedState = taskRepeatCfgAdapter.updateMany(cfgUpdates, updatedState);
  }
  if (cfgIdsToDelete.length > 0) {
    updatedState = taskRepeatCfgAdapter.removeMany(cfgIdsToDelete, updatedState);
  }

  return updatedState;
};

/**
 * Removes deleted tags from time tracking state.
 * Only handles current state - archive cleanup must stay in effect (async).
 */
const cleanupTimeTrackingState = (
  timeTrackingState: TimeTrackingState | undefined,
  tagIdsToRemove: string[],
): TimeTrackingState | undefined => {
  if (!timeTrackingState) return timeTrackingState;

  const hasTagToRemove = tagIdsToRemove.some((tagId) => tagId in timeTrackingState.tag);
  if (!hasTagToRemove) return timeTrackingState;

  const newTag = { ...timeTrackingState.tag };
  for (const tagId of tagIdsToRemove) {
    delete newTag[tagId];
  }

  return {
    ...timeTrackingState,
    tag: newTag,
  };
};

/**
 * Removes deleted tags from issue provider defaultTagIds.
 */
const cleanupIssueProviders = (
  issueProviderState: IssueProviderState | undefined,
  tagIdsToRemove: string[],
): IssueProviderState | undefined => {
  if (!issueProviderState) return issueProviderState;

  const updates: Update<IssueProvider>[] = [];
  const tagIdsToRemoveSet = new Set(tagIdsToRemove);

  Object.values(issueProviderState.entities).forEach((provider) => {
    if (!provider?.defaultTagIds?.length) return;

    const hasDeletedTag = provider.defaultTagIds.some((tagId) =>
      tagIdsToRemoveSet.has(tagId),
    );
    if (!hasDeletedTag) return;

    updates.push({
      id: provider.id,
      changes: {
        defaultTagIds: provider.defaultTagIds.filter(
          (tagId) => !tagIdsToRemoveSet.has(tagId),
        ),
      },
    });
  });

  if (updates.length === 0) return issueProviderState;
  return issueProviderAdapter.updateMany(updates, issueProviderState);
};

/**
 * Comprehensive handler for tag deletion.
 * Atomically handles all related cleanup in a single reducer pass.
 */
const handleTagDeletion = (
  state: ExtendedState,
  tagIdsToRemove: string[],
): ExtendedState => {
  // 1. Remove tags from tasks and identify orphaned tasks
  const { updatedTaskState, orphanedTaskIds } = removeTagsFromTasks(
    state[TASK_FEATURE_NAME],
    tagIdsToRemove,
  );

  // 2. Remove orphaned tasks (and their subtasks)
  const finalTaskState = removeOrphanedTasks(updatedTaskState, orphanedTaskIds);

  // 3. Cleanup task repeat configs
  const updatedTaskRepeatCfgState = cleanupTaskRepeatCfgs(
    state[TASK_REPEAT_CFG_FEATURE_NAME],
    tagIdsToRemove,
  );

  // 4. Cleanup time tracking state (current only, not archives)
  const updatedTimeTrackingState = cleanupTimeTrackingState(
    state[TIME_TRACKING_FEATURE_KEY],
    tagIdsToRemove,
  );

  // 5. Cleanup issue provider defaultTagIds
  const updatedIssueProviderState = cleanupIssueProviders(
    state[ISSUE_PROVIDER_FEATURE_KEY],
    tagIdsToRemove,
  );

  if (orphanedTaskIds.length > 0) {
    OpLog.log('tagSharedMetaReducer: Removed orphaned tasks during tag deletion', {
      orphanedTaskIds,
      tagIdsToRemove,
    });
  }

  return {
    ...state,
    [TASK_FEATURE_NAME]: finalTaskState,
    ...(updatedTaskRepeatCfgState && {
      [TASK_REPEAT_CFG_FEATURE_NAME]: updatedTaskRepeatCfgState,
    }),
    ...(updatedTimeTrackingState && {
      [TIME_TRACKING_FEATURE_KEY]: updatedTimeTrackingState,
    }),
    ...(updatedIssueProviderState && {
      [ISSUE_PROVIDER_FEATURE_KEY]: updatedIssueProviderState,
    }),
  };
};

/**
 * Legacy handler for removeTagsForAllTasks action.
 * Only removes tag references from tasks (no orphan cleanup).
 */
const handleRemoveTagsForAllTasks = (
  state: RootState,
  tagIdsToRemove: string[],
): RootState => {
  const { updatedTaskState } = removeTagsFromTasks(
    state[TASK_FEATURE_NAME],
    tagIdsToRemove,
  );

  return {
    ...state,
    [TASK_FEATURE_NAME]: updatedTaskState,
  };
};

// =============================================================================
// META REDUCER
// =============================================================================

const createActionHandlers = (
  state: ExtendedState,
  action: Action,
): ActionHandlerMap => ({
  [TaskSharedActions.removeTagsForAllTasks.type]: () => {
    const { tagIdsToRemove } = action as ReturnType<
      typeof TaskSharedActions.removeTagsForAllTasks
    >;
    return handleRemoveTagsForAllTasks(state, tagIdsToRemove);
  },
  // Handle deleteTag atomically - comprehensive cleanup including:
  // - Remove tag references from tasks
  // - Delete orphaned tasks (no project, no tags, no parent)
  // - Clean up task repeat configs
  // - Clean up time tracking state (current only, not archives)
  [deleteTag.type]: () => {
    const { id } = action as ReturnType<typeof deleteTag>;
    return handleTagDeletion(state, [id]);
  },
  // Handle deleteTags atomically - same comprehensive cleanup as deleteTag
  [deleteTags.type]: () => {
    const { ids } = action as ReturnType<typeof deleteTags>;
    return handleTagDeletion(state, ids);
  },
});

export const tagSharedMetaReducer: MetaReducer = (
  reducer: ActionReducer<any, Action>,
) => {
  return (state: unknown, action: Action) => {
    if (!state) return reducer(state, action);

    const extendedState = state as ExtendedState;

    // Filter non-existent taskIds from updateTag actions
    let effectiveAction = action;
    if (action.type === updateTag.type) {
      const filteredAction = filterMissingTaskIds(
        extendedState,
        action as ReturnType<typeof updateTag>,
      );
      if (filteredAction) {
        effectiveAction = filteredAction;
      }
    }

    const actionHandlers = createActionHandlers(extendedState, effectiveAction);
    const handler = actionHandlers[effectiveAction.type];
    const updatedState = handler ? handler(extendedState) : extendedState;

    return reducer(updatedState, effectiveAction);
  };
};
