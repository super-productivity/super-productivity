/* eslint-disable */
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { fromEvent } from 'rxjs';
import { select, Store } from '@ngrx/store';
import { debounceTime, map, startWith } from 'rxjs/operators';
import { TaskService } from '../../tasks/task.service';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { MatDialog } from '@angular/material/dialog';
import { MatIconButton, MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { LS } from '../../../core/persistence/storage-keys.const';
import { DialogTimelineSetupComponent } from '../dialog-timeline-setup/dialog-timeline-setup.component';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { selectTimelineWorkStartEndHours } from '../../config/store/global-config.reducer';
import { FH } from '../schedule.const';
import { mapScheduleDaysToScheduleEvents } from '../map-schedule-data/map-schedule-days-to-schedule-events';
import { toSignal } from '@angular/core/rxjs-interop';
import { ScheduleWeekComponent } from '../schedule-week/schedule-week.component';
import { ScheduleMonthComponent } from '../schedule-month/schedule-month.component';
import { ScheduleService } from '../schedule.service';
import { DateAdapter } from '@angular/material/core';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';

@Component({
  selector: 'schedule',
  imports: [
    ScheduleWeekComponent,
    ScheduleMonthComponent,
    MatIconButton,
    MatButton,
    MatIcon,
    MatTooltip,
    TranslatePipe,
  ],
  templateUrl: './schedule.component.html',
  styleUrls: ['./schedule.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,

  host: {
    '[style.--nr-of-days]': 'daysToShow().length',
  },
})
export class ScheduleComponent {
  T = T;
  taskService = inject(TaskService);
  layoutService = inject(LayoutService);
  scheduleService = inject(ScheduleService);
  private _matDialog = inject(MatDialog);
  private _store = inject(Store);
  private _globalTrackingIntervalService = inject(GlobalTrackingIntervalService);
  private _dateAdapter = inject(DateAdapter);

  private _currentTimeViewMode = computed(() => this.layoutService.selectedTimeView());
  isMonthView = computed(() => this._currentTimeViewMode() === 'month');

  // Navigation state - null = viewing today, Date = viewing selected date
  private _selectedDate = signal<Date | null>(null);

  // Helper computed for UI - compares actual dates, not just null check
  isViewingToday = computed(() => {
    const selected = this._selectedDate();
    if (selected === null) return true;

    // Compare date strings to check if selected date IS today
    const selectedDateStr = this.scheduleService.getTodayStr(selected);
    const todayStr = this._todayDateStr();

    return selectedDateStr === todayStr;
  });

  protected _todayDateStr = toSignal(this._globalTrackingIntervalService.todayDateStr$);
  private _windowSize = toSignal(
    fromEvent(window, 'resize').pipe(
      startWith({ width: window.innerWidth, height: window.innerHeight }),
      debounceTime(50),
      map(() => ({ width: window.innerWidth, height: window.innerHeight })),
    ),
    { initialValue: { width: window.innerWidth, height: window.innerHeight } },
  );

  shouldEnableHorizontalScroll = computed(() => {
    // No longer needed - we adjust day count to fit viewport instead
    return false;
  });

  private _daysToShowCount = computed(() => {
    const size = this._windowSize();
    const selectedView = this._currentTimeViewMode();
    const width = size.width;
    const height = size.height;

    if (selectedView === 'month') {
      const availableHeight = height - 160;
      const minHeightPerWeek = width < 768 ? 60 : 100;
      const maxWeeks = Math.floor(availableHeight / minHeightPerWeek);

      if (maxWeeks < 3) {
        return 3;
      } else if (maxWeeks > 6) {
        return 6;
      } else {
        return maxWeeks;
      }
    }

    // Week view: responsive day count based on viewport width
    if (width >= 1200) {
      return 7; // Desktop: full week
    } else if (width >= 768) {
      return 5; // Tablet: 5 days
    } else if (width >= 480) {
      return 3; // Mobile: 3 days
    } else {
      return 2; // Small mobile: 2 days
    }
  });

  daysToShow = computed(() => {
    const count = this._daysToShowCount();
    const selectedView = this._currentTimeViewMode();
    const selectedDate = this._selectedDate();
    // Trigger re-computation when today changes
    this._todayDateStr();

    if (selectedView === 'month') {
      return this.scheduleService.getMonthDaysToShow(
        count,
        this.firstDayOfWeek,
        selectedDate,
      );
    }
    return this.scheduleService.getDaysToShow(count, selectedDate);
  });

  weeksToShow = computed(() => Math.ceil(this.daysToShow().length / 7));

  firstDayOfWeek = this._dateAdapter.getFirstDayOfWeek();

  // Calculate context-aware "now" based on selected date
  // When viewing a future week, use the start of that week as reference time
  private _contextNow = computed(() => {
    const selectedDate = this._selectedDate();
    if (selectedDate === null) {
      // Viewing today - use actual current time
      return Date.now();
    }

    // Viewing a different date - use that date's midnight as reference
    // This ensures display calculations (work hours, etc.) are correct for the viewed date
    const contextDate = new Date(selectedDate);
    contextDate.setHours(0, 0, 0, 0);
    return contextDate.getTime();
  });

  scheduleDays = computed(() => {
    return this.scheduleService.createScheduleDaysWithContext({
      daysToShow: this.daysToShow(),
      contextNow: this._contextNow(),
      realNow: Date.now(), // Always use actual current time for "current week" calculation
      currentTaskId: this.taskService.currentTaskId() ?? null,
    });
  });

  private _eventsAndBeyondBudget = computed(() => {
    const days = this.scheduleDays();
    return mapScheduleDaysToScheduleEvents(days, FH);
  });

  private _workStartEndHours = toSignal(
    this._store.pipe(select(selectTimelineWorkStartEndHours)),
  );

  workStartEnd = computed(() => {
    const v = this._workStartEndHours();
    return (
      v && {
        // NOTE: +1 because grids start at 1
        workStartRow: Math.round(FH * v.workStart) + 1,
        workEndRow: Math.round(FH * v.workEnd) + 1,
      }
    );
  });

  events = computed(() => this._eventsAndBeyondBudget().eventsFlat);
  beyondBudget = computed(() => this._eventsAndBeyondBudget().beyondBudgetDays);

  currentTimeRow = computed(() => {
    // Only show current time indicator when viewing today
    if (!this.isViewingToday()) {
      return null;
    }

    // Trigger re-computation every 2 minutes
    this.scheduleService.scheduleRefreshTick();
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();

    const hoursToday = hours + minutes / 60;
    return Math.round(hoursToday * FH);
  });

  goToPreviousPeriod(): void {
    const currentDate = this._selectedDate() || new Date();
    const selectedView = this._currentTimeViewMode();

    if (selectedView === 'month') {
      // Jump to first day of previous month
      const previousMonth = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() - 1,
        1,
      );
      this._selectedDate.set(previousMonth);
    } else {
      // Week view: move backward by the number of days currently shown
      // (automatically adapts to responsive day count: 2, 3, 5, or 7 days)
      const daysToSkip = this.daysToShow().length;
      const previousPeriod = new Date(currentDate);
      previousPeriod.setDate(currentDate.getDate() - daysToSkip);
      previousPeriod.setHours(0, 0, 0, 0);
      this._selectedDate.set(previousPeriod);
    }
  }

  goToNextPeriod(): void {
    const currentDate = this._selectedDate() || new Date();
    const selectedView = this._currentTimeViewMode();

    if (selectedView === 'month') {
      // Jump to first day of next month
      const nextMonth = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1,
        1,
      );
      this._selectedDate.set(nextMonth);
    } else {
      // Week view: move forward by the number of days currently shown
      // (automatically adapts to responsive day count: 2, 3, 5, or 7 days)
      const daysToSkip = this.daysToShow().length;
      const nextPeriod = new Date(currentDate);
      nextPeriod.setDate(currentDate.getDate() + daysToSkip);
      nextPeriod.setHours(0, 0, 0, 0);
      this._selectedDate.set(nextPeriod);
    }
  }

  goToToday(): void {
    this._selectedDate.set(null); // Resets to "today" mode
  }

  constructor() {
    this.layoutService.selectedTimeView.set('week');

    if (!localStorage.getItem(LS.WAS_SCHEDULE_INITIAL_DIALOG_SHOWN)) {
      this._matDialog.open(DialogTimelineSetupComponent, {
        data: { isInfoShownInitially: true },
      });
    }

    effect(() => {
      if (this.isMonthView() === false) {
        // scroll to work start whenever view is switched to work-week
        setTimeout(() => {
          const element = document.getElementById('work-start');
          if (element) {
            element.scrollIntoView({ behavior: 'instant', block: 'start' });
          }
        }); // Small delay to ensure DOM is fully rendered
      }
    });
  }
}
