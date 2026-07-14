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
  reCalcTimesForParentIfParent,
  updateDoneOnForTask,
  updateTimeEstimateForTask,
  updateTimeSpentForTask,
} from '../../../features/tasks/store/task.reducer.util';
import { Tag } from '../../../features/tag/tag.model';
import { Project } from '../../../features/project/project.model';
import { DEFAULT_TASK, Task, TaskWithSubTasks } from '../../../features/tasks/task.model';
import { calcTotalTimeSpent } from '../../../features/tasks/util/calc-total-time-spent';
import { IN_PROGRESS_TAG, TODAY_TAG } from '../../../features/tag/tag.const';
import { unique } from '../../../util/unique';
import { appStateFeatureKey } from '../../app-state/app-state.reducer';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { moveItemAfterAnchor } from '../../../features/work-context/store/work-context-meta.helper';
import { canApplyConvertToSubTask } from '../../../features/tasks/util/can-convert-task-to-sub-task';
import {
  ActionHandlerMap,
  addTaskToList,
  addTaskToPlannerDay,
  collectTaskAndSubTaskIds,
  getProject,
  getTag,
  hasInvalidTodayTag,
  isValidTaskProjectIdUpdate,
  ProjectTaskList,
  filterOutTodayTag,
  removeTaskFromPlannerDays,
  removeTasksFromAllProjects,
  removeTasksFromAllTags,
  removeTasksFromList,
  TaskWithTags,
  updateProject,
  updateTags,
} from './task-shared-helpers';
import { plannerFeatureKey } from '../../../features/planner/store/planner.reducer';

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
  const todayStr = state[appStateFeatureKey]?.todayStr ?? getDbDateStr();
  const shouldAddToToday = task.dueDay === todayStr;

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

  // Add the task to all its tags
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
  if (task.dueDay && task.dueDay !== todayStr) {
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
  parentTagIds: string[] | undefined,
  isPlanForToday?: boolean,
  afterTaskId?: string | null,
  isDone?: boolean,
  capturedToday?: string,
  capturedDoneOn?: number,
  capturedModified?: number,
): RootState => {
  // First, get the parent task to copy its properties
  const parentTask = state[TASK_FEATURE_NAME].entities[task.parentId as string] as Task;
  if (!parentTask) {
    throw new Error('No parent for sub task');
  }

  const todayStr = capturedToday ?? state[appStateFeatureKey]?.todayStr ?? getDbDateStr();
  // `Array.isArray` guard (not `??`): a truthy non-array `parentTagIds`
  // from a captured op (seen on long-running SuperSync clients) bypasses
  // `??` and crashes the spread below. Same for `parentTask.tagIds`.
  const resolvedParentTagIds = Array.isArray(parentTagIds)
    ? parentTagIds
    : Array.isArray(parentTask.tagIds)
      ? parentTask.tagIds
      : [];
  const positionConvertedTask = (taskIds: string[]): string[] => {
    // Dropped at the start of DONE → append to the bottom of the done list.
    if (afterTaskId == null && isDone) {
      return [...removeTasksFromList(taskIds, [task.id]), task.id];
    }
    // afterTaskId === undefined (legacy callers) and null both mean "prepend",
    // which moveItemAfterAnchor already does for a null anchor.
    return moveItemAfterAnchor(task.id, afterTaskId ?? null, taskIds);
  };

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
        tagIds: (Array.isArray(parentTask.tagIds) ? parentTask.tagIds : []).filter(
          (id) => id !== TODAY_TAG.id,
        ),
        modified: capturedModified ?? Date.now(),
        ...(isPlanForToday && !task.dueWithTime
          ? {
              dueDay: todayStr,
            }
          : {}),
        // Dragging a subtask onto the work-view DONE list converts it to a
        // main task done *today* by design: the DONE list is "done today", so
        // mark it done, stamp doneOn, drop any prior schedule and set
        // dueDay=today (TODAY membership is by dueDay). This is intentional even
        // outside the Today context.
        ...(isDone !== undefined
          ? {
              isDone,
              ...(isDone
                ? {
                    doneOn: capturedDoneOn ?? Date.now(),
                    dueDay: todayStr,
                    dueWithTime: undefined,
                  }
                : {
                    doneOn: undefined,
                  }),
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
      taskIds: positionConvertedTask(project.taskIds),
    });
  }

  // Update tags - only update tags that exist
  const tagIdsToUpdate = [
    ...resolvedParentTagIds,
    ...(isPlanForToday ? [TODAY_TAG.id] : []),
  ].filter((tagId) => state[TAG_FEATURE_NAME].entities[tagId]);

  // Add the converted task to all its tags at the beginning
  const tagUpdates = tagIdsToUpdate.map(
    (tagId): Update<Tag> => ({
      id: tagId,
      changes: {
        taskIds: positionConvertedTask(getTag(updatedState, tagId).taskIds),
      },
    }),
  );

  return updateTags(updatedState, tagUpdates);
};

const handleConvertToSubTask = (
  state: RootState,
  taskId: string,
  targetParentId: string,
  afterTaskId: string | null,
): RootState => {
  const task = state[TASK_FEATURE_NAME].entities[taskId] as Task | undefined;
  const targetParent = state[TASK_FEATURE_NAME].entities[targetParentId] as
    | Task
    | undefined;

  // The `!task || !targetParent` checks also narrow the types below; the full
  // eligibility rule (incl. self-target and not-a-subtask) lives in the shared
  // guard so the section meta-reducer stays in lock-step.
  if (!task || !targetParent || !canApplyConvertToSubTask(task, targetParent)) {
    return state;
  }

  let updatedState = state;

  if (task.projectId && state[PROJECT_FEATURE_NAME].entities[task.projectId]) {
    const project = getProject(state, task.projectId);
    updatedState = updateProject(updatedState, task.projectId, {
      taskIds: removeTasksFromList(project.taskIds, [task.id]),
      backlogTaskIds: removeTasksFromList(project.backlogTaskIds, [task.id]),
    });
  }

  updatedState = removeTasksFromAllTags(updatedState, [task.id]);
  updatedState = removeTaskFromPlannerDays(updatedState, task.id);

  let taskState = updatedState[TASK_FEATURE_NAME];
  taskState = taskAdapter.updateMany(
    [
      {
        id: targetParent.id,
        changes: {
          subTaskIds: moveItemAfterAnchor(
            task.id,
            afterTaskId,
            targetParent.subTaskIds ?? [],
          ),
        },
      },
      {
        id: task.id,
        changes: {
          parentId: targetParent.id,
          projectId: targetParent.projectId,
          tagIds: [],
          dueDay: undefined,
          modified: Date.now(),
        },
      },
    ],
    taskState,
  );
  taskState = reCalcTimesForParentIfParent(targetParent.id, taskState);

  return {
    ...updatedState,
    [TASK_FEATURE_NAME]: taskState,
  };
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

  // Find affected tags from CURRENT STATE, not payload — during sync the
  // receiving client may have different tag associations, so all tags are
  // scanned (incl. the task's subtask ids) for complete cleanup.
  return removeTasksFromAllTags(updatedState, [task.id, ...(task.subTaskIds || [])]);
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

  // Remove the deleted task ids (incl. subtasks via allIds) from all tags.
  return removeTasksFromAllTags(updatedState, allIds);
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

// Legacy-op replay defense: current clients never emit a synthetic completion
// `dueDay` (completion records only `doneOn`), but ops captured by OLDER clients
// can carry `{ isDone: true, dueDay: <completionDay> }`. This strips that synthetic
// day so replaying such an op can't overwrite an existing schedule.
const sanitizeDoneScheduleChanges = (
  taskUpdate: Update<Task>,
  currentTask: Task,
  todayStr: string,
): Update<Task> => {
  const { changes } = taskUpdate;
  if (changes.isDone !== true || typeof changes.dueDay !== 'string') {
    return taskUpdate;
  }

  const hasCurrentSchedule =
    typeof currentTask.dueDay === 'string' || typeof currentTask.dueWithTime === 'number';
  if (!hasCurrentSchedule && !currentTask.parentId) {
    return taskUpdate;
  }

  const completionDay =
    typeof changes.doneOn === 'number' ? getDbDateStr(changes.doneOn) : todayStr;
  const isSyntheticCompletionDay =
    changes.dueDay === completionDay &&
    (changes.dueDay !== currentTask.dueDay || !!currentTask.parentId);

  if (!isSyntheticCompletionDay) {
    return taskUpdate;
  }

  const changesWithoutSyntheticDoneDay = { ...changes };
  delete changesWithoutSyntheticDoneDay.dueDay;
  return {
    ...taskUpdate,
    changes: changesWithoutSyntheticDoneDay,
  };
};

const removeInProgressTagOnCompletion = (
  taskUpdate: Update<Task>,
  currentTask: Task,
): Update<Task> => {
  if (taskUpdate.changes.isDone !== true) {
    return taskUpdate;
  }

  const tagIds = Array.isArray(taskUpdate.changes.tagIds)
    ? taskUpdate.changes.tagIds
    : currentTask.tagIds;
  if (!tagIds.includes(IN_PROGRESS_TAG.id)) {
    return taskUpdate;
  }

  return {
    ...taskUpdate,
    changes: {
      ...taskUpdate.changes,
      tagIds: tagIds.filter((tagId) => tagId !== IN_PROGRESS_TAG.id),
    },
  };
};

const handleUpdateTask = (
  state: RootState,
  taskUpdate: Update<Task>,
  projectMoveSubTaskIds?: string[],
): RootState => {
  const taskId = taskUpdate.id as string;
  const currentTask = state[TASK_FEATURE_NAME].entities[taskId] as Task;

  if (!currentTask) {
    return state;
  }

  let updatedState = state;
  const todayStr = state[appStateFeatureKey]?.todayStr ?? getDbDateStr();
  const sanitizedTaskUpdate = sanitizeDoneScheduleChanges(
    taskUpdate,
    currentTask,
    todayStr,
  );
  let cleanedTaskUpdate = removeInProgressTagOnCompletion(
    sanitizedTaskUpdate,
    currentTask,
  );

  // Subtasks inherit their project from the parent, and only an existing
  // project (or '' for no project) is a usable destination for a top-level
  // task. Archived projects remain valid during replay because their archive
  // op can race with this update. Strip null/undefined/unknown destinations
  // as well as at API boundaries so malformed or legacy ops can neither split
  // parent from child nor orphan a task from every project list.
  if (Object.prototype.hasOwnProperty.call(cleanedTaskUpdate.changes, 'projectId')) {
    const requestedProjectId = cleanedTaskUpdate.changes.projectId;
    if (
      typeof requestedProjectId !== 'string' ||
      !isValidTaskProjectIdUpdate(state, currentTask, requestedProjectId)
    ) {
      const changes = { ...cleanedTaskUpdate.changes };
      delete changes.projectId;
      cleanedTaskUpdate = { ...cleanedTaskUpdate, changes };
    }
  }

  // Handle tag changes if tagIds are being updated
  if (cleanedTaskUpdate.changes.tagIds) {
    const oldTagIds = currentTask.tagIds;
    const newTagIds = cleanedTaskUpdate.changes.tagIds;

    updatedState = handleTagUpdates(updatedState, taskId, oldTagIds, newTagIds);
  }

  const hasProjectIdUpdate = Object.prototype.hasOwnProperty.call(
    cleanedTaskUpdate.changes,
    'projectId',
  );
  const targetProjectId = cleanedTaskUpdate.changes.projectId;
  if (
    hasProjectIdUpdate &&
    typeof targetProjectId === 'string' &&
    !currentTask.parentId
  ) {
    const subTaskIds =
      projectMoveSubTaskIds !== undefined
        ? unique(
            projectMoveSubTaskIds.filter(
              (id) =>
                id !== taskId &&
                !Object.prototype.hasOwnProperty.call(Object.prototype, id),
            ),
          )
        : collectTaskAndSubTaskIds(state, [taskId]).filter((id) => id !== taskId);
    const allTaskIds = [taskId, ...subTaskIds];
    const targetProjectBefore =
      updatedState[PROJECT_FEATURE_NAME].entities[targetProjectId];
    const isSameProject = currentTask.projectId === targetProjectId;
    updatedState = removeTasksFromAllProjects(updatedState, allTaskIds);

    const targetProject = updatedState[PROJECT_FEATURE_NAME].entities[targetProjectId];
    if (targetProject && targetProjectBefore) {
      if (isSameProject) {
        const subTaskIdSet = new Set(subTaskIds);
        let taskIds = unique(
          targetProjectBefore.taskIds.filter((id) => !subTaskIdSet.has(id)),
        );
        let backlogTaskIds = unique(
          targetProjectBefore.backlogTaskIds.filter((id) => !subTaskIdSet.has(id)),
        );

        if (taskIds.includes(taskId)) {
          backlogTaskIds = backlogTaskIds.filter((id) => id !== taskId);
        } else if (!backlogTaskIds.includes(taskId)) {
          taskIds = [...taskIds, taskId];
        }

        updatedState = updateProject(updatedState, targetProjectId, {
          taskIds,
          backlogTaskIds,
        });
      } else {
        updatedState = updateProject(updatedState, targetProjectId, {
          taskIds: unique([...targetProject.taskIds, taskId]),
        });
      }
    }

    if (subTaskIds.length > 0) {
      updatedState = {
        ...updatedState,
        [TASK_FEATURE_NAME]: taskAdapter.updateMany(
          subTaskIds.map((id) => ({
            id,
            changes: { projectId: targetProjectId },
          })),
          updatedState[TASK_FEATURE_NAME],
        ),
      };
    }
  }

  // Handle task state updates using existing task reducer logic
  let taskState = updatedState[TASK_FEATURE_NAME];
  const { timeSpentOnDay, timeEstimate } = cleanedTaskUpdate.changes;

  taskState = timeSpentOnDay
    ? updateTimeSpentForTask(taskId, timeSpentOnDay, taskState)
    : taskState;
  taskState = updateTimeEstimateForTask(cleanedTaskUpdate, timeEstimate, taskState);
  taskState = updateDoneOnForTask(cleanedTaskUpdate, taskState);
  taskState = taskAdapter.updateOne(
    {
      ...cleanedTaskUpdate,
      changes: {
        ...cleanedTaskUpdate.changes,
        modified: Date.now(),
      },
    },
    taskState,
  );

  updatedState = {
    ...updatedState,
    [TASK_FEATURE_NAME]: taskState,
  };

  // Keep TODAY_TAG.taskIds order intact for tasks that are already scheduled for today.
  // Completing a task must not move an overdue/future scheduled task to today; doneOn
  // records completion date separately from the task's schedule.
  const isToDone = cleanedTaskUpdate.changes.isDone === true;
  if (isToDone && !currentTask.parentId && currentTask.dueDay === todayStr) {
    const todayTag = getTag(updatedState, TODAY_TAG.id);
    if (!todayTag.taskIds.includes(taskId)) {
      updatedState = updateTags(updatedState, [
        {
          id: TODAY_TAG.id,
          changes: { taskIds: [...todayTag.taskIds, taskId] },
        },
      ]);
    }
  }

  // When dueDay changes (e.g. from two-way sync pull), update planner days
  // and TODAY_TAG.taskIds to keep them consistent with the task's dueDay.
  const taskAfterUpdate = taskState.entities[taskId] as Task;
  const hasDueDayChange = Object.prototype.hasOwnProperty.call(
    cleanedTaskUpdate.changes,
    'dueDay',
  );
  const newDueDay = hasDueDayChange
    ? cleanedTaskUpdate.changes.dueDay
    : isToDone && taskAfterUpdate?.dueDay !== currentTask.dueDay
      ? taskAfterUpdate?.dueDay
      : undefined;
  if (newDueDay !== undefined && newDueDay !== currentTask.dueDay) {
    const oldDueDay = currentTask.dueDay;

    // Remove from old planner day
    updatedState = removeTaskFromPlannerDays(updatedState, taskId);

    if (newDueDay && newDueDay !== todayStr && !isToDone) {
      // Add to new planner day (not today — today uses TODAY_TAG.taskIds)
      // Skip if task is being completed in the same update to avoid re-adding to planner
      updatedState = addTaskToPlannerDay(updatedState, taskId, newDueDay, Infinity);
    }

    // Handle TODAY_TAG.taskIds updates
    const todayTag = getTag(updatedState, TODAY_TAG.id);

    if (oldDueDay === todayStr && newDueDay !== todayStr) {
      // Moving away from today — remove from TODAY_TAG.taskIds
      updatedState = updateTags(updatedState, [
        {
          id: TODAY_TAG.id,
          changes: { taskIds: todayTag.taskIds.filter((id) => id !== taskId) },
        },
      ]);
      // Remove TODAY from task.tagIds if present (legacy cleanup)
      const updatedTask = updatedState[TASK_FEATURE_NAME].entities[taskId] as Task;
      if (updatedTask && hasInvalidTodayTag(updatedTask.tagIds)) {
        updatedState = {
          ...updatedState,
          [TASK_FEATURE_NAME]: taskAdapter.updateOne(
            { id: taskId, changes: { tagIds: filterOutTodayTag(updatedTask.tagIds) } },
            updatedState[TASK_FEATURE_NAME],
          ),
        };
      }
    } else if (oldDueDay !== todayStr && newDueDay === todayStr) {
      // Moving to today — add to TODAY_TAG.taskIds for ordering
      if (!todayTag.taskIds.includes(taskId)) {
        updatedState = updateTags(updatedState, [
          {
            id: TODAY_TAG.id,
            changes: { taskIds: [...todayTag.taskIds, taskId] },
          },
        ]);
      }
    }
  }

  return updatedState;
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

  const removeUpdates = tagsToRemoveFrom.map(
    (tagId): Update<Tag> => ({
      id: tagId,
      changes: {
        taskIds: getTag(state, tagId).taskIds.filter((id) => id !== taskId),
      },
    }),
  );

  const addUpdates = tagsToAddTo.map(
    (tagId): Update<Tag> => ({
      id: tagId,
      changes: {
        taskIds: unique([taskId, ...getTag(state, tagId).taskIds]),
      },
    }),
  );

  return updateTags(state, [...removeUpdates, ...addUpdates]);
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
    const {
      task,
      parentTagIds,
      isPlanForToday,
      afterTaskId,
      isDone,
      today,
      doneOn,
      modified,
    } = action as ReturnType<typeof TaskSharedActions.convertToMainTask>;
    return handleConvertToMainTask(
      state,
      task,
      parentTagIds,
      isPlanForToday,
      afterTaskId,
      isDone,
      today,
      doneOn,
      modified,
    );
  },
  [TaskSharedActions.convertToSubTask.type]: () => {
    const { taskId, targetParentId, afterTaskId } = action as ReturnType<
      typeof TaskSharedActions.convertToSubTask
    >;
    return handleConvertToSubTask(state, taskId, targetParentId, afterTaskId);
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
    const { task, projectMoveSubTaskIds } = action as ReturnType<
      typeof TaskSharedActions.updateTask
    >;
    return handleUpdateTask(state, task, projectMoveSubTaskIds);
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
