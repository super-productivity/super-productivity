import { SVEType } from './schedule.const';
import { TaskCopy, TaskWithDueTime } from '../tasks/task.model';
import { TaskRepeatCfg } from '../task-repeat-cfg/task-repeat-cfg.model';
import { CalendarIntegrationEvent } from '../calendar-integration/calendar-integration.model';

export interface ScheduleEvent {
  id: string;
  type: SVEType;
  style: string;
  startHours: number;
  timeLeftInHours: number;
  dayOfMonth?: number;
  data?: SVE['data'];
  overlap?: { count: number; offset: number };
}

export interface ScheduleDay {
  dayDate: string;
  entries: SVE[];
  beyondBudgetTasks: TaskCopy[];
  isToday: boolean;
}

interface SVEBase {
  id: string;
  type: SVEType;
  start: number;
  duration: number;
  plannedForDay?: string;
}

export interface SVETask extends SVEBase {
  type: SVEType.Task | SVEType.TaskPlannedForDay | SVEType.ScheduledTask;
  data: TaskCopy;
}

export interface SVESplitTaskStart extends SVEBase {
  type: SVEType.SplitTaskPlannedForDay | SVEType.SplitTask;
  data: TaskCopy;
}

export interface SVETaskPlannedForDay extends SVEBase {
  type: SVEType.TaskPlannedForDay;
  data: TaskCopy;
}

export interface SVERepeatProjectionBase extends SVEBase {
  data: TaskRepeatCfg;
}

export interface SVEScheduledRepeatProjection extends SVERepeatProjectionBase {
  type: SVEType.ScheduledRepeatProjection;
}

export interface SVERepeatProjection extends SVERepeatProjectionBase {
  type: SVEType.RepeatProjection;
}

export interface SVERepeatProjectionSplit extends SVERepeatProjectionBase {
  type: SVEType.RepeatProjectionSplit;
}

export interface SVERepeatProjectionSplitContinued extends SVERepeatProjectionBase {
  type:
    | SVEType.RepeatProjectionSplitContinued
    | SVEType.RepeatProjectionSplitContinuedLast;
  splitIndex: number;
}

export interface SVESplitTaskContinued extends SVEBase {
  type: SVEType.SplitTaskContinued | SVEType.SplitTaskContinuedLast;
  data: TaskCopy;
}

export interface ScheduleFromCalendarEvent extends CalendarIntegrationEvent {
  icon?: string;
}

export interface ScheduleCustomEvent extends Omit<
  ScheduleFromCalendarEvent,
  'calProviderId'
> {
  icon: string;
}

interface SVECalendarEvent extends SVEBase {
  type: SVEType.CalendarEvent;
  data: ScheduleCustomEvent;
}

export interface ScheduleWorkStartEndCfg {
  startTime: string;
  endTime: string;
}

export type ScheduleLunchBreakCfg = ScheduleWorkStartEndCfg;

interface SVEWorkStart extends SVEBase {
  type: SVEType.WorkdayStart;
  data: ScheduleWorkStartEndCfg;
}

interface SVEWorkEnd extends SVEBase {
  type: SVEType.WorkdayEnd;
  data: ScheduleWorkStartEndCfg;
}

interface SVELunchBreak extends SVEBase {
  type: SVEType.LunchBreak;
  data: ScheduleLunchBreakCfg;
}

export type SVEEntryForNextDay =
  | SVETask
  | SVESplitTaskStart
  | SVERepeatProjection
  | SVESplitTaskContinued
  | SVERepeatProjectionSplitContinued;

export type SVE =
  | SVETask
  | SVESplitTaskStart
  | SVETaskPlannedForDay
  | SVEScheduledRepeatProjection
  | SVERepeatProjection
  | SVERepeatProjectionSplit
  | SVERepeatProjectionSplitContinued
  | SVESplitTaskContinued
  | SVECalendarEvent
  | SVEWorkStart
  | SVEWorkEnd
  | SVELunchBreak;

export interface ScheduleCalendarMapEntry {
  items: ScheduleFromCalendarEvent[];
}

// -----------------
// BlockedBlocks
export enum BlockedBlockType {
  ScheduledTask = 'ScheduledTask',
  ScheduledTaskSplit = 'ScheduledTaskSplit',
  ScheduledRepeatProjection = 'ScheduledRepeatProjection',
  ScheduledRepeatProjectionSplit = 'ScheduledRepeatProjectionSplit',
  CalendarEvent = 'CalendarEvent',
  WorkdayStartEnd = 'WorkdayStartEnd',
  LunchBreak = 'LunchBreak',
}

export interface BlockedBlockEntryScheduledTask {
  start: number;
  end: number;
  type: BlockedBlockType.ScheduledTask | BlockedBlockType.ScheduledTaskSplit;
  data: TaskWithDueTime;
}

export interface BlockedBlockEntryScheduledRepeatProjection {
  start: number;
  end: number;
  type:
    | BlockedBlockType.ScheduledRepeatProjection
    | BlockedBlockType.ScheduledRepeatProjectionSplit;
  data: TaskRepeatCfg;
}

export interface BlockedBlockEntryCalendarEvent {
  start: number;
  end: number;
  type: BlockedBlockType.CalendarEvent;
  data: ScheduleFromCalendarEvent;
}

export interface BlockedBlockEntryWorkdayStartEnd {
  start: number;
  end: number;
  type: BlockedBlockType.WorkdayStartEnd;
  data: ScheduleWorkStartEndCfg;
}

export interface BlockedBlockEntryLunchBreak {
  start: number;
  end: number;
  type: BlockedBlockType.LunchBreak;
  data: ScheduleLunchBreakCfg;
}

export type BlockedBlockEntry =
  | BlockedBlockEntryScheduledTask
  | BlockedBlockEntryScheduledRepeatProjection
  | BlockedBlockEntryCalendarEvent
  | BlockedBlockEntryWorkdayStartEnd
  | BlockedBlockEntryLunchBreak;

export interface BlockedBlock {
  start: number;
  end: number;
  isBlockedWholeDay?: true;
  entries: BlockedBlockEntry[];
}

export interface BlockedBlockByDayMap {
  [dayDate: string]: BlockedBlock[];
}
