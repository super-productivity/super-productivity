import { Dictionary, EntityState } from '@ngrx/entity';
import { Task } from '../../tasks/task.model';
import { getWeekNumber } from '../../../util/get-week-number';
import { getWeekStartDate } from '../../../util/get-week-start-date';
import {
  Worklog,
  WorklogDataForDay,
  WorklogDay,
  WorklogMonth,
  WorklogWeek,
  WorklogYear,
} from '../worklog.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { WorkStartEnd } from '../../work-context/work-context.model';
import { formatDayStr } from '../../../util/format-day-str';
import { sortWorklogEntriesAlphabetically } from './sort-worklog-entries';

// Provides defaults to display tasks without time spent on them
const _getTimeSpentOnDay = (
  entities: Dictionary<Task>,
  task: Task,
): { [key: string]: number } => {
  const isTimeSpentTracked =
    task.timeSpentOnDay && !!Object.keys(task.timeSpentOnDay).length;
  if (isTimeSpentTracked) {
    return task.timeSpentOnDay;
  } else if (task.parentId) {
    const parentSpentOnDay = task.parentId && entities[task.parentId]!.timeSpentOnDay;
    const parentLogEntryDate =
      parentSpentOnDay &&
      (Object.keys(parentSpentOnDay)[0] ||
        getDbDateStr(
          entities[task.parentId]!.doneOn || entities[task.parentId]!.created,
        ));
    return { [parentLogEntryDate]: 1 };
  } else {
    return { [getDbDateStr(task.doneOn || task.created)]: 1 };
  }
};

export const mapArchiveToWorklog = (
  taskState: EntityState<Task>,
  noRestoreIds: string[] = [],
  startEnd: { workStart: WorkStartEnd; workEnd: WorkStartEnd },
  firstDayOfWeek: number = 1,
  locale: string,
): { worklog: Worklog; totalTimeSpent: number } => {
  const entities = taskState.entities;
  const noRestoreIdSet = new Set(noRestoreIds);
  const worklog: Worklog = {};
  let totalTimeSpent = 0;
  Object.keys(entities).forEach((id) => {
    const task = entities[id] as Task;
    const timeSpentOnDay = _getTimeSpentOnDay(entities, task);

    Object.keys(timeSpentOnDay).forEach((dateStr) => {
      const split = dateStr.split('-');
      const year = parseInt(split[0], 10);
      const month = parseInt(split[1], 10);
      const day = parseInt(split[2], 10);
      if (!worklog[year]) {
        worklog[year] = {
          timeSpent: 0,
          daysWorked: 0,
          monthWorked: 0,
          ent: {},
        };
      }
      if (!worklog[year].ent[month]) {
        worklog[year].ent[month] = {
          daysWorked: 0,
          timeSpent: 0,
          ent: {},
          weeks: [],
        };
      }
      if (!worklog[year].ent[month].ent[day]) {
        worklog[year].ent[month].ent[day] = {
          timeSpent: 0,
          logEntries: [],
          dateStr,
          dayStr: formatDayStr(dateStr, locale),
          workStart: startEnd.workStart && startEnd.workStart[dateStr],
          workEnd: startEnd.workEnd && startEnd.workEnd[dateStr],
        };
      }

      const timeSpentForTask = +timeSpentOnDay[dateStr];
      if (task.subTaskIds.length === 0) {
        worklog[year].ent[month].ent[day].timeSpent =
          worklog[year].ent[month].ent[day].timeSpent + timeSpentForTask;
        worklog[year].ent[month].timeSpent =
          worklog[year].ent[month].timeSpent + timeSpentForTask;
        worklog[year].timeSpent = worklog[year].timeSpent + timeSpentForTask;
        totalTimeSpent += timeSpentForTask;
      }

      // TODO real types
      const newItem: WorklogDataForDay = {
        task: task,
        parentId: task.parentId,
        isNoRestore: noRestoreIdSet.has(task.id),
        timeSpent: timeSpentOnDay[dateStr],
      };
      if (task.parentId) {
        // only show sub tasks in worklog when there is actually time spent on them
        if (timeSpentForTask > 0) {
          let insertIndex;
          insertIndex = worklog[year].ent[month].ent[day].logEntries.findIndex(
            // sibling
            (t) => t.task.parentId === task.parentId,
          );
          if (insertIndex === -1) {
            insertIndex = worklog[year].ent[month].ent[day].logEntries.findIndex(
              // parent
              (t) => t.task.id === task.parentId,
            );
          }

          worklog[year].ent[month].ent[day].logEntries.splice(
            insertIndex + 1,
            0,
            newItem,
          );
        }
      } else {
        worklog[year].ent[month].ent[day].logEntries.push(newItem);
      }
    });
  });

  // Sort log entries alphabetically with parent/subtask grouping
  Object.keys(worklog).forEach((yearIN: string) => {
    const year: WorklogYear = worklog[+yearIN];
    Object.keys(year.ent).forEach((monthIN: string) => {
      const month: WorklogMonth = year.ent[+monthIN];
      Object.keys(month.ent).forEach((dayIN: string) => {
        month.ent[+dayIN].logEntries = sortWorklogEntriesAlphabetically(
          month.ent[+dayIN].logEntries,
        );
      });
    });
  });

  Object.keys(worklog).forEach((yearIN: string) => {
    const year: WorklogYear = worklog[+yearIN];
    const monthKeys = Object.keys(year.ent);
    year.monthWorked = monthKeys.length;

    monthKeys.forEach((monthIN: string) => {
      const month: WorklogMonth = worklog[+yearIN].ent[+monthIN];
      const days = Object.keys(month.ent);
      month.daysWorked = days.length;
      year.daysWorked += days.length;
    });
  });

  _assignWeeksToMonths(worklog, firstDayOfWeek);

  return { worklog, totalTimeSpent };
};

// A week crossing a month boundary is kept whole (#9950) and listed in every month it
// has worked days in, like a calendar's month view showing whole weeks. Week rows of a
// month can therefore include days of the neighbouring month; month totals don't.
const _assignWeeksToMonths = (worklog: Worklog, firstDayOfWeek: number): void => {
  const weeksByStart = new Map<string, WorklogWeek>();
  const monthsByStart = new Map<string, Set<WorklogMonth>>();
  // day keys are local date strings, already shifted by the logical day offset when
  // tracked, so weeks are built from them directly
  const allDays: WorklogDay[] = Object.values(worklog)
    .flatMap((year: WorklogYear) => Object.values(year.ent))
    .flatMap((month: WorklogMonth) => Object.values(month.ent))
    .sort((a: WorklogDay, b: WorklogDay) => a.dateStr.localeCompare(b.dateStr));

  allDays.forEach((day) => {
    const [y, m, d] = day.dateStr.split('-').map((v) => parseInt(v, 10));
    const weekStart = getWeekStartDate(new Date(y, m - 1, d), firstDayOfWeek);
    // malformed keys (e.g. "undefined") only log a devError in production; keep them
    // out of weeks as before rather than breaking the whole worklog
    if (isNaN(weekStart.getTime())) {
      return;
    }
    const startDateStr = getDbDateStr(weekStart);

    let week = weeksByStart.get(startDateStr);
    if (!week) {
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      week = {
        start: weekStart.getDate(),
        end: weekEnd.getDate(),
        startDateStr,
        endDateStr: getDbDateStr(weekEnd),
        weekNr: getWeekNumber(weekStart, firstDayOfWeek),
        timeSpent: 0,
        daysWorked: 0,
        ent: {},
      };
      weeksByStart.set(startDateStr, week);
    }
    const months = monthsByStart.get(startDateStr) ?? new Set<WorklogMonth>();
    monthsByStart.set(startDateStr, months.add(worklog[y].ent[m]));
    week.timeSpent += day.timeSpent;
    week.daysWorked += 1;
    week.ent[d] = day;
  });

  // insertion order is by week start, keeping each month's weeks in date order
  weeksByStart.forEach((week, startDateStr) => {
    monthsByStart.get(startDateStr)!.forEach((month) => month.weeks.push(week));
  });
};
