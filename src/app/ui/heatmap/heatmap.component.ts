import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DateAdapter } from '@angular/material/core';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { msToString } from '../duration/ms-to-string.pipe';
import { T } from '../../t.const';

export interface DayData {
  date: Date;
  dateStr: string;
  taskCount: number;
  timeSpent: number;
  level: number; // 0-4 for color intensity
  isProjected?: boolean; // a future, not-yet-created occurrence (outlined cell)
  isCompleted?: boolean; // a simulated "completed here" day (solid, ringed)
  // Additive preview-only flags (set by the recurrence dialog; the Activity
  // heatmap never sets them, so its rendering is unchanged):
  isNext?: boolean; // the next upcoming occurrence — spotlit with a pulse ring
  isToday?: boolean; // today's cell — marked with a ring
  isStart?: boolean; // the recurrence's start/anchor day (click-to-set in the dialog preview)
  occurrenceIndex?: number; // 0-based order in the window — drives the tooltip's "occurrence #N"
  activityLevel?: number; // 1-4 tracked-time intensity (GREEN overlay), distinct from projection
}

export interface WeekData {
  days: (DayData | null)[];
}

export interface MonthBlock {
  label: string; // localized short month name (e.g. "Jan")
  total: string; // pre-formatted total shown beneath (caller picks time vs count)
  weeks: WeekData[]; // this month's days, laid in weekday-row columns
}

export interface HeatmapData {
  // The continuous week grid — rendered by nothing on-screen anymore, but the
  // metric share-canvas export still draws it.
  weeks: WeekData[];
  monthLabels: string[];
  // The month-grouped layout this component renders: each month its own
  // mini-grid with a label + total beneath.
  months?: MonthBlock[];
}

/** The full payload the heatmap-switcher consumes: the rendered year data plus
 *  the raw dayMap + range its month-calendar view navigates. */
export interface HeatmapViewData extends HeatmapData {
  dayMap: Map<string, DayData>;
  rangeStart: Date;
  rangeEnd: Date;
}

@Component({
  selector: 'heatmap',
  templateUrl: './heatmap.component.html',
  styleUrls: ['./heatmap.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [TranslatePipe, MatIcon, MatIconButton],
})
export class HeatmapComponent {
  readonly T = T;
  private readonly _dateAdapter = inject(DateAdapter);
  private readonly _translateService = inject(TranslateService);

  // Single shared tooltip: instead of a matTooltip overlay per cell (which
  // stacked into a trail on a fast sweep across the dense grid), one readout
  // follows the hovered/focused cell. Positioned relative to `.heatmap-container`
  // (the non-scrolling root), so a horizontal scroll of the month strip never
  // strands a stale overlay.
  readonly tip = signal<{ x: number; y: number; text: string } | null>(null);

  showTip(day: DayData | null, ev: Event): void {
    const text = this.getDayTitle(day);
    const cell = ev.currentTarget as HTMLElement | null;
    if (!text || !cell) {
      this.tip.set(null);
      return;
    }
    // VIEWPORT coords for a position:fixed tip — a container-relative absolute
    // tip extended the scroll area of whatever scrolls around the heatmap (the
    // dialog content), which jittered the bottom scrollbar on hover.
    const cr = cell.getBoundingClientRect();
    const halfWidth = cr.width / 2;
    this.tip.set({ x: cr.left + halfWidth, y: cr.top, text });
  }

  hideTip(): void {
    this.tip.set(null);
  }

  readonly data = input.required<HeatmapData | null>();
  readonly label = input<string>('');
  /** Legend under the grid: relative intensity (Low→High) for activity data,
   *  projected/completed swatches for projections, or none. */
  readonly legendMode = input<'intensity' | 'projection' | 'none'>('none');
  /** Optional in-card navigation header (e.g. ‹ 2026 ›), styled like the month
   *  calendar's ‹ June 2026 › header. Hidden while empty. */
  readonly navLabel = input<string>('');
  readonly canNavPrev = input<boolean>(false);
  readonly canNavNext = input<boolean>(false);
  readonly navPrev = output<void>();
  readonly navNext = output<void>();
  /** Emits the clicked day (non-empty cells only). Consumers decide what to do. */
  readonly dayClick = output<DayData>();
  /** Emits the double-clicked day (e.g. simulate-completion in the dialog). */
  readonly dayDblClick = output<DayData>();
  /** When true, day cells become keyboard-reachable buttons (for consumers that
   *  act on `dayClick`, e.g. click-to-simulate). Display-only heatmaps keep
   *  plain, non-focusable cells. */
  readonly interactive = input<boolean>(false);
  /** Preview-only flourish, default OFF so the Activity heatmap is untouched:
   *  tint weekend rows. */
  readonly showWeekends = input<boolean>(false);
  /** When true, the legend shows the green "tracked time" (activity) swatch. */
  readonly showActivity = input<boolean>(false);

  onDayKeydown(event: Event, day: DayData | null): void {
    if (day) {
      // Space must activate, not scroll.
      event.preventDefault();
      this.dayClick.emit(day);
    }
  }

  // --- Drag-to-pan the month strip (it overflows horizontally for a full year).
  // Pointer-based so it works with mouse, touch and pen; a drag past a small
  // threshold suppresses the trailing click so panning never sets the start day.
  readonly isDragging = signal(false);
  private _dragEl: HTMLElement | null = null;
  private _dragStartX = 0;
  private _dragStartScroll = 0;
  private _dragMoved = false;
  private _dragPointerId: number | null = null;
  private _dragCaptured = false;

  onBlocksPointerDown(ev: PointerEvent): void {
    if (ev.button !== 0) {
      return;
    }
    const el = ev.currentTarget as HTMLElement;
    this._dragEl = el;
    this._dragStartX = ev.clientX;
    this._dragStartScroll = el.scrollLeft;
    this._dragMoved = false;
    this._dragCaptured = false;
    this._dragPointerId = ev.pointerId;
    // Capture is DEFERRED until an actual drag starts (see move). Capturing on
    // pointerdown retargets the synthesized `click` to this container, which
    // swallowed plain clicks on a day cell — set-start stopped working in the
    // year view.
  }

  onBlocksPointerMove(ev: PointerEvent): void {
    if (!this._dragEl || this._dragPointerId !== ev.pointerId) {
      return;
    }
    const dx = ev.clientX - this._dragStartX;
    if (!this._dragMoved && Math.abs(dx) > 3) {
      // A real pan began: NOW take pointer capture (smooth tracking) and flag the
      // move so the trailing click is suppressed.
      this._dragMoved = true;
      this.isDragging.set(true);
      this._dragEl.setPointerCapture?.(ev.pointerId);
      this._dragCaptured = true;
    }
    if (this._dragMoved) {
      this._dragEl.scrollLeft = this._dragStartScroll - dx;
    }
  }

  onBlocksPointerUp(ev: PointerEvent): void {
    if (!this._dragEl) {
      return;
    }
    if (this._dragCaptured) {
      this._dragEl.releasePointerCapture?.(ev.pointerId);
    }
    this._dragEl = null;
    this._dragPointerId = null;
    this._dragCaptured = false;
    this.isDragging.set(false);
  }

  // Cell click — swallowed when it is the tail of a pan (see _dragMoved), so a
  // drag across the dense grid never lands as a "set start here".
  onDayClick(day: DayData | null): void {
    if (!this.interactive() || !day) {
      return;
    }
    if (this._dragMoved) {
      this._dragMoved = false;
      return;
    }
    this.dayClick.emit(day);
  }

  readonly dayLabels = computed(() => {
    // Localized like the month-calendar view of the same widget (DateAdapter),
    // rotated so the locale's first weekday comes first.
    const allDays = this._dateAdapter.getDayOfWeekNames('short');
    const firstDay = this._dateAdapter.getFirstDayOfWeek();
    return [...allDays.slice(firstDay), ...allDays.slice(0, firstDay)];
  });

  getDayClass(day: DayData | null): string {
    if (!day) {
      return 'day empty';
    }
    const weekend =
      this.showWeekends() && (day.date.getDay() === 0 || day.date.getDay() === 6)
        ? ' weekend'
        : '';
    return `day level-${day.level}${
      day.activityLevel ? ` activity activity-${day.activityLevel}` : ''
    }${day.isProjected ? ' projected' : ''}${day.isCompleted ? ' completed' : ''}${
      day.isNext ? ' next' : ''
    }${day.isToday ? ' today' : ''}${day.isStart ? ' start' : ''}${weekend}`;
  }

  /** Day-granular countdown from today, or '' for past days. */
  private _countdown(date: Date): string {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
    if (days < 0) {
      return '';
    }
    return days === 0
      ? (this._translateService.instant(T.G.HEATMAP_TODAY) as string)
      : (this._translateService.instant(T.G.HEATMAP_IN_DAYS, { nr: days }) as string);
  }

  getDayTitle(day: DayData | null): string {
    if (!day) {
      return '';
    }
    if (day.isStart) {
      return `${day.dateStr}: ${this._translateService.instant(T.G.HEATMAP_START_DAY)}`;
    }
    if (day.isCompleted) {
      return `${day.dateStr}: ${this._translateService.instant(T.G.HEATMAP_COMPLETED_SIM)}`;
    }
    if (day.isProjected) {
      const parts = [this._translateService.instant(T.G.HEATMAP_PROJECTED) as string];
      if (day.occurrenceIndex != null) {
        parts.push(
          this._translateService.instant(T.G.HEATMAP_OCCURRENCE_NR, {
            nr: day.occurrenceIndex + 1,
          }) as string,
        );
      }
      const cd = this._countdown(day.date);
      if (cd) {
        parts.push(cd);
      }
      return `${day.dateStr}: ${parts.join(' · ')}`;
    }
    // A projection calendar has no activity to report on an empty day — just its
    // date. (Clicking sets the start; that affordance lives in the caption above
    // the calendar, not a per-day tooltip claim.)
    if (this.legendMode() === 'projection') {
      return day.dateStr;
    }
    return `${day.dateStr}: ${this._translateService.instant(T.G.HEATMAP_ACTIVITY, {
      count: day.taskCount,
      time: msToString(day.timeSpent),
    })}`;
  }
}
