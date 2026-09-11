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
import { MatIcon } from '@angular/material/icon';
import {
  MatFormField,
  MatLabel,
  MatPrefix,
  MatSuffix,
} from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
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
import { IS_ELECTRON_TOKEN } from '../../app.constants';

const DEFAULT_TIME = '09:00';

export type QuickAccessId = 'today' | 'tomorrow' | 'nextWeek' | 'nextMonth';

/**
 * Quick access shortcuts, rendered as icon + visible label. The label doubles as
 * the accessible name — an aria-label with richer wording ("Schedule next week")
 * would diverge from the visible text in every locale that translates one string
 * and falls back to English for the other, failing WCAG 2.5.3 (Label in Name).
 */
const QUICK_ACCESS_ITEMS = [
  { id: 'today', icon: 'wb_sunny', label: T.G.TODAY },
  { id: 'tomorrow', icon: 'wb_twilight', label: T.G.TOMORROW },
  { id: 'nextWeek', icon: 'next_week', label: T.G.NEXT_WEEK },
  { id: 'nextMonth', icon: 'bedtime', label: T.G.NEXT_MONTH },
] as const satisfies readonly { id: QuickAccessId; icon: string; label: string }[];

@Component({
  selector: 'datetime-picker',
  standalone: true,
  imports: [
    FormsModule,
    MatCalendar,
    MatIcon,
    MatFormField,
    MatLabel,
    MatPrefix,
    MatSuffix,
    MatInput,
    MatSelect,
    MatOption,
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
  private _globalConfigService = inject(GlobalConfigService);
  private readonly _cdr = inject(ChangeDetectorRef);
  private _el = inject(ElementRef);
  private readonly _isElectron = inject(IS_ELECTRON_TOKEN);

  // Inputs
  selectedDate = input<Date | null>(null);
  selectedTime = input<string | null>(null);
  selectedReminderCfgId = input<TaskReminderOptionId>(TaskReminderOptionId.DoNotRemind);
  reminderOptions = input<TaskReminderOption[]>(TASK_REMINDER_OPTIONS);
  minDate = input<Date | null>(null);
  timeLabel = input<string>('Time');
  reminderLabel = input<string>(T.F.TASK.D_SCHEDULE_TASK.REMIND_AT);
  showQuickAccess = input<boolean>(true);

  // Outputs
  dateSelected = output<Date>();
  timeChanged = output<string | null>();
  reminderChanged = output<TaskReminderOptionId>();
  quickAccessClick = output<QuickAccessId>();
  enterSubmit = output<void>();

  // Template variables
  T: typeof T = T;
  quickAccessItems = QUICK_ACCESS_ITEMS;
  isInitValOnTimeFocus = true;
  isShowEnterMsg = false;
  @HostBinding('class.sp-hide-cursor') isKeyboardNavigating = false;
  @HostBinding('class.sp-initial-focus') isInitialFocus = true;

  readonly calendar = viewChild(MatCalendar);

  readonly isConfigReady = computed(
    () => this._globalConfigService.localization() !== undefined,
  );

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
    }
  }

  onTimeChange(newTime: string | null): void {
    this.timeChanged.emit(newTime);
  }

  onTimeInputClick(ev: PointerEvent): void {
    if (!this._isElectron || ev.pointerType !== 'touch') {
      return;
    }

    const timeInput = ev.currentTarget;
    if (
      !(timeInput instanceof HTMLInputElement) ||
      typeof timeInput.showPicker !== 'function'
    ) {
      return;
    }

    try {
      timeInput.showPicker();
    } catch {
      // Keep the focused native input as the fallback when no picker is available.
    }
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

  quickAccessBtnClick(ev: MouseEvent, val: QuickAccessId): void {
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
