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
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { GlobalConfigService } from '../../features/config/global-config.service';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import {
  TaskReminderOption,
  TaskReminderOptionId,
} from '../../features/tasks/task.model';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- grandfathered layer-boundary debt
import { TASK_REMINDER_OPTIONS } from '../../features/planner/dialog-schedule-task/task-reminder-options.const';
import { TimeStepDirective } from '../time-step/time-step.directive';
import { expandFadeAnimation } from '../animations/expand.ani';
import { fadeAnimation } from '../animations/fade.ani';
import { getClockStringFromHours } from '../../util/get-clock-string-from-hours';
import { IS_ELECTRON_TOKEN } from '../../app.constants';
import { IS_ANDROID_WEB_VIEW_TOKEN } from '../../util/is-android-web-view';
import { getWeekNumber } from '../../util/get-week-number';
import { DEFAULT_FIRST_DAY_OF_WEEK } from '../../core/locale.constants';

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
  private readonly _isAndroidWebView = inject(IS_ANDROID_WEB_VIEW_TOKEN);

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

  // Week numbers should only be shown when explicitly enabled (iso/us)
  // null/undefined = "none (system default)" = hide week column entirely
  readonly showWeekNumbers = computed(() => {
    const localization = this._globalConfigService.localization();
    const weekNumberSystem = localization?.weekNumberSystem;
    return weekNumberSystem === 'iso' || weekNumberSystem === 'us';
  });

  // Week numbers are only meaningful beside the month grid. Year and
  // multi-year views use the same Material table classes for months/years.
  weekNumbers: number[] = [];
  weekNumbersWithNulls: (number | null)[] = [];
  calendarView: MatCalendarView = 'month';

  private _lastView: MatCalendarView | null = null;
  private _viewChangeEffect = effect((onCleanup) => {
    const cal = this.calendar();
    if (cal) {
      // Track localization to re-render when config changes
      this._globalConfigService.localization();

      this._lastView = cal.currentView;
      this.calendarView = cal.currentView;
      setTimeout(() => this._renderWeekNumbers(cal));

      const sub = cal.stateChanges.subscribe(() => {
        // Track localization to re-render when config changes
        this._globalConfigService.localization();

        const viewChanged = cal.currentView !== this._lastView;
        this._lastView = cal.currentView;
        this.calendarView = cal.currentView;
        if (viewChanged) {
          this.isInitialFocus = true;
        }

        // Material emits stateChanges before the new month rows have finished
        // rendering. Recompute on the next task rather than observing private
        // DOM mutations for the lifetime of the component.
        setTimeout(() => this._renderWeekNumbers(cal));
        this._cdr.markForCheck();
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
        // mark as synced so the defaulted date doesn't pull the calendar back
        // from the month the user is browsing (#10528)
        this._lastSyncedDate = targetDate.getTime();
        this.dateSelected.emit(targetDate);
      }
      this.timeChanged.emit(targetTime);
    }
  }

  onTimeChange(newTime: string | null): void {
    this.timeChanged.emit(newTime);
  }

  onTimeInputClick(ev: PointerEvent): void {
    // Electron touch (#8986) and the Android WebView (#9956) both focus the
    // native time input without ever opening a picker or raising the IME, so
    // the value is unreachable until we ask for the picker ourselves. Measured
    // on Android 16 / WebView 149: a tap on <input type="time"> leaves
    // mInputShown=false while a text input right next to it raises the
    // keyboard, and showPicker() opens the native clock dialog. Mobile
    // browsers open their own picker on tap, so they keep the default.
    if ((!this._isElectron && !this._isAndroidWebView) || ev.pointerType !== 'touch') {
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

  // Calculate week numbers from MatCalendar's actual month state. Do not parse
  // aria-label text: those labels are localized and are an accessibility API,
  // not a stable machine-readable date format.
  private _renderWeekNumbers(cal: MatCalendar<Date>): void {
    if (cal.currentView !== 'month') {
      this.weekNumbers = [];
      this._cdr.markForCheck();
      return;
    }

    const localization = this._globalConfigService.localization();
    const weekNumberSystem = localization?.weekNumberSystem;

    // Check if week numbers should be shown
    // null / undefined = "none (system default)" = hide week column entirely
    // 'iso' or 'us' = show week numbers with the specified system
    const shouldShowWeekNumbers = weekNumberSystem === 'iso' || weekNumberSystem === 'us';

    if (!shouldShowWeekNumbers) {
      this.weekNumbers = [];
      this._cdr.markForCheck();
      return;
    }

    const calendarEl = this._el.nativeElement.querySelector(
      '.mat-calendar',
    ) as HTMLElement | null;
    const rowCount = calendarEl?.querySelectorAll('.mat-calendar-body tr').length ?? 0;
    if (rowCount === 0) {
      this.weekNumbers = [];
      this.weekNumbersWithNulls = [];
      return;
    }

    // Always use 6 rows for the week number column to ensure consistent padding
    // regardless of how many rows the calendar actually renders
    const targetRowCount = 6;

    const firstDayOfWeek = this.getFirstDayOfWeek();
    const monthStart = new Date(
      cal.activeDate.getFullYear(),
      cal.activeDate.getMonth(),
      1,
    );
    const leadingDays = (monthStart.getDay() - firstDayOfWeek + 7) % 7;
    const firstVisibleDate = new Date(monthStart);
    firstVisibleDate.setDate(monthStart.getDate() - leadingDays);

    // Calculate week numbers for all rows in the calendar (up to rowCount)
    // weeks outside the current month will be null (empty cells)
    const weekNumbersWithNulls = Array.from({ length: targetRowCount }, (_, index) => {
      const weekStart = new Date(firstVisibleDate);
      const dayOffset = index * 7;
      weekStart.setDate(firstVisibleDate.getDate() + dayOffset);

      // A week should show if it contains any dates from the current month
      // Week ends on: weekStart + 6 days
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);

      // Last day of the current month
      const lastDayOfMonth = new Date(
        monthStart.getFullYear(),
        monthStart.getMonth() + 1,
        0,
      );

      // Week contains current month if weekStart <= lastDayOfMonth AND weekEnd >= firstDayOfMonth
      const weekContainsCurrentMonth =
        weekStart <= lastDayOfMonth && weekEnd >= monthStart;

      if (!weekContainsCurrentMonth) {
        return null;
      }

      return getWeekNumber(weekStart, firstDayOfWeek, weekNumberSystem as 'iso' | 'us');
    });

    // Store all week numbers (including nulls for empty cells)
    // Filter only the week numbers for display (nulls will be shown as empty cells)
    this.weekNumbers = weekNumbersWithNulls.filter((wn): wn is number => wn !== null);

    // Also store all week numbers with nulls for alignment
    this.weekNumbersWithNulls = weekNumbersWithNulls;

    this._cdr.markForCheck();
  }

  // Get the first day of week from config or default
  private getFirstDayOfWeek(): number {
    const cfg = this._globalConfigService.localization()?.firstDayOfWeek;
    return cfg !== null && cfg !== undefined ? cfg : DEFAULT_FIRST_DAY_OF_WEEK;
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
