import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { Task, TaskCopy, TimeSpentOnDayCopy } from '../task.model';
import { TaskService } from '../task.service';
import { getTodayStr } from '../util/get-today-str';
import { createTaskCopy } from '../util/create-task-copy';
import {
  DialogAddTimeEstimateForOtherDayComponent,
  NewTimeEntry,
} from '../dialog-add-time-estimate-for-other-day/dialog-add-time-estimate-for-other-day.component';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { T } from '../../../t.const';
import { FormsModule } from '@angular/forms';
import { HelpSectionComponent } from '../../../ui/help-section/help-section.component';
import { InputDurationSliderComponent } from '../../../ui/duration/input-duration-slider/input-duration-slider.component';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatFormField, MatLabel, MatPrefix } from '@angular/material/form-field';
import { InputDurationDirective } from '../../../ui/duration/input-duration.directive';
import { MatInput } from '@angular/material/input';
import { KeysPipe } from '../../../ui/pipes/keys.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { LocaleDatePipe } from '../../../ui/pipes/locale-date.pipe';
import { JiraWorklogService } from '../../issue/providers/jira/jira-worklog.service';
import { JIRA_TYPE } from '../../issue/issue.const';

@Component({
  selector: 'dialog-time-estimate',
  templateUrl: './dialog-time-estimate.component.html',
  styleUrls: ['./dialog-time-estimate.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    FormsModule,
    MatDialogContent,
    HelpSectionComponent,
    InputDurationSliderComponent,
    MatButton,
    MatIcon,
    MatFormField,
    MatLabel,
    InputDurationDirective,
    MatInput,
    MatPrefix,
    MatIconButton,
    MatDialogActions,
    MatDialogClose,
    KeysPipe,
    TranslatePipe,
    LocaleDatePipe,
  ],
})
export class DialogTimeEstimateComponent implements AfterViewInit {
  private _matDialogRef = inject<MatDialogRef<DialogTimeEstimateComponent>>(MatDialogRef);
  private _matDialog = inject(MatDialog);
  private _taskService = inject(TaskService);
  private _cd = inject(ChangeDetectorRef);
  private _el = inject(ElementRef);
  private readonly _jiraWorklogService = inject(JiraWorklogService);
  data = inject(MAT_DIALOG_DATA);

  T: typeof T = T;
  protected readonly JIRA_TYPE = JIRA_TYPE;
  todayStr: string;
  task: Task;
  taskCopy: TaskCopy;
  timeSpentOnDayCopy: TimeSpentOnDayCopy;

  constructor() {
    const _taskService = this._taskService;

    this.task = this.data.task;
    this.todayStr = getTodayStr();
    this._taskService = _taskService;
    this.taskCopy = createTaskCopy(this.task);
    this.timeSpentOnDayCopy = this.taskCopy.timeSpentOnDay || {};
  }

  ngAfterViewInit(): void {
    if (this.data.isFocusEstimateOnMousePrimaryDevice) {
      this._el.nativeElement.querySelectorAll('input')?.[1]?.focus();
    }
  }

  submit(): void {
    this._taskService.update(this.taskCopy.id, {
      timeEstimate: this.taskCopy.timeEstimate,
      timeSpentOnDay: this.timeSpentOnDayCopy,
    });
    this._matDialogRef.close({
      timeEstimate: this.taskCopy.timeEstimate,
      timeSpentOnDay: this.timeSpentOnDayCopy,
    });
  }

  submitAndLogToJira(): void {
    this.submit();
    this._jiraWorklogService.openWorklogDialogForTask(this.task);
  }

  showAddForAnotherDayForm(): void {
    this._matDialog
      .open(DialogAddTimeEstimateForOtherDayComponent)
      .afterClosed()
      .subscribe((result: NewTimeEntry) => {
        if (result && result.timeSpent > 0 && result.date) {
          this.timeSpentOnDayCopy = {
            ...this.timeSpentOnDayCopy,
            [getDbDateStr(result.date)]: result.timeSpent,
          };
          this.taskCopy.timeSpentOnDay = this.timeSpentOnDayCopy;
          this._cd.detectChanges();
        }
      });
  }

  deleteValue(strDate: string): void {
    delete this.timeSpentOnDayCopy[strDate];
  }

  trackByIndex(i: number, p: any): number {
    return i;
  }
}
