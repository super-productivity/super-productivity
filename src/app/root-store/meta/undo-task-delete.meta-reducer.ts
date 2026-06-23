import { RootState } from '../root-state';
import { Dictionary } from '@ngrx/entity';
import { Task, TaskWithSubTasks } from '../../features/tasks/task.model';
import { TaskSharedActions } from './task-shared.actions';
import { PROJECT_FEATURE_NAME } from '../../features/project/store/project.reducer';
import { TASK_FEATURE_NAME } from '../../features/tasks/store/task.reducer';
import { TAG_FEATURE_NAME } from '../../features/tag/store/tag.reducer';
import { Project } from '../../features/project/project.model';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { Log } from '../../core/log';
import { Action } from '@ngrx/store';
import type { UndoPayloadBuilder } from './undo-operation-payload.meta-reducer';

export const TASK_DELETE_UNDO_PAYLOAD_TYPE = 'TASK_DELETE';

/**
 * Payload structure for restoring a deleted task.
 * Contains all data needed to restore task entities and their associations.
 */
export interface RestoreDeletedTaskPayload {
  // The deleted task with its subtasks
  task: TaskWithSubTasks;

  // Project context (if task was in a project)
  projectContext?: {
    projectId: string;
    taskIdsForProject: string[];
    taskIdsForProjectBacklog: string[];
  };

  // Parent-child relationship (if task was a subtask)
  parentContext?: {
    parentTaskId: string;
    subTaskIds: string[];
  };

  // Tag associations (tagId -> taskIds array at time of deletion)
  tagTaskIdMap: Record<string, string[]>;

  // All deleted task entities (main task + subtasks)
  deletedTaskEntities: Dictionary<Task>;
}

export interface TaskDeleteUndoPayload {
  type: typeof TASK_DELETE_UNDO_PAYLOAD_TYPE;
  restorePayload: RestoreDeletedTaskPayload;
}

export const isTaskDeleteUndoPayload = (
  payload: unknown,
): payload is TaskDeleteUndoPayload => {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const p = payload as Partial<TaskDeleteUndoPayload>;
  return p.type === TASK_DELETE_UNDO_PAYLOAD_TYPE && !!p.restorePayload?.task?.id;
};

export const taskDeleteUndoPayloadBuilder: UndoPayloadBuilder = {
  actionType: TaskSharedActions.deleteTask.type,
  build: (state, action: Action) => {
    const { task } = action as ReturnType<typeof TaskSharedActions.deleteTask>;

    return {
      type: TASK_DELETE_UNDO_PAYLOAD_TYPE,
      restorePayload: captureTaskDeletePayload(state, task),
    };
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Creates a dictionary of all tasks to be deleted (main task + subtasks)
 */
const createDeletedTaskEntities = (task: TaskWithSubTasks): Dictionary<Task> => {
  return {
    [task.id]: task,
    ...(task.subTasks?.reduce<Dictionary<Task>>(
      (acc, subTask) => ({ ...acc, [subTask.id]: subTask }),
      {},
    ) || {}),
  };
};

/**
 * Builds a map of tag IDs to their task arrays for all deleted tasks
 */
const buildTagTaskIdMap = (
  state: RootState,
  allDeletedTasks: Task[],
): Record<string, string[]> => {
  const tagState = state[TAG_FEATURE_NAME];
  const tagMap: Record<string, string[]> = {};

  for (const task of allDeletedTasks) {
    const tagIds = [TODAY_TAG.id, ...(task.tagIds || [])];

    for (const tagId of tagIds) {
      const tag = tagState.entities[tagId];
      if (tag?.taskIds.includes(task.id) && !tagMap[tagId]) {
        tagMap[tagId] = tag.taskIds;
      }
    }
  }

  return tagMap;
};

/**
 * Captures project-specific data for a task deletion
 */
const captureProjectContext = (
  state: RootState,
  projectId: string | null,
): RestoreDeletedTaskPayload['projectContext'] | undefined => {
  if (!projectId) {
    return undefined;
  }

  const project = state[PROJECT_FEATURE_NAME].entities[projectId] as Project | undefined;
  if (!project) {
    return undefined;
  }

  if (!project.taskIds || !project.backlogTaskIds) {
    Log.err('Invalid project data:', { projectId, project });
    throw new Error('Invalid project data');
  }

  return {
    projectId,
    taskIdsForProject: project.taskIds,
    taskIdsForProjectBacklog: project.backlogTaskIds,
  };
};

/**
 * Captures the complete payload needed to restore a deleted task.
 * Called by the meta-reducer before the delete reducer runs.
 */
const captureTaskDeletePayload = (
  state: RootState,
  task: TaskWithSubTasks,
): RestoreDeletedTaskPayload => {
  const deletedTaskEntities = createDeletedTaskEntities(task);
  const allDeletedTasks = [task, ...(task.subTasks || [])];
  const tagTaskIdMap = buildTagTaskIdMap(state, allDeletedTasks);

  // Handle subtask deletion - capture parent context
  if (task.parentId) {
    const parentTask = state[TASK_FEATURE_NAME].entities[task.parentId];
    return {
      task,
      parentContext: {
        parentTaskId: task.parentId,
        subTaskIds: parentTask?.subTaskIds || [],
      },
      tagTaskIdMap,
      deletedTaskEntities,
    };
  }

  // Handle main task deletion - capture project context
  return {
    task,
    projectContext: captureProjectContext(state, task.projectId),
    tagTaskIdMap,
    deletedTaskEntities,
  };
};
