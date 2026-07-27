import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { expandFadeAnimation } from '../../ui/animations/expand.ani';
import { SimpleCounter } from '../simple-counter/simple-counter.model';
import { MatDialog } from '@angular/material/dialog';
import { Task, TaskCopy } from '../tasks/task.model';
import { TaskService } from '../tasks/task.service';
import { DialogWorklogExportComponent } from '../worklog/dialog-worklog-export/dialog-worklog-export.component';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { ActivatedRoute, Router } from '@angular/router';
import { WorklogService } from '../worklog/worklog.service';
import { getDateRangeForMonth } from '../../util/get-date-range-for-month';
import { getDateRangeForWeek } from '../../util/get-date-range-for-week';
import { fadeInSlowAnimation } from '../../ui/animations/fade.ani';
import { T } from '../../t.const';
import { WorkContextService } from '../work-context/work-context.service';
import { SimpleCounterService } from '../simple-counter/simple-counter.service';
import { SearchQueryParams } from '../../pages/search-page/search-page.model';
import { Store } from '@ngrx/store';
import { selectAllProjectColorsAndTitles } from '../project/store/project.selectors';
import { FullPageSpinnerComponent } from '../../ui/full-page-spinner/full-page-spinner.component';
import { KeyValue, KeyValuePipe } from '@angular/common';
import { MatMiniFabButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { MsToClockStringPipe } from '../../ui/duration/ms-to-clock-string.pipe';
import { MsToStringPipe } from '../../ui/duration/ms-to-string.pipe';
import { MomentFormatPipe } from '../../ui/pipes/moment-format.pipe';
import { NumberToMonthPipe } from '../../ui/pipes/number-to-month.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { TaskArchiveService } from '../archive/task-archive.service';
import { Log } from '../../core/log';
import { DialogViewArchivedTaskComponent } from '../tasks/dialog-view-archived-task/dialog-view-archived-task.component';
import { WorklogTaskRowComponent } from '../worklog/worklog-task-row/worklog-task-row.component';
import { HistoryDayMetaComponent } from './history-day-meta/history-day-meta.component';
import { DateService } from '../../core/date/date.service';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';

@Component({
  selector: 'history',
  templateUrl: './history.component.html',
  styleUrls: ['./history.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandFadeAnimation, fadeInSlowAnimation],
  imports: [
    FullPageSpinnerComponent,
    MatMiniFabButton,
    MatIcon,
    MatTooltip,
    KeyValuePipe,
    MsToClockStringPipe,
    MsToStringPipe,
    MomentFormatPipe,
    NumberToMonthPipe,
    TranslatePipe,
    WorklogTaskRowComponent,
    HistoryDayMetaComponent,
  ],
})
export class HistoryComponent {
  private readonly _worklogService = inject(WorklogService);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _simpleCounterService = inject(SimpleCounterService);
  private readonly _taskService = inject(TaskService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _store = inject(Store);
  private readonly _taskArchiveService = inject(TaskArchiveService);
  private readonly _dateService = inject(DateService);
  private readonly _queryParams = toSignal(this._route.queryParams, {
    initialValue: this._route.snapshot.queryParams,
  });

  T: typeof T = T;
  readonly worklogData = toSignal(this._worklogService.worklogData$);
  readonly enabledSimpleCounters = toSignal(
    this._simpleCounterService.enabledSimpleCounters$,
    { initialValue: [] as SimpleCounter[] },
  );
  private readonly _allProjectsColorAndTitle = this._store.selectSignal(
    selectAllProjectColorsAndTitles,
  );
  expanded: { [key: string]: boolean } = {};
  expandedMonths: { [key: string]: boolean } = (() => {
    const now = new Date();
    return { [`${now.getFullYear()}-${now.getMonth() + 1}`]: true };
  })();

  constructor() {
    // Auto-expand the day (and its containing month) that a deep-link targets
    // via the `dateStr` query param. `_queryParams` is already a signal, so an
    // effect replaces the old subscription + lifecycle hooks.
    effect(() => {
      const { dateStr } = this._queryParams() as SearchQueryParams;
      if (!dateStr) {
        return;
      }
      this.expanded[dateStr] = true;
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        this.expandedMonths[+parts[0] + '-' + +parts[1]] = true;
      }
    });
  }

  exportData(year: string | number, month: string | number, week?: number): void {
    const { rangeStart, rangeEnd } =
      typeof week === 'number'
        ? getDateRangeForWeek(+year, week, +month)
        : getDateRangeForMonth(+year, +month);

    this._matDialog.open(DialogWorklogExportComponent, {
      restoreFocus: true,
      panelClass: 'big',
      data: {
        rangeStart,
        rangeEnd,
      },
    });
  }

  viewTaskDetails(task: Task): void {
    this._matDialog.open(DialogViewArchivedTaskComponent, {
      restoreFocus: true,
      data: { task },
    });
  }

  // only show the project color dot on the combined "Today" list
  projectColorFor(task: Task): { title: string; color: string } | null {
    if (!this._workContextService.isTodayList) {
      return null;
    }
    return this._allProjectsColorAndTitle()[task.projectId] ?? null;
  }

  restoreTask(task: TaskCopy): void {
    this._matDialog
      .open(DialogConfirmComponent, {
        restoreFocus: true,
        data: {
          okTxt: T.G.DO_IT,
          message: T.F.WORKLOG.D_CONFIRM_RESTORE,
          translateParams: { title: task.title },
        },
      })
      .afterClosed()
      .subscribe(async (isConfirm: boolean) => {
        // because we navigate away we don't need to worry about updating the worklog itself
        if (isConfirm) {
          let subTasks: Task[] | undefined;
          if (task.subTaskIds && task.subTaskIds.length) {
            const archiveState = await this._taskArchiveService.load();
            subTasks = task.subTaskIds
              .map((id) => archiveState.entities[id])
              .filter((t): t is Task => !!t);
          }
          const restoreToToday = {
            today: this._dateService.todayStr(),
            startOfNextDayDiffMs: this._dateService.getStartOfNextDayDiffMs(),
          };

          Log.log('RESTORE', { taskId: task.id, subTaskCount: subTasks?.length });
          this._store.dispatch(
            TaskSharedActions.restoreTask({
              task,
              subTasks: subTasks || [],
              restoreToToday,
            }),
          );
          this._router.navigate(['/active/tasks']);
        }
      });
  }

  toggleMonth(yearKey: string, monthKey: string): void {
    const key = yearKey + '-' + monthKey;
    this.expandedMonths[key] = !this.isMonthExpanded(yearKey, monthKey);
  }

  isMonthExpanded(yearKey: string, monthKey: string): boolean {
    return !!this.expandedMonths[yearKey + '-' + monthKey];
  }

  toggleDay(dateStr: string): void {
    this.expanded[dateStr] = !this.isDayExpanded(dateStr);
  }

  isDayExpanded(dateStr: string): boolean {
    return !!this.expanded[dateStr];
  }

  sortWorklogItems = <T extends KeyValue<string, unknown>>(a: T, b: T): number =>
    +b.key - +a.key;

  sortWorklogItemsReverse = <T extends KeyValue<string, unknown>>(a: T, b: T): number =>
    -this.sortWorklogItems(a, b);

  async updateTimeSpentTodayForTask(
    task: Task,
    dateStr: string,
    newVal: number | string,
  ): Promise<void> {
    await this._taskService.updateEverywhere(task.id, {
      timeSpentOnDay: {
        ...task.timeSpentOnDay,
        [dateStr]: +newVal,
      },
    });
    this._worklogService.refreshWorklog();
  }
}
