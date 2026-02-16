import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  NgZone,
  output,
  signal,
} from '@angular/core';
import { DateAdapter } from '@angular/material/core';
import { DateService } from '../../../core/date/date.service';
import { getWeekRange } from '../../../util/get-week-range';
import { getWeekdaysMin } from '../../../util/get-weekdays-min';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { parseDbDateStr } from '../../../util/parse-db-date-str';

interface CalendarDay {
  dateStr: string;
  dayOfMonth: number;
  isToday: boolean;
  isPast: boolean;
  hasTasks: boolean;
}

const WEEKS_SHOWN = 5;
const DAYS_IN_VIEW = WEEKS_SHOWN * 7;
const ROW_HEIGHT = 40;
const SWIPE_THRESHOLD = 50;
const SWIPE_VELOCITY_THRESHOLD = 0.3;
const DIRECTION_RATIO = 1.5;

@Component({
  selector: 'planner-calendar-nav',
  templateUrl: './planner-calendar-nav.component.html',
  styleUrl: './planner-calendar-nav.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlannerCalendarNavComponent {
  private _dateAdapter = inject(DateAdapter);
  private _dateService = inject(DateService);
  private _elRef = inject(ElementRef);
  private _zone = inject(NgZone);
  private _destroyRef = inject(DestroyRef);

  visibleDayDate = input<string | null>(null);
  daysWithTasks = input<ReadonlySet<string>>(new Set());
  dayTapped = output<string>();

  isExpanded = signal(false);
  private _anchorWeekStart = signal<string | null>(null);
  private _touchStartY = 0;
  private _touchStartX = 0;
  private _touchStartTime = 0;
  private _gestureClaimedV = false;

  dayLabels = computed(() => {
    const firstDay = this._dateAdapter.getFirstDayOfWeek();
    const allDays = getWeekdaysMin();
    const ordered: string[] = [];
    for (let i = 0; i < 7; i++) {
      ordered.push(allDays[(firstDay + i) % 7]);
    }
    return ordered;
  });

  weeks = computed<CalendarDay[][]>(() => {
    const anchor = this._anchorWeekStart();
    const todayStr = this._dateService.todayStr();
    const todayDate = parseDbDateStr(todayStr);
    todayDate.setHours(0, 0, 0, 0);
    const taskDays = this.daysWithTasks();

    const weekStart = anchor
      ? parseDbDateStr(anchor)
      : getWeekRange(parseDbDateStr(todayStr), this._dateAdapter.getFirstDayOfWeek())
          .start;

    const weeks: CalendarDay[][] = [];
    const cursor = new Date(weekStart);
    for (let w = 0; w < WEEKS_SHOWN; w++) {
      const week: CalendarDay[] = [];
      for (let d = 0; d < 7; d++) {
        const dateStr = getDbDateStr(cursor);
        const dayDate = new Date(cursor);
        dayDate.setHours(0, 0, 0, 0);
        week.push({
          dateStr,
          dayOfMonth: cursor.getDate(),
          isToday: dateStr === todayStr,
          isPast: dayDate < todayDate,
          hasTasks: taskDays.has(dateStr),
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
    }
    return weeks;
  });

  /** Index of the week row containing the visible day (for collapsed view offset) */
  activeWeekIndex = computed(() => {
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

  maxHeight = computed(() => {
    return this.isExpanded() ? ROW_HEIGHT * WEEKS_SHOWN : ROW_HEIGHT;
  });

  /** Negative translateY to bring the active week row into the visible 1-row window */
  weekOffset = computed(() => {
    return this.isExpanded() ? 0 : -this.activeWeekIndex() * ROW_HEIGHT;
  });

  onDayTap(dateStr: string): void {
    this.dayTapped.emit(dateStr);
  }

  constructor() {
    // Update anchor week when visibleDayDate moves outside current 5-week range
    effect(() => {
      const visibleDay = this.visibleDayDate() || this._dateService.todayStr();
      const firstDayOfWeek = this._dateAdapter.getFirstDayOfWeek();
      const visibleDate = parseDbDateStr(visibleDay);
      const anchor = this._anchorWeekStart();

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

    this._zone.runOutsideAngular(() => {
      const el = this._elRef.nativeElement as HTMLElement;

      const onTouchStart = (e: TouchEvent): void => {
        const touch = e.touches[0];
        this._touchStartY = touch.clientY;
        this._touchStartX = touch.clientX;
        this._touchStartTime = Date.now();
        this._gestureClaimedV = false;
      };

      const onTouchMove = (e: TouchEvent): void => {
        const touch = e.touches[0];
        const deltaY = touch.clientY - this._touchStartY;
        const deltaX = touch.clientX - this._touchStartX;
        if (Math.abs(deltaY) > Math.abs(deltaX) * DIRECTION_RATIO) {
          e.preventDefault();
          this._gestureClaimedV = true;
        }
      };

      const onTouchEnd = (e: TouchEvent): void => {
        if (!this._gestureClaimedV) return;
        const touch = e.changedTouches[0];
        const deltaY = touch.clientY - this._touchStartY;
        const elapsed = Date.now() - this._touchStartTime;
        const velocity = Math.abs(deltaY) / Math.max(elapsed, 1);

        const isSwipe =
          Math.abs(deltaY) > SWIPE_THRESHOLD || velocity > SWIPE_VELOCITY_THRESHOLD;
        if (!isSwipe) return;

        this._zone.run(() => this._handleSwipe(deltaY > 0));
      };

      el.addEventListener('touchstart', onTouchStart);
      el.addEventListener('touchmove', onTouchMove, { passive: false });
      el.addEventListener('touchend', onTouchEnd);
      this._destroyRef.onDestroy(() => {
        el.removeEventListener('touchstart', onTouchStart);
        el.removeEventListener('touchmove', onTouchMove);
        el.removeEventListener('touchend', onTouchEnd);
      });
    });
  }

  private _handleSwipe(isDown: boolean): void {
    if (isDown) {
      if (!this.isExpanded()) {
        // Collapsed → expand
        this.isExpanded.set(true);
      } else {
        // Expanded → next month
        this._navigateWeeks(DAYS_IN_VIEW);
      }
    } else {
      if (this.isExpanded()) {
        if (this._isAtTodayWeek()) {
          // Already at earliest range → collapse
          this.isExpanded.set(false);
        } else {
          // Navigate back
          this._navigateWeeks(-DAYS_IN_VIEW);
        }
      }
      // Collapsed + swipe up → do nothing
    }
  }

  private _isAtTodayWeek(): boolean {
    const todayStr = this._dateService.todayStr();
    const firstDayOfWeek = this._dateAdapter.getFirstDayOfWeek();
    const todayWeekStart = getWeekRange(parseDbDateStr(todayStr), firstDayOfWeek).start;
    const todayWeekStr = getDbDateStr(todayWeekStart);

    const anchor = this._anchorWeekStart();
    return !anchor || anchor === todayWeekStr;
  }

  private _navigateWeeks(dayOffset: number): void {
    const todayStr = this._dateService.todayStr();
    const firstDayOfWeek = this._dateAdapter.getFirstDayOfWeek();
    const todayWeekStart = getWeekRange(parseDbDateStr(todayStr), firstDayOfWeek).start;

    const currentAnchor = this._anchorWeekStart();
    const anchorDate = currentAnchor ? parseDbDateStr(currentAnchor) : todayWeekStart;
    const newAnchor = new Date(anchorDate);
    newAnchor.setDate(newAnchor.getDate() + dayOffset);

    // Don't navigate before today's week
    if (newAnchor < todayWeekStart) {
      this._anchorWeekStart.set(getDbDateStr(todayWeekStart));
      return;
    }

    this._anchorWeekStart.set(getDbDateStr(newAnchor));
  }
}
