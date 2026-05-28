import { ScheduleConfig } from '../../config/global-config.model';
import { Task } from '../task.model';
import { getTimeLeftForTask } from '../../../util/get-time-left-for-task';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';

const MIN_TASK_DURATION = 60 * 1000;

export const isTaskOutsideWorkHours = (
  task: Pick<Task, 'dueWithTime' | 'timeEstimate' | 'timeSpent' | 'subTaskIds'>,
  scheduleConfig?: ScheduleConfig | null,
): boolean => {
  if (!scheduleConfig?.isWorkStartEndEnabled || typeof task.dueWithTime !== 'number') {
    return false;
  }

  const dayDate = dateStrToUtcDate(getDbDateStr(task.dueWithTime));
  const workStart = getDateTimeFromClockString(scheduleConfig.workStart, dayDate);
  const workEnd = getDateTimeFromClockString(scheduleConfig.workEnd, dayDate);
  const taskEnd =
    task.dueWithTime + Math.max(getTimeLeftForTask(task as Task), MIN_TASK_DURATION);

  return task.dueWithTime < workStart || taskEnd > workEnd;
};
