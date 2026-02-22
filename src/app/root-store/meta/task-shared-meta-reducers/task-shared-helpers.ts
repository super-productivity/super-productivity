import { Update } from '@ngrx/entity';
import { RootState } from '../../root-state';
import { Tag } from '../../../features/tag/tag.model';
import { Project } from '../../../features/project/project.model';
import { Task } from '../../../features/tasks/task.model';
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
export type TaskEntity = { id: string; projectId?: string | null; tagIds?: string[] };
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

// =============================================================================
// ENTITY GETTERS
// =============================================================================

/**
 * Gets a tag entity from state. Throws if tag doesn't exist.
 * Callers should check existence before calling if tag may not exist.
 */
export const getTag = (state: RootState, tagId: string): Tag => {
  const tag = state[TAG_FEATURE_NAME].entities[tagId];
  if (!tag) {
    throw new Error(
      `Tag ${tagId} not found in state. This may indicate an out-of-order remote operation.`,
    );
  }
  return tag as Tag;
};

/**
 * Gets a tag entity from state, or undefined if it doesn't exist.
 * Use this when the tag may not exist (e.g., during remote sync).
 */
export const getTagOrUndefined = (state: RootState, tagId: string): Tag | undefined =>
  state[TAG_FEATURE_NAME].entities[tagId] as Tag | undefined;

/**
 * Gets a project entity from state. Throws if project doesn't exist.
 * Callers should check existence before calling if project may not exist.
 */
export const getProject = (state: RootState, projectId: string): Project => {
  const project = state[PROJECT_FEATURE_NAME].entities[projectId];
  if (!project) {
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
): Project | undefined =>
  state[PROJECT_FEATURE_NAME].entities[projectId] as Project | undefined;

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
