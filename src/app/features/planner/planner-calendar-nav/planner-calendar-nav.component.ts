import {
  afterNextRender,
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
  MIN_ROW_HEIGHT,
  ROW_HEIGHT,
  WEEKS_SHOWN,
} from './planner-calendar-gesture-handler';

/** The collapse handle, which sits below the week rows and must stay tappable. */
export const HANDLE_HEIGHT = 28;
/** One task row of the plan list must stay visible behind an expanded calendar. */
const MIN_PLAN_VIEW_HEIGHT = 40;

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
   * Height of one week row. Six rows are always rendered, so the grid spans the
   * whole month and every day stays tappable (#9449); where six 40px rows do
   * not fit they shrink instead. Dropping rows would hide the tail of the month
   * behind an edge no gesture scrolls past, which is the bug this PR is for.
   */
  rowHeight = computed(() => {
    const fits = Math.floor(this._availableForRows() / WEEKS_SHOWN);
    return Math.min(ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, fits));
  });

  /**
   * Below six `MIN_ROW_HEIGHT` rows the grid no longer fits at a legible size,
   * so it stays collapsed. Nothing is lost: the collapsed strip walks all six
   * rows one at a time on a horizontal swipe.
   */
  canExpand = computed(() => this._availableForRows() >= WEEKS_SHOWN * MIN_ROW_HEIGHT);

  // The planner host, not `parentElement`: it is the box whose bottom bounds
  // the calendar, and resolving it by selector survives the nav being wrapped
  // in planner.component.html.
  private _parentEl(): HTMLElement | null {
    return this._elRef.nativeElement.closest('planner') as HTMLElement | null;
  }

  /** Distance from the top of the offset chain, which no ancestor transform scales. */
  private _layoutTop(el: HTMLElement): number {
    let top = 0;
    let cur: HTMLElement | null = el;
    while (cur) {
      top += cur.offsetTop;
      cur = cur.offsetParent as HTMLElement | null;
    }
    return top;
  }

  private _measureAvailableForRows(): void {
    const el = this._weeksEl()?.nativeElement;
    if (!el) return;
    // Bounded by the route content, not the window: on XS the bottom nav takes
    // the last ~44px, so measuring against window.innerHeight reserves space
    // that the plan list never gets.
    const container = this._parentEl();
    // Without the host there is nothing to measure against, so leave the room
    // unbounded and render full-size rows rather than guess at a clamp.
    if (!container) return;
    // offsetTop/clientHeight rather than getBoundingClientRect: the route enter
    // animation (warpRoute) starts this view at scale(1.2), and a rect read
    // while that is in flight is 20% too generous. Measured 227px of room where
    // there were 178, which is a whole extra row.
    const topWithinContainer = this._layoutTop(el) - this._layoutTop(container);
    this._availableForRows.set(
      container.clientHeight - topWithinContainer - HANDLE_HEIGHT - MIN_PLAN_VIEW_HEIGHT,
    );
  }

  /**
   * The row height actually rendered. Collapsed rows stay full size even where
   * an expanded grid would have to shrink: the collapsed strip is one row in a
   * viewport with room for it, and `.week button` is
   * `min(36px, var(--row-height) - 4px)`, so a shrunken collapsed row would
   * hand every user 25px tap targets whether or not they ever expand. Rows
   * resizing across the expand transition is the accepted trade.
   */
  displayRowHeight = computed(() => (this.isExpanded() ? this.rowHeight() : ROW_HEIGHT));

  /**
   * Clamped by the measured room, not only by `canExpand()`.
   *
   * `canExpand()` gates *entering* the expanded state and nothing leaves it:
   * `isExpanded` is written only from `snapTo`, and `isXs` is a max-*width*
   * query, so a height-only shrink (a `<banner>` appearing above
   * `.route-wrapper`, which fires no resize event) leaves the flag true while
   * the room is gone. Without this clamp `rowHeight()`'s `MIN_ROW_HEIGHT` floor
   * put a fixed 144px grid into whatever space was left, overflowing into the
   * `MIN_PLAN_VIEW_HEIGHT` reserve the clamp exists to protect. A no-op
   * whenever `canExpand()` is true.
   *
   * The collapsed branch is deliberately not clamped. `_availableForRows` has
   * no floor, so at an Electron minimum window it can fall under one row or go
   * negative, and a negative `max-height` is rejected by CSSOM outright, which
   * leaves the element on whatever value was last valid rather than failing
   * visibly. One collapsed row is the floor.
   */
  maxHeight = computed(() => (this.isExpanded() ? this.maxExpandedHeight() : ROW_HEIGHT));

  /** What the grid opens to, clamped the same way `maxHeight` is. */
  maxExpandedHeight = computed(() =>
    Math.min(this.rowHeight() * WEEKS_SHOWN, this._availableForRows()),
  );

  // Expanded shows every row, so there is nothing to scroll to.
  weekOffset = computed(() =>
    this.isExpanded() ? 0 : -this.activeWeekIndex() * ROW_HEIGHT,
  );

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
        measure: () => this._measureAvailableForRows(),
        getExpandedHeight: () => this.maxExpandedHeight(),
        getRowHeight: () => this.rowHeight(),
        canExpand: () => this.canExpand(),
        onExpandChanged: (expanded) => this.isExpanded.set(expanded),
        onVerticalSwipe: (isDown) => this._handleVerticalSwipe(isDown),
        onHorizontalSwipe: (dir) => this._handleHorizontalSwipe(dir),
        detectChanges: () => this._cdr.detectChanges(),
      },
    );
    this._destroyRef.onDestroy(() => this._gesture.destroy());

    // After the first render, not as soon as the rows exist: the month label and
    // day labels are laid out in the same pass and push the rows down, so an
    // earlier read measures from a top the grid no longer has.
    afterNextRender(() => this._observeAvailableForRows());
  }

  // Observes the box the measurement is taken against, rather than the window:
  // the route content also shrinks when a banner appears above it (`<banner>`
  // sits above `.route-wrapper`), which fires no resize event. It cannot see the
  // rows' own top move, which is why the gesture handler re-measures too.
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
