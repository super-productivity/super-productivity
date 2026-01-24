import {
  TaskWithoutReminder,
  TaskWithPlannedForDayIndication,
} from '../../tasks/task.model';
import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';
import { PlannerDayMap } from '../../planner/planner.model';
import {
  BlockedBlock,
  BlockedBlockByDayMap,
  ScheduleDay,
  ScheduleWorkStartEndCfg,
  SVE,
  SVEEntryForNextDay,
} from '../schedule.model';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { SCHEDULE_TASK_MIN_DURATION_IN_MS, SVEType } from '../schedule.const';
import { createViewEntriesForDay } from './create-view-entries-for-day';
import { msLeftToday } from '../../../util/ms-left-today';
import { getTasksWithinAndBeyondBudget } from './get-tasks-within-and-beyond-budget';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { selectTaskRepeatCfgsForExactDay } from '../../task-repeat-cfg/store/task-repeat-cfg.selectors';
import { Log } from '../../../core/log';

export const createScheduleDays = (
  nonScheduledTasks: TaskWithoutReminder[],
  unScheduledTaskRepeatCfgs: TaskRepeatCfg[],
  dayDates: string[],
  plannerDayMap: PlannerDayMap,
  blockerBlocksDayMap: BlockedBlockByDayMap,
  workStartEndCfg: ScheduleWorkStartEndCfg | undefined,
  now: number,
  realNow?: number, // Actual current time for determining "current week"
): ScheduleDay[] => {
  let viewEntriesPushedToNextDay: SVEEntryForNextDay[];
  let flowTasksLeftAfterDay: TaskWithoutReminder[] = nonScheduledTasks.map((task) => {
    if (task.timeEstimate === 0 && task.timeSpent === 0) {
      return {
        ...task,
        timeEstimate: SCHEDULE_TASK_MIN_DURATION_IN_MS,
      };
    }
    return task;
  });
  let beyondBudgetTasks: TaskWithoutReminder[];

  // Calculate current week boundary (today + next 6 days = 7 days total)
  // Always use real current time to determine what "current week" means
  const actualNow = realNow ?? now;
  const todayMidnight = new Date(actualNow);
  todayMidnight.setHours(0, 0, 0, 0);
  const todayStart = todayMidnight.getTime();
  const currentWeekEnd = new Date(todayMidnight);
  currentWeekEnd.setDate(currentWeekEnd.getDate() + 7);
  const currentWeekEndTime = currentWeekEnd.getTime();

  // Check if the first day is within the current week
  // If not, filter out unscheduled tasks before processing any days
  if (dayDates.length > 0) {
    const firstDayDate = dateStrToUtcDate(dayDates[0]);
    firstDayDate.setHours(0, 0, 0, 0);
    const firstDayStartTime = firstDayDate.getTime();
    const isFirstDayInCurrentWeek =
      firstDayStartTime >= todayStart && firstDayStartTime < currentWeekEndTime;

    if (!isFirstDayInCurrentWeek) {
      // Viewing a week outside the current week
      // Filter out tasks that don't belong in this week
      flowTasksLeftAfterDay = flowTasksLeftAfterDay.filter((task) => {
        const taskAsPlanned = task as TaskWithPlannedForDayIndication;

        // Keep tasks with plannedForDay (these will be filtered by plannerDayMap per day)
        if (taskAsPlanned.plannedForDay) {
          return true;
        }

        // Check if task has a dueDay that falls within or after the displayed week
        if (task.dueDay) {
          const dueDayDate = dateStrToUtcDate(task.dueDay);
          dueDayDate.setHours(0, 0, 0, 0);
          const dueDayTime = dueDayDate.getTime();
          // Only keep if due date is on or after the first day being viewed
          return dueDayTime >= firstDayStartTime;
        }

        // Check if task has a dueWithTime that falls within or after the displayed week
        if (task.dueWithTime) {
          // Only keep if due time is on or after the first day being viewed
          return task.dueWithTime >= firstDayStartTime;
        }

        // Tasks without any scheduling info are filtered out
        return false;
      });
    }
  }

  const v: ScheduleDay[] = dayDates.map((dayDate, i) => {
    const nextDayStartDate = dateStrToUtcDate(dayDate);
    nextDayStartDate.setHours(24, 0, 0, 0);
    const nextDayStart = nextDayStartDate.getTime();
    const dayStartDate = dateStrToUtcDate(dayDate);
    dayStartDate.setHours(0, 0, 0, 0);
    const dayStartTime = dayStartDate.getTime();

    // Check if this day is within the current week (today through next 6 days)
    const isInCurrentWeek =
      dayStartTime >= todayStart && dayStartTime < currentWeekEndTime;

    let startTime = i == 0 ? now : dayStartTime;
    if (workStartEndCfg) {
      const startTimeToday = getDateTimeFromClockString(
        workStartEndCfg.startTime,
        dateStrToUtcDate(dayDate),
      );
      if (startTimeToday > now) {
        startTime = startTimeToday;
      }
    }

    const nonScheduledRepeatCfgsDueOnDay = selectTaskRepeatCfgsForExactDay.projector(
      unScheduledTaskRepeatCfgs,
      {
        dayDate: startTime,
      },
    );

    const blockerBlocksForDay = blockerBlocksDayMap[dayDate] || [];

    const nonScheduledBudgetForDay = getBudgetLeftForDay(
      blockerBlocksForDay,
      i === 0 ? now : undefined,
    );

    let viewEntries: SVE[] = [];

    // Filter incoming tasks from previous day if this day is outside current week
    const filteredFlowTasks = isInCurrentWeek
      ? flowTasksLeftAfterDay
      : flowTasksLeftAfterDay.filter((task) => {
          const taskAsPlanned = task as TaskWithPlannedForDayIndication;

          // Keep tasks with plannedForDay
          if (taskAsPlanned.plannedForDay) {
            return true;
          }

          // Check if task has a dueDay that falls within or after this day
          if (task.dueDay) {
            const dueDayDate = dateStrToUtcDate(task.dueDay);
            dueDayDate.setHours(0, 0, 0, 0);
            return dueDayDate.getTime() >= dayStartTime;
          }

          // Check if task has a dueWithTime that falls within or after this day
          if (task.dueWithTime) {
            return task.dueWithTime >= dayStartTime;
          }

          return false;
        });

    const plannedForDayTasks = (plannerDayMap[dayDate] || []).map((t) => {
      return {
        ...t,
        plannedForDay: dayDate,
        ...(t.timeEstimate === 0 && t.timeSpent === 0
          ? { timeEstimate: SCHEDULE_TASK_MIN_DURATION_IN_MS }
          : {}),
      };
    }) as TaskWithPlannedForDayIndication[];
    const flowTasksForDay = [...filteredFlowTasks, ...plannedForDayTasks];
    const { beyond, within, isSomeTimeLeftForLastOverBudget } =
      getTasksWithinAndBeyondBudget(flowTasksForDay, nonScheduledBudgetForDay);

    const nonSplitBeyondTasks = (() => {
      if (isSomeTimeLeftForLastOverBudget) {
        const firstBeyond = beyond[0];
        if (firstBeyond) {
          within.push(firstBeyond as any);
        }
        return beyond.slice(1);
      }
      return beyond;
    })();

    viewEntries = createViewEntriesForDay(
      dayDate,
      startTime,
      nonScheduledRepeatCfgsDueOnDay,
      within,
      blockerBlocksForDay,
      viewEntriesPushedToNextDay,
    );
    // beyondBudgetTasks = beyond;
    beyondBudgetTasks = [];
    // For the current week (days within 7 days from today), include all tasks including unscheduled ones
    // After current week, filter out tasks that don't belong in remaining days
    flowTasksLeftAfterDay = isInCurrentWeek
      ? [...nonSplitBeyondTasks]
      : nonSplitBeyondTasks.filter((task) => {
          const taskAsPlanned = task as TaskWithPlannedForDayIndication;

          // Keep tasks with plannedForDay
          if (taskAsPlanned.plannedForDay) {
            return true;
          }

          // Check if task has a dueDay that falls on or after the next day
          if (task.dueDay) {
            const dueDayDate = dateStrToUtcDate(task.dueDay);
            dueDayDate.setHours(0, 0, 0, 0);
            return dueDayDate.getTime() >= nextDayStart;
          }

          // Check if task has a dueWithTime that falls on or after the next day
          if (task.dueWithTime) {
            return task.dueWithTime >= nextDayStart;
          }

          return false;
        });

    const viewEntriesToRenderForDay: SVE[] = [];
    viewEntriesPushedToNextDay = [];
    viewEntries.forEach((entry) => {
      if (entry.plannedForDay && entry.type === SVEType.Task) {
        entry.type = SVEType.TaskPlannedForDay;
      }

      if (entry.start >= nextDayStart) {
        if (
          entry.type === SVEType.Task ||
          entry.type === SVEType.SplitTask ||
          entry.type === SVEType.RepeatProjection ||
          entry.type === SVEType.TaskPlannedForDay ||
          entry.type === SVEType.SplitTaskContinuedLast ||
          entry.type === SVEType.SplitTaskContinued ||
          entry.type === SVEType.RepeatProjectionSplitContinued ||
          entry.type === SVEType.RepeatProjectionSplitContinuedLast
        ) {
          viewEntriesPushedToNextDay.push(entry);
        } else {
          Log.log('entry Start:', new Date(entry.start), { entry });
          Log.err('Entry start time after next day start', entry);
        }
      } else {
        if (
          entry.type === SVEType.SplitTask &&
          (entry.data as TaskWithPlannedForDayIndication).plannedForDay
        ) {
          viewEntriesToRenderForDay.push({
            ...entry,
            type: SVEType.SplitTaskPlannedForDay,
          });
        } else {
          viewEntriesToRenderForDay.push(entry);
        }
      }
    });

    // Log.log({
    //   dayDate,
    //   startTime: dateStrToUtcDate(startTime),
    //   viewEntriesPushedToNextDay,
    //   flowTasksLeftAfterDay,
    //   blockerBlocksForDay,
    //   nonScheduledBudgetForDay,
    //   beyondBudgetTasks,
    //   viewEntries,
    //   viewEntriesToRenderForDay,
    //   nonScheduledBudgetForDay2: nonScheduledBudgetForDay / 60 / 60 / 1000,
    //   within,
    //   beyond,
    //   isSomeTimeLeftForLastOverBudget,
    // });

    return {
      dayDate,
      entries: viewEntriesToRenderForDay,
      isToday: i === 0,
      beyondBudgetTasks: beyondBudgetTasks,
    };
  });

  return v;
};

const getBudgetLeftForDay = (
  blockerBlocksForDay: BlockedBlock[],
  nowIfToday?: number,
): number => {
  if (typeof nowIfToday === 'number') {
    return blockerBlocksForDay.reduce((acc, currentValue) => {
      const diff =
        Math.max(nowIfToday, currentValue.end) - Math.max(nowIfToday, currentValue.start);
      return acc - diff;
    }, msLeftToday(nowIfToday));
  }

  return blockerBlocksForDay.reduce(
    (acc, currentValue) => {
      return acc - (currentValue.end - currentValue.start);
    },
    24 * 60 * 60 * 1000,
  );
};
