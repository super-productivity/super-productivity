import { Action, ActionReducer, MetaReducer } from '@ngrx/store';
import { EntityAdapter } from '@ngrx/entity';
import { RootState } from '../../root-state';
import {
  getEntityConfig,
  isAdapterEntity,
  isSingletonEntity,
} from '../../../op-log/core/entity-registry';
import { getLwwEntityType } from '../../../op-log/core/lww-update-action-types';
import { devError } from '../../../util/dev-error';
import {
  PROJECT_FEATURE_NAME,
  projectAdapter,
} from '../../../features/project/store/project.reducer';
import { Project } from '../../../features/project/project.model';
import { TAG_FEATURE_NAME, tagAdapter } from '../../../features/tag/store/tag.reducer';
import { Tag } from '../../../features/tag/tag.model';
import { TODAY_TAG } from '../../../features/tag/tag.const';
import {
  TASK_FEATURE_NAME,
  taskAdapter,
} from '../../../features/tasks/store/task.reducer';
import { Task } from '../../../features/tasks/task.model';
import { unique } from '../../../util/unique';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { OpLog } from '../../../core/log';

/**
 * Updates project.taskIds arrays when a task's projectId changes via LWW Update.
 *
 * When LWW conflict resolution updates a task's projectId, we must also update
 * the corresponding project.taskIds arrays to maintain bidirectional consistency:
 * - Remove task from old project's taskIds (if it exists there)
 * - Add task to new project's taskIds (if not already there)
 *
 * This is necessary because the original moveToOtherProject action updates both
 * the task and project entities atomically, but LWW Update only syncs the TASK
 * entity state.
 */
const syncProjectTaskIds = (
  state: RootState,
  taskId: string,
  oldProjectId: string | undefined,
  newProjectId: string | undefined,
  isSubTask: boolean,
): RootState => {
  // Don't add subtasks to project.taskIds - only parent tasks should be there
  if (isSubTask) {
    return state;
  }

  // If projectId didn't change, nothing to do
  if (oldProjectId === newProjectId) {
    return state;
  }

  let projectState = state[PROJECT_FEATURE_NAME];

  // Remove from old project's taskIds
  if (oldProjectId && projectState.entities[oldProjectId]) {
    const oldProject = projectState.entities[oldProjectId] as Project;
    const filteredTaskIds = oldProject.taskIds.filter((id) => id !== taskId);
    const filteredBacklogTaskIds = oldProject.backlogTaskIds.filter(
      (id) => id !== taskId,
    );

    // Only update if the task was actually in the list
    if (
      filteredTaskIds.length !== oldProject.taskIds.length ||
      filteredBacklogTaskIds.length !== oldProject.backlogTaskIds.length
    ) {
      projectState = projectAdapter.updateOne(
        {
          id: oldProjectId,
          changes: {
            taskIds: filteredTaskIds,
            backlogTaskIds: filteredBacklogTaskIds,
          },
        },
        projectState,
      );
    }
  } else if (oldProjectId) {
    // Old project was deleted before LWW update arrived - benign race condition
    OpLog.warn(
      `lwwUpdateMetaReducer: syncProjectTaskIds: old project ${oldProjectId} not found for task ${taskId}`,
    );
  }

  // Add to new project's taskIds
  if (newProjectId && projectState.entities[newProjectId]) {
    const newProject = projectState.entities[newProjectId] as Project;
    // Only add if not already present
    if (!newProject.taskIds.includes(taskId)) {
      projectState = projectAdapter.updateOne(
        {
          id: newProjectId,
          changes: {
            taskIds: unique([...newProject.taskIds, taskId]),
          },
        },
        projectState,
      );
    }
  } else if (newProjectId) {
    // New project was deleted before LWW update arrived - benign race condition
    OpLog.warn(
      `lwwUpdateMetaReducer: syncProjectTaskIds: new project ${newProjectId} not found for task ${taskId}`,
    );
  }

  return {
    ...state,
    [PROJECT_FEATURE_NAME]: projectState,
  };
};

/**
 * Updates tag.taskIds arrays when a task's tagIds changes via LWW Update.
 *
 * When LWW conflict resolution updates a task's tagIds, we must also update
 * the corresponding tag.taskIds arrays to maintain bidirectional consistency:
 * - Remove task from tags that were removed from the task's tagIds
 * - Add task to tags that were added to the task's tagIds
 *
 * This is necessary because the original updateTags action updates both
 * the task and tag entities atomically, but LWW Update only syncs the TASK
 * entity state.
 */
const syncTagTaskIds = (
  state: RootState,
  taskId: string,
  oldTagIds: string[],
  newTagIds: string[],
): RootState => {
  // Find tags that were removed and added
  const oldTagSet = new Set(oldTagIds);
  const newTagSet = new Set(newTagIds);

  const removedTags = oldTagIds.filter((id) => !newTagSet.has(id));
  const addedTags = newTagIds.filter((id) => !oldTagSet.has(id));

  // If no changes, nothing to do
  if (removedTags.length === 0 && addedTags.length === 0) {
    return state;
  }

  let tagState = state[TAG_FEATURE_NAME];

  // Remove task from removed tags' taskIds
  for (const tagId of removedTags) {
    if (tagState.entities[tagId]) {
      const tag = tagState.entities[tagId] as Tag;
      if (tag.taskIds.includes(taskId)) {
        tagState = tagAdapter.updateOne(
          {
            id: tagId,
            changes: {
              taskIds: tag.taskIds.filter((id) => id !== taskId),
            },
          },
          tagState,
        );
      }
    } else {
      // Tag was deleted before LWW update arrived - benign race condition
      OpLog.warn(
        `lwwUpdateMetaReducer: syncTagTaskIds: removed tag ${tagId} not found for task ${taskId}`,
      );
    }
  }

  // Add task to added tags' taskIds
  for (const tagId of addedTags) {
    if (tagState.entities[tagId]) {
      const tag = tagState.entities[tagId] as Tag;
      if (!tag.taskIds.includes(taskId)) {
        tagState = tagAdapter.updateOne(
          {
            id: tagId,
            changes: {
              taskIds: unique([...tag.taskIds, taskId]),
            },
          },
          tagState,
        );
      }
    } else {
      // Tag was deleted before LWW update arrived - benign race condition
      OpLog.warn(
        `lwwUpdateMetaReducer: syncTagTaskIds: added tag ${tagId} not found for task ${taskId}`,
      );
    }
  }

  return {
    ...state,
    [TAG_FEATURE_NAME]: tagState,
  };
};

/**
 * Updates TODAY_TAG.taskIds when a task's dueDay changes via LWW Update.
 *
 * TODAY_TAG is a virtual tag where membership is determined by task.dueDay,
 * not by task.tagIds. When LWW Update recreates a task or changes its dueDay,
 * we must update TODAY_TAG.taskIds accordingly.
 *
 * See: docs/ai/today-tag-architecture.md
 */
const syncTodayTagTaskIds = (
  state: RootState,
  taskId: string,
  oldDueDay: string | undefined,
  newDueDay: string | undefined,
): RootState => {
  const todayStr = getDbDateStr();
  const wasToday = oldDueDay === todayStr;
  const isNowToday = newDueDay === todayStr;

  // No change in TODAY membership
  if (wasToday === isNowToday) {
    return state;
  }

  let tagState = state[TAG_FEATURE_NAME];
  const todayTag = tagState.entities[TODAY_TAG.id] as Tag | undefined;

  if (!todayTag) {
    // TODAY_TAG doesn't exist yet (shouldn't happen in normal operation)
    return state;
  }

  if (!wasToday && isNowToday) {
    // Task moved to today (or recreated with dueDay = today)
    if (!todayTag.taskIds.includes(taskId)) {
      tagState = tagAdapter.updateOne(
        {
          id: TODAY_TAG.id,
          changes: {
            taskIds: unique([...todayTag.taskIds, taskId]),
          },
        },
        tagState,
      );
    }
  } else if (wasToday && !isNowToday) {
    // Task moved away from today
    if (todayTag.taskIds.includes(taskId)) {
      tagState = tagAdapter.updateOne(
        {
          id: TODAY_TAG.id,
          changes: {
            taskIds: todayTag.taskIds.filter((id) => id !== taskId),
          },
        },
        tagState,
      );
    }
  }

  return {
    ...state,
    [TAG_FEATURE_NAME]: tagState,
  };
};

/**
 * Updates parent task's subTaskIds arrays when a task's parentId changes via LWW Update.
 *
 * When LWW conflict resolution updates a task's parentId (making it a subtask or
 * moving it to a different parent), we must also update the corresponding parent
 * task's subTaskIds arrays to maintain bidirectional consistency:
 * - Remove task from old parent's subTaskIds (if it was a subtask)
 * - Add task to new parent's subTaskIds (if it becomes a subtask)
 *
 * This is necessary because the original moveToOtherProject or convertToSubtask
 * actions update both the task and parent entities atomically, but LWW Update
 * only syncs the TASK entity state.
 */
const syncParentSubTaskIds = (
  state: RootState,
  taskId: string,
  oldParentId: string | undefined,
  newParentId: string | undefined,
): RootState => {
  // If parentId didn't change, nothing to do
  if (oldParentId === newParentId) {
    return state;
  }

  let taskState = state[TASK_FEATURE_NAME];

  // Remove from old parent's subTaskIds
  if (oldParentId && taskState.entities[oldParentId]) {
    const oldParent = taskState.entities[oldParentId] as Task;
    if (oldParent.subTaskIds.includes(taskId)) {
      taskState = taskAdapter.updateOne(
        {
          id: oldParentId,
          changes: {
            subTaskIds: oldParent.subTaskIds.filter((id) => id !== taskId),
          },
        },
        taskState,
      );
    }
  } else if (oldParentId) {
    // Old parent was deleted before LWW update arrived - benign race condition
    OpLog.warn(
      `lwwUpdateMetaReducer: syncParentSubTaskIds: old parent ${oldParentId} not found for task ${taskId}`,
    );
  }

  // Add to new parent's subTaskIds
  if (newParentId && taskState.entities[newParentId]) {
    const newParent = taskState.entities[newParentId] as Task;
    // Only add if not already present
    if (!newParent.subTaskIds.includes(taskId)) {
      taskState = taskAdapter.updateOne(
        {
          id: newParentId,
          changes: {
            subTaskIds: unique([...newParent.subTaskIds, taskId]),
          },
        },
        taskState,
      );
    }
  } else if (newParentId) {
    // New parent was deleted before LWW update arrived - benign race condition
    OpLog.warn(
      `lwwUpdateMetaReducer: syncParentSubTaskIds: new parent ${newParentId} not found for task ${taskId}`,
    );
  }

  return {
    ...state,
    [TASK_FEATURE_NAME]: taskState,
  };
};

/**
 * Meta-reducer that handles LWW (Last-Write-Wins) Update actions.
 *
 * When a LWW conflict is resolved and local state wins, a `[ENTITY_TYPE] LWW Update`
 * operation is created and synced to other clients. This meta-reducer applies those
 * operations by REPLACING the entire entity with the winning state.
 *
 * Unlike regular update actions that merge changes, LWW Update replaces the entity
 * entirely because it represents the "winning" state after conflict resolution.
 *
 * The action payload has entity fields spread at the top level:
 * ```
 * {
 *   type: '[TASK] LWW Update',
 *   id: 'xxx',
 *   title: 'Winning title',
 *   ... other entity fields
 *   meta: { isPersistent: true, ... }
 * }
 * ```
 */
export const lwwUpdateMetaReducer: MetaReducer = (
  reducer: ActionReducer<any, Action>,
) => {
  return (state: unknown, action: Action) => {
    if (!state) return reducer(state, action);

    const entityType = getLwwEntityType(action.type);
    if (!entityType) {
      // Not an LWW Update action, pass through
      return reducer(state, action);
    }
    const config = getEntityConfig(entityType);

    if (!config) {
      OpLog.warn(`lwwUpdateMetaReducer: Unknown entity type: ${entityType}`);
      devError(`lwwUpdateMetaReducer: Unknown entity type: ${entityType}`);
      return reducer(state, action);
    }

    const { featureName } = config;
    if (!featureName) {
      OpLog.warn(`lwwUpdateMetaReducer: Missing featureName for: ${entityType}`);
      devError(`lwwUpdateMetaReducer: Missing featureName for: ${entityType}`);
      return reducer(state, action);
    }

    const rootState = state as RootState;
    const featureState = rootState[featureName as keyof RootState];

    if (!featureState) {
      OpLog.warn(`lwwUpdateMetaReducer: Feature state not found: ${featureName}`);
      devError(`lwwUpdateMetaReducer: Feature state not found: ${featureName}`);
      return reducer(state, action);
    }

    // Extract entity data from action (exclude 'type' and 'meta').
    // NOTE: This assumes no entity state has top-level 'type' or 'meta' keys.
    // If a singleton or adapter state gains such a key, it would be silently dropped.
    const actionAny = action as unknown as Record<string, unknown>;
    const entityData: Record<string, unknown> = {};
    for (const key of Object.keys(actionAny)) {
      if (key !== 'type' && key !== 'meta') {
        entityData[key] = actionAny[key];
      }
    }

    // Singleton entities: replace entire feature state with the winning data
    if (isSingletonEntity(config)) {
      if (Object.keys(entityData).length === 0) {
        OpLog.warn(`lwwUpdateMetaReducer: Empty singleton data for: ${entityType}`);
        devError(`lwwUpdateMetaReducer: Empty singleton data for: ${entityType}`);
        return reducer(state, action);
      }
      const updatedState: RootState = {
        ...rootState,
        [featureName]: { ...entityData },
      };
      return reducer(updatedState, action);
    }

    if (!isAdapterEntity(config)) {
      OpLog.warn(`lwwUpdateMetaReducer: Unsupported storage pattern for: ${entityType}`);
      devError(`lwwUpdateMetaReducer: Unsupported storage pattern for: ${entityType}`);
      return reducer(state, action);
    }

    const { adapter } = config;
    if (!adapter) {
      OpLog.warn(`lwwUpdateMetaReducer: Missing adapter for: ${entityType}`);
      devError(`lwwUpdateMetaReducer: Missing adapter for: ${entityType}`);
      return reducer(state, action);
    }

    if (!entityData['id']) {
      OpLog.warn('lwwUpdateMetaReducer: Entity data has no id');
      return reducer(state, action);
    }

    const entityId = entityData['id'] as string;
    const existingEntity = (featureState as any).entities?.[entityId];

    let updatedFeatureState;

    if (!existingEntity) {
      // Entity was deleted locally but UPDATE won via LWW.
      // This means another client's update beat our delete, so we need to
      // recreate the entity with the winning state.
      OpLog.log(
        `lwwUpdateMetaReducer: Entity ${entityType}:${entityId} not found, recreating from LWW update`,
      );
      updatedFeatureState = (adapter as EntityAdapter<any>).addOne(
        {
          ...entityData,
          // INTENTIONAL: We set modified to Date.now() (local time), not the original timestamp.
          // Rationale:
          // - Vector clocks are the authoritative conflict resolution mechanism, not `modified`
          // - The `modified` field is used for UI display ("last edited X minutes ago")
          // - Setting it to local time reflects when THIS client applied the winning state
          // - The original timestamp from the winning client is preserved in entityData but
          //   gets overwritten here because local display should show local application time
          modified: Date.now(),
        } as any,
        featureState as any,
      );
    } else {
      // Entity exists - replace it entirely with the LWW winning state
      // Use updateOne with all fields as changes to preserve adapter behavior
      updatedFeatureState = (adapter as EntityAdapter<any>).updateOne(
        {
          id: entityId,
          changes: {
            ...entityData,
            // INTENTIONAL: We set modified to Date.now() (local time), not the original timestamp.
            // See comment above for rationale - vector clocks drive conflict resolution,
            // `modified` is for UI display of "when this client last saw this change"
            modified: Date.now(),
          },
        },
        featureState as any,
      );
    }

    let updatedState: RootState = {
      ...rootState,
      [featureName]: updatedFeatureState,
    };

    // For TASK entities, sync related entities when relationships change
    if (entityType === 'TASK') {
      // Sync project.taskIds when projectId changes
      const oldProjectId = existingEntity?.projectId as string | undefined;
      const newProjectId = entityData['projectId'] as string | undefined;
      const isSubTask = !!(entityData['parentId'] || existingEntity?.parentId);

      updatedState = syncProjectTaskIds(
        updatedState,
        entityId,
        oldProjectId,
        newProjectId,
        isSubTask,
      );

      // Sync tag.taskIds when tagIds changes
      const oldTagIds = (existingEntity?.tagIds as string[]) || [];
      const newTagIds = (entityData['tagIds'] as string[]) || [];

      updatedState = syncTagTaskIds(updatedState, entityId, oldTagIds, newTagIds);

      // Sync TODAY_TAG.taskIds when dueDay changes (virtual tag based on dueDay)
      const oldDueDay = existingEntity?.dueDay as string | undefined;
      const newDueDay = entityData['dueDay'] as string | undefined;
      updatedState = syncTodayTagTaskIds(updatedState, entityId, oldDueDay, newDueDay);

      // Sync parent.subTaskIds when parentId changes
      const oldParentId = existingEntity?.parentId as string | undefined;
      const newParentId = entityData['parentId'] as string | undefined;
      updatedState = syncParentSubTaskIds(
        updatedState,
        entityId,
        oldParentId,
        newParentId,
      );
    }

    return reducer(updatedState, action);
  };
};
