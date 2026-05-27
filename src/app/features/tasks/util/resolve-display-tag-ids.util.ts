import { Task } from '../task.model';

/**
 * Resolves the tagIds that represent a task for *display* purposes. Sub-tasks
 * may carry their own tags (#7756). When they do, those win; otherwise we fall
 * back to the parent's tags so sub-tasks without explicit tags still inherit
 * the parent's context (matches the historical UX). Top-level tasks always
 * use their own tagIds.
 *
 * Do not use this in sync / op-log paths — those must read `task.tagIds`
 * verbatim, since the parent fallback is a presentation concern, not a state
 * one.
 */
export const resolveDisplayTagIds = (
  task: Pick<Task, 'tagIds'>,
  parent?: Pick<Task, 'tagIds'>,
): string[] => (task.tagIds?.length ? task.tagIds : parent?.tagIds) ?? [];
