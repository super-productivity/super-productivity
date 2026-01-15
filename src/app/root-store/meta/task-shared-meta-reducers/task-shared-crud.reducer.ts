import { Action, ActionReducer, MetaReducer } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { RootState } from '../../root-state';
import { TaskSharedActions } from '../task-shared.actions';
import {
  PROJECT_FEATURE_NAME,
  projectAdapter,
} from '../../../features/project/store/project.reducer';
import { TAG_FEATURE_NAME } from '../../../features/tag/store/tag.reducer';
import {
  TASK_FEATURE_NAME,
  taskAdapter,
} from '../../../features/tasks/store/task.reducer';
import {
  deleteTaskHelper,
  removeTaskFromParentSideEffects,
  updateDoneOnForTask,
  updateTimeEstimateForTask,
  updateTimeSpentForTask,
} from '../../../features/tasks/store/task.reducer.util';
import { Tag } from '../../../features/tag/tag.model';
import { Project } from '../../../features/project/project.model';
import { DEFAULT_TASK, Task, TaskWithSubTasks } from '../../../features/tasks/task.model';
import { calcTotalTimeSpent } from '../../../features/tasks/util/calc-total-time-spent';
import { TODAY_TAG } from '../../../features/tag/tag.const';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { unique } from '../../../util/unique';
import {
  ActionHandlerMap,
  addTaskToList,
  getProject,
  getTag,
  ProjectTaskList,
  removeTasksFromList,
  TaskWithTags,
  updateProject,
  updateTags,
} from './task-shared-helpers';
import { plannerFeatureKey } from '../../../features/planner/store/planner.reducer';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Removes parent or sub-tasks from a tag's task list to maintain the constraint
 * that parent and sub-tasks should never be in the same tag list.
 * Also removes the tag from the conflicting tasks.
 *
 * @param state - The current state
 * @param taskId - The task being added
 * @param tagId - The tag to check
 * @returns Updated state with conflicts resolved
 */
const removeConflictingTasksFromTag = (
  state: RootState,
  taskId: string,
  tagId: string,
): RootState => {
  const task = state[TASK_FEATURE_NAME].entities[taskId] as Task;
  if (!task) return state;

  const tag = getTag(state, tagId);
  // PERF: Use Set for O(1) lookups instead of O(n) Array.includes()
  const tagTaskIdSet = new Set(tag.taskIds);
  const conflictingTaskIds: string[] = [];

  // If this is a sub-task, check if parent is in the tag
  if (task.parentId && tagTaskIdSet.has(task.parentId)) {
    conflictingTaskIds.push(task.parentId);
  }

  // If this is a parent task, check if any sub-tasks are in the tag
  if (task.subTaskIds && task.subTaskIds.length > 0) {
    const subTasksInTag = task.subTaskIds.filter((subId) => tagTaskIdSet.has(subId));
    conflictingTaskIds.push(...subTasksInTag);
  }

  if (conflictingTaskIds.length === 0) {
    return state;
  }

  // Update the conflicting tasks to remove the tag
  const taskUpdates: Update<Task>[] = conflictingTaskIds.map((conflictingTaskId) => {
    const conflictingTask = state[TASK_FEATURE_NAME].entities[conflictingTaskId] as Task;
    return {
      id: conflictingTaskId,
      changes: {
        tagIds: conflictingTask.tagIds.filter((id) => id !== tagId),
      },
    };
  });

  // Update the task state
  const updatedState = {
    ...state,
    [TASK_FEATURE_NAME]: taskAdapter.updateMany(taskUpdates, state[TASK_FEATURE_NAME]),
  };

  // PERF: Use Set for O(1) lookups when filtering
  const conflictingSet = new Set(conflictingTaskIds);
  const tagUpdate: Update<Tag> = {
    id: tagId,
    changes: {
      taskIds: tag.taskIds.filter((id) => !conflictingSet.has(id)),
    },
  };

  return updateTags(updatedState, [tagUpdate]);
};

// =============================================================================
// ACTION HANDLERS
// =============================================================================

const handleAddTask = (
  state: RootState,
  task: TaskWithTags,
  isAddToBottom: boolean,
  isAddToBacklog: boolean,
): RootState => {
  let updatedState = state;

  // Determine if task should be added to Today tag
  const shouldAddToToday = task.dueDay === getDbDateStr();

  // Add task to task state
  // IMPORTANT: TODAY_TAG should NEVER be in task.tagIds (virtual tag pattern)
  // Membership is determined by task.dueDay, TODAY_TAG.taskIds only stores ordering
  // See: docs/ai/today-tag-architecture.md
  const taskTagIds = task.tagIds.filter((id) => id !== TODAY_TAG.id);

  const newTask: Task = {
    ...DEFAULT_TASK,
    ...task,
    tagIds: taskTagIds,
    timeSpent: calcTotalTimeSpent(task.timeSpentOnDay || {}),
    projectId: task.projectId || '',
  };
  updatedState = {
    ...updatedState,
    [TASK_FEATURE_NAME]: taskAdapter.addOne(newTask, updatedState[TASK_FEATURE_NAME]),
  };

  // Update project if task has projectId - but only for main tasks (not subtasks)
  if (
    task.projectId &&
    state[PROJECT_FEATURE_NAME].entities[task.projectId] &&
    !task.parentId
  ) {
    const project = getProject(state, task.projectId);
    const targetList: ProjectTaskList =
      isAddToBacklog && project.isEnableBacklog ? 'backlogTaskIds' : 'taskIds';

    updatedState = updateProject(updatedState, task.projectId, {
      [targetList]: addTaskToList(project[targetList], task.id, isAddToBottom),
    });
  }

  // Update tags - only update regular tags that exist (not TODAY_TAG which is virtual)
  // If shouldAddToToday, also add to TODAY_TAG's taskIds
  const tagIdsToUpdate = [
    ...newTask.tagIds, // Regular tags from task.tagIds
    ...(shouldAddToToday ? [TODAY_TAG.id] : []), // Add TODAY_TAG if task is for today
  ].filter((tagId) => state[TAG_FEATURE_NAME].entities[tagId]);

  // First, handle conflicts for all tags
  for (const tagId of tagIdsToUpdate) {
    updatedState = removeConflictingTasksFromTag(updatedState, task.id, tagId);
  }

  // Then add the task to all its tags
  const tagUpdates = tagIdsToUpdate.map(
    (tagId): Update<Tag> => ({
      id: tagId,
      changes: {
        taskIds: addTaskToList(
          getTag(updatedState, tagId).taskIds,
          task.id,
          isAddToBottom,
        ),
      },
    }),
  );

  updatedState = updateTags(updatedState, tagUpdates);

  // Update planner days if task has a future dueDay
  if (task.dueDay && task.dueDay !== getDbDateStr()) {
    const plannerState = updatedState[plannerFeatureKey as keyof RootState] as any;
    const daysCopy = { ...plannerState.days };
    const existingTaskIds = daysCopy[task.dueDay] || [];

    daysCopy[task.dueDay] = unique(
      isAddToBottom ? [...existingTaskIds, task.id] : [task.id, ...existingTaskIds],
    );

    updatedState = {
      ...updatedState,
      [plannerFeatureKey]: {
        ...plannerState,
        days: daysCopy,
      },
    };
  }

  return updatedState;
};

const handleConvertToMainTask = (
  state: RootState,
  task: Task,
  parentTagIds: string[],
  isPlanForToday?: boolean,
): RootState => {
  // First, get the parent task to copy its properties
  const parentTask = state[TASK_FEATURE_NAME].entities[task.parentId as string] as Task;
  if (!parentTask) {
    throw new Error('No parent for sub task');
  }

  // Handle parent-child relationship cleanup and task entity updates
  const taskStateAfterParentCleanup = removeTaskFromParentSideEffects(
    state[TASK_FEATURE_NAME],
    task as Task,
  );

  const updatedTaskState = taskAdapter.updateOne(
    {
      id: task.id,
      changes: {
        parentId: undefined,
        // Filter out TODAY_TAG.id - it's a virtual tag where membership is
        // determined by task.dueDay, not by being in tagIds
        tagIds: parentTask.tagIds.filter((id) => id !== TODAY_TAG.id),
        modified: Date.now(),
        ...(isPlanForToday && !task.dueWithTime
          ? {
              dueDay: getDbDateStr(),
            }
          : {}),
      },
    },
    taskStateAfterParentCleanup,
  );

  let updatedState = {
    ...state,
    [TASK_FEATURE_NAME]: updatedTaskState,
  };

  // Update project if task has projectId
  if (task.projectId && state[PROJECT_FEATURE_NAME].entities[task.projectId]) {
    const project = getProject(state, task.projectId);
    updatedState = updateProject(updatedState, task.projectId, {
      taskIds: [task.id, ...project.taskIds],
    });
  }

  // Update tags - only update tags that exist
  const tagIdsToUpdate = [
    ...parentTagIds,
    ...(isPlanForToday ? [TODAY_TAG.id] : []),
  ].filter((tagId) => state[TAG_FEATURE_NAME].entities[tagId]);

  // For convertToMainTask, we need to manually check if parent is in the tags
  // since the parent-child relationship was already cleaned up
  const parentTaskId = task.parentId;
  if (parentTaskId) {
    // Remove parent from all tags that the converted task will be in
    const parentTaskUpdates: Update<Task>[] = [];
    const tagUpdatesForParent: Update<Tag>[] = [];

    for (const tagId of tagIdsToUpdate) {
      const tag = getTag(updatedState, tagId);
      if (tag.taskIds.includes(parentTaskId)) {
        // Remove tag from parent task
        const currentParent = updatedState[TASK_FEATURE_NAME].entities[
          parentTaskId
        ] as Task;
        if (currentParent && currentParent.tagIds.includes(tagId)) {
          parentTaskUpdates.push({
            id: parentTaskId,
            changes: {
              tagIds: currentParent.tagIds.filter((id) => id !== tagId),
            },
          });
        }
        // Remove parent from tag
        tagUpdatesForParent.push({
          id: tagId,
          changes: {
            taskIds: tag.taskIds.filter((id) => id !== parentTaskId),
          },
        });
      }
    }

    if (parentTaskUpdates.length > 0) {
      updatedState = {
        ...updatedState,
        [TASK_FEATURE_NAME]: taskAdapter.updateMany(
          parentTaskUpdates,
          updatedState[TASK_FEATURE_NAME],
        ),
      };
    }

    if (tagUpdatesForParent.length > 0) {
      updatedState = updateTags(updatedState, tagUpdatesForParent);
    }
  }

  // Then add the task to all its tags at the beginning
  const tagUpdates = tagIdsToUpdate.map(
    (tagId): Update<Tag> => ({
      id: tagId,
      changes: {
        taskIds: [task.id, ...getTag(updatedState, tagId).taskIds],
      },
    }),
  );

  return updateTags(updatedState, tagUpdates);
};

const handleDeleteTask = (
  state: RootState,
  task: {
    id: string;
    projectId?: string | null;
    tagIds: string[];
    subTasks?: Task[];
    subTaskIds?: string[];
  },
): RootState => {
  let updatedState = state;

  // Delete task from task state using helper
  updatedState = {
    ...updatedState,
    [TASK_FEATURE_NAME]: deleteTaskHelper(
      updatedState[TASK_FEATURE_NAME],
      task as TaskWithSubTasks,
    ),
  };

  // Update project if task has projectId
  if (task.projectId && state[PROJECT_FEATURE_NAME].entities[task.projectId]) {
    const project = getProject(state, task.projectId);
    updatedState = updateProject(updatedState, task.projectId, {
      taskIds: removeTasksFromList(project.taskIds, [task.id]),
      backlogTaskIds: removeTasksFromList(project.backlogTaskIds, [task.id]),
    });
  }

  // Update tags - collect all affected tags and tasks to remove
  // Include TODAY_TAG.id explicitly since it's not stored in task.tagIds by design
  const potentialTagIds = [
    TODAY_TAG.id,
    ...task.tagIds,
    ...(task.subTasks || []).flatMap((st) => st.tagIds || []),
  ];

  // Only include tags that actually exist in the state to prevent errors
  const affectedTagIds = unique(
    potentialTagIds.filter((tagId) => state[TAG_FEATURE_NAME].entities[tagId]),
  );

  const taskIdsToRemove = [task.id, ...(task.subTaskIds || [])];

  const tagUpdates = affectedTagIds.map(
    (tagId): Update<Tag> => ({
      id: tagId,
      changes: {
        taskIds: removeTasksFromList(getTag(state, tagId).taskIds, taskIdsToRemove),
      },
    }),
  );

  return updateTags(updatedState, tagUpdates);
};

const handleDeleteTasks = (state: RootState, taskIds: string[]): RootState => {
  let updatedState = state;

  // Get all task IDs including subtasks, and collect project associations
  const projectIdsSet = new Set<string>();
  const allIds = taskIds.reduce((acc: string[], id: string) => {
    const task = state[TASK_FEATURE_NAME].entities[id] as Task;
    if (task) {
      if (task.projectId) {
        projectIdsSet.add(task.projectId);
      }
      return [...acc, id, ...task.subTaskIds];
    }
    return [...acc, id];
  }, []);

  // Remove tasks from task state
  const newTaskState = taskAdapter.removeMany(allIds, updatedState[TASK_FEATURE_NAME]);
  updatedState = {
    ...updatedState,
    [TASK_FEATURE_NAME]: {
      ...newTaskState,
      currentTaskId:
        newTaskState.currentTaskId && taskIds.includes(newTaskState.currentTaskId)
          ? null
          : newTaskState.currentTaskId,
    },
  };

  // Clean up projects - remove task IDs from all affected projects
  const projectIds = Array.from(projectIdsSet);
  if (projectIds.length > 0) {
    const projectUpdates = projectIds
      .filter((pid) => !!state[PROJECT_FEATURE_NAME].entities[pid])
      .map((pid) => {
        const project = getProject(state, pid);
        return {
          id: pid,
          changes: {
            taskIds: removeTasksFromList(project.taskIds, allIds),
            backlogTaskIds: removeTasksFromList(project.backlogTaskIds, allIds),
          },
        };
      });

    if (projectUpdates.length > 0) {
      updatedState = {
        ...updatedState,
        [PROJECT_FEATURE_NAME]: projectAdapter.updateMany(
          projectUpdates,
          updatedState[PROJECT_FEATURE_NAME],
        ),
      };
    }
  }

  // Only update tags that actually contain at least one of the tasks being deleted
  // Use allIds (includes subtasks) to ensure subtask IDs are also removed from tags
  // PERF: Use Set for O(1) lookup instead of O(n) Array.includes() - fixes O(n³) bottleneck
  const allIdsSet = new Set(allIds);
  const affectedTags = (state[TAG_FEATURE_NAME].ids as string[]).filter((tagId) => {
    const tag = state[TAG_FEATURE_NAME].entities[tagId];
    if (!tag) return false;
    return tag.taskIds.some((taskId) => allIdsSet.has(taskId));
  });

  const tagUpdates = affectedTags.map(
    (tagId): Update<Tag> => ({
      id: tagId,
      changes: {
        taskIds: removeTasksFromList(getTag(state, tagId).taskIds, allIds),
      },
    }),
  );

  return updateTags(updatedState, tagUpdates);
};

/**
 * Merges restored task IDs into a current array at their original positions.
 * This preserves any new tasks added after the delete while restoring the
 * deleted tasks at their original positions.
 */
const mergeTaskIdsAtPositions = (
  capturedArray: string[],
  currentArray: string[],
  taskIdsToRestore: string[],
): string[] => {
  const result = [...currentArray];
  // PERF: Use Set for O(1) lookup instead of O(n) Array.includes()
  const resultSet = new Set(currentArray);

  for (const taskId of taskIdsToRestore) {
    // Skip if already in current array
    if (resultSet.has(taskId)) {
      continue;
    }

    // Find original position in captured array
    const capturedIndex = capturedArray.indexOf(taskId);
    if (capturedIndex === -1) {
      // Not found in captured array, append to end
      result.push(taskId);
    } else {
      // Insert at the original position, clamped to array bounds
      const insertIndex = Math.min(capturedIndex, result.length);
      result.splice(insertIndex, 0, taskId);
    }
    // Track the added ID for subsequent iterations
    resultSet.add(taskId);
  }

  return result;
};

/**
 * Restores a deleted task with all its associations.
 * This is the sync-aware version of undo delete - the payload contains
 * all data needed to restore the task on any device.
 *
 * IMPORTANT: This uses MERGE semantics, not REPLACE. Any tasks added
 * between delete and restore are preserved.
 */
const handleRestoreDeletedTask = (
  state: RootState,
  payload: ReturnType<typeof TaskSharedActions.restoreDeletedTask>,
): RootState => {
  const { deletedTaskEntities, tagTaskIdMap, projectContext, parentContext } = payload;
  const restoredTaskIds = Object.keys(deletedTaskEntities);
  let updatedState = state;

  // 1. Restore task entities with updated modified timestamp
  const tasksToRestore = Object.values(deletedTaskEntities)
    .filter((task): task is Task => !!task)
    .map((task) => ({
      ...task,
      modified: Date.now(),
    }));

  updatedState = {
    ...updatedState,
    [TASK_FEATURE_NAME]: taskAdapter.addMany(
      tasksToRestore,
      updatedState[TASK_FEATURE_NAME],
    ),
  };

  // 2. Restore parent-child relationships (if task was a subtask)
  if (parentContext) {
    const parent = updatedState[TASK_FEATURE_NAME].entities[parentContext.parentTaskId];
    if (parent) {
      const currentSubTaskIds = parent.subTaskIds || [];
      const mergedSubTaskIds = mergeTaskIdsAtPositions(
        parentContext.subTaskIds,
        currentSubTaskIds,
        restoredTaskIds,
      );
      updatedState = {
        ...updatedState,
        [TASK_FEATURE_NAME]: taskAdapter.updateOne(
          {
            id: parentContext.parentTaskId,
            changes: { subTaskIds: mergedSubTaskIds },
          },
          updatedState[TASK_FEATURE_NAME],
        ),
      };
    }
  }

  // 3. Restore tag associations (only for tags that still exist)
  const tagUpdates = Object.entries(tagTaskIdMap)
    .filter(([tagId]) => !!updatedState[TAG_FEATURE_NAME].entities[tagId])
    .map(([tagId, capturedTaskIds]): Update<Tag> => {
      const currentTag = updatedState[TAG_FEATURE_NAME].entities[tagId] as Tag;
      const currentTaskIds = currentTag?.taskIds || [];
      // Only restore task IDs that were actually in this tag at delete time
      const taskIdsToRestoreForTag = restoredTaskIds.filter((id) =>
        capturedTaskIds.includes(id),
      );
      const mergedTaskIds = mergeTaskIdsAtPositions(
        capturedTaskIds,
        currentTaskIds,
        taskIdsToRestoreForTag,
      );
      return {
        id: tagId,
        changes: { taskIds: mergedTaskIds },
      };
    });

  if (tagUpdates.length > 0) {
    updatedState = updateTags(updatedState, tagUpdates);
  }

  // 4. Restore project associations (if project still exists)
  if (projectContext) {
    const project = updatedState[PROJECT_FEATURE_NAME].entities[
      projectContext.projectId
    ] as Project;
    if (project) {
      const currentTaskIds = project.taskIds || [];
      const currentBacklogTaskIds = project.backlogTaskIds || [];

      // Only restore to one list - check which one the task was in
      const mainTaskId = payload.task.id;
      const wasInBacklog = projectContext.taskIdsForProjectBacklog.includes(mainTaskId);

      if (wasInBacklog) {
        const mergedBacklogTaskIds = mergeTaskIdsAtPositions(
          projectContext.taskIdsForProjectBacklog,
          currentBacklogTaskIds,
          [mainTaskId],
        );
        updatedState = updateProject(updatedState, projectContext.projectId, {
          backlogTaskIds: mergedBacklogTaskIds,
        });
      } else {
        const mergedTaskIds = mergeTaskIdsAtPositions(
          projectContext.taskIdsForProject,
          currentTaskIds,
          [mainTaskId],
        );
        updatedState = updateProject(updatedState, projectContext.projectId, {
          taskIds: mergedTaskIds,
        });
      }
    }
  }

  return updatedState;
};

const handleUpdateTask = (
  state: RootState,
  taskUpdate: Update<Task>,
  isIgnoreShortSyntax?: boolean,
): RootState => {
  const taskId = taskUpdate.id as string;
  const currentTask = state[TASK_FEATURE_NAME].entities[taskId] as Task;

  if (!currentTask) {
    return state;
  }

  let updatedState = state;

  // Handle tag changes if tagIds are being updated
  if (taskUpdate.changes.tagIds) {
    const oldTagIds = currentTask.tagIds;
    const newTagIds = taskUpdate.changes.tagIds;

    updatedState = handleTagUpdates(updatedState, taskId, oldTagIds, newTagIds);
  }

  // Handle task state updates using existing task reducer logic
  let taskState = updatedState[TASK_FEATURE_NAME];
  const { timeSpentOnDay, timeEstimate } = taskUpdate.changes;

  taskState = timeSpentOnDay
    ? updateTimeSpentForTask(taskId, timeSpentOnDay, taskState)
    : taskState;
  taskState = updateTimeEstimateForTask(taskUpdate, timeEstimate, taskState);
  taskState = updateDoneOnForTask(taskUpdate, taskState);
  taskState = taskAdapter.updateOne(
    {
      ...taskUpdate,
      changes: {
        ...taskUpdate.changes,
        modified: Date.now(),
      },
    },
    taskState,
  );

  return {
    ...updatedState,
    [TASK_FEATURE_NAME]: taskState,
  };
};

const handleTagUpdates = (
  state: RootState,
  taskId: string,
  oldTagIds: string[],
  newTagIds: string[],
): RootState => {
  // PERF: Use Sets for O(1) lookups instead of O(n) Array.includes()
  const oldTagIdSet = new Set(oldTagIds);
  const newTagIdSet = new Set(newTagIds);
  // Filter TODAY_TAG from both sides - it's a virtual tag where membership is
  // determined by task.dueDay, not by being in tagIds
  const tagsToRemoveFrom = oldTagIds
    .filter((oldId) => !newTagIdSet.has(oldId))
    .filter((oldId) => oldId !== TODAY_TAG.id)
    .filter((tagId) => state[TAG_FEATURE_NAME].entities[tagId]); // Only existing tags
  const tagsToAddTo = newTagIds
    .filter((newId) => !oldTagIdSet.has(newId))
    .filter((newId) => newId !== TODAY_TAG.id)
    .filter((tagId) => state[TAG_FEATURE_NAME].entities[tagId]); // Only existing tags

  let updatedState = state;

  // First, handle conflicts for all tags we're adding to
  for (const tagId of tagsToAddTo) {
    updatedState = removeConflictingTasksFromTag(updatedState, taskId, tagId);
  }

  const removeUpdates = tagsToRemoveFrom.map(
    (tagId): Update<Tag> => ({
      id: tagId,
      changes: {
        taskIds: getTag(updatedState, tagId).taskIds.filter((id) => id !== taskId),
      },
    }),
  );

  const addUpdates = tagsToAddTo.map(
    (tagId): Update<Tag> => ({
      id: tagId,
      changes: {
        taskIds: unique([taskId, ...getTag(updatedState, tagId).taskIds]),
      },
    }),
  );

  return updateTags(updatedState, [...removeUpdates, ...addUpdates]);
};

// =============================================================================
// META REDUCER
// =============================================================================

const createActionHandlers = (state: RootState, action: Action): ActionHandlerMap => ({
  [TaskSharedActions.addTask.type]: () => {
    const { task, isAddToBottom, isAddToBacklog } = action as ReturnType<
      typeof TaskSharedActions.addTask
    >;
    return handleAddTask(state, task, isAddToBottom, isAddToBacklog);
  },
  [TaskSharedActions.convertToMainTask.type]: () => {
    const { task, parentTagIds, isPlanForToday } = action as ReturnType<
      typeof TaskSharedActions.convertToMainTask
    >;
    return handleConvertToMainTask(state, task, parentTagIds, isPlanForToday);
  },
  [TaskSharedActions.deleteTask.type]: () => {
    const { task } = action as ReturnType<typeof TaskSharedActions.deleteTask>;
    return handleDeleteTask(state, task);
  },
  [TaskSharedActions.deleteTasks.type]: () => {
    const { taskIds } = action as ReturnType<typeof TaskSharedActions.deleteTasks>;
    return handleDeleteTasks(state, taskIds);
  },
  [TaskSharedActions.restoreDeletedTask.type]: () => {
    return handleRestoreDeletedTask(
      state,
      action as ReturnType<typeof TaskSharedActions.restoreDeletedTask>,
    );
  },
  [TaskSharedActions.updateTask.type]: () => {
    const { task, isIgnoreShortSyntax } = action as ReturnType<
      typeof TaskSharedActions.updateTask
    >;
    return handleUpdateTask(state, task, isIgnoreShortSyntax);
  },
});

export const taskSharedCrudMetaReducer: MetaReducer = (
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
