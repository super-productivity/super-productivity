import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  effect,
  ElementRef,
  HostBinding,
  HostListener,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCalendar, MatCalendarView } from '@angular/material/datepicker';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import {
  MatFormField,
  MatLabel,
  MatPrefix,
  MatSuffix,
} from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import {
  MatTimepicker,
  MatTimepickerInput,
  MatTimepickerToggle,
} from '@angular/material/timepicker';
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
import { MatTooltip } from '@angular/material/tooltip';
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
import { IS_TOUCH_ONLY } from '../../util/is-touch-only';
import { clockStrToDate, dateToClockStr } from '../../util/clock-str-and-date';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';

const DEFAULT_TIME = '09:00';

@Component({
  selector: 'datetime-picker',
  standalone: true,
  imports: [
    FormsModule,
    MatCalendar,
    MatButtonModule,
    MatIcon,
    MatFormField,
    MatLabel,
    MatPrefix,
    MatSuffix,
    MatInput,
    MatTimepicker,
    MatTimepickerInput,
    MatTimepickerToggle,
    MatSelect,
    MatOption,
    MatTooltip,
    TranslateModule,
    TranslatePipe,
    TimeStepDirective,
  ],
  templateUrl: './datetime-picker.component.html',
  styleUrl: './datetime-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandFadeAnimation, fadeAnimation],
})
export class DateTimePickerComponent implements AfterViewInit {
  private _dateService = inject(DateService);
  private _dateTimeFormat = inject(DateTimeFormatService);
  private _globalConfigService = inject(GlobalConfigService);
  private readonly _cdr = inject(ChangeDetectorRef);
  private _el = inject(ElementRef);

  // Inputs
  selectedDate = input<Date | null>(null);
  selectedTime = input<string | null>(null);
  selectedReminderCfgId = input<TaskReminderOptionId>(TaskReminderOptionId.DoNotRemind);
  reminderOptions = input<TaskReminderOption[]>(TASK_REMINDER_OPTIONS);
  minDate = input<Date | null>(null);
  timeLabel = input<string>('Time');
  reminderLabel = input<string>(T.F.TASK.D_SCHEDULE_TASK.REMIND_AT);
  showQuickAccess = input<boolean>(true);
  quickAccessTranslationPrefix = input<string>('F.TASK.D_SCHEDULE_TASK');

  // Outputs
  dateSelected = output<Date>();
  timeChanged = output<string | null>();
  reminderChanged = output<TaskReminderOptionId>();
  quickAccessClick = output<'today' | 'tomorrow' | 'nextWeek' | 'nextMonth'>();
  enterSubmit = output<void>();

  // Template variables
  T: typeof T = T;
  // On touch-only devices the OS-native time wheel (`<input type="time">`) is
  // the better experience and already follows the device locale. On desktop the
  // native control ignores the in-app `dateTimeLocale` (its 12h/24h is fixed by
  // the browser/OS locale — see #8565), so use `<mat-timepicker>`, which formats
  // via the Material DateAdapter that DateTimeFormatService drives from the
  // user's setting.
  readonly useMatTimepicker = !IS_TOUCH_ONLY;
  isInitValOnTimeFocus = true;
  isShowEnterMsg = false;
  @HostBinding('class.sp-hide-cursor') isKeyboardNavigating = false;
  @HostBinding('class.sp-initial-focus') isInitialFocus = true;

  readonly calendar = viewChild(MatCalendar);
  // Only present on the desktop (mat-timepicker) path; used to flush its
  // blur-committed value before an Enter submit.
  readonly timeInputEl = viewChild<ElementRef<HTMLInputElement>>('timeInputEl');

  readonly isConfigReady = computed(
    () => this._globalConfigService.localization() !== undefined,
  );

  // `<mat-timepicker>` binds to a Date; bridge it to/from the canonical `HH:mm`
  // string contract so the component's inputs/outputs stay unchanged. The
  // timepicker only reads hours/minutes, so the date portion is irrelevant —
  // we intentionally do NOT depend on selectedDate() to avoid recomputing (and
  // re-writing the bound Date) on every calendar-day click.
  readonly timeAsDate = computed(() => clockStrToDate(this.selectedTime()));

  private _lastView: MatCalendarView | null = null;
  private _viewChangeEffect = effect((onCleanup) => {
    const cal = this.calendar();
    if (cal) {
      this._lastView = cal.currentView;
      const sub = cal.stateChanges.subscribe(() => {
        if (cal.currentView !== this._lastView) {
          this._lastView = cal.currentView;
          this.isInitialFocus = true;
          this._cdr.markForCheck();
        }
      });
      onCleanup(() => sub.unsubscribe());
    }
  });

  private _lastSyncedDate: number | null = null;
  private _syncActiveDateEffect = effect(() => {
    const date = this.selectedDate();
    const dateMs = date ? new Date(date).getTime() : null;

    const cal = this.calendar();
    if (cal) {
      const activeEl = document.activeElement;
      const isCalendarFocused =
        activeEl &&
        this._el.nativeElement.querySelector('mat-calendar')?.contains(activeEl);

      if (!isCalendarFocused) {
        if (dateMs === this._lastSyncedDate) {
          return;
        }
        this._lastSyncedDate = dateMs;

        const newActiveDate = new Date(date || new Date());
        if (cal.activeDate.getTime() !== newActiveDate.getTime()) {
          cal.activeDate = newActiveDate;
        }
      }
    }
  });

  private _timeCheckVal: string | null = null;

  onKeyDownOnCalendar(ev: KeyboardEvent): void {
    this._timeCheckVal = null;
    this.isInitialFocus = false;
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

    if (
      [
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
        'PageUp',
        'PageDown',
      ].includes(ev.key)
    ) {
      this.isKeyboardNavigating = true;
      this._cdr.markForCheck();
    }
  }

  onTimeFocus(): void {
    if (!this.selectedTime() && this.isInitValOnTimeFocus) {
      this.isInitValOnTimeFocus = false;

      let targetTime: string;
      let targetDate: Date | null = null;

      const selDate = this.selectedDate();
      if (selDate) {
        if (this._dateService.isToday(selDate)) {
          targetTime = getClockStringFromHours((new Date().getHours() + 1) % 24);
        } else {
          targetTime = DEFAULT_TIME;
        }
      } else {
        // get current time +1h
        targetTime = getClockStringFromHours((new Date().getHours() + 1) % 24);
        targetDate = new Date();
      }

      if (targetDate) {
        this.dateSelected.emit(targetDate);
      }
      this.timeChanged.emit(targetTime);

      // mat-timepicker only writes its formatted value to the input when the
      // input is NOT focused, so an autofill-on-focus would leave the field
      // looking empty. Paint the value ourselves (same locale format the
      // adapter uses) so the focused field shows the autofilled time.
      if (this.useMatTimepicker) {
        const el = this.timeInputEl()?.nativeElement;
        const date = clockStrToDate(targetTime);
        if (el && date) {
          el.value = this._dateTimeFormat.formatTime(date.getTime());
        }
      }
    }
  }

  onTimeChange(newTime: string | null): void {
    this.timeChanged.emit(newTime);
  }

  onTimeDateChange(date: Date | null): void {
    this.timeChanged.emit(dateToClockStr(date));
  }

  onReminderChange(newReminder: TaskReminderOptionId): void {
    this.reminderChanged.emit(newReminder);
  }

  onTimeKeyDown(ev: KeyboardEvent): void {
    if (ev.key !== 'Enter') {
      this.isShowEnterMsg = false;
      return;
    }

    if (this.useMatTimepicker) {
      // mat-timepicker commits its value on blur (updateOn: 'blur'). Flush the
      // typed value first — blur() propagates it synchronously to the parent via
      // timeChanged — so the submit acts on what the user just typed, not the
      // stale previous value. A single Enter commits and submits.
      this.timeInputEl()?.nativeElement.blur();
      this.enterSubmit.emit();
      return;
    }

    // Native path: confirm-on-double-Enter (value updates live as you type).
    this.isShowEnterMsg = true;
    if (this._timeCheckVal === this.selectedTime()) {
      this.enterSubmit.emit();
    }
    this._timeCheckVal = this.selectedTime();
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

  private _lastMouseCoords: { x: number; y: number } | null = null;

  ngAfterViewInit(): void {
    // Focus the active calendar cell when the picker opens
    setTimeout(() => {
      const activeCell = this._el.nativeElement.querySelector(
        '.mat-calendar-body-active',
      ) as HTMLElement;
      if (activeCell) {
        activeCell.focus();
      }
    }, 50);
  }

  @HostListener('mousemove', ['$event'])
  onHostMouseMove(ev: MouseEvent): void {
    this.isInitialFocus = false;
    this._resetKeyboardNav(ev);
  }

  @HostListener('mouseleave', ['$event'])
  onHostMouseLeave(ev: MouseEvent): void {
    this.isKeyboardNavigating = true;
    this._cdr.markForCheck();
  }

  private _resetKeyboardNav(ev: MouseEvent): boolean {
    const coords = { x: ev.clientX, y: ev.clientY };
    if (
      this._lastMouseCoords &&
      this._lastMouseCoords.x === coords.x &&
      this._lastMouseCoords.y === coords.y
    ) {
      return false;
    }
    this._lastMouseCoords = coords;

    if (this.isKeyboardNavigating) {
      this.isKeyboardNavigating = false;
      this._cdr.markForCheck();
    }
    return true;
  }
}
