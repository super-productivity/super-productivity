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
import { INBOX_PROJECT } from '../../../features/project/project.const';
import { RECREATE_FALLBACK } from '../../../op-log/core/recreate-fallback.const';
import { OpLog } from '../../../core/log';
import { filterTaskIdArraysFromTagOrProjectPayload } from '../../../op-log/apply/bulk-archive-filter.util';
import { appStateFeatureKey } from '../../app-state/app-state.reducer';
import { getDbDateStr, isDBDateStr } from '../../../util/get-db-date-str';
import { isTodayWithOffset } from '../../../util/is-today.util';
import { getProjectOrUndefined, repairTaskProjectForLww } from './task-shared-helpers';
import { withLocalOnlySyncSettings } from '../../../features/config/local-only-sync-settings.util';
import { SyncConfig } from '../../../features/config/global-config.model';
import { LwwUpdateMode } from '../../../op-log/core/operation.types';

/**
 * Updates project.taskIds arrays when a task's project membership changes via LWW Update.
 *
 * When LWW conflict resolution updates a task's projectId or parentId, we must
 * also update the corresponding project.taskIds arrays to maintain consistency:
 * - Remove task from old project's taskIds if it moved away or became a subtask
 * - Add task to new project's taskIds if it is now a root task
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
  oldIsSubTask: boolean,
  newIsSubTask: boolean,
): RootState => {
  let projectState = state[PROJECT_FEATURE_NAME];
  const shouldRemoveFromOldProject =
    !!oldProjectId && (oldProjectId !== newProjectId || newIsSubTask);
  const shouldAddToNewProject =
    !!newProjectId && !newIsSubTask && (oldProjectId !== newProjectId || oldIsSubTask);

  // Remove from old project's taskIds. The id equality check rejects
  // inherited Object.prototype members that a bare entities[id] lookup
  // returns truthy for when the id originates from a remote op.
  const oldProjectCandidate = oldProjectId
    ? (projectState.entities[oldProjectId] as Project | undefined)
    : undefined;
  const oldProject =
    oldProjectCandidate?.id === oldProjectId ? oldProjectCandidate : undefined;

  if (shouldRemoveFromOldProject && oldProjectId && oldProject) {
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
  } else if (shouldRemoveFromOldProject && oldProjectId) {
    // Old project was deleted before LWW update arrived - benign race condition
    OpLog.warn(
      `lwwUpdateMetaReducer: syncProjectTaskIds: old project ${oldProjectId} not found for task ${taskId}`,
    );
  }

  // Add to the new project's taskIds. Archived projects remain valid owners:
  // the archive operation can race with this task update during replay.
  const newProjectCandidate = newProjectId
    ? (projectState.entities[newProjectId] as Project | undefined)
    : undefined;
  const newProject =
    newProjectCandidate && newProjectCandidate.id === newProjectId
      ? newProjectCandidate
      : undefined;

  if (shouldAddToNewProject && newProjectId && newProject) {
    // Only add if not already present
    if (!newProject.taskIds.includes(taskId)) {
      projectState = projectAdapter.updateOne(
        {
          id: newProjectId,
          changes: {
            taskIds: [...newProject.taskIds, taskId],
          },
        },
        projectState,
      );
    }
  } else if (shouldAddToNewProject && newProjectId) {
    // New project was deleted before LWW update arrived - benign race condition
    OpLog.warn(
      `lwwUpdateMetaReducer: syncProjectTaskIds: new project ${newProjectId} not found for task ${taskId}`,
    );
  }

  return projectState === state[PROJECT_FEATURE_NAME]
    ? state
    : {
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
    const tagCandidate = tagState.entities[tagId] as Tag | undefined;
    const tag = tagCandidate?.id === tagId ? tagCandidate : undefined;
    if (tag) {
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
    const tagCandidate = tagState.entities[tagId] as Tag | undefined;
    const tag = tagCandidate?.id === tagId ? tagCandidate : undefined;
    if (tag) {
      if (!tag.taskIds.includes(taskId)) {
        tagState = tagAdapter.updateOne(
          {
            id: tagId,
            changes: {
              taskIds: [...tag.taskIds, taskId],
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
 * Updates TODAY_TAG.taskIds when a task's dueDay or dueWithTime changes via LWW Update.
 *
 * TODAY_TAG is a virtual tag where membership is determined by task.dueDay OR
 * task.dueWithTime (mutually exclusive). When LWW Update recreates a task or
 * changes either field, we must update TODAY_TAG.taskIds accordingly.
 *
 * See: docs/ai/today-tag-architecture.md
 */
const syncTodayTagTaskIds = (
  state: RootState,
  taskId: string,
  oldDueDay: string | undefined,
  newDueDay: string | undefined,
  oldDueWithTime: number | undefined,
  newDueWithTime: number | undefined,
): RootState => {
  const todayStr = state[appStateFeatureKey]?.todayStr ?? getDbDateStr();
  const offsetMs = state[appStateFeatureKey]?.startOfNextDayDiffMs ?? 0;

  const isDueToday = (
    dueDay: string | undefined,
    dueWithTime: number | undefined,
  ): boolean =>
    dueDay === todayStr ||
    (!!dueWithTime && isTodayWithOffset(dueWithTime, todayStr, offsetMs));

  const wasToday = isDueToday(oldDueDay, oldDueWithTime);
  const isNowToday = isDueToday(newDueDay, newDueWithTime);

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
            taskIds: [...todayTag.taskIds, taskId],
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
  const oldParentCandidate = oldParentId
    ? (taskState.entities[oldParentId] as Task | undefined)
    : undefined;
  const oldParent =
    oldParentCandidate?.id === oldParentId ? oldParentCandidate : undefined;
  if (oldParentId && oldParent) {
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
  const newParentCandidate = newParentId
    ? (taskState.entities[newParentId] as Task | undefined)
    : undefined;
  const newParent =
    newParentCandidate?.id === newParentId ? newParentCandidate : undefined;
  if (newParentId && newParent) {
    // Only add if not already present
    if (!newParent.subTaskIds.includes(taskId)) {
      taskState = taskAdapter.updateOne(
        {
          id: newParentId,
          changes: {
            subTaskIds: [...newParent.subTaskIds, taskId],
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
 * Filters orphaned taskIds (and backlogTaskIds for PROJECT) from entity data
 * before applying LWW updates. This prevents TAG and PROJECT entities from
 * referencing tasks that no longer exist in the store.
 *
 * This is necessary because LWW conflict resolution replaces entire entities
 * without checking whether referenced tasks still exist locally.
 *
 * Wraps the shared `filterTaskIdArraysFromTagOrProjectPayload` helper. The
 * sibling filter for in-batch archives is `stripBatchArchivedTaskIdsFromLwwPayload`
 * in op-log/apply/bulk-archive-filter.util.ts — the two run at different
 * layers because their predicates resolve at different times.
 */
const filterOrphanedTaskIdsFromEntityData = (
  entityData: Record<string, unknown>,
  entityType: string,
  rootState: RootState,
  requiresMatchingProjectMembership: boolean,
): Record<string, unknown> => {
  const taskState = rootState[TASK_FEATURE_NAME];
  if (!taskState) return entityData;
  const projectId = entityData['id'];
  const cleaned = filterTaskIdArraysFromTagOrProjectPayload(
    entityData,
    entityType,
    (id) => {
      const task = taskState.entities[id] as Task | undefined;
      if (!task) return true;
      return (
        entityType === 'PROJECT' &&
        requiresMatchingProjectMembership &&
        (task.projectId !== projectId || !!task.parentId)
      );
    },
    {
      warnMessage: `lwwUpdateMetaReducer: Filtered orphaned taskIds from ${entityType} LWW Update`,
      entityId:
        typeof entityData['id'] === 'string' ? (entityData['id'] as string) : undefined,
    },
  );
  return cleaned ?? entityData;
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
    const actionMeta = actionAny['meta'] as
      | {
          lwwUpdateMode?: LwwUpdateMode;
          isApplyingFromOtherClient?: boolean;
          recreatesEntityAfterDelete?: boolean;
        }
      | undefined;
    let entityData: Record<string, unknown> = {};
    for (const key of Object.keys(actionAny)) {
      if (key !== 'type' && key !== 'meta') {
        entityData[key] = actionAny[key];
      }
    }

    // Filter orphaned taskIds/backlogTaskIds for TAG and PROJECT entities
    entityData = filterOrphanedTaskIdsFromEntityData(
      entityData,
      entityType,
      rootState,
      actionMeta?.recreatesEntityAfterDelete === true,
    );

    // Singleton entities: replace entire feature state with the winning data
    if (isSingletonEntity(config)) {
      if (Object.keys(entityData).length === 0) {
        OpLog.warn(`lwwUpdateMetaReducer: Empty singleton data for: ${entityType}`);
        devError(`lwwUpdateMetaReducer: Empty singleton data for: ${entityType}`);
        return reducer(state, action);
      }
      // 'patch' payloads carry a partial delta (disjoint merges); replacing the
      // whole feature state with one would wipe every untouched section. Apply
      // as a shallow merge instead — the singleton analogue of updateOne. No
      // current producer emits patch-mode singleton ops; this is a guard.
      if (actionMeta?.lwwUpdateMode === 'patch') {
        entityData = {
          ...(featureState as Record<string, unknown>),
          ...entityData,
        };
      }
      if (
        entityType === 'GLOBAL_CONFIG' &&
        actionMeta?.isApplyingFromOtherClient === true
      ) {
        const localSync = (featureState as Record<string, unknown>)['sync'];
        if (
          typeof localSync === 'object' &&
          localSync !== null &&
          !Array.isArray(localSync)
        ) {
          const incomingSync = entityData['sync'];
          entityData = {
            ...entityData,
            sync:
              typeof incomingSync === 'object' &&
              incomingSync !== null &&
              !Array.isArray(incomingSync)
                ? withLocalOnlySyncSettings(
                    incomingSync as SyncConfig,
                    localSync as SyncConfig,
                  )
                : localSync,
          };
        }
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

    // Note (#7330): backfill of payload.id for adapter LWW Updates lives in
    // convertOpToAction at the apply boundary — every applied op has its id
    // set from op.entityId before reaching this reducer. Producers also
    // force the canonical id on-disk. The check below remains as a hard
    // guard for actions arriving with no usable id at all.
    if (typeof entityData['id'] !== 'string' || !entityData['id']) {
      OpLog.warn('lwwUpdateMetaReducer: Entity data has no id');
      return reducer(state, action);
    }

    const entityId = entityData['id'] as string;
    if (Object.prototype.hasOwnProperty.call(Object.prototype, entityId)) {
      OpLog.warn(`lwwUpdateMetaReducer: Unsafe entity id: ${entityId}`);
      return reducer(state, action);
    }

    // Sanitize date string fields to prevent corrupted data from sync (#6908)
    if (entityType === 'TASK') {
      for (const field of ['dueDay', 'deadlineDay'] as const) {
        const val = entityData[field];
        if (typeof val === 'string' && !isDBDateStr(val)) {
          entityData[field] = undefined;
          devError(
            `lwwUpdateMetaReducer: Invalid ${field} "${val}" on task ${entityId}, clearing`,
          );
        }
      }
      // TODAY_TAG membership is virtual (derived from dueDay/dueWithTime) and
      // must never be stored in task.tagIds. A replace-mode snapshot from a
      // legacy or corrupt producer would otherwise persist a stray 'TODAY' and
      // updateTagTaskIds would sync the task into TODAY_TAG.taskIds.
      const tagIds = entityData['tagIds'];
      if (Array.isArray(tagIds) && tagIds.includes(TODAY_TAG.id)) {
        entityData['tagIds'] = tagIds.filter((id) => id !== TODAY_TAG.id);
        devError(
          `lwwUpdateMetaReducer: Stripped virtual TODAY tag from task ${entityId}`,
        );
      }
      if (
        actionMeta?.recreatesEntityAfterDelete === true &&
        actionMeta.lwwUpdateMode === 'patch' &&
        Array.isArray(entityData['subTaskIds'])
      ) {
        const parentId = entityData['id'];
        const parentProjectId = entityData['projectId'];
        entityData['subTaskIds'] = entityData['subTaskIds'].filter((id) => {
          if (typeof id !== 'string') return false;
          const child = rootState[TASK_FEATURE_NAME].entities[id] as Task | undefined;
          return child?.parentId === parentId && child.projectId === parentProjectId;
        });
      }
    }

    const existingEntityCandidate = (
      featureState as unknown as {
        entities?: Record<string, Record<string, unknown>>;
      }
    ).entities?.[entityId];
    const existingEntity =
      existingEntityCandidate?.['id'] === entityId ? existingEntityCandidate : undefined;

    if (
      entityType === 'TASK' &&
      Object.prototype.hasOwnProperty.call(entityData, 'parentId') &&
      typeof entityData['parentId'] === 'string' &&
      Object.prototype.hasOwnProperty.call(Object.prototype, entityData['parentId'])
    ) {
      entityData['parentId'] = existingEntity?.parentId;
    }

    // A remote projectId pointing at a project this client deleted would
    // orphan an existing task from every project list. Archived projects are
    // still valid owners: their archive op can race with the task update.
    // Recreated tasks deliberately keep out-of-order project references so a
    // later project op can complete the relationship.
    if (
      entityType === 'TASK' &&
      existingEntity &&
      actionMeta?.recreatesEntityAfterDelete !== true &&
      Object.prototype.hasOwnProperty.call(entityData, 'projectId')
    ) {
      const requestedProjectId = entityData['projectId'];
      const currentProjectId = existingEntity?.projectId;
      const fallbackProjectId =
        typeof currentProjectId === 'string' &&
        (currentProjectId === '' || getProjectOrUndefined(rootState, currentProjectId))
          ? currentProjectId
          : undefined;

      if (requestedProjectId == null) {
        entityData['projectId'] = undefined;
      } else if (
        typeof requestedProjectId !== 'string' ||
        (requestedProjectId !== '' &&
          !getProjectOrUndefined(rootState, requestedProjectId))
      ) {
        entityData['projectId'] = fallbackProjectId;
      }
    }

    // Marked patch rows reconcile relationships after a full replacement. If
    // pagination/conflict resolution delivers one without that replacement,
    // it must not synthesize a partial TASK/PROJECT from relationship fields.
    if (
      !existingEntity &&
      actionMeta?.recreatesEntityAfterDelete === true &&
      actionMeta.lwwUpdateMode === 'patch'
    ) {
      OpLog.log(
        `lwwUpdateMetaReducer: Ignoring delayed ${entityType} relationship patch ${entityId} because the entity is absent`,
      );
      return reducer(state, action);
    }

    // Recreate-after-delete rows can be uploaded independently from the parent
    // recovery that made them valid. If that project (or subtask parent) is no
    // longer present, a delayed row must not create an orphan or move an
    // existing task back underneath the deleted parent.
    const recreationProjectId = entityData['projectId'];
    const recreationParentId = entityData['parentId'];
    const recreationParent =
      typeof recreationParentId === 'string'
        ? (rootState[TASK_FEATURE_NAME].entities[recreationParentId] as Task | undefined)
        : undefined;
    const hasInvalidRecreationParent =
      entityType === 'TASK' &&
      actionMeta?.recreatesEntityAfterDelete === true &&
      ((typeof recreationProjectId === 'string' &&
        !rootState[PROJECT_FEATURE_NAME].entities[recreationProjectId]) ||
        (typeof recreationParentId === 'string' &&
          (!recreationParent || recreationParent.projectId !== recreationProjectId)));
    if (hasInvalidRecreationParent) {
      OpLog.log(
        `lwwUpdateMetaReducer: Ignoring delayed TASK recreation ${entityId} because its parent relationship is no longer valid`,
      );
      return reducer(state, action);
    }

    let updatedFeatureState: unknown;

    if (!existingEntity) {
      // Entity was deleted locally but UPDATE won via LWW.
      // This means another client's update beat our delete, so we need to
      // recreate the entity with the winning state.
      OpLog.log(
        `lwwUpdateMetaReducer: Entity ${entityType}:${entityId} not found, recreating from LWW update`,
      );

      // Issue #7330: An LWW Update payload from a partial-delta producer
      // (e.g. _convertToLWWUpdatesIfNeeded fallback) can lack required fields.
      // Calling adapter.addOne with such a payload creates an entity that fails
      // Typia validation (e.g. task with undefined `title` / `timeSpentOnDay`),
      // which dataRepair has no rule for, leaving the user stuck on the
      // "Repair attempted but failed" dialog. For TASK entities we merge with
      // DEFAULT_TASK so the recreated entity is always schema-valid.
      //
      // INTENTIONAL: We set modified to Date.now() (local time), not the original timestamp.
      // Rationale:
      // - Vector clocks are the authoritative conflict resolution mechanism, not `modified`
      // - The `modified` field is used for UI display ("last edited X minutes ago")
      // - Setting it to local time reflects when THIS client applied the winning state
      // - The original timestamp from the winning client is preserved in entityData but
      //   gets overwritten here because local display should show local application time
      let entityToAdd: Record<string, unknown>;
      const fallback = RECREATE_FALLBACK[entityType];
      if (fallback) {
        // null and undefined both count as "missing": producers that emit
        // explicit `null` for a required field would otherwise slip past the
        // warn AND have `null` overwrite the default in the spread below.
        const partialKeys = fallback.requiredKeys.filter((k) => entityData[k] == null);
        if (partialKeys.length > 0) {
          OpLog.warn(
            `lwwUpdateMetaReducer: ${entityType} LWW Update payload missing required ` +
              `fields [${partialKeys.join(', ')}] for ${entityId} — backfilling from ` +
              `defaults. Likely cause: the local DELETE op carried only {id} ` +
              `(or a similarly minimal payload), so _convertToLWWUpdatesIfNeeded ` +
              `produced a partial merged entity on its happy path.`,
          );
        }
        // Spread does not skip null/undefined-valued keys; strip them so they
        // can't clobber a backfilled default.
        const stripped: Record<string, unknown> = { modified: Date.now() };
        for (const k of Object.keys(entityData)) {
          if (entityData[k] != null) stripped[k] = entityData[k];
        }
        entityToAdd = { ...fallback.defaults, ...stripped };

        // INBOX_PROJECT may legitimately be missing from state (corrupted
        // import, partial migration). Mirror normalizeRestoredTask's guard at
        // task-shared-lifecycle.reducer.ts:110 so the recreated task points
        // at a project that actually exists.
        if (entityType === 'TASK' && entityToAdd['projectId'] === INBOX_PROJECT.id) {
          const projectEntities =
            (state[PROJECT_FEATURE_NAME] as { entities?: Record<string, unknown> })
              ?.entities ?? {};
          if (!projectEntities[INBOX_PROJECT.id]) {
            const firstProjectId = Object.keys(projectEntities)[0];
            if (firstProjectId) entityToAdd['projectId'] = firstProjectId;
          }
        }
      } else {
        entityToAdd = { ...entityData, modified: Date.now() };
      }
      updatedFeatureState = (adapter as EntityAdapter<any>).addOne(
        entityToAdd as any,
        featureState as any,
      );
    } else {
      const entityWithLocalModified = {
        ...entityData,
        // INTENTIONAL: We set modified to Date.now() (local time), not the original timestamp.
        // See comment above for rationale - vector clocks drive conflict resolution,
        // `modified` is for UI display of "when this client last saw this change"
        modified: Date.now(),
      };
      updatedFeatureState =
        actionMeta?.lwwUpdateMode === 'replace'
          ? (adapter as EntityAdapter<any>).setOne(
              entityWithLocalModified as any,
              featureState as any,
            )
          : (adapter as EntityAdapter<any>).updateOne(
              {
                id: entityId,
                changes: entityWithLocalModified,
              },
              featureState as any,
            );
    }

    let updatedState: RootState = {
      ...rootState,
      [featureName]: updatedFeatureState,
    };
    const updatedEntity = (
      updatedFeatureState as unknown as {
        entities?: Record<string, Record<string, unknown>>;
      }
    ).entities?.[entityId];

    // For TASK entities, sync related entities when relationships change
    if (entityType === 'TASK' && updatedEntity) {
      // Sync project.taskIds when projectId changes
      const oldProjectId = existingEntity?.projectId as string | undefined;
      let newProjectId = updatedEntity.projectId as string | undefined;
      const oldIsSubTask = !!existingEntity?.parentId;
      const newParentId = updatedEntity.parentId as string | undefined;
      const newIsSubTask = !!newParentId;

      // Subtasks inherit their project from the parent — a snapshot carrying
      // a diverging projectId (split state from an older client) is corrected
      // rather than applied.
      if (newParentId) {
        const parentCandidate = updatedState[TASK_FEATURE_NAME].entities[newParentId] as
          | Task
          | undefined;
        const parent = parentCandidate?.id === newParentId ? parentCandidate : undefined;
        if (parent && parent.projectId !== newProjectId) {
          newProjectId = parent.projectId;
          updatedState = {
            ...updatedState,
            [TASK_FEATURE_NAME]: taskAdapter.updateOne(
              { id: entityId, changes: { projectId: newProjectId } },
              updatedState[TASK_FEATURE_NAME],
            ),
          };
        }
      }

      const meta = actionAny['meta'];
      const explicitEntityIds =
        meta &&
        typeof meta === 'object' &&
        Array.isArray((meta as { entityIds?: unknown }).entityIds)
          ? (meta as { entityIds: unknown[] }).entityIds.filter(
              (id): id is string => typeof id === 'string',
            )
          : undefined;

      if (!newIsSubTask) {
        // Root snapshots repair every project list, even when projectId is
        // unchanged. New synthetic LWW ops replay their source footprint;
        // old ops without entityIds retain receiving-state repair behavior.
        updatedState = repairTaskProjectForLww(
          updatedState,
          updatedEntity as unknown as Task,
          newProjectId,
          explicitEntityIds,
        );
      } else {
        updatedState = syncProjectTaskIds(
          updatedState,
          entityId,
          oldProjectId,
          newProjectId,
          oldIsSubTask,
          newIsSubTask,
        );
      }

      // Sync tag.taskIds when tagIds changes
      const oldTagIds = (existingEntity?.tagIds as string[]) || [];
      const newTagIds = (updatedEntity.tagIds as string[]) || [];

      updatedState = syncTagTaskIds(updatedState, entityId, oldTagIds, newTagIds);

      // Sync TODAY_TAG.taskIds when dueDay or dueWithTime changes (virtual tag based on dueDay/dueWithTime)
      const oldDueDay = existingEntity?.dueDay as string | undefined;
      const newDueDay = updatedEntity.dueDay as string | undefined;
      const oldDueWithTime = existingEntity?.dueWithTime as number | undefined;
      const newDueWithTime = updatedEntity.dueWithTime as number | undefined;
      updatedState = syncTodayTagTaskIds(
        updatedState,
        entityId,
        oldDueDay,
        newDueDay,
        oldDueWithTime,
        newDueWithTime,
      );

      // Sync parent.subTaskIds when parentId changes
      const oldParentId = existingEntity?.parentId as string | undefined;
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
