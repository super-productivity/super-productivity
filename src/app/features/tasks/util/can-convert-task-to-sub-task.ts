import { Task } from '../task.model';

type ConvertibleTaskFields = Pick<
  Task,
  | 'parentId'
  | 'subTaskIds'
  | 'repeatCfgId'
  | 'issueId'
  | 'issueProviderId'
  | 'issueType'
  | 'dueWithTime'
  | 'reminderId'
  | 'remindAt'
>;

export const canConvertTaskToSubTask = (task: ConvertibleTaskFields): boolean =>
  !task.parentId &&
  !task.subTaskIds?.length &&
  !task.repeatCfgId &&
  !task.issueId &&
  !task.issueProviderId &&
  !task.issueType &&
  !task.dueWithTime &&
  !task.reminderId &&
  !task.remindAt;

/**
 * Whether a `convertToSubTask` op may be applied to the given (already
 * looked-up) task and target parent. Used by BOTH the section and crud
 * meta-reducers so their guards stay in lock-step — if they diverge, one
 * reducer can strip the task from its section while the other leaves it
 * top-level. Rejects a missing target, self-nesting, and nesting under a task
 * that is itself a subtask (the UI renders only two levels, so deeper nesting
 * would orphan the task and leave parent time aggregation stale).
 */
export const canApplyConvertToSubTask = (
  task: (ConvertibleTaskFields & Pick<Task, 'id'>) | undefined,
  targetParent: Pick<Task, 'id' | 'parentId'> | undefined,
): boolean =>
  !!task &&
  !!targetParent &&
  task.id !== targetParent.id &&
  !targetParent.parentId &&
  canConvertTaskToSubTask(task);
