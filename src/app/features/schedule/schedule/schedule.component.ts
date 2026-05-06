/* eslint-disable */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { fromEvent } from 'rxjs';
import { select, Store } from '@ngrx/store';
import { selectCalendarProviders } from '../../issue/store/issue-provider.selectors';
import { HiddenCalendarProvidersService } from '../../calendar-integration/hidden-calendar-providers.service';
import { getIssueProviderTooltip } from '../../issue/mapping-helper/get-issue-provider-tooltip';
import { IssueProvider } from '../../issue/issue.model';
import { MatChipListbox, MatChipOption } from '@angular/material/chips';
import { debounceTime, map, startWith, switchMap } from 'rxjs/operators';
import { safeFormatDate } from '../../../util/safe-format-date';
import { TaskService } from '../../tasks/task.service';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { LS } from 'src/app/core/persistence/storage-keys.const';
import { selectTimelineWorkStartEndHours } from '../../config/store/global-config.reducer';
import { FH } from '../schedule.const';
import { mapScheduleDaysToScheduleEvents } from '../map-schedule-data/map-schedule-days-to-schedule-events';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ScheduleWeekComponent } from '../schedule-week/schedule-week.component';
import { ScheduleMonthComponent } from '../schedule-month/schedule-month.component';
import { ScheduleService } from '../schedule.service';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { SCHEDULE_CONSTANTS } from '../schedule.constants';
import { GlobalConfigService } from '../../config/global-config.service';
import { DEFAULT_FIRST_DAY_OF_WEEK } from '../../../core/locale.constants';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { getWeekNumber } from '../../../util/get-week-number';
import { parseDbDateStr } from '../../../util/parse-db-date-str';
import { PastWorkScheduleEntriesService } from '../past-work-schedule-entries.service';
import { ScheduleCalendarMapEntry } from '../schedule.model';

@Component({
  selector: 'schedule',
  imports: [
    ScheduleWeekComponent,
    ScheduleMonthComponent,
    MatIconButton,
    MatIcon,
    MatTooltip,
    TranslatePipe,
    MatChipListbox,
    MatChipOption,
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
  private _store = inject(Store);
  private _globalTrackingIntervalService = inject(GlobalTrackingIntervalService);
  private _globalConfigService = inject(GlobalConfigService);
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _translate = inject(TranslateService);
  private _hiddenCalendarProviders = inject(HiddenCalendarProvidersService);
  private _pastWorkScheduleEntriesService = inject(PastWorkScheduleEntriesService);

  readonly showWorkLog = signal(
    localStorage.getItem(LS.SCHEDULE_SHOW_WORK_LOG) === 'true',
  );

  toggleShowWorkLog(): void {
    const next = !this.showWorkLog();
    this.showWorkLog.set(next);
    localStorage.setItem(LS.SCHEDULE_SHOW_WORK_LOG, String(next));
    if (!next) {
      this._pastWorkScheduleEntriesService.clearCache();
    }
  }

  private _workLogDays = computed(() => (this.showWorkLog() ? this.daysToShow() : []));

  readonly _pastWorkEntries = toSignal(
    toObservable(this._workLogDays).pipe(
      switchMap((days) =>
        this._pastWorkScheduleEntriesService.buildEntriesForDays$(days),
      ),
    ),
    { initialValue: [] as ScheduleCalendarMapEntry[] },
  );

  readonly hiddenCalendarProviderIds = this._hiddenCalendarProviders.hiddenProviderIds;
  readonly enabledCalendarProviders = toSignal(
    this._store
      .select(selectCalendarProviders)
      .pipe(map((ps) => ps.filter((p) => p.isEnabled))),
    { initialValue: [] },
  );
  readonly calProviderLabel = (p: IssueProvider): string => getIssueProviderTooltip(p);

  toggleCalendarProvider(providerId: string): void {
    this._hiddenCalendarProviders.toggle(providerId);
  }

  private _currentTimeViewMode = computed(() => this.layoutService.selectedTimeView());
  isMonthView = computed(() => this._currentTimeViewMode() === 'month');

  // Navigation state - null = viewing today, Date = viewing selected date
  private _selectedDate = signal<Date | null>(null);

  // True when today falls within the currently displayed range.
  // Disables the "today" reset button and suppresses navigation jumps.
  isViewingToday = computed(() => {
    if (this._selectedDate() === null) return true;
    const todayStr = this._todayDateStr();
    return todayStr ? this.daysToShow().includes(todayStr) : false;
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
    const selectedView = this._currentTimeViewMode();
    // Only enable horizontal scroll for week view when viewport is narrow
    if (selectedView !== 'week') {
      return false;
    }
    // Enable scroll when viewport is smaller than what's needed for 7 days
    return this._windowSize().width < SCHEDULE_CONSTANTS.HORIZONTAL_SCROLL_THRESHOLD;
  });

  private _daysToShowCount = computed(() => {
    const size = this._windowSize();
    const selectedView = this._currentTimeViewMode();
    const width = size.width;
    const height = size.height;

    if (selectedView === 'month') {
      const availableHeight = height - SCHEDULE_CONSTANTS.MONTH_VIEW.HEADER_OFFSET;
      const minHeightPerWeek =
        width < SCHEDULE_CONSTANTS.BREAKPOINTS.TABLET
          ? SCHEDULE_CONSTANTS.MONTH_VIEW.MIN_HEIGHT_PER_WEEK_MOBILE
          : SCHEDULE_CONSTANTS.MONTH_VIEW.MIN_HEIGHT_PER_WEEK_DESKTOP;
      const maxWeeks = Math.floor(availableHeight / minHeightPerWeek);

      if (maxWeeks < SCHEDULE_CONSTANTS.MONTH_VIEW.MIN_WEEKS) {
        return SCHEDULE_CONSTANTS.MONTH_VIEW.MIN_WEEKS;
      } else if (maxWeeks > SCHEDULE_CONSTANTS.MONTH_VIEW.MAX_WEEKS) {
        return SCHEDULE_CONSTANTS.MONTH_VIEW.MAX_WEEKS;
      } else {
        return maxWeeks;
      }
    }

    // Week view: always 7 days
    return 7;
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
        this.firstDayOfWeek(),
        selectedDate,
      );
    }
    return this.scheduleService.getDaysToShow(count, selectedDate);
  });

  weeksToShow = computed(() => Math.ceil(this.daysToShow().length / 7));

  headerTitle = computed(() => {
    const days = this.daysToShow();
    if (!days.length) return '';
    const locale = this._dateTimeFormatService.currentLocale();

    if (this.isMonthView()) {
      const mid = parseDbDateStr(days[Math.floor(days.length / 2)]);
      return safeFormatDate(mid, 'LLLL yyyy', locale);
    }

    const start = parseDbDateStr(days[0]);
    const end = parseDbDateStr(days[days.length - 1]);
    const weekNr = getWeekNumber(start); // ISO — default firstDayOfWeek=1
    const startStr = safeFormatDate(start, 'MMM d', locale);
    const endStr = safeFormatDate(end, 'MMM d', locale);
    const label = this._translate.instant(T.F.WORKLOG.CMP.WEEK_NR, { nr: weekNr });
    return `${label} · ${startStr} – ${endStr}`;
  });

  firstDayOfWeek = computed(() => {
    const cfg = this._globalConfigService.localization()?.firstDayOfWeek;
    return cfg !== null && cfg !== undefined ? cfg : DEFAULT_FIRST_DAY_OF_WEEK;
  });

  // Calculate context-aware "now" based on selected date
  // When viewing a future/past week, use the start of that period as reference time
  private _contextNow = computed(() => {
    const selectedDate = this._selectedDate();
    if (selectedDate === null) {
      return Date.now();
    }

    // Viewing a different date - use that date's midnight as reference
    const contextDate = new Date(selectedDate);
    contextDate.setHours(0, 0, 0, 0);
    return contextDate.getTime();
  });

  scheduleDays = computed(() => {
    return this.scheduleService.createScheduleDaysWithContext({
      daysToShow: this.daysToShow(),
      contextNow: this._contextNow(),
      realNow: Date.now(),
      currentTaskId: this.taskService.currentTaskId() ?? null,
      additionalCalendarEntries: this._pastWorkEntries(),
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
    if (this.isViewingToday() && !this.showWorkLog()) return;

    const currentDate = this._selectedDate() || new Date();
    const selectedView = this._currentTimeViewMode();

    if (selectedView === 'month') {
      const previousMonth = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() - 1,
        1,
      );
      this._selectedDate.set(previousMonth);
    } else {
      const daysToSkip = this.daysToShow().length;
      const previousPeriod = new Date(currentDate);
      previousPeriod.setDate(currentDate.getDate() - daysToSkip);
      previousPeriod.setHours(0, 0, 0, 0);

      if (this.showWorkLog()) {
        this._selectedDate.set(previousPeriod);
      } else {
        // Snap to today if going back would land on or before today
        const todayMidnight = new Date();
        todayMidnight.setHours(0, 0, 0, 0);
        if (previousPeriod.getTime() <= todayMidnight.getTime()) {
          this._selectedDate.set(null);
        } else {
          this._selectedDate.set(previousPeriod);
        }
      }
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

  selectTimeView(view: 'week' | 'month'): void {
    this.layoutService.selectedTimeView.set(view);
    localStorage.setItem(LS.SELECTED_TIME_VIEW, view);
  }

  private getTimeView(): 'week' | 'month' {
    const preservedView = localStorage.getItem(LS.SELECTED_TIME_VIEW);
    return preservedView === 'month' ? 'month' : 'week';
  }

  constructor() {
    this.layoutService.selectedTimeView.set(this.getTimeView());

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
