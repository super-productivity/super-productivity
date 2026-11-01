import { BoardPanelCfg, BoardPanelCfgTaskDoneState } from '../boards.model';
import { firstSpecificProjectId, isAllProjects } from '../boards.util';
import { getChangesToMatch } from '../../tasks/task-criteria/task-criteria';
import {
  TaskCriteria,
  TaskCriteriaCtx,
  TaskMatchChanges,
} from '../../tasks/task-criteria/task-criteria.model';
import { TaskCopy } from '../../tasks/task.model';

/**
 * A panel's rules applied to tasks, without rendering: what a task needs to
 * enter, what a new task gets, and the panel's order. Shared by both ways a
 * panel shows its tasks (cards and task rows).
 */

/** Whether any of the tags doesn't exist. */
export const hasMissingTag = (
  tagIds: readonly string[],
  existingTagIds: ReadonlySet<string>,
): boolean => tagIds.some((id) => !existingTagIds.has(id));

/**
 * What the task needs to match the panel (`getChangesToMatch`), or `null`
 * when no change can make it match, which includes a change that would add a
 * tag that doesn't exist (a view naming a tag not created yet): the task
 * would point to a missing tag. Every path that applies the panel's rules to
 * a task goes through here.
 */
export const getPanelChangesToMatch = (
  task: TaskCopy,
  criteria: TaskCriteria,
  ctx: TaskCriteriaCtx,
  existingTagIds: ReadonlySet<string>,
): TaskMatchChanges | null => {
  const changes = getChangesToMatch(task, criteria, ctx);
  if (!changes?.tagIds) return changes;
  const added = changes.tagIds.filter((id) => !task.tagIds.includes(id));
  return hasMissingTag(added, existingTagIds) ? null : changes;
};

/**
 * Tags to auto-apply on a new task created from the panel (its "+" or the
 * add-task bar).
 * - AND mode (default): all required tags.
 * - OR mode: just the first required tag (one is enough).
 */
export const getNewTaskTagsToAdd = (cfg: BoardPanelCfg): string[] => {
  if (!cfg.includedTagIds?.length) return [];
  return cfg.includedTagsMatch === 'any' ? [cfg.includedTagIds[0]] : cfg.includedTagIds;
};

/**
 * Tags to strip from user input on a new task created from the panel.
 * - OR mode (default): strip all excluded (any match disqualifies the task).
 * - AND mode: don't strip. add-task-bar applies this list blindly against the
 *   user's typed tags, so stripping "one excluded tag" would wrongly remove a
 *   single tag the user legitimately entered (task still wouldn't hit the
 *   AND-all exclusion). If the user somehow types every excluded tag, the
 *   new task simply won't appear in this panel on next filter pass.
 */
export const getNewTaskTagsToRemove = (cfg: BoardPanelCfg): string[] => {
  if (!cfg.excludedTagIds?.length) return [];
  return cfg.excludedTagsMatch === 'all' ? [] : cfg.excludedTagIds;
};

/**
 * The fields a new task gets on creation: tags, done state, project and
 * priority. Dates, deadline and backlog are applied after creation
 * (`afterTaskAdd`).
 */
export const getNewTaskFields = (
  cfg: BoardPanelCfg,
  criteria: TaskCriteria,
): Partial<TaskCopy> => {
  const tagsToAdd = getNewTaskTagsToAdd(cfg);
  const priority = criteria.priority;
  const firstProjectId = isAllProjects(cfg.projectIds)
    ? undefined
    : firstSpecificProjectId(cfg.projectIds);
  return {
    ...(tagsToAdd.length ? { tagIds: tagsToAdd } : {}),
    ...(cfg.taskDoneState === BoardPanelCfgTaskDoneState.Done ? { isDone: true } : {}),
    ...(cfg.taskDoneState === BoardPanelCfgTaskDoneState.UnDone ? { isDone: false } : {}),
    ...(firstProjectId ? { projectId: firstProjectId } : {}),
    ...(typeof priority === 'number' ? { priority } : {}),
  };
};

/**
 * The panel's tasks in its order: the stored manual order first (the first
 * occurrence of a repeated id counts), then matches it doesn't list yet; a
 * sort, when set, orders the result.
 */
export const orderPanelTasks = (
  matched: readonly TaskCopy[],
  taskIds: readonly string[],
  sort?: { cmp: (a: TaskCopy, b: TaskCopy) => number; dir: 1 | -1 },
): TaskCopy[] => {
  const taskOrder = new Map<string, number>();
  taskIds.forEach((id, index) => {
    if (!taskOrder.has(id)) {
      taskOrder.set(id, index);
    }
  });
  const ordered: TaskCopy[] = [];
  const unordered: TaskCopy[] = [];
  for (const task of matched) {
    const index = taskOrder.get(task.id);
    if (index !== undefined) {
      ordered[index] = task;
    } else {
      unordered.push(task);
    }
  }
  const merged = [...ordered, ...unordered].filter((t) => !!t);
  if (sort) {
    merged.sort((a, b) => sort.dir * sort.cmp(a, b));
  }
  return merged;
};

/** The panel's order with `ids` moved to `index` (counted without them). */
export const placeInOrder = (
  orderIds: readonly string[],
  ids: readonly string[],
  index: number,
): string[] => {
  const moving = new Set(ids);
  const remaining = orderIds.filter((id) => !moving.has(id));
  remaining.splice(index, 0, ...ids);
  return remaining;
};

/**
 * How many items of a part (main or done) a panel renders before "Show all":
 * thousands of cards or rows take seconds to render, and a column that long
 * isn't read to its end. Local to the panel, never stored or synced.
 */
export const PANEL_SHOWN_LIMIT = 100;

/**
 * Where a drop lands in the panel's order (counted without the moving ids):
 * after the rendered item before the drop marker, as task lists place rows.
 * `currentIndex` is CDK's index among the rendered items, which don't
 * include the dragged one when it comes from the same list (`draggedId`).
 * Items not rendered (past the limit, the done group) keep their place.
 */
export const getDropIndex = (
  orderIds: readonly string[],
  renderedIds: readonly string[],
  movingIds: ReadonlySet<string>,
  currentIndex: number,
  draggedId?: string,
): number => {
  const before = renderedIds
    .filter((id) => id !== draggedId)
    .slice(0, currentIndex)
    .filter((id) => !movingIds.has(id));
  const anchor = before[before.length - 1];
  if (anchor === undefined) return 0;
  return orderIds.filter((id) => !movingIds.has(id)).indexOf(anchor) + 1;
};

/**
 * The panel's order with the ids of one part (its open cards) in
 * `partOrder`: they take the places the part had, so the other ids (the done
 * group) stay where they are.
 */
export const withPartOrder = (
  orderIds: readonly string[],
  partOrder: readonly string[],
): string[] => {
  const part = new Set(partOrder);
  let next = 0;
  return orderIds.map((id) => (part.has(id) ? partOrder[next++] : id));
};
