import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
} from '@angular/material/dialog';
import { Task, TaskReminderOption, TaskReminderOptionId } from '../task.model';
import { T } from 'src/app/t.const';
import { MatCalendar } from '@angular/material/datepicker';
import { Store } from '@ngrx/store';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { DEADLINE_REMINDER_OPTIONS } from './deadline-reminder-options.const';
import { FormsModule } from '@angular/forms';
import { millisecondsDiffToRemindOption } from '../util/remind-option-to-milliseconds';
import { remindOptionToMilliseconds } from '../util/remind-option-to-milliseconds';
import { expandFadeAnimation } from '../../../ui/animations/expand.ani';
import { fadeAnimation } from '../../../ui/animations/fade.ani';
import { getClockStringFromHours } from '../../../util/get-clock-string-from-hours';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { DateService } from '../../../core/date/date.service';
import { DateAdapter, MatOption } from '@angular/material/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import {
  MatFormField,
  MatLabel,
  MatPrefix,
  MatSuffix,
} from '@angular/material/form-field';
import { MatSelect } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';
import { MatInput } from '@angular/material/input';
import { GlobalConfigService } from '../../config/global-config.service';

const DEFAULT_TIME = '09:00';

@Component({
  selector: 'dialog-deadline',
  imports: [
    FormsModule,
    MatTooltip,
    MatIconButton,
    MatIcon,
    MatFormField,
    MatSelect,
    MatOption,
    TranslatePipe,
    MatButton,
    MatDialogActions,
    MatDialogContent,
    MatCalendar,
    MatInput,
    MatLabel,
    MatSuffix,
    MatPrefix,
  ],
  templateUrl: './dialog-deadline.component.html',
  styleUrl: './dialog-deadline.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandFadeAnimation, fadeAnimation],
})
export class DialogDeadlineComponent implements AfterViewInit {
  data = inject<{ task: Task }>(MAT_DIALOG_DATA);
  private _matDialogRef = inject<MatDialogRef<DialogDeadlineComponent>>(MatDialogRef);
  private _cd = inject(ChangeDetectorRef);
  private _store = inject(Store);
  private _dateService = inject(DateService);
  private readonly _dateAdapter = inject(DateAdapter);
  private readonly _globalConfigService = inject(GlobalConfigService);

  readonly isConfigReady = computed(
    () => this._globalConfigService.localization() !== undefined,
  );

  T: typeof T = T;
  readonly calendar = viewChild.required(MatCalendar);

  reminderOptions: TaskReminderOption[] = DEADLINE_REMINDER_OPTIONS;
  task: Task = this.data.task;

  selectedDate: Date | string | null = null;
  selectedTime: string | null = null;
  selectedReminderCfgId: TaskReminderOptionId = TaskReminderOptionId.DoNotRemind;

  hasExistingDeadline = false;
  isInitValOnTimeFocus = true;
  isShowEnterMsg = false;
  private _timeCheckVal: string | null = null;

  ngAfterViewInit(): void {
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
      }
    } else if (this.task.deadlineDay) {
      this.hasExistingDeadline = true;
      this.selectedDate = dateStrToUtcDate(this.task.deadlineDay);
    }

    this.calendar().activeDate = new Date(this.selectedDate || new Date());
    this._cd.detectChanges();

    setTimeout(() => this._focusInitially());
    setTimeout(() => this._focusInitially(), 300);
  }

  private _focusInitially(): void {
    if (this.selectedDate) {
      (
        document.querySelector('.mat-calendar-body-selected') as HTMLElement
      )?.parentElement?.focus();
    } else {
      (
        document.querySelector('.mat-calendar-body-today') as HTMLElement
      )?.parentElement?.focus();
    }
  }

  onKeyDownOnCalendar(ev: KeyboardEvent): void {
    this._timeCheckVal = null;
    if (ev.code === 'Enter' || ev.code === 'Space') {
      this.isShowEnterMsg = true;
      if (
        this.selectedDate &&
        new Date(this.selectedDate).getTime() ===
          new Date(this.calendar().activeDate).getTime()
      ) {
        this.submit();
      }
    } else {
      this.isShowEnterMsg = false;
    }
  }

  onTimeKeyDown(ev: KeyboardEvent): void {
    if (ev.key === 'Enter') {
      this.isShowEnterMsg = true;
      if (this._timeCheckVal === this.selectedTime) {
        this.submit();
      }
      this._timeCheckVal = this.selectedTime;
    } else {
      this.isShowEnterMsg = false;
    }
  }

  close(): void {
    this._matDialogRef.close();
  }

  dateSelected(newDate: Date): void {
    setTimeout(() => {
      this.selectedDate = new Date(newDate);
      this.calendar().activeDate = this.selectedDate;
    });
  }

  onTimeClear(ev: MouseEvent): void {
    ev.stopPropagation();
    this.selectedTime = null;
    this.selectedReminderCfgId = TaskReminderOptionId.DoNotRemind;
    this.isInitValOnTimeFocus = true;
  }

  onTimeFocus(): void {
    if (!this.selectedTime && this.isInitValOnTimeFocus) {
      this.isInitValOnTimeFocus = false;
      if (this.selectedDate) {
        if (this._dateService.isToday(this.selectedDate as Date)) {
          this.selectedTime = getClockStringFromHours(new Date().getHours() + 1);
        } else {
          this.selectedTime = DEFAULT_TIME;
        }
      } else {
        this.selectedTime = getClockStringFromHours(new Date().getHours() + 1);
        this.selectedDate = new Date();
      }
    }
  }

  remove(): void {
    this._store.dispatch(TaskSharedActions.removeDeadline({ taskId: this.task.id }));
    this._matDialogRef.close();
  }

  submit(): void {
    if (!this.selectedDate) {
      return;
    }

    if (this.selectedTime) {
      const deadlineTimestamp = getDateTimeFromClockString(
        this.selectedTime,
        this.selectedDate as Date,
      );
      const deadlineRemindAt =
        this.selectedReminderCfgId !== TaskReminderOptionId.DoNotRemind
          ? remindOptionToMilliseconds(deadlineTimestamp, this.selectedReminderCfgId)
          : undefined;

      this._store.dispatch(
        TaskSharedActions.setDeadline({
          taskId: this.task.id,
          deadlineWithTime: deadlineTimestamp,
          deadlineRemindAt,
        }),
      );
    } else {
      const newDay = getDbDateStr(new Date(this.selectedDate));
      this._store.dispatch(
        TaskSharedActions.setDeadline({
          taskId: this.task.id,
          deadlineDay: newDay,
        }),
      );
    }

    this._matDialogRef.close();
  }

  quickAccessBtnClick(eventOrItem: MouseEvent | number, maybeItem?: number): void {
    if (eventOrItem instanceof MouseEvent) {
      eventOrItem.stopPropagation();
    }

    const item = typeof eventOrItem === 'number' ? eventOrItem : maybeItem;
    if (!item) {
      return;
    }

    const tDate = new Date();
    tDate.setMinutes(0, 0, 0);

    switch (item) {
      case 1:
        this.selectedDate = tDate;
        break;
      case 2:
        tDate.setDate(tDate.getDate() + 1);
        this.selectedDate = tDate;
        break;
      case 3: {
        const dayOffset =
          (this._dateAdapter.getFirstDayOfWeek() -
            this._dateAdapter.getDayOfWeek(tDate) +
            7) %
            7 || 7;
        tDate.setDate(tDate.getDate() + dayOffset);
        this.selectedDate = tDate;
        break;
      }
      case 4:
        tDate.setDate(1);
        tDate.setMonth(tDate.getMonth() + 1);
        this.selectedDate = tDate;
        break;
    }

    this.submit();
  }
}
