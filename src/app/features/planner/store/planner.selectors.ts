import { createFeatureSelector, createSelector } from '@ngrx/store';
import * as fromPlanner from './planner.reducer';
import { selectTaskFeatureState } from '../../tasks/store/task.selectors';
import {
  NoStartTimeRepeatProjection,
  PlannerDay,
  PlannerDayMap,
  ScheduleItemEvent,
  ScheduleItemRepeatProjection,
  ScheduleItemTask,
  ScheduleItemType,
} from '../planner.model';
import { ScheduleFromCalendarEvent } from '../../schedule/schedule.model';
import { TaskCopy, TaskWithDueDay, TaskWithDueTime } from '../../tasks/task.model';
import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { isSameDay } from '../../../util/is-same-day';
import { getTimeLeftForTask } from '../../../util/get-time-left-for-task';
import { ScheduleCalendarMapEntry } from '../../schedule/schedule.model';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { calculateAvailableHours } from '../util/calculate-available-hours';
import { selectConfigFeatureState } from '../../config/store/global-config.reducer';
import { ScheduleConfig } from '../../config/global-config.model';
import { selectTodayStr } from '../../../root-store/app-state/app-state.selectors';
import { isToday } from '../../../util/is-today.util';
import { selectTaskRepeatCfgsForExactDay } from '../../task-repeat-cfg/store/task-repeat-cfg.selectors';

export const selectPlannerState = createFeatureSelector<fromPlanner.PlannerState>(
  fromPlanner.plannerFeatureKey,
);

export const selectAllTasksDueToday = createSelector(
  selectTodayStr,
  selectTaskFeatureState,
  selectPlannerState,
  (todayStr, taskState, plannerState): (TaskWithDueTime | TaskWithDueDay)[] => {
    const allDueDayTasks = Object.values(taskState.entities).filter(
      (task) => !!task && !!(task as TaskWithDueTime).dueDay && todayStr === task.dueDay,
    ) as TaskWithDueDay[];
    const allDueWithTimeTasks = Object.values(taskState.entities).filter(
      (task) =>
        !!task &&
        !!(task as TaskWithDueTime).dueWithTime &&
        isToday((task as TaskWithDueTime).dueWithTime),
    ) as TaskWithDueTime[];

    const allDue: (TaskWithDueTime | TaskWithDueDay)[] = (
      plannerState.days[todayStr] || []
    )
      .map((tid) => taskState.entities[tid] as TaskWithDueDay)
      // there is a chance that the task is not in the store anymore
      .filter((t) => !!t);

    // Use Set for O(1) lookup instead of O(n) .find() in loop
    const allDueIds = new Set(allDue.map((t) => t.id));
    [...allDueDayTasks, ...allDueWithTimeTasks].forEach((task) => {
      if (!allDueIds.has(task.id)) {
        allDue.push(task);
        allDueIds.add(task.id);
      }
    });
    return allDue;
  },
);

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const selectTasksForPlannerDay = (day: string) => {
  return createSelector(
    selectPlannerState,
    selectTaskFeatureState,
    (plannerState, taskState) =>
      (plannerState.days[day] || [])
        .map((tid) => taskState.entities[tid] as TaskCopy)
        // there is a chance that the task is not in the store anymore
        .filter((t) => !!t),
  );
};

// Updated selectPlannerDays
export const selectPlannerDays = (
  dayDates: string[],
  taskRepeatCfgs: TaskRepeatCfg[],
  todayListTaskIds: string[],
  icalEvents: ScheduleCalendarMapEntry[],
  allPlannedTasks: TaskWithDueTime[],
  todayStr: string,
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
) => {
  // Use Set for O(1) lookup instead of O(n) .includes() in filter
  const allPlannedIdSet = new Set(allPlannedTasks.map((t) => t.id));
  const unplannedTaskIdsToday = todayListTaskIds.filter((id) => !allPlannedIdSet.has(id));

  return createSelector(
    selectTaskFeatureState,
    selectPlannerState,
    // TODO this could be more efficient by limiting this to changes of the relevant stuff
    selectConfigFeatureState,
    (taskState, plannerState, globalConfig): PlannerDay[] => {
      const allDatesWithData = Object.keys(plannerState.days);
      const dayDatesToUse = [
        ...dayDates,
        ...allDatesWithData
          .filter((d) => plannerState.days[d].length && !dayDates.includes(d))
          .sort((a, b) => a.localeCompare(b)),
      ];

      return dayDatesToUse.map((dayDate) =>
        getPlannerDay(
          dayDate,
          todayStr,
          taskState,
          plannerState,
          taskRepeatCfgs,
          allPlannedTasks,
          icalEvents,
          unplannedTaskIdsToday,
          globalConfig.schedule,
        ),
      );
    },
  );
};

export const selectPlannerDayMap = createSelector(
  selectTaskFeatureState,
  selectPlannerState,
  (taskState, plannerState): PlannerDayMap => {
    const map: PlannerDayMap = {};

    Object.keys(plannerState.days).forEach((dayDate) => {
      const tids = plannerState.days[dayDate] || [];
      const normalTasks = tids
        .map((id) => taskState.entities[id] as TaskCopy)
        // filter out deleted tasks
        .filter((t) => !!t);
      map[dayDate] = normalTasks;
    });

    return map;
  },
);

// Extracted common function
const getPlannerDay = (
  dayDate: string,
  todayStr: string,
  taskState: any,
  plannerState: any,
  taskRepeatCfgs: TaskRepeatCfg[],
  allPlannedTasks: TaskWithDueTime[],
  icalEvents: ScheduleCalendarMapEntry[],
  unplannedTaskIdsToday: string[] | false,
  scheduleConfig?: ScheduleConfig,
): PlannerDay => {
  const isTodayI = dayDate === todayStr;
  const currentDayDate = dateStrToUtcDate(dayDate);
  const currentDayTimestamp = currentDayDate.getTime();
  const tIds =
    isTodayI && unplannedTaskIdsToday
      ? unplannedTaskIdsToday
      : plannerState.days[dayDate] || [];
  const normalTasks = tIds
    .map((id) => taskState.entities[id] as TaskCopy)
    .filter((t) => !!t)
    // Filter out tasks with dueDay in future if it is Today's column
    .filter((t) => !isTodayI || !t.dueDay || t.dueDay <= todayStr);

  const { repeatProjectionsForDay, noStartTimeRepeatProjections } =
    getAllRepeatableTasksForDay(taskRepeatCfgs, currentDayTimestamp);

  const scheduledTaskItems = getScheduledTaskItems(allPlannedTasks, currentDayDate);
  const { timedEvents, allDayEvents } = getIcalEventsForDay(icalEvents, currentDayDate);

  const timeEstimate = getAllTimeSpent(
    normalTasks,
    repeatProjectionsForDay,
    noStartTimeRepeatProjections,
    scheduledTaskItems,
  );

  // Calculate available hours and progress percentage
  let availableHours;
  let progressPercentage;

  if (scheduleConfig && scheduleConfig.isWorkStartEndEnabled) {
    availableHours = calculateAvailableHours(dayDate, scheduleConfig);
    progressPercentage = availableHours > 0 ? (timeEstimate / availableHours) * 100 : 0;
  }

  return {
    isToday: isTodayI,
    dayDate,
    timeLimit: 0,
    itemsTotal:
      normalTasks.length +
      noStartTimeRepeatProjections.length +
      repeatProjectionsForDay.length +
      scheduledTaskItems.length +
      allDayEvents.length,
    scheduledIItems: [
      ...repeatProjectionsForDay,
      ...timedEvents,
      ...scheduledTaskItems,
    ].sort((a, b) => a.start - b.start),
    tasks: normalTasks,
    noStartTimeRepeatProjections,
    allDayEvents,
    timeEstimate,
    availableHours,
    progressPercentage,
  };
};

const getAllTimeSpent = (
  normalTasks: TaskCopy[],
  taskRepeatProjections: ScheduleItemRepeatProjection[],
  noStartTimeRepeatProjections: NoStartTimeRepeatProjection[],
  plannedTaskProjections: ScheduleItemTask[],
): number => {
  return (
    normalTasks.reduce((acc, t) => acc + (t.isDone ? 0 : getTimeLeftForTask(t)), 0) +
    taskRepeatProjections.reduce((acc, rp) => acc + rp.end - rp.start, 0) +
    plannedTaskProjections.reduce((acc, si) => acc + si.end - si.start, 0) +
    noStartTimeRepeatProjections.reduce(
      (acc, rp) => acc + (rp.repeatCfg.defaultEstimate || 0),
      0,
    )
  );
};

const getAllRepeatableTasksForDay = (
  taskRepeatCfgs: TaskRepeatCfg[],
  currentDayTimestamp: number,
): {
  repeatProjectionsForDay: ScheduleItemRepeatProjection[];
  noStartTimeRepeatProjections: NoStartTimeRepeatProjection[];
} => {
  const repeatProjectionsForDay: ScheduleItemRepeatProjection[] = [];
  const noStartTimeRepeatProjections: NoStartTimeRepeatProjection[] = [];
  const allRepeatableTasksForDay = selectTaskRepeatCfgsForExactDay.projector(
    taskRepeatCfgs,
    {
      dayDate: currentDayTimestamp,
    },
  );

  allRepeatableTasksForDay.forEach((repeatCfg) => {
    if (repeatCfg.startTime) {
      const start = getDateTimeFromClockString(repeatCfg.startTime, currentDayTimestamp);
      const end = start + (repeatCfg.defaultEstimate || 0);
      repeatProjectionsForDay.push({
        id: repeatCfg.id,
        type: ScheduleItemType.RepeatProjection,
        start,
        end,
        repeatCfg,
      });
    } else {
      noStartTimeRepeatProjections.push({
        id: repeatCfg.id,
        repeatCfg,
      });
    }
  });

  return {
    repeatProjectionsForDay,
    noStartTimeRepeatProjections,
  };
};

const getScheduledTaskItems = (
  allPlannedTasks: TaskWithDueTime[],
  currentDayDate: Date,
): ScheduleItemTask[] =>
  allPlannedTasks
    .filter((task) => isSameDay(task.dueWithTime, currentDayDate))
    .map((task) => {
      const start = task.dueWithTime;
      const end = start + Math.max(task.timeEstimate - task.timeSpent, 0);
      return {
        id: task.id,
        type: ScheduleItemType.Task,
        start,
        end,
        task,
      };
    });

interface IcalEventsForDayResult {
  timedEvents: ScheduleItemEvent[];
  allDayEvents: ScheduleFromCalendarEvent[];
}

const getIcalEventsForDay = (
  icalEvents: ScheduleCalendarMapEntry[],
  currentDayDate: Date,
): IcalEventsForDayResult => {
  const timedEvents: ScheduleItemEvent[] = [];
  const allDayEvents: ScheduleFromCalendarEvent[] = [];

  icalEvents.forEach((icalMapEntry) => {
    icalMapEntry.items.forEach((calEv) => {
      const start = calEv.start;
      if (isSameDay(start, currentDayDate)) {
        if (calEv.isAllDay) {
          // All-day events go to a separate list with full event data
          allDayEvents.push({ ...calEv });
        } else {
          // Timed events go to scheduled items
          const end = calEv.start + calEv.duration;
          timedEvents.push({
            id: calEv.id,
            type: ScheduleItemType.CalEvent,
            start,
            end,
            calendarEvent: {
              ...calEv,
            },
          });
        }
      }
    });
  });
  return { timedEvents, allDayEvents };
};
