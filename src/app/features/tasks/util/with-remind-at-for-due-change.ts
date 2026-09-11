import { Task, TaskReminderOptionId } from '../task.model';
import {
  millisecondsDiffToRemindOption,
  remindOptionToMilliseconds,
} from './remind-option-to-milliseconds';

export interface RemindAtForDueChange {
  changes: Partial<Task>;
  /**
   * The existing reminder must go. Callers clear it with a dedicated action
   * (`TaskSharedActions.dismissReminderOnly`) — never via
   * `changes.remindAt = undefined`: JSON serialization drops undefined-valued
   * keys from the op payload, so that clear would replay as a no-op on every
   * other device (#9776).
   */
  isClearRemindAt: boolean;
}

/**
 * Keeps `remindAt` in step with a `dueWithTime` change that bypasses the
 * schedule actions (e.g. an issue-provider poll writing a remote reschedule via
 * a plain `updateTask`). Reminders fire strictly off `remindAt`, so a moved or
 * cleared `dueWithTime` must carry the reminder along.
 *
 * - unchanged or absent `dueWithTime` → changes returned as-is
 * - `dueWithTime` cleared → `isClearRemindAt` (when a reminder was set)
 * - moved, with an existing reminder → the reminder keeps its offset
 * - moved, already scheduled without a reminder → stays without one (like
 *   the schedule dialog)
 * - set for the first time → `defaultRemindCfg` decides, like the import path
 *
 * `changes` never carries an undefined `remindAt`; a clear is only ever
 * signalled through `isClearRemindAt` (see there for why).
 *
 * Computed at dispatch time on purpose: deriving it inside a reducer from the
 * replaying device's config would break replay determinism (sync rule 4).
 */
export const withRemindAtForDueChange = (
  task: Pick<Task, 'dueWithTime' | 'remindAt'>,
  changes: Partial<Task>,
  defaultRemindCfg: TaskReminderOptionId,
): RemindAtForDueChange => {
  const hadReminder = typeof task.remindAt === 'number';
  if (!Object.prototype.hasOwnProperty.call(changes, 'dueWithTime')) {
    return { changes, isClearRemindAt: false };
  }
  const newDue = changes.dueWithTime;
  if (typeof newDue !== 'number') {
    return { changes, isClearRemindAt: hadReminder };
  }
  if (newDue === task.dueWithTime) {
    return { changes, isClearRemindAt: false };
  }
  const wasScheduledWithTime = typeof task.dueWithTime === 'number';
  if (wasScheduledWithTime && !hadReminder) {
    return { changes, isClearRemindAt: false };
  }
  const remindCfg = wasScheduledWithTime
    ? millisecondsDiffToRemindOption(task.dueWithTime as number, task.remindAt)
    : defaultRemindCfg;
  const remindAt = remindOptionToMilliseconds(newDue, remindCfg);
  return typeof remindAt === 'number'
    ? { changes: { ...changes, remindAt }, isClearRemindAt: false }
    : { changes, isClearRemindAt: hadReminder };
};
