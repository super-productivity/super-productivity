import { TaskCopy } from '../tasks/task.model';
import { TaskRepeatCfg } from '../task-repeat-cfg/task-repeat-cfg.model';
import { ScheduleFromCalendarEvent } from '../schedule/schedule.model';

export enum ScheduleItemType {
  Task = 'Task',
  CalEvent = 'CalEvent',
  RepeatProjection = 'RepeatProjection',
}

export interface PlannerDay {
  isToday?: boolean;
  dayDate: string;
  timeEstimate: number;
  timeLimit: number;
  itemsTotal: number;
  tasks: TaskCopy[];
  deadlineTasks: TaskCopy[];
  noStartTimeRepeatProjections: NoStartTimeRepeatProjection[];
  allDayEvents: ScheduleFromCalendarEvent[];
  scheduledIItems: ScheduleItem[];
  availableHours?: number;
  progressPercentage?: number;
}

export interface PlannerDayMap {
  [dayDate: string]: TaskCopy[];
}

export interface NoStartTimeRepeatProjection {
  id: string;
  repeatCfg: TaskRepeatCfg;
}

export interface ScheduleItemBase {
  id: string;
  type: ScheduleItemType;
  start: number;
  end: number;
}

export interface ScheduleItemTask extends ScheduleItemBase {
  type: ScheduleItemType.Task;
  task: TaskCopy;
}

export interface ScheduleItemRepeatProjection extends ScheduleItemBase {
  type: ScheduleItemType.RepeatProjection;
  repeatCfg: TaskRepeatCfg;
}

export interface ScheduleItemEvent extends ScheduleItemBase {
  type: ScheduleItemType.CalEvent;
  calendarEvent: ScheduleItemCalendarEventData;
}

export type ScheduleItem =
  | ScheduleItemTask
  | ScheduleItemEvent
  | ScheduleItemRepeatProjection;

export interface ScheduleItemCalendarEventData {
  title: string;
  duration: number;
  provider?: any;
  ico?: string;
}

export const ADD_TASK_PANEL_ID = 'ADD_TASK_PANEL' as const;
export const OVERDUE_LIST_ID = 'OVERDUE_LIST' as const;
