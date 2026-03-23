import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { WorklogService } from '../worklog.service';
import { DialogWorklogExportComponent } from '../dialog-worklog-export/dialog-worklog-export.component';
import { MatDialog } from '@angular/material/dialog';
import { WorklogDataForDay } from '../worklog.model';
import { expandAnimation, expandFadeAnimation } from '../../../ui/animations/expand.ani';
import { fadeAnimation } from '../../../ui/animations/fade.ani';
import { getDateRangeForWeek } from '../../../util/get-date-range-for-week';
import { getWeekNumber } from '../../../util/get-week-number';
import { Task } from '../../tasks/task.model';
import { TaskService } from '../../tasks/task.service';
import { T } from '../../../t.const';
import { SimpleCounterService } from '../../simple-counter/simple-counter.service';
import { DateAdapter, MatRipple } from '@angular/material/core';
import { AsyncPipe, KeyValue, KeyValuePipe } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { InlineInputComponent } from '../../../ui/inline-input/inline-input.component';
import { MatButton } from '@angular/material/button';
import { MomentFormatPipe } from '../../../ui/pipes/moment-format.pipe';
import { MsToClockStringPipe } from '../../../ui/duration/ms-to-clock-string.pipe';
import { MsToMinuteClockStringPipe } from '../../../ui/duration/ms-to-minute-clock-string.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { MetricService } from '../../metric/metric.service';
import { DialogViewArchivedTaskComponent } from '../../tasks/dialog-view-archived-task/dialog-view-archived-task.component';

@Component({
  selector: 'worklog-week',
  templateUrl: './worklog-week.component.html',
  styleUrls: ['./worklog-week.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandAnimation, expandFadeAnimation, fadeAnimation],
  imports: [
    MatRipple,
    MatIcon,
    InlineInputComponent,
    MatButton,
    AsyncPipe,
    KeyValuePipe,
    MomentFormatPipe,
    MsToClockStringPipe,
    MsToMinuteClockStringPipe,
    TranslatePipe,
  ],
})
export class WorklogWeekComponent {
  readonly worklogService = inject(WorklogService);
  readonly simpleCounterService = inject(SimpleCounterService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _taskService = inject(TaskService);
  private _dateAdapter = inject(DateAdapter);
  private readonly _metricService = inject(MetricService);

  visibility: boolean[] = [];
  T: typeof T = T;
  keys: (o: Record<string, unknown>) => string[] = Object.keys;

  sortDays<T extends KeyValue<string, V>, V = unknown>(a: T, b: T): number {
    return b.key < a.key ? 1 : -1;
  }

  async exportData(): Promise<void> {
    const now = new Date();
    const year = now.getFullYear();
    const weekNr = getWeekNumber(now, this._dateAdapter.getFirstDayOfWeek());

    // get for whole week
    const { rangeStart, rangeEnd } = getDateRangeForWeek(year, weekNr);

    this._matDialog.open(DialogWorklogExportComponent, {
      restoreFocus: true,
      panelClass: 'big',
      data: {
        rangeStart,
        rangeEnd,
      },
    });
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

  trackByDay<T extends KeyValue<string, V>, V = unknown>(i: number, day: T): string {
    return day.key;
  }

  trackByLogEntry(i: number, logEntry: WorklogDataForDay): string {
    return logEntry.task.id;
  }

  viewTaskDetails(task: Task): void {
    this._matDialog.open(DialogViewArchivedTaskComponent, {
      restoreFocus: true,
      data: { task },
    });
  }

  focusSummaryFor(dateStr: string): { count: number; total: number } | undefined {
    return this._metricService.getFocusSummaryForDay(dateStr);
  }
}
