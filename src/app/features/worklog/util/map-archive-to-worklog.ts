import { EntityState } from '@ngrx/entity';
import { Task } from '../../tasks/task.model';
import { getWeeksInMonth } from '../../../util/get-weeks-in-month';
import { getWeekNumber } from '../../../util/get-week-number';
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
const _getTimeSpentOnDay = (entities: any, task: Task): { [key: string]: number } => {
  const isTimeSpentTracked =
    task.timeSpentOnDay && !!Object.keys(task.timeSpentOnDay).length;
  if (isTimeSpentTracked) {
    return task.timeSpentOnDay;
  } else if (task.parentId) {
    const parentSpentOnDay = task.parentId && entities[task.parentId].timeSpentOnDay;
    const parentLogEntryDate =
      parentSpentOnDay &&
      (Object.keys(parentSpentOnDay)[0] ||
        getDbDateStr(entities[task.parentId].doneOn || entities[task.parentId].created));
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
        isNoRestore: noRestoreIds.includes(task.id),
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
    const year: WorklogYear = worklog[yearIN as any];
    Object.keys(year.ent).forEach((monthIN: string) => {
      const month: WorklogMonth = year.ent[monthIN as any];
      Object.keys(month.ent).forEach((dayIN: string) => {
        month.ent[dayIN as any].logEntries = sortWorklogEntriesAlphabetically(
          month.ent[dayIN as any].logEntries,
        );
      });
    });
  });

  Object.keys(worklog).forEach((yearIN: string) => {
    const year: WorklogYear = worklog[yearIN as any];
    const monthKeys = Object.keys(year.ent);
    year.monthWorked = monthKeys.length;

    monthKeys.forEach((monthIN: string) => {
      const month: WorklogMonth = worklog[yearIN as any].ent[monthIN as any];
      const days = Object.keys(month.ent);
      month.daysWorked = days.length;
      year.daysWorked += days.length;

      const weeks = getWeeksInMonth(+monthIN - 1, +yearIN, firstDayOfWeek);

      month.weeks = weeks
        .map((week) => {
          const weekForMonth: WorklogWeek = {
            ...week,
            timeSpent: 0,
            daysWorked: 0,
            ent: {},
            weekNr: getWeekNumber(
              new Date(+yearIN, +monthIN - 1, week.start),
              firstDayOfWeek,
            ),
          };

          days.forEach((dayIN: string) => {
            const day: WorklogDay = month.ent[dayIN as any];
            if (+dayIN >= week.start && +dayIN <= week.end) {
              weekForMonth.timeSpent += month.ent[dayIN as any].timeSpent;
              weekForMonth.daysWorked += 1;
              weekForMonth.ent[dayIN as any] = day;
            }
          });

          return weekForMonth;
        })
        .filter((week) => week.daysWorked > 0);
    });
  });

  return { worklog, totalTimeSpent };
};
