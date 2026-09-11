import { Task, TaskReminderOptionId } from '../task.model';
import {
  millisecondsDiffToRemindOption,
  remindOptionToMilliseconds,
} from './remind-option-to-milliseconds';

/**
 * Keeps `remindAt` in step with a `dueWithTime` change that bypasses the
 * schedule actions (e.g. an issue-provider poll writing a remote reschedule via
 * a plain `updateTask`). Reminders fire strictly off `remindAt`, so a moved or
 * cleared `dueWithTime` must carry the reminder along in the same change.
 *
 * - unchanged or absent `dueWithTime` → changes returned as-is
 * - `dueWithTime` cleared → `remindAt` cleared (when one was set)
 * - moved, with an existing reminder → the reminder keeps its offset
 * - set for the first time → `defaultRemindCfg` decides, like the import path
 *
 * Computed at dispatch time on purpose: deriving it inside a reducer from the
 * replaying device's config would break replay determinism (sync rule 4).
 */
export const withRemindAtForDueChange = (
  task: Pick<Task, 'dueWithTime' | 'remindAt'>,
  changes: Partial<Task>,
  defaultRemindCfg: TaskReminderOptionId,
): Partial<Task> => {
  if (!Object.prototype.hasOwnProperty.call(changes, 'dueWithTime')) {
    return changes;
  }
  const newDue = changes.dueWithTime;
  if (typeof newDue !== 'number') {
    return typeof task.remindAt === 'number'
      ? { ...changes, remindAt: undefined }
      : changes;
  }
  if (newDue === task.dueWithTime) {
    return changes;
  }
  const remindCfg =
    typeof task.dueWithTime === 'number' && typeof task.remindAt === 'number'
      ? millisecondsDiffToRemindOption(task.dueWithTime, task.remindAt)
      : defaultRemindCfg;
  return { ...changes, remindAt: remindOptionToMilliseconds(newDue, remindCfg) };
};
