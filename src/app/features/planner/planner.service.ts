import { inject, Injectable } from '@angular/core';
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
import { selectAllTaskRepeatCfgs } from '../task-repeat-cfg/store/task-repeat-cfg.selectors';
import { Log } from '../../core/log';

@Injectable({
  providedIn: 'root',
})
export class PlannerService {
  private _store = inject(Store);
  private _calendarIntegrationService = inject(CalendarIntegrationService);
  private _dateService = inject(DateService);
  private _globalTrackingIntervalService = inject(GlobalTrackingIntervalService);

  private _daysToShowCount$ = new BehaviorSubject<number>(15);
  public isLoadingMore$ = new BehaviorSubject<boolean>(false);

  includedWeekDays$ = of([0, 1, 2, 3, 4, 5, 6]);

  daysToShow$ = combineLatest([
    this._daysToShowCount$,
    this._globalTrackingIntervalService.todayDateStr$,
    this.includedWeekDays$,
  ]).pipe(
    tap(([count, todayStr]) => Log.log('daysToShow$', { count, todayStr })),
    map(([count, _, includedWeekDays]) => {
      // Guard against empty includedWeekDays to prevent infinite loop
      if (includedWeekDays.length === 0) {
        return [];
      }

      const today = new Date().getTime();
      const daysToShow: string[] = [];

      // CRITICAL FIX: Loop until we have the required count of days
      // (not just iterate N times which produces fewer days if weekends are excluded)
      let daysAdded = 0;
      let offset = 0;
      while (daysAdded < count) {
        // eslint-disable-next-line no-mixed-operators
        const dayOfWeek = new Date(today + offset * 24 * 60 * 60 * 1000).getDay();
        if (includedWeekDays.includes(dayOfWeek)) {
          daysToShow.push(
            // eslint-disable-next-line no-mixed-operators
            this._dateService.todayStr(today + offset * 24 * 60 * 60 * 1000),
          );
          daysAdded++;
        }
        offset++;
      }

      return daysToShow;
    }),
  );

  allDueWithTimeTasks$: Observable<TaskWithDueTime[]> = this._store.select(
    selectAllTasksWithDueTime,
  );

  // TODO this needs to be more performant
  days$: Observable<PlannerDay[]> = this.daysToShow$.pipe(
    switchMap((daysToShow) =>
      combineLatest([
        this._store.select(selectAllTaskRepeatCfgs),
        this._store.select(selectTodayTaskIds),
        this._calendarIntegrationService.icalEvents$,
        this.allDueWithTimeTasks$,
        this._globalTrackingIntervalService.todayDateStr$,
      ]).pipe(
        switchMap(
          ([taskRepeatCfgs, todayListTaskIds, icalEvents, allTasksPlanned, todayStr]) =>
            this._store.select(
              selectPlannerDays(
                daysToShow,
                taskRepeatCfgs,
                todayListTaskIds,
                icalEvents,
                allTasksPlanned,
                todayStr,
              ),
            ),
        ),
      ),
    ),
    // for better performance
    // TODO better solution, gets called very often
    // tap((val) => Log.log('days$', val)),
    // tap((val) => Log.log('days$ SIs', val[0]?.scheduledIItems)),
    shareReplay({ bufferSize: 1, refCount: true }),
  );
  tomorrow$ = this.days$.pipe(
    map((days) => {
      const todayMs = Date.now() - this._dateService.startOfNextDayDiff;
      // eslint-disable-next-line no-mixed-operators
      const tomorrowMs = todayMs + 24 * 60 * 60 * 1000;
      const tomorrowStr = getDbDateStr(tomorrowMs);
      return days.find((d) => d.dayDate === tomorrowStr) ?? null;
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  // plannedTaskDayMap$: Observable<{ [taskId: string]: string }> = this._store
  //   .select(selectTaskIdPlannedDayMap)
  //   // make this more performant by sharing stream
  //   .pipe(shareReplay(1));

  getDayOnce$(dayStr: string): Observable<PlannerDay | undefined> {
    return this.days$.pipe(
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

    // Yield to event loop to ensure loading state is visible
    setTimeout(() => {
      const currentCount = this._daysToShowCount$.value;
      this._daysToShowCount$.next(currentCount + 7);
      this.isLoadingMore$.next(false);
    }, 0);
  }
}
