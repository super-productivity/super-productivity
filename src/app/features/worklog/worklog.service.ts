import { inject, Injectable } from '@angular/core';
import {
  Worklog,
  WorklogDay,
  WorklogWeek,
  WorklogWeekSimple,
  WorklogYearsWithWeeks,
} from './worklog.model';
import { dedupeByKey } from '../../util/de-dupe-by-key';
import { BehaviorSubject, from, merge, Observable } from 'rxjs';
import {
  concatMap,
  filter,
  first,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
} from 'rxjs/operators';
import { getWeekNumber } from '../../util/get-week-number';
import { WorkContextService } from '../work-context/work-context.service';
import { WorkContext } from '../work-context/work-context.model';
import { mapArchiveToWorklog } from './util/map-archive-to-worklog';
import { TaskService } from '../tasks/task.service';
import { createEmptyEntity } from '../../util/create-empty-entity';
import { getCompleteStateForWorkContext } from './util/get-complete-state-for-work-context.util';
import { NavigationEnd, Router } from '@angular/router';
import { WorklogTask } from '../tasks/task.model';
import { mapArchiveToWorklogWeeks } from './util/map-archive-to-worklog-weeks';
import { DateAdapter } from '@angular/material/core';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { TimeTrackingService } from '../time-tracking/time-tracking.service';
import { TaskArchiveService } from '../archive/task-archive.service';
import { getDbDateStr } from '../../util/get-db-date-str';
import { DateTimeFormatService } from 'src/app/core/date-time-format/date-time-format.service';

@Injectable({ providedIn: 'root' })
export class WorklogService {
  private readonly _workContextService = inject(WorkContextService);
  private readonly _dataInitStateService = inject(DataInitStateService);
  private readonly _taskService = inject(TaskService);
  private readonly _timeTrackingService = inject(TimeTrackingService);
  private readonly _router = inject(Router);
  private readonly _dateTimeFormatService = inject(DateTimeFormatService);
  private _dateAdapter = inject(DateAdapter);
  private _taskArchiveService = inject(TaskArchiveService);

  // treated as private but needs to be assigned first
  archiveUpdateManualTrigger$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(
    true,
  );
  _archiveUpdateTrigger$: Observable<any> =
    this._dataInitStateService.isAllDataLoadedInitially$.pipe(
      concatMap(() =>
        merge(
          // this._workContextService.activeWorkContextOnceOnContextChange$,
          this.archiveUpdateManualTrigger$,
          this._router.events.pipe(
            filter((event: any) => event instanceof NavigationEnd),
            filter(
              ({ urlAfterRedirects }: NavigationEnd) =>
                urlAfterRedirects.includes('worklog') ||
                urlAfterRedirects.includes('daily-summary') ||
                urlAfterRedirects.includes('quick-history'),
            ),
          ),
        ),
      ),
    );

  // NOTE: task updates are not reflected
  // TODO improve to reflect task updates or load when route is changed to worklog or daily summary
  worklogData$: Observable<{
    worklog: Worklog;
    totalTimeSpent: number;
  }> = this._archiveUpdateTrigger$.pipe(
    switchMap(() => this._workContextService.activeWorkContext$.pipe(take(1))),
    switchMap((curCtx) =>
      from(this._loadWorklogForWorkContext(curCtx)).pipe(startWith<any, any>(null)),
    ),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  _worklogDataIfDefined$: Observable<{
    worklog: Worklog;
    totalTimeSpent: number;
  }> = this.worklogData$.pipe(filter((wd) => !!wd));

  worklog$: Observable<Worklog> = this._worklogDataIfDefined$.pipe(
    map((data) => data.worklog),
  );
  totalTimeSpent$: Observable<number> = this._worklogDataIfDefined$.pipe(
    map((data) => data.totalTimeSpent),
  );
  currentWeek$: Observable<WorklogWeek | null> = this.worklog$.pipe(
    map((worklog) => {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const weekNr = getWeekNumber(now);

      if (worklog[year] && worklog[year].ent[month]) {
        return (
          worklog[year].ent[month].weeks.find((week) => week.weekNr === weekNr) || null
        );
      }
      return null;
    }),
  );

  _quickHistoryData$: Observable<WorklogYearsWithWeeks | null> =
    this._archiveUpdateTrigger$.pipe(
      switchMap(() => this._workContextService.activeWorkContext$.pipe(take(1))),
      switchMap((curCtx) =>
        from(this._loadQuickHistoryForWorkContext(curCtx)).pipe(startWith(null)),
      ),
    );

  quickHistoryWeeks$: Observable<WorklogWeekSimple[] | null> =
    this._quickHistoryData$.pipe(
      map((worklogYearsWithWeeks) => {
        const now = new Date();
        const year = now.getFullYear();
        if (!worklogYearsWithWeeks) {
          return null;
        }
        if (!worklogYearsWithWeeks[year]) {
          return [];
        }
        return worklogYearsWithWeeks[year].filter((v) => !!v).reverse();
      }),
    );

  worklogTasks$: Observable<WorklogTask[]> = this.worklog$.pipe(
    map((worklog) => {
      let tasks: WorklogTask[] = [];

      Object.keys(worklog).forEach((yearKeyIN) => {
        const yearKey = +yearKeyIN;
        const year = worklog[yearKey];

        if (year && year.ent) {
          Object.keys(year.ent).forEach((monthKeyIN) => {
            // needs de-normalization
            const monthKey = +monthKeyIN;
            const month = year.ent[monthKey];

            if (month && month.ent) {
              Object.keys(month.ent).forEach((dayKeyIN) => {
                const dayKey = +dayKeyIN;
                const day: WorklogDay = month.ent[dayKey];
                if (day) {
                  tasks = tasks.concat(this._createTasksForDay(day));
                }
              });
            }
          });
        }
      });
      return tasks;
    }),
  );

  refreshWorklog(): void {
    this.archiveUpdateManualTrigger$.next(true);
  }

  // TODO this is not waiting for worklog data
  getTaskListForRange$(
    rangeStart: Date,
    rangeEnd: Date,
    isFilterOutTimeSpentOnOtherDays: boolean = false,
    projectId?: string | null,
  ): Observable<WorklogTask[]> {
    const isProjectIdProvided: boolean = !!projectId || projectId === null;

    // Convert date range to date strings for timezone-safe comparison
    const rangeStartStr = getDbDateStr(rangeStart);
    const rangeEndStr = getDbDateStr(rangeEnd);

    return this.worklogTasks$.pipe(
      map((tasks) => {
        tasks = tasks.filter((task: WorklogTask) => {
          // Use date string comparison instead of Date object comparison
          // to avoid timezone issues
          return (
            (!isProjectIdProvided || task.projectId === projectId) &&
            task.dateStr >= rangeStartStr &&
            task.dateStr <= rangeEndStr
          );
        });

        if (isFilterOutTimeSpentOnOtherDays) {
          tasks = tasks.map((task): WorklogTask => {
            const timeSpentOnDay: any = {};
            Object.keys(task.timeSpentOnDay).forEach((dateStr) => {
              // Use date string comparison instead of Date object comparison
              // to avoid timezone issues
              if (dateStr >= rangeStartStr && dateStr <= rangeEndStr) {
                timeSpentOnDay[dateStr] = task.timeSpentOnDay[dateStr];
              }
            });

            return {
              ...task,
              timeSpentOnDay,
            };
          });
        }

        return dedupeByKey(tasks, 'id');
      }),
    );
  }

  private async _loadWorklogForWorkContext(
    workContext: WorkContext,
  ): Promise<{ worklog: Worklog; totalTimeSpent: number }> {
    const archive = (await this._taskArchiveService.load()) || createEmptyEntity();
    const taskState =
      (await this._taskService.taskFeatureState$.pipe(first()).toPromise()) ||
      createEmptyEntity();

    const { completeStateForWorkContext, nonArchiveTaskIds } =
      getCompleteStateForWorkContext(workContext, taskState, archive);

    const workStartEndForWorkContext =
      await this._timeTrackingService.getLegacyWorkStartEndForWorkContext(workContext);

    if (completeStateForWorkContext) {
      const { worklog, totalTimeSpent } = mapArchiveToWorklog(
        completeStateForWorkContext,
        nonArchiveTaskIds,
        workStartEndForWorkContext,
        this._dateAdapter.getFirstDayOfWeek(),
        this._dateTimeFormatService.currentLocale,
      );
      return {
        worklog,
        totalTimeSpent,
      };
    }
    return {
      worklog: {},
      totalTimeSpent: 0,
    };
  }

  private async _loadQuickHistoryForWorkContext(
    workContext: WorkContext,
  ): Promise<WorklogYearsWithWeeks | null> {
    const archive = (await this._taskArchiveService.load()) || createEmptyEntity();
    const taskState =
      (await this._taskService.taskFeatureState$.pipe(first()).toPromise()) ||
      createEmptyEntity();

    const { completeStateForWorkContext, nonArchiveTaskIds } =
      getCompleteStateForWorkContext(workContext, taskState, archive);

    const workStartEndForWorkContext =
      await this._timeTrackingService.getLegacyWorkStartEndForWorkContext(workContext);

    if (completeStateForWorkContext) {
      return mapArchiveToWorklogWeeks(
        completeStateForWorkContext,
        nonArchiveTaskIds,
        workStartEndForWorkContext,
        this._dateAdapter.getFirstDayOfWeek(),
        this._dateTimeFormatService.currentLocale,
      );
    }
    return null;
  }

  private _createTasksForDay(data: WorklogDay): WorklogTask[] {
    const dayData = { ...data };

    return dayData.logEntries.map((entry) => {
      return {
        ...entry.task,
        timeSpent: entry.timeSpent,
        dateStr: dayData.dateStr,
      };
    });
  }
}
