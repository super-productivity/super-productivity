import { Task } from '../task.model';

/**
 * Builds the task update for marking a task as done while honoring the
 * "automatically add worked-on tasks to today" setting.
 *
 * For an unscheduled top-level task the completion day is frozen into the
 * operation here, at completion time, rather than being synthesized later by the
 * reducer (`updateDoneOnForTask`):
 *  - auto-add on  → `dueDay: todayStr` (the offset-adjusted logical day)
 *  - auto-add off → `dueDay: null`
 *
 * Freezing the decision keeps replay deterministic: the reducer applies the
 * explicit value (its `hasScheduleInUpdate` guard skips synthesis) instead of
 * re-deriving an offset-blind day from `doneOn`, and the value can't drift with
 * the (independently-ordered) synced config across devices. `null` (not
 * `undefined`) is used so the opt-out survives serialization. The reducer's own
 * synthesis remains as a fallback only for legacy ops that carry no `dueDay`.
 *
 * Scheduled tasks and subtasks are never auto-stamped, so their schedule is left
 * untouched regardless of the setting.
 */
export const getMarkDoneTaskChanges = (
  task: Task,
  isAutoAddWorkedOnToToday: boolean,
  todayStr: string,
): Partial<Task> => {
  const hasSchedule =
    typeof task.dueDay === 'string' || typeof task.dueWithTime === 'number';
  if (task.parentId || hasSchedule) {
    return { isDone: true };
  }

  return { isDone: true, dueDay: isAutoAddWorkedOnToToday ? todayStr : null };
};
