import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { DateAdapter } from '@angular/material/core';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { msToString } from '../duration/ms-to-string.pipe';
import { T } from '../../t.const';
import { HEATMAP_TOOLTIP_SHOW_DELAY } from './heatmap.const';

export interface DayData {
  date: Date;
  dateStr: string;
  taskCount: number;
  timeSpent: number;
  level: number; // 0-4 for color intensity
  isProjected?: boolean; // a future, not-yet-created occurrence (outlined cell)
  isCompleted?: boolean; // a simulated "completed here" day (solid, ringed)
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
  imports: [TranslatePipe, MatIcon, MatIconButton, MatTooltip],
})
export class HeatmapComponent {
  readonly T = T;
  readonly TOOLTIP_SHOW_DELAY = HEATMAP_TOOLTIP_SHOW_DELAY;
  private readonly _dateAdapter = inject(DateAdapter);
  private readonly _translateService = inject(TranslateService);

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
    return `day level-${day.level}${day.isProjected ? ' projected' : ''}${
      day.isCompleted ? ' completed' : ''
    }`;
  }

  getDayTitle(day: DayData | null): string {
    if (!day) {
      return '';
    }
    if (day.isCompleted) {
      return `${day.dateStr}: ${this._translateService.instant(T.G.HEATMAP_COMPLETED_SIM)}`;
    }
    if (day.isProjected) {
      return `${day.dateStr}: ${this._translateService.instant(T.G.HEATMAP_PROJECTED)}`;
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
