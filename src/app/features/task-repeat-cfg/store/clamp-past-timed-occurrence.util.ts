import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';

/**
 * When a repeat cfg has `startTime`, a first occurrence in the past would
 * produce a past `remindAt` and the reminder module (`reminder.module.ts`)
 * would fire a "missed reminder" popup immediately on save (#7354). Clamp
 * to today (at noon) in that case. Non-timed cfgs are left alone — past-day
 * preservation (#7344) is intentional for untimed tasks. `todayStr` is the
 * logical today, so a late-night start before the day boundary keeps its
 * own night (#3378).
 */
export const clampPastTimedOccurrence = (
  occurrence: Date | null,
  cfg: Pick<TaskRepeatCfg, 'startTime'>,
  todayStr: string,
): Date | null => {
  if (!occurrence || !cfg.startTime) {
    return occurrence;
  }
  // yyyy-mm-dd strings sort lexicographically like calendar dates
  if (getDbDateStr(occurrence) < todayStr) {
    const today = dateStrToUtcDate(todayStr);
    today.setHours(12, 0, 0, 0);
    return today;
  }
  return occurrence;
};
