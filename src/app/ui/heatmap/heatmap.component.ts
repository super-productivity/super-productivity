import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
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
  occurrenceIndex?: number; // 0-based order in the window — drives the tooltip's "occurrence #N"
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
  private readonly _elRef = inject<ElementRef<HTMLElement>>(ElementRef);

  // Single shared tooltip: instead of a matTooltip overlay per cell (which
  // stacked into a trail on a fast sweep across the dense grid), one readout
  // follows the hovered/focused cell. Positioned relative to `.heatmap-container`
  // (the non-scrolling root), so a horizontal scroll of the month strip never
  // strands a stale overlay.
  readonly tip = signal<{ x: number; y: number; text: string } | null>(null);

  showTip(day: DayData | null, ev: Event): void {
    const text = this.getDayTitle(day);
    const cell = ev.currentTarget as HTMLElement | null;
    const container = this._elRef.nativeElement.querySelector(
      '.heatmap-container',
    ) as HTMLElement | null;
    if (!text || !cell || !container) {
      this.tip.set(null);
      return;
    }
    const cr = cell.getBoundingClientRect();
    const hr = container.getBoundingClientRect();
    const halfWidth = cr.width / 2;
    const x = cr.left - hr.left + halfWidth;
    const y = cr.top - hr.top;
    this.tip.set({ x, y, text });
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
  /** When true, day cells become keyboard-reachable buttons (for consumers that
   *  act on `dayClick`, e.g. click-to-simulate). Display-only heatmaps keep
   *  plain, non-focusable cells. */
  readonly interactive = input<boolean>(false);
  /** Preview-only flourish, default OFF so the Activity heatmap is untouched:
   *  tint weekend rows. */
  readonly showWeekends = input<boolean>(false);

  onDayKeydown(event: Event, day: DayData | null): void {
    if (day) {
      // Space must activate, not scroll.
      event.preventDefault();
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

  getDayClass(day: DayData | null): string {
    if (!day) {
      return 'day empty';
    }
    const weekend =
      this.showWeekends() && (day.date.getDay() === 0 || day.date.getDay() === 6)
        ? ' weekend'
        : '';
    return `day level-${day.level}${day.isProjected ? ' projected' : ''}${
      day.isCompleted ? ' completed' : ''
    }${day.isNext ? ' next' : ''}${day.isToday ? ' today' : ''}${weekend}`;
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
    // A projection calendar has no activity to report — an empty day either
    // invites the simulation click (interactive) or is just its date; faking
    // "0 tasks, 0m" would mislabel a valid action as activity data.
    if (this.legendMode() === 'projection') {
      return this.interactive()
        ? `${day.dateStr}: ${this._translateService.instant(T.G.HEATMAP_SIMULATE_DAY)}`
        : day.dateStr;
    }
    return `${day.dateStr}: ${this._translateService.instant(T.G.HEATMAP_ACTIVITY, {
      count: day.taskCount,
      time: msToString(day.timeSpent),
    })}`;
  }
}
