import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DateAdapter } from '@angular/material/core';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
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
  isEnd?: boolean; // the recurrence's UNTIL (end) day — marked specially
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
  monthIndex: number; // 0=Jan … 11=Dec — for click targeting + limited-month chip
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
  imports: [TranslatePipe, MatIcon, MatIconButton, MatTooltip],
})
export class HeatmapComponent {
  readonly T = T;
  private readonly _dateAdapter = inject(DateAdapter);
  private readonly _translateService = inject(TranslateService);
  private readonly _elRef = inject<ElementRef<HTMLElement>>(ElementRef);

  /** A date (YYYY-MM-DD) the consumer wants brought into view — e.g. the start
   *  date just changed. Scrolls the (horizontally panned) month strip so that
   *  day's cell is centred. No-op when the day isn't in the rendered window. */
  readonly focusDate = input<string | null>(null);

  constructor() {
    effect(() => {
      const f = this.focusDate();
      if (!f) {
        return;
      }
      // The `.start` cell is repainted from the same change that moved focusDate;
      // defer one tick so the scroll targets the up-to-date DOM.
      untracked(() => setTimeout(() => this._scrollFocusIntoView()));
    });
  }

  private _scrollFocusIntoView(): void {
    const container = this._elRef.nativeElement.querySelector(
      '.heatmap-month-blocks',
    ) as HTMLElement | null;
    const cell = container?.querySelector('.day.start') as HTMLElement | null;
    if (!container || !cell) {
      return;
    }
    const cr = cell.getBoundingClientRect();
    const kr = container.getBoundingClientRect();
    const halfCell = cr.width / 2;
    const halfView = container.clientWidth / 2;
    // Centre the cell in the (horizontally panned) strip.
    container.scrollLeft += cr.left - kr.left + halfCell - halfView;
  }

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
  /** Direct-manipulation mode: a (non-drag) day click emits `dayMenu` with the
   *  DOM event so the consumer can anchor a contextual menu, instead of firing
   *  `dayClick`. */
  readonly interactiveMenus = input<boolean>(false);
  readonly dayMenu = output<{ data: DayData; event: MouseEvent }>();
  /** Weekday-label click (weekday index Mon=0 … Sun=6) + event — direct-manip. */
  readonly weekdayHeaderMenu = output<{ weekdayIdx: number; event: MouseEvent }>();
  /** Month-label click (0=Jan … 11=Dec) + event — direct-manip. */
  readonly monthLabelMenu = output<{ month: number; event: MouseEvent }>();
  /** Months (0=Jan … 11=Dec) currently limited via BYMONTH — shown with a chip. */
  readonly limitedMonths = input<number[] | null>(null);
  /** Per-weekday (Mon=0 … Sun=6) hover tooltip spelling out what's set on it. */
  readonly weekdayHeaderTooltips = input<Map<number, string> | null>(null);
  /** Tooltip for a limited month label (the BYMONTH limit list). */
  readonly monthTooltip = input<string>('');
  /** When true, day cells become keyboard-reachable buttons (for consumers that
   *  act on `dayClick`, e.g. click-to-simulate). Display-only heatmaps keep
   *  plain, non-focusable cells. */
  readonly interactive = input<boolean>(false);
  /** Preview-only flourish, default OFF so the Activity heatmap is untouched:
   *  tint weekend rows. */
  readonly showWeekends = input<boolean>(false);
  /** When true, the legend shows the green "tracked time" (activity) swatch. */
  readonly showActivity = input<boolean>(false);

  onYearWeekdayClick(weekdayIdx: number, event: MouseEvent): void {
    if (this.interactiveMenus()) {
      this.weekdayHeaderMenu.emit({ weekdayIdx, event });
    }
  }
  onYearMonthClick(month: number, event: MouseEvent): void {
    if (this.interactiveMenus()) {
      this.monthLabelMenu.emit({ month, event });
    }
  }
  isMonthLimited(month: number): boolean {
    return !!this.limitedMonths()?.includes(month);
  }

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
  // drag across the dense grid never lands as a click/menu.
  onDayClick(day: DayData | null, event: MouseEvent): void {
    if (!this.interactive() || !day) {
      return;
    }
    if (this._dragMoved) {
      this._dragMoved = false;
      return;
    }
    if (this.interactiveMenus()) {
      this.dayMenu.emit({ data: day, event });
    } else {
      this.dayClick.emit(day);
    }
  }

  readonly dayLabels = computed(() => {
    // Localized like the month-calendar view of the same widget (DateAdapter),
    // rotated so the locale's first weekday comes first.
    const allDays = this._dateAdapter.getDayOfWeekNames('short');
    const firstDay = this._dateAdapter.getFirstDayOfWeek();
    return [...allDays.slice(firstDay), ...allDays.slice(0, firstDay)];
  });

  /** Weekday rows tagged with their weekday index (Mon=0 … Sun=6) so a click maps
   *  to a stable weekday regardless of the locale's first day. */
  readonly dayLabelRows = computed<{ label: string; weekdayIdx: number }[]>(() => {
    const names = this._dateAdapter.getDayOfWeekNames('short') as string[];
    const firstDay = this._dateAdapter.getFirstDayOfWeek();
    const rows: { label: string; weekdayIdx: number }[] = [];
    for (let r = 0; r < 7; r++) {
      const jsDay = (firstDay + r) % 7; // 0=Sun … 6=Sat
      rows.push({ label: names[jsDay], weekdayIdx: (jsDay + 6) % 7 }); // → Mon=0
    }
    return rows;
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
    }${day.isToday ? ' today' : ''}${day.isStart ? ' start' : ''}${
      day.isEnd ? ' end' : ''
    }${weekend}`;
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
    // Activity heatmap (intensity mode) already reports tracked time in its line.
    if (this.legendMode() !== 'projection') {
      return `${day.dateStr}: ${this._translateService.instant(T.G.HEATMAP_ACTIVITY, {
        count: day.taskCount,
        time: msToString(day.timeSpent),
      })}`;
    }
    // Projection preview: an occurrence/start label, plus the tracked time when
    // the day has any (so hovering a green day shows the hours spent).
    let title: string;
    if (day.isStart) {
      title = `${day.dateStr}: ${this._translateService.instant(T.G.HEATMAP_START_DAY)}`;
    } else if (day.isEnd) {
      title = `${day.dateStr}: ${this._translateService.instant(T.G.HEATMAP_END_DAY)}`;
    } else if (day.isCompleted) {
      title = `${day.dateStr}: ${this._translateService.instant(T.G.HEATMAP_COMPLETED_SIM)}`;
    } else if (day.isProjected) {
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
      title = `${day.dateStr}: ${parts.join(' · ')}`;
    } else {
      title = day.dateStr;
    }
    if (day.timeSpent > 0) {
      title += ` · ${this._translateService.instant(T.G.HEATMAP_ACTIVITY_LEGEND)}: ${msToString(
        day.timeSpent,
      )}`;
    }
    return title;
  }
}
