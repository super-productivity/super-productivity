import { createSelector } from '@ngrx/store';
import {
  selectStartOfNextDayDiffMs,
  selectTodayStr,
} from '../../root-store/app-state/app-state.selectors';
import { selectAllTasksInActiveProjects } from '../../features/tasks/store/task.selectors';
import { Task } from '../../features/tasks/task.model';
import { getDbDateStr } from '../../util/get-db-date-str';
import { parseDbDateStr } from '../../util/parse-db-date-str';

export interface WeekDay {
  day: string;
  tasks: Task[];
}

export const selectWeekDays = createSelector(
  selectAllTasksInActiveProjects,
  selectTodayStr,
  selectStartOfNextDayDiffMs,
  (tasks, todayStr, startOfNextDayDiffMs): WeekDay[] => {
    const days: WeekDay[] = [];
    const dayByDate = new Map<string, WeekDay>();
    const cursor = parseDbDateStr(todayStr);
    cursor.setHours(12, 0, 0, 0);

    for (let index = 0; index < 7; index++) {
      const day = getDbDateStr(cursor);
      const weekDay: WeekDay = { day, tasks: [] };
      days.push(weekDay);
      dayByDate.set(day, weekDay);
      cursor.setDate(cursor.getDate() + 1);
    }

    for (const task of tasks) {
      const day =
        typeof task.dueWithTime === 'number'
          ? getDbDateStr(new Date(task.dueWithTime - startOfNextDayDiffMs))
          : task.dueDay;
      const weekDay = day ? dayByDate.get(day) : undefined;
      if (weekDay) {
        weekDay.tasks.push(task);
      }
    }

    return days;
  },
);
