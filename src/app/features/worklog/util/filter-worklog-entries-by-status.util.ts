import {
  Worklog,
  WorklogDataForDay,
  WorklogDay,
  WorklogMonth,
  WorklogWeek,
  WorklogYear,
} from '../worklog.model';

export type WorklogTaskStatusFilter = 'ALL' | 'DONE' | 'UNDONE';

export const filterWorklogEntriesByStatus = (
  entries: WorklogDataForDay[],
  filter: WorklogTaskStatusFilter,
): WorklogDataForDay[] => {
  switch (filter) {
    case 'DONE':
      return entries.filter((entry) => entry.task.isDone);
    case 'UNDONE':
      return entries.filter((entry) => !entry.task.isDone);
    case 'ALL':
    default:
      return entries;
  }
};

export const getTimeSpentForWorklogEntries = (entries: WorklogDataForDay[]): number =>
  entries.reduce((total, entry) => {
    const isLeafTask = (entry.task.subTaskIds?.length ?? 0) === 0;
    return isLeafTask ? total + entry.timeSpent : total;
  }, 0);

const _getTimeSpentForDays = (days: { [key: number]: WorklogDay }): number =>
  Object.values(days).reduce((total, day) => total + day.timeSpent, 0);

const _filterDayByStatus = (
  day: WorklogDay,
  filter: WorklogTaskStatusFilter,
): WorklogDay | null => {
  const logEntries = filterWorklogEntriesByStatus(day.logEntries, filter);

  return logEntries.length
    ? {
        ...day,
        logEntries,
        timeSpent: getTimeSpentForWorklogEntries(logEntries),
      }
    : null;
};

const _filterWeekByDays = (
  week: WorklogWeek,
  filteredDays: { [key: number]: WorklogDay },
): WorklogWeek | null => {
  const ent = Object.keys(week.ent).reduce(
    (acc, dayKey) => {
      const day = filteredDays[+dayKey];
      if (day) {
        acc[+dayKey] = day;
      }
      return acc;
    },
    {} as { [key: number]: WorklogDay },
  );
  const daysWorked = Object.keys(ent).length;

  return daysWorked
    ? {
        ...week,
        daysWorked,
        ent,
        timeSpent: _getTimeSpentForDays(ent),
      }
    : null;
};

export const filterWorklogByTaskStatus = (
  worklogData: { worklog: Worklog; totalTimeSpent: number },
  filter: WorklogTaskStatusFilter,
): { worklog: Worklog; totalTimeSpent: number } => {
  if (filter === 'ALL') {
    return worklogData;
  }

  const worklog: Worklog = {};
  let totalTimeSpent = 0;

  (Object.entries(worklogData.worklog) as [string, WorklogYear][]).forEach(
    ([yearKey, year]) => {
      const yearEnt: WorklogYear['ent'] = {};
      let daysWorkedForYear = 0;
      let monthWorked = 0;
      let timeSpentForYear = 0;

      (Object.entries(year.ent) as [string, WorklogMonth][]).forEach(
        ([monthKey, month]) => {
          const monthEnt = (Object.entries(month.ent) as [string, WorklogDay][]).reduce(
            (acc, [dayKey, day]) => {
              const filteredDay = _filterDayByStatus(day, filter);
              if (filteredDay) {
                acc[+dayKey] = filteredDay;
              }
              return acc;
            },
            {} as { [key: number]: WorklogDay },
          );
          const daysWorked = Object.keys(monthEnt).length;

          if (!daysWorked) {
            return;
          }

          const timeSpent = _getTimeSpentForDays(monthEnt);
          yearEnt[+monthKey] = {
            ...month,
            daysWorked,
            ent: monthEnt,
            timeSpent,
            weeks: month.weeks
              .map((week) => _filterWeekByDays(week, monthEnt))
              .filter((week): week is WorklogWeek => !!week),
          };

          daysWorkedForYear += daysWorked;
          monthWorked += 1;
          timeSpentForYear += timeSpent;
        },
      );

      if (monthWorked) {
        worklog[+yearKey] = {
          ...year,
          daysWorked: daysWorkedForYear,
          ent: yearEnt,
          monthWorked,
          timeSpent: timeSpentForYear,
        };
        totalTimeSpent += timeSpentForYear;
      }
    },
  );

  return { worklog, totalTimeSpent };
};
