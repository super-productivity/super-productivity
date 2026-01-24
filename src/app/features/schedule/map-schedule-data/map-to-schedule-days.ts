import { Task, TaskWithDueTime, TaskWithoutReminder } from '../../tasks/task.model';
import { TaskRepeatCfg } from '../../task-repeat-cfg/task-repeat-cfg.model';

import { PlannerDayMap } from '../../planner/planner.model';
import {
  ScheduleCalendarMapEntry,
  ScheduleDay,
  ScheduleLunchBreakCfg,
  ScheduleWorkStartEndCfg,
} from '../schedule.model';
import { createScheduleDays } from './create-schedule-days';
import { createBlockedBlocksByDayMap } from './create-blocked-blocks-by-day-map';

export const mapToScheduleDays = (
  now: number,
  dayDates: string[],
  tasks: Task[],
  scheduledTasks: TaskWithDueTime[],
  scheduledTaskRepeatCfgs: TaskRepeatCfg[],
  unScheduledTaskRepeatCfgs: TaskRepeatCfg[],
  // TODO replace with no schedule type
  calenderWithItems: ScheduleCalendarMapEntry[],
  currentId: string | null,
  plannerDayMap: PlannerDayMap,
  workStartEndCfg: ScheduleWorkStartEndCfg = {
    startTime: '0:00',
    endTime: '23:59',
  },
  lunchBreakCfg?: ScheduleLunchBreakCfg,
  realNow?: number,
): ScheduleDay[] => {
  // NOTE to use for failing test cases
  // const params = {
  //   now,
  //   dayDates,
  //   tasks,
  //   scheduledTasks,
  //   scheduledTaskRepeatCfgs,
  //   unScheduledTaskRepeatCfgs,
  //   calenderWithItems,
  //   currentId,
  //   plannerDayMap,
  //   workStartEndCfg,
  //   lunchBreakCfg,
  // };
  // Log.log(JSON.stringify(params));

  const plannerDayKeys = Object.keys(plannerDayMap);
  // const plannerDayTasks = plannerDayKeys
  //   .map((key) => {
  //     return plannerDayMap[key];
  //       // .map(
  //       // (t) => ({ ...t, plannedForDay: key }) as TaskWithPlannedForDayIndication,
  //     // );
  //   })
  //   .flat();

  if (
    !tasks.length &&
    !scheduledTasks.length &&
    !scheduledTaskRepeatCfgs.length &&
    !unScheduledTaskRepeatCfgs.length &&
    !calenderWithItems.length &&
    !plannerDayKeys.length
  ) {
    return [];
  }

  const initialTasks: Task[] = currentId
    ? resortTasksWithCurrentFirst(currentId, tasks)
    : tasks;

  const nonScheduledTasks: TaskWithoutReminder[] = initialTasks.filter(
    (task) => !(typeof task.dueWithTime === 'number'),
  ) as TaskWithoutReminder[];

  const blockerBlocksDayMap = createBlockedBlocksByDayMap(
    scheduledTasks,
    scheduledTaskRepeatCfgs,
    calenderWithItems,
    workStartEndCfg,
    lunchBreakCfg,
    now,
  );

  const v = createScheduleDays(
    nonScheduledTasks,
    unScheduledTaskRepeatCfgs,
    dayDates,
    plannerDayMap,
    blockerBlocksDayMap,
    workStartEndCfg,
    now,
    realNow,
  );

  return v;
};

const resortTasksWithCurrentFirst = (currentId: string, tasks: Task[]): Task[] => {
  let newTasks = tasks;
  const currentTask = tasks.find((t) => t.id === currentId);
  if (currentTask) {
    newTasks = [currentTask, ...tasks.filter((t) => t.id !== currentId)] as Task[];
  }
  return newTasks;
};
