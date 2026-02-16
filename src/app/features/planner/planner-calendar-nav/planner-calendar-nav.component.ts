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
import { DateService } from '../../../core/date/date.service';
import { DEFAULT_FIRST_DAY_OF_WEEK } from '../../../core/locale.constants';
import { GlobalConfigService } from '../../config/global-config.service';
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
const MIN_HEIGHT = ROW_HEIGHT;
const MAX_HEIGHT = ROW_HEIGHT * WEEKS_SHOWN;
const SNAP_MIDPOINT = (MIN_HEIGHT + MAX_HEIGHT) / 2;
const SNAP_VELOCITY = 0.3;
const SNAP_DURATION = 200;
const SLIDE_DURATION = 150;
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
  private _globalConfigService = inject(GlobalConfigService);
  private _dateService = inject(DateService);
  private _cdr = inject(ChangeDetectorRef);
  private _elRef = inject(ElementRef);
  private _destroyRef = inject(DestroyRef);

  private _firstDayOfWeek = computed(() => {
    const cfg = this._globalConfigService.localization()?.firstDayOfWeek;
    return cfg !== null && cfg !== undefined ? cfg : DEFAULT_FIRST_DAY_OF_WEEK;
  });

  visibleDayDate = input<string | null>(null);
  daysWithTasks = input<ReadonlySet<string>>(new Set());
  dayTapped = output<string>();

  isExpanded = signal(false);
  private _anchorWeekStart = signal<string | null>(null);

  // Override for which week row is shown in collapsed mode (null = use visibleDayDate)
  private _displayedRow = signal<number | null>(null);

  // Touch state
  private _touchStartY = 0;
  private _touchStartX = 0;
  private _touchStartTime = 0;
  private _gestureClaimed: 'v' | 'h' | null = null;

  // Handle drag state
  private _touchOnHandle = false;
  private _isDragging = false;
  private _isSnapping = false;
  private _dragStartHeight = 0;
  private _dragActiveIdx = 0;

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
    const todayStr = this._dateService.todayStr();
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

  maxHeight = computed(() => {
    return this.isExpanded() ? MAX_HEIGHT : MIN_HEIGHT;
  });

  weekOffset = computed(() => {
    return this.isExpanded() ? 0 : -this.activeWeekIndex() * ROW_HEIGHT;
  });

  monthLabel = computed(() => {
    const allWeeks = this.weeks();
    // In collapsed mode, use the active (visible) week row; in expanded mode, use the middle
    const weekIdx = this.isExpanded()
      ? Math.floor(allWeeks.length / 2)
      : this.activeWeekIndex();
    const week = allWeeks[weekIdx];
    if (week?.length > 0) {
      const date = parseDbDateStr(week[Math.floor(week.length / 2)].dateStr);
      return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }
    const visibleDay = this.visibleDayDate() || this._dateService.todayStr();
    return parseDbDateStr(visibleDay).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
  });

  onDayTap(dateStr: string): void {
    this.dayTapped.emit(dateStr);
  }

  constructor() {
    // Keep anchor in sync when visibleDayDate moves outside the current 5-week window
    effect(() => {
      const visibleDay = this.visibleDayDate() || this._dateService.todayStr();
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

    // Reset collapsed row override when visibleDayDate changes (planner scrolled)
    effect(() => {
      this.visibleDayDate();
      untracked(() => this._displayedRow.set(null));
    });

    const el = this._elRef.nativeElement as HTMLElement;

    const onTouchStart = (e: TouchEvent): void => {
      if (this._isSnapping) return;
      const touch = e.touches[0];
      this._touchStartY = touch.clientY;
      this._touchStartX = touch.clientX;
      this._touchStartTime = Date.now();
      this._gestureClaimed = null;
      this._isDragging = false;
      this._touchOnHandle = !!(e.target as HTMLElement).closest('.handle');
    };

    const onTouchMove = (e: TouchEvent): void => {
      if (this._isSnapping) return;
      const touch = e.touches[0];
      const deltaY = touch.clientY - this._touchStartY;

      // --- Handle drag path ---
      if (this._touchOnHandle) {
        if (!this._isDragging) {
          if (Math.abs(deltaY) < 5) return;
          this._startDrag();
        }
        e.preventDefault();
        this._updateDrag(deltaY);
        return;
      }

      // --- Calendar area: detect swipe direction ---
      if (this._gestureClaimed) {
        e.preventDefault();
        return;
      }
      const absDeltaY = Math.abs(deltaY);
      const absDeltaX = Math.abs(touch.clientX - this._touchStartX);

      if (absDeltaY > absDeltaX * DIRECTION_RATIO) {
        e.preventDefault();
        this._gestureClaimed = 'v';
      } else if (absDeltaX > absDeltaY * DIRECTION_RATIO) {
        e.preventDefault();
        this._gestureClaimed = 'h';
      }
    };

    const onTouchEnd = (e: TouchEvent): void => {
      if (this._isSnapping) return;

      // --- Handle touch ---
      if (this._touchOnHandle) {
        e.preventDefault();
        if (this._isDragging) {
          const touch = e.changedTouches[0];
          const deltaY = touch.clientY - this._touchStartY;
          const elapsed = Date.now() - this._touchStartTime;
          const velocity = deltaY / Math.max(elapsed, 1);
          const currentHeight = Math.max(
            MIN_HEIGHT,
            Math.min(MAX_HEIGHT, this._dragStartHeight + deltaY),
          );

          let snapExpanded: boolean;
          if (Math.abs(velocity) > SNAP_VELOCITY) {
            snapExpanded = velocity > 0;
          } else {
            snapExpanded = currentHeight > SNAP_MIDPOINT;
          }
          this._snapTo(snapExpanded);
        } else {
          // Tap on handle (no drag) → toggle
          this._dragActiveIdx = this.activeWeekIndex();
          this._snapTo(!this.isExpanded());
        }
        return;
      }

      // --- Calendar area swipe ---
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
          this._handleVerticalSwipe(deltaY > 0);
        }
      } else {
        const velocity = Math.abs(deltaX) / Math.max(elapsed, 1);
        const isSwipe =
          Math.abs(deltaX) > SWIPE_THRESHOLD || velocity > SWIPE_VELOCITY_THRESHOLD;
        if (isSwipe) {
          const dir: 1 | -1 = deltaX < 0 ? 1 : -1;
          if (this.isExpanded()) {
            if (dir === -1 && this._isAtPastLimit()) return;
            this._slideContent(dir, () => this._shiftToMonth(dir), 'x');
          } else {
            this._slideCollapsedWeek(dir);
          }
        }
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    this._destroyRef.onDestroy(() => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    });
  }

  private _handleVerticalSwipe(isDown: boolean): void {
    if (isDown) {
      if (!this.isExpanded()) {
        this._dragActiveIdx = this.activeWeekIndex();
        this._snapTo(true);
      } else if (!this._isAtPastLimit()) {
        // Swipe down → previous month, content follows finger downward
        this._slideContent(1, () => this._shiftToMonth(-1), 'y');
      }
    } else {
      if (this.isExpanded()) {
        // Swipe up → next month, content follows finger upward
        this._slideContent(-1, () => this._shiftToMonth(1), 'y');
      }
    }
  }

  /** Navigate collapsed week view left/right */
  private _slideCollapsedWeek(dir: 1 | -1): void {
    const currentRow = this.activeWeekIndex();

    // Don't go before today's week
    if (dir === -1 && this.weeks()[currentRow]?.some((d) => d.isToday)) return;

    const targetRow = currentRow + dir;

    if (targetRow >= 0 && targetRow < WEEKS_SHOWN) {
      // Target week is within the current 5-week window — just slide to it
      this._slideContent(dir, () => this._displayedRow.set(targetRow), 'x');
    } else if (dir === 1) {
      // Past the end — shift anchor forward and show week 0
      this._slideContent(
        dir,
        () => {
          this._shiftAnchor(DAYS_IN_VIEW);
          this._displayedRow.set(0);
        },
        'x',
      );
    } else {
      // Before the start — shift anchor backward
      this._slideContent(
        dir,
        () => {
          const oldAnchorStr = this._anchorWeekStart();
          this._shiftAnchor(-DAYS_IN_VIEW);
          const newAnchorStr = this._anchorWeekStart();
          // Calculate correct row: anchor may have been clamped to today's week
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

  /** Set anchor to the week containing the 1st of the next/previous month */
  private _shiftToMonth(dir: 1 | -1): void {
    const allWeeks = this.weeks();
    const midWeek = allWeeks[Math.floor(allWeeks.length / 2)];
    const midDate = parseDbDateStr(midWeek[Math.floor(midWeek.length / 2)].dateStr);
    const firstOfMonth = new Date(midDate.getFullYear(), midDate.getMonth() + dir, 1);
    const weekStart = getWeekRange(firstOfMonth, this._firstDayOfWeek()).start;
    this._setAnchorClamped(weekStart, this._getTodayWeekStart());
  }

  private _getTodayWeekStart(): Date {
    return getWeekRange(
      parseDbDateStr(this._dateService.todayStr()),
      this._firstDayOfWeek(),
    ).start;
  }

  private _setAnchorClamped(target: Date, floor: Date): void {
    this._anchorWeekStart.set(getDbDateStr(target < floor ? floor : target));
  }

  private _startDrag(): void {
    this._isDragging = true;
    this._dragActiveIdx = this.activeWeekIndex();
    this._dragStartHeight = this.isExpanded() ? MAX_HEIGHT : MIN_HEIGHT;
  }

  private _updateDrag(deltaY: number): void {
    const newHeight = Math.max(
      MIN_HEIGHT,
      Math.min(MAX_HEIGHT, this._dragStartHeight + deltaY),
    );
    const weeksEl = this._weeksEl()?.nativeElement;
    if (!weeksEl) return;
    weeksEl.style.maxHeight = newHeight + 'px';

    const progress = (newHeight - MIN_HEIGHT) / (MAX_HEIGHT - MIN_HEIGHT);
    const offset = -this._dragActiveIdx * ROW_HEIGHT * (1 - progress);
    const innerEl = weeksEl.firstElementChild as HTMLElement;
    if (innerEl) {
      innerEl.style.transform = `translateY(${offset}px)`;
    }
  }

  private _snapTo(expanded: boolean): void {
    const weeksEl = this._weeksEl()?.nativeElement;
    if (!weeksEl) return;
    const innerEl = weeksEl.firstElementChild as HTMLElement;
    this._isSnapping = true;

    const targetHeight = expanded ? MAX_HEIGHT : MIN_HEIGHT;
    const idx = this._dragActiveIdx;
    const targetOffset = expanded ? 0 : -idx * ROW_HEIGHT;

    weeksEl.style.transition = `max-height ${SNAP_DURATION}ms ease`;
    weeksEl.style.maxHeight = targetHeight + 'px';
    if (innerEl) {
      innerEl.style.transition = `transform ${SNAP_DURATION}ms ease`;
      innerEl.style.transform = `translateY(${targetOffset}px)`;
    }

    setTimeout(() => {
      // Clean up inline styles BEFORE signal update so Angular CD applies correct values
      weeksEl.style.transition = '';
      weeksEl.style.maxHeight = '';
      if (innerEl) {
        innerEl.style.transition = '';
        innerEl.style.transform = '';
      }

      this.isExpanded.set(expanded);
      this._cdr.detectChanges();

      this._isDragging = false;
      this._isSnapping = false;
    }, SNAP_DURATION + 10);
  }

  /** Slide content out, run update callback, slide new content in */
  private _slideContent(direction: 1 | -1, onUpdate: () => void, axis: 'x' | 'y'): void {
    const weeksEl = this._weeksEl()?.nativeElement;
    if (!weeksEl) return;
    const innerEl = weeksEl.firstElementChild as HTMLElement;
    if (!innerEl) return;
    this._isSnapping = true;

    // For x: direction 1 → slide left (-100%), -1 → slide right (100%)
    // For y: direction 1 → slide down (100%), -1 → slide up (-100%)
    const sign = axis === 'x' ? -direction : direction;
    const out = `${sign * 100}%`;
    const slideOut = axis === 'x' ? `${out} 0` : `0 ${out}`;

    innerEl.style.transition = `translate ${SLIDE_DURATION}ms ease-out`;
    innerEl.style.translate = slideOut;

    setTimeout(() => {
      innerEl.style.transition = 'none';
      onUpdate();
      this._cdr.detectChanges();

      // Position new content on the opposite side
      const inv = `${-sign * 100}%`;
      const slideIn = axis === 'x' ? `${inv} 0` : `0 ${inv}`;
      innerEl.style.translate = slideIn;

      // Force reflow so the position change applies before transition
      void innerEl.offsetWidth;

      innerEl.style.transition = `translate ${SLIDE_DURATION}ms ease-out`;
      innerEl.style.translate = '0 0';

      setTimeout(() => {
        innerEl.style.transition = '';
        innerEl.style.translate = '';
        this._isSnapping = false;
      }, SLIDE_DURATION + 10);
    }, SLIDE_DURATION + 10);
  }
}
