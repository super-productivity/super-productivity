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
  untracked,
  viewChild,
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

const WEEKS_VISIBLE = 5;
const TOTAL_WEEKS = 52;
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
  private _gestureClaimed: 'v' | 'h' | null = null;
  private _wasExpanded = false;

  private _weeksEl = viewChild<ElementRef<HTMLElement>>('weeksContainer');

  dayLabels = computed(() => {
    const firstDay = this._dateAdapter.getFirstDayOfWeek();
    const allDays = getWeekdaysMin();
    const ordered: string[] = [];
    for (let i = 0; i < 7; i++) {
      ordered.push(allDays[(firstDay + i) % 7]);
    }
    return ordered;
  });

  /** Generate 52 weeks starting from today's week */
  weeks = computed<CalendarDay[][]>(() => {
    const todayStr = this._dateService.todayStr();
    const todayDate = parseDbDateStr(todayStr);
    todayDate.setHours(0, 0, 0, 0);
    const taskDays = this.daysWithTasks();
    const firstDayOfWeek = this._dateAdapter.getFirstDayOfWeek();
    const todayWeekStart = getWeekRange(todayDate, firstDayOfWeek).start;

    const weeks: CalendarDay[][] = [];
    const cursor = new Date(todayWeekStart);
    for (let w = 0; w < TOTAL_WEEKS; w++) {
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

  /** Index of the week row containing the visible day (anchor takes priority for collapsed nav) */
  activeWeekIndex = computed(() => {
    const anchor = this._anchorWeekStart();
    const visibleDay = anchor || this.visibleDayDate();
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
    return this.isExpanded() ? ROW_HEIGHT * WEEKS_VISIBLE : ROW_HEIGHT;
  });

  /** Negative translateY to bring the active week row into the visible 1-row window */
  weekOffset = computed(() => {
    return this.isExpanded() ? 0 : -this.activeWeekIndex() * ROW_HEIGHT;
  });

  /** Formatted month + year label derived from the visible day */
  monthLabel = computed(() => {
    const visibleDay = this.visibleDayDate() || this._dateService.todayStr();
    const date = parseDbDateStr(visibleDay);
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  });

  onDayTap(dateStr: string): void {
    this.dayTapped.emit(dateStr);
  }

  onHandleClick(): void {
    if (this.isExpanded()) {
      const el = this._weeksEl()?.nativeElement;
      if (el) el.scrollTop = 0;
      this.isExpanded.set(false);
    } else {
      this.isExpanded.set(true);
    }
  }

  constructor() {
    // Reset manual collapsed navigation when the planner scroll position changes
    effect(() => {
      this.visibleDayDate();
      this._anchorWeekStart.set(null);
    });

    // Scroll to active week when transitioning to expanded
    effect(() => {
      const expanded = this.isExpanded();
      if (expanded && !this._wasExpanded) {
        const idx = untracked(() => this.activeWeekIndex());
        requestAnimationFrame(() => {
          const el = this._weeksEl()?.nativeElement;
          if (el) {
            el.scrollTop = idx * ROW_HEIGHT;
          }
        });
      }
      this._wasExpanded = expanded;
    });

    this._zone.runOutsideAngular(() => {
      const el = this._elRef.nativeElement as HTMLElement;

      const onTouchStart = (e: TouchEvent): void => {
        const touch = e.touches[0];
        this._touchStartY = touch.clientY;
        this._touchStartX = touch.clientX;
        this._touchStartTime = Date.now();
        this._gestureClaimed = null;
      };

      const onTouchMove = (e: TouchEvent): void => {
        if (this._gestureClaimed) {
          e.preventDefault();
          return;
        }
        const touch = e.touches[0];
        const deltaY = Math.abs(touch.clientY - this._touchStartY);
        const deltaX = Math.abs(touch.clientX - this._touchStartX);

        if (this.isExpanded()) {
          // When expanded, only claim upward swipe at scroll top for collapse
          const weeksEl = this._weeksEl()?.nativeElement;
          const isAtTop = !weeksEl || weeksEl.scrollTop <= 0;
          const isUpward = touch.clientY - this._touchStartY < 0;
          if (isAtTop && isUpward && deltaY > deltaX * DIRECTION_RATIO) {
            e.preventDefault();
            this._gestureClaimed = 'v';
          }
        } else {
          if (deltaY > deltaX * DIRECTION_RATIO) {
            e.preventDefault();
            this._gestureClaimed = 'v';
          } else if (deltaX > deltaY * DIRECTION_RATIO) {
            e.preventDefault();
            this._gestureClaimed = 'h';
          }
        }
      };

      const onTouchEnd = (e: TouchEvent): void => {
        if (!this._gestureClaimed) return;
        const touch = e.changedTouches[0];
        const deltaY = touch.clientY - this._touchStartY;
        const deltaX = touch.clientX - this._touchStartX;
        const elapsed = Date.now() - this._touchStartTime;

        if (this._gestureClaimed === 'v') {
          const velocity = Math.abs(deltaY) / Math.max(elapsed, 1);
          const isSwipe =
            Math.abs(deltaY) > SWIPE_THRESHOLD || velocity > SWIPE_VELOCITY_THRESHOLD;
          if (isSwipe) {
            this._zone.run(() => this._handleVerticalSwipe(deltaY > 0));
          }
        } else {
          const velocity = Math.abs(deltaX) / Math.max(elapsed, 1);
          const isSwipe =
            Math.abs(deltaX) > SWIPE_THRESHOLD || velocity > SWIPE_VELOCITY_THRESHOLD;
          if (isSwipe) {
            this._zone.run(() => this._navigateWeeks(deltaX < 0 ? 1 : -1));
          }
        }
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

  private _handleVerticalSwipe(isDown: boolean): void {
    if (isDown && !this.isExpanded()) {
      this.isExpanded.set(true);
    } else if (!isDown && this.isExpanded()) {
      const el = this._weeksEl()?.nativeElement;
      if (el) el.scrollTop = 0;
      this.isExpanded.set(false);
    }
  }

  private _navigateWeeks(weekDelta: number): void {
    const currentIndex = this.activeWeekIndex();
    const maxIndex = this.weeks().length - 1;
    const newIndex = Math.max(0, Math.min(maxIndex, currentIndex + weekDelta));
    if (newIndex !== currentIndex) {
      const targetWeek = this.weeks()[newIndex];
      if (targetWeek?.length > 0) {
        this._anchorWeekStart.set(targetWeek[0].dateStr);
      }
    }
  }
}
