import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { DateAdapter } from '@angular/material/core';
import { TranslateService } from '@ngx-translate/core';
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
  weeks: WeekData[];
  monthLabels: string[];
  // Optional month-grouped layout used when `groupByMonth` is set: each month is
  // its own mini-grid with a label + total beneath. `weeks`/`monthLabels` stay
  // for the continuous layout and the share-canvas export.
  months?: MonthBlock[];
}

@Component({
  selector: 'heatmap',
  templateUrl: './heatmap.component.html',
  styleUrls: ['./heatmap.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [],
})
export class HeatmapComponent {
  private readonly _dateAdapter = inject(DateAdapter);
  private readonly _translateService = inject(TranslateService);

  readonly data = input.required<HeatmapData | null>();
  readonly label = input<string>('');
  readonly showLegend = input<boolean>(true);
  readonly scrollToEnd = input<boolean>(false);
  /** Render `data.months` as spaced per-month blocks instead of the continuous
   *  GitHub-style strip. */
  readonly groupByMonth = input<boolean>(false);
  /** Emits the clicked day (non-empty cells only). Consumers decide what to do. */
  readonly dayClick = output<DayData>();

  private readonly _scrollableContent =
    viewChild<ElementRef<HTMLElement>>('scrollableContent');

  constructor() {
    effect(() => {
      const data = this.data();
      const scrollEl = this._scrollableContent()?.nativeElement;
      if (data && scrollEl && this.scrollToEnd()) {
        // Use setTimeout to ensure DOM is updated
        setTimeout(() => {
          scrollEl.scrollTo({ left: scrollEl.scrollWidth, behavior: 'instant' });
        });
      }
    });
  }

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
