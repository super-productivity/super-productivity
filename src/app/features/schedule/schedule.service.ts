import { computed, inject, Injectable, Signal } from '@angular/core';
import { DateService } from '../../core/date/date.service';
import { interval } from 'rxjs';
import {
  ScheduleCalendarMapEntry,
  ScheduleDay,
  ScheduleEvent,
  ScheduleLunchBreakCfg,
  ScheduleWorkStartEndCfg,
} from './schedule.model';
import { SVEType } from './schedule.const';
import { PlannerDayMap } from '../planner/planner.model';
import { TaskWithDueTime, TaskWithSubTasks } from '../tasks/task.model';
import { TaskRepeatCfg } from '../task-repeat-cfg/task-repeat-cfg.model';
import { ScheduleConfig } from '../config/global-config.model';
import { mapToScheduleDays } from './map-schedule-data/map-to-schedule-days';
import { Store } from '@ngrx/store';
import { selectTimelineTasks } from '../work-context/store/work-context.selectors';
import { selectPlannerDayMap } from '../planner/store/planner.selectors';
import { selectTaskRepeatCfgsWithAndWithoutStartTime } from '../task-repeat-cfg/store/task-repeat-cfg.selectors';
import { selectTimelineConfig } from '../config/store/global-config.reducer';
import { CalendarIntegrationService } from '../calendar-integration/calendar-integration.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { TaskService } from '../tasks/task.service';
import { startWith } from 'rxjs/operators';
import { parseDbDateStr } from '../../util/parse-db-date-str';

@Injectable({
  providedIn: 'root',
})
export class ScheduleService {
  private _dateService = inject(DateService);
  private _store = inject(Store);
  private _calendarIntegrationService = inject(CalendarIntegrationService);
  private _taskService = inject(TaskService);

  private _timelineTasks = toSignal(this._store.select(selectTimelineTasks));
  private _taskRepeatCfgs = toSignal(
    this._store.select(selectTaskRepeatCfgsWithAndWithoutStartTime),
  );
  private _timelineConfig = toSignal(this._store.select(selectTimelineConfig));
  private _plannerDayMap = toSignal(this._store.select(selectPlannerDayMap));
  private _icalEvents = toSignal(this._calendarIntegrationService.icalEvents$, {
    initialValue: [],
  });
  scheduleRefreshTick = toSignal(interval(2 * 60 * 1000).pipe(startWith(0)), {
    initialValue: 0,
  });

  createScheduleDaysComputed(daysToShow: Signal<string[]>): Signal<ScheduleDay[]> {
    return computed(() => {
      this.scheduleRefreshTick();
      const timelineTasks = this._timelineTasks();
      const taskRepeatCfgs = this._taskRepeatCfgs();
      const timelineCfg = this._timelineConfig();
      const plannerDayMap = this._plannerDayMap();
      const icalEvents = this._icalEvents();
      const currentTaskId = this._taskService.currentTaskId() ?? null;

      return this.buildScheduleDays({
        daysToShow: daysToShow(),
        timelineTasks,
        taskRepeatCfgs,
        icalEvents,
        plannerDayMap,
        timelineCfg,
        currentTaskId,
      });
    });
  }

  buildScheduleDays(params: BuildScheduleDaysParams): ScheduleDay[] {
    const {
      now = Date.now(),
      realNow,
      daysToShow,
      timelineTasks,
      taskRepeatCfgs,
      icalEvents,
      plannerDayMap,
      timelineCfg,
      currentTaskId = null,
    } = params;

    if (!timelineTasks || !taskRepeatCfgs || !plannerDayMap) {
      return [];
    }

    return mapToScheduleDays(
      now,
      daysToShow,
      timelineTasks.unPlanned,
      timelineTasks.planned,
      taskRepeatCfgs.withStartTime,
      taskRepeatCfgs.withoutStartTime,
      icalEvents ?? [],
      currentTaskId,
      plannerDayMap,
      timelineCfg?.isWorkStartEndEnabled ? createWorkStartEndCfg(timelineCfg) : undefined,
      timelineCfg?.isLunchBreakEnabled ? createLunchBreakCfg(timelineCfg) : undefined,
      realNow,
    );
  }

  /**
   * Converts a Date object or timestamp to a date string format used by the schedule.
   * This is a public wrapper around the internal DateService method.
   */
  getTodayStr(date?: Date | number): string {
    return this._dateService.todayStr(date);
  }

  /**
   * Builds schedule days with context-aware parameters.
   * Encapsulates the internal data fetching and processing logic.
   */
  createScheduleDaysWithContext(params: {
    daysToShow: string[];
    contextNow: number;
    realNow: number;
    currentTaskId: string | null;
  }): ScheduleDay[] {
    this.scheduleRefreshTick();
    const timelineTasks = this._timelineTasks();
    const taskRepeatCfgs = this._taskRepeatCfgs();
    const timelineCfg = this._timelineConfig();
    const plannerDayMap = this._plannerDayMap();
    const icalEvents = this._icalEvents();

    return this.buildScheduleDays({
      now: params.contextNow,
      realNow: params.realNow,
      daysToShow: params.daysToShow,
      timelineTasks,
      taskRepeatCfgs,
      icalEvents,
      plannerDayMap,
      timelineCfg,
      currentTaskId: params.currentTaskId,
    });
  }

  getDaysToShow(nrOfDaysToShow: number, referenceDate: Date | null = null): string[] {
    const today = referenceDate ? referenceDate.getTime() : new Date().getTime();
    const daysToShow: string[] = [];
    for (let i = 0; i < nrOfDaysToShow; i++) {
      // eslint-disable-next-line no-mixed-operators
      daysToShow.push(this._dateService.todayStr(today + i * 24 * 60 * 60 * 1000));
    }
    return daysToShow;
  }

  getMonthDaysToShow(
    numberOfWeeks: number,
    firstDayOfWeek: number = 0,
    referenceDate: Date | null = null,
  ): string[] {
    const today = referenceDate || new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // Calculate the first day to show based on firstDayOfWeek setting
    // firstDayOfWeek: 0=Sunday, 1=Monday, 2=Tuesday, etc.
    const firstDayToShow = new Date(firstDayOfMonth);
    const monthStartDay = firstDayOfMonth.getDay(); // 0=Sunday, 1=Monday, etc.

    // Calculate how many days to go back from the first of the month
    const daysToGoBack = (monthStartDay - firstDayOfWeek + 7) % 7;
    firstDayToShow.setDate(firstDayOfMonth.getDate() - daysToGoBack);

    const totalDays = numberOfWeeks * 7;
    const daysToShow: string[] = [];
    for (let i = 0; i < totalDays; i++) {
      const currentDate = new Date(firstDayToShow);
      currentDate.setDate(firstDayToShow.getDate() + i);
      daysToShow.push(this._dateService.todayStr(currentDate.getTime()));
    }

    return daysToShow;
  }

  getEventDayStr(ev: ScheduleEvent): string | null {
    // Calendar events
    if (isCalendarEventData(ev)) {
      return this._dateService.todayStr(ev.data.start);
    }

    // Tasks with plannedForDay (TaskPlannedForDay, SplitTaskPlannedForDay, SplitTask, Task)
    if (isTaskWithPlannedForDay(ev)) {
      return ev.data.plannedForDay;
    }

    // ScheduledTask with remindAt
    if (isScheduledTaskWithRemindAt(ev)) {
      return this._dateService.todayStr(ev.data.remindAt);
    }

    // ScheduledTask with dueWithTime
    if (isScheduledTaskWithDueWithTime(ev)) {
      return this._dateService.todayStr(ev.data.dueWithTime);
    }

    // Task with dueDay (fallback after plannedForDay check)
    if (isTaskWithDueDay(ev)) {
      return ev.data.dueDay;
    }

    // RepeatProjection types - check ev.plannedForDay first (set on view entry),
    // then fall back to data.plannedForDay for backwards compatibility
    if (isRepeatProjection(ev)) {
      if (ev.plannedForDay) {
        return ev.plannedForDay;
      }
      if (ev.data && 'plannedForDay' in ev.data) {
        const plannedForDay = ev.data.plannedForDay;
        if (typeof plannedForDay === 'string') {
          return plannedForDay;
        }
      }
    }

    return null;
  }

  getDayClass(day: string, referenceMonth?: Date): string {
    const dayDate = parseDbDateStr(day);
    const today = new Date();

    // If referenceMonth is provided, use it to determine "current month"
    // Otherwise, use the actual current month
    const monthToCompare = referenceMonth || today;
    const isCurrentMonth =
      dayDate.getMonth() === monthToCompare.getMonth() &&
      dayDate.getFullYear() === monthToCompare.getFullYear();
    const isToday = dayDate.toDateString() === today.toDateString();

    let classes = '';
    if (!isCurrentMonth) classes += ' other-month';
    if (isToday) classes += ' today';

    return classes;
  }

  hasEventsForDay(day: string, events: ScheduleEvent[] | null): boolean {
    if (!events) {
      return false;
    }
    return events.some((ev) => {
      const eventDay = this.getEventDayStr(ev);
      return eventDay === day;
    });
  }

  getEventsForDay(day: string, events: ScheduleEvent[] | null): ScheduleEvent[] {
    if (!events) {
      return [];
    }
    return events.filter((ev) => {
      const eventDay = this.getEventDayStr(ev);
      return eventDay === day;
    });
  }
}

const createWorkStartEndCfg = (timelineCfg: ScheduleConfig): ScheduleWorkStartEndCfg => ({
  startTime: timelineCfg.workStart,
  endTime: timelineCfg.workEnd,
});

const createLunchBreakCfg = (timelineCfg: ScheduleConfig): ScheduleLunchBreakCfg => ({
  startTime: timelineCfg.lunchBreakStart,
  endTime: timelineCfg.lunchBreakEnd,
});

// Type guards for ScheduleEvent data based on SVEType
const isCalendarEventData = (
  ev: ScheduleEvent,
): ev is ScheduleEvent & { data: { start: number } } =>
  ev.type === SVEType.CalendarEvent && ev.data != null && 'start' in ev.data;

const isTaskWithPlannedForDay = (
  ev: ScheduleEvent,
): ev is ScheduleEvent & { data: { plannedForDay: string } } =>
  (ev.type === SVEType.TaskPlannedForDay ||
    ev.type === SVEType.SplitTaskPlannedForDay ||
    ev.type === SVEType.SplitTask ||
    ev.type === SVEType.ScheduledTask ||
    ev.type === SVEType.Task) &&
  ev.data != null &&
  'plannedForDay' in ev.data &&
  typeof ev.data.plannedForDay === 'string';

const isScheduledTaskWithRemindAt = (
  ev: ScheduleEvent,
): ev is ScheduleEvent & { data: { remindAt: number } } =>
  ev.type === SVEType.ScheduledTask &&
  ev.data != null &&
  'remindAt' in ev.data &&
  typeof ev.data.remindAt === 'number';

const isScheduledTaskWithDueWithTime = (
  ev: ScheduleEvent,
): ev is ScheduleEvent & { data: { dueWithTime: number } } =>
  ev.type === SVEType.ScheduledTask &&
  ev.data != null &&
  'dueWithTime' in ev.data &&
  typeof ev.data.dueWithTime === 'number';

const isTaskWithDueDay = (
  ev: ScheduleEvent,
): ev is ScheduleEvent & { data: { dueDay: string } } =>
  ev.type === SVEType.Task &&
  ev.data != null &&
  'dueDay' in ev.data &&
  typeof ev.data.dueDay === 'string';

const isRepeatProjection = (
  ev: ScheduleEvent,
): ev is ScheduleEvent & {
  type:
    | SVEType.RepeatProjection
    | SVEType.ScheduledRepeatProjection
    | SVEType.RepeatProjectionSplit
    | SVEType.RepeatProjectionSplitContinued
    | SVEType.RepeatProjectionSplitContinuedLast;
} =>
  ev.type === SVEType.RepeatProjection ||
  ev.type === SVEType.ScheduledRepeatProjection ||
  ev.type === SVEType.RepeatProjectionSplit ||
  ev.type === SVEType.RepeatProjectionSplitContinued ||
  ev.type === SVEType.RepeatProjectionSplitContinuedLast;

type TimelineTasks = {
  planned: TaskWithDueTime[];
  unPlanned: TaskWithSubTasks[];
};

type TaskRepeatCfgBuckets = {
  withStartTime: TaskRepeatCfg[];
  withoutStartTime: TaskRepeatCfg[];
};

export interface BuildScheduleDaysParams {
  now?: number;
  realNow?: number; // Actual current time for determining "current week"
  daysToShow: string[];
  timelineTasks: TimelineTasks | undefined | null;
  taskRepeatCfgs: TaskRepeatCfgBuckets | undefined | null;
  icalEvents: ScheduleCalendarMapEntry[] | undefined | null;
  plannerDayMap: PlannerDayMap | undefined | null;
  timelineCfg?: ScheduleConfig | null;
  currentTaskId?: string | null;
}
