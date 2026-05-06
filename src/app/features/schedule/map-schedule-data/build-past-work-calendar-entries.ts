import { Task } from '../../tasks/task.model';
import { ScheduleCalendarMapEntry, ScheduleFromCalendarEvent } from '../schedule.model';
import { TimeTrackingState } from '../../time-tracking/time-tracking.model';
import { ScheduleConfig } from '../../config/global-config.model';
import { parseDbDateStr } from '../../../util/parse-db-date-str';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';

export const PAST_WORK_CAL_PROVIDER_ID = 'PAST_WORK';

const DEFAULT_WORK_START_HOUR = 9;

export const buildPastWorkCalendarEntries = (
  pastDays: string[],
  currentTasks: Task[],
  archiveTasks: Task[],
  ttState: TimeTrackingState | undefined,
  timelineCfg: ScheduleConfig | null | undefined,
): ScheduleCalendarMapEntry[] => {
  const allTasks = [...currentTasks, ...archiveTasks];
  const result: ScheduleCalendarMapEntry[] = [];

  for (const dateStr of pastDays) {
    const workStartMs = _getWorkStartForDay(dateStr, ttState, timelineCfg);
    const tasksForDay = allTasks
      .filter((t) => (t.timeSpentOnDay?.[dateStr] ?? 0) > 0)
      .sort((a, b) => (a.created ?? 0) - (b.created ?? 0));

    if (!tasksForDay.length) continue;

    let currentMs = workStartMs;
    const items: ScheduleFromCalendarEvent[] = tasksForDay.map((task) => {
      const duration = task.timeSpentOnDay[dateStr];
      const entry: ScheduleFromCalendarEvent = {
        id: `${PAST_WORK_CAL_PROVIDER_ID}-${task.id}-${dateStr}`,
        calProviderId: PAST_WORK_CAL_PROVIDER_ID,
        title: task.title,
        start: currentMs,
        duration,
        isReferenceCalendar: true,
        issueProviderKey: 'ICAL',
      };
      currentMs += duration;
      return entry;
    });

    result.push({ items });
  }

  return result;
};

const _getWorkStartForDay = (
  dateStr: string,
  ttState: TimeTrackingState | undefined,
  timelineCfg: ScheduleConfig | null | undefined,
): number => {
  if (ttState) {
    const starts: number[] = [];
    Object.values(ttState.project).forEach((byDate) => {
      const d = (byDate as Record<string, { s?: number }>)?.[dateStr];
      if (d?.s) starts.push(d.s);
    });
    Object.values(ttState.tag).forEach((byDate) => {
      const d = (byDate as Record<string, { s?: number }>)?.[dateStr];
      if (d?.s) starts.push(d.s);
    });
    if (starts.length) return Math.min(...starts);
  }

  const dayDate = parseDbDateStr(dateStr);
  if (timelineCfg?.isWorkStartEndEnabled && timelineCfg.workStart) {
    return getDateTimeFromClockString(timelineCfg.workStart, dayDate);
  }

  dayDate.setHours(DEFAULT_WORK_START_HOUR, 0, 0, 0);
  return dayDate.getTime();
};
