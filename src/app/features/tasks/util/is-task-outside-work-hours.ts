import { ScheduleConfig } from '../../config/global-config.model';
import { Task } from '../task.model';
import { getTimeLeftForTask } from '../../../util/get-time-left-for-task';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { isValidSplitTime } from '../../../util/is-valid-split-time';

const MIN_TASK_DURATION = 60 * 1000;

export const isTaskOutsideWorkHours = (
  task: Pick<Task, 'dueWithTime' | 'timeEstimate' | 'timeSpent' | 'subTaskIds'>,
  scheduleConfig?: ScheduleConfig | null,
): boolean => {
  // A corrupt workStart/workEnd (an imported or synced `schedule` config is
  // taken verbatim -- never per-field defaulted, never healed) would throw
  // "Invalid clock string" out of a signal computed and take the schedule
  // dialog down (#5358). Unknown work hours simply means "cannot tell", so no
  // warning -- and no devError, since this runs on every recomputation.
  if (
    !scheduleConfig?.isWorkStartEndEnabled ||
    typeof task.dueWithTime !== 'number' ||
    !isValidSplitTime(scheduleConfig.workStart) ||
    !isValidSplitTime(scheduleConfig.workEnd)
  ) {
    return false;
  }

  const dayDate = dateStrToUtcDate(getDbDateStr(task.dueWithTime));
  const workStart = getDateTimeFromClockString(scheduleConfig.workStart, dayDate);
  const workEnd = getDateTimeFromClockString(scheduleConfig.workEnd, dayDate);
  const taskEnd =
    task.dueWithTime + Math.max(getTimeLeftForTask(task as Task), MIN_TASK_DURATION);

  return task.dueWithTime < workStart || taskEnd > workEnd;
};
