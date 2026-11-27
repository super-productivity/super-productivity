import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { filter } from 'rxjs/operators';
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
import { selectTaskEntities } from '../store/task.selectors';
import { DateService } from '../../../core/date/date.service';
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
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';

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
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _dateService = inject(DateService);
  private _taskEntities = inject(Store).selectSignal(selectTaskEntities);
  data = inject(MAT_DIALOG_DATA);

  // Exposed so the template can pass the reactive locale to the now-pure
  // `localeDate` pipe, preserving re-render on a locale change.
  readonly locale = this._dateTimeFormatService.currentLocale;

  T: typeof T = T;
  todayStr: string;
  task: Task;
  taskCopy: TaskCopy;
  timeSpentOnDayCopy: TimeSpentOnDayCopy;

  constructor() {
    const _taskService = this._taskService;

    this.task = this.data.task;
    this.todayStr = this._dateService.todayStr();
    this._taskService = _taskService;
    this.taskCopy = createTaskCopy(this.task);
    this.timeSpentOnDayCopy = this.taskCopy.timeSpentOnDay || {};

    // Tapping outside keeps the edit (#10823): spinning the duration dial is
    // tedious to redo. Escape and Cancel still discard. Closing is handled here
    // because the default backdrop close would race a second close().
    this._matDialogRef.disableClose = true;
    this._matDialogRef
      .backdropClick()
      .pipe(takeUntilDestroyed())
      .subscribe(() => (this._isChanged() ? this.submit() : this._matDialogRef.close()));
    this._matDialogRef
      .keydownEvents()
      .pipe(
        filter((ev) => ev.key === 'Escape'),
        takeUntilDestroyed(),
      )
      .subscribe(() => this._matDialogRef.close());
  }

  ngAfterViewInit(): void {
    if (this.data.isFocusEstimateOnMousePrimaryDevice) {
      this._el.nativeElement.querySelectorAll('input')?.[1]?.focus();
    }
  }

  submit(): void {
    // Tracking keeps adding to the store while the dialog is open, so only the
    // edited days are written over the task's current time spent.
    const editedDays = this._getEditedDays();
    const timeSpentOnDay: TimeSpentOnDayCopy = {
      ...(this._taskEntities()[this.task.id] ?? this.task).timeSpentOnDay,
    };
    editedDays.forEach((day) => {
      if (day in this.timeSpentOnDayCopy) {
        timeSpentOnDay[day] = this.timeSpentOnDayCopy[day];
      } else {
        delete timeSpentOnDay[day];
      }
    });
    this._taskService.update(this.taskCopy.id, {
      timeEstimate: this.taskCopy.timeEstimate,
      ...(editedDays.length > 0 && { timeSpentOnDay }),
    });
    this._matDialogRef.close({
      timeEstimate: this.taskCopy.timeEstimate,
      timeSpentOnDay,
    });
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
    // Replace the reference (rather than mutating in place) so the now-pure
    // `keys` pipe re-runs and the deleted row is removed from the view.
    const rest = { ...this.timeSpentOnDayCopy };
    delete rest[strDate];
    this.timeSpentOnDayCopy = rest;
    this.taskCopy.timeSpentOnDay = this.timeSpentOnDayCopy;
  }

  private _isChanged(): boolean {
    if ((this.taskCopy.timeEstimate || 0) !== (this.task.timeEstimate || 0)) {
      return true;
    }
    return this._getEditedDays().length > 0;
  }

  private _getEditedDays(): string[] {
    const before = this.task.timeSpentOnDay || {};
    const after = this.timeSpentOnDayCopy;
    const days = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...days].filter((day) => (before[day] || 0) !== (after[day] || 0));
  }

  trackByIndex(i: number, p: any): number {
    return i;
  }
}
