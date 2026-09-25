import { Task } from './task.model';

/**
 * Pure helpers for bulk actions on a multi-selection. Kept free of Angular so
 * the semantics (dedupe, ordering, eligibility) are unit-testable in isolation.
 */

/**
 * Splits a selection into the tasks an action can operate on. A subtask whose
 * parent is also selected is a duplicate for cascading actions (delete, move to
 * project) and is dropped; a subtask selected on its own is kept.
 */
export const dedupeSubtasksOfSelectedParents = (tasks: Task[]): Task[] => {
  const ids = new Set(tasks.map((t) => t.id));
  return tasks.filter((t) => !t.parentId || !ids.has(t.parentId));
};

/** Top-level tasks only; subtasks are reported so the caller can say so. */
export const splitParentOnly = (
  tasks: Task[],
): { eligible: Task[]; skippedSubtasks: Task[] } => {
  const eligible: Task[] = [];
  const skippedSubtasks: Task[] = [];
  tasks.forEach((t) => (t.parentId ? skippedSubtasks : eligible).push(t));
  return { eligible, skippedSubtasks };
};

/**
 * Done is applied per task (there is no parent→subtask cascade in the app).
 * Subtasks go first so the opt-in "mark parent done when all subtasks are
 * done" effect cannot double-dispatch, and the currently tracked task goes
 * last so auto-start-next-task cannot hop through the selection.
 */
export const orderForMarkDone = (tasks: Task[], currentTaskId: string | null): Task[] => {
  const rank = (t: Task): number => (t.id === currentTaskId ? 2 : t.parentId ? 0 : 1);
  return [...tasks].sort((a, b) => rank(a) - rank(b));
};

/** Any undone task in the selection → mark all done; else mark all undone. */
export const resolveDoneIntent = (tasks: Task[]): 'done' | 'undone' =>
  tasks.some((t) => !t.isDone) ? 'done' : 'undone';

/** All selected tasks carry the tag → remove it from all; else add it to all. */
export const resolveTagIntent = (tasks: Task[], tagId: string): 'add' | 'remove' =>
  tasks.length > 0 && tasks.every((t) => t.tagIds.includes(tagId)) ? 'remove' : 'add';

/** Dedupe recurring instances by config so each config is handled once. */
export const dedupeByRepeatCfg = (tasks: Task[]): Task[] => {
  const seenCfgIds = new Set<string>();
  return tasks.filter((t) => {
    if (!t.repeatCfgId) {
      return true;
    }
    if (seenCfgIds.has(t.repeatCfgId)) {
      return false;
    }
    seenCfgIds.add(t.repeatCfgId);
    return true;
  });
};

/**
 * Exclude a project from the move target list only if *every* selected task is
 * already in it; a mixed-project selection must be able to consolidate.
 */
export const getCommonProjectId = (tasks: Task[]): string | null => {
  if (!tasks.length) {
    return null;
  }
  const first = tasks[0].projectId ?? null;
  return tasks.every((t) => (t.projectId ?? null) === first) ? first : null;
};
