import { Dictionary } from '@ngrx/entity';
import { MAX_TASK_DEPTH, Task, TaskWithSubTasks } from '../task.model';

/**
 * Pure helpers for walking the task tree (issue #2657). The persisted model is
 * an adjacency list (`parentId` + `subTaskIds`), so these operate over the NgRx
 * entity dictionary. Every walk is cycle-safe (a malformed `parentId` loop must
 * never hang the app) and the depth cap (MAX_TASK_DEPTH) is the backstop.
 */
type TaskEntities = Dictionary<Task>;

/** All descendant ids of `taskId` (children, grandchildren, …), depth-first. */
export const getDescendantIds = (taskId: string, entities: TaskEntities): string[] => {
  const result: string[] = [];
  // Seed with the root so a malformed cycle can't list it as its own descendant.
  const visited = new Set<string>([taskId]);
  const walk = (id: string): void => {
    const task = entities[id];
    if (!task?.subTaskIds) {
      return;
    }
    for (const childId of task.subTaskIds) {
      if (visited.has(childId)) {
        continue;
      }
      visited.add(childId);
      result.push(childId);
      walk(childId);
    }
  };
  walk(taskId);
  return result;
};

/** Ancestor ids from the immediate parent up to the root. */
export const getAncestorIds = (taskId: string, entities: TaskEntities): string[] => {
  const result: string[] = [];
  const visited = new Set<string>([taskId]);
  let current = entities[taskId]?.parentId;
  while (current && !visited.has(current)) {
    visited.add(current);
    result.push(current);
    current = entities[current]?.parentId;
  }
  return result;
};

/** 1-based depth of a task: a top-level task is depth 1. */
export const getTaskDepth = (taskId: string, entities: TaskEntities): number =>
  getAncestorIds(taskId, entities).length + 1;

/** Height of the subtree rooted at `taskId`, in levels (a leaf = 1). */
export const getSubtreeHeight = (taskId: string, entities: TaskEntities): number => {
  const visited = new Set<string>();
  const heightOf = (id: string): number => {
    const task = entities[id];
    if (!task?.subTaskIds?.length || visited.has(id)) {
      return 1;
    }
    visited.add(id);
    let maxChild = 0;
    for (const childId of task.subTaskIds) {
      maxChild = Math.max(maxChild, heightOf(childId));
    }
    return maxChild + 1;
  };
  return heightOf(taskId);
};

/**
 * Whether `movingId` (and its whole subtree) may be nested under
 * `targetParentId` without exceeding MAX_TASK_DEPTH. Also rejects nesting a task
 * under itself or one of its own descendants (which would create a cycle).
 */
export const canNestUnder = (
  movingId: string,
  targetParentId: string,
  entities: TaskEntities,
): boolean => {
  if (movingId === targetParentId) {
    return false;
  }
  if (getDescendantIds(movingId, entities).includes(targetParentId)) {
    return false;
  }
  const targetDepth = getTaskDepth(targetParentId, entities);
  const movingHeight = getSubtreeHeight(movingId, entities);
  return targetDepth + movingHeight <= MAX_TASK_DEPTH;
};

/**
 * Build the recursive `TaskWithSubTasks` view-model for `task`, resolving
 * sub-tasks up to `depthBudget` more levels. The default budget (MAX_TASK_DEPTH)
 * is a safety backstop against malformed/cyclic data — real trees stop earlier
 * because creation is depth-capped.
 */
export const buildTaskWithSubTasks = (
  task: Task,
  entities: TaskEntities,
  depthBudget: number = MAX_TASK_DEPTH,
  visited: Set<string> = new Set<string>(),
): TaskWithSubTasks => {
  if (depthBudget <= 1 || !task.subTaskIds?.length || visited.has(task.id)) {
    return { ...task, subTasks: [] };
  }
  const nextVisited = new Set(visited);
  nextVisited.add(task.id);
  const subTasks: TaskWithSubTasks[] = [];
  for (const id of task.subTaskIds) {
    const subTask = entities[id];
    if (subTask && !nextVisited.has(id)) {
      subTasks.push(
        buildTaskWithSubTasks(subTask, entities, depthBudget - 1, nextVisited),
      );
    }
  }
  return { ...task, subTasks };
};
