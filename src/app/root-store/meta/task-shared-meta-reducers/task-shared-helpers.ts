import { Update } from '@ngrx/entity';
import { RootState } from '../../root-state';
import { Tag } from '../../../features/tag/tag.model';
import { Project } from '../../../features/project/project.model';
import { Task } from '../../../features/tasks/task.model';
import {
  TASK_FEATURE_NAME,
  taskAdapter,
} from '../../../features/tasks/store/task.reducer';
import {
  PROJECT_FEATURE_NAME,
  projectAdapter,
} from '../../../features/project/store/project.reducer';
import { TAG_FEATURE_NAME, tagAdapter } from '../../../features/tag/store/tag.reducer';
import {
  plannerFeatureKey,
  PlannerState,
} from '../../../features/planner/store/planner.reducer';
import { unique } from '../../../util/unique';
import { TODAY_TAG } from '../../../features/tag/tag.const';

// =============================================================================
// TYPES
// =============================================================================

export type ProjectTaskList = 'backlogTaskIds' | 'taskIds';
export type TaskEntity = {
  id: string;
  projectId?: string | null;
  tagIds?: string[];
  subTaskIds?: string[];
};
export type TaskWithTags = Task & { tagIds: string[] };
export type ActionHandler = (state: RootState) => RootState;
export type ActionHandlerMap = Record<string, ActionHandler>;

// =============================================================================
// STATE UPDATE HELPERS
// =============================================================================

export const updateProject = (
  state: RootState,
  projectId: string,
  changes: Partial<Project>,
): RootState => ({
  ...state,
  [PROJECT_FEATURE_NAME]: projectAdapter.updateOne(
    { id: projectId, changes },
    state[PROJECT_FEATURE_NAME],
  ),
});

export const updateTags = (state: RootState, updates: Update<Tag>[]): RootState => ({
  ...state,
  [TAG_FEATURE_NAME]: tagAdapter.updateMany(updates, state[TAG_FEATURE_NAME]),
});

/**
 * Collects parent task IDs plus children found through either side of the
 * parent/subtask relationship. The reverse lookup mirrors deleteTaskHelper's
 * protection against sync races where parent.subTaskIds is incomplete.
 * `payloadSubTaskIds` covers replay on clients where neither side of the
 * relationship has arrived yet (children only known from the action payload).
 */
export const collectTaskAndSubTaskIds = (
  state: RootState,
  parentTaskIds: string[],
  payloadSubTaskIds: string[] | undefined = [],
): string[] => {
  const parentIdSet = new Set(parentTaskIds);
  const taskIds = new Set([...parentTaskIds, ...(payloadSubTaskIds ?? [])]);
  const taskState = state[TASK_FEATURE_NAME];

  for (const parentTaskId of parentTaskIds) {
    const parentTask = taskState.entities[parentTaskId];
    for (const subTaskId of parentTask?.subTaskIds ?? []) {
      taskIds.add(subTaskId);
    }
  }

  for (const taskId of taskState.ids as string[]) {
    const task = taskState.entities[taskId];
    if (task?.parentId && parentIdSet.has(task.parentId)) {
      taskIds.add(taskId);
    }
  }

  return Array.from(taskIds);
};

export const isValidTaskProjectIdUpdate = (
  state: RootState,
  task: Task,
  projectId: string,
): boolean =>
  !task.parentId && (projectId === '' || !!getProjectOrUndefined(state, projectId));

/**
 * Removes the given task IDs from every tag's `taskIds`. Scans ALL tags from
 * the CURRENT state (not a payload-provided list or the task's own `tagIds`)
 * so sync replays with divergent tag associations are fully cleaned up: a
 * receiving client can hold a one-sided `tag.taskIds` → task reference even
 * when the task's own `tagIds` omits that tag, and only scanning `tagIds`
 * would leave it dangling. Uses a Set for O(1) lookup; tags that reference
 * none of the ids are left untouched.
 */
export const removeTasksFromAllTags = (
  state: RootState,
  taskIds: string[],
): RootState => {
  if (taskIds.length === 0) return state;

  const taskIdSet = new Set(taskIds);
  const tagUpdates = (state[TAG_FEATURE_NAME].ids as string[])
    .map((tagId) => state[TAG_FEATURE_NAME].entities[tagId])
    .filter((tag): tag is Tag => !!tag && tag.taskIds.some((id) => taskIdSet.has(id)))
    .map(
      (tag): Update<Tag> => ({
        id: tag.id,
        changes: {
          taskIds: tag.taskIds.filter((id) => !taskIdSet.has(id)),
        },
      }),
    );
  return updateTags(state, tagUpdates);
};

/**
 * Removes the given task IDs from every project's regular and backlog lists.
 * Scanning all projects also repairs one-sided references left by older clients
 * or partial updates where task.projectId no longer matches the containing list.
 */
export const removeTasksFromAllProjects = (
  state: RootState,
  taskIds: string[],
): RootState => {
  if (taskIds.length === 0) return state;

  const taskIdSet = new Set(taskIds);
  const projectUpdates = (state[PROJECT_FEATURE_NAME].ids as string[])
    .map((projectId) => state[PROJECT_FEATURE_NAME].entities[projectId])
    .filter(
      (project): project is Project =>
        !!project &&
        ((project.taskIds ?? []).some((id) => taskIdSet.has(id)) ||
          (project.backlogTaskIds ?? []).some((id) => taskIdSet.has(id))),
    )
    .map(
      (project): Update<Project> => ({
        id: project.id,
        changes: {
          taskIds: (project.taskIds ?? []).filter((id) => !taskIdSet.has(id)),
          backlogTaskIds: (project.backlogTaskIds ?? []).filter(
            (id) => !taskIdSet.has(id),
          ),
        },
      }),
    );

  if (projectUpdates.length === 0) {
    return state;
  }

  return {
    ...state,
    [PROJECT_FEATURE_NAME]: projectAdapter.updateMany(
      projectUpdates,
      state[PROJECT_FEATURE_NAME],
    ),
  };
};

/**
 * Repairs a root task's project relationship after an LWW update. New LWW
 * operations derived from project moves carry the source operation's entityIds,
 * which are the deterministic move footprint. Legacy LWW operations have no
 * such footprint and fall back to deriving children from receiving state.
 *
 * Every project is scanned so stale one-sided references are removed. The
 * destination project's existing root placement (regular vs backlog) and
 * ordering are preserved when possible; subtasks never belong in either list.
 */
export const repairTaskProjectForLww = (
  state: RootState,
  task: Pick<Task, 'id' | 'projectId' | 'subTaskIds'>,
  targetProjectId: string | undefined,
  operationTaskIds?: string[],
): RootState => {
  const targetProject = targetProjectId
    ? getProjectOrUndefined(state, targetProjectId)
    : undefined;

  // Project creation can arrive after a task recreation LWW. Preserve that
  // out-of-order task snapshot until the referenced project is replayed.
  if (targetProjectId && !targetProject) return state;

  const allTaskIds = unique(
    operationTaskIds !== undefined
      ? [task.id, ...operationTaskIds]
      : collectTaskAndSubTaskIds(state, [task.id], task.subTaskIds),
  ).filter((id) => !Object.prototype.hasOwnProperty.call(Object.prototype, id));
  let updatedState = removeTasksFromAllProjects(state, allTaskIds);

  if (targetProjectId && targetProject) {
    const childIds = new Set(allTaskIds.filter((id) => id !== task.id));
    let taskIds = unique((targetProject.taskIds ?? []).filter((id) => !childIds.has(id)));
    let backlogTaskIds = unique(
      (targetProject.backlogTaskIds ?? []).filter((id) => !childIds.has(id)),
    );

    if (taskIds.includes(task.id)) {
      backlogTaskIds = backlogTaskIds.filter((id) => id !== task.id);
    } else if (!backlogTaskIds.includes(task.id)) {
      taskIds = [...taskIds, task.id];
    }

    updatedState = updateProject(updatedState, targetProjectId, {
      taskIds,
      backlogTaskIds,
    });
  }

  const taskUpdates: Update<Task>[] = allTaskIds.map((id) => ({
    id,
    changes: { projectId: targetProjectId },
  }));

  return {
    ...updatedState,
    [TASK_FEATURE_NAME]: taskAdapter.updateMany(
      taskUpdates,
      updatedState[TASK_FEATURE_NAME],
    ),
  };
};

// =============================================================================
// ENTITY GETTERS
// =============================================================================

/**
 * Gets a tag entity from state. Throws if tag doesn't exist.
 * Callers should check existence before calling if tag may not exist.
 */
export const getTag = (state: RootState, tagId: string): Tag => {
  const tag = getTagOrUndefined(state, tagId);
  if (!tag) {
    throw new Error(
      `Tag ${tagId} not found in state. This may indicate an out-of-order remote operation.`,
    );
  }
  return tag as Tag;
};

export const getTagOrUndefined = (state: RootState, tagId: string): Tag | undefined => {
  const tag = state[TAG_FEATURE_NAME].entities[tagId] as Tag | undefined;
  return tag?.id === tagId ? tag : undefined;
};

/**
 * Gets a project entity from state. Throws if project doesn't exist.
 * Callers should check existence before calling if project may not exist.
 */
export const getProject = (state: RootState, projectId: string): Project => {
  const project = state[PROJECT_FEATURE_NAME].entities[projectId];
  // The id equality check rejects inherited Object.prototype members
  // ('constructor', 'toString', …) that a bare entities[id] lookup returns
  // truthy for when the id comes from external input (REST API, remote ops).
  if (!project || project.id !== projectId) {
    throw new Error(
      `Project ${projectId} not found in state. This may indicate an out-of-order remote operation.`,
    );
  }
  return project as Project;
};

/**
 * Gets a project entity from state, or undefined if it doesn't exist.
 * Use this when the project may not exist (e.g., during remote sync).
 */
export const getProjectOrUndefined = (
  state: RootState,
  projectId: string,
): Project | undefined => {
  const project = state[PROJECT_FEATURE_NAME].entities[projectId] as Project | undefined;
  return project?.id === projectId ? project : undefined;
};

// =============================================================================
// LIST MANIPULATION HELPERS
// =============================================================================

export const addTaskToList = (
  taskIds: string[],
  taskId: string,
  isAddToBottom: boolean,
): string[] => {
  if (taskIds.includes(taskId)) return taskIds;
  return isAddToBottom ? [...taskIds, taskId] : [taskId, ...taskIds];
};

export const removeTasksFromList = (taskIds: string[], toRemove: string[]): string[] => {
  // Use Set for O(1) lookup instead of O(n) Array.includes
  // This changes overall complexity from O(n*m) to O(n+m)
  const removeSet = new Set(toRemove);
  return taskIds.filter((id) => !removeSet.has(id));
};

// =============================================================================
// PLANNER DAY HELPERS
// =============================================================================

/**
 * Removes a single task from all planner days.
 * @param state Root state
 * @param taskId Task ID to remove
 * @returns Updated state, or original state if no changes
 */
export const removeTaskFromPlannerDays = (
  state: RootState,
  taskId: string,
): RootState => {
  if (!state.planner?.days) {
    return state;
  }

  const plannerDaysCopy = { ...state.planner.days };
  let hasChanges = false;

  Object.keys(plannerDaysCopy).forEach((day) => {
    const filtered = plannerDaysCopy[day].filter((id) => id !== taskId);
    if (filtered.length !== plannerDaysCopy[day].length) {
      plannerDaysCopy[day] = filtered;
      hasChanges = true;
    }
  });

  if (!hasChanges) {
    return state;
  }

  return {
    ...state,
    [plannerFeatureKey]: {
      ...state.planner,
      days: plannerDaysCopy,
    },
  };
};

/**
 * Removes multiple tasks from all planner days.
 * @param state Root state
 * @param taskIds Task IDs to remove
 * @returns Updated state, or original state if no changes
 */
export const removeTasksFromPlannerDays = (
  state: RootState,
  taskIds: string[],
): RootState => {
  if (!state.planner?.days || taskIds.length === 0) {
    return state;
  }

  const taskIdSet = new Set(taskIds);
  const plannerDaysCopy = { ...state.planner.days };
  let hasChanges = false;

  Object.keys(plannerDaysCopy).forEach((day) => {
    const filtered = plannerDaysCopy[day].filter((id) => !taskIdSet.has(id));
    if (filtered.length !== plannerDaysCopy[day].length) {
      plannerDaysCopy[day] = filtered;
      hasChanges = true;
    }
  });

  if (!hasChanges) {
    return state;
  }

  return {
    ...state,
    [plannerFeatureKey]: {
      ...state.planner,
      days: plannerDaysCopy,
    },
  };
};

/**
 * Adds a task to a specific planner day.
 * Removes the task from all other days first (task can only be in one day).
 * @param state Root state
 * @param taskId Task ID to add
 * @param day Target day (date string)
 * @param position Optional position index (default: top of list)
 * @returns Updated state
 */
export const addTaskToPlannerDay = (
  state: RootState,
  taskId: string,
  day: string,
  position: number = 0,
): RootState => {
  const plannerState = state[
    plannerFeatureKey as keyof RootState
  ] as unknown as PlannerState;
  const daysCopy = { ...(plannerState?.days || {}) };

  // First remove from all days
  Object.keys(daysCopy).forEach((d) => {
    if (daysCopy[d].includes(taskId)) {
      daysCopy[d] = daysCopy[d].filter((id: string) => id !== taskId);
    }
  });

  // Add to target day at position
  const targetDays = daysCopy[day] || [];
  daysCopy[day] = unique([
    ...targetDays.slice(0, position),
    taskId,
    ...targetDays.slice(position),
  ]);

  return {
    ...state,
    [plannerFeatureKey]: {
      ...plannerState,
      days: daysCopy,
    },
  };
};

// =============================================================================
// TODAY_TAG HELPERS
// =============================================================================

/**
 * Removes TODAY_TAG from a task's tagIds if present.
 *
 * TODAY_TAG is a virtual tag where membership is determined by task.dueDay,
 * not by task.tagIds. This helper cleans up legacy data and ensures the
 * invariant that TODAY_TAG should NEVER be in task.tagIds.
 *
 * See: docs/ai/today-tag-architecture.md
 *
 * @param tagIds Current task tagIds
 * @returns Updated tagIds with TODAY_TAG removed, or original if not present
 */
export const filterOutTodayTag = (tagIds: string[]): string[] =>
  tagIds.filter((id) => id !== TODAY_TAG.id);

/**
 * Checks if a task has TODAY_TAG in its tagIds (legacy/incorrect data).
 * @param tagIds Current task tagIds
 * @returns true if TODAY_TAG is incorrectly present
 */
export const hasInvalidTodayTag = (tagIds: string[]): boolean =>
  tagIds.includes(TODAY_TAG.id);
