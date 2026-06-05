import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  effect,
  EventEmitter,
  inject,
  input,
  Output,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCalendar, MatDatepickerModule } from '@angular/material/datepicker';
import { MatButtonModule, MatIconButton } from '@angular/material/button';
import { MatIconModule, MatIcon } from '@angular/material/icon';
import {
  MatFormFieldModule,
  MatFormField,
  MatLabel,
  MatPrefix,
  MatSuffix,
} from '@angular/material/form-field';
import { MatInputModule, MatInput } from '@angular/material/input';
import { MatSelectModule, MatSelect } from '@angular/material/select';
import { DateAdapter, MatOptionModule, MatOption } from '@angular/material/core';
import { MatTooltipModule, MatTooltip } from '@angular/material/tooltip';
import { TranslateModule, TranslatePipe } from '@ngx-translate/core';
import { T } from '../../t.const';
import { DateService } from '../../core/date/date.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import {
  TaskReminderOption,
  TaskReminderOptionId,
} from '../../features/tasks/task.model';
import { TASK_REMINDER_OPTIONS } from '../../features/planner/dialog-schedule-task/task-reminder-options.const';
import { TimeStepDirective } from '../time-step/time-step.directive';
import { expandFadeAnimation } from '../animations/expand.ani';
import { fadeAnimation } from '../animations/fade.ani';
import { getClockStringFromHours } from '../../util/get-clock-string-from-hours';
import { Log } from '../../core/log';
import { DateTimePickerHeaderComponent } from './datetime-picker-header.component';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';

const DEFAULT_TIME = '09:00';

@Component({
  selector: 'datetime-picker',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDatepickerModule,
    MatCalendar,
    MatButtonModule,
    MatIconButton,
    MatIconModule,
    MatIcon,
    MatFormFieldModule,
    MatFormField,
    MatLabel,
    MatPrefix,
    MatSuffix,
    MatInputModule,
    MatInput,
    MatSelectModule,
    MatSelect,
    MatOptionModule,
    MatOption,
    MatTooltipModule,
    MatTooltip,
    TranslateModule,
    TranslatePipe,
    TimeStepDirective,
    DateTimePickerHeaderComponent,
  ],
  templateUrl: './datetime-picker.component.html',
  styleUrl: './datetime-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandFadeAnimation, fadeAnimation],
})
export class DateTimePickerComponent {
  private _dateService = inject(DateService);
  private _globalConfigService = inject(GlobalConfigService);
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _dateAdapter = inject(DateAdapter);
  private readonly _cdr = inject(ChangeDetectorRef);

  pickerSelectedDate: Date | null = null;
  private _lastView: 'month' | 'year' | 'multi-year' | null = null;

  constructor() {
    effect(() => {
      const locale = this._dateTimeFormatService.currentLocale();
      this._dateAdapter.setLocale(locale);
    });

    effect((onCleanup) => {
      const cal = this.calendar();
      if (cal) {
        // Set initial view and date
        this._lastView = cal.currentView;
        if (cal.currentView !== 'month') {
          this.pickerSelectedDate = cal.activeDate;
        }

        const sub = cal.stateChanges.subscribe(() => {
          if (cal.currentView !== this._lastView) {
            this._lastView = cal.currentView;
            if (cal.currentView !== 'month') {
              this.pickerSelectedDate = cal.activeDate;
            }
          }
          this._cdr.markForCheck();
        });
        onCleanup(() => sub.unsubscribe());
      }
    });
  }

  customHeader = DateTimePickerHeaderComponent;

  // Inputs
  selectedDate = input<Date | null>(null);
  selectedTime = input<string | null>(null);
  selectedReminderCfgId = input<TaskReminderOptionId>(TaskReminderOptionId.DoNotRemind);
  reminderOptions = input<TaskReminderOption[]>(TASK_REMINDER_OPTIONS);
  minDate = input<Date | null>(null);
  showQuickAccess = input<boolean>(true);
  showTime = input<boolean>(true);
  timeLabel = input<string>('Time');
  quickAccessTranslationPrefix = input<string>('F.TASK.D_SCHEDULE_TASK');

  // Outputs
  @Output() dateSelected = new EventEmitter<Date>();
  @Output() timeChanged = new EventEmitter<string | null>();
  @Output() reminderChanged = new EventEmitter<TaskReminderOptionId>();
  @Output() quickAccessClick = new EventEmitter<
    'today' | 'tomorrow' | 'nextWeek' | 'nextMonth'
  >();
  @Output() enterSubmit = new EventEmitter<void>();

  // Template variables
  T: typeof T = T;
  isInitValOnTimeFocus = true;
  isShowEnterMsg = false;

  readonly calendar = viewChild(MatCalendar);

  readonly isConfigReady = computed(
    () => this._globalConfigService.localization() !== undefined,
  );

  get calendarSelectedDate(): Date | null {
    const cal = this.calendar();
    if (!cal) {
      return this.selectedDate();
    }
    if (cal.currentView === 'month') {
      return this.selectedDate();
    }
    return this.pickerSelectedDate || cal.activeDate;
  }

  private _syncActiveDateEffect = effect(() => {
    const date = this.selectedDate();
    const cal = this.calendar();
    if (cal) {
      cal.activeDate = new Date(date || new Date());
    }
  });

  private _timeCheckVal: string | null = null;

  onKeyDownOnCalendar(ev: KeyboardEvent): void {
    this._timeCheckVal = null;
    if (ev.code === 'Enter' || ev.code === 'Space') {
      this.isShowEnterMsg = true;
      const cal = this.calendar();
      const selDate = this.selectedDate();
      if (
        cal &&
        selDate &&
        new Date(selDate).getTime() === new Date(cal.activeDate).getTime()
      ) {
        this.enterSubmit.emit();
      }
    } else {
      this.isShowEnterMsg = false;
    }
  }

  onTimeFocus(): void {
    Log.log('onTimeFocus');
    if (!this.selectedTime() && this.isInitValOnTimeFocus) {
      this.isInitValOnTimeFocus = false;

      let targetTime: string;
      let targetDate: Date | null = null;

      const selDate = this.selectedDate();
      if (selDate) {
        if (this._dateService.isToday(selDate)) {
          targetTime = getClockStringFromHours(new Date().getHours() + 1);
        } else {
          targetTime = DEFAULT_TIME;
        }
      } else {
        // get current time +1h
        targetTime = getClockStringFromHours(new Date().getHours() + 1);
        targetDate = new Date();
      }

      if (targetDate) {
        this.dateSelected.emit(targetDate);
      }
      this.timeChanged.emit(targetTime);
    }
  }

  onTimeChange(newTime: string | null): void {
    this.timeChanged.emit(newTime);
  }

  onReminderChange(newReminder: TaskReminderOptionId): void {
    this.reminderChanged.emit(newReminder);
  }

  onTimeKeyDown(ev: KeyboardEvent): void {
    if (ev.key === 'Enter') {
      this.isShowEnterMsg = true;
      if (this._timeCheckVal === this.selectedTime()) {
        this.enterSubmit.emit();
      }
      this._timeCheckVal = this.selectedTime();
    } else {
      this.isShowEnterMsg = false;
    }
  }

  onTimeClear(ev: MouseEvent): void {
    ev.stopPropagation();
    this.timeChanged.emit(null);
    this.reminderChanged.emit(TaskReminderOptionId.DoNotRemind);
    this.isInitValOnTimeFocus = true;
    this._timeCheckVal = null;
  }

  quickAccessBtnClick(
    ev: MouseEvent,
    val: 'today' | 'tomorrow' | 'nextWeek' | 'nextMonth',
  ): void {
    ev.preventDefault();
    this.quickAccessClick.emit(val);
  }

  onYearSelected(date: unknown): void {
    const cal = this.calendar();
    if (cal) {
      setTimeout(() => {
        cal.currentView = 'month';
      });
    }
  }
}
