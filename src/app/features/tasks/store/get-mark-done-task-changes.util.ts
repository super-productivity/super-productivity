import { Task } from '../task.model';

/**
 * Builds the task update for marking a task as done while honoring the
 * "automatically add worked-on tasks to today" setting.
 *
 * For an unscheduled top-level task, `updateDoneOnForTask` stamps the completion
 * day as `dueDay` so finished work lands on today. When the user disabled
 * auto-add, we suppress that stamp by passing an explicit `dueDay: null`: the
 * reducer treats any `dueDay` present in the update as an explicit schedule
 * change and skips the synthesis (`hasScheduleInUpdate`). `null` (not
 * `undefined`) is used so the decision is carried inside the operation and
 * survives serialization — replay then reproduces it deterministically instead
 * of re-deriving it from the (independently-ordered) synced config.
 *
 * Scheduled tasks and subtasks are never auto-stamped, so they need no
 * suppression regardless of the setting.
 */
export const getMarkDoneTaskChanges = (
  task: Task,
  isAutoAddWorkedOnToToday: boolean,
): Partial<Task> => {
  const hasSchedule =
    typeof task.dueDay === 'string' || typeof task.dueWithTime === 'number';
  const wouldStampCompletionDay = !task.parentId && !hasSchedule;

  return wouldStampCompletionDay && !isAutoAddWorkedOnToToday
    ? { isDone: true, dueDay: null }
    : { isDone: true };
};
