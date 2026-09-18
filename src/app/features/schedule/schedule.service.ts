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
import { HiddenCalendarProvidersService } from '../calendar-integration/hidden-calendar-providers.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { TaskService } from '../tasks/task.service';
import { startWith } from 'rxjs/operators';
import { parseDbDateStr } from '../../util/parse-db-date-str';
import { anchorContextNow } from './anchor-context-now';

@Injectable({
  providedIn: 'root',
})
export class ScheduleService {
  private _dateService = inject(DateService);
  private _store = inject(Store);
  private _calendarIntegrationService = inject(CalendarIntegrationService);
  private _hiddenCalendarProviders = inject(HiddenCalendarProvidersService);
  private _taskService = inject(TaskService);

  private _timelineTasks = toSignal(this._store.select(selectTimelineTasks));
  private _taskRepeatCfgs = toSignal(
    this._store.select(selectTaskRepeatCfgsWithAndWithoutStartTime),
  );
  private _timelineConfig = toSignal(this._store.select(selectTimelineConfig));
  private _plannerDayMap = toSignal(this._store.select(selectPlannerDayMap));
  private _calendarEvents = toSignal(this._calendarIntegrationService.calendarEvents$, {
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
      const calendarEvents = this._calendarEvents();
      const currentTaskId = this._taskService.currentTaskId() ?? null;

      // `daysToShow` here is logical today, which respects the start-of-next-day
      // offset. Leaving `now` to its Date.now() default let the raw wall clock
      // sit past that day's end between midnight and the offset, so every entry
      // landed beyond the only rendered day and the panel came up empty.
      const days = daysToShow();
      const realNow = Date.now();
      const now = days.length ? anchorContextNow(days[0], realNow) : realNow;

      return this.buildScheduleDays({
        now,
        realNow,
        daysToShow: days,
        timelineTasks,
        taskRepeatCfgs,
        calendarEvents,
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
      calendarEvents,
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
      calendarEvents ?? [],
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
    const hiddenProviderIds = this._hiddenCalendarProviders.hiddenProviderIds();
    const calendarEvents = hiddenProviderIds.length
      ? this._calendarEvents()
          .map((entry) => ({
            ...entry,
            items: entry.items.filter(
              (item) => !hiddenProviderIds.includes(item.calProviderId),
            ),
          }))
          .filter((entry) => entry.items.length > 0)
      : this._calendarEvents();

    return this.buildScheduleDays({
      now: params.contextNow,
      realNow: params.realNow,
      daysToShow: params.daysToShow,
      timelineTasks,
      taskRepeatCfgs,
      calendarEvents,
      plannerDayMap,
      timelineCfg,
      currentTaskId: params.currentTaskId,
    });
  }

  getDaysToShow(nrOfDaysToShow: number, referenceDate: Date | null = null): string[] {
    // Default anchor is the logical day, not the raw clock: between calendar
    // midnight and the configured start-of-next-day the window must still
    // begin at (logical) today, which todayStr() elsewhere keeps naming.
    // Cloned because the cursor is mutated below and referenceDate is the
    // caller's (a selected-date signal value in the schedule component).
    const cursor = referenceDate
      ? new Date(referenceDate)
      : this._dateService.getLogicalTodayDate();
    // Only date parts are read below, so pin the cursor to midday first.
    // setDate() preserves the wall time, and a late-evening one is normalised
    // past midnight in zones whose spring-forward gap ends at 00:00
    // (America/Godthab and America/Scoresbysund skip 23:00-23:59), which would
    // drop a whole day from the window. Midday is never in a gap.
    cursor.setHours(12, 0, 0, 0);
    const daysToShow: string[] = [];
    for (let i = 0; i < nrOfDaysToShow; i++) {
      daysToShow.push(this._dateService.todayStr(cursor.getTime()));
      // Calendar-day stepping: a DST transition day is 23h/25h long, so
      // +24h ms arithmetic skips or duplicates a date around it.
      cursor.setDate(cursor.getDate() + 1);
    }
    return daysToShow;
  }

  /**
   * Week rows the displayed month actually occupies, 4 to 6.
   *
   * A month needs `daysToGoBack` leading days from the previous month plus its
   * own length, rounded up to whole weeks. `daysToGoBack` is 0-6 and a month is
   * 28-31 days, so this is 4 (only a non-leap February starting exactly on the
   * week's first day) to 6 (a 31-day month starting 5 or 6 days in, e.g. August
   * 2026 under Monday-first). Most months are 5.
   *
   * Pinning it at 6 spans every month but leaves an empty row on most of them.
   * Deriving it from *available height* is what #9449 was filed for: a day left
   * out of `daysToShow` gets no events computed at all, so the task vanished
   * rather than merely being clipped. The month is the right input; the viewport
   * is not.
   */
  getMonthWeeksToShow(
    firstDayOfWeek: number = 0,
    referenceDate: Date | null = null,
  ): number {
    // Same logical-day anchoring as getMonthDaysToShow below.
    const today = referenceDate || this._dateService.getLogicalTodayDate();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const daysToGoBack = (firstDayOfMonth.getDay() - firstDayOfWeek + 7) % 7;
    // Day 0 of the next month is the last day of this one.
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    return Math.ceil((daysToGoBack + daysInMonth) / 7);
  }

  getMonthDaysToShow(
    numberOfWeeks: number,
    firstDayOfWeek: number = 0,
    referenceDate: Date | null = null,
  ): string[] {
    // Same logical-day anchoring as getDaysToShow above.
    const today = referenceDate || this._dateService.getLogicalTodayDate();
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

    // Task view entries can carry the resolved day on the event itself, e.g. when
    // excess tasks are mapped from dueDay without mutating the task data.
    if (isTaskEventWithPlannedForDay(ev)) {
      return ev.plannedForDay;
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
    // Logical day, same as the window anchors above: the today ring must sit
    // on the column todayStr() names, not one off during the offset window.
    const today = this._dateService.getLogicalTodayDate();

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

const isTaskEventWithPlannedForDay = (
  ev: ScheduleEvent,
): ev is ScheduleEvent & { plannedForDay: string } =>
  (ev.type === SVEType.TaskPlannedForDay ||
    ev.type === SVEType.SplitTaskPlannedForDay ||
    ev.type === SVEType.SplitTask ||
    ev.type === SVEType.ScheduledTask ||
    ev.type === SVEType.Task) &&
  typeof ev.plannedForDay === 'string';

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
  calendarEvents: ScheduleCalendarMapEntry[] | undefined | null;
  plannerDayMap: PlannerDayMap | undefined | null;
  timelineCfg?: ScheduleConfig | null;
  currentTaskId?: string | null;
}
