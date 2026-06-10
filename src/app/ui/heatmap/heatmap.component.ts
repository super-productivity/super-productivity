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

  readonly dayLabels = computed(() => {
    const allDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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
    return `${day.dateStr}: ${this._translateService.instant(T.G.HEATMAP_ACTIVITY, {
      count: day.taskCount,
      time: msToString(day.timeSpent),
    })}`;
  }
}
