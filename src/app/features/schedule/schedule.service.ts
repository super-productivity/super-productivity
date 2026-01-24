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
    const data = ev.data;

    // Calendar events
    if (ev.type === SVEType.CalendarEvent && data && 'start' in data) {
      const start = (data as { start: unknown }).start;
      if (typeof start === 'number') {
        return this._dateService.todayStr(start);
      }
    }

    // Tasks planned for a day
    if (
      (ev.type === SVEType.TaskPlannedForDay ||
        ev.type === SVEType.SplitTaskPlannedForDay) &&
      data &&
      'plannedForDay' in data
    ) {
      const plannedForDay = (data as { plannedForDay: unknown }).plannedForDay;
      if (typeof plannedForDay === 'string') {
        return plannedForDay;
      }
    }

    // ScheduledTask may have plannedForDay or be scheduled for today
    if (ev.type === SVEType.ScheduledTask && data) {
      if ('plannedForDay' in data) {
        const plannedForDay = (data as { plannedForDay: unknown }).plannedForDay;
        if (typeof plannedForDay === 'string') {
          return plannedForDay;
        }
      }

      // For scheduled tasks with time, they may have reminderData or be planned for today
      if ('remindAt' in data) {
        const remindAt = (data as { remindAt: unknown }).remindAt;
        if (typeof remindAt === 'number') {
          return this._dateService.todayStr(remindAt);
        }
      }

      // Check dueWithTime for scheduled tasks
      if ('dueWithTime' in data) {
        const dueWithTime = (data as { dueWithTime: unknown }).dueWithTime;
        if (typeof dueWithTime === 'number') {
          return this._dateService.todayStr(dueWithTime);
        }
      }
    }

    // SplitTask may have plannedForDay
    if (ev.type === SVEType.SplitTask && data && 'plannedForDay' in data) {
      const plannedForDay = (data as { plannedForDay: unknown }).plannedForDay;
      if (typeof plannedForDay === 'string') {
        return plannedForDay;
      }
    }

    // Regular tasks may have plannedForDay or dueDay
    if (ev.type === SVEType.Task && data) {
      // Check plannedForDay first
      if ('plannedForDay' in data) {
        const plannedForDay = (data as { plannedForDay: unknown }).plannedForDay;
        if (typeof plannedForDay === 'string') {
          return plannedForDay;
        }
      }

      // Check dueDay if plannedForDay not found
      if ('dueDay' in data) {
        const dueDay = (data as { dueDay: unknown }).dueDay;
        if (typeof dueDay === 'string') {
          return dueDay;
        }
      }
    }

    // RepeatProjection types
    if (
      (ev.type === SVEType.RepeatProjection ||
        ev.type === SVEType.ScheduledRepeatProjection) &&
      data &&
      'plannedForDay' in data
    ) {
      const plannedForDay = (data as { plannedForDay: unknown }).plannedForDay;
      if (typeof plannedForDay === 'string') {
        return plannedForDay;
      }
    }

    // If no specific date found, return null
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
