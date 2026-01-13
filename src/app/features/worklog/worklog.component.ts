import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  inject,
  OnDestroy,
} from '@angular/core';
import { expandFadeAnimation } from '../../ui/animations/expand.ani';
import { WorklogDataForDay, WorklogMonth, WorklogWeek } from './worklog.model';
import { MatDialog } from '@angular/material/dialog';
import { Task, TaskCopy } from '../tasks/task.model';
import { TaskService } from '../tasks/task.service';
import { DialogWorklogExportComponent } from './dialog-worklog-export/dialog-worklog-export.component';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { ActivatedRoute, Router } from '@angular/router';
import { standardListAnimation } from '../../ui/animations/standard-list.ani';
import { WorklogService } from './worklog.service';
import { getDateRangeForMonth } from '../../util/get-date-range-for-month';
import { getDateRangeForWeek } from '../../util/get-date-range-for-week';
import { fadeAnimation, fadeInSlowAnimation } from '../../ui/animations/fade.ani';
import { T } from '../../t.const';
import { WorkContextService } from '../work-context/work-context.service';
import { SearchQueryParams } from '../../pages/search-page/search-page.model';
import { Subscription } from 'rxjs';
import { Store } from '@ngrx/store';
import { selectAllProjectColorsAndTitles } from '../project/store/project.selectors';
import { FullPageSpinnerComponent } from '../../ui/full-page-spinner/full-page-spinner.component';
import { AsyncPipe, KeyValue, KeyValuePipe } from '@angular/common';
import { MatIconButton, MatMiniFabButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { InlineInputComponent } from '../../ui/inline-input/inline-input.component';
import { MsToClockStringPipe } from '../../ui/duration/ms-to-clock-string.pipe';
import { MsToStringPipe } from '../../ui/duration/ms-to-string.pipe';
import { NumberToMonthPipe } from '../../ui/pipes/number-to-month.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { TaskArchiveService } from '../archive/task-archive.service';
import { Log } from '../../core/log';

@Component({
  selector: 'worklog',
  templateUrl: './worklog.component.html',
  styleUrls: ['./worklog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    expandFadeAnimation,
    standardListAnimation,
    fadeAnimation,
    fadeInSlowAnimation,
  ],
  imports: [
    FullPageSpinnerComponent,
    MatMiniFabButton,
    MatIcon,
    MatTooltip,
    InlineInputComponent,
    MatIconButton,
    AsyncPipe,
    KeyValuePipe,
    MsToClockStringPipe,
    MsToStringPipe,
    NumberToMonthPipe,
    TranslatePipe,
  ],
})
export class WorklogComponent implements AfterViewInit, OnDestroy {
  readonly worklogService = inject(WorklogService);
  readonly workContextService = inject(WorkContextService);
  private readonly _taskService = inject(TaskService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _store = inject(Store);
  private readonly _taskArchiveService = inject(TaskArchiveService);

  T: typeof T = T;
  expanded: { [key: string]: boolean } = {};
  allProjectsColorAndTitle: { [key: string]: { title: string; color: string } } = {};

  private _subs: Subscription = new Subscription();

  ngAfterViewInit(): void {
    this._subs.add(
      this._route.queryParams.subscribe((params) => {
        const { dateStr } = params as SearchQueryParams;
        if (!!dateStr) {
          this.expanded[dateStr] = true;
        }
      }),
    );
    this._subs.add(
      this._store
        .select(selectAllProjectColorsAndTitles)
        .subscribe((colorMap) => (this.allProjectsColorAndTitle = colorMap)),
    );
  }

  exportData(
    monthData: WorklogMonth,
    year: string | number,
    month: string | number,
    week?: number,
  ): void {
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
          let subTasks;
          if (task.subTaskIds && task.subTaskIds.length) {
            const archiveState = await this._taskArchiveService.load();
            subTasks = task.subTaskIds
              .map((id) => archiveState.entities[id])
              .filter((v) => !!v);
          }

          Log.log('RESTORE', task, subTasks);
          this._taskService.restoreTask(task, (subTasks || []) as Task[]);
          this._router.navigate(['/active/tasks']);
        }
      });
  }

  sortWorklogItems = <T extends KeyValue<string, unknown>>(a: T, b: T): number =>
    +b.key - +a.key;

  sortWorklogItemsReverse = <T extends KeyValue<string, unknown>>(a: T, b: T): number =>
    -this.sortWorklogItems(a, b);

  trackByKey<T extends KeyValue<K, V>, K extends string | number = string, V = unknown>(
    i: number,
    val: T,
  ): K {
    return val.key;
  }

  trackByForLogEntry(i: number, val: WorklogDataForDay): string {
    return val.task.id;
  }

  trackByForWeek(i: number, val: WorklogWeek): number {
    return val.weekNr;
  }

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
    this.worklogService.refreshWorklog();
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }
}
