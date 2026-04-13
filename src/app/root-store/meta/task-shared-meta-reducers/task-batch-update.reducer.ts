import { Action, ActionReducer } from '@ngrx/store';
import { DEFAULT_TASK, Task, TaskCopy } from '../../../features/tasks/task.model';
import { TaskSharedActions } from '../task-shared.actions';

import { taskAdapter } from '../../../features/tasks/store/task.adapter';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { PROJECT_FEATURE_NAME } from '../../../features/project/store/project.reducer';
import { nanoid } from 'nanoid';
import { RootState } from '../../root-state';
import {
  BatchOperation,
  BatchTaskCreate,
  BatchTaskDelete,
  BatchTaskReorder,
  BatchTaskUpdate,
} from '@super-productivity/plugin-api';
import { Log } from '../../../core/log';
import { validateAndFixDataConsistencyAfterBatchUpdate } from './validate-and-fix-data-consistency-after-batch-update';

/**
 * Temp ID prefixes used by plugins to reference not-yet-created tasks.
 * The plugin-bridge pre-generates real IDs and passes them in `createdTaskIds`.
 * During batch processing, any ID starting with these prefixes must be resolved
 * via the `createdTaskIds` map before being stored in state.
 */
const TEMP_ID_PREFIXES = ['temp-', 'temp_'] as const;

/** Checks whether a task ID is a temporary placeholder that needs resolution. */
const isTempId = (id: string): boolean =>
  TEMP_ID_PREFIXES.some((prefix) => id.startsWith(prefix));

/** Resolves a single task ID: if it's a temp ID, looks it up in the mapping. */
const resolveTempId = (id: string, createdTaskIds: Record<string, string>): string =>
  isTempId(id) ? createdTaskIds[id] || id : id;

/**
 * Meta reducer for handling batch updates to tasks within a project
 * This reducer processes all operations in a single state update for efficiency
 */
export const taskBatchUpdateMetaReducer = <T extends Partial<RootState> = RootState>(
  reducer: ActionReducer<T>,
): ActionReducer<T> => {
  return (state: T | undefined, action: Action) => {
    if (action.type === TaskSharedActions.batchUpdateForProject.type) {
      const { projectId, operations, createdTaskIds } = action as ReturnType<
        typeof TaskSharedActions.batchUpdateForProject
      >;

      // Ensure state has required properties
      const rootState = state as unknown as RootState;
      if (
        !rootState ||
        !rootState[TASK_FEATURE_NAME] ||
        !rootState[PROJECT_FEATURE_NAME]
      ) {
        Log.error('taskBatchUpdateMetaReducer: Missing required state properties');
        return reducer(state, action);
      }

      // Validate project exists
      if (!rootState[PROJECT_FEATURE_NAME].entities[projectId]) {
        Log.error(`taskBatchUpdateMetaReducer: Project ${projectId} not found`);
        return reducer(state, action);
      }

      let newState = { ...rootState } as RootState;
      const tasksToAdd: Task[] = [];
      const tasksToUpdate: { id: string; changes: Partial<Task> }[] = [];
      const taskIdsToDelete: string[] = [];
      let newTaskOrder: string[] | null = null;

      // Map to accumulate updates for each task
      const pendingUpdatesMap = new Map<string, Partial<Task>>();

      // Helper function to merge updates for a task
      const mergeTaskUpdate = (
        taskId: string,
        changes: Partial<Task>,
        shouldMergeSubTaskIds = false,
      ): void => {
        const existingChanges = pendingUpdatesMap.get(taskId) || {};
        const mergedChanges = { ...existingChanges, ...changes };

        // Special handling for subTaskIds: merge or replace based on context
        if (changes.subTaskIds && existingChanges.subTaskIds && shouldMergeSubTaskIds) {
          const existingIds = new Set(existingChanges.subTaskIds);
          const newIds = changes.subTaskIds.filter((id) => !existingIds.has(id));
          mergedChanges.subTaskIds = [...existingChanges.subTaskIds, ...newIds];
        }
        // Otherwise use normal replacement behavior (changes.subTaskIds overwrites existingChanges.subTaskIds)
        pendingUpdatesMap.set(taskId, mergedChanges);
      };

      // Sort operations to ensure parents are created before children
      const sortedOperations = [...operations].sort((a, b) => {
        // Create operations: parents first, then children
        if (a.type === 'create' && b.type === 'create') {
          const aOp = a as BatchTaskCreate;
          const bOp = b as BatchTaskCreate;
          const aHasParent = !!aOp.data.parentId;
          const bHasParent = !!bOp.data.parentId;

          // Tasks without parents (root tasks) come first
          if (!aHasParent && bHasParent) return -1;
          if (aHasParent && !bHasParent) return 1;
          return 0;
        }

        // All other operations maintain their original order
        return 0;
      });

      // Process each operation
      sortedOperations.forEach((op: BatchOperation) => {
        switch (op.type) {
          case 'create': {
            const createOp = op as BatchTaskCreate;
            const actualId = createdTaskIds[createOp.tempId] || nanoid();

            // Resolve parent ID if it's a temp ID (convert null to undefined)
            let parentId = createOp.data.parentId || undefined;
            if (parentId && isTempId(parentId)) {
              parentId = resolveTempId(parentId, createdTaskIds);
            }

            // Skip if circular dependency (task is its own parent)
            if (parentId === actualId) {
              Log.error(`Skipping task with circular dependency: ${actualId}`);
              break;
            }

            // Skip if title is empty
            if (!createOp.data.title || createOp.data.title.trim() === '') {
              Log.error(`Skipping task with empty title: ${actualId}`);
              break;
            }

            const newTask: Task = {
              ...DEFAULT_TASK,
              id: actualId,
              projectId,
              title: createOp.data.title || '',
              isDone: createOp.data.isDone || false,
              notes: createOp.data.notes || '',
              parentId,
              timeEstimate: createOp.data.timeEstimate || 0,
              created: Date.now(),
            };

            tasksToAdd.push(newTask);

            // Update the createdTaskIds mapping for temp ID resolution
            // This allows subsequent operations in the same batch to resolve this temp ID
            if (!createdTaskIds[createOp.tempId]) {
              createdTaskIds[createOp.tempId] = actualId;
            }

            // Update parent task's subTaskIds if needed
            if (parentId) {
              // Get current parent subTaskIds from both existing state and pending updates
              const parentFromState = newState[TASK_FEATURE_NAME].entities[parentId];
              const pendingParentChanges = pendingUpdatesMap.get(parentId) || {};
              const currentParentSubTaskIds =
                pendingParentChanges.subTaskIds || parentFromState?.subTaskIds || [];

              mergeTaskUpdate(
                parentId,
                {
                  subTaskIds: [...currentParentSubTaskIds, actualId],
                },
                true,
              ); // Merge when adding individual subtasks
            }
            break;
          }

          case 'update': {
            const updateOp = op as BatchTaskUpdate;

            // Skip if task doesn't exist
            if (!newState[TASK_FEATURE_NAME].entities[updateOp.taskId]) {
              Log.warn(`Skipping update for non-existent task: ${updateOp.taskId}`);
              break;
            }

            const updates: Partial<TaskCopy> = {};

            // Copy all defined updates
            ['title', 'notes', 'isDone', 'timeEstimate', 'subTaskIds'].forEach(
              (field) => {
                if (updateOp.updates[field] !== undefined) {
                  updates[field] = updateOp.updates[field];
                }
              },
            );

            // Resolve temp IDs in subTaskIds — plugins may reference newly-created
            // tasks by their temp IDs in parent subTaskIds update operations
            if (updates.subTaskIds) {
              updates.subTaskIds = (updates.subTaskIds as string[]).map((id: string) =>
                resolveTempId(id, createdTaskIds),
              );
            }

            if (updateOp.updates.parentId !== undefined) {
              // Handle parent ID changes (moving subtasks)
              const oldTask = newState[TASK_FEATURE_NAME].entities[updateOp.taskId];
              if (oldTask) {
                // Remove from old parent
                if (oldTask.parentId) {
                  const oldParent =
                    newState[TASK_FEATURE_NAME].entities[oldTask.parentId];
                  if (oldParent) {
                    // Get the current state of subTaskIds (might have been updated by previous operations)
                    const currentOldParentChanges =
                      pendingUpdatesMap.get(oldTask.parentId) || {};
                    const currentSubTaskIds =
                      currentOldParentChanges.subTaskIds || oldParent.subTaskIds || [];
                    mergeTaskUpdate(oldTask.parentId, {
                      subTaskIds: currentSubTaskIds.filter(
                        (id) => id !== updateOp.taskId,
                      ),
                    });
                  }
                }

                // Add to new parent (convert null to undefined)
                let newParentId = updateOp.updates.parentId || undefined;
                if (newParentId && isTempId(newParentId)) {
                  newParentId = resolveTempId(newParentId, createdTaskIds);
                }

                if (newParentId) {
                  const newParent = newState[TASK_FEATURE_NAME].entities[newParentId];
                  if (newParent) {
                    // Get the current state of subTaskIds (might have been updated by previous operations)
                    const currentNewParentChanges =
                      pendingUpdatesMap.get(newParentId) || {};
                    const currentSubTaskIds =
                      currentNewParentChanges.subTaskIds || newParent.subTaskIds || [];
                    mergeTaskUpdate(
                      newParentId,
                      {
                        subTaskIds: [...currentSubTaskIds, updateOp.taskId],
                      },
                      true,
                    ); // Merge when adding individual subtasks
                  }
                }

                updates.parentId = newParentId;
              }
            }

            if (Object.keys(updates).length > 0) {
              mergeTaskUpdate(updateOp.taskId, updates);
            }
            break;
          }

          case 'delete': {
            const deleteOp = op as BatchTaskDelete;

            // Skip if task doesn't exist
            if (!newState[TASK_FEATURE_NAME].entities[deleteOp.taskId]) {
              Log.err(`Skipping delete for non-existent task: ${deleteOp.taskId}`);
              break;
            }

            taskIdsToDelete.push(deleteOp.taskId);

            // Remove from parent's subTaskIds
            const taskToDelete = newState[TASK_FEATURE_NAME].entities[deleteOp.taskId];
            if (taskToDelete?.parentId) {
              const parent = newState[TASK_FEATURE_NAME].entities[taskToDelete.parentId];
              if (parent) {
                // Get the current state of subTaskIds (might have been updated by previous operations)
                const currentParentChanges =
                  pendingUpdatesMap.get(taskToDelete.parentId) || {};
                const currentSubTaskIds =
                  currentParentChanges.subTaskIds || parent.subTaskIds || [];
                mergeTaskUpdate(taskToDelete.parentId, {
                  subTaskIds: currentSubTaskIds.filter((id) => id !== deleteOp.taskId),
                });
              }
            }

            // Delete subtasks recursively
            if (taskToDelete?.subTaskIds?.length) {
              taskIdsToDelete.push(...taskToDelete.subTaskIds);
            }
            break;
          }

          case 'reorder': {
            const reorderOp = op as BatchTaskReorder;
            // Resolve temp IDs in the order array
            newTaskOrder = reorderOp.taskIds.map((id) =>
              resolveTempId(id, createdTaskIds),
            );
            break;
          }
        }
      });

      // Convert pending updates map to array
      pendingUpdatesMap.forEach((changes, taskId) => {
        tasksToUpdate.push({ id: taskId, changes });
      });

      // Apply all task changes
      if (tasksToAdd.length > 0) {
        newState[TASK_FEATURE_NAME] = taskAdapter.addMany(
          tasksToAdd,
          newState[TASK_FEATURE_NAME],
        );
      }
      if (tasksToUpdate.length > 0) {
        newState[TASK_FEATURE_NAME] = taskAdapter.updateMany(
          tasksToUpdate,
          newState[TASK_FEATURE_NAME],
        );
      }
      if (taskIdsToDelete.length > 0) {
        newState[TASK_FEATURE_NAME] = taskAdapter.removeMany(
          taskIdsToDelete,
          newState[TASK_FEATURE_NAME],
        );

        // Comprehensive cleanup: Remove deleted task IDs from all remaining tasks' subTaskIds
        const deletedTaskIdsSet = new Set(taskIdsToDelete);
        const additionalUpdates: { id: string; changes: Partial<Task> }[] = [];

        Object.values(newState[TASK_FEATURE_NAME].entities).forEach((task) => {
          if (task && task.subTaskIds && task.subTaskIds.length > 0) {
            const cleanedSubTaskIds = task.subTaskIds.filter(
              (subTaskId) => !deletedTaskIdsSet.has(subTaskId),
            );

            // Only update if the array actually changed
            if (cleanedSubTaskIds.length !== task.subTaskIds.length) {
              additionalUpdates.push({
                id: task.id,
                changes: { subTaskIds: cleanedSubTaskIds },
              });
            }
          }
        });

        // Apply additional cleanup updates if needed
        if (additionalUpdates.length > 0) {
          newState[TASK_FEATURE_NAME] = taskAdapter.updateMany(
            additionalUpdates,
            newState[TASK_FEATURE_NAME],
          );
        }
      }

      // Apply comprehensive data validation and consistency fixes
      newState = validateAndFixDataConsistencyAfterBatchUpdate(
        newState,
        projectId,
        tasksToAdd,
        tasksToUpdate,
        taskIdsToDelete,
        newTaskOrder,
      );

      return reducer(newState as T, action);
    }

    return reducer(state, action);
  };
};
