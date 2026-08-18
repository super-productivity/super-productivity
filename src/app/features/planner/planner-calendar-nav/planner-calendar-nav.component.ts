import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DEFAULT_FIRST_DAY_OF_WEEK } from '../../../core/locale.constants';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { getWeekRange } from '../../../util/get-week-range';
import { getWeekdaysMin } from '../../../util/get-weekdays-min';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { parseDbDateStr } from '../../../util/parse-db-date-str';
import {
  CalendarGestureHandler,
  DAYS_IN_VIEW,
  MIN_HEIGHT,
  ROW_HEIGHT,
  WEEKS_SHOWN,
} from './planner-calendar-gesture-handler';

/** The collapse handle, which sits below the week rows and must stay tappable. */
export const HANDLE_HEIGHT = 28;
/** One task row of the plan list must stay visible behind an expanded calendar. */
export const MIN_PLAN_VIEW_HEIGHT = ROW_HEIGHT;

interface CalendarDay {
  dateStr: string;
  dayOfMonth: number;
  isToday: boolean;
  isPast: boolean;
  hasTasks: boolean;
}

@Component({
  selector: 'planner-calendar-nav',
  templateUrl: './planner-calendar-nav.component.html',
  styleUrl: './planner-calendar-nav.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlannerCalendarNavComponent {
  private _globalConfigService = inject(GlobalConfigService);
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _globalTrackingIntervalService = inject(GlobalTrackingIntervalService);
  private _cdr = inject(ChangeDetectorRef);
  private _elRef = inject(ElementRef);
  private _destroyRef = inject(DestroyRef);
  private _gesture!: CalendarGestureHandler;
  private _resizeObserver?: ResizeObserver;

  private _firstDayOfWeek = computed(() => {
    const cfg = this._globalConfigService.localization()?.firstDayOfWeek;
    return cfg !== null && cfg !== undefined ? cfg : DEFAULT_FIRST_DAY_OF_WEEK;
  });

  visibleDayDate = input<string | null>(null);
  daysWithTasks = input<ReadonlySet<string>>(new Set());
  dayTapped = output<string>();

  isExpanded = signal(false);
  /**
   * Room below the first week row, measured rather than derived from
   * `window.innerHeight`: everything above the rows (app header, the planner's
   * own chrome, month label, day labels) varies by platform and route, and
   * guessing it is what made the six-row grid overflow at XS heights.
   * Infinity until first measured, so nothing is clamped before layout exists.
   */
  private _availableForRows = signal(Number.POSITIVE_INFINITY);
  private _anchorWeekStart = signal<string | null>(null);
  private _displayedRow = signal<number | null>(null);
  private _weeksEl = viewChild<ElementRef<HTMLElement>>('weeksContainer');

  dayLabels = computed(() => {
    const firstDay = this._firstDayOfWeek();
    const allDays = getWeekdaysMin();
    const ordered: string[] = [];
    for (let i = 0; i < 7; i++) {
      ordered.push(allDays[(firstDay + i) % 7]);
    }
    return ordered;
  });

  weeks = computed<CalendarDay[][]>(() => {
    const anchor = this._anchorWeekStart();
    const todayStr = this._globalTrackingIntervalService.todayDateStr();
    const taskDays = this.daysWithTasks();

    const weekStart = anchor
      ? parseDbDateStr(anchor)
      : getWeekRange(parseDbDateStr(todayStr), this._firstDayOfWeek()).start;

    const weeks: CalendarDay[][] = [];
    const cursor = new Date(weekStart);
    for (let w = 0; w < WEEKS_SHOWN; w++) {
      const week: CalendarDay[] = [];
      for (let d = 0; d < 7; d++) {
        const dateStr = getDbDateStr(cursor);
        week.push({
          dateStr,
          dayOfMonth: cursor.getDate(),
          isToday: dateStr === todayStr,
          isPast: dateStr < todayStr,
          hasTasks: taskDays.has(dateStr),
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
    }
    return weeks;
  });

  activeWeekIndex = computed(() => {
    const override = this._displayedRow();
    if (override !== null) return override;
    const visibleDay = this.visibleDayDate();
    if (!visibleDay) return 0;
    const allWeeks = this.weeks();
    for (let i = 0; i < allWeeks.length; i++) {
      if (allWeeks[i].some((d) => d.dateStr === visibleDay)) {
        return i;
      }
    }
    return 0;
  });

  /**
   * Week rows the expanded grid may show. Six rows of *data* are always built
   * (`DAYS_IN_VIEW`), so every day of the month exists, carries its task dot and
   * stays tappable — but rendering all six needs 240px, which at XS heights
   * pushed `planner-plan-view` to 0px and hid the collapse handle behind the
   * bottom nav. When rows are dropped here the grid slides to keep the active
   * week in view, so nothing becomes unreachable.
   */
  private _visibleWeekRows = computed(() => {
    const fits = Math.floor(this._availableForRows() / ROW_HEIGHT);
    return Math.min(WEEKS_SHOWN, Math.max(1, fits));
  });

  private _parentEl(): HTMLElement | null {
    return this._elRef.nativeElement.parentElement as HTMLElement | null;
  }

  private _measureAvailableForRows(): void {
    const el = this._weeksEl()?.nativeElement;
    if (!el) return;
    // Bounded by the route content, not the window: on XS the bottom nav takes
    // the last ~44px, so measuring against window.innerHeight reserves space
    // that the plan list never gets.
    const container = this._parentEl();
    const bottom = container
      ? container.getBoundingClientRect().bottom
      : window.innerHeight;
    this._availableForRows.set(
      bottom - el.getBoundingClientRect().top - HANDLE_HEIGHT - MIN_PLAN_VIEW_HEIGHT,
    );
  }

  maxHeight = computed(() => {
    return this.isExpanded() ? this._visibleWeekRows() * ROW_HEIGHT : MIN_HEIGHT;
  });

  weekOffset = computed(() =>
    this._weekOffsetFor(this.isExpanded(), this.activeWeekIndex()),
  );

  // Active week at the top of the window, clamped so the last row can never sit
  // below it. Collapsed (1 row) and unclamped expanded (6 rows) both fall out of
  // this: -activeWeekIndex * ROW_HEIGHT and 0 respectively.
  private _weekOffsetFor(expanded: boolean, activeIdx: number): number {
    const rows = expanded ? this._visibleWeekRows() : 1;
    const firstRow = Math.min(activeIdx, WEEKS_SHOWN - rows);
    return -firstRow * ROW_HEIGHT;
  }

  monthLabel = computed(() => {
    // The spelled-out month name follows textLocale(): passing no locale would
    // use the *browser's*, ignoring both the configured date locale and the UI
    // language (a German browser showed "Juli 2026" in an English app). Under
    // the ISO 8601 option textLocale() is the UI language rather than the `sv`
    // sentinel, so the name isn't shown in Swedish either. #8987 follow-up.
    const locale = this._dateTimeFormatService.textLocale();
    const allWeeks = this.weeks();
    const weekIdx = this.isExpanded()
      ? Math.floor(allWeeks.length / 2)
      : this.activeWeekIndex();
    const week = allWeeks[weekIdx];
    if (week?.length > 0) {
      const date = parseDbDateStr(week[Math.floor(week.length / 2)].dateStr);
      return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
    }
    const visibleDay =
      this.visibleDayDate() || this._globalTrackingIntervalService.todayDateStr();
    return parseDbDateStr(visibleDay).toLocaleDateString(locale, {
      month: 'long',
      year: 'numeric',
    });
  });

  onDayTap(dateStr: string): void {
    this.dayTapped.emit(dateStr);
  }

  constructor() {
    effect(() => {
      const visibleDay =
        this.visibleDayDate() || this._globalTrackingIntervalService.todayDateStr();
      const firstDayOfWeek = this._firstDayOfWeek();
      const visibleDate = parseDbDateStr(visibleDay);
      const anchor = untracked(() => this._anchorWeekStart());

      if (anchor) {
        const anchorDate = parseDbDateStr(anchor);
        const anchorEnd = new Date(anchorDate);
        anchorEnd.setDate(anchorEnd.getDate() + DAYS_IN_VIEW - 1);
        if (visibleDate >= anchorDate && visibleDate <= anchorEnd) {
          return;
        }
      }
      const range = getWeekRange(visibleDate, firstDayOfWeek);
      this._anchorWeekStart.set(getDbDateStr(range.start));
    });

    effect(() => {
      this.visibleDayDate();
      untracked(() => this._displayedRow.set(null));
    });

    this._gesture = new CalendarGestureHandler(
      this._elRef.nativeElement,
      () => this._weeksEl()?.nativeElement,
      {
        getActiveWeekIndex: () => this.activeWeekIndex(),
        getIsExpanded: () => this.isExpanded(),
        getExpandedHeight: () => {
          this._measureAvailableForRows();
          return this._visibleWeekRows() * ROW_HEIGHT;
        },
        getWeekOffset: (expanded, activeIdx) => this._weekOffsetFor(expanded, activeIdx),
        onExpandChanged: (expanded) => this.isExpanded.set(expanded),
        onVerticalSwipe: (isDown) => this._handleVerticalSwipe(isDown),
        onHorizontalSwipe: (dir) => this._handleHorizontalSwipe(dir),
        detectChanges: () => this._cdr.detectChanges(),
      },
    );
    this._destroyRef.onDestroy(() => this._gesture.destroy());

    effect(() => {
      // Observe the box the measurement is taken against, rather than the
      // window: the route content also shrinks when a banner appears above it
      // (`<banner>` sits above `.route-wrapper`), which fires no resize event.
      // Expanding moves neither input, so it is deliberately not a trigger.
      const el = this._weeksEl()?.nativeElement;
      if (!el) return;
      untracked(() => this._observeAvailableForRows());
    });
  }

  private _observeAvailableForRows(): void {
    const container = this._parentEl();
    this._measureAvailableForRows();
    if (!container || this._resizeObserver) return;

    this._resizeObserver = new ResizeObserver(() => this._measureAvailableForRows());
    this._resizeObserver.observe(container);
    this._destroyRef.onDestroy(() => this._resizeObserver?.disconnect());
  }

  private _handleVerticalSwipe(isDown: boolean): void {
    if (isDown) {
      if (!this.isExpanded()) {
        this._gesture.snapTo(true, this.activeWeekIndex());
      } else if (!this._isAtPastLimit()) {
        this._gesture.slideContent(1, () => this._shiftToMonth(-1), 'y');
      }
    } else {
      if (this.isExpanded()) {
        this._gesture.slideContent(-1, () => this._shiftToMonth(1), 'y');
      }
    }
  }

  private _handleHorizontalSwipe(dir: 1 | -1): void {
    if (this.isExpanded()) {
      if (dir === -1 && this._isAtPastLimit()) return;
      this._gesture.slideContent(dir, () => this._shiftToMonth(dir), 'x');
    } else {
      this._slideCollapsedWeek(dir);
    }
  }

  private _slideCollapsedWeek(dir: 1 | -1): void {
    const currentRow = this.activeWeekIndex();
    // Prevent navigating before today's week
    if (dir === -1) {
      if (this.weeks()[currentRow]?.some((d) => d.isToday)) return;
      // If already at the past limit and would need to shift the anchor, block it
      if (currentRow === 0 && this._isAtPastLimit()) return;
    }

    const targetRow = currentRow + dir;

    if (targetRow >= 0 && targetRow < WEEKS_SHOWN) {
      this._gesture.slideContent(dir, () => this._displayedRow.set(targetRow), 'x');
    } else if (dir === 1) {
      this._gesture.slideContent(
        dir,
        () => {
          this._shiftAnchor(DAYS_IN_VIEW);
          this._displayedRow.set(0);
        },
        'x',
      );
    } else {
      this._gesture.slideContent(
        dir,
        () => {
          const oldAnchorStr = this._anchorWeekStart();
          this._shiftAnchor(-DAYS_IN_VIEW);
          const newAnchorStr = this._anchorWeekStart();
          if (oldAnchorStr && newAnchorStr) {
            const diffDays = Math.round(
              (parseDbDateStr(oldAnchorStr).getTime() -
                parseDbDateStr(newAnchorStr).getTime()) /
                86_400_000,
            );
            this._displayedRow.set(
              Math.max(0, Math.min(WEEKS_SHOWN - 1, Math.floor(diffDays / 7) - 1)),
            );
          } else {
            this._displayedRow.set(WEEKS_SHOWN - 1);
          }
        },
        'x',
      );
    }
  }

  private _isAtPastLimit(): boolean {
    const todayWeekStart = this._getTodayWeekStart();
    const currentAnchor = this._anchorWeekStart();
    const anchorDate = currentAnchor ? parseDbDateStr(currentAnchor) : todayWeekStart;
    return anchorDate <= todayWeekStart;
  }

  private _shiftAnchor(dayOffset: number): void {
    const todayWeekStart = this._getTodayWeekStart();
    const currentAnchor = this._anchorWeekStart();
    const anchorDate = currentAnchor ? parseDbDateStr(currentAnchor) : todayWeekStart;
    const newAnchor = new Date(anchorDate);
    newAnchor.setDate(newAnchor.getDate() + dayOffset);
    this._setAnchorClamped(newAnchor, todayWeekStart);
  }

  private _shiftToMonth(dir: 1 | -1): void {
    const allWeeks = this.weeks();
    const midWeek = allWeeks[Math.floor(allWeeks.length / 2)];
    const midDate = parseDbDateStr(midWeek[Math.floor(midWeek.length / 2)].dateStr);
    // Use day=1 to avoid overflow (e.g. Jan 31 + 1 month → Mar 3)
    const firstOfMonth = new Date(midDate.getFullYear(), midDate.getMonth() + dir, 1);
    const weekStart = getWeekRange(firstOfMonth, this._firstDayOfWeek()).start;
    this._setAnchorClamped(weekStart, this._getTodayWeekStart());
  }

  private _getTodayWeekStart(): Date {
    return getWeekRange(
      parseDbDateStr(this._globalTrackingIntervalService.todayDateStr()),
      this._firstDayOfWeek(),
    ).start;
  }

  private _setAnchorClamped(target: Date, floor: Date): void {
    this._anchorWeekStart.set(getDbDateStr(target < floor ? floor : target));
  }
}
