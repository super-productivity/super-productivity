import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  ElementRef,
  inject,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
} from '@angular/material/dialog';
import { Task, TaskReminderOption, TaskReminderOptionId } from '../task.model';
import { T } from 'src/app/t.const';
import { Store } from '@ngrx/store';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { DEADLINE_REMINDER_OPTIONS } from './deadline-reminder-options.const';
import { FormsModule } from '@angular/forms';
import { millisecondsDiffToRemindOption } from '../util/remind-option-to-milliseconds';
import { remindOptionToMilliseconds } from '../util/remind-option-to-milliseconds';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { isValidSplitTime } from '../../../util/is-valid-split-time';
import { normalizeClockStr } from '../../../util/normalize-clock-str';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getNextWeekDayOffset } from '../../../util/get-next-week-day-offset';
import { DateService } from '../../../core/date/date.service';
import { DateAdapter } from '@angular/material/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { GlobalConfigService } from '../../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../config/default-global-config.const';
import { getDeadlineAutoPlanFields } from '../util/get-deadline-auto-plan-fields';
import { DateTimePickerComponent } from '../../../ui/datetime-picker/datetime-picker.component';

type QuickDeadline = 'today' | 'tomorrow' | 'nextWeek' | 'nextMonth';

@Component({
  selector: 'dialog-deadline',
  imports: [
    FormsModule,
    MatIcon,
    TranslatePipe,
    MatButton,
    MatDialogActions,
    MatDialogContent,
    DateTimePickerComponent,
  ],
  templateUrl: './dialog-deadline.component.html',
  styleUrl: './dialog-deadline.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogDeadlineComponent implements AfterViewInit {
  data = inject<{
    task?: Task;
    targetDeadlineDay?: string;
    targetDeadlineTime?: string;
    targetDeadlineRemindOption?: TaskReminderOptionId;
    isSelectDeadlineOnly?: boolean;
  }>(MAT_DIALOG_DATA);
  private _matDialogRef = inject<MatDialogRef<DialogDeadlineComponent>>(MatDialogRef);
  private _cd = inject(ChangeDetectorRef);
  private _store = inject(Store);
  private _dateService = inject(DateService);
  private readonly _dateAdapter = inject(DateAdapter);
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _elRef = inject(ElementRef);

  readonly isConfigReady = computed(
    () => this._globalConfigService.localization() !== undefined,
  );
  private _defaultTaskRemindCfgId = computed(
    () =>
      (this._globalConfigService.cfg()?.reminder
        ?.defaultTaskRemindOption as TaskReminderOptionId) ??
      DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!,
  );

  T: typeof T = T;
  reminderOptions: TaskReminderOption[] = DEADLINE_REMINDER_OPTIONS;
  task: Task | undefined = this.data.task;

  selectedDate: Date | null = null;
  selectedTime: string | null = null;
  selectedReminderCfgId: TaskReminderOptionId = TaskReminderOptionId.DoNotRemind;
  minDate = new Date();

  hasExistingDeadline = false;

  ngAfterViewInit(): void {
    if (this.task) {
      if (this.task.deadlineWithTime) {
        this.hasExistingDeadline = true;
        this.selectedDate = new Date(this.task.deadlineWithTime);
        this.selectedTime = new Date(this.task.deadlineWithTime).toLocaleTimeString(
          'en-GB',
          {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        );
        if (this.task.deadlineRemindAt) {
          this.selectedReminderCfgId = millisecondsDiffToRemindOption(
            this.task.deadlineWithTime,
            this.task.deadlineRemindAt,
          );
        } else {
          this.selectedReminderCfgId = this._defaultTaskRemindCfgId();
        }
      } else if (this.task.deadlineDay) {
        this.hasExistingDeadline = true;
        this.selectedDate = dateStrToUtcDate(this.task.deadlineDay);
      } else {
        this.selectedReminderCfgId = this._defaultTaskRemindCfgId();
      }
    } else {
      this.selectedReminderCfgId = this._defaultTaskRemindCfgId();
      if (
        this.data.targetDeadlineDay ||
        this.data.targetDeadlineTime ||
        this.data.targetDeadlineRemindOption
      ) {
        this.hasExistingDeadline = true;
      }
    }

    if (this.data.targetDeadlineDay) {
      this.selectedDate = dateStrToUtcDate(this.data.targetDeadlineDay);
    }
    if (this.data.targetDeadlineTime) {
      this.selectedTime = this.data.targetDeadlineTime;
    }
    if (
      this.data.isSelectDeadlineOnly &&
      this.data.targetDeadlineRemindOption !== undefined
    ) {
      this.selectedReminderCfgId = this.data.targetDeadlineRemindOption;
    }

    this._cd.detectChanges();
  }

  close(): void {
    this._matDialogRef.close();
  }

  dateSelected(newDate: Date): void {
    this.selectedDate = new Date(newDate);
  }

  remove(): void {
    if (this.data.isSelectDeadlineOnly) {
      this._matDialogRef.close({
        date: null,
        time: null,
        remindOption: null,
      });
      return;
    }
    if (this.task) {
      this._store.dispatch(TaskSharedActions.removeDeadline({ taskId: this.task.id }));
    }
    this._matDialogRef.close();
  }

  submit(): void {
    if (!this.selectedDate) {
      return;
    }

    // Recover a stray seconds component (e.g. a pasted `13:30:00`) so the time
    // the user set actually persists instead of silently dropping to a
    // date-only deadline (#7802). Genuine garbage still fails the guard below.
    const time = this.selectedTime ? normalizeClockStr(this.selectedTime) : null;

    if (this.data.isSelectDeadlineOnly) {
      const validTime = time && isValidSplitTime(time) ? time : null;
      this._matDialogRef.close({
        date: this.selectedDate,
        time: validTime,
        remindOption: this.selectedReminderCfgId,
      });
      return;
    }

    if (this.task) {
      if (time && isValidSplitTime(time)) {
        const deadlineTimestamp = getDateTimeFromClockString(time, this.selectedDate!);
        const deadlineRemindAt =
          this.selectedReminderCfgId !== TaskReminderOptionId.DoNotRemind
            ? remindOptionToMilliseconds(deadlineTimestamp, this.selectedReminderCfgId)
            : undefined;

        this._store.dispatch(
          TaskSharedActions.setDeadline({
            taskId: this.task.id,
            deadlineWithTime: deadlineTimestamp,
            deadlineRemindAt,
            ...getDeadlineAutoPlanFields(this._dateService, undefined, deadlineTimestamp),
          }),
        );
      } else {
        // Falls through for both "no time entered" and "malformed time" — the
        // latter would otherwise crash getDateTimeFromClockString (issue #7490).
        const newDay = getDbDateStr(this.selectedDate!);
        this._store.dispatch(
          TaskSharedActions.setDeadline({
            taskId: this.task.id,
            deadlineDay: newDay,
            ...getDeadlineAutoPlanFields(this._dateService, newDay),
          }),
        );
      }
    }

    this._matDialogRef.close();
  }

  onQuickAccessClick(option: QuickDeadline): void {
    this.selectedDate = this._getQuickDate(option);
    this.submit();
  }

  private _getQuickDate(option: QuickDeadline): Date {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    switch (option) {
      case 'today':
        return d;
      case 'tomorrow':
        d.setDate(d.getDate() + 1);
        return d;
      case 'nextWeek': {
        const dayOffset = getNextWeekDayOffset(this._dateAdapter, d);
        d.setDate(d.getDate() + dayOffset);
        return d;
      }
      case 'nextMonth':
        d.setDate(1);
        d.setMonth(d.getMonth() + 1);
        return d;
    }
  }
}
