import {
  TaskCopy,
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

type ScheduleFlowTask = TaskWithoutReminder | TaskWithPlannedForDayIndication;

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
  let flowTasksLeftAfterDay: ScheduleFlowTask[] = nonScheduledTasks.map((task) => {
    if (task.timeEstimate === 0 && task.timeSpent === 0) {
      return {
        ...task,
        timeEstimate: SCHEDULE_TASK_MIN_DURATION_IN_MS,
      };
    }
    return task;
  });
  let beyondBudgetTasks: ScheduleFlowTask[];

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
      flowTasksLeftAfterDay = flowTasksLeftAfterDay.filter((task) =>
        isTaskOnOrAfterDay(task, firstDayStartTime),
      );
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
    const filteredFlowTasks: ScheduleFlowTask[] = isInCurrentWeek
      ? flowTasksLeftAfterDay
      : flowTasksLeftAfterDay.filter((task) => {
          return isTaskOnOrAfterDay(task, dayStartTime);
        });

    const plannedForDayTasks = (plannerDayMap[dayDate] || []).map((t) =>
      asPlannedForDayTask(t, dayDate),
    );
    const flowTasksForDay = uniqueTasksById([
      ...filteredFlowTasks.flatMap((task): ScheduleFlowTask[] => {
        if (isPlannedForDayTask(task)) {
          return task.plannedForDay === dayDate ? [task] : [];
        }
        if (task.dueDay) {
          return task.dueDay === dayDate ? [asPlannedForDayTask(task, dayDate)] : [];
        }
        return [task];
      }),
      ...plannedForDayTasks,
    ]);
    const { beyond, within, isSomeTimeLeftForLastOverBudget } =
      getTasksWithinAndBeyondBudget(flowTasksForDay, nonScheduledBudgetForDay);

    const overBudgetTaskIds = new Set<string>();
    const partiallyVisibleBeyondTask = isSomeTimeLeftForLastOverBudget
      ? beyond[0]
      : undefined;
    if (partiallyVisibleBeyondTask) {
      within.push(partiallyVisibleBeyondTask);
      if (isDayAssignedTask(partiallyVisibleBeyondTask)) {
        overBudgetTaskIds.add(partiallyVisibleBeyondTask.id);
      }
    }
    const fullyBeyondTasks = isSomeTimeLeftForLastOverBudget ? beyond.slice(1) : beyond;
    const dayAssignedBeyondBudgetTasks = fullyBeyondTasks.filter(isDayAssignedTask);
    const nonSplitBeyondTasks = fullyBeyondTasks.filter(
      (task) => !isDayAssignedTask(task),
    );

    viewEntries = createViewEntriesForDay(
      dayDate,
      startTime,
      nonScheduledRepeatCfgsDueOnDay,
      within,
      blockerBlocksForDay,
      viewEntriesPushedToNextDay,
    );
    beyondBudgetTasks = dayAssignedBeyondBudgetTasks;
    // For the current week (days within 7 days from today), include all tasks including unscheduled ones
    // After current week, filter out tasks that don't belong in remaining days
    const futureDayAssignedTasks = filteredFlowTasks.filter(
      (task) => isDayAssignedTask(task) && isTaskOnOrAfterDay(task, nextDayStart),
    );
    flowTasksLeftAfterDay = uniqueTasksById([
      ...(isInCurrentWeek
        ? [...nonSplitBeyondTasks]
        : nonSplitBeyondTasks.filter((task) => {
            return isTaskOnOrAfterDay(task, nextDayStart);
          })),
      ...futureDayAssignedTasks,
    ]);

    const viewEntriesToRenderForDay: SVE[] = [];
    viewEntriesPushedToNextDay = [];
    viewEntries.forEach((entry) => {
      const taskId = getEntryTaskId(entry);
      if (taskId && overBudgetTaskIds.has(taskId)) {
        entry.isBeyondBudget = true;
      }

      if (entry.plannedForDay && entry.type === SVEType.Task) {
        entry.type = SVEType.TaskPlannedForDay;
      }

      if (isDayAssignedEntry(entry) && entry.start + entry.duration > nextDayStart) {
        if (taskId) {
          markEntriesForTaskAsBeyondBudget(viewEntriesToRenderForDay, taskId);
        }
        entry.isBeyondBudget = true;
        if (entry.start < nextDayStart) {
          viewEntriesToRenderForDay.push(
            normalizeDayAssignedEntry({
              ...entry,
              duration: Math.max(0, nextDayStart - entry.start),
            }),
          );
          return;
        }

        if (taskId && hasEntryForTask(viewEntriesToRenderForDay, taskId)) {
          return;
        }
        beyondBudgetTasks = uniqueTasksById([
          ...beyondBudgetTasks,
          entry.data as ScheduleFlowTask,
        ]);
        return;
      }

      if (entry.start >= nextDayStart) {
        if (isDayAssignedEntry(entry)) {
          if (taskId) {
            markEntriesForTaskAsBeyondBudget(viewEntriesToRenderForDay, taskId);
          }
          if (taskId && hasEntryForTask(viewEntriesToRenderForDay, taskId)) {
            return;
          }
          beyondBudgetTasks = uniqueTasksById([
            ...beyondBudgetTasks,
            entry.data as ScheduleFlowTask,
          ]);
          return;
        }

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
        viewEntriesToRenderForDay.push(normalizeDayAssignedEntry(entry));
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

const isPlannedForDayTask = (
  task: ScheduleFlowTask,
): task is TaskWithPlannedForDayIndication =>
  typeof (task as TaskWithPlannedForDayIndication).plannedForDay === 'string';

const isDayAssignedTask = (task: ScheduleFlowTask): boolean =>
  isPlannedForDayTask(task) || !!task.dueDay;

const isDayAssignedEntry = (entry: SVE): boolean => {
  const data = entry.data as ScheduleFlowTask | undefined;
  if (!data || !isDayAssignedTask(data)) {
    return false;
  }

  return (
    entry.type === SVEType.Task ||
    entry.type === SVEType.TaskPlannedForDay ||
    entry.type === SVEType.SplitTask ||
    entry.type === SVEType.SplitTaskPlannedForDay ||
    entry.type === SVEType.SplitTaskContinued ||
    entry.type === SVEType.SplitTaskContinuedLast
  );
};

const getEntryTaskId = (entry: SVE): string | undefined => {
  const data = entry.data as TaskCopy | undefined;
  return data?.id;
};

const hasEntryForTask = (entries: SVE[], taskId: string): boolean =>
  entries.some((entry) => getEntryTaskId(entry) === taskId);

const markEntriesForTaskAsBeyondBudget = (entries: SVE[], taskId: string): void => {
  entries.forEach((entry) => {
    if (getEntryTaskId(entry) === taskId) {
      entry.isBeyondBudget = true;
    }
  });
};

const normalizeDayAssignedEntry = (entry: SVE): SVE => {
  if (
    entry.type === SVEType.SplitTask &&
    (entry.data as TaskWithPlannedForDayIndication).plannedForDay
  ) {
    return {
      ...entry,
      type: SVEType.SplitTaskPlannedForDay,
    };
  }
  return entry;
};

const asPlannedForDayTask = (
  task: TaskCopy,
  dayDate: string,
): TaskWithPlannedForDayIndication =>
  ({
    ...task,
    plannedForDay: dayDate,
    ...(task.timeEstimate === 0 && task.timeSpent === 0
      ? { timeEstimate: SCHEDULE_TASK_MIN_DURATION_IN_MS }
      : {}),
  }) as TaskWithPlannedForDayIndication;

const isTaskOnOrAfterDay = (task: ScheduleFlowTask, dayStartTime: number): boolean => {
  if (isPlannedForDayTask(task)) {
    return getDayStartTime(task.plannedForDay) >= dayStartTime;
  }

  if (task.dueDay) {
    return getDayStartTime(task.dueDay) >= dayStartTime;
  }

  if (task.dueWithTime) {
    return task.dueWithTime >= dayStartTime;
  }

  return false;
};

const getDayStartTime = (dayDate: string): number => {
  const date = dateStrToUtcDate(dayDate);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const uniqueTasksById = <T extends ScheduleFlowTask>(tasks: T[]): T[] => {
  const ids = new Set<string>();
  return tasks.filter((task) => {
    if (ids.has(task.id)) {
      return false;
    }
    ids.add(task.id);
    return true;
  });
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
