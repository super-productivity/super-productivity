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
 * Whether a top-level task may be dropped into a subtask list. Looser than
 * `canConvertTaskToSubTask`: a time schedule or reminder does not block the
 * drop, because the drop dispatches `unscheduleTask` before `convertToSubTask`
 * (#11027). The reducer guard stays strict on purpose — released clients
 * (v18.9.0+) run the same guard on replay and would silently drop a
 * `convertToSubTask` for a still-scheduled task, diverging the task tree.
 */
export const canDropTaskIntoSubTaskList = (task: ConvertibleTaskFields): boolean =>
  canConvertTaskToSubTask({ ...task, dueWithTime: undefined, remindAt: undefined });

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
