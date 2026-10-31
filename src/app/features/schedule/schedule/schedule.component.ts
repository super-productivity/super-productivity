/* eslint-disable */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Signal,
  signal,
  viewChild,
} from '@angular/core';
import { combineLatest, fromEvent } from 'rxjs';
import { select, Store } from '@ngrx/store';
import {
  selectCalendarProviders,
  selectEnabledIssueProviders,
} from '../../issue/store/issue-provider.selectors';
import { HiddenCalendarProvidersService } from '../../calendar-integration/hidden-calendar-providers.service';
import { selectUndoneDeadlineTasksByDay } from '../../planner/store/planner.selectors';
import {
  getIssueProviderTooltip,
  sanitizeIcalUrlForDisplay,
} from '../../issue/mapping-helper/get-issue-provider-tooltip';
import { getCalendarProviderColor } from '../../issue/mapping-helper/get-calendar-provider-color';
import {
  IssueProvider,
  IssueProviderPluginType,
  isPluginIssueProvider,
} from '../../issue/issue.model';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import {
  MatMenu,
  MatMenuContent,
  MatMenuItem,
  MatMenuTrigger,
} from '@angular/material/menu';
import { debounceTime, distinctUntilChanged, map, startWith } from 'rxjs/operators';
import { fastArrayCompare } from '../../../util/fast-array-compare';
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
import { toSignal } from '@angular/core/rxjs-interop';
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
import { anchorContextNow } from '../anchor-context-now';
import {
  SwipePagerComponent,
  SwipePagerPageDirective,
} from '../../../ui/swipe-pager/swipe-pager.component';
import {
  ScheduleDayPage,
  scheduleDayPageKey,
  shiftDayStr,
  toScheduleDayPage,
} from '../schedule-day-page';
import { DateService } from '../../../core/date/date.service';

@Component({
  selector: 'schedule',
  imports: [
    ScheduleWeekComponent,
    ScheduleMonthComponent,
    SwipePagerComponent,
    SwipePagerPageDirective,
    MatIconButton,
    MatIcon,
    MatTooltip,
    TranslatePipe,
    MatMenu,
    MatMenuContent,
    MatMenuItem,
    MatMenuTrigger,
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
  private _dateService = inject(DateService);
  private _translate = inject(TranslateService);
  private _hiddenCalendarProviders = inject(HiddenCalendarProvidersService);
  private _elRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private _pluginIssueProviderRegistry = inject(PluginIssueProviderRegistryService);

  readonly hiddenCalendarProviderIds = this._hiddenCalendarProviders.hiddenProviderIds;
  readonly enabledCalendarProviders = toSignal(
    combineLatest([
      this._store
        .select(selectCalendarProviders)
        .pipe(distinctUntilChanged(fastArrayCompare)),
      combineLatest([
        this._store.select(selectEnabledIssueProviders),
        this._pluginIssueProviderRegistry.registrationChanges$,
      ]).pipe(
        map(([providers]) =>
          providers.filter(
            (p): p is IssueProviderPluginType =>
              isPluginIssueProvider(p.issueProviderKey) &&
              this._pluginIssueProviderRegistry.getUseAgendaView(p.issueProviderKey),
          ),
        ),
        distinctUntilChanged(fastArrayCompare),
      ),
    ]).pipe(map(([ical, plugin]): IssueProvider[] => [...ical, ...plugin])),
    { initialValue: [] as IssueProvider[] },
  );
  // Show the button with multiple providers, OR with a single provider that
  // is currently hidden — otherwise the user has no UI to re-enable the only
  // calendar after, e.g., deleting all but one provider in settings.
  readonly showCalFilterBtn = computed(() => {
    const providers = this.enabledCalendarProviders();
    if (providers.length > 1) return true;
    const hidden = this.hiddenCalendarProviderIds();
    return providers.some((p) => hidden.includes(p.id));
  });
  // Plugin labels come from the first non-secret config string, which may be a
  // URL (credentials in the path) or an opaque scheme; reuse the iCal sanitizer
  // so neither is rendered verbatim.
  readonly calProviderLabel = (p: IssueProvider): string => {
    const raw = getIssueProviderTooltip(p);
    if (!/^[a-z][a-z0-9+.-]*:\S/i.test(raw)) return raw;
    const sanitized = sanitizeIcalUrlForDisplay(raw);
    return sanitized === 'iCal' && p.issueProviderKey !== 'ICAL'
      ? p.issueProviderKey
      : sanitized;
  };
  // Materialized once per provider-list change; method calls inside the menu
  // @for would re-run the hash and URL parsing on every change detection.
  readonly calProviderRows = computed(() => {
    const calendarColors = this.scheduleService.calendarColorByProviderId();
    return this.enabledCalendarProviders().map((p) => ({
      id: p.id,
      color: getCalendarProviderColor(p, calendarColors.get(p.id)),
      label: this.calProviderLabel(p),
    }));
  });

  toggleCalProvider(providerId: string): void {
    this._hiddenCalendarProviders.toggle(providerId);
  }

  private _scrollWrapper = viewChild<ElementRef<HTMLElement>>('scrollWrapper');

  private _currentTimeViewMode = computed(() => this.layoutService.selectedTimeView());
  isMonthView = computed(() => this._currentTimeViewMode() === 'month');
  isDayView = computed(() => this._currentTimeViewMode() === 'day');
  isWeekView = computed(() => this._currentTimeViewMode() === 'week');

  // Navigation state - null = viewing today, Date = viewing selected date
  private _selectedDate = signal<Date | null>(null);

  // True when today falls within the currently displayed range.
  // Disables the "today" reset button and suppresses navigation jumps.
  isViewingToday = computed(() => {
    const selectedDate = this._selectedDate();
    if (selectedDate === null) return true;
    const todayStr = this._todayDateStr();
    if (!todayStr) return false;
    if (this.isMonthView()) {
      // Compare the month, not the grid: the grid's padding days can include
      // today while showing the next month, which locked navigation (#10451)
      const today = parseDbDateStr(todayStr);
      return (
        selectedDate.getFullYear() === today.getFullYear() &&
        selectedDate.getMonth() === today.getMonth()
      );
    }
    return this.daysToShow().includes(todayStr);
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
    const selectedView = this._currentTimeViewMode();

    if (selectedView === 'day') return 1;

    // Month view derives its own count from the displayed month, in `daysToShow`
    // below: it needs `selectedDate` and `firstDayOfWeek`, neither of which is
    // read here.

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
      // Rows follow the month, never the window height. Deriving them from
      // available space is what #9449 was filed for: a day left out of
      // `daysToShow` gets no events computed at all, so a task on it vanished
      // rather than merely being clipped. 4-6 rows spans every
      // month/firstDayOfWeek pair, and `weeksToShow` carries the same number
      // into the grid's `--nr-of-weeks`, so the tracks follow the days.
      const firstDayOfWeek = this.firstDayOfWeek();
      return this.scheduleService.getMonthDaysToShow(
        this.scheduleService.getMonthWeeksToShow(firstDayOfWeek, selectedDate),
        firstDayOfWeek,
        selectedDate,
      );
    }
    return this.scheduleService.getDaysToShow(count, selectedDate);
  });

  weeksToShow = computed(() => Math.ceil(this.daysToShow().length / 7));

  // Memoized so headerTitle only re-runs at the breakpoint boundary,
  // not on every debounced resize tick.
  private _isCompact = computed(
    () => this._windowSize().width < SCHEDULE_CONSTANTS.BREAKPOINTS.XS,
  );
  private _isVeryCompact = computed(
    () => this._windowSize().width < SCHEDULE_CONSTANTS.BREAKPOINTS.XXS,
  );
  private _isTablet = computed(
    () => this._windowSize().width < SCHEDULE_CONSTANTS.BREAKPOINTS.TABLET,
  );

  headerTitle = computed(() => {
    const days = this.daysToShow();
    if (!days.length) return '';
    const locale = this._dateTimeFormatService.textLocale();
    const isIsoLocale = this._dateTimeFormatService.isoTextLocale() !== null;

    if (this.isDayView()) {
      // On tablet width and below the full date clips, so drop to month + day
      // (the weekday still shows in the day-column header).
      const dayOpts: Intl.DateTimeFormatOptions = this._isTablet()
        ? { month: 'short', day: 'numeric' }
        : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
      if (isIsoLocale) {
        dayOpts.calendar = 'gregory';
        dayOpts.numberingSystem = 'latn';
      }
      return new Intl.DateTimeFormat(locale, dayOpts).format(parseDbDateStr(days[0]));
    }

    if (this.isMonthView()) {
      const mid = parseDbDateStr(days[Math.floor(days.length / 2)]);
      return safeFormatDate(mid, 'LLLL yyyy', locale);
    }

    const start = parseDbDateStr(days[0]);
    const end = parseDbDateStr(days[days.length - 1]);
    const weekNr = getWeekNumber(start); // ISO — default firstDayOfWeek=1
    const sameMonth =
      start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    const startStr = safeFormatDate(start, 'MMM d', locale);
    const endStr = sameMonth
      ? safeFormatDate(end, 'd', locale)
      : safeFormatDate(end, 'MMM d', locale);
    const labelKey = this._isCompact()
      ? T.F.WORKLOG.CMP.WEEK_NR_SHORT
      : T.F.WORKLOG.CMP.WEEK_NR;
    const label = this._translate.instant(labelKey, { nr: weekNr });
    if (this._isVeryCompact()) return label;
    return `${label} · ${startStr} – ${endStr}`;
  });

  firstDayOfWeek = computed(() => {
    const cfg = this._globalConfigService.localization()?.firstDayOfWeek;
    return cfg !== null && cfg !== undefined ? cfg : DEFAULT_FIRST_DAY_OF_WEEK;
  });

  // Calculate context-aware "now" anchored to the first displayed day
  // When viewing a future range, use the start of that range as reference time
  private _contextNow = computed(() => {
    // Date.now() is not reactive and computeds cache, so without a time-varying
    // dependency the reference would freeze at whatever instant this last ran.
    // Same 2-min tick currentTimeRow and scheduleDays already refresh on.
    this.scheduleService.scheduleRefreshTick();

    // contextNow anchors dayDates[0] (`startTime = i == 0 ? now` in
    // create-schedule-days), so it has to stay inside that day. Day 0 is not
    // always the selected date: month view pads the grid back to the start of
    // the week containing the 1st, so its first cell usually sits in the
    // previous month, and deriving the anchor from the selected date stamped
    // that cell with a timestamp from a different day. The bounds therefore
    // come from daysToShow()[0] itself, via the same helper
    // create-schedule-days resolves day bounds with. Testing where the wall
    // clock sits within that day - rather than comparing day strings - lets
    // the view self-correct once it drifts under a midnight rollover (a day
    // picked as "tomorrow" becomes today while the view stays put), and can
    // never hand the mapper a now past day 0's end, which would push every
    // entry out of the column.
    const firstDay = this.daysToShow()[0];
    if (!firstDay) {
      return Date.now();
    }
    return anchorContextNow(firstDay, Date.now());
  });

  scheduleDays = computed(() => {
    return this.scheduleService.createScheduleDaysWithContext({
      daysToShow: this.daysToShow(),
      contextNow: this._contextNow(),
      realNow: Date.now(),
      currentTaskId: this.taskService.currentTaskId() ?? null,
    });
  });

  private _eventsAndBeyondBudget = computed(() => {
    const days = this.scheduleDays();
    return mapScheduleDaysToScheduleEvents(days, FH);
  });

  deadlineTasksByDay = toSignal(
    this._store.pipe(select(selectUndoneDeadlineTasksByDay)),
    { initialValue: {} },
  );

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
  monthEvents = computed(() => this.events().concat(...this.beyondBudget()));

  nowRow = computed(() => {
    // Trigger re-computation every 2 minutes
    this.scheduleService.scheduleRefreshTick();
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();

    const hoursToday = hours + minutes / 60;
    return Math.round(hoursToday * FH);
  });

  // Only show current time indicator when viewing today
  currentTimeRow = computed(() => (this.isViewingToday() ? this.nowRow() : null));

  // Day view pages through days by swiping (SwipePagerComponent). Neighbouring
  // days are only computed once the pager is warm: when idle on a touch device,
  // on first touch, or when the prev/next buttons animate through it.
  isPagerWarm = signal(false);
  readonly dayPageKey = scheduleDayPageKey;
  private _dayPager = viewChild(SwipePagerComponent);

  currentDayPage = computed<ScheduleDayPage | undefined>(() => {
    const day = this.daysToShow()[0];
    return day ? toScheduleDayPage(day, this.scheduleDays()) : undefined;
  });
  // Like goToPreviousPeriod, never pages into the past.
  prevDayPage = this._createDayPage(
    computed(() => {
      const day = this.daysToShow()[0];
      return day && this.isDayView() && this.isPagerWarm() && !this.isViewingToday()
        ? shiftDayStr(day, -1)
        : undefined;
    }),
  );
  nextDayPage = this._createDayPage(
    computed(() => {
      const day = this.daysToShow()[0];
      return day && this.isDayView() && this.isPagerWarm()
        ? shiftDayStr(day, 1)
        : undefined;
    }),
  );

  onDayPagerNavigate(page: ScheduleDayPage): void {
    // Like goToPreviousPeriod, landing on (logical) today is the "today" mode.
    const today = this._todayDateStr();
    this._selectedDate.set(today && page.day > today ? parseDbDateStr(page.day) : null);
  }

  // The nav buttons slide the day view like a swipe does.
  navigatePrevious(): void {
    const pager = this._dayPager();
    if (this.isDayView() && pager) {
      pager.go(-1);
    } else {
      this.goToPreviousPeriod();
    }
  }

  navigateNext(): void {
    const pager = this._dayPager();
    if (this.isDayView() && pager) {
      pager.go(1);
    } else {
      this.goToNextPeriod();
    }
  }

  // Same inputs as scheduleDays for a single day, anchored to the day the same
  // way _contextNow is. Only the "now" for today's page can differ, by up to
  // the 2-minute refresh tick that _contextNow is cached for.
  private _createDayPage(
    day: Signal<string | undefined>,
  ): Signal<ScheduleDayPage | undefined> {
    return computed(() => {
      const d = day();
      if (!d) {
        return undefined;
      }
      const scheduleDays = this.scheduleService.createScheduleDaysWithContext({
        daysToShow: [d],
        contextNow: anchorContextNow(d, Date.now()),
        realNow: Date.now(),
        currentTaskId: this.taskService.currentTaskId() ?? null,
      });
      return toScheduleDayPage(d, scheduleDays);
    });
  }

  goToPreviousPeriod(): void {
    // Never navigate into the past — the displayed range must include today or later
    if (this.isViewingToday()) return;

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

      // If going back would land on or before today, snap to "today view" (null).
      // Today is the logical day the today view shows, as in goToNextPeriod.
      const todayMidnight = this._dateService.getLogicalTodayDate();
      todayMidnight.setHours(0, 0, 0, 0);
      if (previousPeriod.getTime() <= todayMidnight.getTime()) {
        this._selectedDate.set(null);
      } else {
        this._selectedDate.set(previousPeriod);
      }
    }
  }

  goToNextPeriod(): void {
    const currentDate = this._selectedDate() || this._dateService.getLogicalTodayDate();
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

  // Tracks whether the scroll-wrapper has been scrolled horizontally. Used
  // by schedule-week so the sticky time column gets a background only once
  // day-content is actually sliding under it.
  isHScrolled = signal(false);

  onScrollWrapperScroll(event: Event): void {
    const el = event.target as HTMLElement;
    this.isHScrolled.set(el.scrollLeft > 0);
  }

  // The month grid is taller than the wrapper on a short window, so a scroll
  // position carried over from week view clamps to the bottom and opens the
  // month with its first row above the viewport (#9463 review). scrollTo is
  // safe here where _scrollAnchorToTop's measured offsets would not be, since
  // a fixed origin is independent of the warpRoute scale.
  private _resetScrollWrapper(): void {
    this._scrollWrapper()?.nativeElement.scrollTo({
      top: 0,
      left: 0,
      behavior: 'instant',
    });
  }

  // Scroll one of the schedule's time anchors to the top of the scroll-wrapper.
  //
  // The framing (lead above the target, and clearance for the sticky time
  // column and week header) lives in CSS as scroll-padding on .scroll-wrapper,
  // next to the row-height and column-width variables it is derived from.
  //
  // scrollIntoView is used rather than scrollTo with measured offsets because
  // it resolves the target in layout coordinates: the route enter animation
  // (warpRoute) starts this view at scale(1.2) and the scroll runs on a
  // setTimeout(0), so anything measured from getBoundingClientRect() while that
  // is in flight overshoots by the animation's current scale.
  //
  // The lookup is scoped to this component's own element: the right panel
  // embeds a second schedule-week that renders its own #current-time. The day
  // view's swipe pager renders neighbouring days too; those are inert.
  private _scrollAnchorToTop(elementId: string): void {
    const element = Array.from(
      this._elRef.nativeElement.querySelectorAll<HTMLElement>(`#${elementId}`),
    ).find((el) => !el.closest('[inert]'));

    element?.scrollIntoView({ block: 'start', inline: 'start', behavior: 'instant' });
  }

  selectTimeView(view: 'week' | 'month' | 'day'): void {
    this.layoutService.selectedTimeView.set(view);
    localStorage.setItem(LS.SELECTED_TIME_VIEW, view);
  }

  private getTimeView(): 'week' | 'month' | 'day' {
    const preservedView = localStorage.getItem(LS.SELECTED_TIME_VIEW);
    if (preservedView === 'month') return 'month';
    if (preservedView === 'day') return 'day';
    if (preservedView === 'week') return 'week';
    // No saved choice yet: a phone fits under three of the week's seven columns,
    // so it starts on one readable day instead.
    return this.layoutService.isXs() ? 'day' : 'week';
  }

  constructor() {
    this.layoutService.selectedTimeView.set(this.getTimeView());

    effect(() => {
      if (this.isMonthView() === false) {
        // prefer the current time when it is visible (today is in range),
        // otherwise fall back to work start. NOTE: the signal read must stay
        // inside the setTimeout so it is untracked — otherwise currentTimeRow's
        // 2-minute refresh tick would re-run this effect and yank the scroll
        // position while the user is reading the schedule.
        setTimeout(() =>
          this._scrollAnchorToTop(
            this.currentTimeRow() !== null ? 'current-time' : 'work-start',
          ),
        );
      } else {
        setTimeout(() => this._resetScrollWrapper());
      }
    });
  }
}
