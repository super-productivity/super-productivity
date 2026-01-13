import { EntityState } from '@ngrx/entity';
import { Task } from '../../tasks/task.model';
import { getWeekNumber } from '../../../util/get-week-number';
import { WorklogYearsWithWeeks } from '../worklog.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { WorkStartEnd } from '../../work-context/work-context.model';
import { formatDayMonthStr } from '../../../util/format-day-month-str';
import { DateTimeLocale } from 'src/app/core/locale.constants';
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
      (Object.keys(parentSpentOnDay)[0] || getDbDateStr(entities[task.parentId].created));
    return { [parentLogEntryDate]: 1 };
  } else {
    return { [getDbDateStr(task.created)]: 1 };
  }
};

export const mapArchiveToWorklogWeeks = (
  taskState: EntityState<Task>,
  noRestoreIds: string[] = [],
  startEnd: { workStart: WorkStartEnd; workEnd: WorkStartEnd },
  firstDayOfWeek: number = 1,
  locale: DateTimeLocale,
): WorklogYearsWithWeeks => {
  const entities = taskState.entities;
  const worklogYearsWithSimpleWeeks: WorklogYearsWithWeeks = {};

  Object.keys(entities).forEach((id) => {
    const task = entities[id] as Task;
    const timeSpentOnDay = _getTimeSpentOnDay(entities, task);

    Object.keys(timeSpentOnDay).forEach((dateStr) => {
      const split = dateStr.split('-');
      const year = parseInt(split[0], 10);
      const month = parseInt(split[1], 10);
      const day = parseInt(split[2], 10);
      const weekNr = getWeekNumber(new Date(+year, +month - 1, day), firstDayOfWeek);
      const weekNrIndex = month === 1 && weekNr >= 52 ? 0 : weekNr;

      if (!worklogYearsWithSimpleWeeks[year]) {
        worklogYearsWithSimpleWeeks[year] = [];
      }
      if (!worklogYearsWithSimpleWeeks[year][weekNrIndex]) {
        worklogYearsWithSimpleWeeks[year][weekNrIndex] = {
          daysWorked: 0,
          ent: {},
          weekNr,
          timeSpent: 0,
        };
      }
      if (!worklogYearsWithSimpleWeeks[year][weekNrIndex].ent[day]) {
        worklogYearsWithSimpleWeeks[year][weekNrIndex].ent[day] = {
          timeSpent: 0,
          logEntries: [],
          dateStr,
          dayStr: formatDayMonthStr(dateStr, locale),
          workStart: startEnd.workStart && startEnd.workStart[dateStr],
          workEnd: startEnd.workEnd && startEnd.workEnd[dateStr],
        };
      }

      if (task.subTaskIds.length === 0) {
        const timeSpentForTask = +timeSpentOnDay[dateStr];
        worklogYearsWithSimpleWeeks[year][weekNrIndex].ent[day].timeSpent =
          worklogYearsWithSimpleWeeks[year][weekNrIndex].ent[day].timeSpent +
          timeSpentForTask;
        worklogYearsWithSimpleWeeks[year][weekNrIndex].timeSpent =
          worklogYearsWithSimpleWeeks[year][weekNrIndex].timeSpent + timeSpentForTask;
      }

      const newItem: any = {
        task,
        parentId: task.parentId,
        isNoRestore: noRestoreIds.includes(task.id),
        timeSpent: timeSpentOnDay[dateStr],
      };
      if (task.parentId) {
        let insertIndex;
        insertIndex = worklogYearsWithSimpleWeeks[year][weekNrIndex].ent[
          day
        ].logEntries.findIndex(
          // sibling
          (t) => t.task.parentId === task.parentId,
        );
        if (insertIndex === -1) {
          insertIndex = worklogYearsWithSimpleWeeks[year][weekNrIndex].ent[
            day
          ].logEntries.findIndex(
            // parent
            (t) => t.task.id === task.parentId,
          );
        }

        worklogYearsWithSimpleWeeks[year][weekNrIndex].ent[day].logEntries.splice(
          insertIndex + 1,
          0,
          newItem,
        );
      } else {
        worklogYearsWithSimpleWeeks[year][weekNrIndex].ent[day].logEntries.push(newItem);
      }

      // worklogYearsWithSimpleWeeks[year][weekNrKey].timeSpent += timeSpentOnDay;
      // worklogYearsWithSimpleWeeks[year][weekNrKey].ent[day] =
    });
  });

  // Sort log entries alphabetically with parent/subtask grouping
  Object.keys(worklogYearsWithSimpleWeeks).forEach((yearIN: string) => {
    const weeks = worklogYearsWithSimpleWeeks[yearIN as any];
    weeks.forEach((week) => {
      if (week) {
        Object.keys(week.ent).forEach((dayIN: string) => {
          week.ent[dayIN as any].logEntries = sortWorklogEntriesAlphabetically(
            week.ent[dayIN as any].logEntries,
          );
        });
      }
    });
  });

  return worklogYearsWithSimpleWeeks;
};
