import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { expandAnimation, expandFadeAnimation } from '../../ui/animations/expand.ani';
import { fadeAnimation, fadeInSlowAnimation } from '../../ui/animations/fade.ani';
import { WorklogService } from '../worklog/worklog.service';
import { SimpleCounterService } from '../simple-counter/simple-counter.service';
import { TaskService } from '../tasks/task.service';
import { Task } from '../tasks/task.model';
import { WorklogDataForDay, WorklogDay } from '../worklog/worklog.model';
import { T } from 'src/app/t.const';
import { AsyncPipe, KeyValue, KeyValuePipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { MsToStringPipe } from '../../ui/duration/ms-to-string.pipe';
import { MsToClockStringPipe } from '../../ui/duration/ms-to-clock-string.pipe';
import { MomentFormatPipe } from '../../ui/pipes/moment-format.pipe';
import { MsToMinuteClockStringPipe } from '../../ui/duration/ms-to-minute-clock-string.pipe';
import { MatIcon } from '@angular/material/icon';
import { InlineInputComponent } from '../../ui/inline-input/inline-input.component';
import { FullPageSpinnerComponent } from '../../ui/full-page-spinner/full-page-spinner.component';
import { MatDialog } from '@angular/material/dialog';
import { DialogViewArchivedTaskComponent } from '../tasks/dialog-view-archived-task/dialog-view-archived-task.component';

@Component({
  selector: 'quick-history',
  templateUrl: './quick-history.component.html',
  styleUrls: ['./quick-history.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandAnimation, expandFadeAnimation, fadeAnimation, fadeInSlowAnimation],
  imports: [
    TranslatePipe,
    AsyncPipe,
    MsToStringPipe,
    MsToClockStringPipe,
    MomentFormatPipe,
    MsToMinuteClockStringPipe,
    MatIcon,
    InlineInputComponent,
    KeyValuePipe,
    FullPageSpinnerComponent,
  ],
})
export class QuickHistoryComponent {
  readonly worklogService = inject(WorklogService);
  readonly simpleCounterService = inject(SimpleCounterService);
  private readonly _taskService = inject(TaskService);
  private readonly _matDialog = inject(MatDialog);

  visibility: boolean[] = [];
  T: typeof T = T;
  keys: (o: Record<string, unknown>) => string[] = Object.keys;

  sortDays(a: KeyValue<string, WorklogDay>, b: KeyValue<string, WorklogDay>): number {
    // avoid comparison by key (day) because a week may span across two months
    return a.value.dateStr.localeCompare(b.value.dateStr);
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

  trackByDay(i: number, day: any): string {
    return day.key;
  }

  filterWorklogDataForDay(worklogDataForDay: WorklogDataForDay[]): WorklogDataForDay[] {
    return worklogDataForDay.filter(
      (entry) => entry.task.isDone || entry.timeSpent > 1000,
    );
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
}
