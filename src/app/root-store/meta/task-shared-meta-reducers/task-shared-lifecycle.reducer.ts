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
import { Tag } from '../../../features/tag/tag.model';
import { Project } from '../../../features/project/project.model';
import { Task, TaskWithSubTasks } from '../../../features/tasks/task.model';
import { TODAY_TAG } from '../../../features/tag/tag.const';
import { INBOX_PROJECT } from '../../../features/project/project.const';
import { TASK_REPEAT_CFG_FEATURE_NAME } from '../../../features/task-repeat-cfg/store/task-repeat-cfg.selectors';
import { unique } from '../../../util/unique';
import {
  ActionHandlerMap,
  getProject,
  getTag,
  removeTasksFromList,
  TaskEntity,
  updateTags,
} from './task-shared-helpers';

// =============================================================================
// ACTION HANDLERS
// =============================================================================

const handleMoveToArchive = (state: RootState, tasks: TaskWithSubTasks[]): RootState => {
  const taskIdsToArchive = tasks.flatMap((t) => [t.id, ...t.subTasks.map((st) => st.id)]);

  // Get tag/project associations from CURRENT STATE, not payload.
  // This is critical for remote sync: the payload reflects the originating client's
  // state, but this client may have different tag/project associations for the same tasks.
  // Using current state ensures we clean up all references on THIS client.
  const projectIds = unique(
    taskIdsToArchive
      .map((taskId) => state[TASK_FEATURE_NAME].entities[taskId]?.projectId)
      .filter((pid): pid is string => !!pid),
  );

  let updatedState = state;

  if (projectIds.length > 0) {
    const projectUpdates = projectIds
      .filter((pid) => !!state[PROJECT_FEATURE_NAME].entities[pid])
      .map((pid): Update<Project> => {
        const project = getProject(state, pid);
        return {
          id: pid,
          changes: {
            taskIds: removeTasksFromList(project.taskIds, taskIdsToArchive),
            backlogTaskIds: removeTasksFromList(project.backlogTaskIds, taskIdsToArchive),
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

  // Get tag associations from CURRENT STATE for the same reason as above.
  // Always include TODAY_TAG to ensure cleanup even if tasks aren't in it.
  const affectedTagIds = unique([
    TODAY_TAG.id,
    ...taskIdsToArchive.flatMap((taskId) => {
      const task = state[TASK_FEATURE_NAME].entities[taskId];
      return task?.tagIds ?? [];
    }),
  ]);

  const tagUpdates = affectedTagIds
    .filter((tagId) => !!state[TAG_FEATURE_NAME].entities[tagId])
    .map(
      (tagId): Update<Tag> => ({
        id: tagId,
        changes: {
          taskIds: removeTasksFromList(getTag(state, tagId).taskIds, taskIdsToArchive),
        },
      }),
    );

  return updateTags(updatedState, tagUpdates);
};

/**
 * Normalizes stale references on a task being restored from archive.
 * Archives may have refs to deleted projects/tags/repeatCfgs (see #6270).
 * We clean these up during restore so the active task passes validation.
 */
const normalizeRestoredTask = <T extends TaskEntity | Task>(
  t: T,
  state: RootState,
): T => {
  // Reassign stale projectId to INBOX
  let projectId = t.projectId;
  if (projectId && !state[PROJECT_FEATURE_NAME].entities[projectId]) {
    projectId = state[PROJECT_FEATURE_NAME].entities[INBOX_PROJECT.id]
      ? INBOX_PROJECT.id
      : undefined;
  }

  // Strip stale tagIds and TODAY_TAG (must never be in task.tagIds)
  const tagIds = (t.tagIds || []).filter(
    (tagId) => tagId !== TODAY_TAG.id && !!state[TAG_FEATURE_NAME].entities[tagId],
  );

  // Clear stale repeatCfgId (only present on full Task, not minimal TaskEntity)
  const src = t as Record<string, unknown>;
  const repeatCfgId =
    src['repeatCfgId'] &&
    (state as any)[TASK_REPEAT_CFG_FEATURE_NAME]?.entities?.[src['repeatCfgId'] as string]
      ? src['repeatCfgId']
      : undefined;

  return { ...t, projectId, tagIds, repeatCfgId } as T;
};

const handleRestoreTask = (
  state: RootState,
  task: TaskEntity,
  subTasks: Task[],
): RootState => {
  // Normalize stale refs before adding to active state
  const restoredTask = normalizeRestoredTask(
    { ...task, isDone: false, doneOn: undefined },
    state,
  );
  const restoredSubTasks = subTasks.map((st) => normalizeRestoredTask(st, state));

  const updatedTaskState = taskAdapter.addMany(
    [restoredTask as Task, ...restoredSubTasks],
    state[TASK_FEATURE_NAME],
  );

  let updatedState = {
    ...state,
    [TASK_FEATURE_NAME]: updatedTaskState,
  };

  // Update project
  if (restoredTask.projectId) {
    const project = state[PROJECT_FEATURE_NAME].entities[restoredTask.projectId];
    if (project) {
      updatedState = {
        ...updatedState,
        [PROJECT_FEATURE_NAME]: projectAdapter.updateOne(
          {
            id: restoredTask.projectId,
            changes: {
              taskIds: unique([...project.taskIds, restoredTask.id]),
            },
          },
          updatedState[PROJECT_FEATURE_NAME],
        ),
      };
    }
  }

  // Update tags
  const allTasks = [restoredTask, ...restoredSubTasks];
  const tagTaskMap = allTasks.reduce(
    (map, t) => {
      (t.tagIds || []).forEach((tagId) => {
        if (!map[tagId]) map[tagId] = [];
        map[tagId].push(t.id);
      });
      return map;
    },
    {} as Record<string, string[]>,
  );

  const tagUpdates = Object.entries(tagTaskMap)
    .filter(([tagId]) => state[TAG_FEATURE_NAME].entities[tagId])
    .map(
      ([tagId, taskIds]): Update<Tag> => ({
        id: tagId,
        changes: {
          taskIds: unique([...getTag(updatedState, tagId).taskIds, ...taskIds]),
        },
      }),
    );

  return updateTags(updatedState, tagUpdates);
};

// =============================================================================
// META REDUCER
// =============================================================================

const createActionHandlers = (state: RootState, action: Action): ActionHandlerMap => ({
  [TaskSharedActions.moveToArchive.type]: () => {
    const { tasks } = action as ReturnType<typeof TaskSharedActions.moveToArchive>;
    return handleMoveToArchive(state, tasks);
  },
  [TaskSharedActions.restoreTask.type]: () => {
    const { task, subTasks } = action as ReturnType<typeof TaskSharedActions.restoreTask>;
    return handleRestoreTask(state, task, subTasks);
  },
});

export const taskSharedLifecycleMetaReducer: MetaReducer = (
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
