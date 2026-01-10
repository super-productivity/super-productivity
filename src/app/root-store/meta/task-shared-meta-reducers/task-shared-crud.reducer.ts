import { Action, ActionReducer, MetaReducer } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { RootState } from '../../root-state';
import { TaskSharedActions } from '../task-shared.actions';
import { PROJECT_FEATURE_NAME } from '../../../features/project/store/project.reducer';
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
  const conflictingTaskIds: string[] = [];

  // If this is a sub-task, check if parent is in the tag
  if (task.parentId && tag.taskIds.includes(task.parentId)) {
    conflictingTaskIds.push(task.parentId);
  }

  // If this is a parent task, check if any sub-tasks are in the tag
  if (task.subTaskIds && task.subTaskIds.length > 0) {
    const subTasksInTag = task.subTaskIds.filter((subId) => tag.taskIds.includes(subId));
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

  // Update the tag to remove conflicting tasks
  const tagUpdate: Update<Tag> = {
    id: tagId,
    changes: {
      taskIds: tag.taskIds.filter((id) => !conflictingTaskIds.includes(id)),
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

  // Add task to task state
  const newTask: Task = {
    ...DEFAULT_TASK,
    ...task,
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

  // Update tags - only update tags that exist
  const shouldAddToToday = task.dueDay === getDbDateStr();

  const tagIdsToUpdate = [
    ...task.tagIds,
    ...(shouldAddToToday ? [TODAY_TAG.id] : []),
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
        tagIds: [...parentTask.tagIds],
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
  // Only include tags that actually exist in the state to prevent errors
  const potentialTagIds = [
    TODAY_TAG.id, // always check today list
    ...task.tagIds,
    ...(task.subTasks || []).flatMap((st) => st.tagIds || []),
  ];

  const affectedTagIds = unique(
    potentialTagIds.filter((tagId) => state[TAG_FEATURE_NAME].entities[tagId]),
  );

  const taskIdsToRemove = [task.id, ...(task.subTaskIds || [])];

  if (task.projectId && state[PROJECT_FEATURE_NAME].entities[task.projectId]) {
    const project = getProject(state, task.projectId);
    updatedState = updateProject(updatedState, task.projectId, {
      taskIds: removeTasksFromList(project.taskIds, taskIdsToRemove),
      backlogTaskIds: removeTasksFromList(project.backlogTaskIds, taskIdsToRemove),
    });
  }

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

  // Get all task IDs including subtasks
  const allIds = taskIds.reduce((acc: string[], id: string) => {
    const task = state[TASK_FEATURE_NAME].entities[id] as Task;
    return task ? [...acc, id, ...task.subTaskIds] : [...acc, id];
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

  // Only update tags that actually contain at least one of the tasks being deleted
  const affectedTags = (state[TAG_FEATURE_NAME].ids as string[]).filter((tagId) => {
    const tag = state[TAG_FEATURE_NAME].entities[tagId];
    if (!tag) return false;
    return taskIds.some((taskId) => tag.taskIds.includes(taskId));
  });

  const tagUpdates = affectedTags.map(
    (tagId): Update<Tag> => ({
      id: tagId,
      changes: {
        taskIds: removeTasksFromList(getTag(state, tagId).taskIds, taskIds),
      },
    }),
  );

  return updateTags(updatedState, tagUpdates);
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
  const tagsToRemoveFrom = oldTagIds
    .filter((oldId) => !newTagIds.includes(oldId))
    .filter((tagId) => state[TAG_FEATURE_NAME].entities[tagId]); // Only existing tags
  const tagsToAddTo = newTagIds
    .filter((newId) => !oldTagIds.includes(newId))
    // always filter TODAY_TAG
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
