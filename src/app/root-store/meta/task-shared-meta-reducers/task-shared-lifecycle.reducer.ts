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
import { Task, TaskWithSubTasks } from '../../../features/tasks/task.model';
import { TODAY_TAG } from '../../../features/tag/tag.const';
import { INBOX_PROJECT } from '../../../features/project/project.const';
import { TASK_REPEAT_CFG_FEATURE_NAME } from '../../../features/task-repeat-cfg/store/task-repeat-cfg.selectors';
import { unique } from '../../../util/unique';
import {
  ActionHandlerMap,
  collectTaskAndSubTaskIds,
  getTag,
  removeTasksFromAllProjects,
  removeTasksFromAllTags,
  TaskEntity,
  updateTags,
} from './task-shared-helpers';

// =============================================================================
// ACTION HANDLERS
// =============================================================================

const handleMoveToArchive = (state: RootState, tasks: TaskWithSubTasks[]): RootState => {
  const parentTaskIds = tasks.map((task) => task.id);
  const taskIdsToArchive = unique([
    ...collectTaskAndSubTaskIds(state, parentTaskIds),
    ...tasks.flatMap((task) => task.subTasks.map((subTask) => subTask.id)),
  ]);

  // Scan every project instead of trusting task.projectId. Older partial updates
  // could leave a task referenced by a different project than the task claims.
  const updatedState = removeTasksFromAllProjects(state, taskIdsToArchive);

  // Scan every tag, not just each task's own `tagIds` — see
  // removeTasksFromAllTags for why (one-sided tag refs after sync).
  return removeTasksFromAllTags(updatedState, taskIdsToArchive);
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
  const normalizedRestoredTask = normalizeRestoredTask(
    { ...task, isDone: false, doneOn: undefined },
    state,
  );
  const restoredTask = {
    ...normalizedRestoredTask,
    projectId: normalizedRestoredTask.projectId ?? '',
  };
  const restoredSubTasks = subTasks.map((subTask) => ({
    ...normalizeRestoredTask(subTask, state),
    projectId: restoredTask.projectId,
  }));

  const updatedTaskState = taskAdapter.addMany(
    [restoredTask as Task, ...restoredSubTasks],
    state[TASK_FEATURE_NAME],
  );

  let updatedState = removeTasksFromAllProjects(
    {
      ...state,
      [TASK_FEATURE_NAME]: updatedTaskState,
    },
    [restoredTask.id, ...restoredSubTasks.map((subTask) => subTask.id)],
  );

  // Update project
  if (restoredTask.projectId) {
    const project = updatedState[PROJECT_FEATURE_NAME].entities[restoredTask.projectId];
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
