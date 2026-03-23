import { Task } from '../tasks/task.model';
import { getDbDateStr } from '../../util/get-db-date-str';

export interface RepeatTaskSeriesTimeSpent {
  total: number;
  thisWeek: number;
  thisMonth: number;
}

export const calcRepeatTaskSeriesTimeSpent = (
  tasks: Task[],
  now: Date = new Date(),
): RepeatTaskSeriesTimeSpent => {
  const weekStart = getIsoWeekStart(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekStartStr = getDbDateStr(weekStart);
  const monthStartStr = getDbDateStr(monthStart);
  const todayStr = getDbDateStr(now);

  let total = 0;
  let thisWeek = 0;
  let thisMonth = 0;

  for (const task of tasks) {
    if (!task.timeSpentOnDay) {
      continue;
    }
    for (const dateStr of Object.keys(task.timeSpentOnDay)) {
      const ms = task.timeSpentOnDay[dateStr];
      if (ms <= 0) {
        continue;
      }
      total += ms;
      if (dateStr >= weekStartStr && dateStr <= todayStr) {
        thisWeek += ms;
      }
      if (dateStr >= monthStartStr && dateStr <= todayStr) {
        thisMonth += ms;
      }
    }
  }

  return { total, thisWeek, thisMonth };
};

const getIsoWeekStart = (date: Date): Date => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
};
