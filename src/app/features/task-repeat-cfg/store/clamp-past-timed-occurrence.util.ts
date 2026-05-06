import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { getDbDateStr } from '../../../util/get-db-date-str';

/**
 * When a repeat cfg has `startTime`, a first occurrence in the past would
 * produce a past `remindAt` and the reminder module (`reminder.module.ts`)
 * would fire a "missed reminder" popup immediately on save (#7354). Clamp
 * to today (at noon) in that case. Non-timed cfgs are left alone — past-day
 * preservation (#7344) is intentional for untimed tasks.
 */
export const clampPastTimedOccurrence = (
  occurrence: Date | null,
  cfg: Pick<TaskRepeatCfg, 'startTime'>,
): Date | null => {
  if (!occurrence || !cfg.startTime) {
    return occurrence;
  }
  // yyyy-mm-dd strings sort lexicographically like calendar dates
  if (getDbDateStr(occurrence) < getDbDateStr()) {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return today;
  }
  return occurrence;
};
