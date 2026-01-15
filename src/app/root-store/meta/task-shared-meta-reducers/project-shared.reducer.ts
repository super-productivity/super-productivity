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
import { TIME_TRACKING_FEATURE_KEY } from '../../../features/time-tracking/store/time-tracking.reducer';
import { TimeTrackingState } from '../../../features/time-tracking/time-tracking.model';
import { Tag } from '../../../features/tag/tag.model';
import { Task, TaskWithSubTasks } from '../../../features/tasks/task.model';
import { unique } from '../../../util/unique';
import {
  ActionHandlerMap,
  getProject,
  getTag,
  removeTasksFromList,
  updateProject,
  updateTags,
} from './task-shared-helpers';
import { TASK_REPEAT_CFG_FEATURE_NAME } from '../../../features/task-repeat-cfg/store/task-repeat-cfg.selectors';
import { TaskRepeatCfgState } from '../../../features/task-repeat-cfg/task-repeat-cfg.model';
import { adapter as taskRepeatCfgAdapter } from '../../../features/task-repeat-cfg/store/task-repeat-cfg.selectors';

/**
 * Extended state type that includes feature stores not in RootState.
 * Meta-reducers have access to ALL store state.
 */
interface ExtendedState extends RootState {
  [TASK_REPEAT_CFG_FEATURE_NAME]?: TaskRepeatCfgState;
}

// =============================================================================
// ACTION HANDLERS
// =============================================================================

const handleMoveToOtherProject = (
  state: RootState,
  task: TaskWithSubTasks,
  targetProjectId: string,
): RootState => {
  const taskState = state[TASK_FEATURE_NAME];
  const canonicalTask = taskState.entities[task.id] as Task | undefined;
  const canonicalSubTaskIds = unique([
    ...(canonicalTask?.subTaskIds ?? []),
    ...(task.subTaskIds ?? []),
  ]);
  const currentProjectId = canonicalTask?.projectId ?? task.projectId;
  const allTaskIds = unique([task.id, ...canonicalSubTaskIds]);

  let updatedState = state;

  // Remove tasks from current project if it exists
  if (currentProjectId && state[PROJECT_FEATURE_NAME].entities[currentProjectId]) {
    const currentProject = getProject(state, currentProjectId);
    updatedState = updateProject(updatedState, currentProjectId, {
      taskIds: removeTasksFromList(currentProject.taskIds, allTaskIds),
      backlogTaskIds: removeTasksFromList(currentProject.backlogTaskIds, allTaskIds),
    });
  }

  // Add tasks to target project
  if (state[PROJECT_FEATURE_NAME].entities[targetProjectId]) {
    const targetProject = getProject(updatedState, targetProjectId);
    // Only add the parent task to the task list, not subtasks
    // Subtasks are displayed through their parent's subTaskIds property
    updatedState = updateProject(updatedState, targetProjectId, {
      taskIds: unique([...targetProject.taskIds, task.id]),
    });
  }

  // Update all tasks with new projectId
  const taskUpdates: Update<Task>[] = allTaskIds.map((id) => ({
    id,
    changes: {
      projectId: targetProjectId,
    },
  }));

  updatedState = {
    ...updatedState,
    [TASK_FEATURE_NAME]: taskAdapter.updateMany(
      taskUpdates,
      updatedState[TASK_FEATURE_NAME],
    ),
  };

  return updatedState;
};

/**
 * Removes deleted project from TIME_TRACKING state.
 * Only handles current state - archive cleanup must stay in effect (async).
 */
const cleanupTimeTrackingForProject = (
  timeTrackingState: TimeTrackingState | undefined,
  projectId: string,
): TimeTrackingState | undefined => {
  if (!timeTrackingState) return timeTrackingState;
  if (!(projectId in timeTrackingState.project)) return timeTrackingState;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [projectId]: _, ...remainingProjects } = timeTrackingState.project;
  return {
    ...timeTrackingState,
    project: remainingProjects,
  };
};

/**
 * Deletes all task repeat configs when their project is deleted.
 * Repeat configs are always deleted regardless of whether they have tags,
 * because they are tied to the project's workflow.
 */
const cleanupTaskRepeatCfgsForProject = (
  taskRepeatCfgState: TaskRepeatCfgState | undefined,
  projectId: string,
): TaskRepeatCfgState | undefined => {
  if (!taskRepeatCfgState) return taskRepeatCfgState;

  const cfgIdsToDelete: string[] = [];

  Object.values(taskRepeatCfgState.entities).forEach((cfg) => {
    if (!cfg || cfg.projectId !== projectId) return;
    cfgIdsToDelete.push(cfg.id as string);
  });

  if (cfgIdsToDelete.length === 0) {
    return taskRepeatCfgState;
  }

  return taskRepeatCfgAdapter.removeMany(cfgIdsToDelete, taskRepeatCfgState);
};

const handleDeleteProject = (
  state: ExtendedState,
  projectId: string,
  allTaskIds: string[],
): ExtendedState => {
  const tagUpdates = (state[TAG_FEATURE_NAME].ids as string[]).map(
    (tagId): Update<Tag> => ({
      id: tagId,
      changes: {
        taskIds: removeTasksFromList(getTag(state, tagId).taskIds, allTaskIds),
      },
    }),
  );

  // First update tags
  const stateWithUpdatedTags = updateTags(state, tagUpdates) as ExtendedState;

  // Cleanup TIME_TRACKING for deleted project
  const updatedTimeTracking = cleanupTimeTrackingForProject(
    stateWithUpdatedTags[TIME_TRACKING_FEATURE_KEY],
    projectId,
  );

  // Cleanup TASK_REPEAT_CFG for deleted project
  const updatedTaskRepeatCfgState = cleanupTaskRepeatCfgsForProject(
    stateWithUpdatedTags[TASK_REPEAT_CFG_FEATURE_NAME],
    projectId,
  );

  // Then remove the project entity
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [projectId]: _, ...remainingEntities } =
    stateWithUpdatedTags[PROJECT_FEATURE_NAME].entities;
  const remainingIds = (
    stateWithUpdatedTags[PROJECT_FEATURE_NAME].ids as string[]
  ).filter((id) => id !== projectId);

  return {
    ...stateWithUpdatedTags,
    ...(updatedTimeTracking && {
      [TIME_TRACKING_FEATURE_KEY]: updatedTimeTracking,
    }),
    ...(updatedTaskRepeatCfgState && {
      [TASK_REPEAT_CFG_FEATURE_NAME]: updatedTaskRepeatCfgState,
    }),
    [PROJECT_FEATURE_NAME]: {
      ...stateWithUpdatedTags[PROJECT_FEATURE_NAME],
      ids: remainingIds,
      entities: remainingEntities,
    },
  };
};

// =============================================================================
// META REDUCER
// =============================================================================

const createActionHandlers = (
  state: ExtendedState,
  action: Action,
): ActionHandlerMap => ({
  [TaskSharedActions.moveToOtherProject.type]: () => {
    const { task, targetProjectId } = action as ReturnType<
      typeof TaskSharedActions.moveToOtherProject
    >;
    return handleMoveToOtherProject(state, task, targetProjectId);
  },
  [TaskSharedActions.deleteProject.type]: () => {
    const { projectId, allTaskIds } = action as ReturnType<
      typeof TaskSharedActions.deleteProject
    >;
    return handleDeleteProject(state, projectId, allTaskIds);
  },
});

export const projectSharedMetaReducer: MetaReducer = (
  reducer: ActionReducer<any, Action>,
) => {
  return (state: unknown, action: Action) => {
    if (!state) return reducer(state, action);

    const extendedState = state as ExtendedState;
    const actionHandlers = createActionHandlers(extendedState, action);
    const handler = actionHandlers[action.type];
    const updatedState = handler ? handler(extendedState) : extendedState;

    return reducer(updatedState, action);
  };
};
