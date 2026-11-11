import { effect, inject, Injectable, signal } from '@angular/core';
import { BehaviorSubject, combineLatest, Observable, of } from 'rxjs';
import { first, map, shareReplay, switchMap, tap } from 'rxjs/operators';
import { selectAllTasksWithDueTime } from '../tasks/store/task.selectors';
import { Store } from '@ngrx/store';
import { CalendarIntegrationService } from '../calendar-integration/calendar-integration.service';
import { PlannerDay } from './planner.model';
import { selectPlannerDays } from './store/planner.selectors';
import { TaskWithDueTime } from '../tasks/task.model';
import { DateService } from '../../core/date/date.service';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { selectTodayTaskIds } from '../work-context/store/work-context.selectors';
import { msToString } from '../../ui/duration/ms-to-string.pipe';
import { getDbDateStr } from '../../util/get-db-date-str';
import { parseDbDateStr } from '../../util/parse-db-date-str';
import { getDiffInDays } from '../../util/get-diff-in-days';
import { selectActiveTaskRepeatCfgs } from '../task-repeat-cfg/store/task-repeat-cfg.selectors';
import { Log } from '../../core/log';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { buildDayWindow } from './util/build-day-window';
import { hideEmptyWeekendDays } from './util/planner-visible-days';
import { GlobalConfigService } from '../config/global-config.service';
import { getLocaleWeekendDays } from '../../util/get-locale-weekend-days';
import { distinctUntilChanged } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class PlannerService {
  private static readonly INITIAL_DAYS_DESKTOP = 15;
  private static readonly INITIAL_DAYS_MOBILE = 5;
  private static readonly AUTO_LOAD_INCREMENT = 7;

  private static readonly ALL_WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

  private _store = inject(Store);
  private _calendarIntegrationService = inject(CalendarIntegrationService);
  private _dateService = inject(DateService);
  private _globalTrackingIntervalService = inject(GlobalTrackingIntervalService);
  private _layoutService = inject(LayoutService);
  private _globalConfigService = inject(GlobalConfigService);

  private _userHasScrolled = signal(false);

  private _daysToShowCount$ = new BehaviorSubject<number>(
    this._layoutService.isXs()
      ? PlannerService.INITIAL_DAYS_MOBILE
      : PlannerService.INITIAL_DAYS_DESKTOP,
  );
  public isLoadingMore$ = new BehaviorSubject<boolean>(false);
  private _loadMoreTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /**
   * Days the window advances through. Hiding weekends (#7240) skips them here,
   * the empty ones are dropped from the rendered list below.
   */
  includedWeekDays$: Observable<number[]> = combineLatest([
    this._globalConfigService.localization$,
    this._globalConfigService.planner$,
  ]).pipe(
    map(([localization, planner]) =>
      planner?.isHideWeekends
        ? PlannerService.ALL_WEEK_DAYS.filter(
            (day) => !getLocaleWeekendDays(localization?.lng ?? 'en').includes(day),
          )
        : [...PlannerService.ALL_WEEK_DAYS],
    ),
    distinctUntilChanged((a, b) => a.join() === b.join()),
  );

  constructor() {
    // Reset to initial count when breakpoint changes, but only if user hasn't scrolled yet
    effect(() => {
      const isMobile = this._layoutService.isXs();

      // Only reset to initial count if user hasn't manually scrolled yet
      if (!this._userHasScrolled()) {
        const newCount = isMobile
          ? PlannerService.INITIAL_DAYS_MOBILE
          : PlannerService.INITIAL_DAYS_DESKTOP;
        this._daysToShowCount$.next(newCount);
      }
    });
  }

  daysToShow$ = combineLatest([
    this._daysToShowCount$,
    this._globalTrackingIntervalService.todayDateStr$,
    this.includedWeekDays$,
  ]).pipe(
    // eslint-disable-next-line local-rules/no-user-content-in-logs -- grandfathered log baseline (2026-09), not yet triaged
    tap(([count, todayStr]) => Log.log('daysToShow$', { count, todayStr })),
    map(([count, _, includedWeekDays]) =>
      buildDayWindow(
        // Anchor on the logical day, not the raw clock: between calendar
        // midnight and the configured start-of-next-day the window must still
        // begin at (logical) today, or the tasks planned for it have no
        // rendered day at all; ensureDayLoaded below can only extend the
        // window forward.
        this._dateService.getLogicalTodayDate(),
        count,
        includedWeekDays,
        (d) => this._dateService.todayStr(d),
      ),
    ),
  );

  allDueWithTimeTasks$: Observable<TaskWithDueTime[]> = this._store.select(
    selectAllTasksWithDueTime,
  );

  // TODO this needs to be more performant
  private _selectPlannerDaysFor$(
    dayDates$: Observable<string[]>,
  ): Observable<PlannerDay[]> {
    return dayDates$.pipe(
      switchMap((daysToShow) =>
        combineLatest([
          this._store.select(selectActiveTaskRepeatCfgs),
          this._store.select(selectTodayTaskIds),
          this._calendarIntegrationService.calendarEvents$,
          this.allDueWithTimeTasks$,
          this._globalTrackingIntervalService.todayDateStr$,
        ]).pipe(
          switchMap(
            ([
              taskRepeatCfgs,
              todayListTaskIds,
              calendarEvents,
              allTasksPlanned,
              todayStr,
            ]) =>
              this._store.select(
                selectPlannerDays(
                  daysToShow,
                  taskRepeatCfgs,
                  todayListTaskIds,
                  calendarEvents,
                  allTasksPlanned,
                  todayStr,
                ),
              ),
          ),
        ),
      ),
    );
  }

  /**
   * The window skips weekend days when weekends are hidden, so the rendered
   * range stretches across them; `days$` then keeps only the weekend days that
   * hold work.
   */
  private _plannerDayRange$: Observable<string[]> = this.daysToShow$.pipe(
    map((days) => {
      if (days.length === 0) {
        return [];
      }
      const firstDay = parseDbDateStr(days[0]);
      const lastDay = parseDbDateStr(days[days.length - 1]);
      return buildDayWindow(
        firstDay,
        getDiffInDays(firstDay, lastDay) + 1,
        PlannerService.ALL_WEEK_DAYS,
        (d) => this._dateService.todayStr(d),
      );
    }),
  );

  days$: Observable<PlannerDay[]> = combineLatest([
    this._selectPlannerDaysFor$(this._plannerDayRange$),
    this._globalConfigService.localization$,
    this._globalConfigService.planner$,
  ]).pipe(
    map(([days, localization, planner]) =>
      planner?.isHideWeekends
        ? hideEmptyWeekendDays(days, getLocaleWeekendDays(localization?.lng ?? 'en'))
        : days,
    ),
    // for better performance
    // TODO better solution, gets called very often
    // tap((val) => Log.log('days$', val)),
    // tap((val) => Log.log('days$ SIs', val[0]?.scheduledIItems)),
    shareReplay({ bufferSize: 1, refCount: true }),
  );
  tomorrow$ = this.days$.pipe(
    map((days) => {
      const tomorrowStr = getDbDateStr(this._dateService.getLogicalTomorrowMs());
      return days.find((d) => d.dayDate === tomorrowStr) ?? null;
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  // plannedTaskDayMap$: Observable<{ [taskId: string]: string }> = this._store
  //   .select(selectTaskIdPlannedDayMap)
  //   // make this more performant by sharing stream
  //   .pipe(shareReplay(1));

  /** Live planner days for fixed dates, e.g. next week in Finish day. */
  getDays$(dayStrs: string[]): Observable<PlannerDay[]> {
    return this._selectPlannerDaysFor$(of(dayStrs));
  }

  getDayOnce$(dayStr: string): Observable<PlannerDay | undefined> {
    return this._selectPlannerDaysFor$(of([dayStr])).pipe(
      map((days) => days.find((d) => d.dayDate === dayStr)),
      first(),
    );
  }

  getSnackExtraStr(dayStr: string): Promise<string> {
    return this.getDayOnce$(dayStr)
      .pipe(
        map((day) => {
          if (!day) {
            return '';
          }
          if (day.timeEstimate === 0) {
            return ` – ∑ ${day.itemsTotal}`;
          }

          return `<br />∑ ${day.itemsTotal} ｜ ${msToString(day.timeEstimate)}`;
        }),
      )
      .toPromise();
  }

  loadMoreDays(): void {
    this.isLoadingMore$.next(true);
    this._userHasScrolled.set(true);

    // Yield to event loop to ensure loading state is visible
    this._loadMoreTimeoutId = setTimeout(() => {
      this._loadMoreTimeoutId = null;
      const currentCount = this._daysToShowCount$.value;
      this._daysToShowCount$.next(currentCount + PlannerService.AUTO_LOAD_INCREMENT);
      this.isLoadingMore$.next(false);
    }, 0);
  }

  ensureDayLoaded(dayDate: string): void {
    const target = parseDbDateStr(dayDate);
    const diff = getDiffInDays(this._dateService.getLogicalTodayDate(), target);
    if (diff >= 0 && diff >= this._daysToShowCount$.value) {
      this._userHasScrolled.set(true);
      this._daysToShowCount$.next(diff + 3);
    }
  }

  resetScrollState(): void {
    if (this._loadMoreTimeoutId !== null) {
      clearTimeout(this._loadMoreTimeoutId);
      this._loadMoreTimeoutId = null;
    }
    this.isLoadingMore$.next(false);
    this._userHasScrolled.set(false);
    this._daysToShowCount$.next(
      this._layoutService.isXs()
        ? PlannerService.INITIAL_DAYS_MOBILE
        : PlannerService.INITIAL_DAYS_DESKTOP,
    );
  }
}
