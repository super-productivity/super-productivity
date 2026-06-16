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
import { DayData } from './heatmap.component';
import { getDbDateStr } from '../../util/get-db-date-str';
import { msToString } from '../duration/ms-to-string.pipe';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { T } from '../../t.const';

interface CalCell {
  dateStr: string;
  dayNum: number;
  data: DayData | null;
  isOtherMonth: boolean;
}

/**
 * Single-month calendar view of a heatmap `dayMap`: numbered, level-coloured day
 * cells with prev/next month navigation, bounded to `[rangeStart, rangeEnd]`. A
 * companion to the year strip (see HeatmapComponent); the switcher toggles
 * between them.
 */
@Component({
  selector: 'heatmap-month-calendar',
  templateUrl: './heatmap-month-calendar.component.html',
  styleUrls: ['./heatmap-month-calendar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [MatIcon, MatIconButton, MatTooltip, TranslatePipe],
})
export class HeatmapMonthCalendarComponent {
  readonly T = T;
  private readonly _dateAdapter = inject(DateAdapter);
  private readonly _translateService = inject(TranslateService);
  private readonly _elRef = inject<ElementRef<HTMLElement>>(ElementRef);

  // Single shared tooltip (see HeatmapComponent): one readout follows the
  // hovered/focused cell instead of a matTooltip overlay per cell, which trailed
  // on a fast sweep across the grid.
  readonly tip = signal<{ x: number; y: number; text: string } | null>(null);

  showTip(cell: CalCell, ev: Event): void {
    const text = this.getCellTitle(cell);
    const el = ev.currentTarget as HTMLElement | null;
    const container = this._elRef.nativeElement.querySelector(
      '.month-cal',
    ) as HTMLElement | null;
    if (!text || !el || !container) {
      this.tip.set(null);
      return;
    }
    const cr = el.getBoundingClientRect();
    const hr = container.getBoundingClientRect();
    const halfWidth = cr.width / 2;
    const x = cr.left - hr.left + halfWidth;
    const y = cr.top - hr.top;
    this.tip.set({ x, y, text });
  }

  hideTip(): void {
    this.tip.set(null);
  }

  readonly dayMap = input.required<Map<string, DayData>>();
  readonly rangeStart = input.required<Date>();
  readonly rangeEnd = input.required<Date>();
  /** Which legend to show beneath the grid. */
  readonly legendMode = input<'intensity' | 'projection' | 'none'>('intensity');
  readonly dayClick = output<DayData>();
  readonly dayDblClick = output<DayData>();
  /** When true, day cells become keyboard-reachable buttons (for consumers that
   *  act on `dayClick`, e.g. click-to-simulate). Display-only calendars keep
   *  plain, non-focusable cells. */
  readonly interactive = input<boolean>(false);
  /** Preview-only flourish, default OFF so the Activity heatmap is untouched:
   *  tint weekend columns. */
  readonly showWeekends = input<boolean>(false);
  /** When true, the legend shows the green "tracked time" (activity) swatch. */
  readonly showActivity = input<boolean>(false);
  /** Direct-manipulation mode (recurring dialog): day clicks open a contextual
   *  menu instead of firing `dayClick`; the weekday headers and the month title
   *  become clickable; per-weekday glyph annotations render. Display-only
   *  calendars (metrics) leave this off and are unaffected. */
  readonly interactiveMenus = input<boolean>(false);
  /** Generic per-weekday header glyphs, keyed by weekday index (Mon=0 … Sun=6),
   *  rendered as a tiny top/mid/bottom column on the right of each header. The
   *  consumer owns their meaning (the dialog maps rule state → glyphs). */
  readonly weekdayHeaderGlyphs = input<Map<
    number,
    { top?: string; mid?: string; bottom?: string }
  > | null>(null);
  /** Per-weekday (Mon=0 … Sun=6) hover tooltip text spelling out what's set on
   *  that weekday; the header shows it on hover. */
  readonly weekdayHeaderTooltips = input<Map<number, string> | null>(null);
  /** Tooltip for the month title (e.g. the BYMONTH limit list). */
  readonly monthTooltip = input<string>('');
  /** Day-cell click in `interactiveMenus` mode — carries the DOM event so the
   *  consumer can anchor a menu at the pointer. */
  readonly dayMenu = output<{ data: DayData; event: MouseEvent }>();
  /** Weekday-header click (weekday index Mon=0 … Sun=6) + event for anchoring. */
  readonly weekdayHeaderMenu = output<{ weekdayIdx: number; event: MouseEvent }>();
  /** Month-title click — carries the shown month (0=Jan … 11=Dec) + event. */
  readonly monthLabelMenu = output<{ month: number; event: MouseEvent }>();
  /** Months (0=Jan … 11=Dec) limited via BYMONTH — the title shows a chip then. */
  readonly limitedMonths = input<number[] | null>(null);
  /** When true, month navigation is unlimited in both directions instead of
   *  bounded to `[rangeStart, rangeEnd]`. The consumer is expected to listen to
   *  `viewMonthChange` and move its data window along (days the current dayMap
   *  doesn't cover render as plain cells until it does). */
  readonly boundless = input<boolean>(false);
  /** The month now shown, emitted on every prev/next navigation. */
  readonly viewMonthChange = output<{ y: number; m: number }>();
  /** A date (YYYY-MM-DD) the consumer wants brought into view — e.g. the start
   *  date just changed. Jumps the calendar to that month (and tells the consumer,
   *  via viewMonthChange, so it can move its data window along). */
  readonly focusDate = input<string | null>(null);

  constructor() {
    effect(() => {
      const f = this.focusDate();
      if (!f) {
        return;
      }
      const [y, m] = f.split('-').map(Number);
      if (!y || !m) {
        return;
      }
      const vm = { y, m: m - 1 };
      untracked(() => {
        const cur = this._viewMonth();
        if (cur && cur.y === vm.y && cur.m === vm.m) {
          return;
        }
        this._viewMonth.set(vm);
        this.viewMonthChange.emit(vm);
      });
    });
  }

  // Explicit user navigation; null → the computed default month. A navigated
  // month that falls OUTSIDE the current data range (the inputs changed under
  // us, e.g. the metric year select) is discarded — otherwise the calendar
  // would strand the user on an all-empty month with the nav buttons disabled.
  // In boundless mode there are no range walls (the consumer moves its data
  // window along), so the user's month always stands.
  private readonly _viewMonth = signal<{ y: number; m: number } | null>(null);
  readonly viewMonth = computed(() => {
    const vm = this._viewMonth();
    return vm && (this.boundless() || this._isMonthInRange(vm))
      ? vm
      : this._defaultMonth();
  });

  readonly monthLabel = computed(() => {
    const { y, m } = this.viewMonth();
    const name = (this._dateAdapter.getMonthNames('long') as string[])[m];
    // The current year is the implied default — "June", not "June 2026"; only
    // other years carry the year so cross-year navigation stays unambiguous.
    return y === new Date().getFullYear() ? name : `${name} ${y}`;
  });

  readonly weekdayLabels = computed(() => {
    const names = this._dateAdapter.getDayOfWeekNames('short') as string[];
    const first = this._dateAdapter.getFirstDayOfWeek();
    return [...names.slice(first), ...names.slice(0, first)];
  });

  /** Header columns in display order, each tagged with its weekday index
   *  (Mon=0 … Sun=6) so clicks/glyphs map to a stable weekday regardless of the
   *  locale's first day. */
  readonly weekdayCols = computed<{ label: string; weekdayIdx: number }[]>(() => {
    const names = this._dateAdapter.getDayOfWeekNames('short') as string[];
    const first = this._dateAdapter.getFirstDayOfWeek();
    const cols: { label: string; weekdayIdx: number }[] = [];
    for (let c = 0; c < 7; c++) {
      const jsDay = (first + c) % 7; // 0=Sun … 6=Sat
      cols.push({ label: names[jsDay], weekdayIdx: (jsDay + 6) % 7 }); // → Mon=0
    }
    return cols;
  });

  onHeaderClick(weekdayIdx: number, event: MouseEvent): void {
    if (this.interactiveMenus()) {
      this.weekdayHeaderMenu.emit({ weekdayIdx, event });
    }
  }

  onTitleClick(event: MouseEvent): void {
    if (this.interactiveMenus()) {
      this.monthLabelMenu.emit({ month: this.viewMonth().m, event });
    }
  }
  readonly isViewMonthLimited = computed(
    () => !!this.limitedMonths()?.includes(this.viewMonth().m),
  );

  readonly weeks = computed<CalCell[][]>(() => {
    const { y, m } = this.viewMonth();
    const firstDow = this._dateAdapter.getFirstDayOfWeek();
    const lead = (new Date(y, m, 1).getDay() - firstDow + 7) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const rows = Math.ceil((lead + daysInMonth) / 7);
    const map = this.dayMap();
    const grid: CalCell[][] = [];
    const cur = new Date(y, m, 1 - lead);
    for (let r = 0; r < rows; r++) {
      const row: CalCell[] = [];
      for (let c = 0; c < 7; c++) {
        const dateStr = getDbDateStr(cur);
        row.push({
          dateStr,
          dayNum: cur.getDate(),
          data: map.get(dateStr) ?? null,
          isOtherMonth: cur.getMonth() !== m,
        });
        cur.setDate(cur.getDate() + 1);
      }
      grid.push(row);
    }
    return grid;
  });

  readonly canPrev = computed(() => {
    if (this.boundless()) return true;
    const { y, m } = this.viewMonth();
    return new Date(y, m, 0) >= this._dayStart(this.rangeStart());
  });
  readonly canNext = computed(() => {
    if (this.boundless()) return true;
    const { y, m } = this.viewMonth();
    return new Date(y, m + 1, 1) <= this.rangeEnd();
  });

  prev(): void {
    if (!this.canPrev()) return;
    const { y, m } = this.viewMonth();
    const vm = m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 };
    this._viewMonth.set(vm);
    this.viewMonthChange.emit(vm);
  }
  next(): void {
    if (!this.canNext()) return;
    const { y, m } = this.viewMonth();
    const vm = m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 };
    this._viewMonth.set(vm);
    this.viewMonthChange.emit(vm);
  }

  onCellKeydown(event: Event, cell: CalCell): void {
    // Space must activate, not scroll.
    event.preventDefault();
    this.onCellClick(cell, event as unknown as MouseEvent);
  }

  isCellInteractive(cell: CalCell): boolean {
    return this.interactive() && !!cell.data && !cell.isOtherMonth;
  }

  onCellClick(cell: CalCell, event: MouseEvent): void {
    // Mouse clicks only act where the calendar IS interactive — display-only
    // contexts must not emit on click while keyboard users can't activate.
    // Other-month spill-over cells render greyed with no level/completed
    // styling — emitting for them would trigger consumer actions with zero
    // visual feedback on the clicked cell.
    if (!this.interactive() || !cell.data || cell.isOtherMonth) {
      return;
    }
    // Direct-manipulation mode: hand the consumer the day + event to anchor a
    // contextual menu. Otherwise keep the plain dayClick behaviour.
    if (this.interactiveMenus()) {
      this.dayMenu.emit({ data: cell.data, event });
    } else {
      this.dayClick.emit(cell.data);
    }
  }

  onCellDblClick(cell: CalCell): void {
    if (this.interactive() && cell.data && !cell.isOtherMonth) {
      this.dayDblClick.emit(cell.data);
    }
  }

  getCellClass(cell: CalCell): string {
    if (cell.isOtherMonth) return 'cal-day other-month';
    const weekend = this.showWeekends() && this._isWeekend(cell) ? ' weekend' : '';
    const d = cell.data;
    if (!d) return `cal-day${weekend}`;
    return `cal-day level-${d.level}${
      d.activityLevel ? ` activity activity-${d.activityLevel}` : ''
    }${d.isProjected ? ' projected' : ''}${d.isCompleted ? ' completed' : ''}${
      d.isNext ? ' next' : ''
    }${d.isToday ? ' today' : ''}${d.isStart ? ' start' : ''}${
      d.isEnd ? ' end' : ''
    }${weekend}`;
  }

  private _isWeekend(cell: CalCell): boolean {
    const dow = (cell.data?.date ?? new Date(`${cell.dateStr}T00:00:00`)).getDay();
    return dow === 0 || dow === 6;
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

  getCellTitle(cell: CalCell): string {
    const d = cell.data;
    if (!d || cell.isOtherMonth) return cell.dateStr;
    // Activity heatmap (intensity) reports tracked time in its own line.
    if (this.legendMode() !== 'projection') {
      return `${d.dateStr}: ${this._translateService.instant(T.G.HEATMAP_ACTIVITY, {
        count: d.taskCount,
        time: msToString(d.timeSpent),
      })}`;
    }
    // Projection preview: occurrence/start label, plus tracked time when the day
    // has any (so hovering a green day shows the hours spent).
    let title: string;
    if (d.isStart) {
      title = `${d.dateStr}: ${this._translateService.instant(T.G.HEATMAP_START_DAY)}`;
    } else if (d.isEnd) {
      title = `${d.dateStr}: ${this._translateService.instant(T.G.HEATMAP_END_DAY)}`;
    } else if (d.isCompleted) {
      title = `${d.dateStr}: ${this._translateService.instant(T.G.HEATMAP_COMPLETED_SIM)}`;
    } else if (d.isProjected) {
      const parts = [this._translateService.instant(T.G.HEATMAP_PROJECTED) as string];
      if (d.occurrenceIndex != null) {
        parts.push(
          this._translateService.instant(T.G.HEATMAP_OCCURRENCE_NR, {
            nr: d.occurrenceIndex + 1,
          }) as string,
        );
      }
      const cd = this._countdown(d.date);
      if (cd) {
        parts.push(cd);
      }
      title = `${d.dateStr}: ${parts.join(' · ')}`;
    } else {
      title = d.dateStr;
    }
    if (d.timeSpent > 0) {
      title += ` · ${this._translateService.instant(T.G.HEATMAP_ACTIVITY_LEGEND)}: ${msToString(
        d.timeSpent,
      )}`;
    }
    return title;
  }

  private _defaultMonth(): { y: number; m: number } {
    // Compare calendar DAYS, not instants: rangeStart is often anchored at
    // local noon (the projection preview), so an instant comparison before
    // noon put "today" outside the range and defaulted the view to the month
    // of rangeEnd — a year ahead.
    const today = this._dayStart(new Date());
    const inRange =
      today >= this._dayStart(this.rangeStart()) && today <= this.rangeEnd();
    // Out-of-range fallback is direction-aware: a window entirely in the
    // FUTURE (e.g. a year-jumped projection) opens at its START; a window in
    // the past (e.g. a history year) at its END — the most recent month.
    const ref = inRange
      ? today
      : today < this._dayStart(this.rangeStart())
        ? this.rangeStart()
        : this.rangeEnd();
    return { y: ref.getFullYear(), m: ref.getMonth() };
  }
  /** True when any day of month `vm` overlaps `[rangeStart, rangeEnd]`. */
  private _isMonthInRange(vm: { y: number; m: number }): boolean {
    const monthStart = new Date(vm.y, vm.m, 1);
    const monthEnd = new Date(vm.y, vm.m + 1, 0, 23, 59, 59);
    return monthEnd >= this._dayStart(this.rangeStart()) && monthStart <= this.rangeEnd();
  }
  private _dayStart(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
}
